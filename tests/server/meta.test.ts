import { describe, expect, it } from "vitest";

import { buildSocialMetaTags, escapeHtml, injectSocialMetaIntoHtml } from "../../src/server/meta";

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
});
