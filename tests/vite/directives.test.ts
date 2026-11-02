// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { hasPageDirective, scanSSRPages } from "../../src/vite/scanner";
import { scanSSGPages } from "../../src/vite/ssg";

const cases = [
    { name: "a directive with a semicolon", source: '"use ssr";\nexport default function Page() {}', expected: true },
    { name: "a directive after comments", source: '// license\n/* header */\n"use ssr"\nexport default function Page() {}', expected: true },
    { name: "a secondary directive", source: "\"use strict\";\n'use ssr';\nexport default function Page() {}", expected: true },
    { name: "secondary directives using ASI", source: '"use strict"\n"use ssr"\nexport default function Page() {}', expected: true },
    { name: "a BOM and shebang", source: '\ufeff#!/usr/bin/env node\n"use ssr";', expected: true },
    { name: "an earlier escaped string", source: '"an escaped \\" quote";\n"use ssr";', expected: true },
    { name: "a following prefix increment statement", source: '"use ssr"\n++counter;', expected: true },
    { name: "a following prefix decrement statement", source: '"use ssr"\n--counter;', expected: true },
    { name: "a line comment example", source: '// "use ssr";\nexport default function Page() {}', expected: false },
    { name: "a block comment example", source: '/*\n"use ssr";\n*/\nexport default function Page() {}', expected: false },
    { name: "a template containing documentation", source: 'const example = `\n"use ssr";\nexport default function Example() {}`;', expected: false },
    { name: "a directive after an import", source: 'import React from "react";\n"use ssr";', expected: false },
    { name: "a directive inside a function", source: 'export default function Page() {\n"use ssr";\n}', expected: false },
    { name: "an expression with addition", source: '"use ssr" + suffix;', expected: false },
    { name: "an expression with a newline and call", source: '"use ssr"\n(callback)();', expected: false },
    { name: "an expression with a newline and index access", source: '"use ssr"\n[0];', expected: false },
    { name: "an expression with a newline and a tagged template", source: '"use ssr"\n`template`;', expected: false },
    { name: "a TypeScript assertion", source: '"use ssr" as const;', expected: false },
    { name: "an escaped directive spelling", source: '"use\\x20ssr";', expected: false },
    { name: "an unterminated string", source: '"use ssr', expected: false },
];

describe.each(["use ssr", "use ssg"] as const)("%s module directives", (directive) => {
    it.each(cases)("recognizes $name correctly", ({ source, expected }) => {
        expect(hasPageDirective(source.replace(/use ssr/g, directive), directive)).toBe(expected);
    });
});

describe("page scanner directive discovery", () => {
    let root: string | undefined;
    afterEach(() => {
        if (root) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("does not register an SSG documentation page as SSR because its examples contain use ssr", () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-directives-"));
        const pages = path.join(root, "src", "pages");
        fs.mkdirSync(pages, { recursive: true });
        fs.writeFileSync(
            path.join(pages, "ssr-guide.tsx"),
            '"use ssg";\nconst example = `\n"use ssr";\nexport default function Example() {}`;\nexport default function Guide() {}'
        );
        fs.writeFileSync(path.join(pages, "dynamic.tsx"), '/* license */\n"use strict";\n"use ssr";\nexport default function Dynamic() {}');
        fs.writeFileSync(path.join(pages, "commented.tsx"), '/*\n"use ssg";\n*/\nexport default function Normal() {}');

        expect(scanSSRPages(root).map((page) => page.pathPattern)).toEqual(["/dynamic"]);
        expect(scanSSGPages(root).map((page) => page.urlPath)).toEqual(["/ssr-guide"]);
    });
});
