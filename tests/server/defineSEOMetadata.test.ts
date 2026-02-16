import { describe, expect, it } from "vitest";

import { defineSEOMetadata } from "../../src/server/defineSEOMetadata";

describe("defineSEOMetadata", () => {
    it("should create SEO metadata definition", () => {
        const definition = defineSEOMetadata("/:username/:albumId", async (req) => ({
            title: `${String(req.params.username)} - ${String(req.params.albumId)}`,
        }));

        expect(definition.__kind).toBe("seo");
        expect(definition.path).toBe("/:username/:albumId");
        expect(typeof definition.handler).toBe("function");
    });

    it("should throw when path is missing", () => {
        expect(() => defineSEOMetadata("", async () => ({ title: "x" }))).toThrow("defineSEOMetadata requires a path");
    });
});
