import type { ComponentType, LazyExoticComponent } from "react";
import React from "react";

import { createMatcher as createPageMatcher, type PageRoute, pathFromPageFile } from "../runtime/pageRoutes.js";
import { compareRoutePatterns } from "../runtime/routeOrder.js";
import { log } from "../utils/logger.js";
import { pageModules } from "./pageModules.js";

export type LayoutProps = {
    children: React.ReactNode;
};

export type RouteEntry = {
    render: PageRoute["render"];
    pathPattern: string; // "/tasks/:id"
    matcher: (path: string) => { params: Record<string, string | string[]> } | null;
    Component: ComponentType<unknown>;
    LazyComponent: LazyExoticComponent<ComponentType<unknown>>;
    layouts: ComponentType<LayoutProps>[]; // Array of layouts from root to leaf
    preload: () => Promise<{ default: ComponentType<unknown> }>; // Preload function for prefetching
};

/**
 * Convert a file path to a route pattern
 * Examples:
 * - /src/pages/index.tsx → /
 * - /src/pages/tasks/index.tsx → /tasks
 * - /src/pages/tasks/[id].tsx → /tasks/:id
 * - /src/pages/settings/profile.tsx → /settings/profile
 * - /src/pages/blog/[...slug].tsx → /blog/*slug
 * - /src/pages/404.tsx → __404__
 * - /src/pages/(website)/contact.tsx → /contact
 * - /src/pages/(portal)/dashboard.tsx → /dashboard
 * @internal Exported for testing
 */
export function pathFromFile(file: string): string {
    return pathFromPageFile(file.replace("/src/pages", ""));
}

export function createMatcher(pattern: string) {
    return createPageMatcher(pattern, () => log("warn", `Catch-all segment must be last: ${pattern}`));
}

export function buildRoutes(): {
    routes: RouteEntry[];
    NotFound?: ComponentType<unknown>;
    AppShell?: ComponentType<unknown>;
} {
    // SSR check - return empty routes if running server-side
    if (typeof window === "undefined") {
        return { routes: [], NotFound: undefined, AppShell: undefined };
    }

    const debugRoutes = typeof localStorage !== "undefined" && localStorage.getItem("helium_debug_routes") === "true";
    const routes: RouteEntry[] = [];
    let NotFound: ComponentType<unknown> | undefined;

    for (const { file, page, pattern, render, layouts, preload } of pageModules) {
        const Component = page.default;
        if (!Component) {
            log("warn", `No default export found in ${file}`);
            continue;
        }

        if (pattern === "__404__") {
            NotFound = Component;
            continue;
        }

        routes.push({
            pathPattern: pattern,
            render,
            matcher: createMatcher(pattern),
            Component,
            LazyComponent: React.lazy(preload),
            layouts: layouts.flatMap((layout) => (layout.default ? [layout.default] : [])),
            preload,
        });
    }

    routes.sort((a, b) => compareRoutePatterns(a.pathPattern, b.pathPattern));

    if (debugRoutes) {
        console.group("[Helium Router] Final route order:");
        for (const route of routes) {
            console.log(`  ${route.pathPattern} (${route.render})`);
        }
        console.groupEnd();
    }

    return { routes, NotFound };
}
