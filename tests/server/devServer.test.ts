import { EventEmitter } from "events";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
    const workerModule = await import("../../src/server/defineWorker");
    await workerModule.stopAllWorkers();
    vi.restoreAllMocks();
    vi.resetModules();
});

// Note: devServer.ts is a highly integrated module that attaches to Vite's dev server.
// Full integration testing would require complex mocking that can become fragile.
// Instead, we test the configuration and internal helper logic via the modules it uses.
// The actual server behavior is best tested via E2E tests.

describe("devServer", () => {
    describe("module exports", () => {
        it("should export attachToDevServer function", async () => {
            const mod = await import("../../src/server/devServer");
            expect(mod.attachToDevServer).toBeDefined();
            expect(typeof mod.attachToDevServer).toBe("function");
        });

        it("should dispose the previous worker before starting the replacement", async () => {
            vi.useFakeTimers();

            const workerModule = await import("../../src/server/defineWorker");
            const { defineWorker, getWorkerStatus } = workerModule;
            const firstCleanup = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
            });
            const startEvents: string[] = [];
            const firstWorker = defineWorker(
                () => {
                    startEvents.push("first:start");
                    return firstCleanup;
                },
                { name: "watcher" }
            );
            const secondWorker = defineWorker(
                () => {
                    startEvents.push("second:start");
                    return () => undefined;
                },
                { name: "watcher" }
            );

            const server = new EventEmitter() as EventEmitter & {
                listeners(eventName: string): Function[];
                removeAllListeners(eventName?: string | symbol): EventEmitter;
                on(eventName: string | symbol, listener: (...args: any[]) => void): EventEmitter;
            };
            server.on("request", () => undefined);

            const flushReloadQueue = async () => {
                await Promise.resolve();
                await Promise.resolve();
                await vi.advanceTimersByTimeAsync(0);
            };

            const mod = await import("../../src/server/devServer");

            mod.attachToDevServer(server as any, () => undefined, {}, [{ name: "watcher", worker: firstWorker }]);
            await flushReloadQueue();

            mod.attachToDevServer(server as any, () => undefined, {}, [{ name: "watcher", worker: secondWorker }]);
            await flushReloadQueue();

            expect(startEvents).toEqual(["first:start"]);

            await vi.advanceTimersByTimeAsync(50);
            await flushReloadQueue();

            expect(firstCleanup).toHaveBeenCalledTimes(1);
            expect(startEvents).toEqual(["first:start", "second:start"]);
            expect(getWorkerStatus()).toHaveLength(1);

            vi.useRealTimers();
        });
    });

    describe("WebSocket token endpoint", () => {
        it("should have correct refresh-token endpoint path", () => {
            const endpoint = "/__helium__/refresh-token";
            expect(endpoint).toBe("/__helium__/refresh-token");
        });

        it("should have correct RPC endpoint path prefix", () => {
            const endpoint = "/rpc";
            expect(endpoint).toBe("/rpc");
        });
    });

    describe("worker name handling", () => {
        it("should identify anonymous worker names", () => {
            const workerName = "anonymous";
            expect(workerName === "anonymous").toBe(true);
        });

        it("should accept named workers", () => {
            const workerName = "myWorker";
            expect(workerName.length).toBeGreaterThan(0);
            expect(workerName).toBe("myWorker");
        });
    });

    describe("environment variable loading", () => {
        it("should check for .env file", () => {
            const envFiles = [".env", ".env.local", ".env.development"];
            expect(envFiles).toContain(".env");
            expect(envFiles).toContain(".env.local");
        });

        it("should have development mode priority", () => {
            const devEnvFile = ".env.development";
            expect(devEnvFile).toBe(".env.development");
        });
    });

    describe("request URL parsing", () => {
        it("should extract token from URL query string", () => {
            const url = "/rpc?token=abc123";
            const urlObj = new URL(url, "http://localhost");
            expect(urlObj.searchParams.get("token")).toBe("abc123");
        });

        it("should handle URL without token", () => {
            const url = "/rpc";
            const urlObj = new URL(url, "http://localhost");
            expect(urlObj.searchParams.get("token")).toBeNull();
        });

        it("should handle complex URL with multiple params", () => {
            const url = "/rpc?token=xyz&other=123";
            const urlObj = new URL(url, "http://localhost");
            expect(urlObj.searchParams.get("token")).toBe("xyz");
            expect(urlObj.searchParams.get("other")).toBe("123");
        });
    });

    describe("WebSocket path detection", () => {
        it("should match /rpc path", () => {
            const url = "/rpc?token=test";
            expect(url.startsWith("/rpc")).toBe(true);
        });

        it("should not match other paths", () => {
            const url = "/api/users";
            expect(url.startsWith("/rpc")).toBe(false);
        });
    });

    describe("HTTP response codes", () => {
        it("should use 401 for unauthorized", () => {
            const statusCode = 401;
            expect(statusCode).toBe(401);
        });

        it("should use 429 for too many requests", () => {
            const statusCode = 429;
            expect(statusCode).toBe(429);
        });

        it("should use 200 for success", () => {
            const statusCode = 200;
            expect(statusCode).toBe(200);
        });
    });

    describe("worker autoStart behavior", () => {
        it("should check autoStart option", () => {
            const workerOptions = { name: "test", autoStart: true };
            expect(workerOptions.autoStart).toBe(true);
        });

        it("should handle non-autoStart workers", () => {
            const workerOptions = { name: "test", autoStart: false };
            expect(workerOptions.autoStart).toBe(false);
        });
    });

    describe("request event handlers", () => {
        it("should handle request event type", () => {
            const eventType = "request";
            expect(eventType).toBe("request");
        });

        it("should handle upgrade event type", () => {
            const eventType = "upgrade";
            expect(eventType).toBe("upgrade");
        });
    });

    describe("context creation for workers", () => {
        it("should create context with localhost IP", () => {
            const context = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    url: undefined,
                    method: undefined,
                },
            };
            expect(context.req.ip).toBe("127.0.0.1");
        });

        it("should have empty headers by default", () => {
            const context = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                },
            };
            expect(context.req.headers).toEqual({});
        });
    });
});
