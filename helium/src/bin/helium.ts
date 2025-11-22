#!/usr/bin/env node
import { cac } from "cac";
import { spawn } from "child_process";
import { build as esbuild } from "esbuild";
import fs from "fs";
import path from "path";

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
    log("info", "Building client...");
    const viteBuild = spawn("vite", ["build"], { stdio: "inherit", shell: true });

    await new Promise<void>((resolve, reject) => {
        viteBuild.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Vite build failed with code ${code}`));
            }
        });
    });

    log("info", "Building server...");
    // Generate server entry
    const serverExports = scanServerExports(root);
    const manifestCode = generateServerManifest(serverExports.methods, serverExports.httpHandlers, serverExports.middleware);

    const entryCode = `
import { startProdServer } from 'helium/prod-server';
import { loadConfig } from 'helium/server';
${manifestCode}

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
`;

    const heliumDir = path.join(root, "node_modules", ".helium");
    if (!fs.existsSync(heliumDir)) {
        fs.mkdirSync(heliumDir, { recursive: true });
    }
    const entryPath = path.join(heliumDir, "server-entry.ts");
    fs.writeFileSync(entryPath, entryCode);

    // Bundle with esbuild
    try {
        await esbuild({
            entryPoints: [entryPath],
            outfile: path.join(root, "dist", "server.js"),
            bundle: true,
            platform: "node",
            format: "esm",
            external: ["helium", "helium/*"], // Keep helium external
            target: "node18",
        });
        log("info", "Server build complete.");
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
