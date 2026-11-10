import { useCallback, useRef, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { invalidateByMethod } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import { RpcError } from "./RpcError.js";
import { getMethodId, type MethodArgs, type MethodReference, type UnaryMethod } from "./types.js";

/**
 * Options passed to `useCall`.
 *
 * - invalidate: array of methods whose cache entries will be invalidated
 *   when this call completes successfully (useful to refresh related reads).
 * - onSuccess: optional callback that receives the result on success.
 * - onError: optional callback that receives the error message on failure.
 */
export type UseCallOptions<TResult = unknown> = {
    invalidate?: MethodReference[];
    onSuccess?: (result: TResult) => void;
    onError?: (error: string) => void;
};

/** A handled submission outcome; failure does not imply a server write was rolled back. */
export type SubmitResult<TResult> = { status: "success"; data: TResult } | { status: "error"; error: RpcError } | { status: "busy" };

/**
 * React hook for imperative RPC calls (commonly used for mutations).
 *
 * @template TArgs - argument type for the method
 * @template TResult - expected result type
 * @param method - reference identifying the server method to call
 * @param options - UseCallOptions to control invalidation / callbacks
 * @returns { data, call, isCalling, error, stats } where `call(args)` triggers the RPC and returns the result
 */
export function useCall<TArgs, TResult>(method: UnaryMethod<TArgs, TResult>, options: UseCallOptions<NoInfer<TResult>> = {}) {
    const [data, setData] = useState<TResult | undefined>(undefined);
    const [isCalling, setCalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<RpcStats | null>(null);

    // Use refs to store latest values without causing callback recreation
    const methodId = getMethodId(method);
    const methodIdRef = useRef(methodId);
    const optionsRef = useRef(options);
    const pendingCallsRef = useRef(0);

    // Update refs on each render
    methodIdRef.current = methodId;
    optionsRef.current = options;

    // Memoized call function - stable reference across renders
    const call = useCallback(async (...[args]: MethodArgs<TArgs>): Promise<TResult> => {
        pendingCallsRef.current++;
        setCalling(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(methodIdRef.current, args as TArgs);
            setData(result.data);
            setStats(result.stats);
            optionsRef.current.invalidate?.forEach((m) => invalidateByMethod(getMethodId(m)));
            optionsRef.current.onSuccess?.(result.data);
            return result.data;
        } catch (err: unknown) {
            const rpcError = err instanceof RpcError ? err : new RpcError(err instanceof Error ? err.message : "Unknown error");
            setError(rpcError.message);
            setStats(rpcError.stats);
            optionsRef.current.onError?.(rpcError.message);
            throw rpcError;
        } finally {
            pendingCallsRef.current--;
            setCalling(pendingCallsRef.current > 0);
        }
    }, []); // Empty deps - uses refs for latest values

    // call() remains the concurrent/rejecting primitive. submit() is a handled,
    // per-hook form path: pendingCallsRef changes synchronously inside call().
    const submit = useCallback(
        async (...args: MethodArgs<TArgs>): Promise<SubmitResult<TResult>> => {
            if (pendingCallsRef.current > 0) {
                return { status: "busy" };
            }
            try {
                return { status: "success", data: await call(...args) };
            } catch (err: unknown) {
                return { status: "error", error: err instanceof RpcError ? err : new RpcError(err instanceof Error ? err.message : "Unknown error") };
            }
        },
        [call]
    );

    return { data, call, submit, isCalling, error, stats };
}
