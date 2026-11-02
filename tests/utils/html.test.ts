import { describe, expect, it } from "vitest";

import { replaceHtmlRootContents } from "../../src/utils/html";

describe("HTML root replacement", () => {
    it("replaces all nested placeholders and preserves the root and surrounding siblings", () => {
        const html = '<header>Keep</header><div class="app" id="root"><div><div>Spinner</div></div><p>Old sibling</p></div><footer>Keep</footer>';
        expect(replaceHtmlRootContents(html, "<main>Fresh</main>")).toBe('<header>Keep</header><div class="app" id="root"><main>Fresh</main></div><footer>Keep</footer>');
    });

    it.each(["id=root", "id='root'", 'ID = "root"'])("handles %s while preserving the original opening and closing tags", (attribute) => {
        const html = `<DIV class='app' ${attribute} data-label='a > b'><div>Old</div></DIV >`;
        expect(replaceHtmlRootContents(html, "$& $` $' $$")).toBe(`<DIV class='app' ${attribute} data-label='a > b'>$& $\` $' $$</DIV >`);
    });

    it("ignores root examples in comments, raw-text elements, and inert templates", () => {
        const examples = [
            '<!-- <div id="root">comment</div> -->',
            "<script>const example = '<div id=\"root\">script</div>';</script>",
            "<style>.x::before { content: '<div id=\"root\">style</div>'; }</style>",
            '<textarea><div id="root">textarea</div></textarea>',
            '<title><div id="root">title</div></title>',
            '<template><div id="root">template</div></template>',
        ].join("");
        expect(replaceHtmlRootContents(`${examples}<div id=root>Old</div>`, "Fresh")).toBe(`${examples}<div id=root>Fresh</div>`);
    });

    it("ignores fake nested closing tags inside comments, scripts, and styles", () => {
        const html = '<div id=root><!-- </div> --><script>const x = "</div><div>";</script><style>.x { content: "</div>" }</style><div>Loading</div></div><aside>Keep</aside>';
        expect(replaceHtmlRootContents(html, "Fresh")).toBe("<div id=root>Fresh</div><aside>Keep</aside>");
    });

    it("treats a self-closing slash on a div as an ordinary HTML start tag", () => {
        expect(replaceHtmlRootContents('<div id=root><div class="spinner" /></div></div><p>Keep</p>', "Fresh")).toBe("<div id=root>Fresh</div><p>Keep</p>");
    });

    it("sets escaped marker attributes while preserving unrelated and boolean attributes", () => {
        const html = '<div id=root data-ssg-page class="app" hidden><div>Old</div></div>';
        expect(replaceHtmlRootContents(html, "Fresh", { "data-ssg-page": '/a"<&', "data-ssg-failed": null })).toBe(
            '<div id=root data-ssg-page="/a&quot;&lt;&amp;" class="app" hidden>Fresh</div>'
        );
    });

    it("preserves a trailing slash that belongs to an unquoted attribute value", () => {
        const html = "<div id=root data-path=original/><div>Old</div></div>";
        expect(replaceHtmlRootContents(html, "Fresh", { "data-ssg-page": "/new" })).toBe('<div id=root data-path=original/ data-ssg-page="/new">Fresh</div>');
    });

    it("removes stale and duplicate marker attributes", () => {
        const html = '<div id=root data-ssg-page="old" data-ssg-page="duplicate" data-ssg-failed="old" class="app"></div>';
        const replaced = replaceHtmlRootContents(html, "Fresh", { "data-ssg-page": "/new", "data-ssg-failed": null });
        expect(replaced).toContain('data-ssg-page="/new"');
        expect(replaced.match(/data-ssg-page/g)).toHaveLength(1);
        expect(replaced).not.toContain("data-ssg-failed");
        expect(replaced).toContain('class="app"');
    });

    it("does not confuse id-like text in another attribute with the root id", () => {
        const html = "<div data-example=\"id='root'\">Keep</div><main id=root>Old</main>";
        expect(replaceHtmlRootContents(html, "Fresh")).toBe("<div data-example=\"id='root'\">Keep</div><main id=root>Fresh</main>");
    });

    it("leaves templates with missing or unclosed roots unchanged", () => {
        for (const html of ['<div id="other">Keep</div>', '<div id="root"><div>Unclosed</div>']) {
            expect(replaceHtmlRootContents(html, "Fresh")).toBe(html);
        }
    });
});
