import type { ComponentType } from "react";
import React, { useMemo, useSyncExternalStore, useTransition } from "react";

import { isDevEnvironment } from "./env.js";
import type { RouteEntry } from "./routerManifest.js";
import { buildRoutes } from "./routerManifest.js";

// Event emitter for router events
type RouterEvent = "navigation" | "before-navigation";
type EventListener = (event: { from: string; to: string; preventDefault?: () => void }) => void;

class RouterEventEmitter {
    private listeners: Map<RouterEvent, Set<EventListener>> = new Map();

    on(event: RouterEvent, listener: EventListener): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Return unsubscribe function
        return () => {
            this.listeners.get(event)?.delete(listener);
        };
    }

    emit(event: RouterEvent, data: { from: string; to: string }): boolean {
        const eventListeners = this.listeners.get(event);
        if (!eventListeners || eventListeners.size === 0) {
            return true;
        }

        let prevented = false;
        const preventDefault = () => {
            prevented = true;
        };

        const eventData = event === "before-navigation" ? { ...data, preventDefault } : data;

        eventListeners.forEach((listener) => {
            listener(eventData);
        });

        return !prevented;
    }

    // Clear all listeners - useful for HMR
    clear() {
        this.listeners.clear();
    }
}

// Use a singleton that survives HMR by attaching to window in dev mode
let routerEventEmitter: RouterEventEmitter;

if (typeof window !== "undefined" && isDevEnvironment()) {
    // In dev mode, reuse the same emitter instance across HMR
    const globalWindow = window as typeof window & { __heliumRouterEmitter?: RouterEventEmitter };
    if (!globalWindow.__heliumRouterEmitter) {
        globalWindow.__heliumRouterEmitter = new RouterEventEmitter();
    }
    routerEventEmitter = globalWindow.__heliumRouterEmitter;
} else {
    routerEventEmitter = new RouterEventEmitter();
}

type RouterState = {
    path: string;
    searchParams: URLSearchParams;
    isNavigating: boolean;
};

function getLocation(): RouterState {
    const { pathname, search } = window.location;
    return {
        path: pathname,
        searchParams: new URLSearchParams(search),
        isNavigating: false,
    };
}

function matchRoute(path: string, routes: RouteEntry[]) {
    for (const r of routes) {
        const m = r.matcher(path);
        if (m) {
            return { params: m.params, route: r };
        }
    }
    return null;
}

// Location store for useSyncExternalStore
// Preserve across HMR by attaching to window in dev mode
let currentLocation: RouterState;
let locationListeners: Set<() => void>;

if (typeof window !== "undefined" && isDevEnvironment()) {
    const globalWindow = window as typeof window & {
        __heliumCurrentLocation?: RouterState;
        __heliumLocationListeners?: Set<() => void>;
    };
    if (!globalWindow.__heliumCurrentLocation) {
        globalWindow.__heliumCurrentLocation = getLocation();
    }
    if (!globalWindow.__heliumLocationListeners) {
        globalWindow.__heliumLocationListeners = new Set();
    }
    currentLocation = globalWindow.__heliumCurrentLocation;
    locationListeners = globalWindow.__heliumLocationListeners;
} else if (typeof window !== "undefined") {
    currentLocation = getLocation();
    locationListeners = new Set();
} else {
    currentLocation = { path: "/", searchParams: new URLSearchParams(), isNavigating: false };
    locationListeners = new Set();
}

// Helper to re-extract params from path using stored routes during HMR
function extractParamsFromPath(path: string): Record<string, string | string[]> {
    if (typeof window !== "undefined" && isDevEnvironment()) {
        const globalWindow = window as typeof window & { __heliumGlobalRoutes?: RouteEntry[] };
        const routes = globalWindow.__heliumGlobalRoutes;
        if (routes && routes.length > 0) {
            const match = matchRoute(path, routes);
            if (match) {
                return match.params;
            }
        }
    }
    return {};
}

function subscribeToLocation(callback: () => void) {
    locationListeners.add(callback);
    return () => locationListeners.delete(callback);
}

