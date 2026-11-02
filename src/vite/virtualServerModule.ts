import path from "path";

import { HTTPHandlerExport, MethodExport, MiddlewareExport, SEOMetadataExport, SSRPageExport, WorkerExport } from "./scanner.js";

function moduleSpecifier(filePath: string): string {
    // Vite expects POSIX import paths, including on Windows.
    return `'${filePath
        .replace(/\\/g, "/")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")}'`;
}

export function generateServerManifest(
    methods: MethodExport[],
    httpHandlers: HTTPHandlerExport[],
    seoMetadata: SEOMetadataExport[] = [],
    pageRoutePatterns: string[] = [],
    ssrPages: SSRPageExport[] = [],
    appShellFilePath: string | null = null,
    middleware?: MiddlewareExport,
    workers: WorkerExport[] = []
): string {
    const methodImports = methods.map((m, i) => `import { ${m.name} as method_${i} } from ${moduleSpecifier(m.filePath)};`).join("\n");
    const httpImports = httpHandlers.map((h, i) => `import { ${h.name} as http_${i} } from ${moduleSpecifier(h.filePath)};`).join("\n");
    const seoImports = seoMetadata.map((s, i) => `import { ${s.name} as seo_${i} } from ${moduleSpecifier(s.filePath)};`).join("\n");
    const workerImports = workers.map((w, i) => `import { ${w.name} as worker_${i} } from ${moduleSpecifier(w.filePath)};`).join("\n");
    const middlewareImport = middleware
        ? `import ${middleware.name === "default" ? "middleware" : `{ ${middleware.name} as middleware }`} from ${moduleSpecifier(middleware.filePath)};`
        : "";

    const methodRegistrations = methods.map((m, i) => `  registry.register('${m.name}', method_${i});`).join("\n");

    const httpExports = httpHandlers.map((h, i) => `  { name: '${h.name}', handler: http_${i} },`).join("\n");
    const seoExports = seoMetadata.map((s, i) => `  { name: '${s.name}', handler: seo_${i} },`).join("\n");

    const workerExports = workers.map((w, i) => `  { name: '${w.name}', worker: worker_${i} },`).join("\n");

    const ssrPageExports = ssrPages
        .map((s) => {
            const loadLayoutsBody = s.layoutFilePaths
                .map(
                    (layoutPath, layoutIndex) => `        {
            const mod_${layoutIndex} = await import(${moduleSpecifier(layoutPath)});
            if (mod_${layoutIndex}.default) {
                layouts.push(mod_${layoutIndex}.default);
            }
        }`
                )
                .join("\n");

            const sidecarCheck = s.serverFilePath
                ? `        {
            const sidecar = await import(${moduleSpecifier(s.serverFilePath)});
            if (typeof sidecar.getServerSideProps === 'function') {
                return sidecar.getServerSideProps(req, ctx);
            }
        }
`
                : "";

            return `  {
    pathPattern: ${JSON.stringify(s.pathPattern)},
    loadComponent: async () => {
        const page = await import(${moduleSpecifier(s.pageFilePath)});
        return page.default;
    },
    loadLayouts: async () => {
        const layouts = [];
${loadLayoutsBody}
        return layouts;
    },
    getServerSideProps: async (req, ctx) => {
${sidecarCheck}        const page = await import(${moduleSpecifier(s.pageFilePath)});
        if (typeof page.getServerSideProps === 'function') {
            return page.getServerSideProps(req, ctx);
        }
        return null;
    }
  },`;
        })
        .join("\n");

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

export const ssrPages = [
${ssrPageExports}
];

export const appShell = ${
        appShellFilePath
            ? `async () => {
    const mod = await import(${moduleSpecifier(appShellFilePath)});
    return mod.default ?? mod.App ?? mod.app ?? null;
}`
            : "null"
    };

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

export function generateTypeDefinitions(methods: MethodExport[], root: string): string {
    // Sort methods by name for a stable output regardless of file-system walk order
    const sorted = [...methods].sort((a, b) => a.name.localeCompare(b.name));

    const methodsWithRelativePath = sorted.map((m) => {
        let relPath = path.relative(path.join(root, "src"), m.filePath);
        if (!relPath.startsWith(".")) {
            relPath = "../" + relPath;
        }
        // Normalize to posix separators for import paths
        relPath = relPath.replace(/\\/g, "/").replace(/\.ts$/, "");
        return {
            ...m,
            relPath,
        };
    });

    const imports = methodsWithRelativePath
        .map((m, index) => {
            return `import type { ${m.name} as __helium_method_${index} } from ${moduleSpecifier(m.relPath)};`;
        })
        .join("\n");

    const methodExports = methodsWithRelativePath
        .map((m, index) => {
            return `    export const ${m.name}: import('heliumts/client').MethodStub<
        Parameters<typeof __helium_method_${index}['handler']>[0],
        Awaited<ReturnType<typeof __helium_method_${index}['handler']>>
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

    const methodSignature = methodsWithRelativePath.map((m) => m.name).join(", ");

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

export function generateEntryModule(appShellFilePath: string | null = "/src/App"): string {
    return `
import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { AppRouter } from 'heliumts/client';
${appShellFilePath ? `import App from ${moduleSpecifier(appShellFilePath)};` : ""}

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Root element not found. Helium requires a <div id="root"></div> in your HTML.');
}

const app = (
    <React.StrictMode>
        <AppRouter${appShellFilePath ? " AppShell={App}" : ""} />
    </React.StrictMode>
);

if (rootEl.hasChildNodes()) {
    hydrateRoot(rootEl, app);
} else {
    createRoot(rootEl).render(app);
}
`;
}
