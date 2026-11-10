import { log } from "../utils/logger.js";
import type { HeliumContext } from "./context.js";

export type WorkerCleanup = (() => Promise<void> | void) | void;

export interface WorkerLifecycle {
    signal: AbortSignal;
    onCleanup: (cleanup: WorkerCleanup) => void;
}

export interface WorkerOptions {
    /**
     * The name of the worker, used for logging and identification.
     * If not provided, the handler function name will be used.
     */
    name?: string;

    /**
     * Whether the worker should automatically restart if it crashes.
     * Default: true
     */
    autoRestart?: boolean;

    /**
     * Delay in milliseconds before restarting the worker after a crash.
     * Default: 5000 (5 seconds)
     */
    restartDelayMs?: number;

    /**
     * Maximum number of restart attempts before giving up.
     * Set to 0 for unlimited restarts.
     * Default: 0 (unlimited)
     */
    maxRestarts?: number;

    /**
     * Whether to start the worker automatically on server startup.
     * Default: true
     */
    autoStart?: boolean;
}

export type WorkerHandler = (ctx: HeliumContext, lifecycle: WorkerLifecycle) => Promise<WorkerCleanup> | WorkerCleanup;

export type HeliumWorkerDef = {
    __kind: "worker";
    __id: string;
    name: string;
    handler: WorkerHandler;
    options: Required<WorkerOptions>;
};

export interface WorkerInstance {
    id: string;
    name: string;
    status: "running" | "stopped" | "crashed" | "restarting";
    startedAt: Date | null;
    restartCount: number;
    lastError?: Error;
    stop: () => Promise<void>;
}

interface WorkerState {
    abortController: AbortController;
    promise: Promise<void>;
    instance: WorkerInstance;
    cleanupHandlers: Array<() => Promise<void> | void>;
    cleanupPromise: Promise<void> | null;
    cleanupRequested: boolean;
}

const runningWorkers = new Map<string, WorkerState>();

function removeWorker(name: string, workerState: WorkerState): void {
    if (runningWorkers.get(name) === workerState) {
        runningWorkers.delete(name);
    }
}

function isCleanupHandler(cleanup: WorkerCleanup): cleanup is () => Promise<void> | void {
    return typeof cleanup === "function";
}

function registerCleanup(name: string, workerState: WorkerState, cleanup: WorkerCleanup) {
    if (!isCleanupHandler(cleanup)) {
        return;
    }

    workerState.cleanupHandlers.push(cleanup);
    // Async setup may finish after stop() has returned. Dispose its resources too.
    if (workerState.cleanupRequested) {
        void runWorkerCleanup(name, workerState);
    }
}

async function runWorkerCleanup(name: string, workerState: WorkerState): Promise<void> {
    workerState.cleanupRequested = true;
    if (workerState.cleanupPromise) {
        await workerState.cleanupPromise;
        if (workerState.cleanupHandlers.length > 0) {
            await runWorkerCleanup(name, workerState);
        }
        return;
    }

    const cleanupPromise = (async () => {
        while (workerState.cleanupHandlers.length > 0) {
            const cleanupHandlers = workerState.cleanupHandlers.splice(0).reverse();
            for (const cleanup of cleanupHandlers) {
                try {
                    await cleanup();
                } catch (error) {
                    log("error", `Worker '${name}' cleanup failed:`, error);
                }
            }
        }
    })();
    workerState.cleanupPromise = cleanupPromise;
    try {
        await cleanupPromise;
    } finally {
        if (workerState.cleanupPromise === cleanupPromise) {
            workerState.cleanupPromise = null;
        }
    }
}

function waitForRestart(signal: AbortSignal, delay: number): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, delay);
        signal.addEventListener("abort", done, { once: true });
    });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
    });
}

/**
 * Create a Helium background worker definition.
 *
 * Workers are long-running background processes that start when the server
 * starts and continue running until the server shuts down. They are ideal for:
 * - Queue consumers (processing jobs from Redis, RabbitMQ, SQS, etc.)
 * - Background task processors
 * - Scheduled jobs and cron-like tasks
 * - Real-time data synchronization
 * - External connection managers
 * - Cache warmers and data pre-loaders
 *
 * @example
 * ```typescript
 * // Basic worker
 * export const queueConsumer = defineWorker(async (ctx) => {
 *     while (true) {
 *         const job = await queue.pop();
 *         if (job) {
 *             await processJob(job);
 *         }
 *         await sleep(1000);
 *     }
 * }, { name: 'queueConsumer' });
 *
 * // Worker with options
 * export const dataSync = defineWorker(async (ctx) => {
 *     // Sync data every 30 seconds
 *     while (true) {
 *         await syncData();
 *         await sleep(30000);
 *     }
 * }, {
 *     name: 'dataSync',
 *     autoRestart: true,
 *     restartDelayMs: 10000,
 *     maxRestarts: 5
 * });
 * ```
 *
 * @param handler - The worker function that runs in the background
 * @param options - Configuration options for the worker
 * @returns A HeliumWorkerDef that will be started by the server runtime
 */
