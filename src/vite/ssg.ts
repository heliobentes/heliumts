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

                    ssgPages.push({
                        filePath: fullPath,
                        urlPath,
                        relativePath,
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
 */
function filePathToUrlPath(relativePath: string): string {
    // Remove 'pages/' prefix and file extension
    let urlPath = relativePath.replace(/^pages\//, "").replace(/\.(tsx|jsx|ts|js)$/, "");

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
 * / -> index.html
 * /about -> about.html
 * /blog/post -> blog/post.html
 */
function urlPathToOutputPath(urlPath: string): string {
    if (urlPath === "/") {
        return "index.html";
    }

    // Remove leading slash and add .html extension
    const cleanPath = urlPath.replace(/^\//, "");
    return `${cleanPath}.html`;
}

/**
 * Find all layout components for a given page path (from root to leaf)
 * Note: Layouts cannot use routing features during SSG since they're pre-rendered
 */
async function findLayoutsForPage(pagePath: string, root: string, viteServer: any): Promise<any[]> {
    const pagesDir = path.join(root, "src", "pages");
    const relativePath = path.relative(pagesDir, pagePath);
    const pathParts = path
        .dirname(relativePath)
        .split(path.sep)
        .filter((p) => p !== ".");

    const layouts = [];

    // Check for _layout.tsx from root to leaf (maintains nesting order)
    // Start with root layout
    const rootLayoutPath = path.join(pagesDir, "_layout.tsx");
    if (fs.existsSync(rootLayoutPath)) {
        try {
            const layoutModule = await viteServer.ssrLoadModule(rootLayoutPath);
            if (layoutModule.default) {
                layouts.push(layoutModule.default);
            }
        } catch (error) {
            log("warn", `Could not load root layout: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Then check nested layouts
    for (let i = 1; i <= pathParts.length; i++) {
        const dirPath = path.join(pagesDir, ...pathParts.slice(0, i));
        const layoutPath = path.join(dirPath, "_layout.tsx");

        if (fs.existsSync(layoutPath)) {
            try {
                const layoutModule = await viteServer.ssrLoadModule(layoutPath);
                if (layoutModule.default) {
                    layouts.push(layoutModule.default);
                }
            } catch (error) {
                log("warn", `Could not load layout at ${layoutPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    return layouts;
}

/**
 * Render a page component to static HTML using Vite SSR
 */
async function renderPageToHTML(page: SSGPage, root: string, htmlTemplate: string, viteServer: any): Promise<string> {
    try {
        // Dynamically import React and ReactDOMServer
        const React = (await import("react")).default;
        const ReactDOMServer = await import("react-dom/server");

        // Load RouterContext from helium/client
        const { RouterContext } = await viteServer.ssrLoadModule("helium/client");

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

        // Mock Router Context
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
        const finalHtml = htmlTemplate.replace(/<div\s+id="root">(.*?)<\/div>/s, `<div id="root" data-ssg-page="${page.urlPath}">${markup}</div>`);

        return finalHtml;
    } catch (error) {
        log("error", `Failed to render ${page.relativePath}:`, error);
        // Fallback to empty div with marker if rendering fails
        return htmlTemplate.replace(/<div\s+id="root">(.*?)<\/div>/s, `<div id="root" data-ssg-page="${page.urlPath}">$1</div>`);
    }
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

    // Precompute RPC client stubs for SSG (mirrors helium Vite plugin)
    const { methods } = scanServerExports(root);
    const clientModuleCode = `// Auto-generated SSG RPC stub\n${generateClientModule(methods)}\n`;

    // Write stub file to node_modules/.helium
    const heliumInternalDir = path.join(root, "node_modules", ".helium");
    if (!fs.existsSync(heliumInternalDir)) {
        fs.mkdirSync(heliumInternalDir, { recursive: true });
    }
    const ssgStubPath = path.join(heliumInternalDir, "ssg-server-stub.mjs");
    fs.writeFileSync(ssgStubPath, clientModuleCode, "utf-8");

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
            alias: {
                "helium/server": ssgStubPath,
            },
        },
        ssr: {
            external: ["react", "react-dom"],
        },
    });

    try {
        // Generate HTML for each static page
        const zlib = await import("zlib");
        for (const page of staticPages) {
            try {
                // Render the page component to static HTML using Vite SSR
                const html = await renderPageToHTML(page, root, htmlTemplate, viteServer);
                const outputPath = urlPathToOutputPath(page.urlPath);
                const fullOutputPath = path.join(distDir, outputPath);

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

                log("info", `  ${outputPath.padEnd(35)} ${sizeKB.padStart(8)} kB │ gzip: ${gzipSizeKB.padStart(7)} kB`);
            } catch (error) {
                log("error", `Failed to generate ${page.urlPath}:`, error);
            }
        }
    } finally {
        // Always close the Vite server, even if generation fails
        await viteServer.close();
    }
}
