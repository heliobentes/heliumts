import { describe, expect, it } from "vitest";

import { buildSocialMetaTags, escapeHtml, extractSocialMetaFromHtml, injectSocialMetaIntoHtml } from "../../src/server/meta";

describe("meta", () => {
    it("should escape unsafe HTML characters", () => {
        const value = `Tom & <Jerry> \"quote\" 'apostrophe'`;
        expect(escapeHtml(value)).toBe("Tom &amp; &lt;Jerry&gt; &quot;quote&quot; &#39;apostrophe&#39;");
    });

    it("should build required social tags", () => {
        const tags = buildSocialMetaTags({
            title: "Hello World",
            description: "Post description",
            image: "https://example.com/image.jpg",
            canonicalUrl: "https://example.com/posts/hello-world",
        });

        expect(tags).toContain("<title>Hello World</title>");
        expect(tags).toContain('property="og:title"');
        expect(tags).toContain('property="og:description"');
        expect(tags).toContain('property="og:image"');
        expect(tags).toContain('property="og:url"');
        expect(tags).toContain('name="twitter:card"');
        expect(tags).toContain('name="twitter:title"');
    });

    it("should inject tags before </head> and remove previous social tags", () => {
        const html = `<!doctype html>
<html>
  <head>
    <title>Old title</title>
    <meta name="description" content="old description" />
    <meta property="og:title" content="old og title" />
    <meta name="twitter:title" content="old twitter title" />
    <link rel="canonical" href="https://old.example.com" />
    <meta charset="UTF-8" />
  </head>
  <body><div id="root"></div></body>
</html>`;

        const output = injectSocialMetaIntoHtml(html, {
            title: "New title",
            description: "Fresh desc",
            canonicalUrl: "https://example.com/new",
            image: "https://example.com/new.jpg",
        });

        expect(output).toContain("<title>New title</title>");
        expect(output).toContain("Fresh desc");
        expect(output).toContain("https://example.com/new");
        expect(output).toContain('<meta charset="UTF-8" />');
        expect(output).not.toContain("Old title");
        expect(output).not.toContain("old description");
        expect(output).not.toContain("old og title");
    });

    it("should prepend tags when html has no head", () => {
        const html = '<div id="root"></div>';
        const output = injectSocialMetaIntoHtml(html, { title: "No head" });
        expect(output.startsWith("<title>No head</title>\n")).toBe(true);
        expect(output).toContain('<div id="root"></div>');
    });

    it("should preserve dollar replacement tokens in metadata", () => {
        const html = "<html><head><title>Old</title></head><body>body</body></html>";
        const output = injectSocialMetaIntoHtml(html, { title: "Price $$ and $& and $` and $'" });
        expect(output).toContain("<title>Price $$ and $&amp; and $` and $&#39;</title>");
        expect(output.match(/<head>/g)).toHaveLength(1);
        expect(output.match(/<body>/g)).toHaveLength(1);
    });

    it("should extract social metadata regardless of attribute order or quote style", () => {
        const html = `<head data-theme="dark">
            <title>Site</title>
            <meta content="What's new &amp; useful" data-id="description" name = "description">
            <meta content='https://example.com/image.png' property=og:image>
            <link href="https://example.com/canonical" rel="canonical">
        </head>`;
        expect(extractSocialMetaFromHtml(html)).toMatchObject({
            title: "Site",
            description: "What's new & useful",
            image: "https://example.com/image.png",
            canonicalUrl: "https://example.com/canonical",
        });
        const output = injectSocialMetaIntoHtml(html, { title: "Updated", description: "Fresh", canonicalUrl: "https://new.example.com" });
        expect(output).toContain('<head data-theme="dark">');
        expect(output).not.toContain("What's new");
        expect(output).not.toContain("https://example.com/canonical");
        expect(output.match(/name="description"/g)).toHaveLength(1);
    });
});
