interface CacheEntry {
    value: unknown;
    timestamp: number;
    ttl?: number; // TTL in milliseconds
}

// Preserve cache across HMR by attaching to window in dev mode
let store: Map<string, CacheEntry>;
let listeners: Set<(methodId: string) => void>;
let pendingFetches: Map<string, Promise<unknown>>;

if (typeof window !== "undefined" && import.meta.env?.DEV) {
    const globalWindow = window as typeof window & {
        __heliumCacheStore?: Map<string, CacheEntry>;
        __heliumCacheListeners?: Set<(methodId: string) => void>;
        __heliumPendingFetches?: Map<string, Promise<unknown>>;
    };
    if (!globalWindow.__heliumCacheStore) {
        globalWindow.__heliumCacheStore = new Map();
    }
    if (!globalWindow.__heliumCacheListeners) {
        globalWindow.__heliumCacheListeners = new Set();
    }
    if (!globalWindow.__heliumPendingFetches) {
        globalWindow.__heliumPendingFetches = new Map();
    }
    store = globalWindow.__heliumCacheStore;
    listeners = globalWindow.__heliumCacheListeners;
    pendingFetches = globalWindow.__heliumPendingFetches;
} else {
    store = new Map();
    listeners = new Set();
    pendingFetches = new Map();
}

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

export function cacheKey(methodId: string, args: unknown): string {
    return JSON.stringify([methodId, args ?? null]);
}

function isExpired(entry: CacheEntry): boolean {
    if (!entry.ttl) {
        return false;
    }
    return Date.now() - entry.timestamp > entry.ttl;
}

export function get<T>(key: string): T | undefined {
    const entry = store.get(key);
    if (!entry) {
        return undefined;
    }

    if (isExpired(entry)) {
        store.delete(key);
        return undefined;
    }

    return entry.value as T | undefined;
}

export function set(key: string, value: unknown, ttl?: number) {
    store.set(key, {
        value,
        timestamp: Date.now(),
        ttl: ttl ?? DEFAULT_TTL,
    });
}

export function has(key: string): boolean {
    const entry = store.get(key);
    if (!entry) {
        return false;
    }

    if (isExpired(entry)) {
        store.delete(key);
        return false;
    }

    return true;
}

export function invalidateByMethod(methodId: string) {
    let invalidated = false;
    for (const key of store.keys()) {
        if (key.startsWith(`["${methodId}"`)) {
            store.delete(key);
            invalidated = true;
        }
    }
    if (invalidated || listeners.size) {
        for (const listener of listeners) {
            listener(methodId);
        }
    }
}

export function subscribeInvalidations(listener: (methodId: string) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function invalidateAll() {
    const methodIds = new Set<string>();
    for (const key of store.keys()) {
        try {
            const parsed = JSON.parse(key);
            if (Array.isArray(parsed) && parsed.length > 0) {
                methodIds.add(parsed[0]);
            }
        } catch {
            // Ignore malformed keys
        }
    }
    store.clear();
    for (const methodId of methodIds) {
        for (const listener of listeners) {
            listener(methodId);
        }
    }
}

/**
 * Check if a fetch is currently pending for a given cache key.
 */
export function isPending(key: string): boolean {
    return pendingFetches.has(key);
}

/**
 * Get an existing pending fetch promise, or undefined if none.
 */
export function getPendingFetch<T>(key: string): Promise<T> | undefined {
    return pendingFetches.get(key) as Promise<T> | undefined;
}

/**
 * Register a pending fetch. Returns the promise.
 * If a fetch for this key is already pending, returns the existing promise.
 */
export function setPendingFetch<T>(key: string, promise: Promise<T>): Promise<T> {
    const existing = pendingFetches.get(key);
    if (existing) {
        return existing as Promise<T>;
    }
    pendingFetches.set(key, promise);
    // Clean up when done
    promise.finally(() => {
        pendingFetches.delete(key);
    });
    return promise;
}

/**
 * Clear a pending fetch (if you need to cancel/reset).
 */
export function clearPendingFetch(key: string): void {
    pendingFetches.delete(key);
}
