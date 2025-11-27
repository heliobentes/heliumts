import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import type http from "http";
import WebSocket from "ws";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";
import type { HeliumContext } from "./context.js";
import type { HeliumMethodDef } from "./defineMethod.js";
import type { HeliumMiddleware } from "./middleware.js";
import type { RateLimiter } from "./rateLimiter.js";
import { prepareForMsgpack } from "./serializer.js";

interface SocketMetadata {
    ip: string;
    req: http.IncomingMessage;
}

export interface HttpRpcResult {
    response: RpcResponse | RpcResponse[];
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

    private async processRequest(req: RpcRequest, socket: WebSocket): Promise<RpcResponse> {
        const def = this.methods.get(req.method);
        if (!def) {
            return {
                id: req.id,
                ok: false,
                stats: this.getStats(socket),
                error: `Unknown method ${req.method}`,
            };
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
                    return {
                        id: req.id,
                        ok: false,
                        stats: this.getStats(socket),
                        error: "Request blocked by middleware",
                    };
                }
            } else {
                // No middleware, execute handler directly
                result = await def.handler(req.args, ctx);
            }

            return {
                id: req.id,
                ok: true,
                stats: this.getStats(socket),
                result,
            };
        } catch (err: any) {
            return {
                id: req.id,
                ok: false,
                stats: this.getStats(socket),
                error: err?.message ?? "Server error",
            };
        }
    }

    async handleMessage(socket: WebSocket, raw: string | Buffer) {
        let req: RpcRequest | RpcRequest[];
        try {
            // Always expect MessagePack
            const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            req = msgpackDecode(buffer) as RpcRequest | RpcRequest[];
        } catch {
            return;
        }

        let response: RpcResponse | RpcResponse[];
        if (Array.isArray(req)) {
            response = await Promise.all(req.map((r) => this.processRequest(r, socket)));
        } else {
            response = await this.processRequest(req, socket);
        }

        socket.send(msgpackEncode(prepareForMsgpack(response)) as Buffer);
    }

    private async processRequestHttp(req: RpcRequest, ip: string, httpReq: http.IncomingMessage): Promise<RpcResponse> {
        const def = this.methods.get(req.method);
        if (!def) {
            return {
                id: req.id,
                ok: false,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                error: `Unknown method ${req.method}`,
            };
        }

        try {
            // Build context with request metadata
            const ctx: HeliumContext = {
                req: {
                    ip,
                    headers: httpReq.headers,
                    url: httpReq.url,
                    method: httpReq.method,
                    raw: httpReq,
                },
            };
            let result: unknown;

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

                if (!nextCalled) {
                    return {
                        id: req.id,
                        ok: false,
                        stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                        error: "Request blocked by middleware",
                    };
                }
            } else {
                result = await def.handler(req.args, ctx);
            }

            return {
                id: req.id,
                ok: true,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                result,
            };
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Server error";
            return {
                id: req.id,
                ok: false,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                error: errorMessage,
            };
        }
    }

    /**
     * Handle an HTTP-based RPC request.
     * This is an alternative to WebSocket for environments where HTTP performs better
     * (e.g., mobile networks with high latency where HTTP/2 multiplexing helps).
     */
    async handleHttpRequest(reqBody: Buffer | string, ip: string, httpReq: http.IncomingMessage): Promise<HttpRpcResult> {
        let req: RpcRequest | RpcRequest[];

        try {
            // Always expect MessagePack
            const buffer = Buffer.isBuffer(reqBody) ? reqBody : Buffer.from(reqBody);
            req = msgpackDecode(buffer) as RpcRequest | RpcRequest[];
        } catch {
            const errorResponse: RpcResponse = {
                id: "unknown",
                ok: false,
                stats: { remainingRequests: 0, resetInSeconds: 0 },
                error: "Invalid request format",
            };
            return {
                response: errorResponse,
            };
        }

        let response: RpcResponse | RpcResponse[];
        if (Array.isArray(req)) {
            response = await Promise.all(req.map((r) => this.processRequestHttp(r, ip, httpReq)));
        } else {
            response = await this.processRequestHttp(req as RpcRequest, ip, httpReq);
        }

        return { response };
    }
}
