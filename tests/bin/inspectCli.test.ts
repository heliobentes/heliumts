// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));
let temporary: string;
let app: string;
let cli: string;
const run = (...args: string[]) => spawnSync(process.execPath, [cli, "inspect", ...args], { cwd: app, encoding: "utf8" });

beforeAll(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "helium-inspect-cli-"));
    app = path.join(temporary, "app");
    cli = path.join(temporary, "helium.mjs");
    fs.mkdirSync(path.join(app, "src/pages/posts"), { recursive: true });
    fs.mkdirSync(path.join(app, "src/server"), { recursive: true });
    // Throwing source proves discovery does not evaluate either kind of module.
    fs.writeFileSync(path.join(app, "src/pages/posts/[id].tsx"), "'use ssr'; throw new Error('page evaluated'); export default 1;");
    fs.writeFileSync(path.join(app, "src/server/posts.ts"), "throw new Error('server evaluated'); export const getPost = defineMethod(() => 1);");
    fs.symlinkSync(path.join(repository, "node_modules"), path.join(temporary, "node_modules"), "dir");
    // Exercise the current CLI source, without requiring a pre-existing dist build.
    buildSync({ entryPoints: [path.join(repository, "src/bin/helium.ts")], outfile: cli, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
});
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));

describe("inspect CLI", () => {
    it("returns one source-only entry while preserving the full manifest command", () => {
        const full = run("--json");
        expect(full.status).toBe(0);
        const manifest = JSON.parse(full.stdout);
        expect(manifest.version).toBe(1);
        const route = run("--route", "/posts/:id", "--json");
        expect(route.status).toBe(0);
        expect(JSON.parse(route.stdout)).toEqual(manifest.routes[0]);
        const rpc = run("--rpc", "getPost");
        expect(rpc.status).toBe(0);
        expect(JSON.parse(rpc.stdout)).toEqual({ name: "getPost", file: "src/server/posts.ts" });
        expect(fs.existsSync(path.join(app, "src/types"))).toBe(false);
    });

    it.each([
        [["--route", "/posts/123"], "No route pattern found"],
        [["--rpc", "get"], "No RPC method found"],
        [["--route", "/posts/:id", "--rpc", "getPost"], "Choose either --route or --rpc"],
        [["--rpc", "getPost", "--rpc", "getPost"], "Specify --rpc only once"],
        [["--route", "/posts/:id", "--route", "/posts/:id"], "Specify --route only once"],
        [["--rpc", ""], "requires a non-empty"],
        [["--rpc"], "value is missing"],
        [["--route"], "value is missing"],
    ])("rejects invalid lookup arguments %j", (args, message) => {
        const result = run(...args);
        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain(message);
    });
});
