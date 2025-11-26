import path from "path";

import { HTTPHandlerExport, MethodExport, MiddlewareExport } from "./scanner.js";

export function generateServerManifest(methods: MethodExport[], httpHandlers: HTTPHandlerExport[], middleware?: MiddlewareExport): string {
    const methodImports = methods.map((m, i) => `import { ${m.name} as method_${i} } from '${m.filePath}';`).join("\n");
    const httpImports = httpHandlers.map((h, i) => `import { ${h.name} as http_${i} } from '${h.filePath}';`).join("\n");
    const middlewareImport = middleware ? `import ${middleware.name === "default" ? "middleware" : `{ ${middleware.name} as middleware }`} from '${middleware.filePath}';` : "";

    const methodRegistrations = methods.map((m, i) => `  registry.register('${m.name}', method_${i});`).join("\n");

    const httpExports = httpHandlers.map((h, i) => `  { name: '${h.name}', handler: http_${i} },`).join("\n");

    return `
${methodImports}
${httpImports}
${middlewareImport}

export function registerAll(registry) {
${methodRegistrations}
}

export const httpHandlers = [
${httpExports}
];

export const middlewareHandler = ${middleware ? "middleware" : "null"};
`;
}

export function generateClientModule(methods: MethodExport[]): string {
    const exports = methods.map((m) => `export const ${m.name} = { __id: '${m.name}' };`).join("\n");

    return exports;
}

export function generateTypeDefinitions(methods: MethodExport[], root: string): string {
    const imports = methods
        .map((m, i) => {
            let relPath = path.relative(path.join(root, "src"), m.filePath);
            if (!relPath.startsWith(".")) {
                relPath = "../" + relPath;
            }
            relPath = relPath.replace(/\.ts$/, "");
            return `import type { ${m.name} as method_${i}_type } from '${relPath}';`;
        })
        .join("\n");

    const exports = methods
        .map((m, i) => {
            return `export const ${m.name}: import('helium/client').MethodStub<
    Parameters<typeof method_${i}_type['handler']>[0],
    Awaited<ReturnType<typeof method_${i}_type['handler']>>
>;`;
        })
        .join("\n");

    return `/* eslint-disable */
/**
* Auto generated file - DO NOT EDIT!
* # Helium Server Type Definitions    
**/
${imports}

declare module 'helium/server' {
${exports}
}
`;
}

export function generateEntryModule(): string {
    return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from 'helium/client';
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
