import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkProject, inspectEntry, inspectProject, inspectSelection, typegenProject } from "../../src/bin/projectCommands";

let root: string;
const write = (file: string, source: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
};
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-inspect-"));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("project commands", () => {
    it("preserves exact filter values and permits unfiltered inspection", () => {
        expect(inspectSelection({})).toBeUndefined();
        expect(inspectSelection({ route: "/posts/:id" })).toEqual({ kind: "route", name: "/posts/:id" });
        expect(inspectSelection({ rpc: "getPost" })).toEqual({ kind: "rpc", name: "getPost" });
    });
    it.each(["route", "rpc"] as const)("rejects repeated and valueless --%s filters", (kind) => {
        expect(() => inspectSelection({ [kind]: ["one", "two"] })).toThrow(/only once/);
        for (const value of [true, null, 12, "", "  "]) {
            expect(() => inspectSelection({ [kind]: value })).toThrow(/requires a non-empty/);
        }
    });
    it("rejects incompatible filters", () => {
        expect(() => inspectSelection({ route: "/", rpc: "hello" })).toThrow(/either --route or --rpc/);
    });
    it("looks up exact routes and RPC methods with clear missing-entry diagnostics", () => {
        write("src/pages/[id].tsx", "export default 1;");
        write("src/server/api.ts", "export const hello = defineMethod(async () => 1);");
        expect(inspectEntry(root, "route", "/:id")).toMatchObject({ file: "src/pages/[id].tsx" });
        expect(inspectEntry(root, "rpc", "hello")).toEqual({ name: "hello", file: "src/server/api.ts" });
        expect(() => inspectEntry(root, "rpc", "hell")).toThrow(/No RPC method found: hell/);
        expect(() => inspectEntry(root, "route", "/missing")).toThrow(/No route pattern found: \/missing/);
        expect(() => inspectEntry(root, "route", "/123")).toThrow(/No route pattern found/);
    });
    it("inspects render modes and sources without executing modules", () => {
        write("src/pages/index.tsx", `'use ssr'; throw new Error('not evaluated');`);
        write("src/pages/docs.tsx", `'use ssg';`);
        write("src/pages/about.tsx", `export default 1;`);
        write("src/pages/index.server.ts", `throw new Error('not evaluated');`);
        write("src/pages/_layout.tsx", "export default 1;");
        write("src/server/api.ts", "export const hello = defineMethod(async () => 'hello');");
        const manifest = inspectProject(root);
        expect(manifest.routes.map((route) => route.render)).toEqual(["spa", "ssg", "ssr"]);
        expect(manifest.routes[2]).toMatchObject({ pattern: "/", file: "src/pages/index.tsx", sidecar: "src/pages/index.server.ts", layouts: ["src/pages/_layout.tsx"] });
        expect(manifest.rpc).toEqual([{ name: "hello", file: "src/server/api.ts" }]);
        expect(typegenProject(root)).toBe(1);
        expect(fs.existsSync(path.join(root, "src/types/heliumts-server.d.ts"))).toBe(false);
        const rpcModule = fs.readFileSync(path.join(root, "src/rpc.generated.ts"), "utf8");
        expect(rpcModule).toContain("export const hello");
        expect(rpcModule).toMatch(/import type .*server\/api/);
        expect(rpcModule).not.toMatch(/^import (?!type\b).*server\/api/m);
    });

    it("refreshes the generated RPC module when a method is replaced or removed", () => {
        const serverFile = "src/server/api.ts";
        const generatedFile = path.join(root, "src/rpc.generated.ts");
        write(serverFile, "export const oldMethod = defineMethod(async () => 1);");
        expect(typegenProject(root)).toBe(1);
        expect(fs.readFileSync(generatedFile, "utf8")).toContain("export const oldMethod");

        write(serverFile, "export const newMethod = defineMethod(async () => 2);");
        expect(typegenProject(root)).toBe(1);
        const generated = fs.readFileSync(generatedFile, "utf8");
        expect(generated).toContain("export const newMethod");
        expect(generated).not.toContain("oldMethod");

        fs.rmSync(path.join(root, serverFile));
        expect(typegenProject(root)).toBe(0);
        expect(fs.readFileSync(generatedFile, "utf8")).toContain("export {};");
        expect(fs.readFileSync(generatedFile, "utf8")).not.toContain("newMethod");
    });

    it("preserves a hand-written file at the app RPC module path", () => {
        const existingModule = "export const localValue = 1;\n";
        write("src/rpc.generated.ts", existingModule);
        write("src/server/api.ts", "export const hello = defineMethod(() => 1);");

        expect(() => typegenProject(root)).toThrow(/rpc\.generated\.ts already exists and was not generated by HeliumTS/);
        expect(fs.readFileSync(path.join(root, "src/rpc.generated.ts"), "utf8")).toBe(existingModule);
    });

    it("keeps the generated file timestamp when RPC exports are unchanged", () => {
        const generatedFile = path.join(root, "src/rpc.generated.ts");
        write("src/server/api.ts", "export const hello = defineMethod(() => 1);");
        typegenProject(root);
        fs.utimesSync(generatedFile, 1_000_000, 1_000_000);
        const timestamp = fs.statSync(generatedFile).mtimeMs;
        typegenProject(root);
        expect(fs.statSync(generatedFile).mtimeMs).toBe(timestamp);
    });

    it("keeps app RPC export names distinct from generated type aliases", () => {
        write("src/server/api.mts", "export const __helium_method_0 = defineMethod(() => 1);");
        expect(typegenProject(root)).toBe(1);
        const rpcModule = fs.readFileSync(path.join(root, "src/rpc.generated.ts"), "utf8");
        expect(rpcModule).toContain("export const __helium_method_0");
        expect(rpcModule).toMatch(/import type .*server\/api\.m[jt]s/);
        expect(rpcModule).not.toMatch(/\bas __helium_method_0\b/);
    });

    it.each(["class", "await", "yield", "let", "enum", "implements", "interface", "package", "private", "protected", "public", "static", "eval", "arguments"])(
        "rejects generator-invalid RPC binding %s with a source location",
        (name) => {
            write("src/server/api.ts", `const method = defineMethod(() => 1); export { method as "${name}" };`);
            expect(() => typegenProject(root)).toThrow(new RegExp(`valid JavaScript binding name: ${name} at .*api.ts:1:`));
            expect(fs.existsSync(path.join(root, "src/rpc.generated.ts"))).toBe(false);
        }
    );

    it.each(["type", "async", "from", "get", "constructor"])("preserves valid contextual RPC binding %s", (name) => {
        write("src/server/api.ts", `const method = defineMethod(() => 1); export { method as "${name}" };`);
        expect(typegenProject(root)).toBe(1);
    });

    it("reports both duplicate RPC sources and permits identical barrel re-exports", () => {
        write("src/server/a.ts", "export const same = defineMethod(async () => 1);");
        write("src/server/b.ts", "export * from './a';");
        expect(inspectProject(root).rpc).toHaveLength(1);
        expect(inspectEntry(root, "rpc", "same")).toEqual({ name: "same", file: "src/server/a.ts" });
        write("src/server/b.ts", "export const same = defineMethod(async () => 2);");
        expect(() => inspectProject(root)).toThrow(/a.ts:1:\d+.*b.ts:1:\d+/);
        expect(() => inspectEntry(root, "rpc", "same")).toThrow(/a.ts:1:\d+.*b.ts:1:\d+/);
    });

    it("fails generation for colliding routes and mixed render directives", () => {
        write("src/pages/index.tsx", "export default 1;");
        write("src/pages/(group)/index.tsx", "export default 2;");
        expect(() => typegenProject(root)).toThrow(/Route collision/);
        expect(() => inspectEntry(root, "route", "/")).toThrow(/Route collision/);
        write("src/pages/index.tsx", `'use ssr'; 'use ssg';`);
        expect(() => inspectProject(root)).toThrow(/both SSR and SSG/);
    });

    it("detects equivalent dynamic routes with different parameter names", () => {
        write("src/pages/[id].tsx", "export default 1;");
        write("src/pages/[slug].tsx", "export default 2;");
        expect(() => typegenProject(root)).toThrow(/Route collision/);
    });

    it("preserves composite declaration settings without emitting code or build caches", () => {
        write("tsconfig.json", JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }));
        write(
            "tsconfig.app.json",
            JSON.stringify({
                compilerOptions: { composite: true, declarationMap: true, incremental: true, tsBuildInfoFile: "./cache/app.tsbuildinfo", strict: true, skipLibCheck: true },
                include: ["src"],
            })
        );
        write("src/example.ts", "export const value: number = 1;");
        expect(() => checkProject(root)).not.toThrow();
        expect(fs.existsSync(path.join(root, "src/example.js"))).toBe(false);
        expect(fs.existsSync(path.join(root, "src/example.d.ts"))).toBe(false);
        expect(fs.existsSync(path.join(root, "src/example.d.ts.map"))).toBe(false);
        expect(fs.existsSync(path.join(root, "cache/app.tsbuildinfo"))).toBe(false);
        write("src/example.ts", 'export const value: number = "wrong";');
        expect(() => checkProject(root)).toThrow(/not assignable/);
    });

    it("checks TypeScript without generating application output", () => {
        write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true }, include: ["src"] }));
        write("src/example.ts", 'const value: number = "wrong";');
        expect(() => checkProject(root)).toThrow(/not assignable/);
        write("src/example.ts", "const value: number = 1;");
        expect(() => checkProject(root)).not.toThrow();
        expect(fs.existsSync(path.join(root, "src/example.js"))).toBe(false);
    });
});
