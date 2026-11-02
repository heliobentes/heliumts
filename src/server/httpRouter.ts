import type { IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";

import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import type { HeliumContext } from "./context.js";
import type { HeliumHTTPDef, HTTPRequest } from "./defineHTTPRequest.js";
import type { HeliumMiddleware } from "./middleware.js";
import { getRequestSignal } from "./requestSignal.js";

export interface HTTPRoute {
    name: string;
    handler: HeliumHTTPDef;
}

interface HTTPRouterOptions {
    maxBodySize?: number;
}

export class HTTPRouter {
    private routes: Array<{
        method: string;
        pattern: RegExp;
        keys: string[];
        handler: HeliumHTTPDef;
    }> = [];
    private middleware: HeliumMiddleware | null = null;
    private trustProxyDepth: number = 0;
    private maxBodySize: number;

    constructor(options: HTTPRouterOptions = {}) {
        this.maxBodySize = options.maxBodySize ?? 1_048_576;
    }

    setTrustProxyDepth(depth: number) {
        this.trustProxyDepth = depth;
    }

    registerRoutes(routes: HTTPRoute[]) {
        for (const route of routes) {
            const { method, path } = route.handler;
            const { pattern, keys } = pathToRegex(path);
            this.routes.push({
                method: method.toUpperCase(),
                pattern,
                keys,
                handler: route.handler,
            });
        }
    }

    setMiddleware(middleware: HeliumMiddleware) {
        this.middleware = middleware;
    }

    async handleRequest(req: IncomingMessage, res: ServerResponse, ctx?: unknown): Promise<boolean> {
        const method = req.method?.toUpperCase() || "GET";
        const url = parseUrl(req.url || "", true);
        const pathname = url.pathname || "/";

        for (const route of this.routes) {
            if (route.method !== "ALL" && route.method !== method) {
                continue;
            }

            const match = pathname.match(route.pattern);
            if (!match) {
                continue;
            }

            // Extract path parameters
            const params: Record<string, string> = {};
            for (let i = 0; i < route.keys.length; i++) {
                params[route.keys[i]] = match[i + 1];
            }

            try {
                const query: Record<string, string | string[]> = {};
                if (url.query) {
                    for (const [key, value] of Object.entries(url.query)) {
                        if (value !== undefined) {
                            query[key] = value;
                        }
                    }
                }
                const httpRequest = await createHTTPRequest(req, query, params, this.maxBodySize, this.trustProxyDepth, getRequestSignal(req, res));

                let result: any;
                // Build context with request metadata
                const ip = extractClientIP(req, this.trustProxyDepth);
                const httpCtx: HeliumContext = {
                    req: {
                        ip,
                        headers: req.headers,
                        url: req.url,
                        method: req.method,
                        raw: req,
                    },
                    ...(ctx as Record<string, unknown>),
                    signal: getRequestSignal(req, res),
                };

                // Execute middleware if present
                if (this.middleware) {
                    let nextCalled = false;
                    await this.middleware.handler(
                        {
                            ctx: httpCtx,
                            type: "http",
                            httpMethod: method,
                            httpPath: pathname,
                        },
                        async () => {
                            nextCalled = true;
                            result = await route.handler.handler(httpRequest, httpCtx);
                        }
                    );

                    // If next() was not called, the middleware blocked the request
                    if (!nextCalled) {
                        res.writeHead(403, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Request blocked by middleware" }));
                        return true;
                    }
                } else {
                    // No middleware, execute handler directly
                    result = await route.handler.handler(httpRequest, httpCtx);
                }

                if (isWebResponse(result)) {
                    res.statusCode = result.status;
                    result.headers.forEach((value: string, key: string) => {
                        if (key.toLowerCase() !== "set-cookie") {
                            res.setHeader(key, value);
                        }
                    });
                    // Preserve separate cookies instead of overwriting earlier
                    // values (or joining them, which breaks Expires attributes).
                    const cookies = result.headers.getSetCookie();
                    if (cookies.length > 0) {
                        res.setHeader("set-cookie", cookies);
                    }

                    if (method === "HEAD") {
                        if (result.body && typeof result.body.cancel === "function") {
                            void result.body.cancel().catch(() => {});
                        }
                        res.end();
                        return true;
                    }

                    if (result.body && typeof result.body.getReader === "function") {
                        await streamResponseBody(result.body, res);
                    } else if (result.body) {
                        const arrayBuf = await result.arrayBuffer();
                        res.end(Buffer.from(arrayBuf));
                    } else {
                        res.end();
                    }
                    return true;
                }

                // Send response
                const responseBody = JSON.stringify(result);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(responseBody);
                return true;
            } catch (error) {
                log("error", "Error handling request:", error);
                if (res.headersSent || res.destroyed || res.writableEnded) {
                    if (!res.destroyed) {
                        res.destroy();
                    }
                    return true;
                }
                const status = error instanceof HTTPRequestError ? error.status : 500;
                res.removeHeader?.("content-length");
                res.writeHead(status, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: error instanceof HTTPRequestError ? error.message : "Internal server error" }));
                return true;
            }
        }

        return false; // No route matched
    }
}

