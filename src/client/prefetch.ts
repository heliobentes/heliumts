import type { RouteEntry } from "./routerManifest.js";

// Prefetch cache to avoid duplicate preloads
const prefetchedRoutes = new Set<string>();

/**
 * Prefetch a route's page component.
 * Called on Link hover to preload page chunks before navigation.
 */
export function prefetchRoute(href: string, routes: RouteEntry[]) {
    const pathname = href.split("?")[0];

    // Skip if already prefetched
    if (prefetchedRoutes.has(pathname)) {
        return;
    }

    // Find matching route
    for (const route of routes) {
        if (route.matcher(pathname)) {
            prefetchedRoutes.add(pathname);
            // Trigger the preload
            route.preload().catch(() => {
                // Remove from cache if preload fails so it can be retried
                prefetchedRoutes.delete(pathname);
            });
            break;
        }
    }
}

/**
 * Clear the prefetch cache.
 * Useful for testing or forcing re-prefetch.
 */
export function clearPrefetchCache() {
    prefetchedRoutes.clear();
}
