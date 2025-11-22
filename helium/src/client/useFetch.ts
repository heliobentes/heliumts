import { useCallback, useEffect, useState } from "react";

import { cacheKey, get, has, set, subscribeInvalidations } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

export function useFetch<TArgs, TResult>(method: MethodStub<TArgs, TResult>, args?: TArgs) {
    const key = cacheKey(method.__id, args);

    const [data, setData] = useState<TResult | undefined>(() => (has(key) ? get<TResult>(key) : undefined));
    const [isLoading, setLoading] = useState(!has(key));
    const [error, setError] = useState<unknown>(null);

    // This is used to fetch data on mount
    useEffect(() => {
        let active = true;

        if (!has(key)) {
            setLoading(true);
            setError(null);

            rpcCall<TResult, TArgs>(method.__id, args as TArgs)
                .then((result) => {
                    if (!active) {
                        return;
                    }
                    set(key, result);
                    setData(result);
                })
                .catch((err) => {
                    if (active) {
                        setError(err);
                    }
                })
                .finally(() => {
                    if (active) {
                        setLoading(false);
                    }
                });
        }

        return () => {
            active = false;
        };
    }, [key, method.__id]);

    // This is used to manually refetch data
    const refetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(method.__id, args as TArgs);
            set(key, result);
            setData(result);
            return result;
        } catch (err) {
            setError(err);
            return undefined;
        } finally {
            setLoading(false);
        }
    }, [args, key, method.__id]);

    // This is used to automatically refetch data when this method is invalidated
    useEffect(() => {
        return subscribeInvalidations((methodId) => {
            if (methodId === method.__id) {
                refetch();
            }
        });
    }, [method.__id, refetch]);

    return { data, isLoading, error, refetch };
}
