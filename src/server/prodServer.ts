import fs from "fs";
import http from "http";
import path from "path";
import type { ComponentType, ReactNode } from "react";

import { SEO_METADATA_RPC_METHOD } from "../runtime/internalMethods.js";
import type { PageRoute } from "../runtime/pageRoutes.js";
import { injectHeliumEnvIntoHtml } from "../utils/envLoader.js";
import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import type { HeliumConfig } from "./config.js";
import { getRpcConfig, getRpcSecurityConfig, getTrustProxyDepth } from "./config.js";
import type { HeliumContext } from "./context.js";
import type { HeliumWorkerDef } from "./defineWorker.js";
import { startWorker, stopAllWorkers } from "./defineWorker.js";
import { HTTPRouter } from "./httpRouter.js";
import { handleRpcHttpRequest } from "./httpRpc.js";
import { injectSocialMetaIntoHtml, loadDefaultSocialMetaFromHtmlFile } from "./meta.js";
import { RateLimiter } from "./rateLimiter.js";
import { withRequestErrorHandling } from "./requestHandler.js";
import { abortServerRequests, getRequestSignal, trackServerRequest } from "./requestSignal.js";
import { RpcRegistry } from "./rpcRegistry.js";
import { initializeSecurity } from "./security.js";
import { SEOMetadataRouter } from "./seoMetadataRouter.js";
import { createSSRPageMatcher, renderSSRHTML, resolveServerSideProps, SSRPageDef } from "./ssr.js";

interface WorkerEntry {
    name: string;
    worker: HeliumWorkerDef;
}

interface ProdServerOptions {
    port?: number;
    distDir?: string;
    staticDir?: string;
    registerHandlers: (registry: RpcRegistry, httpRouter: HTTPRouter, seoRouter: SEOMetadataRouter) => void;
    config?: HeliumConfig;
    workers?: WorkerEntry[];
    ssrPages?: SSRPageDef[];
    pageRoutes?: readonly PageRoute[];
    appShell?: (() => Promise<ComponentType<{ Component: ComponentType<Record<string, unknown>>; pageProps: Record<string, unknown>; children?: ReactNode }>>) | null;
}

/**
 * Starts a production HTTP server that:
 * - Serves static files from the dist directory
 * - Supports SSG (Static Site Generation) by serving .html files for routes (e.g., /about -> about.html)
 * - Falls back to index.html for client-side routing (SPA)
 * - Handles custom HTTP endpoints (webhooks, auth, etc.)
 * - Hosts unary and streaming HTTP RPC
 * - Starts background workers
 *
 * SSG Behavior:
 * - Production correctly serves SSG pages (e.g., /about serves about.html with pre-rendered content)
 * - This ensures search engines and social media crawlers see the correct content
 * - Client-side navigation between pages still works via React Router
 */
