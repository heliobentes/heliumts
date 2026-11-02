import { decode, encode } from "@msgpack/msgpack";
import type http from "http";
import { afterEach, expect, it, vi } from "vitest";
import { defineMethod } from "../../src/server/defineMethod";
import { RateLimiter } from "../../src/server/rateLimiter";
import { PublicError, RpcRegistry } from "../../src/server/rpcRegistry";
const req = { headers: { "x-test": "value" }, url: "/__helium__/rpc", method: "POST" } as unknown as http.IncomingMessage;
const call = async (registry: RpcRegistry, value: unknown) => (await registry.handleHttpRequest(Buffer.from(encode(value)), "test", req)).response;
afterEach(() => vi.unstubAllEnvs());
it("preserves typed args, request context, middleware changes, and a cancellation signal", async () => {
    const registry = new RpcRegistry();
    registry.register(
        "echo",
        defineMethod((args: string, ctx) => ({ args, header: ctx.req.headers["x-test"], extra: ctx.extra, signal: ctx.signal instanceof AbortSignal }))
    );
    registry.setMiddleware({
        __kind: "middleware",
        handler: async ({ ctx }, next) => {
            ctx.extra = "middleware";
            await next();
        },
    });
    expect(await call(registry, { id: 1, method: "echo", args: "hello" })).toMatchObject({
        id: 1,
        ok: true,
        result: { args: "hello", header: "value", extra: "middleware", signal: true },
    });
});
it("correlates malformed, unknown, blocked, and oversized-batch requests", async () => {
    const registry = new RpcRegistry();
    registry.setMaxBatchSize(1);
    expect(await call(registry, { id: "bad" })).toMatchObject({ id: "bad", ok: false });
    expect(await call(registry, { id: 2, method: "missing" })).toMatchObject({ id: 2, ok: false, error: "Unknown method missing" });
    expect(await call(registry, [{ id: 1 }, { id: 2 }])).toMatchObject({ id: "batch", ok: false });
    registry.register(
        "blocked",
        defineMethod(() => "private")
    );
    registry.setMiddleware({ __kind: "middleware", handler: () => undefined });
    expect(await call(registry, { id: 3, method: "blocked" })).toMatchObject({ ok: false, error: "Request blocked by middleware" });
});
it("runs bounded batches and shares HTTP rate windows", async () => {
    const registry = new RpcRegistry();
    registry.register(
        "echo",
        defineMethod((args: string) => args)
    );
    registry.setRateLimiter(new RateLimiter(1, 1000));
    expect(
        await call(registry, [
            { id: 1, method: "echo", args: "first" },
            { id: 2, method: "echo", args: "second" },
        ])
    ).toMatchObject([
        { id: 1, result: "first" },
        { id: 2, result: "second" },
    ]);
    expect(await call(registry, { id: 3, method: "echo" })).toMatchObject({ id: 3, ok: false, error: "Rate limit exceeded" });
});
it("sanitizes private failures in production while preserving explicit public errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const registry = new RpcRegistry();
    registry.register(
        "private",
        defineMethod(() => {
            throw new Error("database secret");
        })
    );
    registry.register(
        "public",
        defineMethod(() => {
            throw new PublicError("Readable guidance");
        })
    );
    expect(await call(registry, { id: 1, method: "private" })).toMatchObject({ error: "Server error" });
    expect(await call(registry, { id: 2, method: "public" })).toMatchObject({ error: "Readable guidance" });
});
it("rejects streaming results on the unary endpoint with public guidance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const registry = new RpcRegistry();
    registry.register(
        "stream",
        defineMethod(async function* () {
            yield "chunk";
        })
    );
    expect(await call(registry, { id: 1, method: "stream" })).toMatchObject({ ok: false, error: expect.stringContaining("useStreaming") });
});
it("rejects invalid MessagePack without throwing or executing a method", async () => {
    const registry = new RpcRegistry();
    const response = await registry.handleHttpRequest(Buffer.from([0xc1]), "test", req);
    expect(response.response).toMatchObject({ ok: false, error: "Invalid request format" });
    expect(decode(encode(response.response))).toMatchObject({ ok: false });
});
