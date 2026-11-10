import path from "path";

import type { PageRoute } from "../runtime/pageRoutes.js";
import { HTTPHandlerExport, MethodExport, MiddlewareExport, PageManifestEntry, SEOMetadataExport, SSRPageExport, WorkerExport } from "./scanner.js";

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
    workers: WorkerExport[] = [],
    pageRoutes?: readonly PageRoute[]
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
export const pageRoutes = ${JSON.stringify(pageRoutes?.map(({ pattern, render }) => ({ pattern, render })))};

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

export function generatePageModules(manifest: readonly PageManifestEntry[], root: string): string {
    const modules = new Map<string, string>();
    const importName = (file: string) => {
        let name = modules.get(file);
        if (!name) {
            name = `pageModule_${modules.size}`;
            modules.set(file, name);
        }
        return name;
    };
    const entries = manifest.map(({ file, pattern, render, layouts }) => {
        const relativeFile = "/" + path.relative(root, file).split(path.sep).join("/");
        return `  { file: ${JSON.stringify(relativeFile)}, pattern: ${JSON.stringify(pattern)}, render: ${JSON.stringify(render)}, page: ${importName(file)}, layouts: [${layouts
            .map(importName)
            .join(", ")}], preload: () => import(${moduleSpecifier(file)}) },`;
    });
    const imports = Array.from(modules, ([file, name]) => `import * as ${name} from ${moduleSpecifier(file)};`);
    return `${imports.join("\n")}\nexport const pageModules = [\n${entries.join("\n")}\n];`;
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
