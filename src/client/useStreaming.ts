import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { RpcError } from "./RpcError.js";
import { streamRpc } from "./rpcStreaming.js";
import type { MethodStub } from "./types.js";

export type UseStreamingOptions<TChunk> = {
    onChunk?: (chunk: TChunk) => void;
    onComplete?: () => void;
    onError?: (message: string) => void;
    /** Maximum idle time in milliseconds, including waiting for the first chunk. Default: 120000. */
    timeoutMs?: number;
};

type StreamingState<TChunk> = {
    chunks: TChunk[];
    /** Concatenation of string chunks; structured chunks are available through chunks. */
    text: string;
    isStreaming: boolean;
    error: string | null;
    stats: RpcStats | null;
};

function emptyState<TChunk>(): StreamingState<TChunk> {
    return { chunks: [], text: "", isStreaming: false, error: null, stats: null };
}

type ActiveStream<TChunk> = { controller: AbortController; method: string; chunks: TChunk[]; text: string };

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function notify<TArgs extends unknown[]>(name: string, callback: ((...args: TArgs) => void) | undefined, ...args: TArgs): void {
    if (!callback) {
        return;
    }
    const report = (error: unknown) => console.error(`useStreaming ${name} callback failed`, error);
    try {
        const result: unknown = callback(...args);
        if (result && typeof (result as { then?: unknown }).then === "function") {
            void Promise.resolve(result).catch(report);
        }
    } catch (error) {
        report(error);
    }
}

/**
 * Consume a method that returns an async iterable. A new start replaces the old
 * stream; cancellation preserves partial output, while reset also clears it.
 * RPC failures are exposed through error/onError, without replaying the stream.
 */
export function useStreaming<TArgs, TChunk>(method: MethodStub<TArgs, AsyncIterable<TChunk>>, options: UseStreamingOptions<TChunk> = {}) {
    const [state, setState] = useState<StreamingState<TChunk>>(emptyState);
    const methodRef = useRef(method.__id);
    const optionsRef = useRef(options);
    const mountedRef = useRef(true);
    const activeRef = useRef<ActiveStream<TChunk> | null>(null);
    const previousMethodRef = useRef(method.__id);
    methodRef.current = method.__id;
    optionsRef.current = options;

    const cancel = useCallback(() => {
        const active = activeRef.current;
        activeRef.current = null;
        active?.controller.abort();
        if (mountedRef.current) {
            setState((previous) => ({ ...previous, ...(active ? { chunks: active.chunks.slice(), text: active.text } : {}), isStreaming: false }));
        }
    }, []);

    const reset = useCallback(() => {
        activeRef.current?.controller.abort();
        activeRef.current = null;
        if (mountedRef.current) {
            setState(emptyState());
        }
    }, []);

    useClientLayoutEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            activeRef.current?.controller.abort();
            activeRef.current = null;
        };
    }, []);

    useClientLayoutEffect(() => {
        // Switching the method invalidates output and pending work from its predecessor.
        if (previousMethodRef.current !== method.__id) {
            previousMethodRef.current = method.__id;
            reset();
        }
    }, [method.__id, reset]);

    const start = useCallback(async (args: TArgs): Promise<void> => {
        if (!mountedRef.current) {
            return;
        }
        activeRef.current?.controller.abort();
        const active: ActiveStream<TChunk> = { controller: new AbortController(), method: methodRef.current, chunks: [], text: "" };
        activeRef.current = active;
        const current = () => mountedRef.current && activeRef.current === active && methodRef.current === active.method && !active.controller.signal.aborted;
        setState({ ...emptyState(), isStreaming: true });
        let flushScheduled = false;
        const flush = () => {
            flushScheduled = false;
            if (current()) {
                setState((previous) => ({ ...previous, chunks: active.chunks.slice(), text: active.text }));
            }
        };
        try {
            const stats = await streamRpc<TArgs, TChunk>(active.method, args, {
                signal: active.controller.signal,
                timeoutMs: optionsRef.current.timeoutMs ?? 120_000,
                onChunk: (chunk) => {
                    if (!current()) {
                        return;
                    }
                    active.chunks.push(chunk);
                    if (typeof chunk === "string") {
                        active.text += chunk;
                    }
                    // Multiple frames in one network read produce one state snapshot.
                    if (!flushScheduled) {
                        flushScheduled = true;
                        queueMicrotask(flush);
                    }
                    notify("onChunk", optionsRef.current.onChunk, chunk);
                },
            });
            if (current()) {
                setState({ chunks: active.chunks.slice(), text: active.text, isStreaming: false, error: null, stats });
                notify("onComplete", optionsRef.current.onComplete);
            }
        } catch (error) {
            if (current()) {
                const failure = error instanceof RpcError ? error : new RpcError(error instanceof Error ? error.message : "Streaming request failed");
                setState({ chunks: active.chunks.slice(), text: active.text, isStreaming: false, error: failure.message, stats: failure.stats });
                notify("onError", optionsRef.current.onError, failure.message);
            }
        } finally {
            if (activeRef.current === active) {
                activeRef.current = null;
                if (mountedRef.current) {
                    setState((previous) => ({ ...previous, isStreaming: false }));
                }
            }
        }
    }, []);

    return { ...state, start, cancel, reset };
}
