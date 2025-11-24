import type { ComponentType } from "react";

import { log } from "../utils/logger.js";

export type LayoutProps = {
    children: React.ReactNode;
};

export type RouteEntry = {
    pathPattern: string; // "/tasks/:id"
    matcher: (path: string) => { params: Record<string, string | string[]> } | null;
    Component: ComponentType<any>;
    layouts: ComponentType<LayoutProps>[]; // Array of layouts from root to leaf
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
 */
function pathFromFile(file: string): string {
    // Remove /src/pages prefix and file extension
    const withoutPrefix = file.replace("/src/pages", "").replace(/\.(tsx|jsx|ts|js)$/, "");

    // Handle special files
    if (withoutPrefix === "/404") {
        return "__404__";
    }

    // Convert /index to /
    let pattern = withoutPrefix.replace(/\/index$/, "") || "/";
    // Convert [...param] to *param (catch-all)
    pattern = pattern.replace(/\[\.\.\.(.+?)\]/g, "*$1");
    // Convert [param] to :param (single dynamic segment)
    pattern = pattern.replace(/\[(.+?)\]/g, ":$1");

    return pattern;
}

/**
 * Create a matcher function for a route pattern
 * Supports dynamic segments like :id, :slug, etc.
 * Supports catch-all segments like *slug for [...slug]
 */
function createMatcher(pattern: string) {
    const segments = pattern.split("/").filter(Boolean);

    return (path: string) => {
        // Remove query string and hash
        const cleanPath = path.split("?")[0].split("#")[0];
        const pathSegments = cleanPath.split("/").filter(Boolean);

        // For root path, handle specially
        if (pattern === "/" && cleanPath === "/") {
            return { params: {} };
        }

        const params: Record<string, string | string[]> = {};

        // Check for catch-all segment (must be last)
        const hasCatchAll = segments.some((seg) => seg.startsWith("*"));
        if (hasCatchAll) {
            const catchAllIndex = segments.findIndex((seg) => seg.startsWith("*"));

            // Catch-all must be the last segment
            if (catchAllIndex !== segments.length - 1) {
                log("warn", `Catch-all segment must be last: ${pattern}`);
                return null;
            }

            const catchAllParam = segments[catchAllIndex].slice(1); // Remove *

            // Match segments before catch-all
            for (let i = 0; i < catchAllIndex; i++) {
                const seg = segments[i];
                const value = pathSegments[i];

                if (!value) {
                    return null;
                } // Not enough path segments

                if (seg.startsWith(":")) {
                    params[seg.slice(1)] = decodeURIComponent(value);
                } else if (seg !== value) {
                    return null; // Static segment must match
                }
            }

            // Collect remaining path segments into catch-all param as an array
            const remainingSegments = pathSegments.slice(catchAllIndex);
            params[catchAllParam] = remainingSegments.map((s) => decodeURIComponent(s));

            return { params };
        }

        // Regular matching (no catch-all)
        // If segment counts don't match, no match
        if (segments.length !== pathSegments.length) {
            return null;
        }

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const value = pathSegments[i];

            if (seg.startsWith(":")) {
                // Dynamic segment
                params[seg.slice(1)] = decodeURIComponent(value);
            } else if (seg !== value) {
                // Static segment must match exactly
                return null;
            }
        }

        return { params };
    };
}

/**
 * Get directory path from file path
 * /src/pages/tasks/[id].tsx → /tasks
 */
function getDirectoryPath(file: string): string {
    const withoutPrefix = file.replace("/src/pages", "").replace(/\.(tsx|jsx|ts|js)$/, "");
    const parts = withoutPrefix.split("/");
    parts.pop(); // Remove filename
    return parts.join("/") || "/";
}

/**
 * Build route manifest from pages directory
 * Uses import.meta.glob to discover all page files
 */
export function buildRoutes(): {
    routes: RouteEntry[];
    NotFound?: ComponentType<any>;
    AppShell?: ComponentType<any>;
} {
    // SSR check - return empty routes if running server-side
    if (typeof window === "undefined") {
        return { routes: [], NotFound: undefined, AppShell: undefined };
    }

    // Eagerly load all page components
    const pages = import.meta.glob("/src/pages/**/*.{tsx,jsx,ts,js}", {
        eager: true,
    });

    const routes: RouteEntry[] = [];
    let NotFound: ComponentType<any> | undefined;
    let AppShell: ComponentType<any> | undefined;

    // Build layout map: directory path -> layout component
    const layoutMap = new Map<string, ComponentType<LayoutProps>>();

    // First pass: collect all layouts
    for (const [file, mod] of Object.entries(pages)) {
        if (file.includes("/_layout.")) {
            const Component = (mod as any).default;
            if (Component) {
                const dirPath = getDirectoryPath(file);
                layoutMap.set(dirPath, Component);
            }
        }
    }

    // Second pass: build routes with their layouts
    for (const [file, mod] of Object.entries(pages)) {
        // Skip layout files
        if (file.includes("/_layout.")) {
            continue;
        }

        const Component = (mod as any).default;
        if (!Component) {
            log("warn", `No default export found in ${file}`);
            continue;
        }

        const pathPattern = pathFromFile(file);

        // Handle special pages
        if (pathPattern === "__404__") {
            NotFound = Component;
            continue;
        }

        // Find all layouts for this route (from root to leaf)
        const layouts: ComponentType<LayoutProps>[] = [];
        const dirPath = getDirectoryPath(file);
        const pathParts = dirPath.split("/").filter(Boolean);

        // Check for layouts at each level
        for (let i = 0; i <= pathParts.length; i++) {
            const checkPath = i === 0 ? "/" : "/" + pathParts.slice(0, i).join("/");
            const layout = layoutMap.get(checkPath);
            if (layout) {
                layouts.push(layout);
            }
        }

        // Create route entry
        routes.push({
            pathPattern,
            matcher: createMatcher(pathPattern),
            Component,
            layouts,
        });
    }

    // Sort routes by specificity (static > dynamic > catch-all)
    routes.sort((a, b) => {
        const aHasCatchAll = a.pathPattern.includes("*");
        const bHasCatchAll = b.pathPattern.includes("*");
        const aHasDynamic = a.pathPattern.includes(":");
        const bHasDynamic = b.pathPattern.includes(":");

        // Catch-all routes should be last (least specific)
        if (aHasCatchAll && !bHasCatchAll) {
            return 1;
        }
        if (!aHasCatchAll && bHasCatchAll) {
            return -1;
        }

        // Dynamic routes come after static routes
        if (aHasDynamic && !bHasDynamic) {
            return 1;
        }
        if (!aHasDynamic && bHasDynamic) {
            return -1;
        }

        // Longer paths first (more specific)
        return b.pathPattern.length - a.pathPattern.length;
    });

    return { routes, NotFound, AppShell };
}
