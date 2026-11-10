import type { IncomingHttpHeaders, IncomingMessage } from "http";
import type { ComponentType } from "react";
import React from "react";
import ReactDOMServer from "react-dom/server";

import { createMatcher, type PageRoute } from "../runtime/pageRoutes.js";
import { compareRoutePatterns } from "../runtime/routeOrder.js";
import { replaceHtmlRootContents } from "../utils/html.js";
import type { HeliumContext } from "./context.js";
import type { GetServerSideProps, ServerSidePropsRequest, ServerSidePropsResult, ServerSideRedirect, ServerSideRedirectResult } from "./defineServerSideProps.js";

export type { GetServerSideProps, ServerSidePropsRequest };

export interface SSRPageDef {
    pathPattern: string;
    loadComponent: () => Promise<React.ComponentType<Record<string, unknown>>>;
    loadLayouts: () => Promise<React.ComponentType<{ children: React.ReactNode }>[]>;
    getServerSideProps?: GetServerSideProps;
}

export interface SSRMatch {
    page: SSRPageDef;
    params: Record<string, string | string[]>;
}

type SSRRouterSnapshot = {
    path: string;
    params: Record<string, string | string[]>;
    search: string;
};

export interface SSRRedirectResolved {
    destination: string;
    statusCode: 301 | 302 | 303 | 307 | 308;
    replace: boolean;
}

export type SSRPropsResolution = { kind: "props"; props: Record<string, unknown> } | { kind: "redirect"; redirect: SSRRedirectResolved };

type RenderSSRHTMLResult = { html: string; pageProps: Record<string, unknown> } | { redirect: SSRRedirectResolved };

type SSRGlobalState = typeof globalThis & {
    __HELIUM_SSR_ROUTER__?: SSRRouterSnapshot;
};

/** Compile the full route order once so a more specific SPA or SSG route can win over SSR. */
export function createSSRPageMatcher(pages: readonly SSRPageDef[], pageRoutes?: readonly PageRoute[]) {
    if (pages.length === 0) {
        return () => null;
    }

    const pagesByPattern = new Map<string, SSRPageDef>();
    for (const page of pages) {
        if (!pagesByPattern.has(page.pathPattern)) {
            pagesByPattern.set(page.pathPattern, page);
        }
    }

    const routes = pageRoutes ?? pages.map(({ pathPattern }) => ({ pattern: pathPattern, render: "ssr" as const }));
    const candidates = routes
        .filter(({ pattern }) => pattern !== "__404__")
        .sort((a, b) => compareRoutePatterns(a.pattern, b.pattern))
        .map(({ pattern, render }) => ({
            match: createMatcher(pattern),
            page: render === "ssr" ? pagesByPattern.get(pattern) : undefined,
        }));

    return (pathname: string): SSRMatch | null => {
        for (const { match, page } of candidates) {
            const result = match(pathname);
            if (result) {
                return page ? { page, params: result.params } : null;
            }
        }

        return null;
    };
}

export function matchSSRPage(pathname: string, pages: readonly SSRPageDef[], pageRoutes?: readonly PageRoute[]): SSRMatch | null {
    return createSSRPageMatcher(pages, pageRoutes)(pathname);
}

function headersToRecord(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined> {
    const out: Record<string, string | string[] | undefined> = {};

    for (const [key, value] of Object.entries(headers)) {
        out[key] = value;
    }

    return out;
}

function parseQuery(inputUrl: string): Record<string, string> {
    const query: Record<string, string> = {};
    const parsed = new URL(inputUrl, "http://localhost");

    for (const [key, value] of parsed.searchParams.entries()) {
        query[key] = value;
    }

    return query;
}

function isServerSideRedirectResult(value: ServerSidePropsResult): value is ServerSideRedirectResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const maybeRedirect = (value as { redirect?: unknown }).redirect;
    if (!maybeRedirect || typeof maybeRedirect !== "object" || Array.isArray(maybeRedirect)) {
        return false;
    }

    const destination = (maybeRedirect as { destination?: unknown }).destination;
    return typeof destination === "string" && destination.length > 0;
}

function normalizeRedirect(redirect: ServerSideRedirect): SSRRedirectResolved {
    const allowedStatusCodes = new Set<301 | 302 | 303 | 307 | 308>([301, 302, 303, 307, 308]);
    const statusCode = redirect.statusCode && allowedStatusCodes.has(redirect.statusCode) ? redirect.statusCode : redirect.permanent ? 308 : 307;

    return {
        destination: redirect.destination,
        statusCode,
        replace: redirect.replace ?? true,
    };
}

