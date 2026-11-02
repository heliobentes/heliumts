// @vitest-environment node
import { encode, decode } from "@msgpack/msgpack";
import { once } from "events";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startProdServer } from "../../src/server/prodServer";

let server: http.Server;
let fixture: string;
let baseUrl: string;

beforeEach(async () => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "helium-transport-"));
    const staticDir = path.join(fixture, "dist");
    fs.mkdirSync(staticDir);
    fs.writeFileSync(path.join(staticDir, "index.html"), '<html><head></head><body><div id="root"></div></body></html>');
    fs.writeFileSync(path.join(staticDir, "hello world.txt"), "hello world");
    fs.writeFileSync(path.join(staticDir, "app.mjs"), "export default 1");
    fs.writeFileSync(path.join(fixture, "outside.txt"), "private");
    fs.symlinkSync(path.join(fixture, "outside.txt"), path.join(staticDir, "escape.txt"));
    fs.writeFileSync(path.join(staticDir, "server.js"), "private server code");
    fs.mkdirSync(path.join(staticDir, "api"));
    server = startProdServer({
        port: 0,
        staticDir,
        config: { rpc: { security: { maxRequestsPerWindow: 1 } } },
        registerHandlers(registry, httpRouter) {
            registry.register("echo", { __kind: "method", __id: "echo", handler: async (args) => args });
            httpRouter.registerRoutes([
                { name: "customOptions", handler: { __kind: "http", method: "OPTIONS", path: "/api/custom", handler: () => new Response("custom-options") } },
            ]);
        },
        ssrPages: [{ pathPattern: "/search", loadComponent: async () => () => null, loadLayouts: async () => [], getServerSideProps: async (req) => ({ query: req.query }) }],
    });
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
    if (server?.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    fs.rmSync(fixture, { recursive: true, force: true });
    vi.restoreAllMocks();
});

async function token() {
    const res = await fetch(`${baseUrl}/__helium__/refresh-token?fresh=1`, { method: "POST", headers: { "X-Requested-With": "helium" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    return (await res.json()).token as string;
}

describe("production request handling", () => {
    it("serves percent-encoded assets and module MIME types", async () => {
        expect(await (await fetch(`${baseUrl}/hello%20world.txt`)).text()).toBe("hello world");
        expect((await fetch(`${baseUrl}/app.mjs`)).headers.get("content-type")).toBe("application/javascript");
    });

    it("blocks symlinks outside the static root and encoded server files", async () => {
        expect((await fetch(`${baseUrl}/escape.txt`)).status).toBe(404);
        const res = await fetch(`${baseUrl}/%73erver.js`);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("private server code");
    });

    it("returns 404 for a directory and 400 for malformed URL escapes", async () => {
        expect((await fetch(`${baseUrl}/api`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/bad%zz`)).status).toBe(400);
    });

    it("uses no-store on HTML and returns no body for HEAD", async () => {
        expect((await fetch(baseUrl)).headers.get("cache-control")).toBe("no-store");
        expect(await (await fetch(baseUrl, { method: "HEAD" })).text()).toBe("");
        expect((await fetch(baseUrl, { method: "DELETE" })).status).toBe(405);
    });

    it("passes the target query to SSR props on client navigation", async () => {
        const res = await fetch(`${baseUrl}/__helium__/page-props?path=${encodeURIComponent("/search?q=helium")}`);
        expect(await res.json()).toEqual({ ssr: true, props: { query: { q: "helium" } } });
    });

    it("responds to HTTP RPC and enforces per-IP windows", async () => {
        const auth = await token();
        const call = async (id: number) => {
            const res = await fetch(`${baseUrl}/__helium__/rpc?transport=http`, {
                method: "POST",
                headers: { "X-Helium-Token": auth },
                body: encode({ id, method: "echo", args: "hello" }),
            });
            return decode(new Uint8Array(await res.arrayBuffer())) as any;
        };
        expect(await call(1)).toMatchObject({ id: 1, ok: true, result: "hello" });
        expect(await call(2)).toMatchObject({ id: 2, ok: false, error: "Rate limit exceeded" });
    });

    it("removes shutdown signal listeners when the server closes", async () => {
        const before = process.listenerCount("SIGTERM");
        await new Promise<void>((resolve) => server.close(() => resolve()));
        expect(process.listenerCount("SIGTERM")).toBe(before - 1);
    });
});

it("lets custom OPTIONS handlers run before CORS preflight fallback", async () => {
    expect(await (await fetch(`${baseUrl}/api/custom`, { method: "OPTIONS" })).text()).toBe("custom-options");
    expect((await fetch(`${baseUrl}/other`, { method: "OPTIONS" })).status).toBe(204);
});

it("preserves the original Vite listener across HTTP handler reloads", async () => {
    const { attachToDevServer } = await import("../../src/server/devServer");
    const viteHandler = vi.fn((_req, res) => res.end("original-vite"));
    const dev = http.createServer(viteHandler);
    attachToDevServer(dev, () => undefined);
    attachToDevServer(dev, () => undefined);
    dev.listen(0);
    await once(dev, "listening");
    try {
        const port = (dev.address() as { port: number }).port;
        expect(await (await fetch(`http://127.0.0.1:${port}/asset`, { headers: { Accept: "text/plain" } })).text()).toBe("original-vite");
        expect(viteHandler).toHaveBeenCalledTimes(1);
    } finally {
        await new Promise<void>((resolve) => dev.close(() => resolve()));
    }
});
