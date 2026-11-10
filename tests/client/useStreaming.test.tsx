import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RpcError } from "../../src/client/RpcError";
import { streamRpc } from "../../src/client/rpcStreaming";
import { useStreaming } from "../../src/client/useStreaming";
import type { RpcStats } from "../../src/runtime/protocol";

import { methodReference } from "./methodReference";

vi.mock("../../src/client/rpcStreaming", () => ({ streamRpc: vi.fn() }));
const stats: RpcStats = { remainingRequests: 5, resetInSeconds: 10 };
const method = methodReference<{ prompt: string }, AsyncIterable<string>>("generate");
type Request = {
    method: string;
    args: unknown;
    signal: AbortSignal;
    timeoutMs: number;
    emit: (chunk: unknown) => void;
    done: () => void;
    fail: (error: Error) => void;
};
let requests: Request[] = [];

beforeEach(() => {
    requests = [];
    vi.mocked(streamRpc).mockImplementation(
        (method, args, options) =>
            new Promise<RpcStats>((resolve, reject) => {
                requests.push({
                    method,
                    args,
                    signal: options.signal,
                    timeoutMs: options.timeoutMs,
                    emit: (value) => options.onChunk(value as never),
                    done: () => resolve(stats),
                    fail: reject,
                });
            })
    );
});
afterEach(async () => {
    cleanup();
    await act(async () => {
        requests.forEach((request) => request.done());
    });
    vi.mocked(streamRpc).mockReset();
});

