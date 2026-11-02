import { useCallback, useEffect, useRef, useState } from "react";

import type { RpcStats } from "../runtime/protocol.js";
import { cacheKey, clearPendingFetch, get, getPendingFetch, has, isPending, set, setPendingFetch, subscribeInvalidations } from "./cache.js";
import { rpcCall } from "./rpcClient.js";
import { RpcError } from "./RpcError.js";
import type { MethodStub } from "./types.js";

/**
 * Options controlling `useFetch` behaviour.
 *
 * - ttl: optional time-to-live for the cached response (milliseconds).
 * - refetchOnWindowFocus: when true the hook will invalidate cache on
 *   window focus/visibility change and re-run the fetch.
 * - showLoaderOnRefocus: when false (default), refetches triggered by window
 *   focus/visibility will update data silently without showing the loading state.
 * - showLoaderOnInvalidate: when false (default), refetches triggered by cache
 *   invalidation will update data silently without showing the loading state.
 * - enabled: disable automatic fetching (defaults to true) — useful when
 *   you only want to fetch when a required value (e.g. id) is present.
 */
export interface UseFetchOptions {
    ttl?: number; // TTL in milliseconds
    refetchOnWindowFocus?: boolean; // Whether to refetch when tab becomes visible
    showLoaderOnRefocus?: boolean; // Whether to show loader when refetching on focus (defaults to false)
    showLoaderOnInvalidate?: boolean; // Whether to show loader when refetching on cache invalidation (defaults to false)
    enabled?: boolean; // Whether to fetch data. Defaults to true. Useful for conditional fetching (e.g., only fetch when an ID exists)
}

// Store focus refetch callbacks globally (survives HMR)
type FocusCallback = (showLoader: boolean) => void;

function getFocusCallbacksSet(): Set<FocusCallback> {
    if (typeof window === "undefined") {
        return new Set();
    }
    const win = window as typeof window & {
        __heliumFocusCallbacks?: Set<FocusCallback>;
    };
    if (!win.__heliumFocusCallbacks) {
        win.__heliumFocusCallbacks = new Set();
    }
    return win.__heliumFocusCallbacks;
}

function getVisibilityState(): { registered: boolean; lastTrigger: number } {
    if (typeof window === "undefined") {
        return { registered: false, lastTrigger: 0 };
    }
    const win = window as typeof window & {
        __heliumVisibilityState?: { registered: boolean; lastTrigger: number };
    };
    if (!win.__heliumVisibilityState) {
        win.__heliumVisibilityState = { registered: false, lastTrigger: 0 };
    }
    return win.__heliumVisibilityState;
}

// Minimum time between focus-triggered refetches (debounce)
const FOCUS_DEBOUNCE_MS = 2000;

