import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheKey, get, invalidateAll, invalidateByMethod, isPending } from "../../src/client/cache";
import { rpcCall } from "../../src/client/rpcClient";
import { useFetch } from "../../src/client/useFetch";

vi.mock("../../src/client/rpcClient", () => ({ rpcCall: vi.fn() }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

type Result = { data: string; stats: { remainingRequests: number; resetInSeconds: number } };
const stats = { remainingRequests: 10, resetInSeconds: 1 };
const method = { __kind: "method" as const, __id: "query", handler: (_args: unknown) => "" };

describe("useFetch request lifecycle", () => {
    beforeEach(() => {
        invalidateAll();
        vi.mocked(rpcCall).mockReset();
    });

    afterEach(() => {
        cleanup();
        invalidateAll();
    });

    it("ignores an earlier argument response after a newer query has completed", async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook(({ id }) => useFetch(method, { id }), { initialProps: { id: 1 } });
        rerender({ id: 2 });
        await act(async () => second.resolve({ data: "second", stats }));
        expect(result.current.data).toBe("second");
        await act(async () => first.resolve({ data: "first", stats }));
        expect(result.current.data).toBe("second");
        expect(get(cacheKey(method.__id, { id: 1 }))).toBe("first");
        expect(get(cacheKey(method.__id, { id: 2 }))).toBe("second");
    });

    it("does not let an old response clear loading or expose old data for a new query", async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook(({ id }) => useFetch(method, { id }), { initialProps: { id: 1 } });
        rerender({ id: 2 });
        await act(async () => first.resolve({ data: "first", stats }));
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeUndefined();
        await act(async () => second.resolve({ data: "second", stats }));
        expect(result.current.isLoading).toBe(false);
    });

    it("keeps a replacement pending request and cache after invalidation", async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result } = renderHook(() => useFetch(method));
        act(() => invalidateByMethod(method.__id));
        expect(rpcCall).toHaveBeenCalledTimes(2);
        await act(async () => first.resolve({ data: "stale", stats }));
        expect(isPending(cacheKey(method.__id, undefined))).toBe(true);
        expect(result.current.data).toBeUndefined();
        await act(async () => second.resolve({ data: "fresh", stats }));
        expect(result.current.data).toBe("fresh");
        expect(get(cacheKey(method.__id, undefined))).toBe("fresh");
    });

    it("refreshes pending-only queries when all cache entries are invalidated", async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result } = renderHook(() => useFetch(method));
        act(() => invalidateAll());
        expect(rpcCall).toHaveBeenCalledTimes(2);
        await act(async () => second.resolve({ data: "fresh", stats }));
        await act(async () => first.resolve({ data: "stale", stats }));
        expect(result.current.data).toBe("fresh");
        expect(get(cacheKey(method.__id, undefined))).toBe("fresh");
    });

    it("handles a rejected shared fetch without an unhandled cleanup rejection", async () => {
        const request = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(request.promise);
        const { result } = renderHook(() => ({ first: useFetch(method), second: useFetch(method) }));
        expect(rpcCall).toHaveBeenCalledTimes(1);
        await act(async () => request.reject(new Error("Query failed")));
        expect(result.current.first.error).toBe("Query failed");
        expect(result.current.second.error).toBe("Query failed");
        expect(isPending(cacheKey(method.__id, undefined))).toBe(false);
    });
    it("restores cached data when a query is re-enabled after its disabled request completed", async () => {
        const request = deferred<Result>();
        vi.mocked(rpcCall).mockReturnValueOnce(request.promise);
        const { result, rerender } = renderHook(({ enabled }) => useFetch(method, undefined, { enabled }), {
            initialProps: { enabled: true },
        });
        rerender({ enabled: false });
        await act(async () => request.resolve({ data: "cached while disabled", stats }));
        expect(result.current.data).toBeUndefined();
        rerender({ enabled: true });
        expect(result.current.data).toBe("cached while disabled");
        expect(result.current.isLoading).toBe(false);
        expect(rpcCall).toHaveBeenCalledTimes(1);
    });
});
