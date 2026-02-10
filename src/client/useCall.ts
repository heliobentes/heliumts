import { useCallback, useRef, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { invalidateByMethod } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import { RpcError } from "./RpcError.js";
import type { MethodStub } from "./types.js";

/**
 * Options passed to `useCall`.
 *
 * - invalidate: array of MethodStubs whose cache entries will be invalidated
 *   when this call completes successfully (useful to refresh related reads).
 * - onSuccess: optional callback that receives the result on success.
 * - onError: optional callback that receives the error message on failure.
 */
type UseCallOptions = {
    invalidate?: MethodStub[];
    onSuccess?: (result: unknown) => void;
    onError?: (error: string) => void;
};

/**
 * React hook for imperative RPC calls (commonly used for mutations).
 *
 * @template TArgs - argument type for the method
 * @template TResult - expected result type
 * @param method - MethodStub identifying the server method to call
 * @param options - UseCallOptions to control invalidation / callbacks
 * @returns { data, call, isCalling, error, stats } where `call(args)` triggers the RPC and returns the result
 */
export function useCall<TArgs, TResult>(method: MethodStub<TArgs, TResult>, options: UseCallOptions = {}) {
    const [data, setData] = useState<TResult | undefined>(undefined);
    const [isCalling, setCalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<RpcStats | null>(null);

    // Use refs to store latest values without causing callback recreation
    const methodIdRef = useRef(method.__id);
    const optionsRef = useRef(options);

    // Update refs on each render
    methodIdRef.current = method.__id;
    optionsRef.current = options;

    // Memoized call function - stable reference across renders
    const call = useCallback(async (args: TArgs): Promise<TResult | undefined> => {
        setCalling(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(methodIdRef.current, args);
            setData(result.data);
            setStats(result.stats);
            optionsRef.current.invalidate?.forEach((m) => invalidateByMethod(m.__id));
            optionsRef.current.onSuccess?.(result.data);
            return result.data;
        } catch (err: unknown) {
            const rpcError = err instanceof RpcError ? err : new RpcError(err instanceof Error ? err.message : "Unknown error");
            setError(rpcError.message);
            setStats(rpcError.stats);
            optionsRef.current.onError?.(rpcError.message);
            throw rpcError;
        } finally {
            setCalling(false);
        }
    }, []); // Empty deps - uses refs for latest values

    return { data, call, isCalling, error, stats };
}