export async function resolveServerSideProps(args: {
    req: IncomingMessage;
    pathname: string;
    params: Record<string, string | string[]>;
    page: SSRPageDef;
    ctx: HeliumContext;
    search?: string;
}): Promise<SSRPropsResolution> {
    const { req, pathname, params, page, ctx, search } = args;

    if (!page.getServerSideProps) {
        return { kind: "props", props: {} };
    }

    const request = createServerSidePropsRequest(req, pathname, params, search);
    const result = await page.getServerSideProps(request, ctx);

    if (isServerSideRedirectResult(result)) {
        return {
            kind: "redirect",
            redirect: normalizeRedirect(result.redirect),
        };
    }

    return {
        kind: "props",
        props: result ?? {},
    };
}

export function createServerSidePropsRequest(req: IncomingMessage, pathname: string, params: Record<string, string | string[]>, search?: string): ServerSidePropsRequest {
    const method = req.method || "GET";
    const headers = headersToRecord(req.headers);
    const rawUrl = search === undefined ? req.url || pathname : `${pathname}${search}`;

    return {
        method,
        path: pathname,
        headers,
        query: parseQuery(rawUrl),
        params,
    };
}

export async function renderSSRHTML(args: {
    htmlTemplate: string;
    pathname: string;
    search: string;
    params: Record<string, string | string[]>;
    page: SSRPageDef;
    req: IncomingMessage;
    ctx: HeliumContext;
    loadAppShell?: (() => Promise<ComponentType<{ Component: ComponentType<Record<string, unknown>>; pageProps: Record<string, unknown>; children?: React.ReactNode }>>) | null;
}): Promise<RenderSSRHTMLResult> {
    const { htmlTemplate, pathname, search, params, page, req, ctx, loadAppShell = null } = args;

    const ssrResult = await resolveServerSideProps({
        req,
        pathname,
        params,
        page,
        ctx,
        search,
    });

    if (ssrResult.kind === "redirect") {
        return { redirect: ssrResult.redirect };
    }

    const ssrProps = ssrResult.props;

    const PageComponent = await page.loadComponent();
    const layouts = await page.loadLayouts();
    const AppShell = loadAppShell ? await loadAppShell() : null;

    const pageProps: Record<string, unknown> = {
        ...ssrProps,
        params,
        searchParams: new URLSearchParams(search),
    };

    const renderTree = (): string => {
        const globalState = globalThis as SSRGlobalState;
        const previousRouterState = globalState.__HELIUM_SSR_ROUTER__;
        globalState.__HELIUM_SSR_ROUTER__ = {
            path: pathname,
            params,
            search,
        };

        const WrappedPage: ComponentType<Record<string, unknown>> = () => {
            let content = React.createElement(PageComponent, pageProps);

            for (let i = layouts.length - 1; i >= 0; i--) {
                const Layout = layouts[i];
                content = React.createElement(Layout, { children: content });
            }

            return content;
        };

        const element = AppShell
            ? React.createElement(AppShell, {
                  Component: WrappedPage,
                  pageProps,
                  children: React.createElement(WrappedPage, pageProps),
              })
            : React.createElement(WrappedPage, pageProps);

        try {
            return ReactDOMServer.renderToString(element);
        } finally {
            if (previousRouterState) {
                globalState.__HELIUM_SSR_ROUTER__ = previousRouterState;
            } else {
                delete globalState.__HELIUM_SSR_ROUTER__;
            }
        }
    };

    const markup = renderTree();
    const serializedPayload = JSON.stringify({ path: pathname, search, props: ssrProps })
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");

    const htmlWithRoot = replaceHtmlRootContents(htmlTemplate, markup);
    const scriptTag = `<script>window.__HELIUM_SSR_DATA__=${serializedPayload};</script>`;

    if (/<\/body\s*>/i.test(htmlWithRoot)) {
        return {
            html: htmlWithRoot.replace(/<\/body\s*>/i, (closingBody) => `${scriptTag}\n${closingBody}`),
            pageProps: ssrProps,
        };
    }

    return {
        html: `${htmlWithRoot}${scriptTag}`,
        pageProps: ssrProps,
    };
}
