import type { IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";

import { log } from "../utils/logger.js";
import type { HeliumHTTPDef, HTTPRequest } from "./defineHTTPRequest.js";
import type { HeliumMiddleware } from "./middleware.js";

export interface HTTPRoute {
    name: string;
    handler: HeliumHTTPDef;
}

export class HTTPRouter {
    private routes: Array<{
        method: string;
        pattern: RegExp;
        keys: string[];
        handler: HeliumHTTPDef;
    }> = [];
    private middleware: HeliumMiddleware | null = null;

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
                const httpRequest = await createHTTPRequest(req, query, params);

                let result: any;
                const httpCtx = (ctx as Record<string, unknown>) || {};

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

                if (result instanceof Response) {
                    res.statusCode = result.status;
                    result.headers.forEach((value, key) => {
                        res.setHeader(key, value);
                    });

                    if (result.body) {
                        const { Readable } = await import("stream");
                        // @ts-ignore
                        const nodeStream = Readable.fromWeb(result.body);
                        nodeStream.pipe(res);
                    } else {
                        res.end();
                    }
                    return true;
                }

                // Send response
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(result));
                return true;
            } catch (error) {
                log("error", "Error handling request:", error);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal server error" }));
                return true;
            }
        }

        return false; // No route matched
    }
}

function pathToRegex(path: string): { pattern: RegExp; keys: string[] } {
    const keys: string[] = [];
    const pattern = path
        .replace(/\/:([^/]+)/g, (_, key) => {
            keys.push(key);
            return "/([^/]+)";
        })
        .replace(/\*/g, ".*")
        .replace(/\//g, "\\/");

    return {
        pattern: new RegExp(`^${pattern}$`),
        keys,
    };
}

async function createHTTPRequest(req: IncomingMessage, query: Record<string, string | string[]>, params: Record<string, string>): Promise<HTTPRequest> {
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

    let bodyBuffer: Buffer | null = null;
    const getBody = async (): Promise<Buffer> => {
        if (bodyBuffer === null) {
            bodyBuffer = await readBody(req);
        }
        return bodyBuffer;
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
            return JSON.parse(body.toString("utf-8"));
        },
        text: async () => {
            const body = await getBody();
            return body.toString("utf-8");
        },
        formData: async () => {
            throw new Error("FormData not yet implemented");
        },
        toWebRequest: async () => {
            const protocol = (req.headers["x-forwarded-proto"] as string) || "http";
            const host = (req.headers["host"] as string) || "localhost";
            const url = `${protocol}://${host}${req.url || "/"}`;

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

            return new Request(url, {
                method: req.method,
                headers: webHeaders,
                body: body as any,
            });
        },
    };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) {
        return cookies;
    }

    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
        const [key, value] = pair.split("=").map((s) => s.trim());
        if (key && value) {
            cookies[key] = decodeURIComponent(value);
        }
    }
    return cookies;
}
