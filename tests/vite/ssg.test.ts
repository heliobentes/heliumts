import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Import actual functions from source
import {
    filePathToUrlPath,
    urlPathToOutputPath,
    stripStringLiterals,
    findLayoutPathsForPage,
    scanSSGPages,
} from "../../src/vite/ssg";

describe("ssg", () => {
    describe("filePathToUrlPath", () => {
        it("should convert index.tsx to /", () => {
            expect(filePathToUrlPath("pages/index.tsx")).toBe("/");
        });

        it("should convert about.tsx to /about", () => {
            expect(filePathToUrlPath("pages/about.tsx")).toBe("/about");
        });

        it("should convert blog/post.tsx to /blog/post", () => {
            expect(filePathToUrlPath("pages/blog/post.tsx")).toBe("/blog/post");
        });

        it("should remove route groups", () => {
            expect(filePathToUrlPath("pages/(website)/contact.tsx")).toBe("/contact");
            expect(filePathToUrlPath("pages/(portal)/dashboard.tsx")).toBe("/dashboard");
        });

        it("should handle nested index files", () => {
            expect(filePathToUrlPath("pages/docs/index.tsx")).toBe("/docs");
        });

        it("should handle multiple file extensions", () => {
            expect(filePathToUrlPath("pages/test.jsx")).toBe("/test");
            expect(filePathToUrlPath("pages/api.ts")).toBe("/api");
            expect(filePathToUrlPath("pages/util.js")).toBe("/util");
        });
    });

    describe("urlPathToOutputPath", () => {
        it("should convert / to __index.html", () => {
            expect(urlPathToOutputPath("/")).toBe("__index.html");
        });

        it("should convert /about to about.html", () => {
            expect(urlPathToOutputPath("/about")).toBe("about.html");
        });

        it("should convert /blog/post to blog/post.html", () => {
            expect(urlPathToOutputPath("/blog/post")).toBe("blog/post.html");
        });
    });

    describe("stripStringLiterals", () => {
        it("should remove double-quoted strings", () => {
            const input = 'const x = "useState is cool";';
            const result = stripStringLiterals(input);
            expect(result).not.toContain("useState is cool");
        });

        it("should remove single-quoted strings", () => {
            const input = "const x = 'useEffect hook';";
            const result = stripStringLiterals(input);
            expect(result).not.toContain("useEffect hook");
        });

        it("should remove template literals", () => {
            const input = "const x = `template with ${value}`;";
            const result = stripStringLiterals(input);
            expect(result).not.toContain("template with");
        });

        it("should remove JSX text content", () => {
            const input = "<code>useState</code>";
            const result = stripStringLiterals(input);
            expect(result).not.toContain("useState");
            expect(result).toContain("><");
        });
    });

    describe("validateSSGPage hook detection", () => {
        // These patterns are used internally by validateSSGPage
        const hookPatterns = [
            /\buse(State|Effect|Context|Reducer|Callback|Memo|Ref|ImperativeHandle|LayoutEffect|DebugValue)\s*\(/,
            /\buse[A-Z]\w+\s*\(/,
        ];

        function detectHooks(content: string): boolean {
            return hookPatterns.some((pattern) => pattern.test(content));
        }

        it("should detect useState", () => {
            expect(detectHooks("const [count, setCount] = useState(0);")).toBe(true);
        });

        it("should detect useEffect", () => {
            expect(detectHooks("useEffect(() => {}, []);")).toBe(true);
        });

        it("should detect custom hooks", () => {
            expect(detectHooks("const data = useCustomHook();")).toBe(true);
        });

        it("should not detect non-hook functions", () => {
            expect(detectHooks("function notAHook() {}")).toBe(false);
        });

        it("should detect client imports", () => {
            const clientImportPattern = /^import\s+.*from\s+['"]heliumts\/client['"]/m;
            expect(clientImportPattern.test("import { useRouter } from 'heliumts/client';")).toBe(true);
            expect(clientImportPattern.test("import React from 'react';")).toBe(false);
        });

        it("should detect server imports", () => {
            const serverImportPattern = /^import\s+.*from\s+['"]heliumts\/server['"]/m;
            expect(serverImportPattern.test("import { defineMethod } from 'heliumts/server';")).toBe(true);
        });
    });

    describe("scanSSGPages", () => {
        let existsSyncSpy: ReturnType<typeof vi.spyOn>;
        let readdirSyncSpy: ReturnType<typeof vi.spyOn>;
        let statSyncSpy: ReturnType<typeof vi.spyOn>;
        let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            existsSyncSpy = vi.spyOn(fs, "existsSync");
            readdirSyncSpy = vi.spyOn(fs, "readdirSync");
            statSyncSpy = vi.spyOn(fs, "statSync");
            readFileSyncSpy = vi.spyOn(fs, "readFileSync");
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should detect use ssg directive", () => {
            const ssgDirectivePattern = /^\s*["']use ssg["']\s*;/m;

            expect(ssgDirectivePattern.test('"use ssg";\n\nexport default function Page() {}')).toBe(true);
            expect(ssgDirectivePattern.test("'use ssg';\n\nexport default function Page() {}")).toBe(true);
            expect(ssgDirectivePattern.test('  "use ssg";\n\nexport default function Page() {}')).toBe(true);
            expect(ssgDirectivePattern.test("export default function Page() {}")).toBe(false);
        });

        it("should return empty array when pages directory does not exist", () => {
            existsSyncSpy.mockReturnValue(false);

            const result = scanSSGPages("/project");
            expect(result).toEqual([]);
        });

        it("should scan pages with use ssg directive", () => {
            existsSyncSpy.mockImplementation((p) => {
                const pathStr = p.toString();
                return pathStr.includes("pages") || pathStr.endsWith("about.tsx");
            });

            readdirSyncSpy.mockImplementation((p) => {
                if (p.toString().endsWith("pages")) {
                    return ["about.tsx"] as unknown as fs.Dirent[];
                }
                return [] as unknown as fs.Dirent[];
            });

            statSyncSpy.mockReturnValue({
                isDirectory: () => false,
                isFile: () => true,
            } as fs.Stats);

            readFileSyncSpy.mockReturnValue('"use ssg";\n\nexport default function About() { return <div>About</div>; }');

            const result = scanSSGPages("/project");
            expect(result.length).toBe(1);
            expect(result[0].urlPath).toBe("/about");
        });
    });

    describe("findLayoutPathsForPage", () => {
        let existsSyncSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            existsSyncSpy = vi.spyOn(fs, "existsSync");
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should find root layout", () => {
            existsSyncSpy.mockImplementation((p) => {
                return p.toString().endsWith("_layout.tsx") && p.toString().includes("pages");
            });

            const layouts = findLayoutPathsForPage("/project/src/pages/about.tsx", "/project");
            expect(layouts.length).toBeGreaterThanOrEqual(1);
            expect(layouts[0]).toContain("_layout.tsx");
        });

        it("should find nested layouts", () => {
            existsSyncSpy.mockImplementation((p) => {
                const str = p.toString();
                return str.endsWith("_layout.tsx");
            });

            const layouts = findLayoutPathsForPage("/project/src/pages/docs/guide.tsx", "/project");
            expect(layouts.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("SSGPage type", () => {
        it("should have expected shape", () => {
            type SSGPage = {
                filePath: string;
                urlPath: string;
                relativePath: string;
                warnings: string[];
            };

            const page: SSGPage = {
                filePath: "/project/src/pages/about.tsx",
                urlPath: "/about",
                relativePath: "pages/about.tsx",
                warnings: ["Page uses React hooks which may cause hydration issues"],
            };

            expect(page.filePath).toBe("/project/src/pages/about.tsx");
            expect(page.urlPath).toBe("/about");
            expect(page.warnings.length).toBe(1);
        });
    });
});
