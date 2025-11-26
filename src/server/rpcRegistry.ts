import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
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

export interface HttpRpcResult {
    response: RpcResponse;
    encoding: "json" | "msgpack";
}

export class RpcRegistry {
    private methods = new Map<string, HeliumMethodDef<any, any>>();
    private middleware: HeliumMiddleware | null = null;
    private rateLimiter: RateLimiter | null = null;
    private socketMetadata = new WeakMap<WebSocket, SocketMetadata>();
    private rpcEncoding: "json" | "msgpack" = "msgpack";

    register(id: string, def: HeliumMethodDef<any, any>) {
        def.__id = id;
        this.methods.set(id, def);
    }

    setRpcEncoding(encoding: "json" | "msgpack") {
        this.rpcEncoding = encoding;
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

    async handleMessage(socket: WebSocket, raw: string | Buffer) {
        let req: RpcRequest;
        try {
            // Handle both binary (MessagePack) and text (JSON) messages
            if (Buffer.isBuffer(raw)) {
                req = msgpackDecode(raw) as RpcRequest;
            } else {
                req = JSON.parse(raw);
            }
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
            if (this.rpcEncoding === "msgpack") {
                socket.send(msgpackEncode(res) as Buffer);
            } else {
                socket.send(JSON.stringify(res));
            }
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
                    if (this.rpcEncoding === "msgpack") {
                        socket.send(msgpackEncode(res) as Buffer);
                    } else {
                        socket.send(JSON.stringify(res));
                    }
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
            if (this.rpcEncoding === "msgpack") {
                socket.send(msgpackEncode(res) as Buffer);
            } else {
                socket.send(JSON.stringify(res));
            }
        } catch (err: any) {
            const res: RpcResponse = {
                id: req.id,
                ok: false,
                stats: this.getStats(socket),
                error: err?.message ?? "Server error",
            };
            if (this.rpcEncoding === "msgpack") {
                socket.send(msgpackEncode(res) as Buffer);
            } else {
                socket.send(JSON.stringify(res));
            }
        }
    }

    /**
     * Handle an HTTP-based RPC request.
     * This is an alternative to WebSocket for environments where HTTP performs better
     * (e.g., mobile networks with high latency where HTTP/2 multiplexing helps).
     */
    async handleHttpRequest(reqBody: Buffer | string, ip: string, httpReq: http.IncomingMessage): Promise<HttpRpcResult> {
        let req: RpcRequest;
        let useMsgpack = false;

        try {
            // Check content type to determine encoding
            const contentType = httpReq.headers["content-type"] || "";
            if (contentType.includes("application/msgpack")) {
                const buffer = Buffer.isBuffer(reqBody) ? reqBody : Buffer.from(reqBody);
                req = msgpackDecode(buffer) as RpcRequest;
                useMsgpack = true;
            } else {
                const str = Buffer.isBuffer(reqBody) ? reqBody.toString() : reqBody;
                req = JSON.parse(str);
            }
        } catch {
            const errorResponse: RpcResponse = {
                id: "unknown",
                ok: false,
                stats: { remainingRequests: 0, resetInSeconds: 0 },
                error: "Invalid request format",
            };
            return {
                response: errorResponse,
                encoding: useMsgpack ? "msgpack" : "json",
            };
        }

        const def = this.methods.get(req.method);
        if (!def) {
            const res: RpcResponse = {
                id: req.id,
                ok: false,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                error: `Unknown method ${req.method}`,
            };
            return { response: res, encoding: useMsgpack ? "msgpack" : "json" };
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
                    const res: RpcResponse = {
                        id: req.id,
                        ok: false,
                        stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                        error: "Request blocked by middleware",
                    };
                    return { response: res, encoding: useMsgpack ? "msgpack" : "json" };
                }
            } else {
                result = await def.handler(req.args, ctx);
            }

            const res: RpcResponse = {
                id: req.id,
                ok: true,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                result,
            };
            return { response: res, encoding: useMsgpack ? "msgpack" : "json" };
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Server error";
            const res: RpcResponse = {
                id: req.id,
                ok: false,
                stats: { remainingRequests: Infinity, resetInSeconds: 0 },
                error: errorMessage,
            };
            return { response: res, encoding: useMsgpack ? "msgpack" : "json" };
        }
    }
}
