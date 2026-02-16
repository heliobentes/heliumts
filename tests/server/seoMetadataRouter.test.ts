import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";

import { defineSEOMetadata } from "../../src/server/defineSEOMetadata";
import { createPathMatcher, SEOMetadataRouter } from "../../src/server/seoMetadataRouter";

describe("seoMetadataRouter", () => {
    it("should match dynamic path segments", () => {
        const matcher = createPathMatcher("/:username/:albumId");
        const match = matcher("/john/holiday");

        expect(match).not.toBeNull();
        expect(match?.params.username).toBe("john");
        expect(match?.params.albumId).toBe("holiday");
    });

    it("should return null when page route does not match", async () => {
        const router = new SEOMetadataRouter();
        router.setPageRoutePatterns(["/about"]);
        router.registerRoutes([
            {
                name: "albumMeta",
                handler: defineSEOMetadata("/:username/:albumId", async () => ({ title: "Album" })),
            },
        ]);

        const req = {
            method: "GET",
            url: "/john/holiday",
            headers: {},
        } as IncomingMessage;

        const result = await router.resolve(req, {
            req: {
                ip: "127.0.0.1",
                headers: {},
                url: "/john/holiday",
                method: "GET",
                raw: req,
            },
        });

        expect(result).toBeNull();
    });

    it("should resolve metadata when both page route and SEO route match", async () => {
        const router = new SEOMetadataRouter();
        router.setPageRoutePatterns(["/:username/:albumId"]);
        router.registerRoutes([
            {
                name: "albumMeta",
                handler: defineSEOMetadata("/:username/:slug", async (req) => ({
                    title: `${String(req.params.username)}:${String(req.params.slug)}`,
                })),
            },
        ]);

        const req = {
            method: "GET",
            url: "/john/holiday?ref=1",
            headers: {
                host: "localhost:3000",
            },
        } as unknown as IncomingMessage;

        const result = await router.resolve(req, {
            req: {
                ip: "127.0.0.1",
                headers: req.headers,
                url: req.url,
                method: req.method,
                raw: req,
            },
        });

        expect(result).toEqual({ title: "john:holiday" });
    });
});
