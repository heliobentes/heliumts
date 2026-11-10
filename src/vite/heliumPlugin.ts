import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

import { clearConfigCache, getRpcClientConfig, getRpcConfig, loadConfig } from "../server/config.js";
import { attachToDevServer } from "../server/devServer.js";
import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { log } from "../utils/logger.js";
import { RESOLVED_VIRTUAL_ENTRY_MODULE_ID, RESOLVED_VIRTUAL_SERVER_MANIFEST_ID, SERVER_DIR, VIRTUAL_ENTRY_MODULE_ID, VIRTUAL_SERVER_MANIFEST_ID } from "./paths.js";
import { RPC_MODULE_PATH, writeRpcModule } from "./rpcModule.js";
import { checkRouteCollisions, type PageManifestEntry, scanAppShell, scanPageManifest, scanPageRoutePatterns, scanServerExports, scanSSRPages } from "./scanner.js";
import { generateServerClientModule, generateServerPrefetchModule, generateServerTransitionsModule } from "./serverClientAdapter.js";
import { generateEntryModule, generatePageModules, generateServerManifest } from "./virtualServerModule.js";

export default function helium(): Plugin {
    let root = process.cwd();
    let pageManifest: PageManifestEntry[] | undefined;
    const getPageManifest = () => (pageManifest ??= scanPageManifest(root));
    const generateProjectRpc = () => writeRpcModule(root, scanServerExports(root).methods);
    const serverDir = normalizeToPosix(SERVER_DIR);
    const RESOLVED_PAGE_MODULES_ID = "\0heliumts:page-modules";
    const RESOLVED_VIRTUAL_SSR_CLIENT_MODULE_ID = "\0heliumts:ssr-client";
    const RESOLVED_VIRTUAL_SSR_TRANSITIONS_MODULE_ID = "\0heliumts:ssr-transitions";
    const RESOLVED_VIRTUAL_SSR_PREFETCH_MODULE_ID = "\0heliumts:ssr-prefetch";

    return {
        name: "vite-plugin-helium",
        enforce: "pre",
        configResolved(config) {
            root = config.root;
        },
        transformIndexHtml: {
            order: "pre",
            handler(html, _ctx) {
                // Check if HTML already has a script tag for entry
                if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*src\/main\.[jt]sx?(?:[?#][^"']*)?["']/i.test(html)) {
                    return html; // User has their own entry, don't modify
                }

                // Ensure root div exists
                let modifiedHtml = html;
                if (!/<[a-z][^>]*\sid\s*=\s*["']root["']/i.test(modifiedHtml)) {
                    modifiedHtml = modifiedHtml.replace(/<body\b[^>]*>/i, (body) => `${body}\n    <div id="root"></div>`);
                }

                // Generate physical entry file
                const heliumDir = path.join(root, "node_modules", ".heliumts");
                if (!fs.existsSync(heliumDir)) {
                    fs.mkdirSync(heliumDir, { recursive: true });
                }
                const entryPath = path.join(heliumDir, "entry.tsx");
                fs.writeFileSync(entryPath, generateEntryModule(scanAppShell(root)));

                // Return tags that inject the framework entry.
                return {
                    html: modifiedHtml,
                    tags: [
                        {
                            tag: "script",
                            attrs: {
                                type: "module",
                                src: "/node_modules/.heliumts/entry.tsx",
                            },
                            injectTo: "body",
                        },
                    ],
                };
            },
        },
        async config(config, env) {
            // configResolved runs after this hook; honor an explicit Vite root now.
            root = path.resolve(config.root || process.cwd());
            const mode = env.mode;
            const envVars = loadEnvFiles({ root, mode });

            // Inject env vars into process.env so server-side code can access them
            // consistently in both development and production.
            injectEnvToProcess(envVars);

            // Load the client token lifetime and HTTP batching limit.
            const heliumConfig = await loadConfig(root);
            const rpcClientConfig = getRpcClientConfig(heliumConfig);

            // Provide default index.html if none exists
            return {
                appType: config.appType ?? "spa",
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
                    __HELIUM_DEV__: JSON.stringify(env.command === "serve"),
                    __HELIUM_RPC_TOKEN_VALIDITY_MS__: JSON.stringify(rpcClientConfig.tokenValidityMs),
                    __HELIUM_RPC_MAX_BATCH_SIZE__: JSON.stringify(getRpcConfig(heliumConfig).maxBatchSize),
                },
            };
        },
        resolveId(id, importer, options) {
            if (!options?.ssr && id === "./pageModules.js" && importer && import.meta.url.startsWith("file:")) {
                const importerFile = importer.split("?")[0];
                if (fs.existsSync(importerFile)) {
                    const pluginDir = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
                    const routerManifest = normalizeToPosix(path.resolve(pluginDir, "../client/routerManifest"));
                    const importerPath = normalizeToPosix(fs.realpathSync(importerFile));
                    if (importerPath === `${routerManifest}.js` || importerPath === `${routerManifest}.ts`) {
                        return RESOLVED_PAGE_MODULES_ID;
                    }
                }
            }
            if (options?.ssr && id === "heliumts/client") {
                return RESOLVED_VIRTUAL_SSR_CLIENT_MODULE_ID;
            }
            if (options?.ssr && id === "heliumts/client/transitions") {
                return RESOLVED_VIRTUAL_SSR_TRANSITIONS_MODULE_ID;
            }
            if (options?.ssr && id === "heliumts/client/prefetch") {
                return RESOLVED_VIRTUAL_SSR_PREFETCH_MODULE_ID;
            }
            if (!options?.ssr && id === "heliumts/server") {
                throw new Error("heliumts/server is server-only. Import application RPC references from src/rpc.generated.ts.");
            }
            if (id === VIRTUAL_SERVER_MANIFEST_ID) {
                return RESOLVED_VIRTUAL_SERVER_MANIFEST_ID;
            }
            if (id === VIRTUAL_ENTRY_MODULE_ID) {
                // Add .tsx extension so Vite knows it contains JSX
                return RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx";
            }
            return null;
        },
        transform(code, id, options) {
            if (!options?.ssr && isServerModule(id, root, serverDir)) {
                throw new Error(`Server-only module cannot be imported by client code: ${id}. Import application RPC references from src/rpc.generated.ts instead.`);
            }
            // Prevent .server.ts/.server.js sidecar files from being bundled in client code.
            // These files contain server-only logic (e.g. DB queries) and must never run in the browser.
            if (!options?.ssr && /\.server\.(ts|js|tsx|jsx|mts|mjs)$/.test(id.split("?")[0])) {
                return { code: "export default null;", map: null };
            }
        },
        load(id) {
            if (id === RESOLVED_PAGE_MODULES_ID) {
                return generatePageModules(getPageManifest(), root);
            }
            if (id === RESOLVED_VIRTUAL_SSR_CLIENT_MODULE_ID) {
                return generateServerClientModule("ssr");
            }
            if (id === RESOLVED_VIRTUAL_SSR_TRANSITIONS_MODULE_ID) {
                return generateServerTransitionsModule("ssr");
            }
            if (id === RESOLVED_VIRTUAL_SSR_PREFETCH_MODULE_ID) {
                return generateServerPrefetchModule();
            }
            if (id === RESOLVED_VIRTUAL_SERVER_MANIFEST_ID) {
                const { methods, httpHandlers, seoMetadata, middleware, workers } = scanServerExports(root);
                const pages = getPageManifest();
                const pageRoutePatterns = scanPageRoutePatterns(root, pages);
                const ssrPages = scanSSRPages(root, pages);
                const appShell = scanAppShell(root);
                return generateServerManifest(methods, httpHandlers, seoMetadata, pageRoutePatterns, ssrPages, appShell, middleware, workers, pages);
            }
            if (id === RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx") {
                return generateEntryModule(scanAppShell(root));
            }
        },
        buildStart() {
            generateProjectRpc();

            // Check for route collisions in pages directory
            pageManifest = undefined;
            checkRouteCollisions(root, getPageManifest());
        },
        configureServer(server) {
            // Vite's SPA fallback runs after static/public assets and preserves request URLs.
            // Debounce timer for file changes
            let debounceTimer: ReturnType<typeof setTimeout> | null = null;
            const DEBOUNCE_DELAY = 300; // ms — long enough for format-on-save to finish

            const handleServerFileChange = async () => {
                try {
                    if (generateProjectRpc()) {
                        const generatedFile = normalizeToPosix(path.join(root, RPC_MODULE_PATH));
                        for (const environment of [server.environments.client, server.environments.ssr]) {
                            const graph = environment?.moduleGraph;
                            for (const module of graph?.getModulesByFile(generatedFile) ?? []) {
                                graph?.invalidateModule(module);
                            }
                        }
                    }
                } catch (error) {
                    log("error", "Failed to regenerate RPC imports", error);
                }

                // Invalidate the virtual modules so they get regenerated
                pageManifest = undefined;
                const clientPages = server.environments.client?.moduleGraph.getModuleById(RESOLVED_PAGE_MODULES_ID);
                const serverModule = server.environments.ssr?.moduleGraph.getModuleById(RESOLVED_VIRTUAL_SERVER_MANIFEST_ID);
                if (clientPages) {
                    server.environments.client?.moduleGraph.invalidateModule(clientPages);
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
                    const seoMetadataHandlers = mod.seoMetadataHandlers || [];
                    const pageRoutePatterns = mod.pageRoutePatterns || [];
                    const middlewareHandler = mod.middlewareHandler || null;
                    const workers = mod.workers || [];
                    const ssrPages = mod.ssrPages || [];
                    const appShell = mod.appShell || null;

                    // Update the dev server registry with new methods and HTTP handlers
                    if (server.httpServer) {
                        attachToDevServer(
                            server.httpServer,
                            (registry, httpRouter, seoRouter) => {
                                registerAll(registry);
                                httpRouter.registerRoutes(httpHandlers);
                                seoRouter.registerRoutes(seoMetadataHandlers);
                                seoRouter.setPageRoutePatterns(pageRoutePatterns);
                                if (middlewareHandler) {
                                    registry.setMiddleware(middlewareHandler);
                                    httpRouter.setMiddleware(middlewareHandler);
                                }
                            },
                            config,
                            workers,
                            ssrPages,
                            appShell,
                            mod.pageRoutes
                        );
                    }
                } catch (e) {
                    log("error", "Failed to reload Helium server manifest", e);
                }

                // Refresh the browser after the server manifest has reloaded.
                server.ws.send({
                    type: "full-reload",
                    path: "*",
                });
            };

            // Watch server and page directories: new SSR pages and sidecars change the manifest too.
            server.watcher.add([path.join(root, serverDir), path.join(root, "src", "pages")]);

            // Watch config files for changes
            const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];
            for (const configFile of configFiles) {
                const configPath = path.join(root, configFile);
                if (fs.existsSync(configPath)) {
                    server.watcher.add(configPath);
                }
            }

            const affectsManifest = (file: string): boolean => {
                const normalized = normalizeToPosix(path.relative(root, file));
                return (
                    normalized.startsWith(`${serverDir}/`) || normalized.startsWith("src/pages/") || /^src\/[Aa]pp\.[jt]sx?$/.test(normalized) || configFiles.includes(normalized)
                );
            };

            const refreshManifest = (file: string) => {
                if (!affectsManifest(file)) {
                    return;
                }
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    void handleServerFileChange();
                }, DEBOUNCE_DELAY);
            };
            server.watcher.on("change", refreshManifest);
            server.watcher.on("add", refreshManifest);
            server.watcher.on("unlink", refreshManifest);

            server.httpServer?.once("close", () => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
            });

            if (!server.httpServer) {
                // Middleware mode has no Vite-owned HTTP server to attach to.
                return;
            }

            const httpServer = server.httpServer;
            let initialized = false;
            let initialization: Promise<void> | undefined;
            const initialize = () => {
                initialization ??= (async () => {
                    const config = await loadConfig(root);
                    const mod = await server.ssrLoadModule(VIRTUAL_SERVER_MANIFEST_ID);
                    attachToDevServer(
                        httpServer,
                        (registry, httpRouter, seoRouter) => {
                            mod.registerAll(registry);
                            httpRouter.registerRoutes(mod.httpHandlers || []);
                            seoRouter.registerRoutes(mod.seoMetadataHandlers || []);
                            seoRouter.setPageRoutePatterns(mod.pageRoutePatterns || []);
                            if (mod.middlewareHandler) {
                                registry.setMiddleware(mod.middlewareHandler);
                                httpRouter.setMiddleware(mod.middlewareHandler);
                            }
                        },
                        config,
                        mod.workers || [],
                        mod.ssrPages || [],
                        mod.appShell || null,
                        mod.pageRoutes
                    );
                    initialized = true;
                })();
                return initialization;
            };

            // Vite initializes plugin containers and dependency optimizers as it
            // starts listening. Do not load the SSR manifest before that work.
            // Requests accepted during loading must wait without reading bodies.
            server.middlewares.use((req, res, next) => {
                if (initialized) {
                    next();
                    return;
                }
                void initialize().then(
                    () => {
                        if (!res.destroyed && !res.writableEnded) {
                            // The request entered Connect before Helium attached.
                            // Dispatch it through the newly installed HTTP handler.
                            // Its Connect fallback passes this gate immediately
                            // because initialized is now true.
                            httpServer.emit("request", req, res);
                        }
                    },
                    () => {
                        if (!res.destroyed && !res.writableEnded) {
                            res.writeHead(503, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
                            res.end("Helium server initialization failed");
                        }
                    }
                );
            });

            // Native callers can start httpServer directly; the shared promise
            // protects those requests too. Public Vite listen() must not resolve
            // and advertise readiness until registration has completed.
            httpServer.once("listening", () => {
                void initialize().catch((error) => log("error", "Failed to attach Helium RPC server", error));
            });
            const listen = server.listen.bind(server);
            server.listen = async (...args) => {
                const listeningServer = await listen(...args);
                await initialize();
                return listeningServer;
            };
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
