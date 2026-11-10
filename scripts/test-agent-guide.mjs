import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const guide = await readFile(path.join(root, "docs/agent-guide.md"), "utf8");
const directory = await mkdtemp(path.join(tmpdir(), "helium-guide-"));
try {
    const examples = [...guide.matchAll(/```tsx? file=(\S+)\n([\s\S]*?)\n```/g)];
    assert.equal(examples.length, 4, "The canonical guide must contain its server, page, editor and query examples");
    for (const [, filename, source] of examples) {
        assert.match(filename, /^src\/(server|pages|components)\/[\w./-]+\.tsx?$/);
        const destination = path.join(directory, filename);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, source + "\n");
    }
    // App-specific method fixtures typecheck the generic editor without publishing
    // demo server handlers that omit real application authorization.
    await mkdir(path.join(directory, "src/server"), { recursive: true });
    await writeFile(path.join(directory, "src/server/article-fixtures.ts"), `
import { defineMethod } from "heliumts/server";
type Article = { id: string; title: string };
export const getArticle = defineMethod(({ id }: { id: string }): Article => ({ id, title: "Example" }));
export const listArticles = defineMethod((_args: void): Article[] => []);
export const saveArticle = defineMethod((article: Article): Article => article);
`);
    await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                noEmit: true,
                module: "ESNext",
                moduleResolution: "Bundler",
                target: "ES2022",
                jsx: "react-jsx",
                skipLibCheck: true,
                paths: { "heliumts/*": [path.join(root, "dist/*")] },
            },
            include: ["src"],
        })
    );
    const result = spawnSync(process.execPath, [path.join(root, "dist/bin/helium.js"), "check"], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    // Execute the very same extracted example against the built framework. Only
    // resolve its package import; do not maintain a second copy of the parser.
    const serverSource = examples.find(([, filename]) => filename === "src/server/greeting.ts")?.[2];
    assert.ok(serverSource, "The guide must include its greeting server example");
    const emitted = ts.transpileModule(serverSource, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const serverURL = pathToFileURL(path.join(root, "dist/server/index.js")).href;
    const executable = emitted.replace('from "heliumts/server"', `from ${JSON.stringify(serverURL)}`);
    assert.notEqual(executable, emitted, "Resolve the example's framework import for runtime testing");
    const runtimeFile = path.join(directory, "greeting.mjs");
    await writeFile(runtimeFile, executable);
    const { greet } = await import(pathToFileURL(runtimeFile).href);
    const context = { signal: new AbortController().signal };
    for (const name of ["Helium", "  Helium  ", "x".repeat(80)]) {
        assert.deepEqual(await greet.handler({ name }, context), { message: `Hello ${name.trim()}` });
    }
    assert.deepEqual(await greet.handler({ name: "Helium", extra: true }, context), { message: "Hello Helium" });
    const invalid = [
        undefined,
        null,
        false,
        42,
        "Helium",
        [],
        ["Helium"],
        Object.assign([], { name: "Helium" }),
        {},
        { other: "Helium" },
        { name: null },
        { name: 42 },
        { name: false },
        { name: [] },
        { name: {} },
        { name: "" },
        { name: " \t\n " },
        { name: "x".repeat(81) },
    ];
    for (const input of invalid) {
        await assert.rejects(greet.handler(input, context), {
            name: "MethodInputError",
            message: "Invalid method arguments",
        });
    }
    console.log(`Canonical guide: generated RPC references, all four TypeScript examples, 4 valid and ${invalid.length} malformed runtime inputs passed.`);
} finally {
    await rm(directory, { recursive: true, force: true });
}
