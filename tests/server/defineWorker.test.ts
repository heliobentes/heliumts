import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HeliumContext } from "../../src/server/context";
import { defineWorker, getWorkerById, getWorkerStatus, startWorker, stopAllWorkers, stopWorker } from "../../src/server/defineWorker";

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
            const handler = async (_ctx: HeliumContext) => {
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
            async function namedWorkerHandler(_ctx: HeliumContext) {}

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
            expect(() => defineWorker(null as unknown as (ctx: HeliumContext) => Promise<void>)).toThrow("defineWorker requires a handler");
        });
    });

    describe("startWorker", () => {
        it("should start a worker and return instance", async () => {
            let _executed = false;
            const worker = defineWorker(
                async (_ctx) => {
                    _executed = true;
                },
                { name: "testWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
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
            const worker = defineWorker(
                async (_ctx) => {
                    await new Promise(() => {}); // Never resolves
                },
                { name: "longRunningWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            const instance1 = await startWorker(worker, createContext);
            const instance2 = await startWorker(worker, createContext);

            expect(instance1).toBe(instance2);
        });

        it("should track restart count on crash", async () => {
            let attempts = 0;
            const worker = defineWorker(
                async (_ctx) => {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error("Simulated crash");
                    }
                },
                { name: "crashingWorker", restartDelayMs: 100 }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            const _instance = await startWorker(worker, createContext);

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

        it("should expose abort signal and run returned cleanup on stop", async () => {
            const cleanup = vi.fn();
            let signal: AbortSignal | undefined;
            const worker = defineWorker(
                (_ctx, lifecycle) => {
                    signal = lifecycle.signal;
                    return cleanup;
                },
                { name: "cleanupWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            const instance = await startWorker(worker, createContext);
            await vi.advanceTimersByTimeAsync(0);

            expect(instance.status).toBe("running");
            expect(signal?.aborted).toBe(false);

            await instance.stop();

            expect(signal?.aborted).toBe(true);
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(getWorkerById("cleanupWorker")).toBeUndefined();
        });

        it("should await async cleanup when stopping all workers", async () => {
            let cleanupFinished = false;
            const worker = defineWorker(
                () => async () => {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    cleanupFinished = true;
                },
                { name: "asyncCleanupWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);
            await vi.advanceTimersByTimeAsync(0);

            const stopPromise = stopAllWorkers();
            expect(cleanupFinished).toBe(false);

            await vi.advanceTimersByTimeAsync(25);
            await stopPromise;

            expect(cleanupFinished).toBe(true);
        });
    });

    describe("stopWorker", () => {
        it("should stop a running worker", async () => {
            const worker = defineWorker(
                async (_ctx) => {
                    await new Promise(() => {}); // Never resolves
                },
                { name: "stoppableWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            const result = stopWorker("stoppableWorker");
            await vi.advanceTimersByTimeAsync(0);

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
            const worker1 = defineWorker(
                async () => {
                    await new Promise(() => {});
                },
                { name: "worker1" }
            );

            const worker2 = defineWorker(
                async () => {
                    await new Promise(() => {});
                },
                { name: "worker2" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
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
            const worker = defineWorker(
                async () => {
                    await new Promise(() => {});
                },
                { name: "statusWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
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
            const worker = defineWorker(
                async () => {
                    await new Promise(() => {});
                },
                { name: "findableWorker" }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
                req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
            });

            await startWorker(worker, createContext);

            const instance = getWorkerById("findableWorker");

            expect(instance).toBeDefined();
            expect(instance!.name).toBe("findableWorker");
        });
    });

    describe("worker lifecycle regressions", () => {
        const createContext = (): HeliumContext => ({
            signal: new AbortController().signal,
            req: { ip: "127.0.0.1", headers: {}, raw: {} as HeliumContext["req"]["raw"] },
        });

        it("runs cleanup returned by asynchronous setup after the worker was stopped", async () => {
            const cleanup = vi.fn();
            let finishSetup!: (cleanup: () => void) => void;
            const setup = new Promise<() => void>((resolve) => {
                finishSetup = resolve;
            });
            const instance = await startWorker(
                defineWorker(() => setup, { name: "lateSetup" }),
                createContext
            );
            await instance.stop();
            finishSetup(cleanup);
            await vi.advanceTimersByTimeAsync(0);
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(getWorkerById("lateSetup")).toBeUndefined();
        });

        it("runs cleanup registered after stopping without waiting for an uncooperative handler", async () => {
            const cleanup = vi.fn();
            let onCleanup!: (handler: () => void) => void;
            const instance = await startWorker(
                defineWorker(
                    (_ctx, lifecycle) => {
                        onCleanup = lifecycle.onCleanup;
                        return new Promise(() => {});
                    },
                    { name: "lateRegistration" }
                ),
                createContext
            );
            await instance.stop();
            onCleanup(cleanup);
            await vi.advanceTimersByTimeAsync(0);
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it("cancels a pending restart timer when stopped", async () => {
            const handler = vi.fn(() => {
                throw new Error("failed");
            });
            const instance = await startWorker(defineWorker(handler, { name: "cancelRestart", restartDelayMs: 60_000 }), createContext);
            await vi.advanceTimersByTimeAsync(0);
            expect(instance.status).toBe("restarting");
            expect(vi.getTimerCount()).toBe(1);
            await instance.stop();
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it("keeps a replacement registered when an old instance is stopped again", async () => {
            const worker = defineWorker(() => new Promise(() => {}), { name: "replacement" });
            const oldInstance = await startWorker(worker, createContext);
            await oldInstance.stop();
            const replacement = await startWorker(worker, createContext);
            await oldInstance.stop();
            expect(getWorkerById("replacement")).toBe(replacement);
            expect(replacement.status).toBe("running");
        });

        it("keeps workers started while stopAllWorkers is awaiting another cleanup", async () => {
            let finishCleanup!: () => void;
            const pendingCleanup = new Promise<void>((resolve) => {
                finishCleanup = resolve;
            });
            await startWorker(
                defineWorker(() => () => pendingCleanup, { name: "slowStop" }),
                createContext
            );
            await vi.advanceTimersByTimeAsync(0);
            const stopping = stopAllWorkers();
            const newWorker = await startWorker(
                defineWorker(() => new Promise(() => {}), { name: "newWorker" }),
                createContext
            );
            finishCleanup();
            await stopping;
            expect(getWorkerById("newWorker")).toBe(newWorker);
        });

        it("preserves normal completion when stopped during asynchronous cleanup", async () => {
            let finishCleanup!: () => void;
            const pendingCleanup = new Promise<void>((resolve) => {
                finishCleanup = resolve;
            });
            const cleanup = vi.fn(() => pendingCleanup);
            const instance = await startWorker(
                defineWorker(
                    (_ctx, lifecycle) => {
                        lifecycle.onCleanup(cleanup);
                    },
                    { name: "stopDuringCompletion" }
                ),
                createContext
            );
            await vi.advanceTimersByTimeAsync(0);
            expect(cleanup).toHaveBeenCalledTimes(1);
            const stopping = instance.stop();
            finishCleanup();
            await stopping;
            await vi.advanceTimersByTimeAsync(0);
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(instance.status).toBe("stopped");
            expect(getWorkerById("stopDuringCompletion")).toBeUndefined();
            expect(console.log).toHaveBeenCalledWith(expect.any(String), "Worker 'stopDuringCompletion' completed successfully");
        });

        it("removes synchronously completed or crashed workers from the registry", async () => {
            const completed = await startWorker(
                defineWorker(() => {}, { name: "synchronousComplete" }),
                createContext
            );
            const crashed = await startWorker(
                defineWorker(
                    () => {
                        throw new Error("failed");
                    },
                    { name: "synchronousCrash", autoRestart: false }
                ),
                createContext
            );
            await vi.advanceTimersByTimeAsync(0);
            expect(completed.status).toBe("stopped");
            expect(crashed.status).toBe("crashed");
            expect(getWorkerStatus()).toEqual([]);
        });
    });

    describe("maxRestarts limit", () => {
        it("should stop after max restarts exceeded", async () => {
            let attempts = 0;
            const worker = defineWorker(
                async (_ctx) => {
                    attempts++;
                    throw new Error("Always fails");
                },
                { name: "limitedWorker", autoRestart: true, maxRestarts: 2, restartDelayMs: 50 }
            );

            const createContext = (): HeliumContext => ({
                signal: new AbortController().signal,
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

            expect(attempts).toBe(3); // Initial attempt plus two permitted restarts
        });
    });
});
