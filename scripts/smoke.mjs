import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decode, encode } from "@msgpack/msgpack";

const framework = fileURLToPath(new URL("../", import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "helium smoke "));
const cli = path.join(framework, "dist/bin/helium.js");
let child;
let output = "";

function write(relative, content) {
    const destination = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
}

async function command(args, env = {}) {
    const process = spawn(globalThis.process.execPath, args, {
        cwd: fixture,
        env: { ...globalThis.process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    process.stdout.on("data", (chunk) => {
        logs += chunk;
    });
    process.stderr.on("data", (chunk) => {
        logs += chunk;
    });
    const [code] = await once(process, "exit");
    assert.equal(code, 0, logs);
    return logs;
}

async function availablePort() {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address();
    await new Promise((resolve) => listener.close(resolve));
    return port;
}

async function start(args, port) {
    output = "";
    child = spawn(process.execPath, args, {
        cwd: fixture,
        env: { ...process.env, PORT: String(port), HELIUM_PUBLIC_GREETING: "public-greeting", HELIUM_SECRET: "smoke-test-only-secret" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
        output += chunk;
    });
    child.stderr.on("data", (chunk) => {
        output += chunk;
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(output);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${port}/__helium__/page-props`, { headers: { Accept: "application/json" } });
            if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
                return;
            }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Server did not become ready:\n${output}`);
}

async function stop() {
    if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
        try {
            await exited;
        } finally {
            clearTimeout(timeout);
        }
    }
    child = undefined;
}

async function nextStreamFrame(reader, state) {
    for (;;) {
        if (state.bytes.length >= 4) {
            const length = new DataView(state.bytes.buffer, state.bytes.byteOffset, state.bytes.byteLength).getUint32(0);
            assert.ok(length > 0 && length <= 10 * 1024 * 1024, "Invalid streaming frame size");
            if (state.bytes.length >= length + 4) {
                const frame = decode(state.bytes.subarray(4, length + 4));
                state.bytes = state.bytes.slice(length + 4);
                return frame;
            }
        }
        const { value, done } = await reader.read();
        assert.equal(done, false, "Stream ended before the expected frame");
        const combined = new Uint8Array(state.bytes.length + value.length);
        combined.set(state.bytes);
        combined.set(value, state.bytes.length);
        state.bytes = combined;
    }
}

async function checkStreaming(base, token, phase) {
    const headers = { "X-Helium-Token": token, "Content-Type": "application/msgpack" };
    const name = `${phase}-complete`;
    const releaseFile = path.join(fixture, `stream-${name}-release`);
    const cleanupFile = path.join(fixture, `stream-${name}-cleanup`);
    const response = await fetch(`${base}/__helium__/stream`, {
        method: "POST",
        headers,
        body: encode({ id: name, method: "streamed", args: { name } }),
        signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/x-helium-stream(?:;|$)/);
    const reader = response.body.getReader();
    const state = { bytes: new Uint8Array() };
    try {
        assert.deepEqual(await nextStreamFrame(reader, state), { type: "chunk", data: { text: "first", index: 0 } });
        // The generator cannot finish until this file exists. Its first chunk
        // arriving before file creation proves the response is not buffered.
        assert.equal(fs.existsSync(cleanupFile), false);
        assert.equal(fs.existsSync(releaseFile), false);
        fs.writeFileSync(releaseFile, "release");
        assert.deepEqual(await nextStreamFrame(reader, state), { type: "chunk", data: { text: "second", index: 1 } });
        const done = await nextStreamFrame(reader, state);
        assert.equal(done.type, "done");
        assert.equal(typeof done.stats.remainingRequests, "number");
        assert.equal((await reader.read()).done, true);
        assert.equal(fs.existsSync(cleanupFile), true);
    } finally {
        reader.releaseLock();
    }

    const cancelName = `${phase}-cancel`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const cancelled = await fetch(`${base}/__helium__/stream`, {
            method: "POST",
            headers,
            body: encode({ id: cancelName, method: "streamed", args: { name: cancelName } }),
            signal: controller.signal,
        });
        assert.equal(cancelled.status, 200);
        const cancelReader = cancelled.body.getReader();
        assert.equal((await nextStreamFrame(cancelReader, { bytes: new Uint8Array() })).type, "chunk");
        controller.abort();
        await cancelReader.cancel().catch(() => {});
        cancelReader.releaseLock();
        const cancelledCleanup = path.join(fixture, `stream-${cancelName}-cleanup`);
        const deadline = Date.now() + 2000;
        while (!fs.existsSync(cancelledCleanup) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(fs.existsSync(cancelledCleanup), true, "Cancelling the response must abort ctx.signal and run the generator finally block");
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
}

async function checkRpcUpgradeRejected(base, token) {
    await new Promise((resolve, reject) => {
        const request = http.request(new URL("/rpc", base), {
            headers: {
                Upgrade: "websocket",
                Connection: "Upgrade",
                "Sec-WebSocket-Key": "c21va2UtdGVzdC1vbmx5IQ==",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Protocol": token,
            },
        });
        request.on("response", (response) => {
            response.resume();
            try {
                // With no application upgrade listener, Node may handle this as
                // an ordinary HTTP request (including the app's HTML fallback).
                assert.notEqual(response.statusCode, 101, "Legacy RPC WebSocket upgrades must not be accepted");
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        request.on("upgrade", (_response, socket) => {
            socket.destroy();
            reject(new Error("Application RPC still accepts WebSocket upgrades"));
        });
        request.on("error", (error) => (error.code === "ECONNRESET" ? resolve() : reject(error)));
        request.setTimeout(5000, () => request.destroy(new Error("Legacy upgrade did not finish")));
        request.end();
    });
}

async function checkStreamingShutdown(base, token) {
    const response = await fetch(`${base}/__helium__/stream`, {
        method: "POST",
        headers: { "X-Helium-Token": token, "Content-Type": "application/msgpack" },
        body: encode({ id: "shutdown", method: "streamed", args: { name: "shutdown" } }),
        signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    try {
        assert.equal((await nextStreamFrame(reader, { bytes: new Uint8Array() })).type, "chunk");
        const cleanupFile = path.join(fixture, "stream-shutdown-cleanup");
        assert.equal(fs.existsSync(cleanupFile), false);
        const stoppingChild = child;
        // stop() has a five-second SIGKILL deadline. A clean zero exit proves
        // shutdown did not leave this open provider waiting for its next yield.
        await stop();
        assert.equal(stoppingChild.exitCode, 0, "The CLI must exit gracefully with an active stream");
        assert.equal(fs.existsSync(cleanupFile), true, "Shutdown must abort the provider and run its finally block before exit");
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function checkViteHmr(base) {
    const client = await (await fetch(`${base}/@vite/client`)).text();
    const match = client.match(/const wsToken = ("[^"]+");/);
    assert.ok(match, "Vite must expose its own HMR connection token");
    const token = JSON.parse(match[1]);
    await new Promise((resolve, reject) => {
        const request = http.request(new URL(`/?token=${encodeURIComponent(token)}`, base), {
            headers: {
                Upgrade: "websocket",
                Connection: "Upgrade",
                "Sec-WebSocket-Key": "c21va2UtdGVzdC1vbmx5IQ==",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Protocol": "vite-hmr",
            },
        });
        request.on("upgrade", (response, socket) => {
            socket.destroy();
            try {
                assert.equal(response.statusCode, 101);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        request.on("response", (response) => {
            response.resume();
            reject(new Error(`Vite HMR upgrade returned ${response.statusCode}`));
        });
        request.on("error", reject);
        request.setTimeout(5000, () => request.destroy(new Error("Vite HMR upgrade did not finish")));
        request.end();
    });
}

try {
    assert.ok(fs.existsSync(cli), "Run npm run build before npm run test:smoke");
    fs.mkdirSync(path.join(fixture, "node_modules"));
    for (const name of fs.readdirSync(path.join(framework, "node_modules"))) {
        if (name !== ".heliumts" && name !== "heliumts") {
            fs.symlinkSync(path.join(framework, "node_modules", name), path.join(fixture, "node_modules", name));
        }
    }
    fs.symlinkSync(framework, path.join(fixture, "node_modules/heliumts"));
    write("package.json", JSON.stringify({ type: "module", private: true }));
    write(
        "index.html",
        '<html><head><title>Smoke</title></head><body><div id="root"><div>Loading</div><div>Old sibling</div></div><script type="module" src="/src/main.tsx"></script></body></html>'
    );
    write(
        "vite.config.ts",
        'import helium from "heliumts/vite"; export default { plugins: [helium()], server: { host: "127.0.0.1", port: Number(process.env.PORT || 5173), strictPort: true } };'
    );
    write("settings.ts", 'export const headerValue: string = "from-config-helper";');
    write(
        "helium.config.ts",
        'import { headerValue } from "./settings.ts"; export default { rpc: { maxBatchSize: 2 }, security: { headerOverrides: { "X-Smoke": headerValue } } };'
    );
    write("public/health", "extensionless-static");
    write(
        "src/main.tsx",
        'import React from "react"; import { createRoot, hydrateRoot } from "react-dom/client"; import { AppRouter } from "heliumts/client"; const root=document.getElementById("root")!; const app=React.createElement(AppRouter); if(root.hasChildNodes()) hydrateRoot(root,app); else createRoot(root).render(app);'
    );
    write(
        "src/App.tsx",
        'import React from "react"; export default function App({ Component, pageProps }) { return React.createElement("section", {"data-app":"yes"}, React.createElement(Component, pageProps)); }'
    );
    write(
        "src/pages/_layout.tsx",
        'import React from "react"; import { PageTransition } from "heliumts/client/transitions"; export default function Layout({children}) { return React.createElement("aside", {"data-layout":"yes"}, React.createElement(PageTransition,null,children)); }'
    );
    write(
        "src/pages/index.tsx",
        '"use ssg"; import React from "react"; import {callMethod,getPublicEnvValue,useRouter,useStreaming} from "heliumts/client"; import {echo,streamed} from "heliumts/server"; export default function Home(){const stream=useStreaming(streamed);return React.createElement("main",null,"static $& $$ "+getPublicEnvValue("HELIUM_PUBLIC_GREETING")+" "+useRouter().path,React.createElement("button",{onClick:()=>callMethod(echo,{value:"clicked"})},"SSG RPC button"),React.createElement("button",{onClick:()=>stream.start({name:"click"})},"SSG streaming button"));}'
    );
    write(
        "src/pages/search.tsx",
        '"use ssr"; import React from "react"; import {callMethod,useFetch,useStreaming} from "heliumts/client"; import {echo,streamed} from "heliumts/server"; export default function Search(props){useFetch(echo,{value:"unused"});const stream=useStreaming(streamed);return React.createElement("main",null,"SSR query:"+props.query,React.createElement("button",{onClick:()=>callMethod(echo,{value:"clicked"})},"SSR RPC button"),React.createElement("button",{onClick:()=>stream.start({name:"click"})},"SSR streaming button"));}'
    );
    write(
        "src/pages/search.server.ts",
        'import {PublicError} from "heliumts/server"; export const getServerSideProps=(request)=>{if(request.query.fail)throw new PublicError("private database detail"); return {query: request.query.q || "none"};};'
    );
    write(
        "src/server/methods.ts",
        'import {defineMethod,defineHTTPRequest} from "heliumts/server"; export const echo=defineMethod(async(args)=>args); export const failure=defineMethod(async()=>{throw new Error("private database detail")}); export const options=defineHTTPRequest("OPTIONS","/api/custom",()=>new Response("custom-options",{status:200}));'
    );

    write(
        "src/server/stream.ts",
        `import fs from 'node:fs';
import {defineMethod} from 'heliumts/server';
export const streamed=defineMethod(async function* (args: {name: string},ctx){
    try {
        yield {text:'first',index:0};
        await new Promise<void>((resolve)=>{
            if(ctx.signal.aborted){resolve();return;}
            const finish=()=>{clearInterval(timer);ctx.signal.removeEventListener('abort',finish);resolve();};
            const timer=setInterval(()=>{if(fs.existsSync('stream-'+args.name+'-release'))finish();},10);
            ctx.signal.addEventListener('abort',finish,{once:true});
        });
        if(!ctx.signal.aborted)yield {text:'second',index:1};
    } finally {
        fs.writeFileSync('stream-'+args.name+'-cleanup','done');
    }
});`
    );

    const buildLogs = await command([cli, "build"], { HELIUM_PUBLIC_GREETING: "public-greeting", HELIUM_SECRET: "smoke-test-only-secret" });
    assert.ok(!buildLogs.includes("Failed to generate"), buildLogs);
    const staticHtml = fs.readFileSync(path.join(fixture, "dist/index.ssg.html"), "utf8");
    assert.match(staticHtml, /data-app="yes"/);
    assert.match(staticHtml, /data-layout="yes"/);
    assert.match(staticHtml, /SSG RPC button/);
    assert.match(staticHtml, /SSG streaming button/);
    assert.match(staticHtml, /opacity:1;transition:opacity 150ms ease/);
    assert.match(staticHtml, /static \$&amp; \$\$ public-greeting/);
    assert.ok(!staticHtml.includes("Old sibling"), staticHtml);
    assert.ok(!fs.readFileSync(path.join(fixture, "dist/index.html"), "utf8").includes("Old sibling"));

    // Source config must not be needed after a build.
    fs.renameSync(path.join(fixture, "helium.config.ts"), path.join(fixture, "helium.config.ts.disabled"));
    fs.renameSync(path.join(fixture, "settings.ts"), path.join(fixture, "settings.ts.disabled"));
    const port = await availablePort();
    await start([path.join(fixture, "dist/server.js")], port);
    const base = `http://127.0.0.1:${port}`;
    const rendered = await fetch(`${base}/search?q=hello`);
    const html = await rendered.text();
    assert.equal(rendered.headers.get("x-smoke"), "from-config-helper");
    assert.match(html, /SSR query:hello/);
    assert.match(html, /SSR RPC button/);
    assert.match(html, /SSR streaming button/);
    assert.match(html, /data-app="yes"/);
    assert.ok(!html.includes("Old sibling"), html);
    assert.equal((await fetch(`${base}/search?fail=1`)).status, 500);
    assert.equal(await (await fetch(`${base}/health`)).text(), "extensionless-static");
    const props = await (await fetch(`${base}/__helium__/page-props?path=${encodeURIComponent("/search?q=next")}`)).json();
    assert.deepEqual(props, { ssr: true, props: { query: "next" } });
    assert.equal(await (await fetch(`${base}/api/custom`, { method: "OPTIONS" })).text(), "custom-options");
    const { token } = await (await fetch(`${base}/__helium__/refresh-token`, { method: "POST", headers: { "X-Requested-With": "helium" } })).json();
    for (const method of ["echo", "failure"]) {
        const response = await fetch(`${base}/__helium__/rpc`, { method: "POST", headers: { "X-Helium-Token": token }, body: encode({ id: method, method, args: "rpc-ok" }) });
        const result = decode(new Uint8Array(await response.arrayBuffer()));
        assert.deepEqual(method === "echo" ? result.result : result.error, method === "echo" ? "rpc-ok" : "Server error");
    }
    await checkStreaming(base, token, "production");
    await checkRpcUpgradeRejected(base, token);
    await stop();

    await start([cli, "start"], port);
    assert.equal((await fetch(base)).headers.get("x-smoke"), "from-config-helper");
    const { token: shutdownToken } = await (await fetch(`${base}/__helium__/refresh-token`, { method: "POST", headers: { "X-Requested-With": "helium" } })).json();
    await checkStreamingShutdown(base, shutdownToken);

    fs.renameSync(path.join(fixture, "helium.config.ts.disabled"), path.join(fixture, "helium.config.ts"));
    fs.renameSync(path.join(fixture, "settings.ts.disabled"), path.join(fixture, "settings.ts"));
    await start([cli, "dev"], port);
    const devHtml = await (await fetch(`${base}/search?q=development`)).text();
    assert.match(devHtml, /SSR query:development/);
    assert.match(devHtml, /SSR streaming button/);
    const { token: devToken } = await (await fetch(`${base}/__helium__/refresh-token`, { method: "POST", headers: { "X-Requested-With": "helium" } })).json();
    await checkStreaming(base, devToken, "development");
    await checkViteHmr(base);
    await stop();
    console.log(
        "Smoke checks passed: CLI build, SSG, SSR, callMethod/useStreaming handler imports, layouts, transitions, config helpers, public env, HTTP-only RPC, early streaming chunks, cancellation/finally, active-stream shutdown, error privacy, custom OPTIONS, static assets, direct server, CLI start/dev and Vite HMR in a path with spaces."
    );
} catch (error) {
    console.error(output);
    throw error;
} finally {
    await stop();
    fs.rmSync(fixture, { recursive: true, force: true });
}
