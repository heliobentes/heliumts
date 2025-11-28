import type { ComponentType } from "react";
import React, { useMemo, useSyncExternalStore } from "react";

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

if (typeof window !== "undefined" && import.meta.env?.DEV) {
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
let currentLocation = typeof window !== "undefined" ? getLocation() : { path: "/", searchParams: new URLSearchParams(), isNavigating: false };
const locationListeners = new Set<() => void>();

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
    currentLocation = { ...getLocation(), isNavigating };
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

// Context for useRouter hook
type RouterContext = {
    path: string;
    params: Record<string, string | string[]>;
    searchParams: URLSearchParams;
    push: (href: string) => void;
    replace: (href: string) => void;
    on: (event: RouterEvent, listener: EventListener) => () => void;
    status: 200 | 404;
    isNavigating: boolean;
};

export const RouterContext = React.createContext<RouterContext | null>(null);

/**
 * Access router context inside a component tree managed by <AppRouter />.
 *
 * Provides current path, route params, URL search params and navigation helpers
 * (\`push\`, \`replace\`) as well as an \`on\` method to subscribe to navigation events.
 * The \`isNavigating\` property indicates when a navigation is in progress.
 * Throws when used outside of an <AppRouter /> provider.
 */
export function useRouter() {
    const ctx = React.useContext(RouterContext);
    if (!ctx) {
        // During HMR in development, context might be temporarily unavailable
        // Provide a temporary fallback to prevent white screen of death
        if (typeof window !== "undefined" && import.meta.env?.DEV) {
            console.warn("useRouter called before RouterContext is available (HMR reload). Using fallback.");
            return {
                path: window.location.pathname,
                params: {},
                searchParams: new URLSearchParams(window.location.search),
                push: (href: string) => {
                    window.history.pushState({}, "", href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                },
                replace: (href: string) => {
                    window.history.replaceState({}, "", href);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                },
                on: () => () => {},
                status: 200 as const,
                isNavigating: false,
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

// Navigation helper
function navigate(href: string, replace = false) {
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

    // Update location and clear navigating state after navigation
    // Use requestAnimationFrame to allow the new page to start rendering
    requestAnimationFrame(() => {
        updateLocation(false);
        // Emit navigation event after navigation completes
        routerEventEmitter.emit("navigation", { from, to });
    });
}

export type LinkProps = React.PropsWithChildren<
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
        href: string;
        replace?: boolean;
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

/**
 * Client-side navigation link.
 *
 * Intercepts left-clicks and uses the router's navigation helpers for SPA
 * navigation. Keeps normal anchor behaviour when modifier keys are used
 * or when the link is external.
 */
export function Link(props: LinkProps) {
    const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            e.defaultPrevented ||
            e.button !== 0 || // only left click
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            isExternalUrl(props.href) // let browser handle external links
        ) {
            return;
        }
        e.preventDefault();
        navigate(props.href, props.replace);
        props.onClick?.(e);
    };
    const { children, href, className, ...safeProps } = props;

    return (
        <a href={href} onClick={onClick} className={className} {...safeProps}>
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
    // Build routes once on mount (client-side only)
    const { routes, NotFound } = useMemo(() => {
        if (typeof window === "undefined") {
            return { routes: [], NotFound: undefined };
        }
        return buildRoutes();
    }, []);

    // Use useSyncExternalStore to subscribe to location changes
    // This ensures synchronous updates when location changes
    const state = useSyncExternalStore(subscribeToLocation, getLocationSnapshot, getServerSnapshot);

    const match = useMemo(() => matchRoute(state.path, routes), [state.path, routes]);

    const routerValue: RouterContext = {
        path: state.path,
        params: match?.params ?? {},
        searchParams: state.searchParams,
        push: (href) => navigate(href),
        replace: (href) => navigate(href, true),
        on: (event, listener) => routerEventEmitter.on(event, listener),
        status: match ? 200 : 404,
        isNavigating: state.isNavigating,
    };

    if (!match) {
        const NotFoundComp = NotFound ?? (() => <div>Not found</div>);
        const content = <NotFoundComp />;

        return <RouterContext.Provider value={routerValue}>{AppShell ? <AppShell Component={NotFoundComp} pageProps={{}} /> : content}</RouterContext.Provider>;
    }

    const Page = match.route.Component;
    const pageProps = {
        params: match.params,
        searchParams: state.searchParams,
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
