import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
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
            const response = await fetch(`http://127.0.0.1:${port}/__helium__/page-props`);
            if (response.ok) {
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
        'import { headerValue } from "./settings.ts"; export default { rpc: { transport: "http" }, security: { headerOverrides: { "X-Smoke": headerValue } } };'
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
        '"use ssg"; import React from "react"; import {getPublicEnvValue,useRouter} from "heliumts/client"; export default function Home(){return React.createElement("main",null,"static $& $$ "+getPublicEnvValue("HELIUM_PUBLIC_GREETING")+" "+useRouter().path);}'
    );
    write(
        "src/pages/search.tsx",
        '"use ssr"; import React from "react"; import {useFetch} from "heliumts/client"; import {echo} from "heliumts/server"; export default function Search(props){useFetch(echo,{value:"unused"});return React.createElement("main",null,"SSR query:"+props.query);}'
    );
    write(
        "src/pages/search.server.ts",
        'import {PublicError} from "heliumts/server"; export const getServerSideProps=(request)=>{if(request.query.fail)throw new PublicError("private database detail"); return {query: request.query.q || "none"};};'
    );
    write(
        "src/server/methods.ts",
        'import {defineMethod,defineHTTPRequest} from "heliumts/server"; export const echo=defineMethod(async(args)=>args); export const failure=defineMethod(async()=>{throw new Error("private database detail")}); export const options=defineHTTPRequest("OPTIONS","/api/custom",()=>new Response("custom-options",{status:200}));'
    );

    const buildLogs = await command([cli, "build"], { HELIUM_PUBLIC_GREETING: "public-greeting", HELIUM_SECRET: "smoke-test-only-secret" });
    assert.ok(!buildLogs.includes("Failed to generate"), buildLogs);
    const staticHtml = fs.readFileSync(path.join(fixture, "dist/index.ssg.html"), "utf8");
    assert.match(staticHtml, /data-app="yes"/);
    assert.match(staticHtml, /data-layout="yes"/);
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
    await stop();

    await start([cli, "start"], port);
    assert.equal((await fetch(base)).headers.get("x-smoke"), "from-config-helper");
    await stop();
    console.log(
        "Smoke checks passed: CLI build, SSG, SSR, layouts, transitions, config helpers, public env, HTTP RPC, error privacy, custom OPTIONS, static assets, direct server, CLI start and dev in a path with spaces."
    );
} catch (error) {
    console.error(output);
    throw error;
} finally {
    await stop();
    fs.rmSync(fixture, { recursive: true, force: true });
}