export function startProdServer(options: ProdServerOptions) {
    const {
        port = Number(process.env.PORT || 3000),
        distDir = "dist",
        staticDir = path.resolve(process.cwd(), distDir),
        registerHandlers,
        config = {},
        workers = [],
        ssrPages = [],
        pageRoutes,
        appShell = null,
    } = options;
    const matchSSRPage = createSSRPageMatcher(ssrPages, pageRoutes);

    // Load configuration
    const trustProxyDepth = getTrustProxyDepth(config);
    const rpcSecurity = getRpcSecurityConfig(config);
    const rpcConfig = getRpcConfig(config);
    initializeSecurity(rpcSecurity);

    // Initialize rate limiter
    const rateLimiter = new RateLimiter(rpcSecurity.maxRequestsPerWindow, rpcSecurity.rateLimitWindowMs);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter({ maxBodySize: rpcConfig.maxBodySize });
    const seoRouter = new SEOMetadataRouter();
    httpRouter.setTrustProxyDepth(trustProxyDepth);
    registerHandlers(registry, httpRouter, seoRouter);
    registry.setRateLimiter(rateLimiter);
    registry.setMaxBatchSize(rpcConfig.maxBatchSize);

    // Security: max body size for HTTP requests (1 MB default)
    const maxBodySize = rpcConfig.maxBodySize ?? 1_048_576;
    let cachedDefaultMeta: Awaited<ReturnType<typeof loadDefaultSocialMetaFromHtmlFile>> | undefined;

    const getDefaultMeta = async () => {
        if (cachedDefaultMeta !== undefined) {
            return cachedDefaultMeta;
        }

        cachedDefaultMeta = await loadDefaultSocialMetaFromHtmlFile(path.join(staticDir, "index.html"));
        return cachedDefaultMeta;
    };

    registry.register(SEO_METADATA_RPC_METHOD, {
        __kind: "method",
        __id: SEO_METADATA_RPC_METHOD,
        handler: async (args: { path?: string } | undefined, ctx: HeliumContext) => {
            const requestedPath = typeof args?.path === "string" ? args.path : "/";
            const targetPath = requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`;
            const metadata = await seoRouter.resolve(ctx.req.raw, ctx, targetPath);
            return metadata ?? (await getDefaultMeta());
        },
    });

    // Create HTTP server
    const handleRequest = withRequestErrorHandling(async (req: any, res: any) => {
        // Apply security headers to all responses
        setSecurityHeaders(res, config);

        handleCorsHeaders(req, res, config);

        // Handle token refresh endpoint
        const requestUrl = new URL(req.url || "/", "http://localhost");
        const requestPathname = requestUrl.pathname;

        if (requestPathname === "/__helium__/page-props" && req.method === "GET") {
            const pathQuery = requestUrl.searchParams.get("path") || "/";
            const targetUrl = new URL(pathQuery, "http://localhost");
            const targetPathname = targetUrl.pathname;
            const ssrMatch = matchSSRPage(targetPathname);

            if (!ssrMatch) {
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ ssr: false, props: null }));
                return;
            }

            const ip = extractClientIP(req, trustProxyDepth);
            const httpCtx: HeliumContext = {
                signal: getRequestSignal(req, res),
                req: {
                    ip,
                    headers: req.headers,
                    url: req.url,
                    method: req.method,
                    raw: req,
                },
            };

            try {
                const ssrResult = await resolveServerSideProps({
                    req,
                    pathname: targetPathname,
                    search: targetUrl.search,
                    params: ssrMatch.params,
                    page: ssrMatch.page,
                    ctx: httpCtx,
                });

                if (ssrResult.kind === "redirect") {
                    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                    res.end(JSON.stringify({ ssr: true, redirect: ssrResult.redirect }));
                    return;
                }

                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ ssr: true, props: ssrResult.props }));
            } catch (error) {
                log("error", "Failed to resolve SSR page props:", error);
                res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ ssr: true, props: null, error: "Internal server error" }));
            }

            return;
        }

        if (registry && (await handleRpcHttpRequest(req, res, registry, { maxBodySize, trustProxyDepth }))) {
            return;
        }

        // Try HTTP handlers first (webhooks, auth, etc.)
        const handled = await httpRouter.handleRequest(req, res);
        if (handled) {
            return;
        }

        // Let explicit OPTIONS handlers run before the generic CORS response.
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" });
            res.end("Method not allowed");
            return;
        }

        // Serve static files
        let url: string;
        try {
            url = decodeURIComponent(requestPathname);
        } catch {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid URL");
            return;
        }
        if (url.includes("\0") || url.includes("\\")) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid URL");
            return;
        }

        // Block access to sensitive configuration and server files
        const blockedFiles = ["helium.config.js", "helium.config.mjs", "helium.config.ts", "server.js", ".env", ".env.local", ".env.production"];

        const requestedFile = path.basename(url).toLowerCase();
        let filePath: string = path.join(staticDir, "index.html");
        let is404 = false;

        if (
            blockedFiles.some((blocked) => requestedFile === blocked || requestedFile.startsWith(".env")) ||
            requestedFile === "server.js.map" ||
            url.split("/").some((part) => part.toLowerCase() === ".git" || part.toLowerCase().startsWith(".env"))
        ) {
            // Serve index.html so the SPA router can render the 404 page
            filePath = path.join(staticDir, "index.html");
            is404 = true;
        } else {
            // Clean URL (remove query params and trailing slash)
            const cleanUrl = url.split("?")[0].replace(/\/$/, "") || "/";

            // Security: path traversal prevention — resolve and verify
            const resolvedStaticDir = path.resolve(staticDir);
            const candidatePath = path.resolve(staticDir, "." + cleanUrl);
            if (!candidatePath.startsWith(resolvedStaticDir + path.sep) && candidatePath !== resolvedStaticDir) {
                filePath = path.join(staticDir, "index.html");
                is404 = true;
            }

            // Try different file paths for SSG support
            if (!is404 && cleanUrl === "/") {
                // Try index.ssg.html first (if root page has SSG)
                const ssgIndexPath = path.join(staticDir, "index.ssg.html");
                if (fs.existsSync(ssgIndexPath)) {
                    filePath = ssgIndexPath;
                } else {
                    filePath = path.join(staticDir, "index.html");
                }
            } else if (!is404) {
                // If cleanUrl has no extension, prioritize .html files for SSG pages
                if (!path.extname(cleanUrl)) {
                    const htmlPath = path.join(staticDir, cleanUrl + ".html");
                    if (fs.existsSync(htmlPath)) {
                        filePath = htmlPath;
                    } else {
                        // Fall back to exact path (for assets or directories)
                        filePath = path.join(staticDir, cleanUrl);
                    }
                } else {
                    // Has an extension, try exact path (for assets like /assets/main.js)
                    filePath = path.join(staticDir, cleanUrl);
                }
            }

            // If file doesn't exist or is a directory, fall back to index.html for SPA routing
            const isFileOrExists = !is404 && filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
            if (!isFileOrExists && !url.startsWith("/api") && !url.startsWith("/webhooks")) {
                // For static asset requests (files with known extensions), return 404 instead
                // of falling back to index.html. Serving HTML for a .js/.css request causes
                // MIME type errors in the browser (e.g., "Expected a JavaScript module script
                // but the server responded with text/html").
                const reqExt = path.extname(cleanUrl).toLowerCase();
                const staticExtensions = new Set([
                    ".js",
                    ".mjs",
                    ".css",
                    ".map",
                    ".json",
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".gif",
                    ".svg",
                    ".ico",
                    ".woff",
                    ".woff2",
                    ".ttf",
                    ".eot",
                    ".webp",
                    ".avif",
                    ".mp4",
                    ".webm",
                ]);
                if (reqExt && staticExtensions.has(reqExt)) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not found");
                    return;
                }

                // Fall back to index.html for SPA routing
                // Note: We don't set is404 here because the client-side router will determine
                // if the route exists. If it doesn't, the router will render the 404 page.
                filePath = path.join(staticDir, "index.html");
                // Don't set is404 = true here - let the client-side router handle it
            }
        }

        // Check if file exists (should always exist now since we fallback to index.html)
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            // This should rarely happen - only if index.html itself is missing
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("Not found");
            return;
        }

        const realStaticDir = fs.realpathSync(staticDir);
        const realFilePath = fs.realpathSync(filePath);
        if (!realFilePath.startsWith(realStaticDir + path.sep)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
            return;
        }

        // Determine content type
        const ext = path.extname(filePath);
        const contentTypes: Record<string, string> = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".mjs": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".eot": "application/vnd.ms-fontobject",
            ".webp": "image/webp",
            ".avif": "image/avif",
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".txt": "text/plain",
            ".md": "text/markdown; charset=utf-8",
            ".xml": "application/xml",
            ".wasm": "application/wasm",
        };
        const contentType = contentTypes[ext] || "application/octet-stream";

        try {
            const content = fs.readFileSync(filePath);
            let responseBody = content;
            const cleanedPathname = requestPathname.replace(/\/$/, "") || "/";
            const htmlSsrMatch = req.method === "GET" && contentType === "text/html" ? matchSSRPage(cleanedPathname) : null;

            if (!is404 && contentType === "text/html") {
                const ip = extractClientIP(req, trustProxyDepth);
                const httpCtx: HeliumContext = {
                    signal: getRequestSignal(req, res),
                    req: {
                        ip,
                        headers: req.headers,
                        url: req.url,
                        method: req.method,
                        raw: req,
                    },
                };

                const metadata = await seoRouter.resolve(req, httpCtx);
                let html = content.toString("utf-8");

                if (htmlSsrMatch) {
                    try {
                        const rendered = await renderSSRHTML({
                            htmlTemplate: html,
                            pathname: cleanedPathname,
                            search: requestUrl.search,
                            params: htmlSsrMatch.params,
                            page: htmlSsrMatch.page,
                            req,
                            ctx: httpCtx,
                            loadAppShell: appShell,
                        });

                        if ("redirect" in rendered) {
                            res.writeHead(rendered.redirect.statusCode, {
                                Location: rendered.redirect.destination,
                                "Cache-Control": "no-store",
                            });
                            res.end();
                            return;
                        }

                        html = rendered.html;
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const isBrowserGlobalError = /\bwindow is not defined\b|\bdocument is not defined\b|\bnavigator is not defined\b/i.test(message);

                        if (isBrowserGlobalError) {
                            log(
                                "warn",
                                `SSR disabled for ${cleanedPathname} due to browser-only import. Render map/browser-only modules on client only (e.g. dynamic import inside useEffect).`
                            );
                        } else {
                            log("error", `Failed to render SSR page for ${cleanedPathname}:`, error);
                            throw error;
                        }
                    }
                }

                if (metadata) {
                    html = injectSocialMetaIntoHtml(html, metadata);
                }

                // Expose runtime public env vars via window.__HELIUM__.env.
                html = injectHeliumEnvIntoHtml(html);

                responseBody = Buffer.from(html, "utf-8");
            }

            // Set status code to 404 if serving the 404 page
            const statusCode = is404 ? 404 : 200;
            res.writeHead(statusCode, { "Content-Type": contentType, ...(contentType === "text/html" ? { "Cache-Control": "no-store" } : {}) });
            res.end(req.method === "HEAD" ? undefined : responseBody);
        } catch (error) {
            log("error", "Error serving file:", error);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
        }
    });
    const server = http.createServer((req, res) => {
        trackServerRequest(server, req, res);
        void handleRequest(req, res);
    });

    // Start server
    server.listen(port, () => {
        log("info", `Production server listening on http://localhost:${port}`);
        log("info", `Serving static files from ${staticDir}`);

        // Start workers
        if (workers.length > 0) {
            log("info", `Starting ${workers.length} worker(s)...`);
            for (const { name, worker } of workers) {
                // Use export name if worker name is anonymous
                if (worker.name === "anonymous") {
                    worker.name = name;
                    worker.__id = name;
                    worker.options.name = name;
                }
                if (worker.options.autoStart) {
                    const createContext = (): HeliumContext => ({
                        signal: new AbortController().signal,
                        req: {
                            ip: "127.0.0.1",
                            headers: {},
                            url: undefined,
                            method: undefined,
                            raw: {} as http.IncomingMessage,
                        },
                    });
                    startWorker(worker, createContext).catch((err) => {
                        log("error", `Failed to start worker '${worker.name}':`, err);
                    });
                }
            }
        }
    });

    // Handle graceful shutdown
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        log("info", "Shutting down...");
        try {
            await closeProductionServer(server);
            log("info", "Server closed");
            process.exit(0);
        } catch (error) {
            log("error", "Server shutdown failed:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    server.once("close", () => {
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
    });

    return server;
}

/** @internal Stop open HTTP streams so providers receive their cancellation signal. */
export async function closeProductionServer(server: http.Server): Promise<void> {
    const requestsStopped = abortServerRequests(server);
    let closed = Promise.resolve();
    if (server.listening) {
        closed = new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        server.closeAllConnections();
    }
    await Promise.all([stopAllWorkers(), closed, requestsStopped]);
}

// ============================================================================
// Security helper functions
// ============================================================================

/**
 * Set default security headers on every HTTP response.
 */
function setSecurityHeaders(res: http.ServerResponse, config: HeliumConfig): void {
    const headers = getSecurityHeaders(config);

    for (const [name, value] of Object.entries(headers)) {
        if (value === null) {
            res.removeHeader(name);
            continue;
        }
        res.setHeader(name, value);
    }
}

/**
 * Resolve security headers for the current request from config.
 * Returns a final header map where `null` indicates the header should be removed.
 *
 * @internal
 */
export function getSecurityHeaders(config: HeliumConfig): Record<string, string | null> {
    const headers: Record<string, string | null> = {};
    const securityConfig = config.security;

    if (securityConfig?.defaultHeaders !== false) {
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["X-XSS-Protection"] = "0";
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";

        const csp = securityConfig?.contentSecurityPolicy;
        if (csp) {
            headers["Content-Security-Policy"] = csp;
        }

        if (securityConfig?.hsts !== false) {
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
        }
    }

    if (securityConfig?.headerOverrides) {
        for (const [name, value] of Object.entries(securityConfig.headerOverrides)) {
            headers[name] = value;
        }
    }

    return headers;
}

/**
 * Handle CORS headers based on configuration.
 * Default: restrict to same-origin (no CORS header = browser blocks cross-origin).
 */
function handleCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse, config: HeliumConfig): void {
    const allowedOrigins = config.security?.corsOrigins;
    if (!allowedOrigins || allowedOrigins.length === 0) {
        // No CORS configured — same-origin only by default
        return;
    }

    const origin = req.headers.origin;
    if (!origin) {
        return;
    }

    const isAllowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin);
    if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, X-Helium-Token");
        res.setHeader("Access-Control-Max-Age", "86400");

        if (!allowedOrigins.includes("*")) {
            res.setHeader("Vary", "Origin");
        }
    }
}
