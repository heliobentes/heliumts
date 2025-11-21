import type { ComponentType } from 'react';

export type LayoutProps = {
    children: React.ReactNode;
};

export type RouteEntry = {
    pathPattern: string; // "/tasks/:id"
    matcher: (path: string) => { params: Record<string, string> } | null;
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
 * - /src/pages/404.tsx → __404__
 * - /src/pages/_app.tsx → __APP__
 */
function pathFromFile(file: string): string {
    // Remove /src/pages prefix and file extension
    const withoutPrefix = file.replace('/src/pages', '').replace(/\.(tsx|jsx|ts|js)$/, '');

    // Handle special files
    if (withoutPrefix === '/404') return '__404__';
    if (withoutPrefix === '/_app') return '__APP__';

    // Convert /index to /
    let pattern = withoutPrefix.replace(/\/index$/, '') || '/';
    // Convert [param] to :param
    pattern = pattern.replace(/\[(.+?)\]/g, ':$1');

    return pattern;
}

/**
 * Create a matcher function for a route pattern
 * Supports dynamic segments like :id, :slug, etc.
 */
function createMatcher(pattern: string) {
    const segments = pattern.split('/').filter(Boolean);

    return (path: string) => {
        // Remove query string and hash
        const cleanPath = path.split('?')[0].split('#')[0];
        const pathSegments = cleanPath.split('/').filter(Boolean);

        // For root path, handle specially
        if (pattern === '/' && cleanPath === '/') {
            return { params: {} };
        }

        // If segment counts don't match, no match
        if (segments.length !== pathSegments.length) {
            return null;
        }

        const params: Record<string, string> = {};

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const value = pathSegments[i];

            if (seg.startsWith(':')) {
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
    const withoutPrefix = file.replace('/src/pages', '').replace(/\.(tsx|jsx|ts|js)$/, '');
    const parts = withoutPrefix.split('/');
    parts.pop(); // Remove filename
    return parts.join('/') || '/';
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
    // Eagerly load all page components
    const pages = import.meta.glob('/src/pages/**/*.{tsx,jsx,ts,js}', {
        eager: true,
    });

    const routes: RouteEntry[] = [];
    let NotFound: ComponentType<any> | undefined;
    let AppShell: ComponentType<any> | undefined;

    // Build layout map: directory path -> layout component
    const layoutMap = new Map<string, ComponentType<LayoutProps>>();

    // First pass: collect all layouts
    for (const [file, mod] of Object.entries(pages)) {
        if (file.includes('/_layout.')) {
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
        if (file.includes('/_layout.')) {
            continue;
        }

        const Component = (mod as any).default;
        if (!Component) {
            console.warn(`No default export found in ${file}`);
            continue;
        }

        const pathPattern = pathFromFile(file);

        // Handle special pages
        if (pathPattern === '__404__') {
            NotFound = Component;
            continue;
        }
        if (pathPattern === '__APP__') {
            AppShell = Component;
            continue;
        }

        // Find all layouts for this route (from root to leaf)
        const layouts: ComponentType<LayoutProps>[] = [];
        const dirPath = getDirectoryPath(file);
        const pathParts = dirPath.split('/').filter(Boolean);

        // Check for layouts at each level
        for (let i = 0; i <= pathParts.length; i++) {
            const checkPath = i === 0 ? '/' : '/' + pathParts.slice(0, i).join('/');
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

    // Sort routes by specificity (static segments before dynamic)
    routes.sort((a, b) => {
        const aHasDynamic = a.pathPattern.includes(':');
        const bHasDynamic = b.pathPattern.includes(':');

        if (aHasDynamic && !bHasDynamic) return 1;
        if (!aHasDynamic && bHasDynamic) return -1;

        // Longer paths first (more specific)
        return b.pathPattern.length - a.pathPattern.length;
    });

    return { routes, NotFound, AppShell };
}
