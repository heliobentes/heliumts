import fs from "fs";
import path from "path";

import { pathFromPageFile } from "../runtime/pageRoutes.js";
import { replaceHtmlRootContents } from "../utils/html.js";
import { log } from "../utils/logger.js";
import { findLayoutPathsForPage, type PageManifestEntry, scanAppShell, scanPageManifest } from "./scanner.js";
import { generateServerClientModule, generateServerPrefetchModule, generateServerTransitionsModule } from "./serverClientAdapter.js";

export { findLayoutPathsForPage };

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
    layouts?: readonly string[];
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
 * @internal Exported for testing
 */
export function stripStringLiterals(content: string): string {
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
 * @internal Exported for testing
 */
export function validateSSGPage(filePath: string): SSGValidation {
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

    // Check for heliumts/client imports - use raw content since imports should be at top level
    const hasClientImports = /^import\s+.*from\s+['"]heliumts\/client['"]/m.test(rawContent);
    if (hasClientImports) {
        warnings.push("Page imports from 'heliumts/client' which requires client-side execution");
    }

    // Check for heliumts/server imports - use raw content since imports should be at top level
    const hasServerImports = /^import\s+.*from\s+['"]heliumts\/server['"]/m.test(rawContent);
    if (hasServerImports) {
        warnings.push("Page imports from 'heliumts/server' which may cause runtime issues");
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
export function scanSSGPages(root: string, manifest: readonly PageManifestEntry[] = scanPageManifest(root)): SSGPage[] {
    const srcDir = path.join(root, "src");
    return manifest
        .filter((route) => route.render === "ssg")
        .map(({ file, pattern, layouts }) => {
            const { warnings } = validateSSGPage(file);
            for (const layout of layouts) {
                const layoutWarnings = validateSSGPage(layout).warnings;
                if (layoutWarnings.length) {
                    warnings.push(`Layout ${path.relative(srcDir, layout)} has issues:`);
                    warnings.push(...layoutWarnings.map((warning) => `  └─ ${warning}`));
                }
            }
            return {
                filePath: file,
                urlPath: pattern === "__404__" ? "/404" : pattern,
                relativePath: path.relative(srcDir, file),
                warnings,
                layouts,
            };
        });
}

/**
 * Convert file path to URL path
 * pages/index.tsx -> /
 * pages/about.tsx -> /about
 * pages/blog/post.tsx -> /blog/post
 * pages/(website)/contact.tsx -> /contact
 * pages/(portal)/dashboard.tsx -> /dashboard
 * @internal Exported for testing
 */
export function filePathToUrlPath(relativePath: string): string {
    const pattern = pathFromPageFile(relativePath.replace(/\\/g, "/").replace(/^pages\//, ""));
    return pattern === "__404__" ? "/404" : pattern;
}

/**
 * Convert URL path to output file path
 * / -> __index.html (special case - renamed later to prevent conflicts)
 * /about -> about.html
 * /blog/post -> blog/post.html
 * @internal Exported for testing
 */
export function urlPathToOutputPath(urlPath: string): string {
    if (urlPath === "/") {
        return "__index.html";
    }

    // Remove leading slash and add .html extension
    const cleanPath = urlPath.replace(/^\//, "");
    return `${cleanPath}.html`;
}

/**
 * Find all layout components for a given page path (from root to leaf)
 * Note: Layouts cannot use routing features during SSG since they're pre-rendered
 */
async function loadLayouts(layoutPaths: readonly string[], viteServer: any): Promise<any[]> {
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
export async function renderPageToHTML(page: SSGPage, root: string, htmlTemplate: string, viteServer: any, timeout: number = 10000): Promise<string> {
    // Create timeout promise
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<string>((_, reject) => {
        timeoutId = setTimeout(() => {
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
            const layouts = await loadLayouts(page.layouts ?? findLayoutPathsForPage(page.filePath, root), viteServer);

            // Build the component tree: layouts wrap the page, innermost to outermost
            const pageProps = { params: {}, searchParams: new URLSearchParams() };
            const WrappedPage = () => {
                let content: any = React.createElement(PageComponent, pageProps);
                for (let i = layouts.length - 1; i >= 0; i--) {
                    content = React.createElement(layouts[i], { children: content });
                }
                return content;
            };
            const appShellPath = scanAppShell(root);
            const appShellModule = appShellPath ? await viteServer.ssrLoadModule(appShellPath) : null;
            const AppShell = appShellModule ? (appShellModule.default ?? appShellModule.App ?? appShellModule.app) : null;
            let element: any = AppShell
                ? React.createElement(AppShell, { Component: WrappedPage, pageProps, children: React.createElement(WrappedPage) })
                : React.createElement(WrappedPage);

            // Load RouterContext from our stub
            const heliumClient = await viteServer.ssrLoadModule("heliumts/client");
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
            const finalHtml = replaceHtmlRootContents(htmlTemplate, markup, { "data-ssg-page": page.urlPath, "data-ssg-failed": null });

            return finalHtml;
        } catch (error) {
            log("error", `Failed to render ${page.relativePath}:`, error);
            throw error; // Don't fallback, let the caller handle the error
        }
    })();

    // Race between timeout and render
    try {
        return await Promise.race([renderPromise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId!);
    }
}

/**
 * Generate static HTML files for all SSG pages
 */
export async function generateStaticPages(context: any, root: string, htmlTemplate: string, distDir: string, manifest?: readonly PageManifestEntry[]) {
    // Scan for SSG pages
    const ssgPages = scanSSGPages(root, manifest);

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

    const clientStubCode = generateServerClientModule("ssg");
    const transitionsStubCode = generateServerTransitionsModule("ssg");
    const prefetchStubCode = generateServerPrefetchModule();

    // Write stub files to node_modules/.heliumts
    const heliumInternalDir = path.join(root, "node_modules", ".heliumts");
    if (!fs.existsSync(heliumInternalDir)) {
        fs.mkdirSync(heliumInternalDir, { recursive: true });
    }
    const ssgClientStubPath = path.join(heliumInternalDir, "ssg-client-stub.mjs");
    const ssgTransitionsStubPath = path.join(heliumInternalDir, "ssg-transitions-stub.mjs");
    const ssgPrefetchStubPath = path.join(heliumInternalDir, "ssg-prefetch-stub.mjs");
    fs.writeFileSync(ssgClientStubPath, clientStubCode, "utf-8");
    fs.writeFileSync(ssgTransitionsStubPath, transitionsStubCode, "utf-8");
    fs.writeFileSync(ssgPrefetchStubPath, prefetchStubCode, "utf-8");

    // Create a temporary Vite server for SSR rendering
    const { createServer } = await import("vite");
    const heliumPlugin = (await import("./heliumPlugin.js")).default;

    const viteServer = await createServer({
        root,
        mode: "production",
        server: { middlewareMode: true },
        appType: "custom",
        logLevel: "error",
        plugins: [heliumPlugin()],
        resolve: {
            alias: [
                // Most specific aliases first - heliumts/client/transitions and heliumts/client/prefetch
                { find: /^heliumts\/client\/transitions$/, replacement: ssgTransitionsStubPath },
                { find: /^heliumts\/client\/prefetch$/, replacement: ssgPrefetchStubPath },
                { find: /^heliumts\/client$/, replacement: ssgClientStubPath },
            ],
        },
        ssr: {
            external: ["react", "react-dom"],
            // Don't externalize heliumts packages - we want to use our stubs
            noExternal: ["heliumts"],
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

                const fallbackHtml = replaceHtmlRootContents(htmlTemplate, "", { "data-ssg-page": null, "data-ssg-failed": page.urlPath });
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
            const blankIndexHtml = replaceHtmlRootContents(htmlTemplate, "", { "data-ssg-page": null, "data-ssg-failed": null });
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
