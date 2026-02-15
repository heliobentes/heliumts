import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

import { clearConfigCache, getRpcClientConfig, loadConfig } from "../server/config.js";
import { attachToDevServer } from "../server/devServer.js";
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
import { checkRouteCollisions, scanServerExports } from "./scanner.js";
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
            handler(html, _ctx) {
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
                const heliumDir = path.join(root, "node_modules", ".heliumts");
                if (!fs.existsSync(heliumDir)) {
                    fs.mkdirSync(heliumDir, { recursive: true });
                }
                const entryPath = path.join(heliumDir, "entry.tsx");
                fs.writeFileSync(entryPath, generateEntryModule());

                // Return with tags to inject the entry (runtime config is fetched by the client)
                return [
                    {
                        tag: "script",
                        attrs: {
                            type: "module",
                            src: "/node_modules/.heliumts/entry.tsx",
                        },
                        injectTo: "body",
                    },
                ];
            },
        },
        async config(config) {
            // Load environment variables before config is finalized
            const mode = config.mode || "development";
            const envVars = loadEnvFiles({ root, mode });

            // Create defines for client-side env variables
            const envDefines = createEnvDefines(envVars);

            // Load helium config to get client-side RPC transport settings
            const heliumConfig = await loadConfig(root);
            const rpcClientConfig = getRpcClientConfig(heliumConfig);

            // Provide default index.html if none exists
            return {
                appType: "spa",
                optimizeDeps: {
                    include: ["react-dom/client"],
                    // Exclude helium from pre-bundling since it's the framework itself
                    // This ensures changes to helium are picked up immediately
                    exclude: ["heliumts", "heliumts/client", "heliumts/server", "heliumts/vite"],
                },
                // SSR configuration to properly isolate server-only code
                ssr: {
                    // Externalize Node.js built-in modules - these should never be bundled
                    external: ["util", "zlib", "http", "https", "http2", "fs", "path", "crypto", "stream", "os", "url", "net", "tls", "child_process", "worker_threads"],
                    // Don't externalize heliumts - let the plugin handle the client/server split
                    noExternal: ["heliumts"],
                },
                // Ensure Node.js built-ins are not bundled for client
                build: {
                    rollupOptions: {
                        external: [
                            // Node.js built-in modules should never be in client bundle
                            /^node:/,
                            "util",
                            "zlib",
                            "http",
                            "https",
                            "http2",
                            "fs",
                            "path",
                            "crypto",
                            "stream",
                            "os",
                            "url",
                            "net",
                            "tls",
                            "child_process",
                            "worker_threads",
                        ],
                    },
                },
                define: {
                    ...envDefines,
                    __HELIUM_RPC_TRANSPORT__: JSON.stringify(rpcClientConfig.transport),
                    __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__: JSON.stringify(rpcClientConfig.autoHttpOnMobile),
                    __HELIUM_RPC_TOKEN_VALIDITY_MS__: JSON.stringify(rpcClientConfig.tokenValidityMs),
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
            // Intercept heliumts/server imports from client code
            if (id === "heliumts/server") {
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
                const { methods, httpHandlers, middleware, workers } = scanServerExports(root);
                return generateServerManifest(methods, httpHandlers, middleware, workers);
            }
            if (id === RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx") {
                return generateEntryModule();
            }
        },
        buildStart() {
            const { methods } = scanServerExports(root);
            const dts = generateTypeDefinitions(methods, root);
            const typesDir = path.join(root, "src", "types");
            const dtsPath = path.join(typesDir, "heliumts-server.d.ts");

            // Ensure src/types exists
            if (!fs.existsSync(typesDir)) {
                fs.mkdirSync(typesDir, { recursive: true });
            }

            // At build start we always allow writing the canonical set.
            // Only skip if content is identical to avoid needless TS invalidation.
            if (!fs.existsSync(dtsPath) || fs.readFileSync(dtsPath, "utf-8") !== dts) {
                fs.writeFileSync(dtsPath, dts);
                touchTsConfig(root);
            }

            // Check for route collisions in pages directory
            checkRouteCollisions(root);
        },
        configureServer(server) {
            // Add middleware to handle HTML fallback for nested routes
            // This ensures that routes like /docs/guides/auth properly serve index.html
            // so the client-side router can handle them
            server.middlewares.use((req, res, next) => {
                const url = req.url || "";
                const cleanUrl = url.split("?")[0];

                // Skip if:
                // - Has file extension (asset request)
                // - Is an API/special endpoint
                // - Is a dev server endpoint
                if (
                    path.extname(cleanUrl) !== "" ||
                    cleanUrl.startsWith("/api") ||
                    cleanUrl.startsWith("/webhooks") ||
                    cleanUrl.startsWith("/auth") ||
                    cleanUrl.startsWith("/@") ||
                    cleanUrl.startsWith("/__helium__")
                ) {
                    return next();
                }

                // For all other routes (including nested paths like /docs/guides/auth),
                // rewrite to index.html so Vite serves it and the client-side router handles routing
                req.url = "/index.html";
                next();
            });

            /**
             * Write type definitions only if content has changed.
             * This prevents unnecessary TypeScript recompilation.
             *
             * When `allowFewer` is false (default) the file will NOT be
             * overwritten if the new content has fewer method declarations
             * than the existing file — this guards against writing a
             * degraded .d.ts while the user's file is only partially saved.
             */
            const writeTypesIfChanged = (dts: string, allowFewer = false): boolean => {
                const typesDir = path.join(root, "src", "types");
                const dtsPath = path.join(typesDir, "heliumts-server.d.ts");

                if (!fs.existsSync(typesDir)) {
                    fs.mkdirSync(typesDir, { recursive: true });
                }

                // Check if file exists and content is the same
                if (fs.existsSync(dtsPath)) {
                    const existing = fs.readFileSync(dtsPath, "utf-8");
                    if (existing === dts) {
                        return false; // No change needed
                    }

                    // Guard: don't overwrite with fewer methods unless explicitly allowed
                    // (e.g. on unlink). This prevents losing types during partial saves.
                    if (!allowFewer) {
                        const countExports = (s: string) => (s.match(/export const \w+:/g) || []).length;
                        const existingCount = countExports(existing);
                        const newCount = countExports(dts);
                        if (newCount < existingCount) {
                            log("info", `Skipping type generation: found ${newCount} methods, existing has ${existingCount} (likely partial save)`);
                            return false;
                        }
                    }
                }

                fs.writeFileSync(dtsPath, dts);

                // Touch tsconfig.json to force the TypeScript language server
                // to reload the project. Without this, TS may cache stale
                // module augmentations and autocomplete won't reflect the
                // new methods until a manual restart.
                touchTsConfig(root);

                return true; // File was written
            };

            const regenerateTypes = (allowFewer = false): boolean => {
                try {
                    const { methods } = scanServerExports(root);
                    const dts = generateTypeDefinitions(methods, root);
                    return writeTypesIfChanged(dts, allowFewer);
                } catch (e) {
                    log("error", "Failed to regenerate types", e);
                    return false;
                }
            };

            // Debounce timer for file changes
            let debounceTimer: ReturnType<typeof setTimeout> | null = null;
            const DEBOUNCE_DELAY = 300; // ms — long enough for format-on-save to finish

            const handleServerFileChange = async (allowFewer = false) => {
                // Regenerate type definitions
                regenerateTypes(allowFewer);

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
                    const workers = mod.workers || [];

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
                            config,
                            workers
                        );
                    }
                } catch (e) {
                    log("error", "Failed to reload Helium server manifest", e);
                }

                // Trigger HMR for any client code that imports heliumts/server
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

            /**
             * Debounced handler for server file changes.
             * This prevents multiple rapid regenerations during file saves.
             * @param allowFewer - pass true when files are deleted, so the
             *                     method count is allowed to decrease.
             */
            let pendingAllowFewer = false;
            const debouncedHandleServerFileChange = (allowFewer = false) => {
                // If any event in the batch is an unlink, honour it
                if (allowFewer) {
                    pendingAllowFewer = true;
                }
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    const shouldAllowFewer = pendingAllowFewer;
                    pendingAllowFewer = false;
                    handleServerFileChange(shouldAllowFewer);
                }, DEBOUNCE_DELAY);
            };

            server.watcher.on("change", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file changed, regenerate everything
                if (normalized.startsWith(`${serverDir}/`)) {
                    debouncedHandleServerFileChange();
                }

                // If config file changed, reload config and regenerate
                if (configFiles.some((cf) => normalized === cf)) {
                    log("info", `Config file changed: ${normalized}`);
                    debouncedHandleServerFileChange();
                }
            });

            server.watcher.on("add", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file was added, regenerate everything
                if (normalized.startsWith(`${serverDir}/`)) {
                    debouncedHandleServerFileChange();
                }
            });

            server.watcher.on("unlink", (file) => {
                const relative = path.relative(root, file);
                const normalized = normalizeToPosix(relative);

                // If a server file was removed, regenerate (allow fewer methods)
                if (normalized.startsWith(`${serverDir}/`)) {
                    debouncedHandleServerFileChange(true);
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
                    const workers = mod.workers || [];

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
                            config,
                            workers
                        );
                    }
                } catch (e) {
                    log("error", "Failed to attach Helium RPC server", e);
                }
            });
        },
    };
}

/**
 * Convert file path to POSIX format
 * @internal Exported for testing
 */
export function normalizeToPosix(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

/**
 * Check if an importer is a server module
 * @internal Exported for testing
 */
export function isServerModule(importer: string | undefined, root: string, serverDir: string): boolean {
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

/**
 * Touch the project's tsconfig.json to force the TypeScript language server
 * to reload the project and pick up changed module augmentations.
 *
 * TS language server watches tsconfig.json for changes. When a `.d.ts` file
 * with `declare module` augmentations is regenerated, TS doesn't always
 * detect the new content — leading to stale autocomplete.  By updating
 * tsconfig.json's mtime we trigger a full project reload.
 *
 * The file content is NOT modified; only the filesystem timestamp changes.
 *
 * @internal Exported for testing
 */
export function touchTsConfig(root: string): void {
    const tsconfigPath = path.join(root, "tsconfig.json");
    try {
        if (fs.existsSync(tsconfigPath)) {
            const now = new Date();
            fs.utimesSync(tsconfigPath, now, now);
        }
    } catch {
        // Non-critical: if we can't touch the file, TS may just need a manual reload
    }
}
