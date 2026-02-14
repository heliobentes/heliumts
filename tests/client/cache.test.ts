import { beforeEach, describe, expect, it, vi } from "vitest";

import { cacheKey, get, has, invalidateAll, invalidateByMethod, isPending, set, setPendingFetch, subscribeInvalidations } from "../../src/client/cache";

describe("cache", () => {
    beforeEach(() => {
        // Clear cache before each test by invalidating all
        invalidateAll();
    });

    describe("cacheKey", () => {
        it("should create a cache key from methodId and args", () => {
            const key = cacheKey("getUser", { id: 1 });

            expect(key).toBe('["getUser",{"id":1}]');
        });

        it("should handle null args", () => {
            const key = cacheKey("listUsers", null);

            expect(key).toBe('["listUsers",null]');
        });

        it("should handle undefined args", () => {
            const key = cacheKey("listUsers", undefined);

            expect(key).toBe('["listUsers",null]');
        });

        it("should create unique keys for different args", () => {
            const key1 = cacheKey("getUser", { id: 1 });
            const key2 = cacheKey("getUser", { id: 2 });

            expect(key1).not.toBe(key2);
        });

        it("should create unique keys for different methods", () => {
            const key1 = cacheKey("getUser", { id: 1 });
            const key2 = cacheKey("getProfile", { id: 1 });

            expect(key1).not.toBe(key2);
        });
    });

    describe("set and get", () => {
        it("should store and retrieve a value", () => {
            const key = "test-key";
            const value = { data: "test" };

            set(key, value);
            const result = get(key);

            expect(result).toEqual(value);
        });

        it("should return undefined for non-existent key", () => {
            const result = get("non-existent-key");

            expect(result).toBeUndefined();
        });

        it("should store with custom TTL", () => {
            vi.useFakeTimers();

            const key = "ttl-key";
            set(key, "value", 1000); // 1 second TTL

            expect(get(key)).toBe("value");

            // Advance time past TTL
            vi.advanceTimersByTime(1001);

            expect(get(key)).toBeUndefined();

            vi.useRealTimers();
        });

        it("should use default TTL when not specified", () => {
            vi.useFakeTimers();

            const key = "default-ttl-key";
            set(key, "value");

            expect(get(key)).toBe("value");

            // Default TTL is 5 minutes (300000ms)
            vi.advanceTimersByTime(5 * 60 * 1000 + 1);

            expect(get(key)).toBeUndefined();

            vi.useRealTimers();
        });
    });

    describe("has", () => {
        it("should return true for existing key", () => {
            set("exists", "value");

            expect(has("exists")).toBe(true);
        });

        it("should return false for non-existent key", () => {
            expect(has("does-not-exist")).toBe(false);
        });

        it("should return false for expired key", () => {
            vi.useFakeTimers();

            set("expiring", "value", 1000);
            expect(has("expiring")).toBe(true);

            vi.advanceTimersByTime(1001);
            expect(has("expiring")).toBe(false);

            vi.useRealTimers();
        });
    });

    describe("invalidateByMethod", () => {
        it("should invalidate all entries for a method", () => {
            const key1 = cacheKey("getUser", { id: 1 });
            const key2 = cacheKey("getUser", { id: 2 });
            const key3 = cacheKey("getProfile", { id: 1 });

            set(key1, "user1");
            set(key2, "user2");
            set(key3, "profile1");

            invalidateByMethod("getUser");

            expect(has(key1)).toBe(false);
            expect(has(key2)).toBe(false);
            expect(has(key3)).toBe(true); // Different method, not invalidated
        });

        it("should notify listeners when invalidating", () => {
            const listener = vi.fn();
            const unsubscribe = subscribeInvalidations(listener);

            set(cacheKey("testMethod", {}), "value");
            invalidateByMethod("testMethod");

            expect(listener).toHaveBeenCalledWith("testMethod");

            unsubscribe();
        });

        it("should clear pending fetches for invalidated method", async () => {
            const key = cacheKey("getUser", { id: 1 });
            let resolvePromise: (() => void) | undefined;
            const promise = new Promise<void>((resolve) => {
                resolvePromise = resolve;
            });

            setPendingFetch(key, promise);
            expect(isPending(key)).toBe(true);

            invalidateByMethod("getUser");

            expect(isPending(key)).toBe(false);

            resolvePromise?.();
            await promise;
        });

        it("should invalidate keys with escaped method IDs", () => {
            const methodId = 'method"with\\chars';
            const key = cacheKey(methodId, { id: 1 });

            set(key, "value");
            expect(has(key)).toBe(true);

            invalidateByMethod(methodId);

            expect(has(key)).toBe(false);
        });
    });

    describe("invalidateAll", () => {
        it("should clear all cache entries", () => {
            set("key1", "value1");
            set("key2", "value2");
            set("key3", "value3");

            invalidateAll();

            expect(has("key1")).toBe(false);
            expect(has("key2")).toBe(false);
            expect(has("key3")).toBe(false);
        });

        it("should notify listeners for each method", () => {
            const listener = vi.fn();
            const unsubscribe = subscribeInvalidations(listener);

            set(cacheKey("method1", {}), "value1");
            set(cacheKey("method2", {}), "value2");

            invalidateAll();

            expect(listener).toHaveBeenCalled();

            unsubscribe();
        });
    });

    describe("subscribeInvalidations", () => {
        it("should return unsubscribe function", () => {
            const listener = vi.fn();
            const unsubscribe = subscribeInvalidations(listener);

            set(cacheKey("test", {}), "value");
            invalidateByMethod("test");
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();

            invalidateByMethod("test");
            expect(listener).toHaveBeenCalledTimes(1); // Not called again
        });

        it("should support multiple listeners", () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            const unsubscribe1 = subscribeInvalidations(listener1);
            const unsubscribe2 = subscribeInvalidations(listener2);

            set(cacheKey("multi", {}), "value");
            invalidateByMethod("multi");

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();

            unsubscribe1();
            unsubscribe2();
        });
    });
});
