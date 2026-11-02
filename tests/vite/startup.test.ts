// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { once } from "events";
import fs from "fs";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, getRpcSecurityConfig } from "../../src/server/config";
import { generateConnectionToken, initializeSecurity, resetSecurity } from "../../src/server/security";
import helium from "../../src/vite/heliumPlugin";
import { VIRTUAL_SERVER_MANIFEST_ID } from "../../src/vite/paths";

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

describe("Vite application startup", () => {
    let root: string;
    let server: ViteDevServer | undefined;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-startup-"));
        fs.mkdirSync(path.join(root, "src", "server"), { recursive: true });
        fs.symlinkSync(fileURLToPath(new URL("../../node_modules", import.meta.url)), path.join(root, "node_modules"), "junction");
        fs.writeFileSync(path.join(root, "index.html"), '<html><body>Ready application<script type="module" src="/src/main.tsx"></script></body></html>');
        fs.writeFileSync(path.join(root, "src", "main.tsx"), "console.log('ready');");
        fs.writeFileSync(
            path.join(root, "src", "server", "methods.ts"),
            "const defineMethod = (handler) => ({ __kind: 'method', handler }); export const echo = defineMethod((args) => args);"
        );
        resetSecurity();
        clearConfigCache();
        initializeSecurity(getRpcSecurityConfig());
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
        resetSecurity();
        clearConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
    });

    async function startDelayed() {
        const manifest = deferred();
        const loading = deferred();
        const loadManifest = vi.fn();
        const delay: Plugin = {
            name: "delay-helium-manifest",
            configureServer(vite) {
                const load = vite.ssrLoadModule.bind(vite);
                vite.ssrLoadModule = async (id, options) => {
                    if (id === VIRTUAL_SERVER_MANIFEST_ID) {
                        loadManifest();
                        loading.resolve();
                        await manifest.promise;
                    }
                    return load(id, options);
                };
            },
        };
        server = await createServer({
            root,
            configFile: false,
            logLevel: "silent",
            plugins: [helium(), delay],
            server: { port: 0, host: "127.0.0.1", watch: null },
            optimizeDeps: { noDiscovery: true },
        });
        const httpServer = server.httpServer!;
        const listening = once(httpServer, "listening");
        const ready = server.listen();
        await listening;
        await loading.promise;
        const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
        return { base, httpServer, ready, manifest, loadManifest };
    }

    it("waits for registration before reporting ready and preserves an early RPC body", async () => {
        const { base, httpServer, ready, manifest, loadManifest } = await startDelayed();
        let isReady = false;
        void ready.then(() => {
            isReady = true;
        });
        const args = { message: "early request", bytes: new Uint8Array(65_536).fill(7) };
        const incoming = once(httpServer, "request");
        let answered = false;
        const pending = fetch(`${base}/__helium__/rpc`, {
            method: "POST",
            headers: { "X-Helium-Token": generateConnectionToken(), "Content-Type": "application/msgpack" },
            body: encode({ id: 1, method: "echo", args }),
            signal: AbortSignal.timeout(10_000),
        }).then((response) => {
            answered = true;
            return response;
        });
        await incoming;
        expect(isReady).toBe(false);
        expect(answered).toBe(false);
        manifest.resolve();
        expect(await ready).toBe(server);
        expect(loadManifest).toHaveBeenCalledOnce();
        const response = await pending;
        expect(response.headers.get("content-type")).not.toContain("text/html");
        expect(decode(new Uint8Array(await response.arrayBuffer()))).toMatchObject({ id: 1, ok: true, result: args });
        // Ordinary requests still reach Vite without gate/redispatch recursion.
        const html = await fetch(base);
        expect(html.status).toBe(200);
        expect(await html.text()).toContain("Ready application");
    }, 15_000);

    it("rejects readiness and gives queued requests an HTTP error when initialization fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { base, httpServer, ready, manifest } = await startDelayed();
        const failure = ready.catch((error) => error);
        const incoming = once(httpServer, "request");
        const pending = fetch(`${base}/__helium__/rpc`, { method: "POST", body: encode({ id: 1, method: "echo" }), signal: AbortSignal.timeout(10_000) });
        await incoming;
        manifest.reject(new Error("private import failure"));
        expect(await failure).toMatchObject({ message: "private import failure" });
        const response = await pending;
        expect(response.status).toBe(503);
        expect(await response.text()).toBe("Helium server initialization failed");
    }, 15_000);

    it("does not redispatch a queued request after its client disconnects", async () => {
        const { base, httpServer, ready, manifest } = await startDelayed();
        const emit = vi.spyOn(httpServer, "emit");
        const incoming = once(httpServer, "request");
        const controller = new AbortController();
        const pending = fetch(`${base}/__helium__/rpc`, {
            method: "POST",
            headers: { "X-Helium-Token": generateConnectionToken() },
            body: encode({ id: 1, method: "echo", args: "cancelled" }),
            signal: controller.signal,
        }).catch((error) => error);
        const [request, response] = await incoming;
        const closed = once(response, "close");
        controller.abort();
        expect((await pending).name).toBe("AbortError");
        await closed;
        manifest.resolve();
        await ready;
        expect(emit.mock.calls.filter(([event, req]) => event === "request" && req === request)).toHaveLength(1);
    }, 15_000);
});
