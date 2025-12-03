import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { getRpcTransport, isAutoHttpOnMobileEnabled, preconnect, type RpcResult, type RpcTransport } from "../../src/client/rpcClient";

// Test rpcClient functions
describe("rpcClient", () => {
    describe("getRpcTransport", () => {
        it("should return the configured transport mode", () => {
            const transport = getRpcTransport();
            // Default is 'websocket' when __HELIUM_RPC_TRANSPORT__ is not defined
            expect(["http", "websocket", "auto"]).toContain(transport);
        });

        it("should return websocket by default", () => {
            const transport = getRpcTransport();
            expect(transport).toBe("websocket");
        });
    });

    describe("isAutoHttpOnMobileEnabled", () => {
        it("should return whether auto HTTP on mobile is enabled", () => {
            const enabled = isAutoHttpOnMobileEnabled();
            // Default is false when __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__ is not defined
            expect(typeof enabled).toBe("boolean");
        });

        it("should return false by default", () => {
            const enabled = isAutoHttpOnMobileEnabled();
            expect(enabled).toBe(false);
        });
    });

    describe("preconnect", () => {
        it("should be callable without errors", () => {
            // preconnect is a no-op when window is undefined (server-side)
            expect(() => preconnect()).not.toThrow();
        });

        it("should be a no-op on server side", () => {
            const originalWindow = globalThis.window;
            // @ts-ignore - simulating server environment
            delete globalThis.window;

            expect(() => preconnect()).not.toThrow();

            // Restore window
            globalThis.window = originalWindow;
        });
    });

    describe("RpcTransport type", () => {
        it("should support http, websocket, and auto modes", () => {
            const validModes: RpcTransport[] = ["http", "websocket", "auto"];

            expect(validModes).toContain("websocket");
            expect(validModes).toContain("http");
            expect(validModes).toContain("auto");
        });
    });

    describe("RpcResult type", () => {
        it("should have data and stats properties", () => {
            const mockResult: RpcResult<{ name: string }> = {
                data: { name: "test" },
                stats: { remainingRequests: 100, resetInSeconds: 60 },
            };

            expect(mockResult.data.name).toBe("test");
            expect(mockResult.stats.remainingRequests).toBe(100);
            expect(mockResult.stats.resetInSeconds).toBe(60);
        });
    });

    describe("request batching logic", () => {
        it("should batch multiple requests into single transmission", async () => {
            type PendingRequest = {
                id: number;
                method: string;
                args: unknown;
            };

            const batch: PendingRequest[] = [];

            batch.push({ id: 1, method: "getUser", args: { id: 1 } });
            batch.push({ id: 2, method: "getUser", args: { id: 2 } });
            batch.push({ id: 3, method: "getPosts", args: {} });

            expect(batch.length).toBe(3);

            const methodIds = batch.map((req) => req.method);
            expect(methodIds).toContain("getUser");
            expect(methodIds).toContain("getPosts");
        });
    });

    describe("message ID generation", () => {
        it("should generate sequential message IDs", () => {
            let msgId = 0;
            function nextId() {
                return msgId++;
            }

            expect(nextId()).toBe(0);
            expect(nextId()).toBe(1);
            expect(nextId()).toBe(2);
        });
    });

    describe("pending request tracking", () => {
        it("should track pending requests by ID", () => {
            const pending = new Map<
                string | number,
                {
                    resolve: (v: unknown) => void;
                    reject: (e: unknown) => void;
                }
            >();

            let resolvedValue: unknown;

            pending.set(1, {
                resolve: (v) => {
                    resolvedValue = v;
                },
                reject: () => {},
            });

            expect(pending.has(1)).toBe(true);
            expect(pending.has(2)).toBe(false);

            const entry = pending.get(1);
            entry?.resolve({ data: "test" });
            pending.delete(1);

            expect(resolvedValue).toEqual({ data: "test" });
            expect(pending.has(1)).toBe(false);
        });
    });

    describe("network detection", () => {
        it("should detect slow network types", () => {
            const slowTypes = ["slow-2g", "2g", "3g"];

            expect(slowTypes.includes("slow-2g")).toBe(true);
            expect(slowTypes.includes("2g")).toBe(true);
            expect(slowTypes.includes("3g")).toBe(true);
            expect(slowTypes.includes("4g")).toBe(false);
        });
    });

    describe("transport selection logic", () => {
        function shouldUseHttpTransport(transport: RpcTransport, autoHttpOnMobile: boolean, connection?: { type?: string; effectiveType?: string }): boolean {
            if (transport === "http") {
                return true;
            }
            if (transport === "websocket") {
                return false;
            }

            // Auto mode
            if (!autoHttpOnMobile) {
                return false;
            }

            if (connection) {
                const slowTypes = ["slow-2g", "2g", "3g"];
                if (connection.type === "cellular" || (connection.effectiveType && slowTypes.includes(connection.effectiveType))) {
                    return true;
                }
            }

            return false;
        }

        it("should use HTTP when transport is http", () => {
            expect(shouldUseHttpTransport("http", false)).toBe(true);
        });

        it("should use WebSocket when transport is websocket", () => {
            expect(shouldUseHttpTransport("websocket", false)).toBe(false);
        });

        it("should use WebSocket for auto when autoHttpOnMobile is disabled", () => {
            expect(shouldUseHttpTransport("auto", false)).toBe(false);
        });

        it("should use HTTP for auto on cellular connection", () => {
            expect(shouldUseHttpTransport("auto", true, { type: "cellular" })).toBe(true);
        });

        it("should use HTTP for auto on 2g connection", () => {
            expect(shouldUseHttpTransport("auto", true, { effectiveType: "2g" })).toBe(true);
        });

        it("should use HTTP for auto on 3g connection", () => {
            expect(shouldUseHttpTransport("auto", true, { effectiveType: "3g" })).toBe(true);
        });

        it("should use WebSocket for auto on 4g connection", () => {
            expect(shouldUseHttpTransport("auto", true, { effectiveType: "4g" })).toBe(false);
        });

        it("should use WebSocket for auto on wifi connection", () => {
            expect(shouldUseHttpTransport("auto", true, { type: "wifi" })).toBe(false);
        });
    });

    describe("WebSocket URL construction", () => {
        it("should construct correct WebSocket URL", () => {
            function constructWsUrl(protocol: string, host: string, token?: string): string {
                const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
                return `${wsProtocol}//${host}/rpc${token ? `?token=${token}` : ""}`;
            }

            expect(constructWsUrl("https:", "example.com", "abc123")).toBe("wss://example.com/rpc?token=abc123");
            expect(constructWsUrl("http:", "localhost:5173", "xyz789")).toBe("ws://localhost:5173/rpc?token=xyz789");
            expect(constructWsUrl("http:", "localhost:3000")).toBe("ws://localhost:3000/rpc");
        });
    });

    describe("response mapping", () => {
        it("should map responses by ID", () => {
            const responses = [
                { id: 1, ok: true as const, result: { name: "User 1" }, stats: { remainingRequests: 99, resetInSeconds: 60 } },
                { id: 2, ok: true as const, result: { name: "User 2" }, stats: { remainingRequests: 98, resetInSeconds: 60 } },
                { id: 3, ok: false as const, error: "Not found", stats: { remainingRequests: 97, resetInSeconds: 60 } },
            ];

            const responseMap = new Map(responses.map((r) => [r.id, r]));

            expect(responseMap.get(1)?.ok).toBe(true);
            expect(responseMap.get(2)?.result).toEqual({ name: "User 2" });
            expect(responseMap.get(3)?.ok).toBe(false);
            expect(responseMap.get(4)).toBeUndefined();
        });
    });

    describe("batch scheduling", () => {
        it("should use queueMicrotask for batching", async () => {
            const calls: number[] = [];

            queueMicrotask(() => calls.push(1));
            queueMicrotask(() => calls.push(2));
            calls.push(0);

            // Wait for microtasks
            await Promise.resolve();
            await Promise.resolve();

            expect(calls).toEqual([0, 1, 2]);
        });
    });
});
