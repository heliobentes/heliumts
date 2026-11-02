// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import { expect, it, vi } from "vitest";
import { MAX_RPC_STREAM_FRAME_SIZE } from "../../src/runtime/protocol";
import { defineMethod } from "../../src/server/defineMethod";
import { writeStreamFrame } from "../../src/server/httpRpc";
import { RpcRegistry } from "../../src/server/rpcRegistry";

function response(write = vi.fn((_chunk: Buffer) => true)) {
    return Object.assign(new EventEmitter(), { destroyed: false, write }) as unknown as ServerResponse;
}
const req = { headers: {}, method: "POST", url: "/__helium__/stream" } as IncomingMessage;
const request = Buffer.from(encode({ id: 1, method: "stream" }));

it("writes a big-endian byte length and a privacy-safe MessagePack frame", async () => {
    const write = vi.fn((_chunk: Buffer) => true);
    const res = response(write);
    await writeStreamFrame(res, { type: "chunk", data: { secret: "do-not-send", toJSON: () => ({ visible: "safe" }) } }, new AbortController().signal);
    const body = write.mock.calls[0][0] as Buffer;
    expect(body.readUInt32BE()).toBe(body.length - 4);
    expect(decode(body.subarray(4))).toEqual({ type: "chunk", data: { visible: "safe" } });
    expect(body.includes(Buffer.from("do-not-send"))).toBe(false);
    // Arbitrary HTTP chunk splits do not affect the wire format.
    const pieces = Array.from(body, (byte) => Buffer.from([byte]));
    expect(decode(Buffer.concat(pieces).subarray(4))).toEqual({ type: "chunk", data: { visible: "safe" } });
});

