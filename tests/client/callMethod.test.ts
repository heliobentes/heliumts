// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { MethodStub } from "../../src/client/types";

const method: MethodStub<{ name: string }, { greeting: string }> = {
    __kind: "method",
    __id: "greet",
    handler: ({ name }) => ({ greeting: `Hello ${name}` }),
};
const stats = { remainingRequests: 100, resetInSeconds: 60 };

describe("callMethod", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("window", { location: { protocol: "https:", host: "example.test" }, addEventListener: vi.fn() });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function mockHttp() {
        const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
            if (url === "/__helium__/refresh-token") {
                return { ok: true, status: 200, json: async () => ({}) };
            }
            const requests = decode(options?.body as Uint8Array) as Array<{ id: number; args: { name: string } }>;
            const response = encode(requests.map(({ id, args }) => ({ id, ok: true, result: method.handler(args, undefined), stats })));
            return { ok: true, status: 200, arrayBuffer: async () => response.slice().buffer };
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("infers method arguments/results and reports explicit HTTP delivery", async () => {
        const fetchMock = mockHttp();
        const webSocket = vi.fn();
        vi.stubGlobal("WebSocket", webSocket);
        const { callMethod } = await import("../../src/client/callMethod");
        const result = await callMethod(method, { name: "Ada" }, { transport: "http" });

        expectTypeOf(result.data).toEqualTypeOf<{ greeting: string }>();
        expect(result).toEqual({ data: { greeting: "Hello Ada" }, stats, transport: "http" });
        expect(fetchMock.mock.calls.filter(([url]) => url === "/__helium__/rpc")).toHaveLength(1);
        expect(webSocket).not.toHaveBeenCalled();
    });

    it("uses explicit WebSocket delivery even when HTTP is configured", async () => {
        vi.stubGlobal("__HELIUM_RPC_TRANSPORT__", "http");
        const fetchMock = mockHttp();
        class MockWebSocket {
            static OPEN = 1;
            readyState = 1;
            onmessage?: (event: { data: ArrayBufferLike }) => void;
            send(bytes: ArrayBuffer) {
                const request = decode(new Uint8Array(bytes)) as { id: number; args: { name: string } };
                const response = encode({ id: request.id, ok: true, result: method.handler(request.args, undefined), stats });
                queueMicrotask(() => this.onmessage?.({ data: response.slice().buffer }));
            }
        }
        vi.stubGlobal("WebSocket", MockWebSocket);
        const { callMethod } = await import("../../src/client/callMethod");
        const result = await callMethod(method, { name: "Ada" }, { transport: "websocket" });

        expect(result).toEqual({ data: { greeting: "Hello Ada" }, stats, transport: "websocket" });
        expect(fetchMock.mock.calls.filter(([url]) => url === "/__helium__/rpc")).toHaveLength(0);
    });

    it("reports automatic HTTP fallback but never substitutes HTTP for explicit WebSocket calls", async () => {
        vi.useFakeTimers();
        const fetchMock = mockHttp();
        const webSocket = vi.fn(function () {
            throw new Error("WebSocket connection failed");
        });
        vi.stubGlobal("WebSocket", webSocket);
        const { callMethod } = await import("../../src/client/callMethod");

        const automatic = callMethod(method, { name: "Ada" });
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await automatic).transport).toBe("http");
        expect(webSocket).toHaveBeenCalledTimes(4);

        // An explicit selection must also bypass the temporary HTTP cooldown.
        const explicit = callMethod(method, { name: "Ada" }, { transport: "websocket" }).catch((error) => error);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await explicit).toMatchObject({ message: "WebSocket connection failed" });
        expect(webSocket).toHaveBeenCalledTimes(8);
        expect(fetchMock.mock.calls.filter(([url]) => url === "/__helium__/rpc")).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("retries an HTTP failure without interrupting an in-flight WebSocket call", async () => {
        vi.useFakeTimers();
        let reply!: () => void;
        const close = vi.fn();
        class MockWebSocket {
            static OPEN = 1;
            readyState = 1;
            close = close;
            onmessage?: (event: { data: ArrayBufferLike }) => void;
            send(bytes: ArrayBuffer) {
                const request = decode(new Uint8Array(bytes)) as { id: number; args: { name: string } };
                reply = () => {
                    const response = encode({ id: request.id, ok: true, result: method.handler(request.args, undefined), stats });
                    this.onmessage?.({ data: response.slice().buffer });
                };
            }
        }
        vi.stubGlobal("WebSocket", MockWebSocket);
        const fetchMock = mockHttp();
        const successfulFetch = fetchMock.getMockImplementation()!;
        let attempts = 0;
        fetchMock.mockImplementation(async (url, options) => {
            if (url === "/__helium__/rpc" && attempts++ === 0) {
                return { ok: false, status: 500 } as Awaited<ReturnType<typeof successfulFetch>>;
            }
            return successfulFetch(url, options);
        });
        const { callMethod } = await import("../../src/client/callMethod");
        const websocket = callMethod(method, { name: "Ada" }, { transport: "websocket" });
        await vi.advanceTimersByTimeAsync(0);
        expect(reply).toBeTypeOf("function");

        const http = callMethod(method, { name: "Grace" }, { transport: "http" });
        await vi.advanceTimersByTimeAsync(1_000);
        expect((await http).data.greeting).toBe("Hello Grace");
        expect(close).not.toHaveBeenCalled();
        reply();
        expect((await websocket).data.greeting).toBe("Hello Ada");
        expect(attempts).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