describe("useStreaming", () => {
    it("supports layout-effect startup under StrictMode without cancelling the current run", async () => {
        const { result } = renderHook(
            () => {
                const stream = useStreaming(method);
                useLayoutEffect(() => {
                    void stream.start({ prompt: "layout" });
                }, [stream.start]);
                return stream;
            },
            { wrapper: StrictMode }
        );
        expect(requests).toHaveLength(2);
        expect(requests[0].signal.aborted).toBe(true);
        expect(requests[1].signal.aborted).toBe(false);
        await act(async () => requests[1].emit("current"));
        expect(result.current).toMatchObject({ text: "current", isStreaming: true });
    });

    it("reports callback exceptions without turning successful output into a transport error", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const onError = vi.fn();
        const { result } = renderHook(() =>
            useStreaming(method, {
                onChunk: () => {
                    throw new Error("chunk callback");
                },
                onComplete: async () => {
                    throw new Error("completion callback");
                },
                onError,
            })
        );
        let completion!: Promise<void>;
        act(() => {
            completion = result.current.start({ prompt: "test" });
        });
        await act(async () => {
            requests[0].emit("success");
            requests[0].done();
            await completion;
        });
        expect(result.current).toMatchObject({ text: "success", error: null, stats, isStreaming: false });
        expect(onError).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it("shows incremental text before completion, invokes callbacks, and exposes final stats", async () => {
        const onChunk = vi.fn();
        const onComplete = vi.fn();
        const { result } = renderHook(() => useStreaming(method, { onChunk, onComplete }));
        let completion!: Promise<void>;
        act(() => {
            completion = result.current.start({ prompt: "Hello" });
        });
        expect(result.current.isStreaming).toBe(true);
        expect(requests[0]).toMatchObject({ method: "generate", args: { prompt: "Hello" }, timeoutMs: 120_000 });
        await act(async () => {
            requests[0].emit("Olá ");
            requests[0].emit("👋");
        });
        expect(result.current.text).toBe("Olá 👋");
        expect(result.current.chunks).toEqual(["Olá ", "👋"]);
        expect(result.current.isStreaming).toBe(true);
        expect(onChunk.mock.calls).toEqual([["Olá "], ["👋"]]);
        expect(onComplete).not.toHaveBeenCalled();
        await act(async () => {
            requests[0].done();
            await completion;
        });
        expect(result.current).toMatchObject({ isStreaming: false, error: null, stats, text: "Olá 👋" });
        expect(onComplete).toHaveBeenCalledOnce();
    });

    it("supports structured chunks without coercing them into text", async () => {
        const structured = methodReference<{ prompt: string }, AsyncIterable<{ token: string; index: number }>>("events");
        const { result } = renderHook(() => useStreaming(structured));
        act(() => {
            void result.current.start({ prompt: "test" });
        });
        await act(async () => requests[0].emit({ token: "a", index: 1 }));
        expect(result.current.chunks[0].token).toBe("a");
        expect(result.current.text).toBe("");
    });

    it("aborts replaced streams and ignores late chunks, errors, and completion", async () => {
        const onError = vi.fn();
        const onComplete = vi.fn();
        const { result } = renderHook(() => useStreaming(method, { onError, onComplete }));
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = result.current.start({ prompt: "first" });
        });
        await act(async () => requests[0].emit("old"));
        act(() => {
            second = result.current.start({ prompt: "second" });
        });
        expect(requests[0].signal.aborted).toBe(true);
        expect(result.current.text).toBe("");
        await act(async () => {
            requests[0].emit("stale");
            requests[0].fail(new Error("old failure"));
            requests[1].emit("new");
            await first;
        });
        expect(result.current).toMatchObject({ text: "new", isStreaming: true, error: null });
        expect(onError).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        await act(async () => {
            requests[1].done();
            await second;
        });
        expect(onComplete).toHaveBeenCalledOnce();
    });

    it("cancels while preserving all partial output, and reset clears it", async () => {
        const onComplete = vi.fn();
        const onError = vi.fn();
        const { result } = renderHook(() => useStreaming(method, { onComplete, onError }));
        act(() => {
            void result.current.start({ prompt: "test" });
        });
        // Cancellation before the queued state flush must preserve this chunk too.
        act(() => {
            requests[0].emit("partial");
            result.current.cancel();
        });
        expect(requests[0].signal.aborted).toBe(true);
        expect(result.current).toMatchObject({ chunks: ["partial"], text: "partial", isStreaming: false, error: null });
        await act(async () => {
            requests[0].emit("late");
            requests[0].done();
        });
        expect(result.current.text).toBe("partial");
        expect(onComplete).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        act(() => result.current.reset());
        expect(result.current).toMatchObject({ chunks: [], text: "", isStreaming: false, stats: null, error: null });
    });

    it("surfaces an error after partial output without rejecting start or calling onComplete", async () => {
        const onError = vi.fn();
        const onComplete = vi.fn();
        const { result } = renderHook(() => useStreaming(method, { onError, onComplete }));
        let completion!: Promise<void>;
        act(() => {
            completion = result.current.start({ prompt: "test" });
        });
        await act(async () => {
            requests[0].emit("partial");
            requests[0].fail(new RpcError("Provider unavailable", stats));
            await completion;
        });
        expect(result.current).toMatchObject({ text: "partial", chunks: ["partial"], error: "Provider unavailable", stats, isStreaming: false });
        expect(onError).toHaveBeenCalledWith("Provider unavailable");
        expect(onComplete).not.toHaveBeenCalled();
    });

    it("cancels on unmount under StrictMode and ignores subsequent notifications", async () => {
        const onChunk = vi.fn();
        const onError = vi.fn();
        const onComplete = vi.fn();
        const { result, unmount } = renderHook(() => useStreaming(method, { onChunk, onError, onComplete }), { wrapper: StrictMode });
        act(() => {
            void result.current.start({ prompt: "test" });
        });
        expect(requests).toHaveLength(1);
        unmount();
        expect(requests[0].signal.aborted).toBe(true);
        await act(async () => {
            requests[0].emit("late");
            requests[0].done();
        });
        expect(onChunk).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it("resets and cancels when the method changes", async () => {
        const other = { ...method, __id: "other" };
        const { result, rerender } = renderHook(({ definition }) => useStreaming(definition), { initialProps: { definition: method } });
        act(() => {
            void result.current.start({ prompt: "test" });
        });
        await act(async () => requests[0].emit("old"));
        rerender({ definition: other });
        expect(requests[0].signal.aborted).toBe(true);
        expect(result.current).toMatchObject({ chunks: [], text: "", isStreaming: false });
        await act(async () => {
            requests[0].emit("stale");
            requests[0].done();
        });
        expect(result.current.text).toBe("");
        act(() => {
            void result.current.start({ prompt: "new" });
        });
        expect(requests[1].method).toBe("other");
    });

    it("supports callback updates and a new stream started from onComplete", async () => {
        const initial = vi.fn();
        const latest = vi.fn();
        const { result, rerender } = renderHook(
            ({ onChunk }) =>
                useStreaming(method, {
                    onChunk,
                    timeoutMs: 5000,
                    onComplete: () => {
                        if (requests.length === 1) void result.current.start({ prompt: "second" });
                    },
                }),
            { initialProps: { onChunk: initial } }
        );
        act(() => {
            void result.current.start({ prompt: "first" });
        });
        expect(requests[0].timeoutMs).toBe(5000);
        rerender({ onChunk: latest });
        await act(async () => {
            requests[0].emit("first");
            requests[0].done();
        });
        expect(initial).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledWith("first");
        expect(requests).toHaveLength(2);
        expect(result.current).toMatchObject({ text: "", isStreaming: true });
        await act(async () => requests[1].done());
        expect(result.current.isStreaming).toBe(false);
    });
});
