// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectPublicApi, listPublicApi } from "../../src/bin/publicApi";

let root: string;
const write = (file: string, source: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
};
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-public-api-"));
    write("package.json", JSON.stringify({ exports: { "./client": { types: "./dist/client/index.d.ts" }, "./internal": { types: "./dist/internal/index.d.ts" } } }));
    write("dist/client/index.d.ts", 'export { call as useCall } from "./hooks.js"; export * from "./types.js";');
    write(
        "dist/client/hooks.d.ts",
        `import type { Options } from "./types.js";
/** Typed mutation. */
export declare function call<T>(input: T, options: Options): Promise<T>;
export declare function call(input: string): string;
export declare function privateHook(): void;
`
    );
    write("dist/client/types.d.ts", "export interface Options { enabled: boolean; }");
    write("dist/client/index.js", "throw new Error('never evaluate framework JavaScript');");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("public API declarations", () => {
    it("discovers public alias and type names, then looks up a selected result", () => {
        const result = listPublicApi(root);
        expect(result.symbols).toEqual([
            { name: "Options", declarationKind: "interface" },
            { name: "useCall", declarationKind: "function" },
        ]);
        expect(result.count).toBe(2);
        expect(listPublicApi(root, "client", "CALL").symbols).toEqual([{ name: "useCall", declarationKind: "function" }]);
        expect(inspectPublicApi(root, result.symbols[1].name).name).toBe("useCall");
        expect(listPublicApi(root, "client", "privateHook").count).toBe(0);
        expect(listPublicApi(root, "client", ".*").symbols).toEqual([]);
    });

    it("lists type-only aliases and classes without widening the public surface", () => {
        write("dist/client/index.d.ts", 'export type { Options as PublicOptions } from "./types.js"; export declare class ErrorBoundary {} export declare enum Mode { On, Off }');
        expect(listPublicApi(root).symbols).toEqual([
            { name: "ErrorBoundary", declarationKind: "class" },
            { name: "Mode", declarationKind: "enum" },
            { name: "PublicOptions", declarationKind: "interface" },
        ]);
    });

    it("refuses broad discovery instead of silently dropping exports", () => {
        write("dist/client/index.d.ts", Array.from({ length: 101 }, (_, i) => `export declare const value${i}: string;`).join("\n"));
        expect(() => listPublicApi(root)).toThrow(/More than 100 public exports.*refine --match/);
        expect(listPublicApi(root, "client", "value100").symbols).toEqual([{ name: "value100", declarationKind: "value" }]);
        for (const filter of [true, "", ["call", "options"]]) expect(() => listPublicApi(root, "client", filter)).toThrow(/one non-empty literal/);
        expect(() => listPublicApi(root, "internal")).toThrow(/Unknown public entrypoint/);
    });

    it("follows public aliases, preserves overloads, documentation and generic references", () => {
        const result = inspectPublicApi(root, "useCall");
        expect(result.module).toBe("heliumts/client");
        expect(result.name).toBe("useCall");
        expect(result.declarations).toHaveLength(2);
        expect(result.declarations[0]).toMatchObject({ file: "dist/client/hooks.d.ts" });
        expect(result.declarations[0].text).toContain("Typed mutation");
        expect(result.declarations[0].text).toContain("call<T>(input: T, options: Options): Promise<T>");
        expect(result.declarations[1].text).toContain("call(input: string): string");
        expect(result.relatedTypes).toEqual([
            { name: "Options", publicExports: ["Options"], localDeclarations: [] },
            { name: "Promise", publicExports: [], localDeclarations: [] },
        ]);
        expect(inspectPublicApi(root, "Options").declarations[0].text).toContain("enabled: boolean");
        expect(JSON.stringify(result)).not.toContain("privateHook");
    });

    it("exposes aliased names for related types instead of suggesting an unexported original name", () => {
        write("dist/client/index.d.ts", 'export { call as useCall } from "./hooks.js"; export type { Options as CallOptions } from "./types.js";');
        expect(inspectPublicApi(root, "useCall").relatedTypes).toContainEqual({ name: "Options", publicExports: ["CallOptions"], localDeclarations: [] });
    });

    it("includes a local return shape once without allowing private imports or recursive expansion", () => {
        write("dist/client/index.d.ts", 'import type { State } from "./state.js"; export declare function useRouter(): State;');
        write("dist/client/state.d.ts", "type Event = { name: string }; export type State = { path: string; event: Event };");
        const result = inspectPublicApi(root, "useRouter");
        expect(result.relatedTypes).toHaveLength(1);
        expect(result.relatedTypes[0]).toMatchObject({ name: "State", publicExports: [] });
        expect(result.relatedTypes[0].localDeclarations[0].text).toContain("path: string");
        expect(JSON.stringify(result)).not.toContain("name: string");
        expect(() => inspectPublicApi(root, "State")).toThrow(/No public export/);
    });

    it("prints only the requested variable from a multi-binding declaration", () => {
        write("dist/client/index.d.ts", "export declare const first: number, second: string;");
        expect(inspectPublicApi(root, "first").declarations[0].text).toBe("declare const first: number;");
    });

    it("rejects private, fuzzy, repeated and nonpublic entrypoint requests", () => {
        for (const name of ["privateHook", "useCal"]) expect(() => inspectPublicApi(root, name)).toThrow(/No public export/);
        for (const name of [undefined, "", []]) expect(() => inspectPublicApi(root, name)).toThrow(/non-empty/);
        expect(() => inspectPublicApi(root, "useCall", ["client", "client"])).toThrow(/only once/);
        for (const entry of ["internal", "../client", "/client", true]) expect(() => inspectPublicApi(root, "useCall", entry)).toThrow(/Unknown public entrypoint/);
    });

    it("fails explicitly when installed declarations are missing or oversized", () => {
        fs.rmSync(path.join(root, "dist/client/index.d.ts"));
        expect(() => inspectPublicApi(root, "useCall")).toThrow(/Installed declarations unavailable/);
        write("dist/client/index.d.ts", `export interface Large { ${Array.from({ length: 1500 }, (_, i) => `field${i}: string;`).join(" ")} }`);
        expect(() => inspectPublicApi(root, "Large")).toThrow(/exceeds 16384 bytes; read dist\/client\/index.d.ts/);
    });
});