function pathToRegex(path: string): { pattern: RegExp; keys: string[] } {
    const keys: string[] = [];
    const pattern = path
        .split("/")
        .map((segment) => {
            if (segment.startsWith(":") && segment.length > 1) {
                keys.push(segment.slice(1));
                return "([^/]+)";
            }
            if (segment === "**") {
                return ".*";
            }
            return segment
                .split("*")
                .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("[^/]*");
        })
        // * matches a single path segment, /** matches across segments.
        .join("/");

    return {
        pattern: new RegExp(`^${pattern}$`),
        keys,
    };
}

async function createHTTPRequest(
    req: IncomingMessage,
    query: Record<string, string | string[]>,
    params: Record<string, string>,
    maxBodySize: number,
    trustProxyDepth: number,
    signal: AbortSignal
): Promise<HTTPRequest> {
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        headers[key.toLowerCase()] = value;
    }

    const cookies = parseCookies(req.headers.cookie || "");

    // Normalize query to always be string
    const normalizedQuery: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
        normalizedQuery[key] = Array.isArray(value) ? value[0] : value;
    }

    let bodyPromise: Promise<Buffer> | undefined;
    const getBody = (): Promise<Buffer> => {
        bodyPromise ??= readBody(req, maxBodySize);
        return bodyPromise;
    };

    return {
        method: req.method || "GET",
        path: req.url || "/",
        headers,
        query: normalizedQuery,
        params,
        cookies,
        json: async () => {
            const body = await getBody();
            try {
                return JSON.parse(body.toString("utf-8"));
            } catch {
                throw new HTTPRequestError(400, "Invalid JSON in request body");
            }
        },
        text: async () => {
            const body = await getBody();
            return body.toString("utf-8");
        },
        formData: async () => {
            throw new Error("FormData not yet implemented");
        },
        /**
         * Convert the normalized HTTPRequest into a standard Web `Request`.
         * This mirrors the shape used in defineHTTPRequest's interface and
         * is useful for passing the request into code that expects the Web
         * Fetch Request API (for example third-party handlers or libraries).
         */
        toWebRequest: async () => {
            let protocol = (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
            const forwardedProto = req.headers["x-forwarded-proto"];
            if (Number.isInteger(trustProxyDepth) && trustProxyDepth > 0 && typeof forwardedProto === "string") {
                const protocols = forwardedProto.split(",").map((value) => value.trim().toLowerCase());
                const trustedProtocol = protocols.length === 1 ? protocols[0] : protocols[protocols.length - trustProxyDepth];
                if (trustedProtocol === "https" || trustedProtocol === "http") {
                    protocol = trustedProtocol;
                }
            }
            const host = (req.headers["host"] as string) || "localhost";
            const requestPath = parseUrl(req.url || "/").path || "/";
            const url = `${protocol}://${host}${requestPath}`;

            const webHeaders = new Headers();
            for (const [key, value] of Object.entries(headers)) {
                if (value === undefined) {
                    continue;
                }
                if (Array.isArray(value)) {
                    for (const v of value) {
                        webHeaders.append(key, v);
                    }
                } else {
                    webHeaders.set(key, value);
                }
            }

            const body = req.method !== "GET" && req.method !== "HEAD" ? await getBody() : undefined;
            const requestBody = body ? Uint8Array.from(body).buffer : undefined;

            return new Request(url, {
                method: req.method,
                signal,
                headers: webHeaders,
                body: requestBody,
            });
        },
    };
}

