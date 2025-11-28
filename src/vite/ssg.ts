import fs from "fs";
import path from "path";

import { log } from "../utils/logger.js";
import { scanServerExports } from "./scanner.js";
import { generateClientModule } from "./virtualServerModule.js";

/**
 * SSG (Static Site Generation) implementation for Helium
 *
 * Scans pages directory for files with "use ssg"; directive and generates
 * static HTML for them at build time.
 */

interface SSGPage {
    filePath: string;
    urlPath: string;
    relativePath: string;
    warnings: string[];
}

interface SSGValidation {
    hasHooks: boolean;
    hasClientImports: boolean;
    hasServerImports: boolean;
    warnings: string[];
}

/**
 * Remove string literals from content to avoid false positives when checking for patterns
 * This removes template literals, single-quoted strings, and double-quoted strings
 */
function stripStringLiterals(content: string): string {
    // Remove template literals (backtick strings) - handle nested expressions
    let result = content;

    // Remove template literals with their content (simplified - doesn't handle all edge cases but good enough)
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, '""');

    // Remove double-quoted strings
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');

    // Remove single-quoted strings
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // Also remove JSX text content between tags (but not the tags themselves)
    // This helps with cases like <code>useState</code>
    result = result.replace(/>([^<]+)</g, "><");

    return result;
}

/**
 * Validate if a page file can be truly statically generated
 * Checks for React hooks and helium imports that would prevent static generation
 */
