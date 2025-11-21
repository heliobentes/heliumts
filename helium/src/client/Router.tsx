import type { ComponentType } from 'react';
import React, { useEffect, useMemo, useState } from 'react';

import { buildRoutes } from './routerManifest';

const { routes, NotFound } = buildRoutes();

type RouterState = {
    path: string;
    search: URLSearchParams;
};

function getLocation(): RouterState {
    const { pathname, search } = window.location;
    return {
        path: pathname,
        search: new URLSearchParams(search),
    };
}

function matchRoute(path: string) {
    for (const r of routes) {
        const m = r.matcher(path);
        if (m) return { params: m.params, route: r };
    }
    return null;
}

// Context for useRouter hook
type RouterContextValue = {
    path: string;
    params: Record<string, string>;
    search: URLSearchParams;
    push: (href: string) => void;
    replace: (href: string) => void;
};

const RouterContext = React.createContext<RouterContextValue | null>(null);

export function useRouter() {
    const ctx = React.useContext(RouterContext);
    if (!ctx) throw new Error('useRouter must be used inside <AppRouter>');
    return ctx;
}

// Navigation helpers
function navigate(href: string, replace = false) {
    if (replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    const navEvent = new PopStateEvent('popstate');
    window.dispatchEvent(navEvent);
}

export type LinkProps = React.PropsWithChildren<{
    href: string;
    replace?: boolean;
    className?: string;
}>;

export function Link(props: LinkProps) {
    const onClick = (e: React.MouseEvent) => {
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
    };

    return (
        <a href={props.href} onClick={onClick} className={props.className}>
            {props.children}
        </a>
    );
}

// AppShell props type
export type AppShellProps = {
    Component: ComponentType<any>;
    pageProps: any;
};

// Main router component
export function AppRouter({ AppShell }: { AppShell?: ComponentType<AppShellProps> }) {
    const [state, setState] = useState<RouterState>(() =>
        typeof window === 'undefined' ? { path: '/', search: new URLSearchParams() } : getLocation()
    );

    useEffect(() => {
        const onPop = () => setState(getLocation());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const match = useMemo(() => matchRoute(state.path), [state.path]);

    const routerValue: RouterContextValue = {
        path: state.path,
        params: match?.params ?? {},
        search: state.search,
        push: (href) => navigate(href),
        replace: (href) => navigate(href, true),
    };

    if (!match) {
        const NotFoundComp = NotFound ?? (() => <div>Not found</div>);
        const content = <NotFoundComp />;

        return (
            <RouterContext.Provider value={routerValue}>
                {AppShell ? <AppShell Component={NotFoundComp} pageProps={{}} /> : content}
            </RouterContext.Provider>
        );
    }

    const Page = match.route.Component;
    const pageProps = {
        params: match.params,
        search: state.search,
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

    const finalContent = AppShell ? (
        <AppShell Component={WrappedPage} pageProps={{}} />
    ) : (
        <WrappedPage />
    );

    return <RouterContext.Provider value={routerValue}>{finalContent}</RouterContext.Provider>;
}