function setupFocusListeners() {
    const state = getVisibilityState();
    if (state.registered || typeof document === "undefined") {
        return;
    }
    state.registered = true;

    const triggerRefetch = () => {
        const now = Date.now();
        // Debounce to prevent rapid refetches during HMR
        if (now - state.lastTrigger < FOCUS_DEBOUNCE_MS) {
            return;
        }
        state.lastTrigger = now;

        // Get all registered callbacks and call them
        const callbacks = getFocusCallbacksSet();
        callbacks.forEach((cb) => {
            try {
                cb(false); // Silent refetch on focus
            } catch {
                // Ignore errors from stale callbacks
            }
        });
    };

    const handleVisibilityChange = () => {
        if (!document.hidden) {
            triggerRefetch();
        }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    window.addEventListener("focus", triggerRefetch, { passive: true });
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
    // Compute cache key
    const key = cacheKey(method.__id, args);

    const { ttl, refetchOnWindowFocus = true, showLoaderOnRefocus = false, showLoaderOnInvalidate = false, enabled = true } = options ?? {};

    // Use refs to store latest values without causing effect re-runs
    const methodIdRef = useRef(method.__id);
    const argsRef = useRef(args);
    const keyRef = useRef(key);
    const ttlRef = useRef(ttl);
    const enabledRef = useRef(enabled);
    const showLoaderOnRefocusRef = useRef(showLoaderOnRefocus);
    const showLoaderOnInvalidateRef = useRef(showLoaderOnInvalidate);
    const queuedRefetchRef = useRef(false);
    const queuedRefetchShowLoaderRef = useRef(false);

    // Update refs on each render
    methodIdRef.current = method.__id;
    argsRef.current = args;
    keyRef.current = key;
    ttlRef.current = ttl;
    enabledRef.current = enabled;
    showLoaderOnRefocusRef.current = showLoaderOnRefocus;
    showLoaderOnInvalidateRef.current = showLoaderOnInvalidate;

    // Track if component is mounted
    const isMountedRef = useRef(true);
    const requestIdRef = useRef(0);
    const identityRef = useRef({ key, enabled });
    if (identityRef.current.key !== key || identityRef.current.enabled !== enabled) {
        requestIdRef.current++;
        queuedRefetchRef.current = false;
        queuedRefetchShowLoaderRef.current = false;
        identityRef.current = { key, enabled };
    }

    const [data, setData] = useState<TResult | undefined>(() => (has(key) ? get<TResult>(key) : undefined));
    const [isLoading, setLoading] = useState(!has(key) && enabled);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<RpcStats | null>(null);

    const queueRefetch = useCallback((showLoader: boolean) => {
        queuedRefetchRef.current = true;
        queuedRefetchShowLoaderRef.current = queuedRefetchShowLoaderRef.current || showLoader;
    }, []);

    // Core fetch function using refs (stable reference)
    // Uses global deduplication to prevent multiple fetches for the same key
    const doFetch = useCallback(async (showLoader: boolean = true): Promise<TResult | undefined> => {
        if (!isMountedRef.current) {
            return undefined;
        }

        const currentKey = keyRef.current;
        const requestId = ++requestIdRef.current;
        const canUpdate = () => isMountedRef.current && keyRef.current === currentKey && requestIdRef.current === requestId;

        const replayQueuedRefetch = () => {
            if (!queuedRefetchRef.current || !canUpdate() || !enabledRef.current) {
                return;
            }
            const nextShowLoader = queuedRefetchShowLoaderRef.current;
            queuedRefetchRef.current = false;
            queuedRefetchShowLoaderRef.current = false;
            clearPendingFetch(currentKey);
            queueMicrotask(() => {
                if (canUpdate() && enabledRef.current) {
                    void doFetch(nextShowLoader);
                }
            });
        };

        if (showLoader) {
            setLoading(true);
        }
        setError(null);

        let fetchPromise = getPendingFetch<{ data: TResult; stats: RpcStats }>(currentKey);
        if (!fetchPromise) {
            const currentTtl = ttlRef.current;
            // Cache before pending cleanup runs, and only while this request is
            // still registered. An invalidated response must not restore stale data.
            const request = rpcCall<TResult, TArgs>(methodIdRef.current, argsRef.current as TArgs).then((result) => {
                if (getPendingFetch(currentKey) === fetchPromise) {
                    set(currentKey, result.data, currentTtl);
                }
                return result;
            });
            fetchPromise = setPendingFetch(currentKey, request);
        }

        try {
            const result = await fetchPromise;
            if (canUpdate()) {
                setData(result.data);
                setStats(result.stats);
                setError(null);
            }
            return result.data;
        } catch (err: unknown) {
            if (canUpdate()) {
                const rpcError = err instanceof RpcError ? err : new RpcError(err instanceof Error ? err.message : "Unknown error");
                setError(rpcError.message);
                setStats(rpcError.stats);
            }
            return undefined;
        } finally {
            if (canUpdate()) {
                setLoading(false);
            }
            replayQueuedRefetch();
        }
    }, []); // No dependencies - uses refs

    // Track mounted state
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            requestIdRef.current++;
        };
    }, []);

    // Reset result state when the query changes, including cached undefined values.
    useEffect(() => {
        setData(get<TResult>(key));
        setError(null);
        setStats(null);
        setLoading(enabled && !has(key));
    }, [key, enabled]);

    // Joining a pending request goes through the same guarded path as a new fetch.
    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        if (!has(key) || isPending(key)) {
            void doFetch(true);
        }
    }, [key, enabled, doFetch]);

    // Register for focus/visibility refetch
    useEffect(() => {
        if (!refetchOnWindowFocus) {
            return;
        }

        // Setup global focus listeners once
        setupFocusListeners();

        // Create a stable callback for this hook instance
        const focusCallback: FocusCallback = (showLoader: boolean) => {
            if (!enabledRef.current || !isMountedRef.current) {
                return;
            }

            const shouldShowLoader = showLoaderOnRefocusRef.current || showLoader;

            if (isPending(keyRef.current)) {
                queueRefetch(shouldShowLoader);
                void doFetch(shouldShowLoader);
                return;
            }

            void doFetch(shouldShowLoader);
        };

        // Register this callback
        const callbacks = getFocusCallbacksSet();
        callbacks.add(focusCallback);

        return () => {
            callbacks.delete(focusCallback);
        };
    }, [refetchOnWindowFocus, doFetch, queueRefetch]);

    // Subscribe to cache invalidations (from useCall or manual invalidation)
    useEffect(() => {
        const unsubscribe = subscribeInvalidations((methodId) => {
            if (methodId !== methodIdRef.current || !enabledRef.current || !isMountedRef.current) {
                return;
            }

            if (isPending(keyRef.current)) {
                queueRefetch(showLoaderOnInvalidateRef.current);
                void doFetch(showLoaderOnInvalidateRef.current);
                return;
            }

            void doFetch(showLoaderOnInvalidateRef.current);
        });

        return unsubscribe;
    }, [doFetch, queueRefetch]);

    // TTL-based auto-refetch
    useEffect(() => {
        if (!enabled || !ttl) {
            return;
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let isActive = true;

        const scheduleRefetch = () => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(async () => {
                if (!isActive || !enabledRef.current || !isMountedRef.current) {
                    return;
                }
                await doFetch(false); // Silent refetch for TTL
                if (isActive) {
                    scheduleRefetch();
                }
            }, ttl);
        };

        scheduleRefetch();

        return () => {
            isActive = false;
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        };
    }, [key, ttl, enabled, doFetch]);

    // Public refetch function
    const refetch = useCallback((showLoader: boolean = true) => doFetch(showLoader), [doFetch]);

    return { data, isLoading, error, stats, refetch };
}
