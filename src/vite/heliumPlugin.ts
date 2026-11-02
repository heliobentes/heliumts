import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

import { clearConfigCache, getRpcClientConfig, getRpcConfig, loadConfig } from "../server/config.js";
import { attachToDevServer } from "../server/devServer.js";
import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
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
import { checkRouteCollisions, scanAppShell, scanPageRoutePatterns, scanServerExports, scanSSRPages } from "./scanner.js";
import { generateClientModule, generateEntryModule, generateServerManifest, generateTypeDefinitions } from "./virtualServerModule.js";

export default function helium(): Plugin {
    let root = process.cwd();
    const serverDir = normalizeToPosix(SERVER_DIR);
    const RESOLVED_VIRTUAL_SSR_SERVER_MODULE_ID = "\0heliumts:ssr-server";
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

                // Return with tags to inject the entry (runtime config is fetched by the client)
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

            // Load helium config to get client-side RPC transport settings
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
                    __HELIUM_RPC_TRANSPORT__: JSON.stringify(rpcClientConfig.transport),
                    __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__: JSON.stringify(rpcClientConfig.autoHttpOnMobile),
                    __HELIUM_RPC_TOKEN_VALIDITY_MS__: JSON.stringify(rpcClientConfig.tokenValidityMs),
                    __HELIUM_RPC_MAX_BATCH_SIZE__: JSON.stringify(getRpcConfig(heliumConfig).maxBatchSize),
                },
            };
        },
        resolveId(id, importer, options) {
            if (options?.ssr && id === "heliumts/client") {
                return RESOLVED_VIRTUAL_SSR_CLIENT_MODULE_ID;
            }
            if (options?.ssr && id === "heliumts/client/transitions") {
                return RESOLVED_VIRTUAL_SSR_TRANSITIONS_MODULE_ID;
            }
            if (options?.ssr && id === "heliumts/client/prefetch") {
                return RESOLVED_VIRTUAL_SSR_PREFETCH_MODULE_ID;
            }
            if (id === VIRTUAL_CLIENT_MODULE_ID) {
                if (importer === RESOLVED_VIRTUAL_SSR_SERVER_MODULE_ID || isServerModule(importer, root, serverDir) || /\.server\.[cm]?[jt]sx?(?:\?|$)/.test(importer || "")) {
                    return null;
                }
                return options?.ssr ? RESOLVED_VIRTUAL_SSR_SERVER_MODULE_ID : RESOLVED_VIRTUAL_CLIENT_MODULE_ID;
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
                throw new Error(`Server-only module cannot be imported by client code: ${id}. Import RPC method stubs from 'heliumts/server' instead.`);
            }
            // Prevent .server.ts/.server.js sidecar files from being bundled in client code.
            // These files contain server-only logic (e.g. DB queries) and must never run in the browser.
            if (!options?.ssr && /\.server\.(ts|js|tsx|jsx|mts|mjs)$/.test(id.split("?")[0])) {
                return { code: "export default null;", map: null };
            }
        },
        load(id) {
            if (id === RESOLVED_VIRTUAL_SSR_SERVER_MODULE_ID) {
                const { methods } = scanServerExports(root);
                return `export * from 'heliumts/server';\n${generateClientModule(methods)}`;
            }
            if (id === RESOLVED_VIRTUAL_SSR_CLIENT_MODULE_ID) {
                return generateSSRClientStubModule();
            }
            if (id === RESOLVED_VIRTUAL_SSR_TRANSITIONS_MODULE_ID) {
                return generateSSRTransitionsStubModule();
            }
            if (id === RESOLVED_VIRTUAL_SSR_PREFETCH_MODULE_ID) {
                return generateSSRPrefetchStubModule();
            }
            if (id === RESOLVED_VIRTUAL_CLIENT_MODULE_ID) {
                const { methods } = scanServerExports(root);
                return generateClientModule(methods);
            }
            if (id === RESOLVED_VIRTUAL_SERVER_MANIFEST_ID) {
                const { methods, httpHandlers, seoMetadata, middleware, workers } = scanServerExports(root);
                const pageRoutePatterns = scanPageRoutePatterns(root);
                const ssrPages = scanSSRPages(root);
                const appShell = scanAppShell(root);
                return generateServerManifest(methods, httpHandlers, seoMetadata, pageRoutePatterns, ssrPages, appShell, middleware, workers);
            }
            if (id === RESOLVED_VIRTUAL_ENTRY_MODULE_ID + ".tsx") {
                return generateEntryModule(scanAppShell(root));
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
            // Vite's SPA fallback runs after static/public assets and preserves request URLs.
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
                const ssrRpcModule = server.environments.ssr?.moduleGraph.getModuleById(RESOLVED_VIRTUAL_SSR_SERVER_MODULE_ID);

                if (clientModule) {
                    server.environments.client?.moduleGraph.invalidateModule(clientModule);
                }
                if (serverModule) {
                    server.environments.ssr?.moduleGraph.invalidateModule(serverModule);
                }

                if (ssrRpcModule) {
                    server.environments.ssr?.moduleGraph.invalidateModule(ssrRpcModule);
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
                            appShell
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

            const affectsManifest = (file: string): boolean => {
                const normalized = normalizeToPosix(path.relative(root, file));
                return (
                    normalized.startsWith(`${serverDir}/`) || normalized.startsWith("src/pages/") || /^src\/[Aa]pp\.[jt]sx?$/.test(normalized) || configFiles.includes(normalized)
                );
            };

            server.watcher.on("change", (file) => {
                if (affectsManifest(file)) {
                    debouncedHandleServerFileChange(true);
                }
            });

            server.watcher.on("add", (file) => {
                if (affectsManifest(file)) {
                    debouncedHandleServerFileChange();
                }
            });

            server.watcher.on("unlink", (file) => {
                if (affectsManifest(file)) {
                    debouncedHandleServerFileChange(true);
                }
            });

            server.httpServer?.once("close", () => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
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
                    const seoMetadataHandlers = mod.seoMetadataHandlers || [];
                    const pageRoutePatterns = mod.pageRoutePatterns || [];
                    const middlewareHandler = mod.middlewareHandler || null;
                    const workers = mod.workers || [];
                    const ssrPages = mod.ssrPages || [];
                    const appShell = mod.appShell || null;

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
                            appShell
                        );
                    }
                } catch (e) {
                    log("error", "Failed to attach Helium RPC server", e);
                }
            });
        },
    };
}

