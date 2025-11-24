#!/usr/bin/env node
import { cac } from "cac";
import { spawn } from "child_process";
import { build as esbuild } from "esbuild";
import fs from "fs";
import path from "path";
import { build as viteBuild } from "vite";

import { log } from "../utils/logger.js";
import { scanServerExports } from "../vite/scanner.js";
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
    } catch (e) {
        log("error", "Client build failed:", e);
        process.exit(1);
    }

    log("info", "Building server...");
    // Generate server entry
    const serverExports = scanServerExports(root);
    const manifestCode = generateServerManifest(serverExports.methods, serverExports.httpHandlers, serverExports.middleware);

    // Create the main server module that will be imported after env is loaded
    const serverModuleCode = `
import { startProdServer } from 'helium/prod-server';
import { loadConfig } from 'helium/server';
${manifestCode}

export async function start() {
    const config = await loadConfig();

    startProdServer({
        config,
        registerHandlers: (registry, httpRouter) => {
            registerAll(registry);
            httpRouter.registerRoutes(httpHandlers);
            if (middlewareHandler) {
                registry.setMiddleware(middlewareHandler);
                httpRouter.setMiddleware(middlewareHandler);
            }
        }
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
import { loadEnvFiles, injectEnvToProcess, log } from 'helium/server';
const envRoot = process.cwd();
log('info', \`Loading .env files from: \${envRoot}\`);
const envVars = loadEnvFiles({ mode: 'production' });
injectEnvToProcess(envVars);
if (Object.keys(envVars).length > 0) {
    log('info', \`Loaded \${Object.keys(envVars).length} environment variable(s)\`);
} else {
    log('warn', 'No .env files found or no variables loaded');
}
`;

    const heliumDir = path.join(root, "node_modules", ".helium");
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
        const serverBuild = await esbuild({
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

    const server = spawn("node", [serverPath], { stdio: "inherit", shell: true });
    server.on("close", (code) => {
        process.exit(code || 0);
    });
});

cli.help();
cli.parse();