it("waits for drain and releases listeners on cancellation", async () => {
    const res = response(vi.fn((_chunk: Buffer) => false));
    const controller = new AbortController();
    let settled = false;
    const pending = writeStreamFrame(res, { type: "chunk", data: "first" }, controller.signal).then(() => {
        settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(res.listenerCount("drain")).toBe(1);
    res.emit("drain");
    await pending;
    expect(settled).toBe(true);
    expect(res.listenerCount("drain")).toBe(0);
    const next = writeStreamFrame(res, { type: "chunk", data: "next" }, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(next).rejects.toThrow("cancelled");
    expect(res.listenerCount("drain")).toBe(0);
    expect(res.listenerCount("error")).toBe(0);
});

it("rejects oversized frames before writing bytes", async () => {
    const write = vi.fn((_chunk: Buffer) => true);
    await expect(writeStreamFrame(response(write), { type: "chunk", data: "x".repeat(MAX_RPC_STREAM_FRAME_SIZE) }, new AbortController().signal)).rejects.toThrow("10 MiB");
    expect(write).not.toHaveBeenCalled();
});

it("does not pull the next iterator chunk while a write is backpressured", async () => {
    const registry = new RpcRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let pulls = 0;
    registry.register(
        "stream",
        defineMethod(async function* () {
            pulls++;
            yield 1;
            pulls++;
            yield 2;
        })
    );
    const chunks: unknown[] = [];
    const pending = registry.handleStreamRequest(request, "test", req, new AbortController().signal, async (value) => {
        chunks.push(value);
        if (value === 1) await gate;
    });
    await vi.waitFor(() => expect(chunks).toEqual([1]));
    expect(pulls).toBe(1);
    release();
    await pending;
    expect(chunks).toEqual([1, 2]);
});

it("interrupts a pending next and calls return without waiting for an uncooperative iterator", async () => {
    const registry = new RpcRegistry();
    const next = vi.fn(() => new Promise<IteratorResult<unknown>>(() => {}));
    const close = vi.fn(async () => ({ done: true, value: undefined }));
    registry.register(
        "stream",
        defineMethod(() => ({ [Symbol.asyncIterator]: () => ({ next, return: close }) }))
    );
    const controller = new AbortController();
    const pending = registry.handleStreamRequest(request, "test", req, controller.signal, async () => {});
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(close).toHaveBeenCalledOnce();
});

it("closes an iterator returned by asynchronous setup after cancellation", async () => {
    const registry = new RpcRegistry();
    let finish!: (value: AsyncIterable<unknown>) => void;
    const close = vi.fn(async () => ({ done: true, value: undefined }));
    registry.register(
        "stream",
        defineMethod(
            () =>
                new Promise<AsyncIterable<unknown>>((resolve) => {
                    finish = resolve;
                })
        )
    );
    const controller = new AbortController();
    const pending = registry.handleStreamRequest(request, "test", req, controller.signal, async () => {});
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    finish({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: "late" }), return: close }) });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("observes a rejected promise even when cancellation preceded abortable", async () => {
    const { abortable } = await import("../../src/server/rpcRegistry");
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    await expect(abortable(Promise.reject(new Error("late private rejection")), controller.signal)).rejects.toThrow("already cancelled");
    await new Promise<void>((resolve) => setImmediate(resolve));
});

it("does not invoke middleware or a handler after cancellation", async () => {
    const registry = new RpcRegistry();
    const handler = vi.fn(async function* () {
        yield 1;
    });
    const middleware = vi.fn(async (_ctx, next) => next());
    registry.register("stream", defineMethod(handler));
    registry.setMiddleware({ __kind: "middleware", handler: middleware });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(registry.handleStreamRequest(request, "test", req, controller.signal, async () => {})).rejects.toThrow("cancelled");
    expect(handler).not.toHaveBeenCalled();
    expect(middleware).not.toHaveBeenCalled();
});

it("awaits iterator consumption when middleware calls next without returning it", async () => {
    const registry = new RpcRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const chunks: unknown[] = [];
    registry.register(
        "stream",
        defineMethod(async function* () {
            yield 1;
            await gate;
            yield 2;
        })
    );
    registry.setMiddleware({
        __kind: "middleware",
        handler: (_ctx, next) => {
            void next();
        },
    });
    let finished = false;
    const pending = registry
        .handleStreamRequest(request, "test", req, new AbortController().signal, async (value) => {
            chunks.push(value);
        })
        .then(() => {
            finished = true;
        });
    await vi.waitFor(() => expect(chunks).toEqual([1]));
    expect(finished).toBe(false);
    release();
    await pending;
    expect(chunks).toEqual([1, 2]);
    expect(finished).toBe(true);
});

it("cancels in-flight iterator work if middleware fails while next is running", async () => {
    const registry = new RpcRegistry();
    let first!: () => void;
    let finish!: () => void;
    const firstChunk = new Promise<void>((resolve) => {
        first = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const chunks: unknown[] = [];
    registry.register(
        "stream",
        defineMethod(async function* (_args: unknown, ctx) {
            try {
                yield 1;
                await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
                yield 2;
            } finally {
                finish();
            }
        })
    );
    registry.setMiddleware({
        __kind: "middleware",
        handler: async (_ctx, next) => {
            void next();
            await firstChunk;
            throw new Error("middleware failed");
        },
    });
    const pending = registry.handleStreamRequest(request, "test", req, new AbortController().signal, async (value) => {
        chunks.push(value);
        first();
    });
    await expect(pending).rejects.toThrow("middleware failed");
    await cleanup;
    expect(chunks).toEqual([1]);
});

it("observes duplicate next rejections and aborts tracked work", async () => {
    const registry = new RpcRegistry();
    const chunks: unknown[] = [];
    const handler = vi.fn(async function* () {
        yield "private";
    });
    registry.register("stream", defineMethod(handler));
    registry.setMiddleware({
        __kind: "middleware",
        handler: (_ctx, next) => {
            void next();
            void next();
        },
    });
    await expect(
        registry.handleStreamRequest(request, "test", req, new AbortController().signal, async (value) => {
            chunks.push(value);
        })
    ).rejects.toThrow("next() may only be called once");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledOnce();
    expect(chunks).toEqual([]);
});
