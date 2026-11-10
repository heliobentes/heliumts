// @vitest-environment node
import { EventEmitter } from "events";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import React from "react";
import { renderToString } from "react-dom/server";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as configModule from "../../src/server/config";
import * as envModule from "../../src/utils/envLoader";
import helium from "../../src/vite/heliumPlugin";
import { scanPageManifest, scanPageRoutePatterns, scanPageRoutes, scanSSRPages } from "../../src/vite/scanner";
import { findLayoutPathsForPage, renderPageToHTML, scanSSGPages } from "../../src/vite/ssg";
import { generateEntryModule, generateServerManifest } from "../../src/vite/virtualServerModule";

function getHook(plugin: any, name: string): any {
    const hook = plugin[name];
    return typeof hook === "function" ? hook : hook.handler;
}

describe("Vite and static generation regressions", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-vite-review-"));
        fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("loads config and env from Vite's root and mode before configResolved", async () => {
        const loadConfig = vi.spyOn(configModule, "loadConfig").mockResolvedValue({ rpc: { maxBatchSize: 2, security: { tokenValidityMs: 45000 } } });
        const loadEnvFiles = vi.spyOn(envModule, "loadEnvFiles").mockReturnValue({});
        const plugin = helium();
        const result = await getHook(plugin, "config")({ root, appType: "custom" }, { mode: "staging", command: "build" });

        expect(loadConfig).toHaveBeenCalledWith(root);
        expect(loadEnvFiles).toHaveBeenCalledWith({ root, mode: "staging" });
        expect(result.appType).toBe("custom");
        expect(result.define.__HELIUM_DEV__).toBe("false");
        expect(result.define.__HELIUM_RPC_MAX_BATCH_SIZE__).toBe("2");
        expect(result.define.__HELIUM_RPC_TOKEN_VALIDITY_MS__).toBe("45000");
        expect(result.define).not.toHaveProperty("__HELIUM_RPC_TRANSPORT__");
        expect(result.define).not.toHaveProperty("__HELIUM_RPC_AUTO_HTTP_ON_MOBILE__");
    });

    it("returns the inserted root along with the generated entry script", () => {
        const plugin = helium();
        getHook(plugin, "configResolved")({ root });
        const result = getHook(plugin, "transformIndexHtml")('<html><body class="app"></body></html>');

        expect(result.html).toContain('<body class="app">\n    <div id="root"></div>');
        expect(result.tags).toEqual([expect.objectContaining({ tag: "script", attrs: expect.objectContaining({ type: "module" }) })]);
        const entry = fs.readFileSync(path.join(root, "node_modules", ".heliumts", "entry.tsx"), "utf8");
        expect(entry).toContain("<AppRouter />");
        expect(entry).not.toContain("import App");
    });

    it("preserves a single-quoted root and JavaScript user entry", () => {
        const plugin = helium();
        getHook(plugin, "configResolved")({ root });
        const html = "<body><div id='root'></div></body>";
        const result = getHook(plugin, "transformIndexHtml")(html);
        expect(result.html).toBe(html);
        const customEntry = '<body><script type="module" src="/src/main.jsx"></script></body>';
        expect(getHook(plugin, "transformIndexHtml")(customEntry)).toBe(customEntry);
    });

    it("uses actual server exports during SSR and stubs sidecars with Vite query suffixes on the client", () => {
        const plugin = helium();
        getHook(plugin, "configResolved")({ root });
        const resolveId = getHook(plugin, "resolveId");
        expect(resolveId("heliumts/server", `${root}/src/pages/about.server.ts`, { ssr: true })).toBeNull();
        expect(resolveId("heliumts/server", `${root}/src/pages/about.tsx`, { ssr: true })).toBeNull();
        expect(() => resolveId("heliumts/server", `${root}/src/pages/about.tsx`, {})).toThrow("src/rpc.generated.ts");
        const result = getHook(plugin, "transform")("export const secret = 'private';", `${root}/src/pages/about.server.ts?import`, {});
        expect(result.code).not.toContain("private");
        expect(() => getHook(plugin, "transform")("const token = 'private';", `${root}/src/server/secret.ts`, {})).toThrow("Server-only module");
        expect(getHook(plugin, "transform")("const token = 'private';", `${root}/src/server/secret.ts`, { ssr: true })).toBeUndefined();
    });

    it("loads browser RPC and streaming handlers during SSR without attempting server-side RPC", async () => {
        const plugin = helium();
        const id = getHook(plugin, "resolveId")("heliumts/client", undefined, { ssr: true });
        const code = getHook(plugin, "load")(id);
        const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
        const modulePath = path.join(root, "ssr-client.mjs");
        fs.writeFileSync(modulePath, code.replace("from 'react'", `from ${JSON.stringify(reactUrl)}`));
        const loaded = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
        const fetch = vi.spyOn(globalThis, "fetch");
        const html = renderToString(React.createElement("button", { onClick: () => loaded.callMethod({ __id: "echo" }, {}) }, "Call method"));

        expect(html).toContain("Call method");
        expect(fetch).not.toHaveBeenCalled();
        await expect(loaded.callMethod({ __id: "echo" }, {})).rejects.toThrow("only available in the browser");
        const stream = loaded.useStreaming({ __id: "streamText" });
        expect(stream).toEqual({
            chunks: [],
            text: "",
            isStreaming: false,
            error: null,
            stats: null,
            start: expect.any(Function),
            cancel: expect.any(Function),
            reset: expect.any(Function),
        });
        expect(renderToString(React.createElement("button", { onClick: () => stream.start({}) }, "Stream method"))).toContain("Stream method");
        await expect(stream.start({})).rejects.toThrow("useStreaming.start is only available in the browser");
        expect(() => {
            stream.cancel();
            stream.reset();
        }).not.toThrow();
        expect(loaded).not.toHaveProperty("getRpcTransport");
        expect(loaded).not.toHaveProperty("isAutoHttpOnMobileEnabled");
        expect(loaded).not.toHaveProperty("preconnect");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("refreshes the manifest when SSR pages, sidecars, or app shells change", async () => {
        vi.useFakeTimers();
        vi.spyOn(configModule, "loadConfig").mockResolvedValue({});
        const plugin = helium();
        getHook(plugin, "configResolved")({ root });
        const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
        const server = {
            watcher,
            httpServer: null,
            environments: {},
            ws: { send: vi.fn() },
            ssrLoadModule: vi.fn(async () => ({})),
        };
        getHook(plugin, "configureServer")(server);
        for (const [event, file] of [
            ["add", "src/pages/new.tsx"],
            ["change", "src/pages/new.server.ts"],
            ["unlink", "src/App.tsx"],
        ]) {
            watcher.emit(event, path.join(root, file));
            await vi.advanceTimersByTimeAsync(300);
        }
        expect(server.ssrLoadModule).toHaveBeenCalledTimes(3);
        expect(server.ws.send).toHaveBeenCalledTimes(3);
    });

    it("excludes server sidecars, app shells, layouts, and declarations across page scanners", () => {
        fs.writeFileSync(path.join(root, "src", "pages", "about.tsx"), '"use ssr";\nexport default function Page() {}');
        fs.writeFileSync(path.join(root, "src", "pages", "docs.tsx"), '"use ssg";\nexport default function Page() {}');
        for (const name of ["about.server.ts", "types.d.ts", "_layout.tsx", "_app.tsx"]) {
            fs.writeFileSync(path.join(root, "src", "pages", name), '"use ssr";\n"use ssg";\nexport default function Page() {}');
        }
        const manifest = scanPageManifest(root);
        expect(scanPageRoutePatterns(root, manifest)).toEqual(["/about", "/docs"]);
        expect(scanPageRoutes(root, manifest).totalRoutes).toBe(2);
        expect(scanSSRPages(root, manifest).map((page) => page.pathPattern)).toEqual(["/about"]);
        expect(scanSSGPages(root, manifest).map((page) => page.urlPath)).toEqual(["/docs"]);
    });

    it("loads manifests whose imports and route paths contain apostrophes", async () => {
        const modulePath = path.join(root, "author's-method.mjs");
        fs.writeFileSync(modulePath, "export const getName = { handler: () => 'works' }; export default function Page() {}");
        const manifest = generateServerManifest(
            [{ name: "getName", filePath: modulePath }],
            [],
            [],
            [],
            [{ pathPattern: "/author's-page", pageFilePath: modulePath, serverFilePath: null, layoutFilePaths: [] }],
            modulePath
        );
        const manifestPath = path.join(root, "manifest.mjs");
        fs.writeFileSync(manifestPath, manifest);
        const loaded = await import(/* @vite-ignore */ pathToFileURL(manifestPath).href);
        const registry = { register: vi.fn() };
        loaded.registerAll(registry);
        expect(registry.register).toHaveBeenCalledWith("getName", expect.objectContaining({ handler: expect.any(Function) }));
        expect(loaded.ssrPages[0].pathPattern).toBe("/author's-page");
        expect(await loaded.ssrPages[0].loadComponent()).toEqual(expect.any(Function));
        expect(await loaded.appShell()).toEqual(expect.any(Function));
    });

    it("selects supported app shell and JavaScript layout files", () => {
        const appShellPath = path.join(root, "src", "app.jsx");
        const layoutPath = path.join(root, "src", "pages", "_layout.jsx");
        fs.writeFileSync(layoutPath, "export default function Layout() {}");
        expect(findLayoutPathsForPage(path.join(root, "src", "pages", "about.tsx"), root)).toEqual([layoutPath]);
        expect(generateEntryModule(appShellPath)).toContain(`import App from '${appShellPath}';`);
    });

    it("renders SSG with app shell, page props, literal dollar text, and releases the timeout", async () => {
        vi.useFakeTimers();
        const pagePath = path.join(root, "src", "pages", "about.tsx");
        const appPath = path.join(root, "src", "App.tsx");
        fs.writeFileSync(appPath, "export default function App() {}");
        const Page = ({ searchParams, params }: any) => React.createElement("p", null, `${searchParams.size}:${Object.keys(params).length}:$&:$':$\``);
        const App = ({ Component }: any) => React.createElement("main", { "data-app": true }, React.createElement(Component));
        const viteServer = {
            ssrLoadModule: vi.fn(async (file: string) => {
                if (file === pagePath) {
                    return { default: Page };
                }
                if (file === appPath) {
                    return { default: App };
                }
                return { RouterContext: React.createContext(null) };
            }),
        };
        const html = await renderPageToHTML(
            { filePath: pagePath, relativePath: "pages/about.tsx", urlPath: '/about"quoted', warnings: [] },
            root,
            "<html><body><div class='container' id=root><div class='spinner'><div>Loading</div></div><p>Wait</p></div><footer>tail</footer></body></html>",
            viteServer
        );
        expect(html).toContain("<div class='container' id=root");
        expect(html).toContain('data-ssg-page="/about&quot;quoted"');
        expect(html).not.toContain("spinner");
        expect(html).not.toContain("Wait");
        expect(html).toContain('<main data-app="true"><p>0:0:$&amp;:$&#x27;:$`</p></main>');
        expect(html).toContain("<footer>tail</footer>");
        expect(vi.getTimerCount()).toBe(0);
    });
});
