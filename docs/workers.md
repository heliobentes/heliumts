# Background Workers

## Overview

HeliumTS provides `defineWorker` for creating long-running background processes that start when the server starts and continue running until the server shuts down. This is ideal for:

- Queue consumers (Redis, RabbitMQ, SQS, etc.)
- Background task processors
- Scheduled jobs and cron-like tasks
- Real-time data synchronization
- Cache warmers and data pre-loaders
- WebSocket connection managers

Workers eliminate the need for separate microservices or monorepo setups like Turborepo - everything runs in the same process, sharing the same code, services, types, and models.

## Basic Usage

Create a worker file in your `src/server` directory:

**Server (`src/server/workers/queueConsumer.ts`):**

```typescript
import { defineWorker } from "heliumts/server";

export const queueConsumer = defineWorker(
    async (ctx) => {
        console.log("Queue consumer started");

        while (true) {
            // Poll for jobs
            const job = await queue.pop();

            if (job) {
                await processJob(job);
            }

            // Wait before polling again
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    },
    { name: "queueConsumer" }
);
```

When the server starts, you'll see:

```
Starting worker 'queueConsumer'
```

## Worker Options

```typescript
interface WorkerOptions {
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

interface WorkerLifecycle {
    signal: AbortSignal;
    onCleanup(cleanup: () => Promise<void> | void): void;
}
```

The worker handler receives `ctx` as the first argument and a lifecycle object as the second:

```typescript
type WorkerHandler = (
    ctx: HeliumContext,
    lifecycle: WorkerLifecycle
) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void) | void;
```

Use the lifecycle object for long-running resources:

- `signal` is aborted when Helium stops the worker during shutdown or hot reload.
- `onCleanup(...)` registers teardown logic for change streams, intervals, event listeners, queue consumers, and similar resources.
- Returning a cleanup function is shorthand for workers that start background resources and should stay alive until Helium aborts them.

### Example with Options

```typescript
import { defineWorker } from "heliumts/server";

export const dataSync = defineWorker(
    async (ctx, { signal }) => {
        while (true) {
            if (signal.aborted) {
                break;
            }
            await syncDataFromExternalAPI();
            await new Promise((resolve) => setTimeout(resolve, 30000)); // Every 30 seconds
        }
    },
    {
        name: "dataSync",
        autoRestart: true,
        restartDelayMs: 10000, // Wait 10 seconds before restarting
        maxRestarts: 5, // Give up after 5 restart attempts
    }
);
```

## Use Cases

### Queue Consumer (Redis/BullMQ)

```typescript
import { defineWorker } from "heliumts/server";
import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";

export const emailQueueConsumer = defineWorker(
    async (ctx, { onCleanup }) => {
        const worker = new Worker(
            "email-queue",
            async (job) => {
                const { to, subject, body } = job.data;
                await sendEmail(to, subject, body);
            },
            { connection: redis }
        );

        worker.on("completed", (job) => {
            console.log(`Email job ${job.id} completed`);
        });

        worker.on("failed", (job, err) => {
            console.error(`Email job ${job?.id} failed:`, err);
        });

        onCleanup(() => worker.close());

        // Keep the worker running
        await new Promise(() => {});
    },
    { name: "emailQueueConsumer" }
);
```

### Scheduled Tasks (Cron-like)

```typescript
import { defineWorker } from "heliumts/server";

export const dailyCleanup = defineWorker(
    async (ctx) => {
        while (true) {
            const now = new Date();

            // Run at midnight
            if (now.getHours() === 0 && now.getMinutes() === 0) {
                console.log("Running daily cleanup...");
                await cleanupOldRecords();
                await pruneExpiredSessions();
                await generateDailyReport();
            }

            // Check every minute
            await new Promise((resolve) => setTimeout(resolve, 60000));
        }
    },
    { name: "dailyCleanup" }
);
```

### Real-time Data Sync

```typescript
import { defineWorker } from "heliumts/server";

export const priceSync = defineWorker(
    (ctx) => {
        const ws = new WebSocket("wss://api.exchange.com/prices");

        ws.on("message", async (data) => {
            const prices = JSON.parse(data.toString());
            await updatePricesInDatabase(prices);
            await notifySubscribers(prices);
        });

        ws.on("close", () => {
            throw new Error("WebSocket connection closed");
        });

        return () => ws.close();
    },
    {
        name: "priceSync",
        autoRestart: true,
        restartDelayMs: 5000,
    }
);
```

### MongoDB Change Stream Cleanup

```typescript
import { defineWorker } from "heliumts/server";

export const orderWatcher = defineWorker(
    (_ctx, { onCleanup }) => {
        const stream = OrderModel.watch();

        stream.on("change", async (change) => {
            await enqueueOrderSync(change.documentKey?._id?.toString());
        });

        onCleanup(async () => {
            await stream.close();
        });
    },
    { name: "orderWatcher" }
);
```

In `helium dev`, Helium runs cleanup before starting the replacement worker after a hot reload, so only one watcher instance remains active.

### Cache Warmer

```typescript
import { defineWorker } from "heliumts/server";

export const cacheWarmer = defineWorker(
    async (ctx) => {
        // Initial warm-up
        console.log("Warming up cache...");
        await warmupProductCache();
        await warmupUserCache();
        await warmupConfigCache();

        // Periodic refresh
        while (true) {
            await new Promise((resolve) => setTimeout(resolve, 300000)); // Every 5 minutes
            await refreshHotCache();
        }
    },
    { name: "cacheWarmer" }
);
```

