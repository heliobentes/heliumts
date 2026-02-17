import fs from "fs/promises";

export interface SocialMeta {
    title: string;
    description?: string;
    image?: string;
    canonicalUrl?: string;
    siteName?: string;
    type?: string;
    robots?: string;
    twitterCard?: "summary" | "summary_large_image" | "app" | "player";
    twitterSite?: string;
    twitterCreator?: string;
}

export function escapeHtml(value: string): string {
    const htmlEscapes: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    };

    return value.replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function stripExistingHeadMeta(headContent: string): string {
    return headContent
        .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
        .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
        .replace(/<meta\s+name=["']robots["'][^>]*>/gi, "")
        .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
        .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "")
        .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
}

export function buildSocialMetaTags(meta: SocialMeta): string {
    const type = meta.type ?? "website";
    const twitterCard = meta.twitterCard ?? "summary_large_image";

    const tags = [
        `<title>${escapeHtml(meta.title)}</title>`,
        `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
        `<meta property="og:type" content="${escapeHtml(type)}" />`,
        `<meta name="twitter:card" content="${escapeHtml(twitterCard)}" />`,
        `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    ];

    if (meta.description) {
        tags.push(`<meta name="description" content="${escapeHtml(meta.description)}" />`);
        tags.push(`<meta property="og:description" content="${escapeHtml(meta.description)}" />`);
        tags.push(`<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`);
    }

    if (meta.image) {
        tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
        tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);
    }

    if (meta.canonicalUrl) {
        tags.push(`<meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />`);
        tags.push(`<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`);
    }

    if (meta.siteName) {
        tags.push(`<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`);
    }

    if (meta.robots) {
        tags.push(`<meta name="robots" content="${escapeHtml(meta.robots)}" />`);
    }

    if (meta.twitterSite) {
        tags.push(`<meta name="twitter:site" content="${escapeHtml(meta.twitterSite)}" />`);
    }

    if (meta.twitterCreator) {
        tags.push(`<meta name="twitter:creator" content="${escapeHtml(meta.twitterCreator)}" />`);
    }

    return tags.join("\n");
}

export function injectSocialMetaIntoHtml(html: string, meta: SocialMeta): string {
    const generated = buildSocialMetaTags(meta);
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);

    if (!headMatch) {
        return `${generated}\n${html}`;
    }

    const fullHead = headMatch[0];
    const innerHead = headMatch[1];
    const cleanedInnerHead = stripExistingHeadMeta(innerHead).trim();
    const replacementHead = `<head>\n${generated}${cleanedInnerHead ? `\n${cleanedInnerHead}` : ""}\n</head>`;

    return html.replace(fullHead, replacementHead);
}

export function extractSocialMetaFromHtml(html: string): SocialMeta | null {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1].trim()) : "";

    if (!title) {
        return null;
    }

    const description = extractMetaContent(html, "name", "description");
    const image = extractMetaContent(html, "property", "og:image");
    const canonicalUrl = extractCanonicalHref(html);
    const siteName = extractMetaContent(html, "property", "og:site_name");
    const type = extractMetaContent(html, "property", "og:type");
    const robots = extractMetaContent(html, "name", "robots");
    const twitterCard = extractMetaContent(html, "name", "twitter:card") as SocialMeta["twitterCard"] | undefined;
    const twitterSite = extractMetaContent(html, "name", "twitter:site");
    const twitterCreator = extractMetaContent(html, "name", "twitter:creator");

    return {
        title,
        description,
        image,
        canonicalUrl,
        siteName,
        type,
        robots,
        twitterCard,
        twitterSite,
        twitterCreator,
    };
}

export async function loadDefaultSocialMetaFromHtmlFile(filePath: string): Promise<SocialMeta | null> {
    try {
        const html = await fs.readFile(filePath, "utf-8");
        return extractSocialMetaFromHtml(html);
    } catch {
        return null;
    }
}

function extractMetaContent(html: string, attributeName: "name" | "property", attributeValue: string): string | undefined {
    const pattern = new RegExp(`<meta\\s+[^>]*${attributeName}=["']${escapeRegex(attributeValue)}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
    const match = html.match(pattern);
    return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function extractCanonicalHref(html: string): string | undefined {
    const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i;
    const match = html.match(pattern);
    return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}
