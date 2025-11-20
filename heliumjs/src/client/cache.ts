const store = new Map<string, unknown>();
const listeners = new Set<(methodId: string) => void>();

export function cacheKey(methodId: string, args: unknown): string {
  return JSON.stringify([methodId, args ?? null]);
}

export function get<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function set(key: string, value: unknown) {
  store.set(key, value);
}

export function has(key: string): boolean {
  return store.has(key);
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
