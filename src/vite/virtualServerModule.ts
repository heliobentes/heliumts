import path from "path";

import { HTTPHandlerExport, MethodExport, MiddlewareExport, SEOMetadataExport, WorkerExport } from "./scanner.js";

export function generateServerManifest(
    methods: MethodExport[],
    httpHandlers: HTTPHandlerExport[],
    seoMetadata: SEOMetadataExport[] = [],
    pageRoutePatterns: string[] = [],
    middleware?: MiddlewareExport,
    workers: WorkerExport[] = []
): string {
    const methodImports = methods.map((m, i) => `import { ${m.name} as method_${i} } from '${m.filePath}';`).join("\n");
    const httpImports = httpHandlers.map((h, i) => `import { ${h.name} as http_${i} } from '${h.filePath}';`).join("\n");
    const seoImports = seoMetadata.map((s, i) => `import { ${s.name} as seo_${i} } from '${s.filePath}';`).join("\n");
    const workerImports = workers.map((w, i) => `import { ${w.name} as worker_${i} } from '${w.filePath}';`).join("\n");
    const middlewareImport = middleware ? `import ${middleware.name === "default" ? "middleware" : `{ ${middleware.name} as middleware }`} from '${middleware.filePath}';` : "";

    const methodRegistrations = methods.map((m, i) => `  registry.register('${m.name}', method_${i});`).join("\n");

    const httpExports = httpHandlers.map((h, i) => `  { name: '${h.name}', handler: http_${i} },`).join("\n");
    const seoExports = seoMetadata.map((s, i) => `  { name: '${s.name}', handler: seo_${i} },`).join("\n");

    const workerExports = workers.map((w, i) => `  { name: '${w.name}', worker: worker_${i} },`).join("\n");

    return `
${methodImports}
${httpImports}
${seoImports}
${workerImports}
${middlewareImport}

export function registerAll(registry) {
${methodRegistrations}
}

export const httpHandlers = [
${httpExports}
];

export const seoMetadataHandlers = [
${seoExports}
];

export const pageRoutePatterns = ${JSON.stringify(pageRoutePatterns)};

export const workers = [
${workerExports}
];

export const middlewareHandler = ${middleware ? "middleware" : "null"};
`;
}

export function generateClientModule(methods: MethodExport[]): string {
    const exports = methods.map((m) => `export const ${m.name} = { __id: '${m.name}' };`).join("\n");

    return exports;
}

/**
 * Generate a deterministic suffix from a string.
 * Uses only file path and method name (NOT index) so that adding/removing
 * other methods does not change existing aliases.
 */
function stableAlias(filePath: string, name: string): string {
    const input = `${filePath}:${name}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `${name}_${Math.abs(hash).toString(36)}`;
}

export function generateTypeDefinitions(methods: MethodExport[], root: string): string {
    // Sort methods by name for a stable output regardless of file-system walk order
    const sorted = [...methods].sort((a, b) => a.name.localeCompare(b.name));

    const methodsWithAlias = sorted.map((m) => ({
        ...m,
        alias: stableAlias(m.filePath, m.name),
    }));

    const imports = methodsWithAlias
        .map((m) => {
            let relPath = path.relative(path.join(root, "src"), m.filePath);
            if (!relPath.startsWith(".")) {
                relPath = "../" + relPath;
            }
            // Normalize to posix separators for import paths
            relPath = relPath.replace(/\\/g, "/").replace(/\.ts$/, "");
            return `import type { ${m.name} as ${m.alias} } from '${relPath}';`;
        })
        .join("\n");

    const methodExports = methodsWithAlias
        .map((m) => {
            return `    export const ${m.name}: import('heliumts/client').MethodStub<
        Parameters<typeof ${m.alias}['handler']>[0],
        Awaited<ReturnType<typeof ${m.alias}['handler']>>
    >;`;
        })
        .join("\n");

    // If there are no methods, we don't need to generate any augmentation
    // This prevents shadowing the actual heliumts/server exports
    if (methods.length === 0) {
        return `/* eslint-disable */
/**
* Auto generated file - DO NOT EDIT!
* # Helium Server Type Definitions
* 
* This file is empty because no methods have been defined yet.
* Once you create a method using defineMethod(), type stubs will be generated here.
*
* @helium-methods (none)
**/
export {};
`;
    }

    const methodSignature = methodsWithAlias.map((m) => m.name).join(", ");

    return `/* eslint-disable */
/**
* Auto generated file - DO NOT EDIT!
* # Helium Server Type Definitions
*
* @helium-methods ${methodSignature}
**/
${imports}

declare module 'heliumts/server' {
    // Method stubs for client-side type inference
${methodExports}
}
`;
}

export function generateEntryModule(): string {
    return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from 'heliumts/client';
import App from '/src/App';

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Root element not found. Helium requires a <div id=\"root\"></div> in your HTML.');
}

createRoot(rootEl).render(
    <React.StrictMode>
        <AppRouter AppShell={App} />
    </React.StrictMode>
);
`;
}
