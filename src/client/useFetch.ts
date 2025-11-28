import { useCallback, useEffect, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { cacheKey, get, has, invalidateAll, set, subscribeInvalidations } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

/**
 * Options controlling `useFetch` behaviour.
 *
 * - ttl: optional time-to-live for the cached response (milliseconds).
 * - refetchOnWindowFocus: when true the hook will invalidate cache on
 *   window focus/visibility change and re-run the fetch.
 * - enabled: disable automatic fetching (defaults to true) — useful when
 *   you only want to fetch when a required value (e.g. id) is present.
 */
export interface UseFetchOptions {
    ttl?: number; // TTL in milliseconds
    refetchOnWindowFocus?: boolean; // Whether to refetch when tab becomes visible
    enabled?: boolean; // Whether to fetch data. Defaults to true. Useful for conditional fetching (e.g., only fetch when an ID exists)
}

// Global flag to track if visibility listener is registered
let visibilityListenerRegistered = false;

function registerVisibilityListener() {
    if (visibilityListenerRegistered || typeof document === "undefined") {
        return;
    }
    visibilityListenerRegistered = true;

    const handleVisibilityChange = () => {
        if (!document.hidden) {
            invalidateAll();
        }
    };

    const handleFocus = () => {
        invalidateAll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    window.addEventListener("focus", handleFocus, { passive: true });
}

/**
 * React hook for fetching and caching the result of a server method.
 *
 * @template TArgs - method argument type
 * @template TResult - expected return type
 * @param method - a MethodStub representing the server method to call
 * @param args - optional argument object passed to the server method
 * @param options - controls caching and refetch behavior (see UseFetchOptions)
 * @returns { data, isLoading, error, stats, refetch } — `data` is the cached or latest value; `refetch` triggers an immediate request
 */
export function useFetch<TArgs, TResult>(method: MethodStub<TArgs, TResult>, args?: TArgs, options?: UseFetchOptions) {
    const key = cacheKey(method.__id, args);
    const { ttl, refetchOnWindowFocus = true, enabled = true } = options ?? {};

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
        if (!enabled) {
            setLoading(false);
            return;
        }

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
    }, [key, method.__id, ttl, enabled]);

    // This is used to automatically refetch data after TTL expires
    useEffect(() => {
        if (!enabled || !ttl) {
            return;
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const scheduleRefetch = () => {
            // Clear any existing timeout
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }

            // Schedule refetch after TTL
            timeoutId = setTimeout(() => {
                if (enabled) {
                    rpcCall<TResult, TArgs>(method.__id, args as TArgs)
                        .then((result) => {
                            set(key, result.data, ttl);
                            setData(result.data);
                            setStats(result.stats);
                            setError(null);
                            // Schedule next refetch
                            scheduleRefetch();
                        })
                        .catch((err) => {
                            setError(err.error);
                            setStats(err.stats);
                            // Still schedule next refetch even on error
                            scheduleRefetch();
                        });
                }
            }, ttl);
        };

        // Only schedule if data is already cached
        if (has(key)) {
            scheduleRefetch();
        }

        return () => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        };
    }, [key, method.__id, args, ttl, enabled]);

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
