import { describe, expect, it } from "vitest";

import { discoverExports } from "../../src/vite/rpcDiscovery";

const discover = (source: string) => discoverExports(new Map([["/app/src/server/api.ts", source]]));

describe("parser-based discovery", () => {
    it("ignores comments, strings, types, unrelated factories, and nested declarations", () => {
        expect(
            discover(`
            // export const commented = defineMethod(() => {});
            const example = "export const quoted = defineMethod(() => {})";
            import { defineMethod } from "other-library";
            export const unrelated = defineMethod(() => {});
            function nested() { const hidden = defineMethod(() => {}); }
            export type { Something } from './types';
        `)
        ).toEqual([]);
    });

    it("does not confuse default imports or unresolved re-exports with local factories", () => {
        expect(discover(`import defineMethod from 'other-library'; export const wrong = defineMethod(() => 1);`)).toEqual([]);
        expect(discover(`const local = defineMethod(() => 1); export { local } from './missing';`)).toEqual([]);
    });

    it.each(["const { defineMethod } = other;", "const [defineMethod] = other;", 'import * as defineMethod from "other";'])(
        "does not discover locally shadowed bare factories: %s",
        (declaration) => {
            expect(discover(`${declaration} export const x = defineMethod(() => 1);`)).toEqual([]);
        }
    );

    it("supports imported aliases, generics, type annotations, satisfies, and namespace imports", () => {
        const exports = discover(`
            import { defineMethod as rpc } from 'heliumts/server';
            import * as helium from 'heliumts/server';
            export const typed: SomeType = rpc<Args>(async () => 1);
            const local = (rpc(async () => 2) satisfies SomeType);
            export { local as renamed };
            export const stream = helium.defineMethod(async () => 3);
        `);
        expect(exports.map((item) => item.name)).toEqual(["typed", "renamed", "stream"]);
        expect(exports.every((item) => item.factory === "defineMethod")).toBe(true);
    });

    it("resolves renamed and star re-exports and terminates cycles", () => {
        const files = new Map([
            ["/app/src/server/source.ts", `import { defineMethod } from 'heliumts/server'; export const original = defineMethod(async () => 1);`],
            ["/app/src/server/barrel.ts", `export { original as renamed } from './source.js'; export * from './cycle';`],
            ["/app/src/server/cycle.ts", `export * from './barrel';`],
        ]);
        const exports = discoverExports(files);
        expect(exports.map((item) => item.name)).toEqual(["original", "renamed", "renamed"]);
        expect(new Set(exports.map((item) => item.origin)).size).toBe(1);
    });

    it.each([
        "export const { x } = { x: 1 };",
        "export const { nested: [x] } = { nested: [1] };",
        "export const [,,x] = [1,2,3];",
        "export const x = 1;",
        "const local = 1; export { local as x };",
        "export function x() {}",
        "export class x {}",
        "export * as x from './a';",
    ])("explicit exports shadow earlier star bindings: %s", (shadow) => {
        const exports = discoverExports(
            new Map([
                ["/app/src/server/a.ts", "export const x = defineMethod(() => 1);"],
                ["/app/src/server/barrel.ts", `export * from './a'; ${shadow}`],
            ])
        );
        expect(exports.map((item) => item.filePath)).toEqual(["/app/src/server/a.ts"]);
    });

    it("omits ambiguous star bindings while permitting identical re-exports", () => {
        const files = new Map([
            ["/app/src/server/a.ts", "export const x = defineMethod(() => 1);"],
            ["/app/src/server/b.ts", "export const x = defineMethod(() => 2);"],
            ["/app/src/server/barrel.ts", "export * from './a'; export * from './b';"],
        ]);
        expect(discoverExports(files).filter((item) => item.filePath.endsWith("barrel.ts"))).toEqual([]);
        files.set("/app/src/server/b.ts", "export * from './a';");
        expect(discoverExports(files).filter((item) => item.filePath.endsWith("barrel.ts"))).toHaveLength(1);
    });

    it.each(["export function x() {}", "export class x {}", "export const { x } = { x: 1 };", 'export * as x from "./a";'])(
        "omits ambiguous star exports from non-RPC declarations: %s",
        (declaration) => {
            const exports = discoverExports(
                new Map([
                    ["/app/src/server/a.ts", "export const x = defineMethod(() => 1);"],
                    ["/app/src/server/b.ts", declaration],
                    ["/app/src/server/barrel.ts", 'export * from "./a"; export * from "./b";'],
                ])
            );
            expect(exports.filter((item) => item.filePath.endsWith("barrel.ts"))).toEqual([]);
        }
    );

    it.each(["function", "class"])("a default named %s does not shadow the same named star export", (kind) => {
        const exports = discoverExports(
            new Map([
                ["/app/src/server/a.ts", "export const x = defineMethod(() => 1);"],
                ["/app/src/server/barrel.ts", `export * from "./a"; export default ${kind} x${kind === "function" ? "()" : ""} {}`],
            ])
        );
        expect(exports.map((item) => item.filePath)).toEqual(["/app/src/server/a.ts", "/app/src/server/barrel.ts"]);
    });

    it("resolves default imports re-exported with a name", () => {
        const exports = discoverExports(
            new Map([
                ["/app/src/server/a.ts", "export default defineMethod(() => 1);"],
                ["/app/src/server/barrel.ts", "import method from './a'; export { method };"],
            ])
        );
        expect(exports.map((item) => item.name)).toEqual(["default", "method"]);
    });

    it("reports malformed source with file and line rather than silently omitting methods", () => {
        expect(() => discover("\nexport const broken = defineMethod(;")).toThrow(/api.ts:2:/);
    });

    it("supports default middleware without executing top-level code", () => {
        const exports = discover(`throw new Error('must not execute'); import { defineMiddleware as mw } from 'heliumts/server'; export default mw(() => {});`);
        expect(exports[0]).toMatchObject({ name: "default", factory: "defineMiddleware" });
    });
});
