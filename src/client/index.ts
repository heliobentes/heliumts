// Router components and hooks
export type { AppShellProps, LinkProps, RouterNavigationOptions } from "./Router.js";
export { AppRouter, Link, Redirect, RouterContext, useRouter } from "./Router.js";
export type { LayoutProps } from "./routerManifest.js";

// React 18+ page transitions (separate module for better tree-shaking)
// Import from "helium/client/transitions" to ensure they're only bundled when used
export type { PageTransitionProps } from "./transitions.js";

// RPC hooks for data fetching and mutations
export * from "./useCall.js";
export * from "./useFetch.js";

// RPC transport info (configured via helium.config.js)
export type { RpcTransport } from "./rpcClient.js";
export { getRpcTransport, isAutoHttpOnMobileEnabled, preconnect } from "./rpcClient.js";

// Type definitions
export * from "./types.js";

// Internal - rpcClient and cache are used by hooks, not exposed to users
