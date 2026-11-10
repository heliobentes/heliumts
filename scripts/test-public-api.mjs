import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "helium-packed-api-"));
const checked = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: "utf8", ...options });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout;
};
try {
    // Exercise exactly the artifact consumers install, not source or dist from cwd.
    const packed = JSON.parse(checked("npm", ["pack", "--json", "--cache", path.join(temporary, "npm-cache"), "--pack-destination", temporary], { cwd: root }));
    assert.ok(!JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).files.includes("memory-model"), "Normal allowlist must not opt into model assets");
    assert.ok(packed[0].files.every(({path: file}) => !file.startsWith("memory-model/") && !/\.(?:onnx|wasm|node)$/i.test(file)), "Normal package must not ship weights, WASM or native inference runtime");
    checked("tar", ["-xzf", path.join(temporary, packed[0].filename), "-C", temporary]);
    const installed = path.join(temporary, "package");
    const cli = path.join(installed, "dist/bin/helium.js");
    const dependencies = path.join(installed, "node_modules");
    fs.mkdirSync(dependencies);
    fs.symlinkSync(path.join(root, "node_modules/cac"), path.join(dependencies, "cac"), "dir");
    // Help must work before TypeScript (or the other build dependencies) is available.
    assert.match(checked(process.execPath, [cli, "--help"], { cwd: temporary }), /api \[symbol\]/);
    fs.rmSync(dependencies, { recursive: true });
    fs.symlinkSync(path.join(root, "node_modules"), dependencies, "dir");
    const app = path.join(temporary, "application");
    fs.mkdirSync(path.join(app, "src/server"), { recursive: true });
    const poison = 'throw new Error("application modules must not load during API lookup");';
    fs.writeFileSync(path.join(app, "helium.config.ts"), poison);
    fs.writeFileSync(path.join(app, "src/server/poison.ts"), poison);
    const run = (...args) => spawnSync(process.execPath, [cli, "api", ...args], { cwd: app, encoding: "utf8" });
    const record = (...args) => {
        const result = run(...args);
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        return JSON.parse(result.stdout);
    };
    const discovered = record("--list", "--from", "client", "--match", "ROUTER", "--json");
    assert.equal(discovered.module, "heliumts/client");
    assert.equal(discovered.count, discovered.symbols.length);
    assert.ok(discovered.symbols.some(({ name, declarationKind }) => name === "useRouter" && declarationKind === "function"));
    assert.ok(discovered.symbols.every(({ name }) => name.toLowerCase().includes("router")));
    assert.equal(record(discovered.symbols.find(({ name }) => name === "useRouter").name).name, "useRouter");
    assert.deepEqual(record("--list", "--match", "noPublicNameMatchesThis").symbols, []);
    for (const removed of ["MethodStub", "UnaryMethodStub", "RpcMethod"]) {
        assert.deepEqual(record("--list", "--match", removed).symbols, []);
    }
    assert.ok(record("MethodReference").declarations.some(({ text }) => text.includes("methodSignature")));
    for (const name of ["useCall", "useFetch", "useRouter"]) {
        const result = record(name, "--json");
        assert.equal(result.module, "heliumts/client");
        assert.equal(result.name, name);
        assert.ok(result.declarations.every(({ file }) => file.startsWith("dist/client/")));
        assert.ok(result.declarations.some(({ text }) => text.includes(`function ${name}`)));
    }
    const router = record("useRouter");
    assert.ok(router.relatedTypes.some(({ localDeclarations }) => localDeclarations.some(({ text }) => text.includes("searchParams: URLSearchParams"))));
    const method = record("defineMethod", "--from", "server");
    assert.equal(method.module, "heliumts/server");
    assert.ok(method.relatedTypes.some(({ publicExports }) => publicExports.includes("DefineMethodOptions")));
    assert.ok(record("DefineMethodOptions", "--from", "server").declarations.some(({ text }) => text.includes("input?")));
    assert.ok(record("MethodInputError", "--from", "server").declarations.some(({ text }) => text.includes("class MethodInputError")));
    for (const [args, message] of [
        [["notAnExport"], "No public export notAnExport from heliumts/client"],
        [["defineMethod"], "from heliumts/client"],
        [["useCall", "useFetch"], "exactly one"],
        [["useCall", "--from", "internal"], "Unknown public entrypoint"],
        [["useCall", "--from", "client", "--from", "server"], "only once"],
        [["useCall", "--from"], "value is missing"],
        [[], "exactly one"],
        [["--list", "useCall"], "not both"],
        [["useCall", "--match", "Call"], "--match requires --list"],
        [["--list", "--match", "call", "--match", "router"], "only once"],
        [["--list", "--from", "client", "--from", "server"], "only once"],
        [["--list", "--list"], "only once"],
        [["--list", "--match"], "value is missing"],
    ]) {
        const result = run(...args);
        assert.equal(result.status, 1);
        assert.ok((result.stdout + result.stderr).includes(message), result.stdout + result.stderr);
    }
    console.log("Packed API discovery and lookup: filtered public names, real hook/server/type/class declarations and 13 invalid requests passed; application modules were not loaded.");
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
