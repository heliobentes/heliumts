import type http from "http";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";
import { log } from "../utils/logger.js";
import type { HeliumContext } from "./context.js";
import type { HeliumMethodDef } from "./defineMethod.js";
import type { HeliumMiddleware } from "./middleware.js";
import type { RateLimiter } from "./rateLimiter.js";
import { trackRequestCleanup } from "./requestSignal.js";
import { decodeRpcRequest } from "./rpcDecoder.js";

export interface HttpRpcResult {
    response: RpcResponse | RpcResponse[];
}

export class PublicError extends Error {
    public readonly public = true;
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

/** Reject promptly on disconnect even when provider work has not settled yet. */
export function abortable<T>(value: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
    const promise = Promise.resolve(value);
    if (signal.aborted) {
        void promise.catch(() => {});
        return Promise.reject(signal.reason ?? new Error("Request aborted"));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(signal.reason ?? new Error("Request aborted"));
        };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (result) => {
                cleanup();
                resolve(result);
            },
            (error) => {
                cleanup();
                reject(error);
            }
        );
    });
}

export class RpcRegistry {
    private methods = new Map<string, HeliumMethodDef<any, any>>();
    private middleware: HeliumMiddleware | null = null;
    private rateLimiter: RateLimiter | null = null;
    private maxBatchSize = 20;

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
    setMaxBatchSize(size: number) {
        this.maxBatchSize = size;
    }
    getStats(ip: string): RpcStats {
        return this.rateLimiter?.getHttpStats(ip) ?? { remainingRequests: Infinity, resetInSeconds: 0 };
    }

