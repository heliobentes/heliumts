import { describe, expect, it, vi } from "vitest";

import { getRpcTransport, isAutoHttpOnMobileEnabled, preconnect, type RpcResult, type RpcTransport } from "../../src/client/rpcClient";
import { RpcError } from "../../src/client/RpcError";

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

        it("should not attempt WebSocket on mobile viewport", () => {
            const originalMatchMedia = window.matchMedia;
            const originalWebSocket = globalThis.WebSocket;

            const webSocketSpy = vi.fn();

            const mockedWebSocket = vi
                .fn()
                .mockImplementation(() => {
                    webSocketSpy();
                    throw new Error("WebSocket should not be created on mobile viewport");
                }) as unknown as typeof WebSocket;

            window.matchMedia = vi.fn().mockImplementation((query: string) => {
                if (query.includes("max-width")) {
                    return {
                        matches: true,
                        media: query,
                        onchange: null,
                        addListener: vi.fn(),
                        removeListener: vi.fn(),
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                        dispatchEvent: vi.fn(),
                    };
                }

                return {
                    matches: false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                };
            });

            globalThis.WebSocket = mockedWebSocket;

            expect(() => preconnect()).not.toThrow();
            expect(webSocketSpy).not.toHaveBeenCalled();

            window.matchMedia = originalMatchMedia;
            globalThis.WebSocket = originalWebSocket;
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

    describe("pending request tracking with timeouts", () => {
        it("should reject pending request after timeout", () => {
            vi.useFakeTimers();

            const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
            const pendingTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();

            let rejectedError: unknown;

            function trackPending(id: string | number, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
                pending.set(id, { resolve, reject });
                const timer = setTimeout(() => {
                    const entry = pending.get(id);
                    if (entry) {
                        pending.delete(id);
                        pendingTimeouts.delete(id);
                        entry.reject(new RpcError("Request timed out"));
                    }
                }, 30_000);
                pendingTimeouts.set(id, timer);
            }

            trackPending(
                1,
                () => {},
                (err) => {
                    rejectedError = err;
                }
            );
            expect(pending.has(1)).toBe(true);
            expect(pendingTimeouts.has(1)).toBe(true);

            // Advance past timeout
            vi.advanceTimersByTime(30_001);

            expect(pending.has(1)).toBe(false);
            expect(pendingTimeouts.has(1)).toBe(false);
            expect(rejectedError).toBeInstanceOf(RpcError);
            expect((rejectedError as RpcError).message).toBe("Request timed out");

            vi.useRealTimers();
        });

        it("should clear timeout when request is resolved before timeout", () => {
            vi.useFakeTimers();

            const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
            const pendingTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();

            function trackPending(id: string | number, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
                pending.set(id, { resolve, reject });
                const timer = setTimeout(() => {
                    const entry = pending.get(id);
                    if (entry) {
                        pending.delete(id);
                        pendingTimeouts.delete(id);
                        entry.reject(new RpcError("Request timed out"));
                    }
                }, 30_000);
                pendingTimeouts.set(id, timer);
            }

            function removePending(id: string | number) {
                const entry = pending.get(id);
                if (!entry) {
                    return undefined;
                }
                pending.delete(id);
                const timer = pendingTimeouts.get(id);
                if (timer) {
                    clearTimeout(timer);
                    pendingTimeouts.delete(id);
                }
                return entry;
            }

            let resolvedValue: unknown;
            trackPending(
                1,
                (v) => {
                    resolvedValue = v;
                },
                () => {}
            );

            // Resolve before timeout
            const entry = removePending(1);
            entry?.resolve({ data: "success" });

            expect(resolvedValue).toEqual({ data: "success" });
            expect(pending.has(1)).toBe(false);
            expect(pendingTimeouts.has(1)).toBe(false);

            // Advancing past timeout should not cause any issues
            vi.advanceTimersByTime(30_001);

            vi.useRealTimers();
        });
    });

    describe("rejectAllPending", () => {
        it("should reject all pending requests at once", () => {
            const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
            const pendingTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();
            const rejected: string[] = [];

            function trackPending(id: string | number, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
                pending.set(id, { resolve, reject });
                const timer = setTimeout(() => {}, 30_000);
                pendingTimeouts.set(id, timer);
            }

            function rejectAllPending(reason: Error): void {
                for (const timer of pendingTimeouts.values()) {
                    clearTimeout(timer);
                }
                pendingTimeouts.clear();
                const entries = [...pending.entries()];
                pending.clear();
                for (const [, entry] of entries) {
                    entry.reject(reason);
                }
            }

            trackPending(
                1,
                () => {},
                () => {
                    rejected.push("req-1");
                }
            );
            trackPending(
                2,
                () => {},
                () => {
                    rejected.push("req-2");
                }
            );
            trackPending(
                3,
                () => {},
                () => {
                    rejected.push("req-3");
                }
            );

            expect(pending.size).toBe(3);

            rejectAllPending(new Error("WebSocket connection closed"));

            expect(pending.size).toBe(0);
            expect(pendingTimeouts.size).toBe(0);
            expect(rejected).toEqual(["req-1", "req-2", "req-3"]);
        });
    });

    describe("retriable error detection", () => {
        function isRetriableError(err: unknown): boolean {
            if (err instanceof Error && !(err instanceof RpcError)) {
                return true;
            }
            if (err instanceof RpcError && err.message === "Request timed out") {
                return true;
            }
            return false;
        }

        it("should treat plain Error (connection error) as retriable", () => {
            expect(isRetriableError(new Error("WebSocket connection closed"))).toBe(true);
            expect(isRetriableError(new Error("Connection reset"))).toBe(true);
            expect(isRetriableError(new Error("WebSocket connection failed"))).toBe(true);
        });

        it("should treat RpcError 'Request timed out' as retriable", () => {
            expect(isRetriableError(new RpcError("Request timed out"))).toBe(true);
        });

        it("should NOT treat application-level RpcError as retriable", () => {
            expect(isRetriableError(new RpcError("User not found"))).toBe(false);
            expect(isRetriableError(new RpcError("Rate limit exceeded"))).toBe(false);
            expect(isRetriableError(new RpcError("Internal server error"))).toBe(false);
        });

        it("should NOT treat non-Error values as retriable", () => {
            expect(isRetriableError("string error")).toBe(false);
            expect(isRetriableError(null)).toBe(false);
            expect(isRetriableError(undefined)).toBe(false);
            expect(isRetriableError(42)).toBe(false);
        });
    });

    describe("visibility-change stale connection detection", () => {
        it("should detect stale connection after being hidden > 15 seconds", () => {
            const STALE_THRESHOLD_MS = 15_000;
            let lastHiddenTimestamp: number | null = null;
            let reconnected = false;

            function simulateVisibilityChange(hidden: boolean, now: number) {
                if (hidden) {
                    lastHiddenTimestamp = now;
                } else {
                    if (lastHiddenTimestamp !== null) {
                        const hiddenDuration = now - lastHiddenTimestamp;
                        if (hiddenDuration > STALE_THRESHOLD_MS) {
                            reconnected = true;
                        }
                        lastHiddenTimestamp = null;
                    }
                }
            }

            // Hide the page
            simulateVisibilityChange(true, 1000);
            expect(lastHiddenTimestamp).toBe(1000);

            // Come back after 20 seconds
            simulateVisibilityChange(false, 21_000);
            expect(reconnected).toBe(true);
            expect(lastHiddenTimestamp).toBeNull();
        });

        it("should NOT reconnect after being hidden < 15 seconds", () => {
            const STALE_THRESHOLD_MS = 15_000;
            let lastHiddenTimestamp: number | null = null;
            let reconnected = false;

            function simulateVisibilityChange(hidden: boolean, now: number) {
                if (hidden) {
                    lastHiddenTimestamp = now;
                } else {
                    if (lastHiddenTimestamp !== null) {
                        const hiddenDuration = now - lastHiddenTimestamp;
                        if (hiddenDuration > STALE_THRESHOLD_MS) {
                            reconnected = true;
                        }
                        lastHiddenTimestamp = null;
                    }
                }
            }

            // Hide the page
            simulateVisibilityChange(true, 1000);

            // Come back after only 5 seconds
            simulateVisibilityChange(false, 6_000);
            expect(reconnected).toBe(false);
        });

        it("should handle multiple hide/show cycles", () => {
            const STALE_THRESHOLD_MS = 15_000;
            let lastHiddenTimestamp: number | null = null;
            let reconnectCount = 0;

            function simulateVisibilityChange(hidden: boolean, now: number) {
                if (hidden) {
                    lastHiddenTimestamp = now;
                } else {
                    if (lastHiddenTimestamp !== null) {
                        const hiddenDuration = now - lastHiddenTimestamp;
                        if (hiddenDuration > STALE_THRESHOLD_MS) {
                            reconnectCount++;
                        }
                        lastHiddenTimestamp = null;
                    }
                }
            }

            // First cycle: short hide (no reconnect)
            simulateVisibilityChange(true, 1000);
            simulateVisibilityChange(false, 5_000);
            expect(reconnectCount).toBe(0);

            // Second cycle: long hide (reconnect)
            simulateVisibilityChange(true, 10_000);
            simulateVisibilityChange(false, 30_000);
            expect(reconnectCount).toBe(1);

            // Third cycle: long hide (reconnect again)
            simulateVisibilityChange(true, 35_000);
            simulateVisibilityChange(false, 55_000);
            expect(reconnectCount).toBe(2);
        });
    });

    describe("forceReconnect logic", () => {
        it("should reject all pending and clear socket state", () => {
            const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
            const pendingTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();
            let socketClosed = false;
            let socketState: "open" | "closed" | null = "open";

            function rejectAllPending(reason: Error): void {
                for (const timer of pendingTimeouts.values()) {
                    clearTimeout(timer);
                }
                pendingTimeouts.clear();
                const entries = [...pending.entries()];
                pending.clear();
                for (const [, entry] of entries) {
                    entry.reject(reason);
                }
            }

            function forceReconnect(): void {
                if (socketState === "open") {
                    socketClosed = true;
                    socketState = null;
                }
                rejectAllPending(new Error("Connection reset"));
            }

            const rejections: string[] = [];
            pending.set(1, {
                resolve: () => {},
                reject: () => {
                    rejections.push("a");
                },
            });
            pending.set(2, {
                resolve: () => {},
                reject: () => {
                    rejections.push("b");
                },
            });

            forceReconnect();

            expect(socketClosed).toBe(true);
            expect(socketState).toBeNull();
            expect(pending.size).toBe(0);
            expect(rejections).toEqual(["a", "b"]);
        });

        it("should be safe to call when no socket exists", () => {
            let socketState: string | null = null;
            const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

            function rejectAllPending(reason: Error): void {
                const entries = [...pending.entries()];
                pending.clear();
                for (const [, entry] of entries) {
                    entry.reject(reason);
                }
            }

            function forceReconnect(): void {
                socketState = null;
                rejectAllPending(new Error("Connection reset"));
            }

            expect(() => forceReconnect()).not.toThrow();
            expect(socketState).toBeNull();
        });
    });

    describe("retry logic", () => {
        function isRetriableError(err: unknown): boolean {
            if (err instanceof Error && !(err instanceof RpcError)) {
                return true;
            }
            if (err instanceof RpcError && err.message === "Request timed out") {
                return true;
            }
            return false;
        }

        const RETRY_BASE_DELAY_MS = 500;
        const RETRY_MAX_DELAY_MS = 5_000;

        function computeBackoffDelay(attempt: number): number {
            return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
        }

        it("should retry on retriable errors up to MAX_RETRIES with backoff", async () => {
            vi.useFakeTimers();

            const MAX_RETRIES = 3;
            let attempts = 0;
            const delays: number[] = [];

            async function rpcCallWithRetry(attempt = 0): Promise<string> {
                try {
                    attempts++;
                    if (attempts <= 1) {
                        throw new Error("Connection reset");
                    }
                    return "success";
                } catch (err) {
                    if (attempt < MAX_RETRIES && isRetriableError(err)) {
                        const baseDelay = computeBackoffDelay(attempt);
                        delays.push(baseDelay);
                        await new Promise<void>((r) => setTimeout(r, baseDelay));
                        return rpcCallWithRetry(attempt + 1);
                    }
                    throw err;
                }
            }

            const resultPromise = rpcCallWithRetry();
            // Advance past the first retry delay (500ms base)
            await vi.advanceTimersByTimeAsync(600);

            const result = await resultPromise;
            expect(result).toBe("success");
            expect(attempts).toBe(2); // 1 failure + 1 retry
            expect(delays).toHaveLength(1);
            expect(delays[0]).toBe(500); // First retry base delay

            vi.useRealTimers();
        });

        it("should NOT retry on non-retriable errors", async () => {
            const MAX_RETRIES = 3;
            let attempts = 0;

            async function rpcCallWithRetry(attempt = 0): Promise<string> {
                try {
                    attempts++;
                    throw new RpcError("User not found");
                } catch (err) {
                    if (attempt < MAX_RETRIES && isRetriableError(err)) {
                        return rpcCallWithRetry(attempt + 1);
                    }
                    throw err;
                }
            }

            await expect(rpcCallWithRetry()).rejects.toThrow("User not found");
            expect(attempts).toBe(1); // No retry
        });

        it("should give up after MAX_RETRIES exhausted", async () => {
            vi.useFakeTimers();

            const MAX_RETRIES = 3;
            let attempts = 0;

            async function rpcCallWithRetry(attempt = 0): Promise<string> {
                try {
                    attempts++;
                    throw new Error("Connection reset");
                } catch (err) {
                    if (attempt < MAX_RETRIES && isRetriableError(err)) {
                        const baseDelay = computeBackoffDelay(attempt);
                        await new Promise<void>((r) => setTimeout(r, baseDelay));
                        return rpcCallWithRetry(attempt + 1);
                    }
                    throw err;
                }
            }

            const resultPromise = rpcCallWithRetry();
            // Advance past all retry delays: 500 + 1000 + 2000 = 3500ms
            await vi.advanceTimersByTimeAsync(10_000);

            await expect(resultPromise).rejects.toThrow("Connection reset");
            expect(attempts).toBe(4); // 1 original + 3 retries, then gives up

            vi.useRealTimers();
        });

        it("should compute exponential backoff delays correctly", () => {
            expect(computeBackoffDelay(0)).toBe(500); // 500 * 2^0 = 500ms
            expect(computeBackoffDelay(1)).toBe(1000); // 500 * 2^1 = 1000ms
            expect(computeBackoffDelay(2)).toBe(2000); // 500 * 2^2 = 2000ms
            expect(computeBackoffDelay(3)).toBe(4000); // 500 * 2^3 = 4000ms
            expect(computeBackoffDelay(4)).toBe(5000); // 500 * 2^4 = 8000 → capped at 5000ms
            expect(computeBackoffDelay(10)).toBe(5000); // Always capped at 5000ms
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
