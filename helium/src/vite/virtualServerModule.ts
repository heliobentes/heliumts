import path from 'path';

import { MethodExport } from './scanner.js';

export function generateServerManifest(methods: MethodExport[]): string {
    const imports = methods
        .map((m, i) => `import { ${m.name} as method_${i} } from '${m.filePath}';`)
        .join('\n');
    const registrations = methods
        .map((m, i) => `  registry.register('${m.name}', method_${i});`)
        .join('\n');

    return `
${imports}

export function registerAll(registry) {
${registrations}
}
`;
}

export function generateClientModule(methods: MethodExport[]): string {
    const exports = methods
        .map((m) => `export const ${m.name} = { __id: '${m.name}' };`)
        .join('\n');

    return exports;
}

export function generateTypeDefinitions(methods: MethodExport[], root: string): string {
    const imports = methods
        .map((m, i) => {
            let relPath = path.relative(path.join(root, 'src'), m.filePath);
            if (!relPath.startsWith('.')) relPath = './' + relPath;
            relPath = relPath.replace(/\.ts$/, '');
            return `import type { ${m.name} as method_${i}_type } from '${relPath}';`;
        })
        .join('\n');

    const exports = methods
        .map((m, i) => `export const ${m.name}: typeof method_${i}_type;`)
        .join('\n');

    return `/**
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
import ReactDOM from 'react-dom/client';
import { AppRouter } from 'helium/client';
import App from '/src/App';

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Root element not found. Helium requires a <div id="root"></div> in your HTML.');
}

ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
        <AppRouter AppShell={App} />
    </React.StrictMode>
);
`;
}