    private async invoke(
        request: RpcRequest,
        ip: string,
        req: http.IncomingMessage,
        signal: AbortSignal,
        consume: (result: unknown, signal: AbortSignal) => Promise<void>
    ): Promise<void> {
        signal.throwIfAborted();
        const def = this.methods.get(request.method);
        if (!def) {
            throw new PublicError(`Unknown method ${request.method}`);
        }
        // A method can also stop when middleware fails while next() is running.
        // Keep the response signal alive long enough to deliver a terminal error.
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
            abort();
        }
        const activeSignal = controller.signal;
        const ctx: HeliumContext = { signal: activeSignal, req: { ip, headers: req.headers, url: req.url, method: req.method, raw: req } };
        let called = false;
        let work: Promise<void> | undefined;
        const next = (): Promise<void> => {
            if (called) {
                const error = new PublicError("Middleware next() may only be called once");
                controller.abort(error);
                const rejected = Promise.reject(error);
                void rejected.catch(() => {});
                return rejected;
            }
            called = true;
            work = (async () => {
                activeSignal.throwIfAborted();
                const pending = Promise.resolve(def.handler(request.args, ctx));
                let result: unknown;
                try {
                    result = await abortable(pending, activeSignal);
                } catch (error) {
                    if (activeSignal.aborted) {
                        void pending
                            .then(async (late) => {
                                if (isAsyncIterable(late)) {
                                    await trackRequestCleanup(req, late[Symbol.asyncIterator]().return?.());
                                }
                            })
                            .catch(() => {});
                    }
                    throw error;
                }
                await consume(result, activeSignal);
            })();
            // Middleware may call next() without returning/awaiting it. Observe
            // failures immediately, and still await the original work below.
            void work.catch(() => {});
            return work;
        };
        try {
            activeSignal.throwIfAborted();
            if (this.middleware) {
                await abortable(this.middleware.handler({ ctx, type: "method", methodName: request.method }, next), activeSignal);
                if (!called) {
                    throw new PublicError("Request blocked by middleware");
                }
            } else {
                next();
            }
            if (work) {
                await abortable(work, activeSignal);
            }
        } catch (error) {
            controller.abort(error);
            throw error;
        } finally {
            signal.removeEventListener("abort", abort);
        }
    }

    private checkRateLimit(ip: string): void {
        if (this.rateLimiter && !this.rateLimiter.checkHttpRateLimit(ip)) {
            throw new PublicError("Rate limit exceeded");
        }
    }

    async handleHttpRequest(body: Buffer | string, ip: string, req: http.IncomingMessage, signal: AbortSignal = new AbortController().signal): Promise<HttpRpcResult> {
        let value: unknown;
        try {
            value = decodeRpcRequest(body);
        } catch {
            return { response: { id: "unknown", ok: false, stats: this.getStats(ip), error: "Invalid request format" } };
        }
        const errorResponse = (input: unknown, error: string): RpcResponse => ({ id: requestId(input), ok: false, stats: this.getStats(ip), error });
        try {
            this.checkRateLimit(ip);
        } catch (error) {
            return {
                response: Array.isArray(value)
                    ? value.slice(0, this.maxBatchSize).map((item) => errorResponse(item, sanitizeErrorMessage(error)))
                    : errorResponse(value, sanitizeErrorMessage(error)),
            };
        }
        if (Array.isArray(value) && value.length > this.maxBatchSize) {
            return { response: { id: "batch", ok: false, stats: this.getStats(ip), error: `Batch size ${value.length} exceeds maximum of ${this.maxBatchSize}` } };
        }
        const process = async (input: unknown): Promise<RpcResponse> => {
            if (!isRpcRequest(input)) {
                return errorResponse(input, "Invalid request format");
            }
            try {
                let result: unknown;
                await this.invoke(input, ip, req, signal, async (value) => {
                    if (isAsyncIterable(value)) {
                        const iterator = value[Symbol.asyncIterator]();
                        void trackRequestCleanup(req, iterator.return?.()).catch(() => {});
                        throw new PublicError("This method returns a stream. Use useStreaming() instead of a unary RPC call.");
                    }
                    result = value;
                });
                return { id: input.id, ok: true, stats: this.getStats(ip), result };
            } catch (error) {
                if (!signal.aborted) {
                    log("error", `RPC method '${input.method}' failed:`, error);
                }
                return errorResponse(input, sanitizeErrorMessage(error));
            }
        };
        return { response: Array.isArray(value) ? await Promise.all(value.map(process)) : await process(value) };
    }

    async handleStreamRequest(
        body: Buffer,
        ip: string,
        req: http.IncomingMessage,
        signal: AbortSignal,
        onChunk: (value: unknown, signal: AbortSignal) => Promise<void>
    ): Promise<RpcStats> {
        let request: unknown;
        try {
            request = decodeRpcRequest(body);
        } catch {
            throw new PublicError("Invalid request format");
        }
        if (Array.isArray(request)) {
            throw new PublicError("Streaming RPC accepts one call, not a batch");
        }
        if (!isRpcRequest(request)) {
            throw new PublicError("Invalid request format");
        }
        this.checkRateLimit(ip);
        await this.invoke(request, ip, req, signal, async (result, iterationSignal) => {
            if (!isAsyncIterable(result)) {
                throw new PublicError("Streaming RPC requires a method returning an AsyncIterable. Use callMethod() for unary methods.");
            }
            const iterator = result[Symbol.asyncIterator]();
            let completed = false;
            try {
                while (!iterationSignal.aborted) {
                    const item = await abortable(iterator.next(), iterationSignal);
                    if (item.done) {
                        completed = true;
                        break;
                    }
                    iterationSignal.throwIfAborted();
                    await abortable(onChunk(item.value, iterationSignal), iterationSignal);
                }
            } finally {
                if (!completed && iterator.return) {
                    const cleanup = trackRequestCleanup(req, iterator.return());
                    if (iterationSignal.aborted) {
                        void cleanup.catch(() => {});
                    } else {
                        await abortable(cleanup, iterationSignal);
                    }
                }
            }
        });
        return this.getStats(ip);
    }
}

function requestId(value: unknown): string | number {
    if (value && typeof value === "object" && "id" in value && (typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id)))) {
        return value.id;
    }
    return "unknown";
}

function isRpcRequest(value: unknown): value is RpcRequest {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "id" in value &&
        (typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id))) &&
        "method" in value &&
        typeof value.method === "string" &&
        value.method.length > 0
    );
}

export function sanitizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : null;
    const isPublic = error instanceof PublicError || (error !== null && typeof error === "object" && "public" in error && error.public === true);
    return process.env.NODE_ENV === "production" && !isPublic ? "Server error" : message || "Server error";
}
