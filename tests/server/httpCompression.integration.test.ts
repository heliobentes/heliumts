// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import { once } from "events";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { gunzip } from "zlib";

import type { HeliumCompressionConfig } from "../../src/server/config";
import { attachToDevServer } from "../../src/server/devServer";
import { startProdServer } from "../../src/server/prodServer";
import type { RpcRegistry } from "../../src/server/rpcRegistry";

let server: http.Server | undefined;
let fixture: string | undefined;

afterEach(async () => {
    if (server?.listening) {
        await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
    }
    if (fixture) {
        fs.rmSync(fixture, { recursive: true, force: true });
        fixture = undefined;
    }
});

const payload = Array.from({ length: 100 }, (_, index) => ({ id: index, description: "A dynamic RPC response with repeated data" }));

async function startServer(mode: string, compression?: HeliumCompressionConfig) {
    const register = (registry: RpcRegistry) => {
        registry.register("payload", { __kind: "method", __id: "payload", handler: () => payload });
    };
    const config = { rpc: { compression } };
    if (mode === "development") {
        server = http.createServer((_req, res) => {
            res.writeHead(404);
            res.end();
        });
        attachToDevServer(server, register, config);
        server.listen(0);
    } else {
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), "helium-compression-"));
        server = startProdServer({ port: 0, staticDir: fixture, registerHandlers: register, config });
    }
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const tokenResponse = await fetch(`${base}/__helium__/refresh-token`, { method: "POST", headers: { "X-Requested-With": "helium" } });
    const { token } = (await tokenResponse.json()) as { token: string };
    return { base, token };
}

it.each(["development", "production"])("round-trips a Brotli HTTP RPC response through the %s server", async (mode) => {
    const { base, token } = await startServer(mode);
    const result = await fetch(`${base}/__helium__/rpc`, {
        method: "POST",
        headers: { "X-Helium-Token": token, "Accept-Encoding": "br" },
        body: encode({ id: mode, method: "payload" }),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-encoding")).toBe("br");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(decode(new Uint8Array(await result.arrayBuffer()))).toMatchObject({ id: mode, ok: true, result: payload });
});

for (const mode of ["development", "production"]) {
    it.each([
        { enabled: false, threshold: 0, compressed: false },
        { enabled: true, threshold: 0, compressed: true },
        { enabled: true, threshold: 1_000_000, compressed: false },
    ])(`honors WebSocket compression in ${mode}: enabled=$enabled, threshold=$threshold`, async ({ enabled, threshold, compressed }) => {
        const { base, token } = await startServer(mode, { enabled, threshold });
        const socket = new WebSocket(`${base.replace("http:", "ws:")}/rpc`, token);
        await once(socket, "open");
        try {
            expect(socket.extensions.includes("permessage-deflate")).toBe(enabled);
            const response = once(socket, "message");
            socket.send(encode({ id: mode, method: "payload" }));
            const [body] = (await response) as [Buffer];
            expect(body[0] === 0x1f && body[1] === 0x8b).toBe(compressed);
            const decoded = decode(compressed ? await promisify(gunzip)(body) : body);
            expect(decoded).toMatchObject({ id: mode, ok: true, result: payload });
        } finally {
            socket.terminate();
            await once(socket, "close");
        }
    });
}