function getLocationSnapshot() {
    return currentLocation;
}

function getServerSnapshot() {
    return { path: "/", searchParams: new URLSearchParams(), isNavigating: false };
}

function updateLocation(isNavigating = false) {
    const newLocation = { ...getLocation(), isNavigating };
    currentLocation = newLocation;
    // Update the global reference in dev mode
    if (typeof window !== "undefined" && isDevEnvironment()) {
        (window as typeof window & { __heliumCurrentLocation?: RouterState }).__heliumCurrentLocation = newLocation;
    }
    locationListeners.forEach((listener) => listener());
}

// Set up global listeners once
if (typeof window !== "undefined") {
    // Only set up once, survives HMR
    const globalWindow = window as typeof window & { __heliumLocationListenerSetup?: boolean };
    if (!globalWindow.__heliumLocationListenerSetup) {
        globalWindow.__heliumLocationListenerSetup = true;

        window.addEventListener("popstate", () => updateLocation(false));

        // Also listen to navigation events from the emitter
        routerEventEmitter.on("navigation", () => updateLocation(false));
    }
}

/** Options for push/replace navigation methods */
export interface RouterNavigationOptions {
    /** Scroll to top after navigation (default: true) */
    scrollToTop?: boolean;
}

// Context for useRouter hook
type RouterContext = {
    path: string;
    params: Record<string, string | string[]>;
    searchParams: URLSearchParams;
    push: (href: string, options?: RouterNavigationOptions) => void;
    replace: (href: string, options?: RouterNavigationOptions) => void;
    on: (event: RouterEvent, listener: EventListener) => () => void;
    status: 200 | 404;
    isNavigating: boolean;
    /** Indicates content is stale (old content shown while new content renders) - React 18+ concurrent feature */
    isPending: boolean;
};

export const RouterContext = React.createContext<RouterContext | null>(null);

/**
 * Access router context inside a component tree managed by <AppRouter />.
 *
 * Provides current path, route params, URL search params and navigation helpers
 * (\`push\`, \`replace\`) as well as an \`on\` method to subscribe to navigation events.
 * The \`isNavigating\` property indicates when a navigation is in progress.
 * The \`isPending\` property indicates when content is stale (React concurrent features).
 * Throws when used outside of an <AppRouter /> provider.
 */
export function useRouter() {
    const ctx = React.useContext(RouterContext);
    if (!ctx) {
        // During HMR in development, context might be temporarily unavailable
        // Provide a temporary fallback to prevent white screen of death
        // Re-extract params from current path using stored routes
        if (typeof window !== "undefined" && isDevEnvironment()) {
            const currentPath = window.location.pathname;
            return {
                path: currentPath,
                params: extractParamsFromPath(currentPath),
                searchParams: new URLSearchParams(window.location.search),
                push: (href: string, options?: RouterNavigationOptions) => {
                    window.history.pushState({}, "", href);
                    if (options?.scrollToTop !== false) {
                        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                    }
                    window.dispatchEvent(new PopStateEvent("popstate"));
                },
                replace: (href: string, options?: RouterNavigationOptions) => {
                    window.history.replaceState({}, "", href);
                    if (options?.scrollToTop !== false) {
                        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                    }
                    window.dispatchEvent(new PopStateEvent("popstate"));
                },
                on: () => () => {},
                status: 200 as const,
                isNavigating: false,
                isPending: false,
            };
        }
        throw new Error("useRouter must be used inside <AppRouter>");
    }
    return ctx;
}

/**
 * Redirect component for declarative navigation.
 * Use this instead of calling router.push() during render.
 *
 * @example
 * \`\`\`tsx
 * export default function Docs() {
 *   return <Redirect to="/docs/getting-started" />;
 * }
 * \`\`\`
 */
