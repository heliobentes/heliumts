interface CacheEntry {
    value: unknown;
    timestamp: number;
    ttl?: number; // TTL in milliseconds
}

const store = new Map<string, CacheEntry>();
const listeners = new Set<(methodId: string) => void>();
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

export function cleanupExpired(): number {
    let count = 0;
    for (const [key, entry] of store.entries()) {
        if (isExpired(entry)) {
            store.delete(key);
            count++;
        }
    }
    return count;
}

export function clear() {
    store.clear();
}

export function size(): number {
    return store.size;
}
