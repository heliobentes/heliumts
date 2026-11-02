// @vitest-environment node
import { encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_RPC_STREAM_FRAME_SIZE, RPC_STREAM_CONTENT_TYPE, type RpcStreamFrame } from "../../src/runtime/protocol";

const stats = { remainingRequests: 10, resetInSeconds: 60 };
function frame(value: unknown): Uint8Array<ArrayBuffer> {
    const payload = encode(value);
    const result = new Uint8Array(payload.length + 4);
    new DataView(result.buffer).setUint32(0, payload.length);
    result.set(payload, 4);
    return result;
}
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
function response(body: ReadableStream<Uint8Array>) {
    return new Response(body, { headers: { "Content-Type": RPC_STREAM_CONTENT_TYPE } });
}
function authorize(streamResponse: Response | (() => Promise<Response>)) {
    const fetch = vi.fn(async (url: string) => {
        if (url.endsWith("refresh-token")) return Response.json({ token: `${Date.now()}.test-signature` });
        return typeof streamResponse === "function" ? streamResponse() : streamResponse;
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
}
function bytesStream(parts: Uint8Array[], onCancel = vi.fn()) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            parts.forEach((part) => controller.enqueue(part));
            controller.close();
        },
        cancel: onCancel,
    });
}

describe("streaming HTTP RPC", () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("delivers an early chunk before the response completes, with no batching or replay", async () => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const cancel = vi.fn();
        const fetch = authorize(
            response(
                new ReadableStream({
                    start(c) {
                        controller = c;
                    },
                    cancel,
                })
            )
        );
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const chunks: string[] = [];
        let complete = false;
        const result = streamRpc("generate", { prompt: "Hello" }, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: (chunk: string) => chunks.push(chunk) }).then(
            (value) => {
                complete = true;
                return value;
            }
        );
        controller.enqueue(frame({ type: "chunk", data: "Hello" }));
        await vi.waitFor(() => expect(chunks).toEqual(["Hello"]));
        expect(complete).toBe(false);
        controller.enqueue(frame({ type: "done", stats }));
        expect(await result).toEqual(stats);
        expect(cancel).toHaveBeenCalledOnce();
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("/stream"))).toHaveLength(1);
    });

    it("handles fragmented prefixes and Unicode/structured payloads across arbitrary network boundaries", async () => {
        const value = { text: "Olá 👋", when: new Date("2026-01-01T00:00:00Z"), bytes: new Uint8Array([0, 1, 255]) };
        const bytes = join(frame({ type: "chunk", data: value }), frame({ type: "chunk", data: "世界" }), frame({ type: "done", stats }));
        authorize(response(bytesStream(Array.from(bytes, (byte) => new Uint8Array([byte])))));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const chunks: unknown[] = [];
        expect(await streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: (chunk) => chunks.push(chunk) })).toEqual(stats);
        expect(chunks).toEqual([value, "世界"]);
    });

    it("keeps partial data and surfaces a terminal application error without replay", async () => {
        const fetch = authorize(response(bytesStream([join(frame({ type: "chunk", data: "Partial" }), frame({ type: "error", error: "Provider unavailable", stats }))])));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const chunks: string[] = [];
        await expect(streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: (chunk: string) => chunks.push(chunk) })).rejects.toMatchObject({
            message: "Provider unavailable",
            stats,
        });
        expect(chunks).toEqual(["Partial"]);
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("/stream"))).toHaveLength(1);
    });

    it.each([
        { name: "empty frame", bytes: new Uint8Array(4), message: "invalid length" },
        {
            name: "oversized frame",
            bytes: (() => {
                const b = new Uint8Array(4);
                new DataView(b.buffer).setUint32(0, MAX_RPC_STREAM_FRAME_SIZE + 1);
                return b;
            })(),
            message: "size limit",
        },
        { name: "invalid messagepack", bytes: new Uint8Array([0, 0, 0, 1, 0xc1]), message: "Invalid streaming RPC frame" },
        { name: "invalid type", bytes: frame({ type: "unexpected" }), message: "Invalid streaming RPC frame" },
        { name: "missing chunk data", bytes: frame({ type: "chunk" }), message: "Invalid streaming RPC frame" },
        { name: "invalid stats", bytes: frame({ type: "done", stats: { remainingRequests: -1, resetInSeconds: 0 } }), message: "Invalid streaming RPC frame" },
        { name: "partial prefix", bytes: new Uint8Array([0, 0]), message: "ended before completion" },
        { name: "partial payload", bytes: new Uint8Array([0, 0, 0, 2, 0x81]), message: "ended before completion" },
        { name: "missing completion", bytes: frame({ type: "chunk", data: "partial" }), message: "ended before completion" },
        { name: "trailing frames", bytes: join(frame({ type: "done", stats }), frame({ type: "chunk", data: "late" })), message: "Unexpected data" },
        // A tiny encoded frame claiming a huge allocation must fail before allocating it.
        { name: "malicious inner array length", bytes: new Uint8Array([0, 0, 0, 5, 0xdd, 0x7f, 0xff, 0xff, 0xff]), message: "Invalid streaming RPC frame" },
    ])("rejects $name", async ({ bytes, message }) => {
        authorize(response(bytesStream([bytes])));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        await expect(streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: vi.fn() })).rejects.toThrow(message);
    });

    it("cancels an in-flight read and rejects promptly when the caller aborts", async () => {
        const cancel = vi.fn();
        authorize(response(new ReadableStream<Uint8Array>({ cancel })));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const controller = new AbortController();
        const result = streamRpc("generate", {}, { signal: controller.signal, timeoutMs: 1000, onChunk: vi.fn() }).catch((error) => error);
        await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
        await Promise.resolve();
        controller.abort();
        expect((await result).name).toBe("AbortError");
        expect(cancel).toHaveBeenCalledOnce();
    });

    it("does not make a request when already cancelled", async () => {
        const fetch = authorize(response(bytesStream([])));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const controller = new AbortController();
        controller.abort();
        await expect(streamRpc("generate", {}, { signal: controller.signal, timeoutMs: 1000, onChunk: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("applies an idle timeout and clears timers and the reader", async () => {
        vi.useFakeTimers();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const cancel = vi.fn();
        authorize(
            response(
                new ReadableStream({
                    start(c) {
                        controller = c;
                    },
                    cancel,
                })
            )
        );
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        const chunks = vi.fn();
        const result = streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: chunks }).catch((error) => error);
        await vi.advanceTimersByTimeAsync(800);
        controller.enqueue(frame({ type: "chunk", data: "live" }));
        await vi.advanceTimersByTimeAsync(800);
        expect(chunks).toHaveBeenCalledWith("live");
        expect(cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(201);
        expect((await result).message).toBe("Streaming request timed out");
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, -1, NaN, Infinity, 2_147_483_648])("rejects invalid timeoutMs=%s before requesting", async (timeoutMs) => {
        const fetch = authorize(response(bytesStream([])));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        await expect(streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs, onChunk: vi.fn() })).rejects.toThrow("positive finite");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects a non-streaming content type and cancels its body", async () => {
        const cancel = vi.fn();
        authorize(new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { "Content-Type": "text/html" } }));
        const { streamRpc } = await import("../../src/client/rpcStreaming");
        await expect(streamRpc("generate", {}, { signal: new AbortController().signal, timeoutMs: 1000, onChunk: vi.fn() })).rejects.toThrow("Invalid streaming RPC response");
        expect(cancel).toHaveBeenCalledOnce();
    });
});
