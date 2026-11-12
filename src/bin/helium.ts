#!/usr/bin/env node
import { cac } from "cac";
import { type ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { replaceHtmlRootContents } from "../utils/html.js";
import { log } from "../utils/logger.js";
import { generateServerClientModule, generateServerPrefetchModule, generateServerTransitionsModule } from "../vite/serverClientAdapter.js";

const cli = cac("helium");
const root = process.cwd();

function monitorChild(child: ChildProcess) {
    const onInterrupt = () => child.kill("SIGINT");
    const onTerminate = () => child.kill("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    child.on("error", (error) => {
        log("error", "Failed to start child process:", error);
        process.exit(1);
    });
    child.on("close", (code, signal) => {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
        process.exit(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1));
    });
}

cli.command("typegen", "Generate RPC imports and validate the application manifest").action(async () => {
    try {
        const { typegenProject } = await import("./projectCommands.js");
        log("info", `Generated imports for ${typegenProject(root)} RPC method(s).`);
    } catch (error) {
        log("error", String(error));
        process.exitCode = 1;
    }
});

cli.command("check", "Generate RPC references, validate the manifest, and check TypeScript").action(async () => {
    try {
        const { checkProject } = await import("./projectCommands.js");
        checkProject(root);
        log("info", "Manifest and TypeScript checks passed.");
    } catch (error) {
        log("error", String(error));
        process.exitCode = 1;
    }
});

cli.command("api [symbol]", "Read or discover installed public API declarations without loading application modules")
    .option("--from <entry>", "Public entrypoint, such as client (default) or server")
    .option("--list", "List public symbol names instead of reading a declaration")
    .option("--match <fragment>", "Filter --list by a case-insensitive literal name fragment")
    .option("--json", "Pretty-print the declaration record")
    .action(async (symbol: string | undefined, options: { from?: unknown; json?: boolean; list?: unknown; match?: unknown }) => {
        try {
            if (options.list !== undefined && options.list !== true) {
                throw new Error("Specify --list only once, without a value.");
            }
            if (options.list && cli.args.length) {
                throw new Error("Choose either a symbol lookup or --list, not both.");
            }
            if (!options.list && options.match !== undefined) {
                throw new Error("--match requires --list.");
            }
            if (!options.list && cli.args.length !== 1) {
                throw new Error("api accepts exactly one public symbol name.");
            }
            const { inspectPublicApi, listPublicApi } = await import("./publicApi.js");
            const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
            const result = options.list ? listPublicApi(packageRoot, options.from, options.match) : inspectPublicApi(packageRoot, symbol, options.from);
            console.log(JSON.stringify(result, null, options.json ? 2 : 0));
        } catch (error) {
            log("error", String(error));
            process.exitCode = 1;
        }
    });

cli.command("inspect", "Inspect routes, rendering, RPC, and middleware without executing modules")
    .option("--json", "Print the machine-readable application manifest")
    .option("--route <pattern>", "Look up an exact route pattern")
    .option("--rpc <name>", "Look up an exact RPC method name")
    .action(async (options: { json?: boolean; route?: unknown; rpc?: unknown }) => {
        try {
            const { inspectEntry, inspectProject, inspectSelection } = await import("./projectCommands.js");
            const selection = inspectSelection(options);
            if (selection) {
                const entry = inspectEntry(root, selection.kind, selection.name);
                console.log(JSON.stringify(entry, null, options.json ? 2 : 0));
                return;
            }
            const manifest = inspectProject(root);
            if (options.json) {
                console.log(JSON.stringify(manifest, null, 2));
            } else {
                for (const route of manifest.routes) {
                    console.log(`${route.render.toUpperCase()} ${route.pattern} (${route.file})`);
                }
                for (const method of manifest.rpc) {
                    console.log(`RPC ${method.name} (${method.file})`);
                }
                console.log(`Middleware: ${manifest.middleware?.file ?? "none"}`);
                for (const collision of manifest.collisions) {
                    console.log(`Collision: ${collision.pattern}: ${collision.files.join(", ")}`);
                }
            }
            if (manifest.collisions.length) {
                process.exitCode = 1;
            }
        } catch (error) {
            log("error", String(error));
            process.exitCode = 1;
        }
    });

cli.command("dev", "Start development server").action(async () => {
    const vitePackage = fileURLToPath(import.meta.resolve("vite/package.json"));
    monitorChild(spawn(process.execPath, [path.join(path.dirname(vitePackage), "bin", "vite.js")], { stdio: "inherit" }));
});

