import { installStaleClientRecovery } from "./staleRecovery.js";

installStaleClientRecovery();

// Router components and hooks
export type { AppShellProps, LinkProps, RouterNavigationOptions } from "./Router.js";
export { AppRouter, Link, Redirect, RouterContext, useRouter } from "./Router.js";
export type { LayoutProps } from "./routerManifest.js";

// React 18+ page transitions (separate module for better tree-shaking)
// Import from "heliumts/client/transitions" to ensure they're only bundled when used
export type { PageTransitionProps } from "./transitions.js";

// RPC hooks for data fetching and mutations
export * from "./useCall.js";
export * from "./useFetch.js";

// RPC error type
export { RpcError } from "./RpcError.js";

/**
 * Returns `true` when the current code is executing during server-side rendering.
 * Use this in layouts or components to skip browser-only logic (e.g. auth guards)
 * while still rendering providers and structural content for SSR.
 */
export function isSSR(): boolean {
    return typeof window === "undefined";
}

// RPC transport info (configured via helium.config.js)
export type { RpcTransport } from "./rpcClient.js";
export { getRpcTransport, isAutoHttpOnMobileEnabled, preconnect } from "./rpcClient.js";

// Type definitions
export * from "./types.js";

// Internal - rpcClient and cache are used by hooks, not exposed to users
