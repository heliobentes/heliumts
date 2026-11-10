import type React from "react";

import type { useRouter as clientUseRouter } from "../client/Router.js";
import type { useCall as clientUseCall } from "../client/useCall.js";
import type { useFetch as clientUseFetch, UseFetchOptions } from "../client/useFetch.js";
import type { useStreaming as clientUseStreaming } from "../client/useStreaming.js";
import type { RpcStats } from "../runtime/protocol.js";

export type ServerRenderMode = "ssr" | "ssg";

/**
 * Shared server-rendering implementation. Keep runtime dependencies inside this
 * factory: its compiled JavaScript is embedded into Vite virtual modules and
 * standalone production/SSG builds, using each application's React instance.
 */
export function createServerClientAdapter(react: typeof React, mode: ServerRenderMode) {
    type RouterState = ReturnType<typeof clientUseRouter>;
    const noop = () => {};
    function routerState(): RouterState {
        const snapshot = (
            globalThis as typeof globalThis & {
                __HELIUM_SSR_ROUTER__?: { path?: string; params?: RouterState["params"]; search?: string };
            }
        ).__HELIUM_SSR_ROUTER__;
        return {
            path: mode === "ssr" && typeof snapshot?.path === "string" ? snapshot.path : "/",
            params: mode === "ssr" && snapshot?.params && typeof snapshot.params === "object" ? snapshot.params : {},
            searchParams: new URLSearchParams(mode === "ssr" && typeof snapshot?.search === "string" ? snapshot.search : ""),
            push: noop,
            replace: noop,
            on: () => noop,
            status: 200,
            isNavigating: false,
            isPending: false,
        };
    }
    const RouterContext = react.createContext<RouterState | null>(mode === "ssg" ? routerState() : null);
    function useRouter(): RouterState {
        // SSR reads the per-request snapshot; SSG installs a provider for each page.
        if (mode === "ssr") {
            return routerState();
        }
        return react.useContext(RouterContext) ?? routerState();
    }
    function Link(props: { href?: string; children?: React.ReactNode; prefetch?: unknown } & Record<string, unknown>) {
        const { href = mode === "ssr" ? "#" : undefined, children, prefetch: _prefetch, ...rest } = props;
        return react.createElement("a", { href, ...rest }, children);
    }
    function AppRouter({ children }: { children?: React.ReactNode } = {}) {
        return mode === "ssg" ? react.createElement(react.Fragment, null, children) : null;
    }
    async function callMethod(): Promise<never> {
        throw new Error("callMethod is only available in the browser. Load server data with getServerSideProps instead.");
    }
    async function streamRpc(): Promise<never> {
        throw new Error("streamRpc is only available in the browser. Load server data with getServerSideProps instead.");
    }
    function useCall(): ReturnType<typeof clientUseCall> {
        return {
            data: undefined,
            call: async () => undefined,
            submit: async () => ({ status: "error", error: new RpcError("useCall.submit is only available in the browser. Load server data with getServerSideProps instead.") }),
            isCalling: false,
            error: null,
            stats: null,
        };
    }
    function useFetch(_method?: unknown, _args?: unknown, options?: UseFetchOptions): ReturnType<typeof clientUseFetch> {
        if (mode === "ssg") {
            console.warn("useFetch called during SSG - returning undefined");
        }
        // Server rendering has no browser cache or effects. Match a fresh client
        // render while leaving all fetching to the browser after hydration.
        return { data: undefined, isLoading: options?.enabled ?? true, error: null, stats: null, refetch: async () => undefined };
    }
    function useStreaming(): ReturnType<typeof clientUseStreaming> {
        return {
            chunks: [],
            text: "",
            isStreaming: false,
            error: null,
            stats: null,
            start: async () => {
                throw new Error("useStreaming.start is only available in the browser. Load server data with getServerSideProps instead.");
            },
            cancel: noop,
            reset: noop,
        };
    }
    class RpcError extends Error {
        public readonly stats: RpcStats | null;
        constructor(message: string, stats?: RpcStats | null) {
            super(message);
            this.name = "RpcError";
            this.stats = stats ?? null;
        }
    }
    function getPublicEnv(): Record<string, string> {
        return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[0].startsWith("HELIUM_PUBLIC_") && typeof entry[1] === "string"));
    }
    function useDeferredNavigation() {
        const { path } = useRouter();
        return { path, deferredPath: path, isStale: false, isPending: false, isTransitioning: false };
    }
    function PageTransition({ children, fallback = null }: { children?: React.ReactNode; fallback?: React.ReactNode }) {
        return react.createElement("div", { style: { opacity: 1, transition: "opacity 150ms ease" } }, react.createElement(react.Suspense, { fallback }, children));
    }
    return {
        RouterContext,
        useRouter,
        Link,
        Redirect: () => null,
        AppRouter,
        Router: AppRouter,
        callMethod,
        streamRpc,
        useCall,
        useFetch,
        useStreaming,
        RpcError,
        getPublicEnv,
        getPublicEnvValue: (key: string) => getPublicEnv()[key],
        isDevEnvironment: () => false,
        isSSR: () => true,
        useDeferredNavigation,
        PageTransition,
        cache: { get: () => null, set: noop, delete: noop, clear: noop },
    };
}

export function generateServerClientModule(mode: ServerRenderMode): string {
    return `import React from 'react';
const adapter = (${createServerClientAdapter.toString()})(React, ${JSON.stringify(mode)});
export const { RouterContext, useRouter, Link, Redirect, AppRouter, callMethod, streamRpc,
useCall, useFetch, useStreaming, RpcError, getPublicEnv, getPublicEnvValue,
isDevEnvironment, isSSR${mode === "ssg" ? ", Router, cache, useDeferredNavigation, PageTransition" : ""} } = adapter;
`;
}

export function generateServerTransitionsModule(mode: ServerRenderMode): string {
    return `import React from 'react';
import { useRouter } from 'heliumts/client';
export function useDeferredNavigation() {
    const { path } = useRouter();
    return { path, deferredPath: path, isStale: false, isPending: false, isTransitioning: false };
}
export function PageTransition({ children, fallback = null }) {
    return React.createElement('div', { style: { opacity: 1, transition: 'opacity 150ms ease' } },
        React.createElement(React.Suspense, { fallback }, children));
}
${mode === "ssg" ? "export default { useDeferredNavigation, PageTransition };" : ""}
`;
}

export function generateServerPrefetchModule(): string {
    return "export function prefetchRoute() {}\nexport function clearPrefetchCache() {}\n";
}