### SQS Consumer (AWS)

```typescript
import { defineWorker } from "heliumts/server";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: "us-east-1" });
const queueUrl = process.env.SQS_QUEUE_URL!;

export const sqsConsumer = defineWorker(
    async (ctx) => {
        while (true) {
            const { Messages } = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 20, // Long polling
                })
            );

            if (Messages) {
                for (const message of Messages) {
                    try {
                        await processMessage(JSON.parse(message.Body!));
                        await sqs.send(
                            new DeleteMessageCommand({
                                QueueUrl: queueUrl,
                                ReceiptHandle: message.ReceiptHandle,
                            })
                        );
                    } catch (error) {
                        console.error("Failed to process message:", error);
                    }
                }
            }
        }
    },
    { name: "sqsConsumer" }
);
```

### Pub/Sub Subscriber (Redis)

```typescript
import { defineWorker } from "heliumts/server";
import Redis from "ioredis";

export const pubsubSubscriber = defineWorker(
    async (ctx) => {
        const subscriber = new Redis(process.env.REDIS_URL);

        subscriber.subscribe("notifications", "updates");

        subscriber.on("message", async (channel, message) => {
            const data = JSON.parse(message);

            switch (channel) {
                case "notifications":
                    await handleNotification(data);
                    break;
                case "updates":
                    await handleUpdate(data);
                    break;
            }
        });

        // Keep the subscriber running
        await new Promise(() => {});
    },
    { name: "pubsubSubscriber" }
);
```

## Context Access

Workers receive a `HeliumContext` object, similar to RPC methods:

```typescript
import { defineWorker } from "heliumts/server";

export const contextExample = defineWorker(
    async (ctx) => {
        // Access context properties
        console.log("Worker context:", ctx);

        // You can add custom properties via middleware
        const db = ctx.db; // If set by middleware

        while (true) {
            await performTask(db);
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    },
    { name: "contextExample" }
);
```

## Error Handling

Workers automatically handle errors with configurable restart behavior:

```typescript
import { defineWorker } from "heliumts/server";

export const resilientWorker = defineWorker(
    async (ctx) => {
        while (true) {
            try {
                await riskyOperation();
            } catch (error) {
                console.error("Operation failed:", error);
                // The worker continues running
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    },
    { name: "resilientWorker" }
);

// If the entire worker crashes, it will restart automatically
export const crashingWorker = defineWorker(
    async (ctx) => {
        // This will crash and restart up to 3 times
        throw new Error("Something went wrong!");
    },
    {
        name: "crashingWorker",
        autoRestart: true,
        maxRestarts: 3,
        restartDelayMs: 5000,
    }
);
```

## Graceful Shutdown

Workers are automatically stopped when the server shuts down (SIGINT/SIGTERM):

```
^C
Shutting down...
Stopped 3 worker(s)
Server closed
```

## Multiple Workers

You can define multiple workers in the same file or across different files:

**Server (`src/server/workers/index.ts`):**

```typescript
import { defineWorker } from "heliumts/server";

export const worker1 = defineWorker(
    async (ctx) => {
        // Worker 1 logic
    },
    { name: "worker1" }
);

export const worker2 = defineWorker(
    async (ctx) => {
        // Worker 2 logic
    },
    { name: "worker2" }
);

export const worker3 = defineWorker(
    async (ctx) => {
        // Worker 3 logic
    },
    { name: "worker3" }
);
```

Startup output:

```
Starting worker 'worker1'
Starting worker 'worker2'
Starting worker 'worker3'
```

## Best Practices

1. **Use descriptive names**: Give workers meaningful names for easy identification in logs
2. **Handle errors gracefully**: Catch errors within your worker loop to prevent unnecessary restarts
3. **Use appropriate restart settings**: Set `maxRestarts` to prevent infinite restart loops
4. **Clean up resources**: If your worker allocates resources (connections, file handles), clean them up on errors
5. **Log important events**: Add logging for visibility into worker behavior
6. **Use long polling**: For queue consumers, use long polling to reduce CPU usage
7. **Monitor worker health**: Use `getWorkerStatus()` to monitor worker states

## TypeScript Support

Workers are fully typed:

```typescript
import { defineWorker, WorkerOptions, HeliumWorkerDef } from "heliumts/server";

const options: WorkerOptions = {
    name: "typedWorker",
    autoRestart: true,
    maxRestarts: 5,
};

export const typedWorker: HeliumWorkerDef = defineWorker(async (ctx) => {
    // Fully typed worker
}, options);
```

## Why Workers Instead of Monorepos?

Traditional approaches require:

- Separate repositories or monorepo tools (Turborepo, Nx)
- Separate deployment pipelines
- Code duplication or complex package sharing
- Multiple running processes

With Helium workers:

- **Single codebase**: Everything in one place
- **Shared code**: Workers use the same services, types, and models as your RPC methods
- **Single deployment**: Deploy once, run everything
- **Simplified architecture**: No inter-service communication needed
- **Type safety**: Full TypeScript support across the entire application

## Related Documentation

- [Context API](./context-api.md) - Access request metadata in workers
- [Configuration](./helium-config.md) - Configure server settings
- [Production Deployment](./production-deployment.md) - Deploy workers to production
