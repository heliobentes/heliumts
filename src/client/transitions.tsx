import React, { useDeferredValue } from "react";

import { useRouter } from "./Router.js";

/**
 * Hook for smooth navigation transitions using React 18+ concurrent features.
 *
 * Integrates `useDeferredValue` and `useTransition` with the router for
 * smoother navigation to heavy pages. When navigating, the old content
 * remains visible (at reduced opacity via `isStale`) while the new page
 * renders in the background.
 *
 * @example
 * ```tsx
 * function Layout({ children }: { children: React.ReactNode }) {
 *   const { isStale, isPending } = useDeferredNavigation();
 *
 *   return (
 *     <div style={{ opacity: isStale || isPending ? 0.7 : 1 }}>
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDeferredNavigation() {
    const router = useRouter();

    // useDeferredValue marks the path as "deferrable" - React can show stale
    // content while new content renders in the background
    const deferredPath = useDeferredValue(router.path);

    // isStale is true when showing old content while new content renders
    const isStale = deferredPath !== router.path;

    return {
        /** Current path being navigated to */
        path: router.path,
        /** Deferred path (may lag behind during transitions) */
        deferredPath,
        /** True when showing stale content (old page while new page renders) */
        isStale,
        /** True when a navigation transition is in progress */
        isPending: router.isPending,
        /** True when either navigating or showing stale content */
        isTransitioning: isStale || router.isPending || router.isNavigating,
    };
}

/**
 * Props for the PageTransition component.
 */
export type PageTransitionProps = {
    children: React.ReactNode;
    /** CSS class applied when content is loading/transitioning */
    loadingClassName?: string;
    /** Inline style applied when content is loading/transitioning */
    loadingStyle?: React.CSSProperties;
    /** Custom fallback to show during Suspense (default: null) */
    fallback?: React.ReactNode;
};

/**
 * Built-in page transition component that handles navigation transitions.
 *
 * Wraps children with Suspense for lazy-loaded pages and applies
 * visual feedback during transitions using React 18+ concurrent features.
 *
 * @example
 * ```tsx
 * // In your root layout
 * import { PageTransition } from "helium/client/transitions";
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <div>
 *       <Header />
 *       <PageTransition
 *         loadingClassName="opacity-50 transition-opacity"
 *         fallback={<LoadingSpinner />}
 *       >
 *         {children}
 *       </PageTransition>
 *       <Footer />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With inline styles
 * <PageTransition
 *   loadingStyle={{ opacity: 0.6, transition: 'opacity 150ms ease' }}
 * >
 *   {children}
 * </PageTransition>
 * ```
 */
export function PageTransition({ children, loadingClassName, loadingStyle, fallback = null }: PageTransitionProps) {
    const { isPending, isTransitioning } = useDeferredNavigation();
    const isLoading = isPending || isTransitioning;

    const defaultLoadingStyle: React.CSSProperties = {
        opacity: isLoading ? 0.7 : 1,
        transition: "opacity 150ms ease",
    };

    const combinedStyle = loadingStyle ? { ...defaultLoadingStyle, ...(isLoading ? loadingStyle : {}) } : defaultLoadingStyle;

    return (
        <div className={isLoading ? loadingClassName : undefined} style={combinedStyle}>
            <React.Suspense fallback={fallback}>{children}</React.Suspense>
        </div>
    );
}
