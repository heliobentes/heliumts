import { decode } from "@msgpack/msgpack";

import { MAX_RPC_STREAM_FRAME_SIZE, RPC_STREAM_CONTENT_TYPE, type RpcStats, type RpcStreamFrame } from "../runtime/protocol.js";
import { createRpcRequest, isRpcStats, postRpc } from "./rpcClient.js";
import { RpcError } from "./RpcError.js";

type StreamOptions<TChunk> = {
    signal: AbortSignal;
    timeoutMs: number;
    onChunk: (chunk: TChunk) => void;
};

/** Incrementally decode bounded frames, independent of HTTP packet boundaries. */
export async function streamRpc<TArgs, TChunk>(method: string, args: TArgs, options: StreamOptions<TChunk>): Promise<RpcStats> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) {
        throw new RpcError("Streaming timeoutMs must be a positive finite number no greater than 2147483647");
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) {
        abort();
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelReader = () => {
        void reader?.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancelReader, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    const resetTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new RpcError("Streaming request timed out")), options.timeoutMs);
    };
    resetTimeout();

    try {
        controller.signal.throwIfAborted();
        const response = await postRpc("/__helium__/stream", createRpcRequest(method, args), controller.signal);
        if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== RPC_STREAM_CONTENT_TYPE || !response.body) {
            void response.body?.cancel().catch(() => {});
            throw new RpcError("Invalid streaming RPC response");
        }
        reader = response.body.getReader();
        const header = new Uint8Array(4);
        let headerSize = 0;
        let payload: Uint8Array | undefined;
        let payloadSize = 0;

        while (true) {
            controller.signal.throwIfAborted();
            const { done, value } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) {
                throw new RpcError("Streaming response ended before completion");
            }
            if (!value.byteLength) {
                continue;
            }
            resetTimeout();
            let offset = 0;
            while (offset < value.byteLength) {
                if (!payload) {
                    const count = Math.min(4 - headerSize, value.byteLength - offset);
                    header.set(value.subarray(offset, offset + count), headerSize);
                    headerSize += count;
                    offset += count;
                    if (headerSize < 4) {
                        continue;
                    }
                    const length = new DataView(header.buffer).getUint32(0);
                    if (length === 0 || length > MAX_RPC_STREAM_FRAME_SIZE) {
                        throw new RpcError("Streaming response frame exceeds the size limit or has an invalid length");
                    }
                    payload = new Uint8Array(length);
                    payloadSize = 0;
                }
                const count = Math.min(payload.byteLength - payloadSize, value.byteLength - offset);
                payload.set(value.subarray(offset, offset + count), payloadSize);
                payloadSize += count;
                offset += count;
                if (payloadSize !== payload.byteLength) {
                    continue;
                }
                let frame: RpcStreamFrame;
                try {
                    frame = decode(payload, {
                        maxStrLength: payload.byteLength,
                        maxBinLength: payload.byteLength,
                        maxArrayLength: payload.byteLength,
                        maxMapLength: payload.byteLength,
                        maxExtLength: payload.byteLength,
                    }) as RpcStreamFrame;
                } catch {
                    throw new RpcError("Invalid streaming RPC frame");
                }
                payload = undefined;
                headerSize = 0;
                controller.signal.throwIfAborted();
                if (!frame || typeof frame !== "object") {
                    throw new RpcError("Invalid streaming RPC frame");
                }
                if (frame.type === "chunk" && Object.prototype.hasOwnProperty.call(frame, "data")) {
                    options.onChunk(frame.data as TChunk);
                } else if (frame.type === "error" && typeof frame.error === "string" && isRpcStats(frame.stats)) {
                    throw new RpcError(frame.error, frame.stats);
                } else if (frame.type === "done" && isRpcStats(frame.stats)) {
                    if (offset !== value.byteLength) {
                        throw new RpcError("Unexpected data after streaming completion");
                    }
                    return frame.stats;
                } else {
                    throw new RpcError("Invalid streaming RPC frame");
                }
            }
        }
    } catch (error) {
        if (controller.signal.aborted) {
            throw controller.signal.reason;
        }
        throw error;
    } finally {
        clearTimeout(timer!);
        options.signal.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", cancelReader);
        cancelReader();
        reader?.releaseLock();
    }
}
