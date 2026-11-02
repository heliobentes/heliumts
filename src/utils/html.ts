type Attribute = { name: string; value: string; start: number; end: number };
type Tag = { name: string; closing: boolean; start: number; end: number; attributes: Attribute[] };

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function tagEnd(html: string, start: number): number {
    let quote = "";
    for (let index = start; index < html.length; index++) {
        const character = html[index];
        if (quote) {
            if (character === quote) {
                quote = "";
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === ">") {
            return index + 1;
        }
    }
    return -1;
}

function readAttributes(html: string, start: number, end: number): Attribute[] {
    const attributes: Attribute[] = [];
    let index = start;
    while (index < end - 1) {
        while (/\s/.test(html[index] ?? "")) {
            index++;
        }
        if (index >= end - 1) {
            break;
        }
        if (html[index] === "/") {
            index++;
            continue;
        }
        const attributeStart = index;
        while (index < end - 1 && !/[\s=/>]/.test(html[index])) {
            index++;
        }
        const name = html.slice(attributeStart, index).toLowerCase();
        let attributeEnd = index;
        while (index < end - 1 && /\s/.test(html[index])) {
            index++;
        }
        let value = "";
        if (html[index] === "=") {
            index++;
            while (index < end - 1 && /\s/.test(html[index])) {
                index++;
            }
            const quote = html[index] === '"' || html[index] === "'" ? html[index++] : undefined;
            const valueStart = index;
            if (quote) {
                while (index < end - 1 && html[index] !== quote) {
                    index++;
                }
                value = html.slice(valueStart, index);
                if (html[index] === quote) {
                    index++;
                }
            } else {
                while (index < end - 1 && !/\s/.test(html[index])) {
                    index++;
                }
                value = html.slice(valueStart, index);
            }
            attributeEnd = index;
        }
        if (name) {
            attributes.push({ name, value, start: attributeStart, end: attributeEnd });
        }
        // Make progress even for malformed attributes.
        if (index === attributeStart) {
            index++;
        }
    }
    return attributes;
}

function* tags(html: string): Generator<Tag> {
    const lowerHtml = html.toLowerCase();
    let index = 0;
    while (index < html.length) {
        const start = html.indexOf("<", index);
        if (start === -1) {
            return;
        }
        if (html.startsWith("<!--", start)) {
            const end = html.indexOf("-->", start + 4);
            index = end === -1 ? html.length : end + 3;
            continue;
        }
        if (html.startsWith("<![CDATA[", start)) {
            const end = html.indexOf("]]>", start + 9);
            index = end === -1 ? html.length : end + 3;
            continue;
        }
        const match = /^<(\/)?([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(start));
        if (!match) {
            if (html[start + 1] === "!" || html[start + 1] === "?") {
                const end = tagEnd(html, start + 2);
                index = end === -1 ? html.length : end;
            } else {
                index = start + 1;
            }
            continue;
        }
        const end = tagEnd(html, start + match[0].length);
        if (end === -1) {
            return;
        }
        const name = match[2].toLowerCase();
        const closing = Boolean(match[1]);
        yield { name, closing, start, end, attributes: closing ? [] : readAttributes(html, start + match[0].length, end) };
        index = end;
        if (!closing && name === "plaintext") {
            return;
        }
        if (!closing && RAW_TEXT_TAGS.has(name)) {
            // HTML raw text ends at its closing tag, regardless of JavaScript or
            // CSS quoting. Markup-looking strings inside it are not elements.
            let close = lowerHtml.indexOf(`</${name}`, index);
            while (close !== -1 && !/[\s/>]/.test(html[close + name.length + 2] ?? "")) {
                close = lowerHtml.indexOf(`</${name}`, close + 2);
            }
            index = close === -1 ? html.length : close;
        }
    }
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function patchOpeningTag(html: string, tag: Tag, attributes: Record<string, string | null>): string {
    let opening = html.slice(tag.start, tag.end);
    const updates = new Map(Object.entries(attributes).map(([name, value]) => [name.toLowerCase(), value]));
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    const handled = new Set<string>();
    for (const attribute of tag.attributes) {
        if (!updates.has(attribute.name)) {
            continue;
        }
        const value = updates.get(attribute.name);
        replacements.push({
            start: attribute.start - tag.start,
            end: attribute.end - tag.start,
            value: value === null || handled.has(attribute.name) ? "" : `${attribute.name}="${escapeAttribute(value!)}"`,
        });
        handled.add(attribute.name);
    }
    for (const replacement of replacements.reverse()) {
        opening = opening.slice(0, replacement.start) + replacement.value + opening.slice(replacement.end);
    }
    const additions = [...updates]
        .filter(([name, value]) => !handled.has(name) && value !== null)
        .map(([name, value]) => ` ${name}="${escapeAttribute(value!)}"`)
        .join("");
    if (additions) {
        const slash = /\/\s*>$/.exec(opening)?.index;
        const slashBelongsToValue = html[tag.end - 2] === "/" && tag.attributes.some((attribute) => attribute.end === tag.end - 1);
        const insertion = slash !== undefined && !slashBelongsToValue ? slash : opening.length - 1;
        opening = opening.slice(0, insertion) + additions + opening.slice(insertion);
    }
    return opening;
}

/**
 * Replace the contents of the live HTML root without consuming nested closing
 * tags or matching examples inside comments, scripts, styles, or templates.
 * Missing or unclosed roots leave the template unchanged.
 */
export function replaceHtmlRootContents(html: string, contents: string, attributes: Record<string, string | null> = {}): string {
    let root: Tag | undefined;
    let depth = 0;
    let templateDepth = 0;
    for (const tag of tags(html)) {
        if (!root) {
            if (tag.name === "template") {
                templateDepth += tag.closing ? -1 : 1;
                templateDepth = Math.max(0, templateDepth);
            }
            if (!tag.closing && !templateDepth && !VOID_TAGS.has(tag.name) && tag.attributes.find((attribute) => attribute.name === "id")?.value === "root") {
                root = tag;
                depth = 1;
            }
            continue;
        }
        if (tag.name !== root.name) {
            continue;
        }
        // A self-closing slash is ignored on non-void HTML elements such as div.
        depth += tag.closing ? -1 : 1;
        if (depth === 0) {
            return html.slice(0, root.start) + patchOpeningTag(html, root, attributes) + contents + html.slice(tag.start);
        }
    }
    return html;
}