export function defineWorker(handler: WorkerHandler, options: WorkerOptions = {}): HeliumWorkerDef {
    if (!handler) {
        throw new Error("defineWorker requires a handler");
    }

    const name = options.name || handler.name || "anonymous";

    const resolvedOptions: Required<WorkerOptions> = {
        name,
        autoRestart: options.autoRestart ?? true,
        restartDelayMs: options.restartDelayMs ?? 5000,
        maxRestarts: options.maxRestarts ?? 0,
        autoStart: options.autoStart ?? true,
    };

    return {
        __kind: "worker",
        __id: name,
        name,
        handler,
        options: resolvedOptions,
    };
}

/**
 * Start a worker and manage its lifecycle.
 * @internal
 */
export async function startWorker(worker: HeliumWorkerDef, createContext: () => HeliumContext): Promise<WorkerInstance> {
    const { name, handler, options } = worker;

    // Check if worker is already running
    if (runningWorkers.has(name)) {
        const existing = runningWorkers.get(name)!;
        log("warn", `Worker '${name}' is already running`);
        return existing.instance;
    }

    const abortController = new AbortController();
    let restartCount = 0;
    const workerState = {
        abortController,
        promise: Promise.resolve(),
        instance: undefined as unknown as WorkerInstance,
        cleanupHandlers: [] as Array<() => Promise<void> | void>,
        cleanupPromise: null as Promise<void> | null,
        cleanupRequested: false,
    };

    const instance: WorkerInstance = {
        id: name,
        name,
        status: "running",
        startedAt: new Date(),
        restartCount: 0,
        stop: async () => {
            abortController.abort();
            instance.status = "stopped";
            await runWorkerCleanup(name, workerState);
            removeWorker(name, workerState);
            log("info", `Worker '${name}' stopped`);
        },
    };
    workerState.instance = instance;

    const runWorker = async (): Promise<void> => {
        while (!abortController.signal.aborted) {
            try {
                workerState.cleanupRequested = false;
                instance.status = "running";
                instance.startedAt = new Date();
                log("info", `Starting worker '${name}'`);

                const ctx = createContext();
                ctx.signal = abortController.signal;
                const lifecycle: WorkerLifecycle = {
                    signal: abortController.signal,
                    onCleanup: (cleanup) => {
                        registerCleanup(name, workerState, cleanup);
                    },
                };
                const cleanup = await handler(ctx, lifecycle);
                registerCleanup(name, workerState, cleanup);

                if (isCleanupHandler(cleanup) && !abortController.signal.aborted) {
                    await waitForAbort(abortController.signal);
                }

                // Preserve the completion decision if stop() runs during cleanup.
                const completed = !abortController.signal.aborted;
                await runWorkerCleanup(name, workerState);
                if (completed) {
                    log("info", `Worker '${name}' completed successfully`);
                    instance.status = "stopped";
                    removeWorker(name, workerState);
                }
                break;
            } catch (error) {
                if (abortController.signal.aborted) {
                    // Worker was intentionally stopped
                    break;
                }

                await runWorkerCleanup(name, workerState);
                if (abortController.signal.aborted) {
                    break;
                }

                instance.lastError = error instanceof Error ? error : new Error(String(error));
                instance.status = "crashed";
                log("error", `Worker '${name}' crashed:`, error);

                // Check if we should restart
                if (options.autoRestart) {
                    if (options.maxRestarts > 0 && restartCount >= options.maxRestarts) {
                        log("error", `Worker '${name}' exceeded max restarts (${options.maxRestarts}), giving up`);
                        removeWorker(name, workerState);
                        break;
                    }

                    restartCount++;
                    instance.restartCount = restartCount;
                    instance.status = "restarting";
                    log(
                        "info",
                        `Worker '${name}' will restart in ${options.restartDelayMs}ms (attempt ${restartCount}${options.maxRestarts > 0 ? `/${options.maxRestarts}` : ""})`
                    );

                    await waitForRestart(abortController.signal, options.restartDelayMs);
                } else {
                    removeWorker(name, workerState);
                    break;
                }
            }
        }
    };

    // Publish state before invoking user code, including synchronous handlers.
    runningWorkers.set(name, workerState);
    workerState.promise = runWorker();

    return instance;
}

/**
 * Stop a running worker by name.
 */
export function stopWorker(name: string): boolean {
    const worker = runningWorkers.get(name);
    if (worker) {
        void worker.instance.stop();
        return true;
    }
    return false;
}

/**
 * Stop all running workers.
 */
export async function stopAllWorkers(): Promise<void> {
    const workers = Array.from(runningWorkers.values());
    await Promise.all(workers.map((worker) => worker.instance.stop()));
    log("info", `Stopped ${workers.length} worker(s)`);
}

/**
 * Get the status of all workers.
 */
export function getWorkerStatus(): WorkerInstance[] {
    return Array.from(runningWorkers.values()).map((w) => w.instance);
}

/**
 * Get a specific worker's status.
 */
export function getWorkerById(name: string): WorkerInstance | undefined {
    return runningWorkers.get(name)?.instance;
}
