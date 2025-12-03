import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearPrefetchCache, prefetchRoute } from "../../src/client/prefetch";
import type { RouteEntry } from "../../src/client/routerManifest";

describe("prefetch", () => {
    beforeEach(() => {
        clearPrefetchCache();
    });

    afterEach(() => {
        clearPrefetchCache();
    });

    describe("prefetchRoute", () => {
        it("should call preload for matching route", async () => {
            let preloadCalled = false;

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/about",
                    matcher: (path: string) => (path === "/about" ? { params: {} } : null),
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => {
                        preloadCalled = true;
                        return { default: () => null };
                    },
                },
            ];

            prefetchRoute("/about", routes);

            // Wait for async preload
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(preloadCalled).toBe(true);
        });

        it("should not call preload if already prefetched", async () => {
            let preloadCount = 0;

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/about",
                    matcher: (path: string) => (path === "/about" ? { params: {} } : null),
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => {
                        preloadCount++;
                        return { default: () => null };
                    },
                },
            ];

            prefetchRoute("/about", routes);
            prefetchRoute("/about", routes); // Second call

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(preloadCount).toBe(1);
        });

        it("should strip query string before matching", async () => {
            let matchedPath = "";

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/products",
                    matcher: (path: string) => {
                        matchedPath = path;
                        return path === "/products" ? { params: {} } : null;
                    },
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => ({ default: () => null }),
                },
            ];

            prefetchRoute("/products?category=electronics", routes);

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(matchedPath).toBe("/products");
        });

        it("should not prefetch if no route matches", async () => {
            let preloadCalled = false;

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/about",
                    matcher: (path: string) => (path === "/about" ? { params: {} } : null),
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => {
                        preloadCalled = true;
                        return { default: () => null };
                    },
                },
            ];

            prefetchRoute("/unknown", routes);

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(preloadCalled).toBe(false);
        });

        it("should remove from cache if preload fails", async () => {
            let preloadCount = 0;

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/failing",
                    matcher: (path: string) => (path === "/failing" ? { params: {} } : null),
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => {
                        preloadCount++;
                        throw new Error("Preload failed");
                    },
                },
            ];

            prefetchRoute("/failing", routes);

            await new Promise((resolve) => setTimeout(resolve, 10));

            // Second attempt should try again since first failed
            prefetchRoute("/failing", routes);

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(preloadCount).toBe(2);
        });
    });

    describe("clearPrefetchCache", () => {
        it("should allow re-prefetching after clear", async () => {
            let preloadCount = 0;

            const routes: RouteEntry[] = [
                {
                    pathPattern: "/test",
                    matcher: (path: string) => (path === "/test" ? { params: {} } : null),
                    Component: () => null,
                    LazyComponent: {} as RouteEntry["LazyComponent"],
                    layouts: [],
                    preload: async () => {
                        preloadCount++;
                        return { default: () => null };
                    },
                },
            ];

            prefetchRoute("/test", routes);
            await new Promise((resolve) => setTimeout(resolve, 0));

            clearPrefetchCache();

            prefetchRoute("/test", routes);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(preloadCount).toBe(2);
        });
    });
});
