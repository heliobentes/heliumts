import type http from "http";
import WebSocket from "ws";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";
import type { HeliumContext } from "./context.js";
import type { HeliumMethodDef } from "./defineMethod.js";
import type { HeliumMiddleware } from "./middleware.js";
import type { RateLimiter } from "./rateLimiter.js";

interface SocketMetadata {
    ip: string;
    req: http.IncomingMessage;
}

export class RpcRegistry {
    private methods = new Map<string, HeliumMethodDef<any, any>>();
    private middleware: HeliumMiddleware | null = null;
    private rateLimiter: RateLimiter | null = null;
    private socketMetadata = new WeakMap<WebSocket, SocketMetadata>();

    register(id: string, def: HeliumMethodDef<any, any>) {
        def.__id = id;
        this.methods.set(id, def);
    }

    setMiddleware(middleware: HeliumMiddleware) {
        this.middleware = middleware;
    }

    setRateLimiter(rateLimiter: RateLimiter) {
        this.rateLimiter = rateLimiter;
    }

    /**
     * Store metadata about a WebSocket connection.
     * Should be called when a new connection is established.
     */
    setSocketMetadata(socket: WebSocket, ip: string, req: http.IncomingMessage) {
        this.socketMetadata.set(socket, { ip, req });
    }

    private getStats(socket: WebSocket): RpcStats {
        if (!this.rateLimiter) {
            return { remainingRequests: Infinity, resetInSeconds: 0 };
        }

        const stats = this.rateLimiter.getConnectionStats(socket);
        if (!stats) {
            return { remainingRequests: 0, resetInSeconds: 0 };
        }

        const now = Date.now();
        const resetInSeconds = Math.ceil((stats.resetTimeMs - now) / 1000);

        return {
            remainingRequests: stats.remainingMessages,
            resetInSeconds: Math.max(0, resetInSeconds),
        };
    }

    async handleMessage(socket: WebSocket, raw: string) {
        let req: RpcRequest;
        try {
            req = JSON.parse(raw);
        } catch {
            return;
        }

        const def = this.methods.get(req.method);
        if (!def) {
            const res: RpcResponse = {
                id: req.id,
                ok: false,
                stats: this.getStats(socket),
                error: `Unknown method ${req.method}`,
            };
            socket.send(JSON.stringify(res));
            return;
        }

        try {
            // Build context with request metadata
            const metadata = this.socketMetadata.get(socket);
            const ctx: HeliumContext = {
                req: {
                    ip: metadata?.ip || "unknown",
                    headers: metadata?.req.headers || {},
                    url: metadata?.req.url,
                    method: metadata?.req.method,
                    raw: metadata?.req as http.IncomingMessage,
                },
            };
            let result: any;

            // Execute middleware if present
            if (this.middleware) {
                let nextCalled = false;
                await this.middleware.handler(
                    {
                        ctx,
                        type: "method",
                        methodName: req.method,
                    },
                    async () => {
                        nextCalled = true;
                        result = await def.handler(req.args, ctx);
                    }
                );

                // If next() was not called, the middleware blocked the request
                if (!nextCalled) {
                    const res: RpcResponse = {
                        id: req.id,
                        ok: false,
                        stats: this.getStats(socket),
                        error: "Request blocked by middleware",
                    };
                    socket.send(JSON.stringify(res));
                    return;
                }
            } else {
                // No middleware, execute handler directly
                result = await def.handler(req.args, ctx);
            }

            const res: RpcResponse = {
                id: req.id,
                ok: true,
                stats: this.getStats(socket),
                result,
            };
            socket.send(JSON.stringify(res));
        } catch (err: any) {
            const res: RpcResponse = {
                id: req.id,
                ok: false,
                stats: this.getStats(socket),
                error: err?.message ?? "Server error",
            };
            socket.send(JSON.stringify(res));
        }
    }
}