class HTTPRequestError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

function readBody(req: IncomingMessage, maxBytes: number = 1_048_576): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        let failed = false;
        const fail = (error: Error) => {
            failed = true;
            chunks.length = 0;
            reject(error);
        };
        req.on("data", (chunk) => {
            if (failed) {
                return;
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalSize += buffer.length;
            if (totalSize > maxBytes) {
                fail(new HTTPRequestError(413, "Request entity too large"));
                return;
            }
            chunks.push(buffer);
        });
        req.on("end", () => {
            if (!failed) {
                resolve(Buffer.concat(chunks));
            }
        });
        req.on("error", fail);
        req.on("aborted", () => fail(new HTTPRequestError(400, "Request body was aborted")));
    });
}

function parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) {
        return cookies;
    }

    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
        const separator = pair.indexOf("=");
        if (separator === -1) {
            continue;
        }
        const key = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (key) {
            try {
                cookies[key] = decodeURIComponent(value);
            } catch {
                // Malformed encoding (e.g. %ZZ) — use raw value
                cookies[key] = value;
            }
        }
    }
    return cookies;
}

async function streamResponseBody(body: ReadableStream<Uint8Array>, res: ServerResponse): Promise<void> {
    const reader = body.getReader();
    let closed = res.destroyed;
    const onClose = () => {
        closed = true;
        void reader.cancel().catch(() => {});
    };
    res.on?.("close", onClose);
    res.on?.("error", onClose);
    try {
        if (closed) {
            await reader.cancel();
        }
        while (!closed) {
            const { done, value } = await reader.read();
            if (done || closed) {
                break;
            }
            if (res.write(value) === false) {
                await new Promise<void>((resolve, reject) => {
                    const cleanup = () => {
                        res.off("drain", onDrain);
                        res.off("close", onDrain);
                        res.off("error", onError);
                    };
                    const onDrain = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = (error: Error) => {
                        cleanup();
                        reject(error);
                    };
                    res.once("drain", onDrain);
                    res.once("close", onDrain);
                    res.once("error", onError);
                });
            }
        }
        if (!closed) {
            res.end();
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        res.off?.("close", onClose);
        res.off?.("error", onClose);
        reader.releaseLock();
    }
}

/**
 * Detect a Web `Response` object using duck-typing instead of `instanceof`.
 *
 * In Vite's SSR environment the handler code runs inside a separate module
 * context (`ssrLoadModule`), so the `Response` constructor available there
 * may be a *different reference* than the global `Response` that
 * `httpRouter.ts` sees.  The classic `instanceof Response` check therefore
 * fails, causing the framework to fall through to `JSON.stringify(result)`
 * which serialises a Response into a tiny broken payload (~126 bytes).
 *
 * By checking for the characteristic properties (`status`, `headers` as a
 * `Headers`-like object, and `arrayBuffer` method) we reliably detect
 * Response objects regardless of which realm they were created in.
 */
function isWebResponse(value: unknown): value is Response {
    if (value instanceof Response) {
        return true;
    }

    if (typeof value !== "object" || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.status === "number" &&
        typeof candidate.arrayBuffer === "function" &&
        typeof candidate.headers === "object" &&
        candidate.headers !== null &&
        typeof (candidate.headers as Record<string, unknown>).forEach === "function"
    );
}
