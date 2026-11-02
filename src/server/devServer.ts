import type http from "http";
import type http2 from "http2";
import type https from "https";
import path from "path";
import type { ComponentType, ReactNode } from "react";

import { SEO_METADATA_RPC_METHOD } from "../runtime/internalMethods.js";
import { injectEnvToProcess, injectHeliumEnvIntoHtml, loadEnvFiles } from "../utils/envLoader.js";
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
import { getRequestSignal } from "./requestSignal.js";
import { RpcRegistry } from "./rpcRegistry.js";
import { initializeSecurity } from "./security.js";
import { SEOMetadataRouter } from "./seoMetadataRouter.js";
import { matchSSRPage, renderSSRHTML, resolveServerSideProps, SSRPageDef } from "./ssr.js";

type LoadHandlersFn = (registry: RpcRegistry, httpRouter: HTTPRouter, seoRouter: SEOMetadataRouter) => void;
type HttpServer = http.Server | https.Server | http2.Http2Server | http2.Http2SecureServer;

interface WorkerEntry {
    name: string;
    worker: HeliumWorkerDef;
}

type AppShellLoader = (() => Promise<ComponentType<{ Component: ComponentType<Record<string, unknown>>; pageProps: Record<string, unknown>; children?: ReactNode }>>) | null;

let currentRegistry: RpcRegistry | null = null;
let currentHttpRouter: HTTPRouter | null = null;
let currentSEORouter: SEOMetadataRouter | null = null;
let currentSSRPages: SSRPageDef[] = [];
let currentAppShell: AppShellLoader = null;
let rateLimiter: RateLimiter | null = null;
let currentWorkers: WorkerEntry[] = [];
let cachedDefaultMeta: Awaited<ReturnType<typeof loadDefaultSocialMetaFromHtmlFile>> | undefined;
let workerReloadPromise: Promise<void> = Promise.resolve();
const originalRequestListeners = new WeakMap<HttpServer, Function[]>();

function createWorkerContext(): HeliumContext {
    return {
        signal: new AbortController().signal,
        req: {
            ip: "127.0.0.1",
            headers: {},
            url: undefined,
            method: undefined,
            raw: {} as http.IncomingMessage,
        },
    };
}

function normalizeWorkerName(name: string, worker: HeliumWorkerDef) {
    if (worker.name !== "anonymous") {
        return;
    }

    worker.name = name;
    worker.__id = name;
    worker.options.name = name;
}

async function reloadWorkers(workers: WorkerEntry[]) {
    await stopAllWorkers();

    for (const { name, worker } of workers) {
        normalizeWorkerName(name, worker);

        if (!worker.options.autoStart) {
            continue;
        }

        startWorker(worker, createWorkerContext).catch((err) => {
            log("error", `Failed to start worker '${worker.name}':`, err);
        });
    }

    currentWorkers = workers;
}

/**
 * Attaches HeliumTS HTTP handlers and RPC endpoints to an existing HTTP server.
 * This is used in dev mode to attach to Vite's dev server.
 */
