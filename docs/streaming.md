# Streaming server methods

`useStreaming` consumes typed chunks from a method that returns an async iterable. It manages the HTTP request, incremental decoding, cancellation, and component state. It starts only when you call `start(args)`.

## Define a streamed method

Keep the implementation in `src/server` and use the existing `defineMethod` API with an async generator:

```ts
// src/server/answers.ts
import { setTimeout as delay } from "node:timers/promises";
import { defineMethod, PublicError } from "heliumts/server";

export const generateAnswer = defineMethod(async function* (
    { prompt }: { prompt: string },
    ctx,
) {
    if (!prompt.trim()) throw new PublicError("Enter a prompt.");
    for (const word of `You asked: ${prompt}`.split(" ")) {
        await delay(100, undefined, { signal: ctx.signal });
        yield word + " ";
    }
});
```

This deterministic example runs without an LLM service or credentials. Yield strings for text or serializable objects for structured events. Method arguments and chunk types are inferred from the server definition.

## Render incremental output

```tsx
import { useStreaming } from "heliumts/client";
import { generateAnswer } from "heliumts/server";

export default function Answer() {
    const { text, isStreaming, error, start, cancel, reset } = useStreaming(generateAnswer);
    return (
        <section>
            <button onClick={() => void start({ prompt: "Hello" })}>
                {isStreaming ? "Start again" : "Generate"}
            </button>
            <button disabled={!isStreaming} onClick={cancel}>Stop</button>
            <button onClick={reset}>Clear</button>
            <pre aria-live="polite">{text}</pre>
            {error && <p role="alert">{error}</p>}
        </section>
    );
}
```

| Returned value | Meaning |
| --- | --- |
| `chunks` | Array of typed chunks received in the current run. |
| `text` | Concatenation of string chunks. Structured chunks remain in `chunks`. |
| `isStreaming` | Whether the current request is active. |
| `error` | Error message, or `null`. Partial output remains visible after failure. |
| `stats` | Rate-limit statistics from completion or a terminal server error, or `null`. |
| `start(args)` | Clears prior output, cancels the prior run, and starts a new one. Returns `Promise<void>`; request failures appear in state and `onError`. |
| `cancel()` | Stops the current request and preserves partial output. |
| `reset()` | Stops the request and clears output, errors, and stats. |

Changing the method or unmounting cancels pending work. Late responses from an older run cannot overwrite the current run. The hook is safe to import in SSR/SSG pages; call `start` from browser event handlers or effects, never during server rendering.

## Options

```tsx
const stream = useStreaming(generateAnswer, {
    timeoutMs: 120_000,
    onChunk(chunk) { console.log(chunk); },
    onComplete() { console.log("Finished"); },
    onError(message) { console.error(message); },
});
```

`timeoutMs` is the maximum idle time, including waiting for headers and the first output. It must be positive, finite, and at most 2,147,483,647 ms; it defaults to 120,000 ms. Receiving bytes resets the idle timer; it is not a total generation deadline. `onComplete` runs only after successful completion; cancellation is not an error. Callbacks are notifications; asynchronous callback work is not awaited by the stream.

## Integrating an LLM provider

Wrap the provider SDK's async text iterator in `defineMethod` and yield each text delta. Pass `ctx.signal` to the provider's cancellation option. The exact provider method and option names depend on its SDK; the following adapter placeholder is application code, not a Helium export:

```ts
import { defineMethod } from "heliumts/server";
import { createProviderTextStream } from "../libs/your-provider";

export const generateAnswer = defineMethod(async function* (
    { prompt }: { prompt: string },
    ctx,
) {
    const deltas = await createProviderTextStream({ prompt, signal: ctx.signal });
    for await (const text of deltas) {
        yield text;
    }
});
```

Implement that adapter using your provider's documented streaming API. Provider keys and SDK imports stay in server code. Application middleware still authorizes the method before execution. Use `finally` to close provider resources when applicable.

Cancellation is cooperative: Helium aborts `ctx.signal` and requests iterator cleanup, but arbitrary provider code must observe that signal to stop work promptly. A generation may already have incurred provider usage before cancellation. Completed streams are not cached, and ordinary `useCall`, `useFetch`, and `callMethod` do not consume async iterables.

## Errors, limits, and deployment

Streams use their own authenticated HTTP requests, outside ordinary RPC batches. They share per-IP request limits and request-body bounds with other RPC calls. A frame is capped at 10 MiB. Ordinary errors are sanitized in production; use `PublicError` or an error marked `public: true` for intended user messages.

A provider can fail after yielding some chunks. The hook keeps those chunks, sets `error`, and skips `onComplete`. Truncated, malformed, or stalled responses are errors. Streams are never automatically replayed after execution; restarting is an explicit application choice.

Helium flushes stream headers, respects HTTP backpressure, and sets `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no`. Configure reverse proxies to forward chunks immediately and allow an appropriate idle timeout. Verify delivery on the deployed host: providers and proxies can still buffer output. Normal RPC responses continue to negotiate HTTP compression; streamed responses do not buffer an entire generation for compression.
