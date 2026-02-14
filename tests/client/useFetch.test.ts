import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { get, getPendingFetch, has, isPending, set, setPendingFetch, subscribeInvalidations } from "../../src/client/cache";
import { rpcCall } from "../../src/client/rpcClient";
import { RpcError } from "../../src/client/RpcError";
import { useFetch } from "../../src/client/useFetch";

// Mock rpcClient
vi.mock("../../src/client/rpcClient", () => ({
    rpcCall: vi.fn(),
}));

// Mock cache
vi.mock("../../src/client/cache", () => ({
    cacheKey: vi.fn((methodId: string, args: unknown) => `${methodId}:${JSON.stringify(args)}`),
    get: vi.fn(),
    has: vi.fn(() => false),
    set: vi.fn(),
    subscribeInvalidations: vi.fn(() => () => {}),
    invalidateAll: vi.fn(),
    isPending: vi.fn(() => false),
    getPendingFetch: vi.fn(() => undefined),
    setPendingFetch: vi.fn((key: string, promise: Promise<unknown>) => promise),
    clearPendingFetch: vi.fn(),
}));

describe("useFetch", () => {
    const mockMethod = { __id: "testMethod" } as { __id: string };
    const mockRpcCall = rpcCall as ReturnType<typeof vi.fn>;
    const mockHas = has as ReturnType<typeof vi.fn>;
    const mockGet = get as ReturnType<typeof vi.fn>;
    const mockGetPendingFetch = getPendingFetch as ReturnType<typeof vi.fn>;
    const mockIsPending = isPending as ReturnType<typeof vi.fn>;
    const mockSet = set as ReturnType<typeof vi.fn>;
    const mockSetPendingFetch = setPendingFetch as ReturnType<typeof vi.fn>;
    const mockSubscribe = subscribeInvalidations as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockHas.mockReturnValue(false);
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it("should return initial loading state when cache is empty", () => {
        mockRpcCall.mockReturnValue(new Promise(() => {})); // Never resolves

        const { result } = renderHook(() => useFetch(mockMethod));

        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBeNull();
        expect(typeof result.current.refetch).toBe("function");
    });

    it("should return cached data immediately if available", () => {
        const cachedData = { result: "cached" };
        mockHas.mockReturnValue(true);
        mockGet.mockReturnValue(cachedData);

        const { result } = renderHook(() => useFetch(mockMethod));

        expect(result.current.data).toEqual(cachedData);
        expect(result.current.isLoading).toBe(false);
    });

    it("should fetch data and cache it", async () => {
        const mockData = { result: "fresh" };
        const mockStats = { remainingRequests: 100, resetInSeconds: 60 };

        mockRpcCall.mockResolvedValueOnce({
            data: mockData,
            stats: mockStats,
        });

        const { result } = renderHook(() => useFetch(mockMethod, { id: 1 }));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.data).toEqual(mockData);
        expect(result.current.stats).toEqual(mockStats);
        expect(mockSet).toHaveBeenCalled();
    });

    it("should set error on fetch failure", async () => {
        mockRpcCall.mockRejectedValueOnce(new RpcError("Fetch failed", { remainingRequests: 0, resetInSeconds: 30 }));

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBe("Fetch failed");
    });

    it("should not fetch when enabled is false", () => {
        const { result } = renderHook(() => useFetch(mockMethod, undefined, { enabled: false }));

        expect(mockRpcCall).not.toHaveBeenCalled();
        expect(result.current.isLoading).toBe(false);
    });

    it("should refetch when calling refetch()", async () => {
        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Clear the mock to track new calls
        mockRpcCall.mockClear();

        await act(async () => {
            await result.current.refetch();
        });

        expect(mockRpcCall).toHaveBeenCalledTimes(1);
    });

    it("should subscribe to invalidations", async () => {
        // Need to set up valid rpcCall mock for the initial fetch
        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(mockSubscribe).toHaveBeenCalled();
    });

    it("should refetch on method invalidation", async () => {
        let invalidationCallback: ((methodId: string) => void) | null = null;

        mockSubscribe.mockImplementation((callback) => {
            invalidationCallback = callback;
            return () => {};
        });

        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        mockRpcCall.mockClear();

        // Trigger invalidation
        await act(async () => {
            invalidationCallback?.("testMethod");
        });

        // Should have refetched
        expect(mockRpcCall).toHaveBeenCalled();
    });

    it("should use TTL option when caching", async () => {
        const mockData = { result: "data" };
        mockRpcCall.mockResolvedValueOnce({
            data: mockData,
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod, undefined, { ttl: 5000 }));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // set should be called with TTL
        expect(mockSet).toHaveBeenCalledWith(expect.any(String), mockData, 5000);
    });

    it("should return stats from response", async () => {
        const mockStats = { remainingRequests: 50, resetInSeconds: 120 };
        mockRpcCall.mockResolvedValueOnce({
            data: {},
            stats: mockStats,
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.stats).toEqual(mockStats);
    });

    it("should not refetch for unrelated method invalidation", async () => {
        let invalidationCallback: ((methodId: string) => void) | null = null;

        mockSubscribe.mockImplementation((callback) => {
            invalidationCallback = callback;
            return () => {};
        });

        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        mockRpcCall.mockClear();

        // Trigger invalidation for a DIFFERENT method
        await act(async () => {
            invalidationCallback?.("otherMethod");
        });

        // Should NOT have refetched since methodId doesn't match
        expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it("should handle refetch errors", async () => {
        mockRpcCall
            .mockResolvedValueOnce({
                data: { initial: true },
                stats: {},
            })
            .mockRejectedValueOnce(new RpcError("Refetch failed", { remainingRequests: 0, resetInSeconds: 0 }));

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.data).toEqual({ initial: true });
        });

        await act(async () => {
            await result.current.refetch();
        });

        expect(result.current.error).toBe("Refetch failed");
    });

    it("should cleanup on unmount", async () => {
        const unsubscribe = vi.fn();
        mockSubscribe.mockReturnValue(unsubscribe);

        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { unmount } = renderHook(() => useFetch(mockMethod));

        unmount();

        expect(unsubscribe).toHaveBeenCalled();
    });

    it("should refetch silently when showLoader is false", async () => {
        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Refetch with showLoader = false
        let loadingDuringRefetch = false;
        await act(async () => {
            const refetchPromise = result.current.refetch(false);
            loadingDuringRefetch = result.current.isLoading;
            await refetchPromise;
        });

        // Loading should not have been set to true
        expect(loadingDuringRefetch).toBe(false);
    });

    it("should return undefined data on refetch error", async () => {
        mockRpcCall
            .mockResolvedValueOnce({
                data: { initial: true },
                stats: {},
            })
            .mockRejectedValueOnce(new RpcError("Error"));

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.data).toEqual({ initial: true });
        });

        let returnedData: unknown;
        await act(async () => {
            returnedData = await result.current.refetch();
        });

        expect(returnedData).toBeUndefined();
    });

    it("should set stats from error response", async () => {
        const errorStats = { remainingRequests: 0, resetInSeconds: 60 };
        mockRpcCall.mockRejectedValueOnce(new RpcError("Rate limited", errorStats));

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(result.current.error).toBe("Rate limited");
        });

        expect(result.current.stats).toEqual(errorStats);
    });

    it("should use different cache keys for different args", async () => {
        mockRpcCall.mockResolvedValue({
            data: { result: "data" },
            stats: {},
        });

        const { cacheKey: mockCacheKey } = await import("../../src/client/cache");

        renderHook(() => useFetch(mockMethod, { id: 1 }));
        renderHook(() => useFetch(mockMethod, { id: 2 }));

        expect(mockCacheKey).toHaveBeenCalledWith("testMethod", { id: 1 });
        expect(mockCacheKey).toHaveBeenCalledWith("testMethod", { id: 2 });
    });

    it("should not skip fetch when cache has stale data but enabled is true", async () => {
        mockHas.mockReturnValue(false); // No cache
        mockRpcCall.mockResolvedValue({
            data: { fresh: true },
            stats: {},
        });

        const { result } = renderHook(() => useFetch(mockMethod, undefined, { enabled: true }));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(mockRpcCall).toHaveBeenCalled();
        expect(result.current.data).toEqual({ fresh: true });
    });

    it("should replay invalidation after pending fetch settles", async () => {
        let invalidationCallback: ((methodId: string) => void) | null = null;
        mockSubscribe.mockImplementation((callback) => {
            invalidationCallback = callback;
            return () => {};
        });

        let resolveFirstFetch: ((value: { data: { result: string }; stats: Record<string, never> }) => void) | null = null;
        const firstFetchPromise = new Promise<{ data: { result: string }; stats: Record<string, never> }>((resolve) => {
            resolveFirstFetch = resolve;
        });

        let pending = false;
        mockSetPendingFetch.mockImplementation((_key: string, promise: Promise<unknown>) => {
            pending = true;
            promise.finally(() => {
                pending = false;
            });
            return promise;
        });
        mockIsPending.mockImplementation(() => pending);
        mockGetPendingFetch.mockImplementation(() => (pending ? firstFetchPromise : undefined));

        mockRpcCall
            .mockImplementationOnce(() => firstFetchPromise)
            .mockResolvedValueOnce({ data: { result: "replayed" }, stats: {} });

        const { result } = renderHook(() => useFetch(mockMethod));

        await waitFor(() => {
            expect(mockRpcCall).toHaveBeenCalledTimes(1);
        });

        act(() => {
            invalidationCallback?.("testMethod");
        });

        expect(mockRpcCall).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveFirstFetch?.({ data: { result: "initial" }, stats: {} });
        });

        await waitFor(() => {
            expect(mockRpcCall).toHaveBeenCalledTimes(2);
        });

        await waitFor(() => {
            expect(result.current.data).toEqual({ result: "replayed" });
        });
    });
});
