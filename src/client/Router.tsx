import type { ComponentType } from "react";
import React, { useEffect, useMemo, useState } from "react";

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
}

const routerEventEmitter = new RouterEventEmitter();

type RouterState = {
    path: string;
    searchParams: URLSearchParams;
};

function getLocation(): RouterState {
    const { pathname, search } = window.location;
    return {
        path: pathname,
        searchParams: new URLSearchParams(search),
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

// Context for useRouter hook
type RouterContext = {
    path: string;
    params: Record<string, string | string[]>;
    searchParams: URLSearchParams;
    push: (href: string) => void;
    replace: (href: string) => void;
    on: (event: RouterEvent, listener: EventListener) => () => void;
    status: 200 | 404;
};

export const RouterContext = React.createContext<RouterContext | null>(null);

/**
 * Access router context inside a component tree managed by <AppRouter />.
 *
 * Provides current path, route params, URL search params and navigation helpers
 * (`push`, `replace`) as well as an `on` method to subscribe to navigation events.
 * Throws when used outside of an <AppRouter /> provider.
 */
export function useRouter() {
    const ctx = React.useContext(RouterContext);
    if (!ctx) {
        // During HMR in development, context might be temporarily unavailable
        // Provide a temporary fallback to prevent white screen of death
        if (import.meta.env?.DEV) {
            console.warn("useRouter called before RouterContext is available (HMR reload). Using fallback.");
            return {
                path: window.location.pathname,
                params: {},
                searchParams: new URLSearchParams(window.location.search),
                push: (href: string) => window.history.pushState({}, "", href),
                replace: (href: string) => window.history.replaceState({}, "", href),
                on: () => () => {},
                status: 200,
            };
        }
        throw new Error("useRouter must be used inside <AppRouter>");
    }
    return ctx;
}

// Navigation helpers
function navigate(href: string, replace = false) {
    const from = window.location.pathname;
    const to = href.split("?")[0]; // Extract pathname from href

    // Emit before-navigation event (can be prevented)
    const canNavigate = routerEventEmitter.emit("before-navigation", { from, to });
    if (!canNavigate) {
        return; // Navigation was prevented
    }

    if (replace) {
        window.history.replaceState(null, "", href);
    } else {
        window.history.pushState(null, "", href);
    }

    // Emit navigation event after navigation completes
    routerEventEmitter.emit("navigation", { from, to });
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
 * Props passed to an optional `AppShell` wrapper component used by <AppRouter />.
 *
 * `Component` — the page component to render. `pageProps` — props provided to the page.
 */
export type AppShellProps = {
    Component: ComponentType<any>;
    pageProps: any;
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

    // Always use the current location if running in browser
    // This prevents hydration mismatches and flash of wrong route
    const [state, setState] = useState<RouterState>(() => {
        if (typeof window === "undefined") {
            return { path: "/", searchParams: new URLSearchParams() };
        }
        return getLocation();
    });

    useEffect(() => {
        const onLocationChange = () => setState(getLocation());
        window.addEventListener("popstate", onLocationChange);
        const unsubscribe = routerEventEmitter.on("navigation", onLocationChange);
        return () => {
            window.removeEventListener("popstate", onLocationChange);
            unsubscribe();
        };
    }, []);

    const match = useMemo(() => matchRoute(state.path, routes), [state.path, routes]);

    const routerValue: RouterContext = {
        path: state.path,
        params: match?.params ?? {},
        searchParams: state.searchParams,
        push: (href) => navigate(href),
        replace: (href) => navigate(href, true),
        on: (event, listener) => routerEventEmitter.on(event, listener),
        status: match ? 200 : 404,
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