cli.command("build", "Build for production").action(async () => {
    // Production start and CLI help do not need the compiler/build toolchain.
    const [vite, bundler, scanner, ssg, virtualModules, rpcModule] = await Promise.all([
        import("vite"),
        import("esbuild"),
        import("../vite/scanner.js"),
        import("../vite/ssg.js"),
        import("../vite/virtualServerModule.js"),
        import("../vite/rpcModule.js"),
    ]);
    const { build: viteBuild } = vite;
    const { build: esbuild } = bundler;
    const { scanAppShell, scanPageManifest, scanPageRoutePatterns, scanServerExports, scanSSRPages } = scanner;
    const { generateStaticPages } = ssg;
    const { generateServerManifest } = virtualModules;
    const { writeRpcModule } = rpcModule;
    const pages = scanPageManifest(root);

    // Generate RPC references before Vite reads application modules.
    const { methods } = scanServerExports(root);
    if (writeRpcModule(root, methods)) {
        log("info", `Generated imports for ${methods.length} RPC method(s)`);
    }

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
                htmlTemplate = replaceHtmlRootContents(htmlTemplate, "", { "data-ssg-page": null, "data-ssg-failed": null });

                await generateStaticPages(null, root, htmlTemplate, distDir, pages);
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
    const pageRoutePatterns = scanPageRoutePatterns(root, pages);
    const ssrPages = scanSSRPages(root, pages);
    const appShell = scanAppShell(root);
    const manifestCode = generateServerManifest(
        serverExports.methods,
        serverExports.httpHandlers,
        serverExports.seoMetadata,
        pageRoutePatterns,
        ssrPages,
        appShell,
        serverExports.middleware,
        serverExports.workers,
        pages
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
        pageRoutes,
        ssrPages,
        appShell,
        workers
    });
}
`;

    // Create the entry loader that loads env first, then imports the server module
    const entryCode = `
// Load environment variables FIRST, before any other imports
import './env-loader.js';
// Now import and start the server (this ensures handlers load after env)
const { start } = await import('./server-module.js');
await start();
`;

    const envLoaderCode = `
import { loadEnvFiles, injectEnvToProcess, log } from 'heliumts/internal';
import { fileURLToPath } from 'node:url';
process.env.HELIUM_CONFIG_DIR ??= fileURLToPath(new URL('.', import.meta.url));
process.env.NODE_ENV ??= 'production';
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
    const ssrClientStubPath = path.join(heliumDir, "ssr-client-stub.ts");
    const ssrTransitionsStubPath = path.join(heliumDir, "ssr-transitions-stub.ts");
    const ssrPrefetchStubPath = path.join(heliumDir, "ssr-prefetch-stub.ts");

    const ssrClientStubCode = generateServerClientModule("ssr");
    const ssrTransitionsStubCode = generateServerTransitionsModule("ssr");
    const ssrPrefetchStubCode = generateServerPrefetchModule();

    fs.writeFileSync(entryPath, entryCode);
    fs.writeFileSync(envLoaderPath, envLoaderCode);
    fs.writeFileSync(serverModuleSrcPath, serverModuleCode);
    fs.writeFileSync(ssrClientStubPath, ssrClientStubCode);
    fs.writeFileSync(ssrTransitionsStubPath, ssrTransitionsStubCode);
    fs.writeFileSync(ssrPrefetchStubPath, ssrPrefetchStubCode);

    // Bundle with esbuild
    try {
        await esbuild({
            entryPoints: [entryPath],
            outfile: path.join(root, "dist", "server.js"),
            bundle: true,
            platform: "node",
            format: "esm",
            jsx: "automatic",
            jsxImportSource: "react",
            plugins: [
                {
                    name: "helium-ssr-client-alias",
                    setup(build) {
                        build.onResolve({ filter: /^heliumts\/client$/ }, () => ({ path: ssrClientStubPath }));
                        build.onResolve({ filter: /^heliumts\/client\/transitions$/ }, () => ({ path: ssrTransitionsStubPath }));
                        build.onResolve({ filter: /^heliumts\/client\/prefetch$/ }, () => ({ path: ssrPrefetchStubPath }));
                    },
                },
            ],
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
                "esbuild",
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

        // Bundle config helpers so moving the config into dist preserves relative imports.
        const configFile = ["helium.config.js", "helium.config.mjs", "helium.config.ts"].map((name) => path.join(root, name)).find((candidate) => fs.existsSync(candidate));
        if (configFile) {
            await esbuild({
                entryPoints: [configFile],
                outfile: path.join(root, "dist", "helium.config.js"),
                bundle: true,
                packages: "external",
                platform: "node",
                format: "esm",
                target: "node20",
            });
            log("info", "Bundled Helium config to dist/helium.config.js");
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
    const server = spawn(process.execPath, [serverPath], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production", HELIUM_CONFIG_DIR: path.join(root, "dist") },
    });
    monitorChild(server);
});

cli.help();
cli.parse();
