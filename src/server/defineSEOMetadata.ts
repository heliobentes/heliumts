import type { HeliumContext } from "./context.js";
import type { SocialMeta } from "./meta.js";

export interface SEOMetadataRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string>;
    params: Record<string, string | string[]>;
}

export type SEOMetadataHandler = (req: SEOMetadataRequest, ctx: HeliumContext) => Promise<SocialMeta | null | undefined> | SocialMeta | null | undefined;

export type HeliumSEOMetadataDef<TPath extends string = string> = {
    __kind: "seo";
    path: TPath;
    handler: SEOMetadataHandler;
};

/**
 * Define dynamic SEO metadata for page routes.
 *
 * This does not create a standalone HTTP endpoint. It is evaluated only when
 * a normal page route is matched and HTML is being served.
 */
export function defineSEOMetadata<TPath extends string>(path: TPath, handler: SEOMetadataHandler): HeliumSEOMetadataDef<TPath> {
    if (!path) {
        throw new Error("defineSEOMetadata requires a path");
    }
    if (!handler) {
        throw new Error("defineSEOMetadata requires a handler");
    }

    return {
        __kind: "seo",
        path,
        handler,
    };
}
