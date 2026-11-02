// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { once } from "events";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RPC_STREAM_FRAME_SIZE, RPC_STREAM_CONTENT_TYPE, type RpcStreamFrame } from "../../src/runtime/protocol";
import type { HeliumConfig } from "../../src/server/config";
import type { HeliumContext } from "../../src/server/context";
import { attachToDevServer } from "../../src/server/devServer";
import { defineMethod } from "../../src/server/defineMethod";
import type { HeliumMiddleware } from "../../src/server/middleware";
import { startProdServer } from "../../src/server/prodServer";
import { PublicError, type RpcRegistry } from "../../src/server/rpcRegistry";

let server: http.Server | undefined;
let fixture: string | undefined;
beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
    vi.unstubAllEnvs();
    if (server?.listening)
        await new Promise<void>((resolve) => {
            server!.closeAllConnections();
            server!.close(() => resolve());
        });
    if (fixture) {
        fs.rmSync(fixture, { recursive: true, force: true });
        fixture = undefined;
    }
});
async function start(mode: string, register: (registry: RpcRegistry) => void, config: HeliumConfig = {}) {
    if (mode === "development") {
        server = http.createServer((_req, res) => res.end("vite"));
        attachToDevServer(server, register, config);
        server.listen(0);
    } else {
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), "helium-stream-"));
        server = startProdServer({ port: 0, staticDir: fixture, registerHandlers: register, config });
    }
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const auth = await fetch(`${base}/__helium__/refresh-token`, { method: "POST", headers: { "X-Requested-With": "helium" } });
    const { token } = (await auth.json()) as { token: string };
    const request = (method: string, args?: unknown, options: RequestInit = {}, endpoint = "stream") =>
        fetch(`${base}/__helium__/${endpoint}`, { method: "POST", ...options, headers: { "X-Helium-Token": token, ...options.headers }, body: encode({ id: 1, method, args }) });
    return { base, token, request };
}
function frames(response: Response) {
    const reader = response.body!.getReader();
    let pending = Buffer.alloc(0);
    return {
        reader,
        next: async (): Promise<RpcStreamFrame | null> => {
            for (;;) {
                if (pending.length >= 4) {
                    const size = pending.readUInt32BE();
                    expect(size).toBeGreaterThan(0);
                    expect(size).toBeLessThanOrEqual(MAX_RPC_STREAM_FRAME_SIZE);
                    if (pending.length >= size + 4) {
                        const frame = decode(pending.subarray(4, size + 4)) as RpcStreamFrame;
                        pending = pending.subarray(size + 4);
                        return frame;
                    }
                }
                const { value, done } = await reader.read();
                if (done) {
                    expect(pending.length).toBe(0);
                    return null;
                }
                pending = Buffer.concat([pending, value]);
            }
        },
    };
}
for (const mode of ["development", "production"])
    describe(`${mode} streaming RPC`, () => {
        it("delivers a typed early chunk before the generator finishes, then done stats", async () => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let finished = false;
            const { request } = await start(mode, (registry) =>
                registry.register(
                    "stream",
                    defineMethod(async function* (_args: unknown, ctx) {
                        expect(ctx.signal).toBeInstanceOf(AbortSignal);
                        yield { text: "first", index: 0 };
                        await gate;
                        finished = true;
                        yield { text: "second", index: 1 };
                    })
                )
            );
            const result = await request("stream");
            expect(result.headers.get("content-type")).toBe(RPC_STREAM_CONTENT_TYPE);
            expect(result.headers.get("cache-control")).toBe("no-store, no-transform");
            expect(result.headers.get("x-accel-buffering")).toBe("no");
            expect(result.headers.has("content-encoding")).toBe(false);
            const stream = frames(result);
            try {
                expect(await stream.next()).toEqual({ type: "chunk", data: { text: "first", index: 0 } });
                expect(finished).toBe(false);
            } finally {
                release();
            }
            expect(await stream.next()).toEqual({ type: "chunk", data: { text: "second", index: 1 } });
            expect(await stream.next()).toMatchObject({ type: "done", stats: { remainingRequests: expect.any(Number) } });
            expect(await stream.next()).toBe(null);
        });
        it("aborts pending provider work and executes finally when the reader cancels", async () => {
            let finalized!: () => void;
            const cleanup = new Promise<void>((resolve) => {
                finalized = resolve;
            });
            let signal: AbortSignal | undefined;
            const { request } = await start(mode, (registry) =>
                registry.register(
                    "stream",
                    defineMethod(async function* (_args: unknown, ctx) {
                        signal = ctx.signal;
                        try {
                            yield "first";
                            await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
                        } finally {
                            finalized();
                        }
                    })
                )
            );
            const response = await request("stream");
            const stream = frames(response);
            expect(await stream.next()).toEqual({ type: "chunk", data: "first" });
            await stream.reader.cancel();
            await cleanup;
            expect(signal!.aborted).toBe(true);
        });
        it("applies middleware throughout iteration and frames sanitized errors after chunks", async () => {
            vi.stubEnv("NODE_ENV", "production");
            const { request } = await start(mode, (registry) => {
                registry.register(
                    "stream",
                    defineMethod(async function* (_args: unknown, ctx) {
                        yield ctx.user;
                        throw new Error("private database details");
                    })
                );
                registry.setMiddleware({
                    __kind: "middleware",
                    handler: async ({ ctx }, next) => {
                        ctx.user = "authenticated";
                        await next();
                    },
                });
            });
            const stream = frames(await request("stream"));
            expect(await stream.next()).toEqual({ type: "chunk", data: "authenticated" });
            expect(await stream.next()).toMatchObject({ type: "error", error: "Server error", stats: expect.any(Object) });
            expect(await stream.next()).toBe(null);
        });
        it("blocks middleware, batches, plain results, and keeps unary guidance public", async () => {
            const { request, base, token } = await start(mode, (registry) => {
                registry.register(
                    "plain",
                    defineMethod(() => "value")
                );
                registry.register(
                    "stream",
                    defineMethod(async function* () {
                        yield 1;
                    })
                );
                registry.register(
                    "blocked",
                    defineMethod(async function* () {
                        yield "private";
                    })
                );
                registry.setMiddleware({
                    __kind: "middleware",
                    handler: async (context, next) => {
                        if (context.methodName !== "blocked") await next();
                    },
                });
            });
            for (const [method, error] of [
                ["plain", "AsyncIterable"],
                ["blocked", "blocked by middleware"],
            ]) {
                const stream = frames(await request(method));
                expect(await stream.next()).toMatchObject({ type: "error", error: expect.stringContaining(error) });
                expect(await stream.next()).toBe(null);
            }
            const batch = await fetch(`${base}/__helium__/stream`, { method: "POST", headers: { "X-Helium-Token": token }, body: encode([{ id: 1, method: "stream" }]) });
            expect(await frames(batch).next()).toMatchObject({ type: "error", error: expect.stringContaining("not a batch") });
            const unary = await request("stream", undefined, {}, "rpc");
            expect(decode(new Uint8Array(await unary.arrayBuffer()))).toMatchObject({ ok: false, error: expect.stringContaining("useStreaming") });
        });
        it("protects streams with tokens, body limits, and a rate window shared with unary RPC", async () => {
            const { base, request, token } = await start(
                mode,
                (registry) =>
                    registry.register(
                        "stream",
                        defineMethod(async function* () {
                            yield 1;
                        })
                    ),
                { rpc: { maxBodySize: 256, security: { maxRequestsPerWindow: 1 } } }
            );
            expect((await fetch(`${base}/__helium__/stream`, { method: "POST", body: "body" })).status).toBe(401);
            expect((await fetch(`${base}/__helium__/stream`, { method: "POST", headers: { "X-Helium-Token": token }, body: "x".repeat(257) })).status).toBe(413);
            expect(await frames(await request("stream")).next()).toEqual({ type: "chunk", data: 1 });
            const rate = frames(await request("stream"));
            expect(await rate.next()).toMatchObject({ type: "error", error: "Rate limit exceeded" });
            const unary = await request("stream", undefined, {}, "rpc");
            expect(decode(new Uint8Array(await unary.arrayBuffer()))).toMatchObject({ ok: false, error: "Rate limit exceeded" });
        });
    });

