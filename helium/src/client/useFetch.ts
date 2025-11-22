import { useCallback, useEffect, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { cacheKey, get, has, invalidateAll, set, subscribeInvalidations } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

export interface UseFetchOptions {
    ttl?: number; // TTL in milliseconds
    refetchOnWindowFocus?: boolean; // Whether to refetch when tab becomes visible
}

// Global flag to track if visibility listener is registered
let visibilityListenerRegistered = false;

function registerVisibilityListener() {
    if (visibilityListenerRegistered || typeof document === "undefined") {
        return;
    }
    visibilityListenerRegistered = true;

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            invalidateAll();
        }
    });
}

export function useFetch<TArgs, TResult>(method: MethodStub<TArgs, TResult>, args?: TArgs, options?: UseFetchOptions) {
    const key = cacheKey(method.__id, args);
    const { ttl, refetchOnWindowFocus = true } = options ?? {};

    // Register visibility listener if enabled
    useEffect(() => {
        if (refetchOnWindowFocus) {
            registerVisibilityListener();
        }
    }, [refetchOnWindowFocus]);

    const [data, setData] = useState<TResult | undefined>(() => (has(key) ? get<TResult>(key) : undefined));
    const [isLoading, setLoading] = useState(!has(key));
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<RpcStats | null>(null);

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
                    set(key, result.data, ttl);
                    setData(result.data);
                    setStats(result.stats);
                })
                .catch((err) => {
                    if (active) {
                        setError(err.error);
                        setStats(err.stats);
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
    }, [key, method.__id, ttl]);

    // This is used to manually refetch data
    const refetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await rpcCall<TResult, TArgs>(method.__id, args as TArgs);
            set(key, result.data, ttl);
            setData(result.data);
            setStats(result.stats);
            return result.data;
        } catch (err: any) {
            setError(err.error);
            setStats(err.stats);
            return undefined;
        } finally {
            setLoading(false);
        }
    }, [args, key, method.__id, ttl]);

    // This is used to automatically refetch data when this method is invalidated
    useEffect(() => {
        return subscribeInvalidations((methodId) => {
            if (methodId === method.__id) {
                refetch();
            }
        });
    }, [method.__id, refetch]);

    return { data, isLoading, error, stats, refetch };
}
