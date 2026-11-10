import fs from "fs";
import path from "path";
import ts from "typescript";

import { writeRpcModule } from "../vite/rpcModule.js";
import { scanAppShell, scanPageManifest, scanPageRoutes, scanServerExports } from "../vite/scanner.js";

/** Stable, source-only manifest. Inspection never evaluates application modules. */
export function inspectProject(root: string) {
    const server = scanServerExports(root);
    const pages = scanPageManifest(root);
    const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
    const source = (item: { name: string; filePath: string }) => ({ name: item.name, file: relative(item.filePath) });
    const shell = scanAppShell(root);
    return {
        version: 1,
        routes: pages.map((route) => ({
            ...route,
            file: relative(route.file),
            sidecar: route.sidecar ? relative(route.sidecar) : null,
            layouts: route.layouts.map(relative),
        })),
        rpc: server.methods.map(source),
        http: server.httpHandlers.map(source),
        seo: server.seoMetadata.map(source),
        workers: server.workers.map(source),
        middleware: server.middleware ? source(server.middleware) : null,
        appShell: shell ? relative(shell) : null,
        collisions: scanPageRoutes(root, pages).collisions.map((collision) => ({ ...collision, files: collision.files.map(relative) })),
    };
}

/** Validate CLI values before scanning application source. Repeated flags are arrays in CAC. */
export function inspectSelection(options: { route?: unknown; rpc?: unknown }): { kind: "route" | "rpc"; name: string } | undefined {
    if (options.route !== undefined && options.rpc !== undefined) {
        throw new Error("Choose either --route or --rpc, not both.");
    }
    const kind = options.route !== undefined ? "route" : options.rpc !== undefined ? "rpc" : undefined;
    if (!kind) {
        return undefined;
    }
    const name = options[kind];
    if (Array.isArray(name)) {
        throw new Error(`Specify --${kind} only once.`);
    }
    if (typeof name !== "string" || !name.trim()) {
        throw new Error(`--${kind} requires a non-empty ${kind === "route" ? "route pattern" : "RPC method name"}.`);
    }
    return { kind, name };
}

/** Select one exact manifest entry for focused tooling output. */
export function inspectEntry(root: string, kind: "route" | "rpc", name: string) {
    const manifest = inspectProject(root);
    if (manifest.collisions.length) {
        throw new Error(manifest.collisions.map((c) => `Route collision "${c.pattern}": ${c.files.join(" and ")}`).join("\n"));
    }
    const entry = kind === "route" ? manifest.routes.find((route) => route.pattern === name) : manifest.rpc.find((method) => method.name === name);
    if (!entry) {
        throw new Error(`No ${kind === "route" ? "route pattern" : "RPC method"} found: ${name}`);
    }
    return entry;
}

export function typegenProject(root: string): number {
    const manifest = inspectProject(root);
    if (manifest.collisions.length) {
        throw new Error(manifest.collisions.map((c) => `Route collision "${c.pattern}": ${c.files.join(" and ")}`).join("\n"));
    }
    const methods = manifest.rpc.map((method) => ({ name: method.name, filePath: path.join(root, method.file) }));
    writeRpcModule(root, methods);
    return methods.length;
}

/** Check each referenced TS project without emitting application code or build caches. */
export function checkProject(root: string): void {
    typegenProject(root);
    const configPath = path.join(root, "tsconfig.json");
    if (!fs.existsSync(configPath)) {
        throw new Error("helium check requires tsconfig.json in the project root.");
    }
    const visited = new Set<string>();
    const diagnostics: ts.Diagnostic[] = [];
    function check(file: string) {
        if (visited.has(file)) {
            return;
        }
        visited.add(file);
        const read = ts.readConfigFile(file, ts.sys.readFile);
        if (read.error) {
            diagnostics.push(read.error);
            return;
        }
        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), { noEmit: true }, file);
        diagnostics.push(...parsed.errors);
        for (const reference of parsed.projectReferences ?? []) {
            check(ts.resolveProjectReferencePath(reference));
        }
        if (parsed.fileNames.length) {
            const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
            diagnostics.push(...ts.getPreEmitDiagnostics(program));
        }
    }
    check(configPath);
    if (diagnostics.length) {
        throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n" }));
    }
}
