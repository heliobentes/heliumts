#!/usr/bin/env node
import { cac } from "cac";
import { spawn } from "child_process";
import { build as esbuild } from "esbuild";
import fs from "fs";
import path from "path";
import { build as viteBuild } from "vite";

import { log } from "../utils/logger.js";
import { scanPageRoutePatterns, scanServerExports } from "../vite/scanner.js";
import { generateStaticPages } from "../vite/ssg.js";
import { generateServerManifest } from "../vite/virtualServerModule.js";

const cli = cac("helium");
const root = process.cwd();

cli.command("dev", "Start development server").action(async () => {
    const vite = spawn("vite", [], { stdio: "inherit", shell: true });
    vite.on("close", (code) => {
        process.exit(code || 0);
    });
});

cli.command("build", "Build for production").action(async () => {
    log("info", "--------------------------------");
    log("info", "Building client...");

    try {
        const result = await viteBuild({
            root,
            logLevel: "silent",
            build: {
                outDir: "dist",
            },
        });

        // Display build output
        if (result && "output" in result) {
            const outputs = result.output;
            const zlib = await import("zlib");

            for (const chunk of outputs) {
                if (chunk.type === "asset" || chunk.type === "chunk") {
                    const fileName = chunk.fileName;
                    const content = "code" in chunk ? chunk.code : chunk.source;
                    const size = Buffer.byteLength(content, "utf-8");
                    const sizeKB = (size / 1024).toFixed(2);

                    // Calculate gzipped size
                    const gzipped = zlib.gzipSync(content);
                    const gzipSizeKB = (gzipped.length / 1024).toFixed(2);

                    log("info", `  ${fileName.padEnd(35)} ${sizeKB.padStart(8)} kB │ gzip: ${gzipSizeKB.padStart(7)} kB`);
                }
            }
        }

        log("info", "Client build complete.");

        // Generate static pages for SSG
        log("info", "--------------------------------");
        try {
            // Read the generated index.html as a template for SSG
            const distDir = path.join(root, "dist");
            const htmlPath = path.join(distDir, "index.html");

            if (fs.existsSync(htmlPath)) {
                let htmlTemplate = fs.readFileSync(htmlPath, "utf-8");

                // Clean up the template for SSG:
                // 1. Remove the build-time HELIUM_CONNECTION_TOKEN (SSG pages don't need it)
                htmlTemplate = htmlTemplate.replace(/<script>window\.HELIUM_CONNECTION_TOKEN = "build-time-placeholder";<\/script>/g, "");

                // 2. Clear any existing content in root div from SPA build
                htmlTemplate = htmlTemplate.replace(/<div\s+id="root"[^>]*>.*?<\/div>/s, '<div id="root"></div>');

                await generateStaticPages(null, root, htmlTemplate, distDir);
            } else {
                log("warn", "index.html not found in dist, skipping SSG");
            }
        } catch (e) {
            log("warn", "SSG generation failed:", e);
            // Don't fail the build if SSG fails
        }
        log("info", "--------------------------------");
    } catch (e) {
        log("error", "Client build failed:", e);
        process.exit(1);
    }

    log("info", "Building server...");
    // Generate server entry
    const serverExports = scanServerExports(root);
    const pageRoutePatterns = scanPageRoutePatterns(root);
    const manifestCode = generateServerManifest(
        serverExports.methods,
        serverExports.httpHandlers,
        serverExports.seoMetadata,
        pageRoutePatterns,
        serverExports.middleware,
        serverExports.workers
    );

    // Create the main server module that will be imported after env is loaded
    const serverModuleCode = `
import { startProdServer, loadConfig } from 'heliumts/server';
${manifestCode}

export async function start() {
    const config = await loadConfig();

    startProdServer({
        config,
        registerHandlers: (registry, httpRouter, seoRouter) => {
            registerAll(registry);
            httpRouter.registerRoutes(httpHandlers);
            seoRouter.registerRoutes(seoMetadataHandlers);
            seoRouter.setPageRoutePatterns(pageRoutePatterns);
            if (middlewareHandler) {
                registry.setMiddleware(middlewareHandler);
                httpRouter.setMiddleware(middlewareHandler);
            }
        },
        workers
    });
}
`;

    // Create the entry loader that loads env first, then imports the server module
    const entryCode = `
// Load environment variables FIRST, before any other imports
import './env-loader.js';
// Now import and start the server (this ensures handlers load after env)
import { start } from './server-module.js';
await start();
`;

    const envLoaderCode = `
import { loadEnvFiles, injectEnvToProcess, log } from 'heliumts/server';
const envRoot = process.cwd();
log('info', \`Loading .env files from: \${envRoot}\`);
const envVars = loadEnvFiles({ mode: 'production' });
injectEnvToProcess(envVars);
if (Object.keys(envVars).length > 0) {
    log('info', \`Loaded \${Object.keys(envVars).length} environment variable(s) from .env files\`);
} else {
    log('info', 'No .env files found (using platform environment variables if available)');
}
`;

    const heliumDir = path.join(root, "node_modules", ".heliumts");
    if (!fs.existsSync(heliumDir)) {
        fs.mkdirSync(heliumDir, { recursive: true });
    }
    const entryPath = path.join(heliumDir, "server-entry.ts");
    const envLoaderPath = path.join(heliumDir, "env-loader.ts");
    const serverModuleSrcPath = path.join(heliumDir, "server-module.ts");

    fs.writeFileSync(entryPath, entryCode);
    fs.writeFileSync(envLoaderPath, envLoaderCode);
    fs.writeFileSync(serverModuleSrcPath, serverModuleCode);

    // Bundle with esbuild
    try {
        await esbuild({
            entryPoints: [entryPath],
            outfile: path.join(root, "dist", "server.js"),
            bundle: true,
            platform: "node",
            format: "esm",
            external: [
                // External common database and heavy dependencies
                "mongodb",
                "mongoose",
                "pg",
                "mysql",
                "mysql2",
                "sqlite3",
                "better-sqlite3",
                "redis",
                // Node.js built-ins are automatically external, but let's be explicit
                "crypto",
                "fs",
                "path",
                "http",
                "https",
                "stream",
                "zlib",
                "util",
            ],
            target: "node18",
            metafile: true,
            banner: {
                js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
            },
        });

        // Display server build output
        const serverOutputPath = path.relative(root, path.join(root, "dist", "server.js"));
        const serverStats = fs.statSync(path.join(root, "dist", "server.js"));
        const serverSizeKB = (serverStats.size / 1024).toFixed(2);
        log("info", `  ${serverOutputPath.padEnd(35)} ${serverSizeKB.padStart(8)} kB`);

        log("info", "Server build complete.");

        // Transpile helium.config.ts to helium.config.js if it exists
        const configTsPath = path.join(root, "helium.config.ts");
        if (fs.existsSync(configTsPath)) {
            log("info", "Transpiling helium.config.ts...");
            try {
                await esbuild({
                    entryPoints: [configTsPath],
                    outfile: path.join(root, "dist", "helium.config.js"),
                    bundle: false,
                    platform: "node",
                    format: "esm",
                    target: "node18",
                });
                log("info", "Config file transpiled to dist/helium.config.js");
            } catch (e) {
                log("warn", "Failed to transpile config file:", e);
                log("warn", "You may need to manually rename helium.config.ts to helium.config.js");
            }
        } else {
            // Check if .js or .mjs config exists and copy it to dist
            const configJsPath = path.join(root, "helium.config.js");
            const configMjsPath = path.join(root, "helium.config.mjs");

            if (fs.existsSync(configJsPath)) {
                fs.copyFileSync(configJsPath, path.join(root, "dist", "helium.config.js"));
                log("info", "Copied helium.config.js to dist/");
            } else if (fs.existsSync(configMjsPath)) {
                fs.copyFileSync(configMjsPath, path.join(root, "dist", "helium.config.mjs"));
                log("info", "Copied helium.config.mjs to dist/");
            }
        }

        log("info", "--------------------------------");
        log("info", "✓ Build finished successfully.");
        log("info", "▶ Run 'helium start' to start the production server.");

        // Exit cleanly after build completes
        process.exit(0);
    } catch (e) {
        log("error", "Server build failed:", e);
        process.exit(1);
    }
});

cli.command("start", "Start production server").action(async () => {
    const serverPath = path.join(root, "dist", "server.js");
    if (!fs.existsSync(serverPath)) {
        log("error", 'Server build not found. Run "helium build" first.');
        process.exit(1);
    }

    // When running in production, look for config in dist directory first
    // This allows the transpiled config to be found
    const server = spawn("node", [serverPath], {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, HELIUM_CONFIG_DIR: path.join(root, "dist") },
    });
    server.on("close", (code) => {
        process.exit(code || 0);
    });
});

cli.help();
cli.parse();