function validateSSGPage(filePath: string): SSGValidation {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const warnings: string[] = [];

    // Strip string literals and JSX text to avoid false positives
    const content = stripStringLiterals(rawContent);

    // Check for React hooks (common ones)
    const hookPatterns = [
        /\buse(State|Effect|Context|Reducer|Callback|Memo|Ref|ImperativeHandle|LayoutEffect|DebugValue)\s*\(/,
        /\buse[A-Z]\w+\s*\(/, // Custom hooks (useXxx) - must be followed by ( to be a call
    ];

    const hasHooks = hookPatterns.some((pattern) => pattern.test(content));
    if (hasHooks) {
        warnings.push("Page uses React hooks which may cause hydration issues");
    }

    // Check for helium/client imports - use raw content since imports should be at top level
    const hasClientImports = /^import\s+.*from\s+['"]helium\/client['"]/m.test(rawContent);
    if (hasClientImports) {
        warnings.push("Page imports from 'helium/client' which requires client-side execution");
    }

    // Check for helium/server imports - use raw content since imports should be at top level
    const hasServerImports = /^import\s+.*from\s+['"]helium\/server['"]/m.test(rawContent);
    if (hasServerImports) {
        warnings.push("Page imports from 'helium/server' which may cause runtime issues");
    }

    return {
        hasHooks,
        hasClientImports,
        hasServerImports,
        warnings,
    };
}

/**
 * Scan pages directory and find all pages with "use ssg" directive
 */
export function scanSSGPages(root: string): SSGPage[] {
    const pagesDir = path.join(root, "src", "pages");

    if (!fs.existsSync(pagesDir)) {
        return [];
    }

    const ssgPages: SSGPage[] = [];

    function walkDirectory(dir: string) {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walkDirectory(fullPath);
            } else if (/\.(tsx|jsx|ts|js)$/.test(item)) {
                const content = fs.readFileSync(fullPath, "utf-8");

                // Check for "use ssg"; directive at the top of the file
                if (/^\s*["']use ssg["']\s*;/m.test(content)) {
                    const relativePath = path.relative(path.join(root, "src"), fullPath);
                    const urlPath = filePathToUrlPath(relativePath);

                    // Validate the page for SSG compatibility
                    const validation = validateSSGPage(fullPath);
                    const warnings = [...validation.warnings];

                    // Also check all layouts for this page
                    const layoutPaths = findLayoutPathsForPage(fullPath, root);
                    for (const layoutPath of layoutPaths) {
                        const layoutValidation = validateSSGPage(layoutPath);
                        if (layoutValidation.warnings.length > 0) {
                            const layoutRelative = path.relative(path.join(root, "src"), layoutPath);
                            warnings.push(`Layout ${layoutRelative} has issues:`);
                            for (const warning of layoutValidation.warnings) {
                                warnings.push(`  └─ ${warning}`);
                            }
                        }
                    }

                    ssgPages.push({
                        filePath: fullPath,
                        urlPath,
                        relativePath,
                        warnings,
                    });
                }
            }
        }
    }

    walkDirectory(pagesDir);
    return ssgPages;
}

/**
 * Convert file path to URL path
 * pages/index.tsx -> /
 * pages/about.tsx -> /about
 * pages/blog/post.tsx -> /blog/post
 * pages/(website)/contact.tsx -> /contact
 * pages/(portal)/dashboard.tsx -> /dashboard
 */
function filePathToUrlPath(relativePath: string): string {
    // Remove 'pages/' prefix and file extension
    let urlPath = relativePath.replace(/^pages\//, "").replace(/\.(tsx|jsx|ts|js)$/, "");

    // Remove route groups (folders in parentheses)
    // E.g., (website)/contact -> /contact
    urlPath = urlPath.replace(/\([^)]+\)\//g, "");

    // Handle index files
    if (urlPath.endsWith("/index") || urlPath === "index") {
        urlPath = urlPath.replace(/\/index$/, "").replace(/^index$/, "");
    }

    // Ensure leading slash
    if (!urlPath.startsWith("/")) {
        urlPath = "/" + urlPath;
    }

    // Root path
    if (urlPath === "/") {
        return "/";
    }

    return urlPath;
}

/**
 * Convert URL path to output file path
 * / -> __index.html (special case - renamed later to prevent conflicts)
 * /about -> about.html
 * /blog/post -> blog/post.html
 */
function urlPathToOutputPath(urlPath: string): string {
    if (urlPath === "/") {
        return "__index.html";
    }

    // Remove leading slash and add .html extension
    const cleanPath = urlPath.replace(/^\//, "");
    return `${cleanPath}.html`;
}

/**
 * Find all layout file paths for a given page path (from root to leaf)
 */
function findLayoutPathsForPage(pagePath: string, root: string): string[] {
    const pagesDir = path.join(root, "src", "pages");
    const relativePath = path.relative(pagesDir, pagePath);
    const pathParts = path
        .dirname(relativePath)
        .split(path.sep)
        .filter((p) => p !== ".");

    const layoutPaths: string[] = [];

    // Check for _layout.tsx from root to leaf (maintains nesting order)
    // Start with root layout
    const rootLayoutPath = path.join(pagesDir, "_layout.tsx");
    if (fs.existsSync(rootLayoutPath)) {
        layoutPaths.push(rootLayoutPath);
    }

    // Then check nested layouts
    for (let i = 1; i <= pathParts.length; i++) {
        const dirPath = path.join(pagesDir, ...pathParts.slice(0, i));
        const layoutPath = path.join(dirPath, "_layout.tsx");

        if (fs.existsSync(layoutPath)) {
            layoutPaths.push(layoutPath);
        }
    }

    return layoutPaths;
}

/**
 * Find all layout components for a given page path (from root to leaf)
 * Note: Layouts cannot use routing features during SSG since they're pre-rendered
 */
async function findLayoutsForPage(pagePath: string, root: string, viteServer: any): Promise<any[]> {
    const layoutPaths = findLayoutPathsForPage(pagePath, root);
    const layouts = [];

    for (const layoutPath of layoutPaths) {
        try {
            const layoutModule = await viteServer.ssrLoadModule(layoutPath);
            if (layoutModule.default) {
                layouts.push(layoutModule.default);
            }
        } catch (error) {
            log("warn", `Could not load layout at ${layoutPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return layouts;
}

/**
 * Render a page component to static HTML using Vite SSR with timeout
 */
async function renderPageToHTML(page: SSGPage, root: string, htmlTemplate: string, viteServer: any, timeout: number = 10000): Promise<string> {
    // Create timeout promise
    const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Rendering timeout after ${timeout}ms - page may contain hooks or async operations`));
        }, timeout);
    });

    // Create render promise
    const renderPromise = (async () => {
        try {
            // Dynamically import React and ReactDOMServer
            const React = (await import("react")).default;
            const ReactDOMServer = await import("react-dom/server");

            // Use Vite's SSR loader to load the page component
            const pageModule = await viteServer.ssrLoadModule(page.filePath);
            const PageComponent = pageModule.default;

            if (!PageComponent) {
                throw new Error(`No default export found in ${page.relativePath}`);
            }

            // Find all layouts (from root to leaf)
            const layouts = await findLayoutsForPage(page.filePath, root, viteServer);

            // Build the component tree: layouts wrap the page, innermost to outermost
            let element: any = React.createElement(PageComponent);

            // Wrap with layouts from innermost to outermost (reverse order)
            for (let i = layouts.length - 1; i >= 0; i--) {
                element = React.createElement(layouts[i], { children: element } as any);
            }

            // Load RouterContext from our stub
            const heliumClient = await viteServer.ssrLoadModule("helium/client");
            const RouterContext = heliumClient.RouterContext;

            // Mock Router Context with the page's URL
            const routerValue = {
                path: page.urlPath,
                params: {},
                searchParams: new URLSearchParams(),
                push: () => {},
                replace: () => {},
                on: () => () => {},
                status: 200,
            };

            // Wrap with RouterContext
            if (RouterContext) {
                element = React.createElement(RouterContext.Provider, { value: routerValue }, element);
            }

            // Render to static HTML
            const markup = ReactDOMServer.renderToString(element);

            // Inject the markup into the HTML template with the SSG marker
            const finalHtml = htmlTemplate.replace(/<div\s+id="root"[^>]*>(.*?)<\/div>/s, `<div id="root" data-ssg-page="${page.urlPath}">${markup}</div>`);

            return finalHtml;
        } catch (error) {
            log("error", `Failed to render ${page.relativePath}:`, error);
            throw error; // Don't fallback, let the caller handle the error
        }
    })();

    // Race between timeout and render
    return Promise.race([renderPromise, timeoutPromise]);
}

/**
 * Generate static HTML files for all SSG pages
 */
export async function generateStaticPages(context: any, root: string, htmlTemplate: string, distDir: string) {
    // Scan for SSG pages
    const ssgPages = scanSSGPages(root);

    if (ssgPages.length === 0) {
        return;
    }

    log("info", `Generating ${ssgPages.length} static page(s) for SSG...`);

    // Check for dynamic routes (not supported yet)
    const dynamicPages = ssgPages.filter((p) => p.relativePath.includes("["));
    if (dynamicPages.length > 0) {
        log("warn", `Skipping ${dynamicPages.length} dynamic route(s) - not yet supported:\n` + dynamicPages.map((p) => `  - ${p.relativePath}`).join("\n"));
    }

    // Filter out dynamic routes
    const staticPages = ssgPages.filter((p) => !p.relativePath.includes("["));

    // Display warnings for pages that may not be truly static
    const pagesWithWarnings = staticPages.filter((p) => p.warnings.length > 0);
    if (pagesWithWarnings.length > 0) {
        log("warn", "");
        log("warn", "⚠️  SSG Warning: The following pages may not be fully static:");
        for (const page of pagesWithWarnings) {
            log("warn", `  ${page.relativePath}:`);
            for (const warning of page.warnings) {
                log("warn", `    - ${warning}`);
            }
        }
        log("warn", "  These pages will be pre-rendered but may require client-side hydration.");
        log("warn", "");
    }

    // Precompute RPC client stubs for SSG (mirrors helium Vite plugin)
    const { methods } = scanServerExports(root);
    const serverStubCode = `// Auto-generated SSG RPC stub\n${generateClientModule(methods)}\n`;

    // Create a stub for helium/client that provides mock Router and hooks
    const clientStubCode = `
// Auto-generated SSG client stub
import React from 'react';

// Mock RouterContext
export const RouterContext = React.createContext({
    path: '/',
    params: {},
    searchParams: new URLSearchParams(),
    push: () => {},
    replace: () => {},
    on: () => () => {},
    status: 200,
    isNavigating: false,
    isPending: false,
});

// Mock useRouter hook
export function useRouter() {
    const ctx = React.useContext(RouterContext);
    if (!ctx) {
        console.warn('useRouter called outside RouterContext during SSG');
        return {
            path: '/',
            params: {},
            searchParams: new URLSearchParams(),
            push: () => {},
            replace: () => {},
            on: () => () => {},
            status: 200,
            isNavigating: false,
            isPending: false,
        };
    }
    return ctx;
}

// Mock AppRouter component (alias for Router)
export function AppRouter({ children }) {
    return React.createElement(React.Fragment, null, children);
}

// Mock Router component
export function Router({ children }) {
    return React.createElement(React.Fragment, null, children);
}

// Mock Link component
export function Link({ href, children, prefetch, ...props }) {
    return React.createElement('a', { href, ...props }, children);
}

// Mock Redirect component
export function Redirect({ to, replace }) {
    return null;
}

// Mock useCall hook
export function useCall(serverFn) {
    return async (...args) => {
        console.warn('useCall called during SSG - this will not execute');
        return null;
    };
}

// Mock useFetch hook
export function useFetch(serverFn, ...args) {
    console.warn('useFetch called during SSG - returning null');
    return { data: null, loading: false, error: null, refetch: async () => {} };
}

// Re-export cache (mock)
export const cache = {
    get: () => null,
    set: () => {},
    delete: () => {},
    clear: () => {},
};

// Mock PageTransition and useDeferredNavigation (also available from helium/client/transitions)
export function useDeferredNavigation() {
    return {
        path: '/',
        deferredPath: '/',
        isStale: false,
        isPending: false,
        isTransitioning: false,
    };
}

export function PageTransition({ children, loadingClassName, loadingStyle, fallback }) {
    return React.createElement('div', null, children);
}
`;

    // Create a stub for helium/client/transitions
    const transitionsStubCode = `
// Auto-generated SSG transitions stub
import React from 'react';

// Mock useDeferredNavigation hook - returns static values for SSG
export function useDeferredNavigation() {
    return {
        path: '/',
        deferredPath: '/',
        isStale: false,
        isPending: false,
        isTransitioning: false,
    };
}

// Mock PageTransition component - renders children without transition logic
export function PageTransition({ children, loadingClassName, loadingStyle, fallback }) {
    // During SSG, just render the children without any transition logic
    return React.createElement('div', null, children);
}

export default {
    useDeferredNavigation,
    PageTransition,
};
`;

    // Create a stub for helium/client/prefetch
    const prefetchStubCode = `
// Auto-generated SSG prefetch stub
export function prefetchRoute() {
    // No-op during SSG
}

export function clearPrefetchCache() {
    // No-op during SSG
}
`;

    // Write stub files to node_modules/.helium
    const heliumInternalDir = path.join(root, "node_modules", ".helium");
    if (!fs.existsSync(heliumInternalDir)) {
        fs.mkdirSync(heliumInternalDir, { recursive: true });
    }
    const ssgServerStubPath = path.join(heliumInternalDir, "ssg-server-stub.mjs");
    const ssgClientStubPath = path.join(heliumInternalDir, "ssg-client-stub.mjs");
    const ssgTransitionsStubPath = path.join(heliumInternalDir, "ssg-transitions-stub.mjs");
    const ssgPrefetchStubPath = path.join(heliumInternalDir, "ssg-prefetch-stub.mjs");
    fs.writeFileSync(ssgServerStubPath, serverStubCode, "utf-8");
    fs.writeFileSync(ssgClientStubPath, clientStubCode, "utf-8");
    fs.writeFileSync(ssgTransitionsStubPath, transitionsStubCode, "utf-8");
    fs.writeFileSync(ssgPrefetchStubPath, prefetchStubCode, "utf-8");

    // Create a temporary Vite server for SSR rendering
    const { createServer } = await import("vite");
    const heliumPlugin = (await import("./heliumPlugin.js")).default;

    const viteServer = await createServer({
        root,
        server: { middlewareMode: true },
        appType: "custom",
        logLevel: "error",
        plugins: [heliumPlugin()],
        resolve: {
            alias: [
                // Most specific aliases first - helium/client/transitions and helium/client/prefetch
                { find: /^helium\/client\/transitions$/, replacement: ssgTransitionsStubPath },
                { find: /^helium\/client\/prefetch$/, replacement: ssgPrefetchStubPath },
                // Then helium/client and helium/server
                { find: /^helium\/client$/, replacement: ssgClientStubPath },
                { find: /^helium\/server$/, replacement: ssgServerStubPath },
            ],
        },
        ssr: {
            external: ["react", "react-dom"],
            // Don't externalize helium packages - we want to use our stubs
            noExternal: ["helium"],
        },
    });

    try {
        // Generate HTML for each static page
        const zlib = await import("zlib");
        let successCount = 0;
        let failureCount = 0;
        let hasIndexSSG = false;

        // Calculate max path length for proper alignment (min 35, max 80)
        const maxPathLength = Math.min(80, Math.max(35, ...staticPages.map((p) => urlPathToOutputPath(p.urlPath).length)));

        for (const page of staticPages) {
            try {
                // Render the page component to static HTML using Vite SSR with 10s timeout
                const html = await renderPageToHTML(page, root, htmlTemplate, viteServer, 10000);
                const outputPath = urlPathToOutputPath(page.urlPath);
                const fullOutputPath = path.join(distDir, outputPath);

                // Track if the root page (/) has SSG
                if (page.urlPath === "/") {
                    hasIndexSSG = true;
                }

                // Ensure directory exists
                const outputDir = path.dirname(fullOutputPath);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                // Write the HTML file
                fs.writeFileSync(fullOutputPath, html, "utf-8");

                // Calculate file size and gzipped size
                const size = Buffer.byteLength(html, "utf-8");
                const sizeKB = (size / 1024).toFixed(2);

                // Calculate gzipped size
                const gzipped = zlib.gzipSync(html);
                const gzipSizeKB = (gzipped.length / 1024).toFixed(2);

                log("info", `  ${outputPath.padEnd(maxPathLength)} ${sizeKB.padStart(8)} kB │ gzip: ${gzipSizeKB.padStart(7)} kB`);
                successCount++;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                if (errorMsg.includes("timeout")) {
                    log("error", `  ✗ ${page.relativePath} - ${errorMsg}`);
                } else {
                    log("error", `  ✗ ${page.relativePath} - Failed to generate:`, error);
                }

                // Write a fallback HTML file with empty root div (client will hydrate)
                const outputPath = urlPathToOutputPath(page.urlPath);
                const fullOutputPath = path.join(distDir, outputPath);
                const outputDir = path.dirname(fullOutputPath);

                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                const fallbackHtml = htmlTemplate.replace(/<div\s+id="root"[^>]*>.*?<\/div>/s, `<div id="root" data-ssg-failed="${page.urlPath}"></div>`);
                fs.writeFileSync(fullOutputPath, fallbackHtml, "utf-8");

                failureCount++;
            }
        }

        // If index page has SSG, we need to handle it specially:
        // 1. Rename __index.html to index.ssg.html (the SSG version)
        // 2. Create a clean blank index.html as fallback for non-root routes
        if (hasIndexSSG) {
            const tempIndexPath = path.join(distDir, "__index.html");
            const ssgIndexPath = path.join(distDir, "index.ssg.html");
            const indexPath = path.join(distDir, "index.html");

            // Move __index.html to index.ssg.html
            if (fs.existsSync(tempIndexPath)) {
                fs.renameSync(tempIndexPath, ssgIndexPath);
            }

            // Create a blank index.html as the SPA fallback
            const blankIndexHtml = htmlTemplate.replace(/<div\s+id="root"[^>]*>.*?<\/div>/s, '<div id="root"></div>');
            fs.writeFileSync(indexPath, blankIndexHtml, "utf-8");

            log("info", `  ${"index.ssg.html".padEnd(maxPathLength)} (SSG root page)`);
            log("info", `  ${"index.html".padEnd(maxPathLength)} (blank SPA fallback)`);
        }

        // Summary
        if (failureCount > 0) {
            log("warn", "");
            log("warn", `SSG completed with ${successCount} success(es) and ${failureCount} failure(s).`);
        }
    } finally {
        // Always close the Vite server, even if generation fails
        await viteServer.close();
    }
}