function generateSSRClientStubModule(): string {
    return `
import React from 'react';

export const RouterContext = React.createContext(null);

function getSSRRouterSnapshot() {
    const snapshot = globalThis.__HELIUM_SSR_ROUTER__;
    if (!snapshot || typeof snapshot !== 'object') {
        return {
            path: '/',
            params: {},
            search: '',
        };
    }

    return {
        path: typeof snapshot.path === 'string' ? snapshot.path : '/',
        params: snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : {},
        search: typeof snapshot.search === 'string' ? snapshot.search : '',
    };
}

export function useRouter() {
    const snapshot = getSSRRouterSnapshot();
    return {
        path: snapshot.path,
        params: snapshot.params,
        searchParams: new URLSearchParams(snapshot.search),
        push: () => {},
        replace: () => {},
        on: () => () => {},
        status: 200,
        isNavigating: false,
        isPending: false,
    };
}

export function Link(props) {
    const { href = '#', children, prefetch, ...rest } = props || {};
    return React.createElement('a', { href, ...rest }, children);
}

export function Redirect() {
    return null;
}

export function AppRouter() {
    return null;
}

export function useCall() {
    return {
        call: async () => null,
        isCalling: false,
        error: null,
    };
}

export function useFetch() {
    return {
        data: null,
        isLoading: false,
        error: null,
        refetch: async () => undefined,
    };
}

export class RpcError extends Error {}

export function getPublicEnv() {
    return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key.startsWith('HELIUM_PUBLIC_') && typeof value === 'string'));
}

export function getPublicEnvValue(key) {
    return getPublicEnv()[key];
}

export function isDevEnvironment() {
    return false;
}

export function getRpcTransport() {
    return 'websocket';
}

export function isAutoHttpOnMobileEnabled() {
    return false;
}

export function preconnect() {}

export function isSSR() {
    return true;
}
`;
}

function generateSSRTransitionsStubModule(): string {
    return `
import React from 'react';
import { useRouter } from 'heliumts/client';

export function useDeferredNavigation() {
    const { path } = useRouter();
    return {
        path,
        deferredPath: path,
        isStale: false,
        isPending: false,
        isTransitioning: false,
    };
}

export function PageTransition({ children, fallback = null }) {
    return React.createElement('div', { style: { opacity: 1, transition: 'opacity 150ms ease' } },
        React.createElement(React.Suspense, { fallback }, children));
}
`;
}

function generateSSRPrefetchStubModule(): string {
    return `
export function prefetchRoute() {}
export function clearPrefetchCache() {}
`;
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