export function attachToDevServer(
    httpServer: HttpServer,
    loadHandlers: LoadHandlersFn,
    config: HeliumConfig = {},
    workers: WorkerEntry[] = [],
    ssrPages: SSRPageDef[] = [],
    appShell: AppShellLoader = null
) {
    // Load environment variables for server-side access
    const envVars = loadEnvFiles();
    injectEnvToProcess(envVars);

    // Load configuration
    const trustProxyDepth = getTrustProxyDepth(config);
    const rpcSecurity = getRpcSecurityConfig(config);
    const rpcConfig = getRpcConfig(config);
    initializeSecurity(rpcSecurity);

    // Keep live connections tracked across handler reloads.
    rateLimiter ??= new RateLimiter(rpcSecurity.maxRequestsPerWindow, rpcSecurity.rateLimitWindowMs);
    rateLimiter.configure(rpcSecurity.maxRequestsPerWindow, rpcSecurity.rateLimitWindowMs);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter({ maxBodySize: rpcConfig.maxBodySize });
    const seoRouter = new SEOMetadataRouter();
    httpRouter.setTrustProxyDepth(trustProxyDepth);
    loadHandlers(registry, httpRouter, seoRouter);
    registry.setRateLimiter(rateLimiter);
    registry.setMaxBatchSize(rpcConfig.maxBatchSize);
    currentRegistry = registry;
    currentHttpRouter = httpRouter;
    currentSEORouter = seoRouter;
    currentSSRPages = ssrPages;
    currentAppShell = appShell;
    cachedDefaultMeta = undefined;
    const getDefaultMeta = async () => {
        if (cachedDefaultMeta !== undefined) {
            return cachedDefaultMeta;
        }

        cachedDefaultMeta = await loadDefaultSocialMetaFromHtmlFile(`${process.cwd()}/index.html`);
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
    currentSEORouter = seoRouter;

    if (workers.length > 0 || currentWorkers.length > 0) {
        workerReloadPromise = workerReloadPromise
            .then(() => reloadWorkers(workers))
            .catch((error) => {
                log("error", "Failed to reload workers in dev mode", error);
            });
    }

    if (!originalRequestListeners.has(httpServer)) {
        httpServer.once("close", () => {
            rateLimiter = null;
            workerReloadPromise = workerReloadPromise.then(() => stopAllWorkers());
        });
    }

    // Security: max body size for HTTP requests
    const maxBodySize = rpcConfig.maxBodySize ?? 1_048_576;

    // Attach HTTP request handler
    // We need to intercept requests before Vite handles them
    const originalListeners = originalRequestListeners.get(httpServer) ?? httpServer.listeners("request").slice();
    originalRequestListeners.set(httpServer, originalListeners);
    httpServer.removeAllListeners("request");

    const handleRequest = withRequestErrorHandling(async (req: any, res: any) => {
        const reqUrl = new URL(req.url || "/", "http://localhost");
        const pathname = reqUrl.pathname;
        const search = reqUrl.search;

        if (pathname === "/__helium__/page-props" && req.method === "GET") {
            const pathQuery = reqUrl.searchParams.get("path") || "/";
            const targetUrl = new URL(pathQuery, "http://localhost");
            const targetPathname = targetUrl.pathname;

            const ssrMatch = matchSSRPage(targetPathname, currentSSRPages);
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

        if (currentRegistry && (await handleRpcHttpRequest(req, res, currentRegistry, { maxBodySize, trustProxyDepth }))) {
            return;
        }

        // Try HTTP handlers first
        if (currentHttpRouter) {
            const handled = await currentHttpRouter.handleRequest(req, res);
            if (handled) {
                return;
            }
        }

        let devResolvedMetadata: Awaited<ReturnType<SEOMetadataRouter["resolve"]>> = null;
        if (currentSEORouter) {
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

            devResolvedMetadata = await currentSEORouter.resolve(req, httpCtx);
        }

        const acceptsHtml = String(req.headers["accept"] || "").includes("text/html") || String(req.headers["accept"] || "") === "*/*";
        const isEligibleHtmlRequest =
            req.method === "GET" &&
            acceptsHtml &&
            path.extname(pathname) === "" &&
            !pathname.startsWith("/api") &&
            !pathname.startsWith("/webhooks") &&
            !pathname.startsWith("/@") &&
            !pathname.startsWith("/__helium__");
        const ssrMatch = isEligibleHtmlRequest ? matchSSRPage(pathname, currentSSRPages) : null;

        if (isEligibleHtmlRequest) {
            const originalWriteHead = res.writeHead.bind(res);
            const originalWrite = res.write.bind(res);
            const originalEnd = res.end.bind(res);
            const bufferedChunks: Buffer[] = [];
            let capturedContentType = "";
            let pendingWriteHead:
                | {
                      statusCode: number;
                      statusMessageOrHeaders?: string | Record<string, string | number | readonly string[]>;
                      headers?: Record<string, string | number | readonly string[]>;
                  }
                | undefined;

            const flushPendingWriteHead = () => {
                if (!pendingWriteHead) {
                    return;
                }

                const { statusCode, statusMessageOrHeaders, headers } = pendingWriteHead;

                if (typeof statusMessageOrHeaders === "string") {
                    originalWriteHead(statusCode, statusMessageOrHeaders, headers);
                    return;
                }

                originalWriteHead(statusCode, statusMessageOrHeaders);
            };

            res.writeHead = (statusCode: number, statusMessageOrHeaders?: any, headers?: any) => {
                const providedHeaders = typeof statusMessageOrHeaders === "string" ? headers : statusMessageOrHeaders;

                if (providedHeaders) {
                    if (Array.isArray(providedHeaders)) {
                        for (let i = 0; i < providedHeaders.length; i += 2) {
                            if (String(providedHeaders[i]).toLowerCase() === "content-type") {
                                capturedContentType = String(providedHeaders[i + 1] || "").toLowerCase();
                                break;
                            }
                        }
                    } else if (typeof providedHeaders === "object") {
                        const maybeContentType = providedHeaders["Content-Type"] ?? providedHeaders["content-type"];
                        if (maybeContentType) {
                            capturedContentType = String(maybeContentType).toLowerCase();
                        }
                    }
                }

                pendingWriteHead = {
                    statusCode,
                    statusMessageOrHeaders,
                    headers,
                };

                return res;
            };

            res.write = (chunk: any, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
                if (chunk !== undefined && chunk !== null) {
                    bufferedChunks.push(toBuffer(chunk, typeof encoding === "string" ? encoding : undefined));
                }

                if (typeof encoding === "function") {
                    encoding();
                } else if (typeof callback === "function") {
                    callback();
                }

                return true;
            };

            res.end = (chunk?: any, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
                if (chunk !== undefined && chunk !== null) {
                    bufferedChunks.push(toBuffer(chunk, typeof encoding === "string" ? encoding : undefined));
                }

                if (typeof encoding === "function") {
                    encoding();
                } else if (typeof callback === "function") {
                    callback();
                }

                const finalize = async () => {
                    const bodyBuffer = Buffer.concat(bufferedChunks);
                    const bodyText = bodyBuffer.toString("utf-8");
                    const contentType = capturedContentType || String(res.getHeader("content-type") || "").toLowerCase();
                    const looksLikeHtml = /^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(bodyText);

                    res.writeHead = originalWriteHead;
                    res.write = originalWrite;
                    res.end = originalEnd;

                    if (!(contentType.includes("text/html") || looksLikeHtml)) {
                        flushPendingWriteHead();
                        originalEnd(bodyBuffer);
                        return;
                    }

                    let html = bodyText;

                    if (ssrMatch) {
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
                            const rendered = await renderSSRHTML({
                                htmlTemplate: html,
                                pathname,
                                search,
                                params: ssrMatch.params,
                                page: ssrMatch.page,
                                req,
                                ctx: httpCtx,
                                loadAppShell: currentAppShell,
                            });

                            if ("redirect" in rendered) {
                                originalWriteHead(rendered.redirect.statusCode, {
                                    Location: rendered.redirect.destination,
                                    "Cache-Control": "no-store",
                                });
                                originalEnd();
                                return;
                            }

                            html = rendered.html;
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            const isBrowserGlobalError = /\bwindow is not defined\b|\bdocument is not defined\b|\bnavigator is not defined\b/i.test(message);

                            if (isBrowserGlobalError) {
                                log(
                                    "warn",
                                    `SSR disabled for ${pathname} due to browser-only import. Render map/browser-only modules on client only (e.g. dynamic import inside useEffect).`
                                );
                            } else {
                                log("error", `Failed to render SSR page for ${pathname}:`, error);
                                throw error;
                            }
                        }
                    }

                    if (devResolvedMetadata) {
                        html = injectSocialMetaIntoHtml(html, devResolvedMetadata);
                    }

                    html = injectHeliumEnvIntoHtml(html);

                    flushPendingWriteHead();
                    originalEnd(Buffer.from(html, "utf-8"));
                };

                void finalize().catch((error) => {
                    log("error", "Failed to finalize dev response:", error);
                    if (!res.headersSent) {
                        originalWriteHead(500, { "Content-Type": "text/plain" });
                    }
                    if (!res.writableEnded) {
                        originalEnd("Internal server error");
                    }
                });
                return true;
            };
        }

        // If no handler matched, pass to original Vite handlers
        for (const listener of originalListeners) {
            (listener as any)(req, res);
        }
    });
    httpServer.on("request", handleRequest);
}

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
    if (Buffer.isBuffer(chunk)) {
        return chunk;
    }

    if (chunk instanceof Uint8Array) {
        return Buffer.from(chunk);
    }

    if (typeof chunk === "string") {
        return Buffer.from(chunk, encoding);
    }

    return Buffer.from(String(chunk), encoding);
}