it("production shutdown aborts open provider work, runs finally, and removes signal listeners", async () => {
    const { closeProductionServer } = await import("../../src/server/prodServer");
    let finish!: () => void;
    let finalized = false;
    let providerSignal: AbortSignal | undefined;
    const cleanup = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const before = process.listenerCount("SIGTERM");
    const { request } = await start("production", (registry) =>
        registry.register(
            "stream",
            defineMethod(async function* (_args: unknown, ctx) {
                providerSignal = ctx.signal;
                try {
                    yield "first";
                    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
                } finally {
                    await new Promise<void>((resolve) => setTimeout(resolve, 20));
                    finalized = true;
                    finish();
                }
            })
        )
    );
    const result = await request("stream");
    const stream = frames(result);
    expect(await stream.next()).toEqual({ type: "chunk", data: "first" });
    const closing = closeProductionServer(server!);
    expect(providerSignal!.aborted).toBe(true);
    await closing;
    expect(finalized).toBe(true);
    await cleanup;
    expect(providerSignal!.aborted).toBe(true);
    expect(server!.listening).toBe(false);
    expect(process.listenerCount("SIGTERM")).toBe(before);
    await stream.reader.cancel().catch(() => {});
});

it("frames duplicate unawaited middleware next as one terminal error", async () => {
    const { request } = await start("production", (registry) => {
        registry.register(
            "stream",
            defineMethod(async function* () {
                yield "should not escape";
            })
        );
        registry.setMiddleware({
            __kind: "middleware",
            handler: (_ctx, next) => {
                void next();
                void next();
            },
        });
    });
    const stream = frames(await request("stream"));
    expect(await stream.next()).toMatchObject({ type: "error", error: expect.stringContaining("next() may only be called once") });
    expect(await stream.next()).toBe(null);
});
