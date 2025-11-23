import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

import { clearConfigCache, loadConfig } from "../server/config.js";
import { attachToDevServer } from "../server/devServer.js";
import { generateConnectionToken } from "../server/security.js";
import { createEnvDefines, injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { log } from "../utils/logger.js";
import {
    RESOLVED_VIRTUAL_CLIENT_MODULE_ID,
    RESOLVED_VIRTUAL_ENTRY_MODULE_ID,
    RESOLVED_VIRTUAL_SERVER_MANIFEST_ID,
    SERVER_DIR,
    VIRTUAL_CLIENT_MODULE_ID,
    VIRTUAL_ENTRY_MODULE_ID,
    VIRTUAL_SERVER_MANIFEST_ID,
} from "./paths.js";
import { scanServerExports } from "./scanner.js";
import { generateClientModule, generateEntryModule, generateServerManifest, generateTypeDefinitions } from "./virtualServerModule.js";

export default function helium(): Plugin {
    let root = process.cwd();
    const serverDir = normalizeToPosix(SERVER_DIR);

    return {
        name: "vite-plugin-helium",
        enforce: "pre",
        configResolved(config) {
            root = config.root;

            // Load and inject environment variables
            const mode = config.mode || "development";
            const envVars = loadEnvFiles({ root, mode });
            injectEnvToProcess(envVars);
        },
        transformIndexHtml: {
            order: "pre",
            handler(html, ctx) {
                // Check if HTML already has a script tag for entry
                if (html.includes("src/main.tsx") || html.includes("src/main.ts")) {
                    return html; // User has their own entry, don't modify
                }

                // Ensure root div exists
                let modifiedHtml = html;
                if (!modifiedHtml.includes('id="root"')) {
                    modifiedHtml = modifiedHtml.replace("<body>", '<body>\n    <div id="root"></div>');
                }

                // Generate physical entry file
                const heliumDir = path.join(root, "node_modules", ".helium");
                if (!fs.existsSync(heliumDir)) {
                    fs.mkdirSync(heliumDir, { recursive: true });
                }
                const entryPath = path.join(heliumDir, "entry.tsx");
                fs.writeFileSync(entryPath, generateEntryModule());

                // Generate connection token (only in dev mode, not during build)
                const isDev = ctx.server !== undefined;
                const token = isDev ? generateConnectionToken() : "build-time-placeholder";

                // Return with tags to inject the entry
                return [
                    {
                        tag: "script",
                        children: `window.HELIUM_CONNECTION_TOKEN = "${token}";`,
                        injectTo: "head",
                    },
                    {
                        tag: "script",
                        attrs: {
                            type: "module",
                            src: "/node_modules/.helium/entry.tsx",
                        },
                        injectTo: "body",
                    },
                ];
            },
        },
        config(config) {
            // Load environment variables before config is finalized
            const mode = config.mode || "development";
            const envVars = loadEnvFiles({ root, mode });

            // Create defines for client-side env variables
            const envDefines = createEnvDefines(envVars);

            // Provide default index.html if none exists
            return {
                appType: "spa",
                optimizeDeps: {
                    include: ["react-dom/client"],
                },
                define: {
                    ...envDefines,
                },
            };
        },
        resolveId(id, importer) {
            if (id === VIRTUAL_CLIENT_MODULE_ID) {
                if (isServerModule(importer, root, serverDir)) {
                    return null;
                }
                return RESOLVED_VIRTUAL_CLIENT_MODULE_ID;
            }
            if (id === VIRTUAL_SERVER_MANIFEST_ID) {
                return RESOLVED_VIRTUAL_SERVER_MANIFEST_ID;
            }
            if (id === VIRTUAL_ENTRY_MODULE_ID) {
                // Add .tsx extension so Vite knows it contains JSX
                return RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx";
            }
            // Intercept helium/server imports from client code
            if (id === "helium/server") {
                // If imported from server code, let it resolve normally
                if (isServerModule(importer, root, serverDir)) {
                    return null;
                }
                // For client code, redirect to virtual client module
                return RESOLVED_VIRTUAL_CLIENT_MODULE_ID;
            }
            return null;
        },
        load(id) {
            if (id === RESOLVED_VIRTUAL_CLIENT_MODULE_ID) {
                const { methods } = scanServerExports(root);
                return generateClientModule(methods);
            }
            if (id === RESOLVED_VIRTUAL_SERVER_MANIFEST_ID) {
                const { methods, httpHandlers, middleware } = scanServerExports(root);
                return generateServerManifest(methods, httpHandlers, middleware);
            }
            if (id === RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx") {
                return generateEntryModule();
            }
        },
        transform(code, id) {
            // Strip "use ssg"; directive from page files to avoid Rollup warnings
            if (id.includes("/pages/") && /\.(tsx?|jsx?)$/.test(id)) {
                if (/^\s*["']use ssg["']\s*;/m.test(code)) {
                    return {
                        code: code.replace(/^\s*["']use ssg["']\s*;?\s*/m, ""),
                        map: null,
                    };
                }
            }
            return null;
        },
        buildStart() {
            const { methods } = scanServerExports(root);
            const dts = generateTypeDefinitions(methods, root);
            const dtsPath = path.join(root, "src", "helium-server.d.ts");
            // Ensure src exists
            if (!fs.existsSync(path.join(root, "src"))) {
                fs.mkdirSync(path.join(root, "src"));
            }
            fs.writeFileSync(dtsPath, dts);
        },
        async closeBundle() {
            // SSG will be handled by the CLI after the build completes
            // This is just a placeholder to keep the hook structure
        },
        configureServer(server) {
            const regenerateTypes = () => {
                const { methods } = scanServerExports(root);
                const dts = generateTypeDefinitions(methods, root);
                const dtsPath = path.join(root, "src", "helium-server.d.ts");
                fs.writeFileSync(dtsPath, dts);
            };

            const handleServerFileChange = async () => {
                // Regenerate type definitions
                regenerateTypes();

                // Invalidate the virtual modules so they get regenerated
                const clientModule = server.environments.client?.moduleGraph.getModuleById(RESOLVED_VIRTUAL_CLIENT_MODULE_ID);
                const serverModule = server.environments.ssr?.moduleGraph.getModuleById(RESOLVED_VIRTUAL_SERVER_MANIFEST_ID);

                if (clientModule) {
                    server.environments.client?.moduleGraph.invalidateModule(clientModule);
                }
                if (serverModule) {
                    server.environments.ssr?.moduleGraph.invalidateModule(serverModule);
                }

                // Reload the server manifest and re-register methods
                try {
                    // Clear config cache to ensure fresh config is loaded
                    clearConfigCache();
                    const config = await loadConfig(root);
                    const mod = await server.ssrLoadModule(VIRTUAL_SERVER_MANIFEST_ID);
                    const registerAll = mod.registerAll;
                    const httpHandlers = mod.httpHandlers || [];
                    const middlewareHandler = mod.middlewareHandler || null;

                    // Update the dev server registry with new methods and HTTP handlers
                    if (server.httpServer) {
                        attachToDevServer(
                            server.httpServer,
                            (registry, httpRouter) => {
                                registerAll(registry);
                                httpRouter.registerRoutes(httpHandlers);
                                if (middlewareHandler) {
                                    registry.setMiddleware(middlewareHandler);
                                    httpRouter.setMiddleware(middlewareHandler);
                                }
                            },
                            config
                        );
                    }
                } catch (e) {
                    log("error", "Failed to reload Helium server manifest", e);
                }

                // Trigger HMR for any client code that imports helium/server
                server.ws.send({
                    type: "full-reload",
                    path: "*",
                });
            };

            // Watch server directory for changes
            const serverPath = path.join(root, serverDir);
            server.watcher.add(serverPath);

            // Watch config files for changes
            const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];
            for (const configFile of configFiles) {
                const configPath = path.join(root, configFile);
                if (fs.existsSync(configPath)) {
                    server.watcher.add(configPath);
                }
            }

            server.watcher.on("change", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file changed, regenerate everything
                if (normalized.startsWith(`${serverDir}/`)) {
                    handleServerFileChange();
                }

                // If config file changed, reload config and regenerate
                if (configFiles.some((cf) => normalized === cf)) {
                    log("info", `Config file changed: ${normalized}`);
                    handleServerFileChange();
                }
            });

            server.watcher.on("add", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file was added, regenerate everything
                if (normalized.startsWith(`${serverDir}/`)) {
                    handleServerFileChange();
                }
            });

            server.watcher.on("unlink", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file was removed, regenerate everything
                if (normalized.startsWith(`${serverDir}/`)) {
                    handleServerFileChange();
                }
            });

            // We hook into the server start to attach our RPC server
            server.httpServer?.on("listening", async () => {
                try {
                    // Load config
                    const config = await loadConfig(root);

                    // Load the manifest using Vite's SSR loader
                    // This allows us to load TS files directly and handle dependencies
                    const mod = await server.ssrLoadModule(VIRTUAL_SERVER_MANIFEST_ID);
                    const registerAll = mod.registerAll;
                    const httpHandlers = mod.httpHandlers || [];
                    const middlewareHandler = mod.middlewareHandler || null;

                    if (server.httpServer) {
                        attachToDevServer(
                            server.httpServer,
                            (registry, httpRouter) => {
                                registerAll(registry);
                                httpRouter.registerRoutes(httpHandlers);
                                if (middlewareHandler) {
                                    registry.setMiddleware(middlewareHandler);
                                    httpRouter.setMiddleware(middlewareHandler);
                                }
                            },
                            config
                        );
                    }
                } catch (e) {
                    log("error", "Failed to attach Helium RPC server", e);
                }
            });
        },
    };
}

function normalizeToPosix(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

function isServerModule(importer: string | undefined, root: string, serverDir: string): boolean {
    if (!importer || importer.startsWith("\0")) {
        return false;
    }

    const [importerPath] = importer.split("?");
    if (!importerPath) {
        return false;
    }

    const relative = path.relative(root, importerPath);
    if (!relative || relative.startsWith("..")) {
        return false;
    }

    const normalized = normalizeToPosix(relative);
    return normalized === serverDir || normalized.startsWith(`${serverDir}/`);
}
