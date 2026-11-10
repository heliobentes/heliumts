// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RPC_MODULE_PATH, writeRpcModule } from "../../src/vite/rpcModule";
import { scanServerExports } from "../../src/vite/scanner";
import { generateServerManifest } from "../../src/vite/virtualServerModule";

const frameworkRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("streaming method build support", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-streaming-types-"));
        fs.mkdirSync(path.join(root, "src", "server"), { recursive: true });
        fs.symlinkSync(path.join(frameworkRoot, "node_modules"), path.join(root, "node_modules"), "junction");
        fs.writeFileSync(
            path.join(root, "src", "server", "streams.ts"),
            `import { defineMethod } from 'heliumts/server';
export const streamRows = defineMethod(async function* (args: { count: number }, ctx) {
    for (let index = 0; index < args.count && !ctx.signal.aborted; index++) {
        yield { text: String(index), index };
    }
});
export const streamText = defineMethod(async function* words(args: { name: string }) {
    yield 'Hello ' + args.name;
});`
        );
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("discovers async generators as methods and registers them for RPC", () => {
        const { methods } = scanServerExports(root);
        expect(methods.map((method) => method.name)).toEqual(["streamRows", "streamText"]);
        const manifest = generateServerManifest(methods, []);
        expect(manifest).toContain("registry.register('streamRows', method_0)");
        expect(manifest).toContain("registry.register('streamText', method_1)");
    });

    it("preserves generator argument and chunk inference through generated references", () => {
        const { methods } = scanServerExports(root);
        writeRpcModule(root, methods);
        const rpcModulePath = path.join(root, RPC_MODULE_PATH);
        const consumerPath = path.join(root, "src", "consumer.ts");
        fs.writeFileSync(
            consumerPath,
            `import { useStreaming } from 'heliumts/client';
import { streamRows, streamText } from './rpc.generated';
const rows = useStreaming(streamRows, { onChunk(chunk) {
    const text: string = chunk.text;
    const index: number = chunk.index;
    // @ts-expect-error Generated chunks must retain their property types.
    const wrong: number = chunk.text;
} });
const chunks: Array<{ text: string; index: number }> = rows.chunks;
rows.start({ count: 3 });
// @ts-expect-error Generated streaming arguments must be checked.
rows.start({ count: 'three' });
const strings = useStreaming(streamText);
const stringChunks: string[] = strings.chunks;
strings.start({ name: 'Helium' });
// @ts-expect-error Object and string streams must remain distinct.
const wrongChunks: number[] = strings.chunks;`
        );
        const program = ts.createProgram([consumerPath, rpcModulePath, path.join(frameworkRoot, "src", "client", "vite-env.d.ts")], {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.ReactJSX,
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            esModuleInterop: true,
            types: ["node", "vite/client"],
            typeRoots: [path.join(frameworkRoot, "node_modules", "@types"), path.join(frameworkRoot, "node_modules")],
            paths: { "heliumts/*": [path.join(frameworkRoot, "src", "*")] },
        });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    }, 30_000);
});
