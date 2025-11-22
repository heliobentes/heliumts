import { useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { invalidateByMethod } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

type UseCallOptions = {
    invalidate?: MethodStub[];
    onSuccess?: (result: unknown) => void;
};

export function useCall<TArgs, TResult>(method: MethodStub<TArgs, TResult>, options: UseCallOptions = {}) {
    const [data, setData] = useState<TResult | undefined>(undefined);
    const [isCalling, setCalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<RpcStats | null>(null);

    async function call(args: TArgs): Promise<TResult | undefined> {
        setCalling(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(method.__id, args);
            setData(result.data);
            setStats(result.stats);
            options.invalidate?.forEach((m) => invalidateByMethod(m.__id));
            options.onSuccess?.(result.data);
            return result.data;
        } catch (err: any) {
            setError(err.error);
            setStats(err.stats);
            return undefined;
        } finally {
            setCalling(false);
        }
    }

    return { data, call, isCalling, error, stats };
}
