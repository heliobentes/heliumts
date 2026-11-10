// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { methodReference } from "./methodReference";

const stats = { remainingRequests: 100, resetInSeconds: 60 };
const token = () => `${Date.now()}.test-signature`;
function reply(requests: Array<{ id: number; method: string }>) {
    return new Response(encode(requests.map((request) => ({ id: request.id, ok: true, result: request.method, stats }))) as Uint8Array<ArrayBuffer>);
}

describe("HTTP RPC client", () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("calls typed methods without sockets or background token-refresh timers", async () => {
        vi.useFakeTimers();
        const socket = vi.fn();
        vi.stubGlobal("WebSocket", socket);
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith("refresh-token")) return Response.json({ token: token() });
            expect(options?.credentials).toBe("same-origin");
            expect(options?.cache).toBe("no-store");
            expect((options?.headers as Record<string, string>)["X-Helium-Token"]).toContain("test-signature");
            return reply(decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>);
        });
        vi.stubGlobal("fetch", fetch);
        const { callMethod } = await import("../../src/client/callMethod");
        const method = methodReference<{ name: string }, string>("greet");
        const result = await callMethod(method, { name: "Ada" });
        expectTypeOf(result.data).toEqualTypeOf<string>();
        expect(result).toEqual({ data: "greet", stats });
        expect(socket).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetch).toHaveBeenCalledTimes(2);
        await callMethod(method, { name: "Grace" });
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("refresh-token"))).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        { configuredLimit: undefined, calls: 45, expectedSizes: [20, 20, 5] },
        { configuredLimit: 2, calls: 5, expectedSizes: [2, 2, 1] },
    ])("batches $calls simultaneous calls into $expectedSizes with one authorization request", async ({ configuredLimit, calls, expectedSizes }) => {
        if (configuredLimit !== undefined) vi.stubGlobal("__HELIUM_RPC_MAX_BATCH_SIZE__", configuredLimit);
        const sizes: number[] = [];
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith("refresh-token")) return Response.json({ token: token() });
            const requests = decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>;
            sizes.push(requests.length);
            return reply(requests);
        });
        vi.stubGlobal("fetch", fetch);
        const { rpcCall } = await import("../../src/client/rpcClient");
        const results = await Promise.all(Array.from({ length: calls }, (_, index) => rpcCall(`method-${index}`, { index })));
        expect(sizes).toEqual(expectedSizes);
        expect(results.map((result) => result.data)).toEqual(Array.from({ length: calls }, (_, index) => `method-${index}`));
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("refresh-token"))).toHaveLength(1);
    });

    it("refreshes an unauthorized token once without changing the request body", async () => {
        const bodies: Uint8Array[] = [];
        let authorizations = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options?: RequestInit) => {
                if (url.endsWith("refresh-token")) return Response.json({ token: `${Date.now()}.${++authorizations}` });
                bodies.push(options?.body as Uint8Array);
                if (bodies.length === 1) return new Response(null, { status: 401 });
                return reply(decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>);
            })
        );
        const { rpcCall } = await import("../../src/client/rpcClient");
        expect((await rpcCall("mutate", { value: 1 })).data).toBe("mutate");
        expect(authorizations).toBe(2);
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toEqual(bodies[1]);
    });

    it.each(["server", "network"])("does not replay a mutation after a %s failure", async (kind) => {
        const fetch = vi.fn(async (url: string) => {
            if (url.endsWith("refresh-token")) return Response.json({ token: token() });
            if (kind === "network") throw new TypeError("Connection lost");
            return new Response("private stack trace", { status: 500 });
        });
        vi.stubGlobal("fetch", fetch);
        const { rpcCall } = await import("../../src/client/rpcClient");
        await expect(rpcCall("mutate")).rejects.toThrow(kind === "network" ? "Connection lost" : "RPC request failed (500)");
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("/rpc"))).toHaveLength(1);
    });

    it("aborts a stalled request once and clears its timeout", async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options?: RequestInit) => {
                if (url.endsWith("refresh-token")) return Response.json({ token: token() });
                const signal = options!.signal!;
                signals.push(signal);
                return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
            })
        );
        const { rpcCall } = await import("../../src/client/rpcClient");
        const result = rpcCall("mutate").catch((error) => error);
        await vi.advanceTimersByTimeAsync(31_000);
        expect((await result).message).toBe("Request timed out");
        expect(signals).toHaveLength(1);
        expect(signals[0].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("isolates errors and missing responses within a batch", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options?: RequestInit) => {
                if (url.endsWith("refresh-token")) return Response.json({ token: token() });
                const requests = decode(options?.body as Uint8Array) as Array<{ id: number }>;
                return new Response(
                    encode([
                        { id: requests[0].id, ok: false, error: "Public failure", stats },
                        { id: requests[1].id, ok: true, result: "good", stats },
                    ]) as Uint8Array<ArrayBuffer>
                );
            })
        );
        const { rpcCall } = await import("../../src/client/rpcClient");
        const results = await Promise.allSettled([rpcCall("bad"), rpcCall("good"), rpcCall("missing")]);
        expect(results[0]).toMatchObject({ status: "rejected", reason: { message: "Public failure", stats } });
        expect(results[1]).toMatchObject({ status: "fulfilled", value: { data: "good", stats } });
        expect(results[2]).toMatchObject({ status: "rejected", reason: { message: "Invalid or missing RPC response" } });
    });

    it("allows one caller to cancel without cancelling shared authorization for another", async () => {
        let authorize!: (response: Response) => void;
        const fetch = vi.fn(async (url: string, options?: RequestInit) => {
            if (url.endsWith("refresh-token"))
                return new Promise<Response>((resolve) => {
                    authorize = resolve;
                });
            return reply(decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>);
        });
        vi.stubGlobal("fetch", fetch);
        const { postRpc } = await import("../../src/client/rpcClient");
        const first = new AbortController();
        const second = new AbortController();
        const cancelled = postRpc("/__helium__/rpc", [], first.signal).catch((error) => error);
        const continuing = postRpc("/__helium__/rpc", [], second.signal);
        first.abort();
        expect((await cancelled).name).toBe("AbortError");
        authorize(Response.json({ token: token() }));
        expect((await continuing).ok).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
