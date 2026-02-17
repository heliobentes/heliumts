import type { IncomingMessage } from "http";
import { parse as parseUrl } from "url";

import type { HeliumContext } from "./context.js";
import type { HeliumSEOMetadataDef, SEOMetadataRequest } from "./defineSEOMetadata.js";
import type { SocialMeta } from "./meta.js";

export interface SEOMetadataRoute {
    name: string;
    handler: HeliumSEOMetadataDef;
}

type RouteMatcher = (pathname: string) => { params: Record<string, string | string[]> } | null;

interface RegisteredRoute {
    name: string;
    handler: HeliumSEOMetadataDef;
    matcher: RouteMatcher;
}

export class SEOMetadataRouter {
    private routes: RegisteredRoute[] = [];
    private pageRouteMatchers: RouteMatcher[] = [];

    registerRoutes(routes: SEOMetadataRoute[]) {
        this.routes = routes.map((route) => ({
            name: route.name,
            handler: route.handler,
            matcher: createPathMatcher(route.handler.path),
        }));
    }

    setPageRoutePatterns(patterns: string[]) {
        this.pageRouteMatchers = patterns.filter((pattern) => pattern && pattern !== "__404__").map((pattern) => createPathMatcher(pattern));
    }

    hasPageRouteMatch(pathname: string): boolean {
        if (this.pageRouteMatchers.length === 0) {
            return false;
        }

        return this.pageRouteMatchers.some((matcher) => matcher(pathname) !== null);
    }

    async resolve(req: IncomingMessage, ctx: HeliumContext, targetPath?: string): Promise<SocialMeta | null> {
        const method = req.method?.toUpperCase() || "GET";
        if (method !== "GET") {
            return null;
        }

        const parsedUrl = parseUrl(req.url || "", true);
        const targetParsed = targetPath ? parseUrl(targetPath, true) : null;
        const pathname = normalizePath((targetParsed?.pathname as string | undefined) || parsedUrl.pathname || "/");
        if (!this.hasPageRouteMatch(pathname)) {
            return null;
        }

        const headers: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            headers[key.toLowerCase()] = value;
        }

        const query: Record<string, string> = {};
        const querySource = (targetParsed?.query as Record<string, unknown> | undefined) ?? parsedUrl.query;
        if (querySource) {
            for (const [key, value] of Object.entries(querySource)) {
                if (value !== undefined) {
                    query[key] = Array.isArray(value) ? String(value[0]) : String(value);
                }
            }
        }

        for (const route of this.routes) {
            const match = route.matcher(pathname);
            if (!match) {
                continue;
            }

            const metadataRequest: SEOMetadataRequest = {
                method,
                path: pathname,
                headers,
                query,
                params: match.params,
            };

            const metadata = await route.handler.handler(metadataRequest, ctx);
            if (metadata) {
                return metadata;
            }
        }

        return null;
    }
}

export function createPathMatcher(pattern: string): RouteMatcher {
    const normalizedPattern = normalizePath(pattern);
    const patternSegments = normalizedPattern.split("/").filter(Boolean);

    return (pathname: string) => {
        const normalizedPathname = normalizePath(pathname);
        const pathSegments = normalizedPathname.split("/").filter(Boolean);
        const params: Record<string, string | string[]> = {};

        if (normalizedPattern === "/") {
            return normalizedPathname === "/" ? { params } : null;
        }

        let pathIndex = 0;
        for (let patternIndex = 0; patternIndex < patternSegments.length; patternIndex++) {
            const segment = patternSegments[patternIndex];
            const value = pathSegments[pathIndex];

            if (segment === "**") {
                return { params };
            }

            if (segment === "*") {
                if (value === undefined) {
                    return null;
                }
                pathIndex += 1;
                continue;
            }

            if (segment.startsWith("*")) {
                const key = segment.slice(1);
                const rest = pathSegments.slice(pathIndex).map((part) => safeDecodeURIComponent(part));
                if (key) {
                    params[key] = rest;
                }
                return { params };
            }

            if (segment.startsWith(":")) {
                if (value === undefined) {
                    return null;
                }
                params[segment.slice(1)] = safeDecodeURIComponent(value);
                pathIndex += 1;
                continue;
            }

            if (segment !== value) {
                return null;
            }

            pathIndex += 1;
        }

        if (pathIndex !== pathSegments.length) {
            return null;
        }

        return { params };
    };
}

function normalizePath(value: string): string {
    const withoutQuery = value.split("?")[0].split("#")[0] || "/";
    if (withoutQuery === "/") {
        return "/";
    }

    const normalized = withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
    return normalized || "/";
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
