import fs from "fs";
import path from "path";

import { type PageRoute, pathFromPageFile } from "../runtime/pageRoutes.js";
import { log } from "../utils/logger.js";
import { SERVER_DIR } from "./paths.js";
import { discoverExports } from "./rpcDiscovery.js";

// Application RPC names become `export const <name>` bindings in strict ES modules.
const reservedRpcBindings = new Set(
    "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield eval arguments".split(
        " "
    )
);

export interface MethodExport {
    name: string;
    filePath: string;
}

export interface HTTPHandlerExport {
    name: string;
    filePath: string;
}

export interface MiddlewareExport {
    name: string;
    filePath: string;
}

export interface WorkerExport {
    name: string;
    filePath: string;
}

export interface SEOMetadataExport {
    name: string;
    filePath: string;
}

export interface ServerExports {
    methods: MethodExport[];
    httpHandlers: HTTPHandlerExport[];
    seoMetadata: SEOMetadataExport[];
    middleware?: MiddlewareExport;
    workers: WorkerExport[];
}

export interface SSRPageExport {
    pathPattern: string;
    pageFilePath: string;
    serverFilePath: string | null;
    layoutFilePaths: string[];
}

export interface PageManifestEntry extends PageRoute {
    file: string;
    sidecar: string | null;
    layouts: string[];
}

export function scanAppShell(root: string): string | null {
    const srcDir = path.join(root, "src");
    const pagesDir = path.join(srcDir, "pages");
    const candidates = [
        path.join(srcDir, "App.tsx"),
        path.join(srcDir, "App.jsx"),
        path.join(srcDir, "App.ts"),
        path.join(srcDir, "App.js"),
        path.join(srcDir, "app.tsx"),
        path.join(srcDir, "app.jsx"),
        path.join(srcDir, "app.ts"),
        path.join(srcDir, "app.js"),
        path.join(pagesDir, "_app.tsx"),
        path.join(pagesDir, "_app.jsx"),
        path.join(pagesDir, "_app.ts"),
        path.join(pagesDir, "_app.js"),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function scanServerMethods(root: string): MethodExport[] {
    const exports = scanServerExports(root);
    return exports.methods;
}

export function scanServerExports(root: string): ServerExports {
    const serverDir = path.resolve(root, SERVER_DIR);
    if (!fs.existsSync(serverDir)) {
        return { methods: [], httpHandlers: [], seoMetadata: [], workers: [] };
    }

    const files = new Map<string, string>();
    function walk(dir: string) {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir).sort();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return;
            }
            throw error;
        }
        for (const entry of entries) {
            const file = path.join(dir, entry);
            try {
                if (fs.statSync(file).isDirectory()) {
                    walk(file);
                } else if (/\.[cm]?[jt]sx?$/.test(entry) && !/\.d\.[cm]?ts$/.test(entry)) {
                    files.set(file, fs.readFileSync(file, "utf8"));
                }
            } catch (error) {
                // Only disappearing files are recoverable; permissions/I/O failures must surface.
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error;
                }
            }
        }
    }
    walk(serverDir);
    const result: ServerExports = { methods: [], httpHandlers: [], seoMetadata: [], workers: [] };
    const registered = new Map<string, { origin: string; location: string }>();
    for (const item of discoverExports(files)) {
        const isMiddleware = item.factory === "middleware" || item.factory === "defineMiddleware";
        if (isMiddleware && !/^_middleware\.[cm]?[jt]sx?$/.test(path.basename(item.filePath))) {
            continue;
        }
        if (!isMiddleware && (item.name === "default" || !/^[$A-Z_a-z][$\w]*$/.test(item.name) || (item.factory === "defineMethod" && reservedRpcBindings.has(item.name)))) {
            throw new Error(`Helium exports must use a valid JavaScript binding name: ${item.name} at ${item.location}`);
        }
        const key = isMiddleware ? "middleware" : `${item.factory}:${item.name}`;
        const previous = registered.get(key);
        if (previous) {
            if (previous.origin === item.origin) {
                continue;
            } // A barrel re-export is the same declaration.
            throw new Error(`Duplicate Helium export "${item.name}": ${previous.location} and ${item.location}`);
        }
        registered.set(key, item);
        const entry = { name: item.name, filePath: item.filePath };
        if (isMiddleware) {
            result.middleware = entry;
        } else if (item.factory === "defineMethod") {
            result.methods.push(entry);
        } else if (item.factory === "defineHTTPRequest") {
            result.httpHandlers.push(entry);
        } else if (item.factory === "defineSEOMetadata") {
            result.seoMetadata.push(entry);
        } else if (item.factory === "defineWorker") {
            result.workers.push(entry);
        }
    }
    return result;
}

