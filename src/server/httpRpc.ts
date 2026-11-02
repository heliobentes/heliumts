import { encode } from "@msgpack/msgpack";
import type { IncomingMessage, ServerResponse } from "http";

import { MAX_RPC_STREAM_FRAME_SIZE, RPC_STREAM_CONTENT_TYPE, type RpcStreamFrame } from "../runtime/protocol.js";
import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import { compressHttpRpcResponse } from "./httpCompression.js";
import { getRequestSignal } from "./requestSignal.js";
import { PublicError, RpcRegistry, sanitizeErrorMessage } from "./rpcRegistry.js";
import { generateConnectionToken, verifyConnectionToken } from "./security.js";
import { prepareForMsgpack } from "./serializer.js";

class BodyError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

async function readBody(req: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
    if (Number(req.headers["content-length"]) > maxBytes) {
        req.resume();
        throw new BodyError(413, "Request entity too large");
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const cleanup = () => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
            signal.removeEventListener("abort", onAbort);
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const onAbort = () => onError(new BodyError(400, "Request aborted"));
        const onEnd = () => {
            cleanup();
            resolve(Buffer.concat(chunks));
        };
        const onData = (chunk: Buffer | string) => {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += data.length;
            if (size > maxBytes) {
                chunks.length = 0;
                onError(new BodyError(413, "Request entity too large"));
                req.resume();
            } else {
                chunks.push(data);
            }
        };
        req.on("data", onData);
        req.once("end", onEnd);
        req.once("error", onError);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
        }
    });
}

/** Frame boundaries are independent of HTTP chunk boundaries. */
export async function writeStreamFrame(res: ServerResponse, frame: RpcStreamFrame, signal: AbortSignal): Promise<void> {
    if (signal.aborted || res.destroyed) {
        throw signal.reason ?? new Error("Request aborted");
    }
    const payload = encode(prepareForMsgpack(frame));
    if (payload.byteLength > MAX_RPC_STREAM_FRAME_SIZE) {
        throw new PublicError("Stream frame exceeds the 10 MiB limit");
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.byteLength);
    if (!res.write(Buffer.concat([header, payload]))) {
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                res.off("drain", onDrain);
                res.off("error", onError);
                signal.removeEventListener("abort", onAbort);
            };
            const onDrain = () => {
                cleanup();
                resolve();
            };
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };
            const onAbort = () => onError(signal.reason ?? new Error("Request aborted"));
            res.once("drain", onDrain);
            res.once("error", onError);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) {
                onAbort();
            }
        });
    }
}

export async function handleRpcHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    registry: RpcRegistry,
    options: { maxBodySize: number; trustProxyDepth: number }
): Promise<boolean> {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (!["/__helium__/refresh-token", "/__helium__/rpc", "/__helium__/stream"].includes(pathname)) {
        return false;
    }
    const jsonError = (status: number, error: string) => {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: false, error }));
    };
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        jsonError(405, "Method not allowed");
        return true;
    }
    if (pathname === "/__helium__/refresh-token") {
        if (!req.headers["x-requested-with"]) {
            jsonError(403, "Forbidden");
        } else {
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ token: generateConnectionToken() }));
        }
        return true;
    }
    const token = req.headers["x-helium-token"];
    if (typeof token !== "string" || !verifyConnectionToken(token)) {
        jsonError(401, "Unauthorized");
        return true;
    }
    const signal = getRequestSignal(req, res);
    let body: Buffer;
    try {
        body = await readBody(req, options.maxBodySize, signal);
    } catch (error) {
        if (!signal.aborted && !res.destroyed) {
            jsonError(error instanceof BodyError ? error.status : 400, error instanceof BodyError ? error.message : "Invalid request body");
        }
        return true;
    }
    const ip = extractClientIP(req, options.trustProxyDepth);
    if (pathname === "/__helium__/stream") {
        res.removeHeader("Content-Encoding");
        res.removeHeader("Content-Length");
        res.writeHead(200, { "Content-Type": RPC_STREAM_CONTENT_TYPE, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        try {
            const stats = await registry.handleStreamRequest(body, ip, req, signal, (data, chunkSignal) => writeStreamFrame(res, { type: "chunk", data }, chunkSignal));
            await writeStreamFrame(res, { type: "done", stats }, signal);
        } catch (error) {
            if (!signal.aborted && !res.destroyed) {
                log("error", "Streaming RPC failed:", error);
                try {
                    await writeStreamFrame(res, { type: "error", error: sanitizeErrorMessage(error), stats: registry.getStats(ip) }, signal);
                } catch {
                    if (!res.destroyed) {
                        res.destroy();
                    }
                }
            }
        } finally {
            if (!signal.aborted && !res.destroyed) {
                res.end();
            }
        }
        return true;
    }
    try {
        const result = await registry.handleHttpRequest(body, ip, req, signal);
        if (signal.aborted) {
            return true;
        }
        const compressed = await compressHttpRpcResponse(Buffer.from(encode(prepareForMsgpack(result.response))), req.headers["accept-encoding"]);
        if (signal.aborted) {
            return true;
        }
        res.writeHead(200, { "Content-Type": "application/msgpack", "Cache-Control": "no-store", ...(compressed.encoding ? { "Content-Encoding": compressed.encoding } : {}) });
        res.end(compressed.body);
    } catch (error) {
        if (!signal.aborted && !res.destroyed) {
            log("error", "HTTP RPC failed:", error);
            jsonError(500, "Internal server error");
        }
    }
    return true;
}
