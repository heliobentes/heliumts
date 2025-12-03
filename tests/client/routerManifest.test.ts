import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
    buildRoutes,
    pathFromFile,
    createMatcher,
    type RouteEntry,
    type LayoutProps,
} from "../../src/client/routerManifest";

describe("routerManifest", () => {
    describe("buildRoutes", () => {
        it("should return empty routes on server side (no window)", () => {
            // buildRoutes checks typeof window === 'undefined' and returns empty
            const originalWindow = globalThis.window;
            // @ts-ignore - simulating server environment
            delete globalThis.window;

            const result = buildRoutes();

            expect(result.routes).toEqual([]);
            expect(result.NotFound).toBeUndefined();
            expect(result.AppShell).toBeUndefined();

            // Restore window
            globalThis.window = originalWindow;
        });
    });

    describe("pathFromFile", () => {
        const testCases = [
            { input: "/src/pages/index.tsx", expected: "/" },
            { input: "/src/pages/about.tsx", expected: "/about" },
            { input: "/src/pages/tasks/index.tsx", expected: "/tasks" },
            { input: "/src/pages/tasks/[id].tsx", expected: "/tasks/:id" },
            { input: "/src/pages/settings/profile.tsx", expected: "/settings/profile" },
            { input: "/src/pages/blog/[...slug].tsx", expected: "/blog/*slug" },
            { input: "/src/pages/404.tsx", expected: "__404__" },
            { input: "/src/pages/(website)/contact.tsx", expected: "/contact" },
            { input: "/src/pages/(portal)/dashboard.tsx", expected: "/dashboard" },
        ];

        testCases.forEach(({ input, expected }) => {
            it(`should convert ${input} to ${expected}`, () => {
                expect(pathFromFile(input)).toBe(expected);
            });
        });
    });

    describe("createMatcher", () => {
        it("should match root path", () => {
            const matcher = createMatcher("/");
            expect(matcher("/")).toEqual({ params: {} });
            expect(matcher("/about")).toBeNull();
        });

        it("should match static paths", () => {
            const matcher = createMatcher("/about");
            expect(matcher("/about")).toEqual({ params: {} });
            expect(matcher("/contact")).toBeNull();
        });

        it("should match dynamic segments", () => {
            const matcher = createMatcher("/tasks/:id");
            expect(matcher("/tasks/123")).toEqual({ params: { id: "123" } });
            expect(matcher("/tasks/abc")).toEqual({ params: { id: "abc" } });
            expect(matcher("/tasks")).toBeNull();
            expect(matcher("/tasks/123/edit")).toBeNull();
        });

        it("should match multiple dynamic segments", () => {
            const matcher = createMatcher("/users/:userId/posts/:postId");
            expect(matcher("/users/1/posts/2")).toEqual({ params: { userId: "1", postId: "2" } });
        });

        it("should match catch-all segments", () => {
            const matcher = createMatcher("/blog/*slug");
            expect(matcher("/blog/2023/01/my-post")).toEqual({
                params: { slug: ["2023", "01", "my-post"] },
            });
            expect(matcher("/blog")).toEqual({ params: { slug: [] } });
        });

        it("should decode URL-encoded segments", () => {
            const matcher = createMatcher("/search/:query");
            expect(matcher("/search/hello%20world")).toEqual({ params: { query: "hello world" } });
        });

        it("should strip query strings and hashes", () => {
            const matcher = createMatcher("/about");
            expect(matcher("/about?foo=bar")).toEqual({ params: {} });
            expect(matcher("/about#section")).toEqual({ params: {} });
        });
    });

    describe("RouteEntry type", () => {
        it("should have expected properties", () => {
            const mockEntry: RouteEntry = {
                pathPattern: "/test",
                matcher: () => ({ params: {} }),
                Component: () => null,
                LazyComponent: {} as React.LazyExoticComponent<React.ComponentType<unknown>>,
                layouts: [],
                preload: async () => ({ default: () => null }),
            };

            expect(mockEntry.pathPattern).toBe("/test");
        });
    });

    describe("LayoutProps type", () => {
        it("should accept children prop", () => {
            const mockProps: LayoutProps = {
                children: null,
            };

            expect(mockProps.children).toBeNull();
        });
    });
});
