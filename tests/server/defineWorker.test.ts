import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    defineWorker,
    getWorkerById,
    getWorkerStatus,
    startWorker,
    stopAllWorkers,
    stopWorker,
    type HeliumWorkerDef,
} from "../../src/server/defineWorker";
import type { HeliumContext } from "../../src/server/context";

describe("defineWorker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(async () => {
        await stopAllWorkers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("defineWorker function", () => {
        it("should create a worker definition with default options", () => {
            const handler = async (ctx: HeliumContext) => {
                // Worker logic
            };

            const worker = defineWorker(handler);

            expect(worker.__kind).toBe("worker");
            expect(worker.handler).toBe(handler);
            expect(worker.options.autoRestart).toBe(true);
            expect(worker.options.restartDelayMs).toBe(5000);
            expect(worker.options.maxRestarts).toBe(0);
            expect(worker.options.autoStart).toBe(true);
        });

        it("should use provided name option", () => {
            const worker = defineWorker(async () => {}, { name: "myWorker" });

            expect(worker.name).toBe("myWorker");
            expect(worker.__id).toBe("myWorker");
        });

        it("should use handler function name when name not provided", () => {
            async function namedWorkerHandler(ctx: HeliumContext) {}

            const worker = defineWorker(namedWorkerHandler);

            expect(worker.name).toBe("namedWorkerHandler");
        });

        it("should use 'anonymous' for unnamed handlers", () => {
            const worker = defineWorker(async () => {});

            expect(worker.name).toBe("anonymous");
        });

        it("should respect custom options", () => {
            const worker = defineWorker(async () => {}, {
                name: "customWorker",
                autoRestart: false,
                restartDelayMs: 10000,
                maxRestarts: 5,
                autoStart: false,
            });

            expect(worker.options.autoRestart).toBe(false);
            expect(worker.options.restartDelayMs).toBe(10000);
            expect(worker.options.maxRestarts).toBe(5);
            expect(worker.options.autoStart).toBe(false);
        });

        it("should throw when handler is not provided", () => {
            expect(() => defineWorker(null as unknown as (ctx: HeliumContext) => Promise<void>)).toThrow(
                "defineWorker requires a handler"
            );
        });
    });

    describe("startWorker", () => {
        it("should start a worker and return instance", async () => {
            let executed = false;
            const worker = defineWorker(
                async (ctx) => {
                    executed = true;
                },
                { name: "testWorker" }
            );

            const createContext = (): HeliumContext => ({
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    raw: {} as HeliumContext["req"]["raw"],
                },
            });

            const instance = await startWorker(worker, createContext);

            // Allow the worker to execute
            await vi.advanceTimersByTimeAsync(0);

            expect(instance.name).toBe("testWorker");
            expect(instance.status).toBe("stopped"); // Completed successfully
        });

        it("should return existing instance if worker already running", async () => {
            const worker = defineWorker(async (ctx) => {
                await new Promise(() => {}); // Never resolves
            }, { name: "longRunningWorker" });

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            const instance1 = await startWorker(worker, createContext);
            const instance2 = await startWorker(worker, createContext);

            expect(instance1).toBe(instance2);
        });

        it("should track restart count on crash", async () => {
            let attempts = 0;
            const worker = defineWorker(
                async (ctx) => {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error("Simulated crash");
                    }
                },
                { name: "crashingWorker", restartDelayMs: 100 }
            );

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            const instance = await startWorker(worker, createContext);

            // First execution - crashes
            await vi.advanceTimersByTimeAsync(0);

            // Wait for restart delay and second execution
            await vi.advanceTimersByTimeAsync(100);
            await vi.advanceTimersByTimeAsync(0);

            // Wait for restart delay and third execution
            await vi.advanceTimersByTimeAsync(100);
            await vi.advanceTimersByTimeAsync(0);

            expect(attempts).toBe(3);
        });
    });

    describe("stopWorker", () => {
        it("should stop a running worker", async () => {
            const worker = defineWorker(async (ctx) => {
                await new Promise(() => {}); // Never resolves
            }, { name: "stoppableWorker" });

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            const result = stopWorker("stoppableWorker");

            expect(result).toBe(true);
            expect(getWorkerById("stoppableWorker")).toBeUndefined();
        });

        it("should return false for non-existent worker", () => {
            const result = stopWorker("nonExistent");

            expect(result).toBe(false);
        });
    });

    describe("stopAllWorkers", () => {
        it("should stop all running workers", async () => {
            const worker1 = defineWorker(async () => {
                await new Promise(() => {});
            }, { name: "worker1" });

            const worker2 = defineWorker(async () => {
                await new Promise(() => {});
            }, { name: "worker2" });

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker1, createContext);
            await startWorker(worker2, createContext);

            expect(getWorkerStatus()).toHaveLength(2);

            await stopAllWorkers();

            expect(getWorkerStatus()).toHaveLength(0);
        });
    });

    describe("getWorkerStatus", () => {
        it("should return empty array when no workers", () => {
            expect(getWorkerStatus()).toEqual([]);
        });

        it("should return all worker instances", async () => {
            const worker = defineWorker(async () => {
                await new Promise(() => {});
            }, { name: "statusWorker" });

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            const status = getWorkerStatus();

            expect(status).toHaveLength(1);
            expect(status[0].name).toBe("statusWorker");
            expect(status[0].status).toBe("running");
        });
    });

    describe("getWorkerById", () => {
        it("should return undefined for non-existent worker", () => {
            expect(getWorkerById("nonExistent")).toBeUndefined();
        });

        it("should return worker instance by name", async () => {
            const worker = defineWorker(async () => {
                await new Promise(() => {});
            }, { name: "findableWorker" });

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            const instance = getWorkerById("findableWorker");

            expect(instance).toBeDefined();
            expect(instance!.name).toBe("findableWorker");
        });
    });

    describe("maxRestarts limit", () => {
        it("should stop after max restarts exceeded", async () => {
            let attempts = 0;
            const worker = defineWorker(
                async (ctx) => {
                    attempts++;
                    throw new Error("Always fails");
                },
                { name: "limitedWorker", autoRestart: true, maxRestarts: 2, restartDelayMs: 50 }
            );

            const createContext = (): HeliumContext => ({
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            // First execution - crashes
            await vi.advanceTimersByTimeAsync(0);

            // Restart 1
            await vi.advanceTimersByTimeAsync(50);
            await vi.advanceTimersByTimeAsync(0);

            // Restart 2 - should stop after this
            await vi.advanceTimersByTimeAsync(50);
            await vi.advanceTimersByTimeAsync(0);

            // Give extra time - should not restart again
            await vi.advanceTimersByTimeAsync(50);
            await vi.advanceTimersByTimeAsync(0);

            expect(attempts).toBe(2); // Only 2 attempts (maxRestarts)
        });
    });
});