export function isPageFile(fileName: string): boolean {
    return /\.(tsx|jsx|ts|js)$/.test(fileName) && !/\.d\.ts$/.test(fileName) && !fileName.includes(".server.") && !/^_(?:layout|app)\./.test(fileName);
}

/** Read directives only from the module prologue, never from comments or examples. */
export function hasPageDirective(source: string, directive: "use ssr" | "use ssg"): boolean {
    const skipTrivia = (start: number): { position: number; lineBreak: boolean } => {
        let position = start;
        let lineBreak = false;
        while (position < source.length) {
            const char = source[position];
            if (/\s/.test(char)) {
                lineBreak ||= /[\n\r\u2028\u2029]/.test(char);
                position++;
            } else if (source.startsWith("//", position)) {
                const end = source.slice(position + 2).search(/[\n\r\u2028\u2029]/);
                position = end < 0 ? source.length : position + 2 + end;
            } else if (source.startsWith("/*", position)) {
                const end = source.indexOf("*/", position + 2);
                if (end < 0) {
                    return { position: source.length, lineBreak };
                }
                lineBreak ||= /[\n\r\u2028\u2029]/.test(source.slice(position + 2, end));
                position = end + 2;
            } else {
                break;
            }
        }
        return { position, lineBreak };
    };

    let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (source.startsWith("#!", position)) {
        const end = source.indexOf("\n", position);
        position = end < 0 ? source.length : end + 1;
    }
    position = skipTrivia(position).position;

    while (position < source.length) {
        const quote = source[position];
        if (quote !== '"' && quote !== "'") {
            return false;
        }
        const valueStart = ++position;
        while (position < source.length && source[position] !== quote) {
            if (/[\n\r\u2028\u2029]/.test(source[position])) {
                return false;
            }
            if (source[position] === "\\") {
                position++;
                if (source[position] === "\r" && source[position + 1] === "\n") {
                    position++;
                }
            }
            position++;
        }
        if (position >= source.length) {
            return false;
        }
        const value = source.slice(valueStart, position);
        const after = skipTrivia(position + 1);
        const next = source.slice(after.position);
        // A string followed by an operator, call, property access, or template is
        // part of a larger expression, not a directive (including across a newline).
        const continuesExpression = /^(?:[([.?,`*/%&|^<>=]|\+(?!\+)|-(?!-)|!=|(?:in|instanceof|as|satisfies)\b)/.test(next);
        if (next.startsWith(";")) {
            position = skipTrivia(after.position + 1).position;
        } else if (next === "" || (after.lineBreak && !continuesExpression)) {
            position = after.position;
        } else {
            return false;
        }
        if (value === directive) {
            return true;
        }
    }
    return false;
}

function findSidecarServerFile(pageFilePath: string): string | null {
    const pageExt = path.extname(pageFilePath);
    const base = pageFilePath.slice(0, -pageExt.length);
    const candidates = [".server.ts", ".server.js", ".server.mts", ".server.mjs", ".server.tsx", ".server.jsx"].map((suffix) => `${base}${suffix}`);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function findLayoutPath(dir: string): string | undefined {
    return ["_layout.tsx", "_layout.jsx", "_layout.ts", "_layout.js"].map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
}

/** Find ancestor layouts for callers rendering a page outside a manifest. */
export function findLayoutPathsForPage(pagePath: string, root: string): string[] {
    const pagesDir = path.join(root, "src", "pages");
    const relativePath = path.relative(pagesDir, pagePath);
    const pathParts = path
        .dirname(relativePath)
        .split(path.sep)
        .filter((p) => p !== ".");

    const layoutPaths: string[] = [];
    for (let i = 0; i <= pathParts.length; i++) {
        const layout = findLayoutPath(path.join(pagesDir, ...pathParts.slice(0, i)));
        if (layout) {
            layoutPaths.push(layout);
        }
    }

    return layoutPaths;
}

export function scanSSRPages(root: string, manifest: readonly PageManifestEntry[] = scanPageManifest(root)): SSRPageExport[] {
    return manifest
        .filter((route) => route.render === "ssr" && route.pattern !== "__404__")
        .map(({ pattern, file, sidecar, layouts }) => ({
            pathPattern: pattern,
            pageFilePath: file,
            serverFilePath: sidecar,
            layoutFilePaths: layouts,
        }));
}

export interface RouteCollision {
    pattern: string;
    files: string[];
}

export function scanPageRoutePatterns(root: string, manifest: readonly PageManifestEntry[] = scanPageManifest(root)): string[] {
    return [...new Set(manifest.map((route) => route.pattern).filter((pattern) => pattern !== "__404__"))];
}

/**
 * Scan pages directory and detect route collisions
 */
export function scanPageRoutes(root: string, manifest: readonly PageManifestEntry[] = scanPageManifest(root)): { collisions: RouteCollision[]; totalRoutes: number } {
    const routes = new Map<string, RouteCollision>();
    for (const { pattern, file } of manifest) {
        if (pattern === "__404__") {
            continue;
        }
        const key = pattern.replace(/:[^/]+/g, ":param").replace(/\*[^/]+/g, "*param");
        const route = routes.get(key);
        if (route) {
            route.files.push(file);
        } else {
            routes.set(key, { pattern, files: [file] });
        }
    }
    return { collisions: [...routes.values()].filter(({ files }) => files.length > 1), totalRoutes: routes.size };
}

/**
 * Check for route collisions and log warnings
 */
export function checkRouteCollisions(root: string, manifest: readonly PageManifestEntry[] = scanPageManifest(root)): boolean {
    const { collisions, totalRoutes } = scanPageRoutes(root, manifest);

    if (collisions.length === 0) {
        return false;
    }

    log("warn", "⚠️  Route collisions detected! Multiple files resolve to the same URL path:");
    log("warn", "");

    for (const collision of collisions) {
        log("error", `  Route pattern: "${collision.pattern}"`);
        for (const file of collision.files) {
            const relative = path.relative(root, file);
            log("error", `    - ${relative}`);
        }
        log("error", `  ⚠️  Only the first file will be accessible.`);
        log("warn", "");
    }

    log("warn", `Found ${collisions.length} collision(s) across ${totalRoutes} unique routes.`);
    log("warn", "Consider using different file names or organizing files in subdirectories.");
    log("warn", "");

    return true;
}

/** Describe rendering and source files without loading page modules. */
export function scanPageManifest(root: string): PageManifestEntry[] {
    const routes: PageManifestEntry[] = [];
    const pagesDir = path.resolve(root, "src", "pages");
    function walk(dir: string, parentLayouts: string[]) {
        const layout = findLayoutPath(dir);
        const layouts = layout ? [...parentLayouts, layout] : parentLayouts;
        for (const name of fs.readdirSync(dir).sort()) {
            const file = path.join(dir, name);
            if (fs.statSync(file).isDirectory()) {
                walk(file, layouts);
            } else if (isPageFile(name)) {
                const source = fs.readFileSync(file, "utf8");
                const ssr = hasPageDirective(source, "use ssr");
                const ssg = hasPageDirective(source, "use ssg");
                if (ssr && ssg) {
                    throw new Error(`Page cannot use both SSR and SSG: ${file}`);
                }
                routes.push({
                    pattern: pathFromPageFile(path.relative(pagesDir, file).split(path.sep).join("/")),
                    file,
                    render: ssr ? "ssr" : ssg ? "ssg" : "spa",
                    sidecar: findSidecarServerFile(file),
                    layouts,
                });
            }
        }
    }
    if (fs.existsSync(pagesDir)) {
        walk(pagesDir, []);
    }
    return routes;
}