export function Redirect({ to, replace = false }: { to: string; replace?: boolean }) {
    const hasRedirected = React.useRef(false);

    // Use useLayoutEffect to redirect before paint
    React.useLayoutEffect(() => {
        const targetPath = to.split("?")[0];
        if (!hasRedirected.current && window.location.pathname !== targetPath) {
            hasRedirected.current = true;

            // Perform navigation
            if (replace) {
                window.history.replaceState(null, "", to);
            } else {
                window.history.pushState(null, "", to);
            }

            // Emit navigation event to update router state
            routerEventEmitter.emit("navigation", {
                from: window.location.pathname,
                to: targetPath,
            });
        }
    }, [to, replace]);

    return null;
}

/** Options for navigation */
interface NavigateOptions {
    replace?: boolean;
    scrollToTop?: boolean;
}

// Navigation helper
function navigate(href: string, options: NavigateOptions = {}) {
    const { replace = false, scrollToTop = true } = options;
    const from = window.location.pathname;
    const to = href.split("?")[0]; // Extract pathname from href

    // Emit before-navigation event (can be prevented)
    const canNavigate = routerEventEmitter.emit("before-navigation", { from, to });
    if (!canNavigate) {
        return; // Navigation was prevented
    }

    // Set navigating state to true before navigation
    currentLocation = { ...currentLocation, isNavigating: true };
    locationListeners.forEach((listener) => listener());

    if (replace) {
        window.history.replaceState(null, "", href);
    } else {
        window.history.pushState(null, "", href);
    }

    // Scroll to top immediately after pushState, before React re-renders.
    // Using instant scroll avoids race conditions where smooth scrolling
    // gets interrupted by React DOM updates, especially on Safari mobile.
    if (scrollToTop) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }

    // Update location state synchronously so there is no stale-state window
    // between pushState and the next render.
    updateLocation(false);

    // Emit navigation event after state is consistent
    routerEventEmitter.emit("navigation", { from, to });
}

export type LinkProps = React.PropsWithChildren<
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
        href: string;
        replace?: boolean;
        /** Disable prefetching on hover (default: false - prefetch is enabled) */
        prefetch?: boolean;
        /** Scroll to top after navigation (default: true) */
        scrollToTop?: boolean;
    }
>;

/**
 * Check if a URL is external (different origin).
 */
function isExternalUrl(href: string): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const url = new URL(href, window.location.origin);
        return url.origin !== window.location.origin;
    } catch {
        return false;
    }
}

// Store routes globally for prefetching (set by AppRouter)
// Preserve across HMR in dev mode
let globalRoutes: RouteEntry[];

if (typeof window !== "undefined" && isDevEnvironment()) {
    const globalWindow = window as typeof window & { __heliumGlobalRoutes?: RouteEntry[] };
    if (!globalWindow.__heliumGlobalRoutes) {
        globalWindow.__heliumGlobalRoutes = [];
    }
    globalRoutes = globalWindow.__heliumGlobalRoutes;
} else {
    globalRoutes = [];
}

/**
 * Client-side navigation link.
 *
 * Intercepts left-clicks and uses the router's navigation helpers for SPA
 * navigation. Keeps normal anchor behaviour when modifier keys are used,
 * when the link is external, or when `target` / `download` attributes
 * are present.
 *
 * Automatically prefetches page chunks on hover for faster navigation.
 */
export function Link(props: LinkProps) {
    const {
        children,
        href,
        className,
        prefetch: prefetchProp = true,
        scrollToTop = true,
        replace: replaceProp,
        target,
        download,
        onClick: userOnClick,
        onMouseEnter: userOnMouseEnter,
        onFocus: userOnFocus,
        ...restProps
    } = props;

    const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Let user's onClick run first so they can call e.preventDefault()
        userOnClick?.(e);

        if (
            e.defaultPrevented ||
            e.button !== 0 || // only left click
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            target || // let browser handle target="_blank" etc.
            download != null || // let browser handle downloads
            isExternalUrl(href) // let browser handle external links
        ) {
            return;
        }
        e.preventDefault();
        navigate(href, { replace: replaceProp, scrollToTop });
    };

    const onMouseEnter = async (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Prefetch the route on hover if enabled and not external (lazy-load prefetch logic)
        if (prefetchProp && !isExternalUrl(href) && globalRoutes.length > 0) {
            const { prefetchRoute } = await import("./prefetch.js");
            prefetchRoute(href, globalRoutes);
        }
        userOnMouseEnter?.(e);
    };

    const onFocus = async (e: React.FocusEvent<HTMLAnchorElement>) => {
        // Also prefetch on focus (keyboard navigation)
        if (prefetchProp && !isExternalUrl(href) && globalRoutes.length > 0) {
            const { prefetchRoute } = await import("./prefetch.js");
            prefetchRoute(href, globalRoutes);
        }
        userOnFocus?.(e);
    };

    return (
        <a {...restProps} href={href} target={target} download={download} onClick={onClick} onMouseEnter={onMouseEnter} onFocus={onFocus} className={className}>
            {children}
        </a>
    );
}

