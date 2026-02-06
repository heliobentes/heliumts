import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateByMethod } from "../../src/client/cache";
import { rpcCall } from "../../src/client/rpcClient";
import { RpcError } from "../../src/client/RpcError";
import { useCall } from "../../src/client/useCall";

// Mock rpcClient
vi.mock("../../src/client/rpcClient", () => ({
    rpcCall: vi.fn(),
}));

// Mock cache
vi.mock("../../src/client/cache", () => ({
    invalidateByMethod: vi.fn(),
}));

describe("useCall", () => {
    const mockMethod = { __id: "testMethod" } as { __id: string };
    const mockRpcCall = rpcCall as ReturnType<typeof vi.fn>;
    const mockInvalidate = invalidateByMethod as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it("should return initial state", () => {
        const { result } = renderHook(() => useCall(mockMethod));

        expect(result.current.data).toBeUndefined();
        expect(result.current.isCalling).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.stats).toBeNull();
        expect(typeof result.current.call).toBe("function");
    });

    it("should call rpcCall with method ID and args", async () => {
        mockRpcCall.mockResolvedValueOnce({
            data: { result: "success" },
            stats: { remainingRequests: 100, resetInSeconds: 60 },
        });

        const { result } = renderHook(() => useCall(mockMethod));

        await act(async () => {
            await result.current.call({ id: 123 });
        });

        expect(mockRpcCall).toHaveBeenCalledWith("testMethod", { id: 123 });
    });

    it("should set data and stats on success", async () => {
        const mockData = { result: "success" };
        const mockStats = { remainingRequests: 100, resetInSeconds: 60 };

        mockRpcCall.mockResolvedValueOnce({
            data: mockData,
            stats: mockStats,
        });

        const { result } = renderHook(() => useCall(mockMethod));

        await act(async () => {
            await result.current.call({ id: 123 });
        });

        expect(result.current.data).toEqual(mockData);
        expect(result.current.stats).toEqual(mockStats);
        expect(result.current.error).toBeNull();
        expect(result.current.isCalling).toBe(false);
    });

    it("should set isCalling during call", async () => {
        let resolveFn: (value: unknown) => void;
        mockRpcCall.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveFn = resolve;
            })
        );

        const { result } = renderHook(() => useCall(mockMethod));

        act(() => {
            result.current.call({});
        });

        // Should be calling while promise is pending
        expect(result.current.isCalling).toBe(true);

        // Resolve the promise
        await act(async () => {
            resolveFn!({ data: {}, stats: {} });
        });

        expect(result.current.isCalling).toBe(false);
    });

    it("should set error on failure", async () => {
        mockRpcCall.mockRejectedValueOnce(new RpcError("Something went wrong", { remainingRequests: 0, resetInSeconds: 30 }));

        const { result } = renderHook(() => useCall(mockMethod));

        await act(async () => {
            await expect(result.current.call({})).rejects.toThrow(RpcError);
        });

        expect(result.current.error).toBe("Something went wrong");
        expect(result.current.data).toBeUndefined();
        expect(result.current.isCalling).toBe(false);
    });

    it("should invalidate specified methods on success", async () => {
        const invalidateMethod1 = { __id: "method1" };
        const invalidateMethod2 = { __id: "method2" };

        mockRpcCall.mockResolvedValueOnce({
            data: {},
            stats: {},
        });

        const { result } = renderHook(() =>
            useCall(mockMethod, {
                invalidate: [invalidateMethod1 as { __id: string }, invalidateMethod2 as { __id: string }],
            })
        );

        await act(async () => {
            await result.current.call({});
        });

        expect(mockInvalidate).toHaveBeenCalledWith("method1");
        expect(mockInvalidate).toHaveBeenCalledWith("method2");
    });

    it("should call onSuccess callback", async () => {
        const mockData = { result: "success" };
        const onSuccess = vi.fn();

        mockRpcCall.mockResolvedValueOnce({
            data: mockData,
            stats: {},
        });

        const { result } = renderHook(() => useCall(mockMethod, { onSuccess }));

        await act(async () => {
            await result.current.call({});
        });

        expect(onSuccess).toHaveBeenCalledWith(mockData);
    });

    it("should return data from call function", async () => {
        const mockData = { result: "success" };

        mockRpcCall.mockResolvedValueOnce({
            data: mockData,
            stats: {},
        });

        const { result } = renderHook(() => useCall(mockMethod));

        let returnedData: unknown;
        await act(async () => {
            returnedData = await result.current.call({});
        });

        expect(returnedData).toEqual(mockData);
    });

    it("should throw RpcError from call on error", async () => {
        mockRpcCall.mockRejectedValueOnce(new RpcError("Error"));

        const { result } = renderHook(() => useCall(mockMethod));

        await act(async () => {
            await expect(result.current.call({})).rejects.toThrow("Error");
        });
    });
});
