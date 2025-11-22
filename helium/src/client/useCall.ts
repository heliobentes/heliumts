import { useState } from "react";

import { invalidateByMethod } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

type UseCallOptions = {
    invalidate?: MethodStub[];
    onSuccess?: (result: unknown) => void;
};

export function useCall<TArgs, TResult>(method: MethodStub<TArgs, TResult>, options: UseCallOptions = {}) {
    const [isCalling, setCalling] = useState(false);
    const [error, setError] = useState<unknown>(null);

    async function call(args: TArgs): Promise<TResult> {
        setCalling(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(method.__id, args);
            options.invalidate?.forEach((m) => invalidateByMethod(m.__id));
            options.onSuccess?.(result);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setCalling(false);
        }
    }

    return { call, isCalling, error };
}
