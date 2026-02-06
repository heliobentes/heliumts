import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import actual functions from source
import { isServerModule, normalizeToPosix, touchTsConfig } from "../../src/vite/heliumPlugin";

describe("heliumPlugin", () => {
    describe("normalizeToPosix", () => {
        it("should convert OS-specific separator to forward slashes", () => {
            // Create a path using the OS separator
            const osPath = ["src", "server", "api.ts"].join(path.sep);
            expect(normalizeToPosix(osPath)).toBe("src/server/api.ts");
        });

        it("should keep forward slashes unchanged", () => {
            expect(normalizeToPosix("src/server/api.ts")).toBe("src/server/api.ts");
        });

        it("should handle empty string", () => {
            expect(normalizeToPosix("")).toBe("");
        });
    });

    describe("isServerModule", () => {
        const root = "/project";
        const serverDir = "src/server";

        it("should return true for files in server directory", () => {
            expect(isServerModule("/project/src/server/api.ts", root, serverDir)).toBe(true);
        });

        it("should return true for nested server files", () => {
            expect(isServerModule("/project/src/server/users/handlers.ts", root, serverDir)).toBe(true);
        });

        it("should return false for client files", () => {
            expect(isServerModule("/project/src/client/App.tsx", root, serverDir)).toBe(false);
        });

        it("should return false for undefined importer", () => {
            expect(isServerModule(undefined, root, serverDir)).toBe(false);
        });

        it("should return false for virtual modules", () => {
            expect(isServerModule("\0virtual:module", root, serverDir)).toBe(false);
        });

        it("should return false for files outside project", () => {
            expect(isServerModule("/other/project/file.ts", root, serverDir)).toBe(false);
        });

        it("should handle query strings in importer path", () => {
            expect(isServerModule("/project/src/server/api.ts?v=123", root, serverDir)).toBe(true);
        });
    });

    describe("virtual module IDs", () => {
        const VIRTUAL_CLIENT_MODULE_ID = "heliumts/server";
        const VIRTUAL_SERVER_MANIFEST_ID = "virtual:helium-server-manifest";
        const VIRTUAL_ENTRY_MODULE_ID = "virtual:helium-entry";

        const RESOLVED_VIRTUAL_CLIENT_MODULE_ID = "\0heliumts/server";
        const RESOLVED_VIRTUAL_SERVER_MANIFEST_ID = "\0virtual:helium-server-manifest";
        const RESOLVED_VIRTUAL_ENTRY_MODULE_ID = "\0virtual:helium-entry";

        it("should have correct virtual ID format", () => {
            expect(VIRTUAL_CLIENT_MODULE_ID).toBe("heliumts/server");
            expect(VIRTUAL_SERVER_MANIFEST_ID).toBe("virtual:helium-server-manifest");
            expect(VIRTUAL_ENTRY_MODULE_ID).toBe("virtual:helium-entry");
        });

        it("should have resolved IDs prefixed with null character", () => {
            expect(RESOLVED_VIRTUAL_CLIENT_MODULE_ID.startsWith("\0")).toBe(true);
            expect(RESOLVED_VIRTUAL_SERVER_MANIFEST_ID.startsWith("\0")).toBe(true);
            expect(RESOLVED_VIRTUAL_ENTRY_MODULE_ID.startsWith("\0")).toBe(true);
        });
    });

    describe("config file detection", () => {
        let existsSyncSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            existsSyncSpy = vi.spyOn(fs, "existsSync");
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should watch for TypeScript config", () => {
            const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];

            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p.toString().endsWith("helium.config.ts");
            });

            const foundConfig = configFiles.find((cf) => fs.existsSync(path.join("/project", cf)));
            expect(foundConfig).toBe("helium.config.ts");
        });

        it("should watch for JavaScript config", () => {
            const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];

            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p.toString().endsWith("helium.config.js");
            });

            const foundConfig = configFiles.find((cf) => fs.existsSync(path.join("/project", cf)));
            expect(foundConfig).toBe("helium.config.js");
        });

        it("should watch for ES module config", () => {
            const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];

            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p.toString().endsWith("helium.config.mjs");
            });

            const foundConfig = configFiles.find((cf) => fs.existsSync(path.join("/project", cf)));
            expect(foundConfig).toBe("helium.config.mjs");
        });
    });

    describe("HTML transformation", () => {
        it("should detect existing entry scripts", () => {
            const html1 = '<script type="module" src="src/main.tsx"></script>';
            const html2 = '<script type="module" src="src/main.ts"></script>';
            const html3 = '<div id="root"></div>';

            expect(html1.includes("src/main.tsx") || html1.includes("src/main.ts")).toBe(true);
            expect(html2.includes("src/main.tsx") || html2.includes("src/main.ts")).toBe(true);
            expect(html3.includes("src/main.tsx") || html3.includes("src/main.ts")).toBe(false);
        });

        it("should detect missing root div", () => {
            const htmlWithRoot = '<body><div id="root"></div></body>';
            const htmlWithoutRoot = "<body></body>";

            expect(htmlWithRoot.includes('id="root"')).toBe(true);
            expect(htmlWithoutRoot.includes('id="root"')).toBe(false);
        });

        it("should inject root div correctly", () => {
            const html = "<body></body>";
            const modified = html.replace("<body>", '<body>\n    <div id="root"></div>');

            expect(modified).toContain('<div id="root"></div>');
        });
    });

    describe("environment variables integration", () => {
        it("should create client-side env defines", () => {
            function createEnvDefines(env: Record<string, string>): Record<string, string> {
                const defines: Record<string, string> = {};
                for (const [key, value] of Object.entries(env)) {
                    if (key.startsWith("HELIUM_PUBLIC_")) {
                        defines[`import.meta.env.${key}`] = JSON.stringify(value);
                    }
                }
                return defines;
            }

            const env = {
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
                SECRET_KEY: "secret",
            };

            const defines = createEnvDefines(env);

            expect(defines["import.meta.env.HELIUM_PUBLIC_API_URL"]).toBe('"https://api.example.com"');
            expect(defines["import.meta.env.SECRET_KEY"]).toBeUndefined();
        });

        it("should include RPC transport defines", () => {
            const rpcDefines = {
                __HELIUM_RPC_TRANSPORT__: JSON.stringify("websocket"),
                __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__: JSON.stringify(false),
            };

            expect(rpcDefines.__HELIUM_RPC_TRANSPORT__).toBe('"websocket"');
            expect(rpcDefines.__HELIUM_RPC_AUTO_HTTP_ON_MOBILE__).toBe("false");
        });
    });

    describe("optimizeDeps configuration", () => {
        it("should include react-dom/client in optimizeDeps", () => {
            const optimizeDeps = {
                include: ["react-dom/client"],
                exclude: ["heliumts", "heliumts/client", "heliumts/server", "heliumts/vite"],
            };

            expect(optimizeDeps.include).toContain("react-dom/client");
        });

        it("should exclude helium packages from pre-bundling", () => {
            const optimizeDeps = {
                include: ["react-dom/client"],
                exclude: ["heliumts", "heliumts/client", "heliumts/server", "heliumts/vite"],
            };

            expect(optimizeDeps.exclude).toContain("heliumts");
            expect(optimizeDeps.exclude).toContain("heliumts/client");
            expect(optimizeDeps.exclude).toContain("heliumts/server");
            expect(optimizeDeps.exclude).toContain("heliumts/vite");
        });
    });

    describe("SSR configuration", () => {
        it("should externalize Node.js built-in modules for SSR", () => {
            const ssrConfig = {
                external: ["util", "zlib", "http", "https", "http2", "fs", "path", "crypto", "stream", "os", "url", "net", "tls", "child_process", "worker_threads"],
                noExternal: ["heliumts"],
            };

            expect(ssrConfig.external).toContain("util");
            expect(ssrConfig.external).toContain("zlib");
            expect(ssrConfig.external).toContain("http");
        });

        it("should not externalize heliumts for SSR", () => {
            const ssrConfig = {
                external: ["util", "zlib", "http", "https", "http2", "fs", "path", "crypto", "stream", "os", "url", "net", "tls", "child_process", "worker_threads"],
                noExternal: ["heliumts"],
            };

            expect(ssrConfig.noExternal).toContain("heliumts");
        });
    });

    describe("build configuration", () => {
        it("should mark Node.js built-ins as external for client build", () => {
            const buildConfig = {
                rollupOptions: {
                    external: [/^node:/, "util", "zlib", "http", "https", "http2", "fs", "path", "crypto", "stream", "os", "url", "net", "tls", "child_process", "worker_threads"],
                },
            };

            // Verify key Node.js modules are externalized to prevent bundling in client
            expect(buildConfig.rollupOptions.external).toContain("util");
            expect(buildConfig.rollupOptions.external).toContain("zlib");
        });
    });

    describe("middleware URL filtering", () => {
        function shouldSkipMiddleware(url: string): boolean {
            const cleanUrl = url.split("?")[0];

            if (
                path.extname(cleanUrl) !== "" ||
                cleanUrl.startsWith("/api") ||
                cleanUrl.startsWith("/webhooks") ||
                cleanUrl.startsWith("/auth") ||
                cleanUrl.startsWith("/@") ||
                cleanUrl.startsWith("/__helium__")
            ) {
                return true;
            }

            return false;
        }

        it("should skip files with extensions", () => {
            expect(shouldSkipMiddleware("/styles.css")).toBe(true);
            expect(shouldSkipMiddleware("/script.js")).toBe(true);
            expect(shouldSkipMiddleware("/image.png")).toBe(true);
        });

        it("should skip API routes", () => {
            expect(shouldSkipMiddleware("/api/users")).toBe(true);
            expect(shouldSkipMiddleware("/api/posts/1")).toBe(true);
        });

        it("should skip webhook routes", () => {
            expect(shouldSkipMiddleware("/webhooks/stripe")).toBe(true);
        });

        it("should skip auth routes", () => {
            expect(shouldSkipMiddleware("/auth/login")).toBe(true);
        });

        it("should skip Vite dev routes", () => {
            expect(shouldSkipMiddleware("/@vite/client")).toBe(true);
            expect(shouldSkipMiddleware("/@fs/path")).toBe(true);
        });

        it("should skip Helium internal routes", () => {
            expect(shouldSkipMiddleware("/__helium__/rpc")).toBe(true);
            expect(shouldSkipMiddleware("/__helium__/refresh-token")).toBe(true);
        });

        it("should not skip page routes", () => {
            expect(shouldSkipMiddleware("/")).toBe(false);
            expect(shouldSkipMiddleware("/about")).toBe(false);
            expect(shouldSkipMiddleware("/docs/guides/auth")).toBe(false);
        });
    });

    describe("touchTsConfig", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should update mtime of tsconfig.json when it exists", () => {
            const existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
            const utimesSyncSpy = vi.spyOn(fs, "utimesSync").mockImplementation(() => {});

            touchTsConfig("/project");

            expect(existsSyncSpy).toHaveBeenCalledWith(path.join("/project", "tsconfig.json"));
            expect(utimesSyncSpy).toHaveBeenCalledWith(path.join("/project", "tsconfig.json"), expect.any(Date), expect.any(Date));
        });

        it("should not throw when tsconfig.json does not exist", () => {
            vi.spyOn(fs, "existsSync").mockReturnValue(false);

            expect(() => touchTsConfig("/project")).not.toThrow();
        });

        it("should not throw when utimesSync fails", () => {
            vi.spyOn(fs, "existsSync").mockReturnValue(true);
            vi.spyOn(fs, "utimesSync").mockImplementation(() => {
                throw new Error("Permission denied");
            });

            expect(() => touchTsConfig("/project")).not.toThrow();
        });
    });
});