// AppShell props type
/**
 * Props passed to an optional \`AppShell\` wrapper component used by <AppRouter />.
 *
 * \`Component\` — the page component to render. \`pageProps\` — props provided to the page.
 */
export type AppShellProps<TPageProps extends Record<string, unknown> = Record<string, unknown>> = {
    Component: ComponentType<TPageProps>;
    pageProps: TPageProps;
};

// Main router component
export function AppRouter({ AppShell }: { AppShell?: ComponentType<AppShellProps> }) {
    // useTransition for concurrent rendering - allows React to keep UI responsive during navigation
    const [isPending, startTransition] = useTransition();

    // Build routes once on mount (client-side only)
    const { routes, NotFound } = useMemo(() => {
        if (typeof window === "undefined") {
            return { routes: [], NotFound: undefined };
        }
        const result = buildRoutes();
        // Store routes globally for Link prefetching
        // In dev mode, also update the global reference to survive HMR
        if (isDevEnvironment()) {
            const globalWindow = window as typeof window & { __heliumGlobalRoutes?: RouteEntry[] };
            globalWindow.__heliumGlobalRoutes = result.routes;
            // Update the module-level reference as well
            globalRoutes.length = 0;
            globalRoutes.push(...result.routes);
        } else {
            globalRoutes = result.routes;
        }
        return result;
    }, []);

    // Use useSyncExternalStore to subscribe to location changes
    // This ensures synchronous updates when location changes
    const state = useSyncExternalStore(subscribeToLocation, getLocationSnapshot, getServerSnapshot);

    const match = useMemo(() => matchRoute(state.path, routes), [state.path, routes]);

    // Use matched params, or fall back to re-extracting from path using global routes during HMR
    const currentParams = match?.params ?? (isDevEnvironment() ? extractParamsFromPath(state.path) : {});

    // In dev mode, always read fresh searchParams from URL to handle HMR edge cases
    const currentSearchParams = isDevEnvironment() ? new URLSearchParams(window.location.search) : state.searchParams;

    const routerValue: RouterContext = {
        path: state.path,
        params: currentParams,
        searchParams: currentSearchParams,
        push: (href, options) => {
            // Wrap navigation in startTransition for smoother updates
            startTransition(() => {
                navigate(href, { scrollToTop: options?.scrollToTop });
            });
        },
        replace: (href, options) => {
            startTransition(() => {
                navigate(href, { replace: true, scrollToTop: options?.scrollToTop });
            });
        },
        on: (event, listener) => routerEventEmitter.on(event, listener),
        status: match ? 200 : 404,
        isNavigating: state.isNavigating,
        isPending,
    };

    React.useEffect(() => {
        const controller = new AbortController();
        const targetPath = `${state.path}${window.location.search || ""}`;

        const syncMetadata = async () => {
            try {
                const response = await fetch(`/__helium__/seo-metadata?path=${encodeURIComponent(targetPath)}`, {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    signal: controller.signal,
                });

                if (!response.ok) {
                    return;
                }

                const payload = (await response.json()) as { meta?: ClientSocialMeta | null };
                applyRouteMetadata(payload.meta ?? null);
            } catch (error) {
                if ((error as { name?: string })?.name === "AbortError") {
                    return;
                }
            }
        };

        syncMetadata();

        return () => controller.abort();
    }, [state.path, currentSearchParams.toString()]);

    if (!match) {
        const NotFoundComp = NotFound ?? (() => <div>Not found</div>);
        const content = <NotFoundComp />;

        return <RouterContext.Provider value={routerValue}>{AppShell ? <AppShell Component={NotFoundComp} pageProps={{}} /> : content}</RouterContext.Provider>;
    }

    const Page = match.route.Component as ComponentType<{ params: Record<string, string | string[]>; searchParams: URLSearchParams }>;
    const pageProps = {
        params: match.params,
        searchParams: currentSearchParams,
    };

    // Create a wrapped component that includes all layouts
    const WrappedPage = () => {
        let content = <Page {...pageProps} />;
        // Wrap page with layouts (from outer to inner)
        for (let i = match.route.layouts.length - 1; i >= 0; i--) {
            const Layout = match.route.layouts[i];
            content = <Layout>{content}</Layout>;
        }
        return content;
    };

    const finalContent = AppShell ? <AppShell Component={WrappedPage} pageProps={{}} /> : <WrappedPage />;

    return <RouterContext.Provider value={routerValue}>{finalContent}</RouterContext.Provider>;
}

