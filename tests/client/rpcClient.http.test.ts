// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRpcTransport, rpcCallWithOptions } from "../../src/client/rpcClient";

describe("forced HTTP transport", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("batches forced HTTP calls over HTTP even when WebSocket is configured", async () => {
        const webSocket = vi.fn();
        vi.stubGlobal("WebSocket", webSocket);
        const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
            if (url === "/__helium__/refresh-token") {
                return { ok: true, status: 200, json: async () => ({}) };
            }
            const requests = decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>;
            const bytes = encode(
                requests.map((request) => ({
                    id: request.id,
                    ok: true,
                    result: request.method,
                    stats: { remainingRequests: 10, resetInSeconds: 1 },
                }))
            );
            return { ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer };
        });
        vi.stubGlobal("fetch", fetchMock);
        expect(getRpcTransport()).toBe("websocket");
        const results = await Promise.all([rpcCallWithOptions("first", undefined, { forceHttp: true }), rpcCallWithOptions("second", undefined, { forceHttp: true })]);
        expect(results.map((result) => result.data)).toEqual(["first", "second"]);
        expect(fetchMock.mock.calls.filter(([url]) => url === "/__helium__/rpc")).toHaveLength(1);
        expect(webSocket).not.toHaveBeenCalled();
    });
    it.each([
        { configuredLimit: undefined, calls: 45, expectedSizes: [20, 20, 5] },
        { configuredLimit: 2, calls: 5, expectedSizes: [2, 2, 1] },
    ])("splits $calls concurrent HTTP calls at the configured batch cap ($configuredLimit)", async ({ configuredLimit, calls, expectedSizes }) => {
        vi.resetModules();
        if (configuredLimit !== undefined) {
            vi.stubGlobal("__HELIUM_RPC_MAX_BATCH_SIZE__", configuredLimit);
        }
        const client = await import("../../src/client/rpcClient");
        const sizes: number[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options?: RequestInit) => {
                if (url === "/__helium__/refresh-token") {
                    return { ok: true, status: 200, json: async () => ({}) };
                }
                const requests = decode(options?.body as Uint8Array) as Array<{ id: number; method: string }>;
                sizes.push(requests.length);
                const response = encode(requests.map((request) => ({ id: request.id, ok: true, result: request.method, stats: { remainingRequests: 100, resetInSeconds: 1 } })));
                return { ok: true, status: 200, arrayBuffer: async () => response.slice().buffer };
            })
        );
        const results = await Promise.all(Array.from({ length: calls }, (_, index) => client.rpcCallWithOptions(`method-${index}`, undefined, { forceHttp: true })));
        expect(sizes).toEqual(expectedSizes);
        expect(results.map((result) => result.data)).toEqual(Array.from({ length: calls }, (_, index) => `method-${index}`));
    });

    it("aborts stalled HTTP requests and rejects after bounded retries", async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options?: RequestInit) => {
                if (url === "/__helium__/refresh-token") {
                    return { ok: true, status: 200, json: async () => ({}) };
                }
                const signal = options?.signal as AbortSignal;
                signals.push(signal);
                return new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
                });
            })
        );
        const outcome = rpcCallWithOptions("stalled", undefined, { forceHttp: true }).catch((error) => error);
        await vi.advanceTimersByTimeAsync(130_000);
        expect((await outcome).message).toBe("Request timed out");
        expect(signals).toHaveLength(4);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
