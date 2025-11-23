import type { ComponentType } from "react";
import React, { useEffect, useMemo, useState } from "react";

import { buildRoutes } from "./routerManifest";

const { routes, NotFound } = buildRoutes();

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

function matchRoute(path: string) {
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
    const navEvent = new PopStateEvent("popstate");
    window.dispatchEvent(navEvent);

    // Emit navigation event after navigation completes
    routerEventEmitter.emit("navigation", { from, to });
}

export type LinkProps = React.PropsWithChildren<
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
        href: string;
        replace?: boolean;
    }
>;

const preloadedUrls: Record<string, boolean> = {};

function pointerenterHandler(e: React.PointerEvent<HTMLAnchorElement>) {
    if (!HTMLScriptElement.supports || !HTMLScriptElement.supports("speculationrules")) {
        return;
    }
    if (preloadedUrls[e.currentTarget.href]) {
        return;
    }
    preloadedUrls[e.currentTarget.href] = true;
    const prefetcher = document.createElement("link");

    prefetcher.as = prefetcher.relList.supports("prefetch") ? "document" : "fetch";
    prefetcher.rel = prefetcher.relList.supports("prefetch") ? "prefetch" : "preload";
    prefetcher.href = e.currentTarget.href;

    document.head.appendChild(prefetcher);
}

/**
 * Client-side navigation link.
 *
 * Intercepts left-clicks and uses the router's navigation helpers for SPA
 * navigation. Keeps normal anchor behaviour when modifier keys are used.
 */
export function Link(props: LinkProps) {
    const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            e.defaultPrevented ||
            e.button !== 0 || // only left click
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey
        ) {
            return;
        }
        e.preventDefault();
        navigate(props.href, props.replace);
        props.onClick?.(e);
    };
    const { children, href, className, ...safeProps } = props;

    return (
        <a href={href} onClick={onClick} className={className} onPointerEnter={pointerenterHandler} {...safeProps}>
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
    const [state, setState] = useState<RouterState>(() => (typeof window === "undefined" ? { path: "/", searchParams: new URLSearchParams() } : getLocation()));

    useEffect(() => {
        const onPop = () => setState(getLocation());
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const match = useMemo(() => matchRoute(state.path), [state.path]);

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