type ClientSocialMeta = {
    title: string;
    description?: string;
    image?: string;
    canonicalUrl?: string;
    siteName?: string;
    type?: string;
    robots?: string;
    twitterCard?: "summary" | "summary_large_image" | "app" | "player";
    twitterSite?: string;
    twitterCreator?: string;
};

function applyRouteMetadata(meta: ClientSocialMeta | null) {
    if (typeof document === "undefined") {
        return;
    }

    const managedNodes = document.head.querySelectorAll('[data-helium-seo="true"]');
    managedNodes.forEach((node) => node.remove());

    if (!meta) {
        return;
    }

    document.title = meta.title;

    const entries: Array<{ tag: "meta" | "link"; attrs: Record<string, string> }> = [];

    entries.push({ tag: "meta", attrs: { property: "og:title", content: meta.title } });
    entries.push({ tag: "meta", attrs: { property: "og:type", content: meta.type ?? "website" } });
    entries.push({ tag: "meta", attrs: { name: "twitter:card", content: meta.twitterCard ?? "summary_large_image" } });
    entries.push({ tag: "meta", attrs: { name: "twitter:title", content: meta.title } });

    if (meta.description) {
        entries.push({ tag: "meta", attrs: { name: "description", content: meta.description } });
        entries.push({ tag: "meta", attrs: { property: "og:description", content: meta.description } });
        entries.push({ tag: "meta", attrs: { name: "twitter:description", content: meta.description } });
    }

    if (meta.image) {
        entries.push({ tag: "meta", attrs: { property: "og:image", content: meta.image } });
        entries.push({ tag: "meta", attrs: { name: "twitter:image", content: meta.image } });
    }

    if (meta.canonicalUrl) {
        entries.push({ tag: "meta", attrs: { property: "og:url", content: meta.canonicalUrl } });
        entries.push({ tag: "link", attrs: { rel: "canonical", href: meta.canonicalUrl } });
    }

    if (meta.siteName) {
        entries.push({ tag: "meta", attrs: { property: "og:site_name", content: meta.siteName } });
    }

    if (meta.robots) {
        entries.push({ tag: "meta", attrs: { name: "robots", content: meta.robots } });
    }

    if (meta.twitterSite) {
        entries.push({ tag: "meta", attrs: { name: "twitter:site", content: meta.twitterSite } });
    }

    if (meta.twitterCreator) {
        entries.push({ tag: "meta", attrs: { name: "twitter:creator", content: meta.twitterCreator } });
    }

    for (const entry of entries) {
        const node = document.createElement(entry.tag);
        for (const [key, value] of Object.entries(entry.attrs)) {
            node.setAttribute(key, value);
        }
        node.setAttribute("data-helium-seo", "true");
        document.head.appendChild(node);
    }
}
