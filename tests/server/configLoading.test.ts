// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, loadConfig } from "../../src/server/config";

describe("configuration file loading", () => {
    let root: string;
    beforeEach(() => {
        clearConfigCache();
        vi.stubEnv("HELIUM_CONFIG_DIR", "");
        root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-config-review-"));
    });
    afterEach(() => {
        clearConfigCache();
        vi.unstubAllEnvs();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("loads TypeScript configuration and its local TypeScript helpers without a Node TypeScript loader", async () => {
        fs.writeFileSync(path.join(root, "settings.ts"), 'export const transport: "http" = "http";');
        fs.writeFileSync(path.join(root, "helium.config.ts"), 'import { transport } from "./settings.ts"; export default { rpc: { transport }, trustProxyDepth: 2 };');
        expect(await loadConfig(root)).toEqual({ rpc: { transport: "http" }, trustProxyDepth: 2 });
        expect(fs.readdirSync(root).filter((file) => file.startsWith(".helium-config-"))).toEqual([]);
    });

    it("reloads changed bundled helpers when the config cache is cleared", async () => {
        fs.writeFileSync(path.join(root, "settings.ts"), "export const trustProxyDepth: number = 1;");
        fs.writeFileSync(path.join(root, "helium.config.ts"), 'import { trustProxyDepth } from "./settings.ts"; export default { trustProxyDepth };');
        expect((await loadConfig(root)).trustProxyDepth).toBe(1);
        fs.writeFileSync(path.join(root, "settings.ts"), "export const trustProxyDepth: number = 2;");
        clearConfigCache();
        expect((await loadConfig(root)).trustProxyDepth).toBe(2);
    });

    it("rejects invalid configuration without falling back to a lower-priority file", async () => {
        fs.writeFileSync(path.join(root, "helium.config.mjs"), "throw new Error('configuration failed');");
        fs.writeFileSync(path.join(root, "helium.config.ts"), "export default {};");
        await expect(loadConfig(root)).rejects.toThrow("configuration failed");
    });

    it("rejects missing object exports and removes temporary config modules on evaluation failures", async () => {
        const configPath = path.join(root, "helium.config.ts");
        fs.writeFileSync(configPath, "export default null;");
        await expect(loadConfig(root)).rejects.toThrow("Expected a configuration object");
        fs.writeFileSync(configPath, "throw new Error('failed during initialization'); export default {};");
        await expect(loadConfig(root)).rejects.toThrow("failed during initialization");
        expect(fs.readdirSync(root).filter((file) => file.startsWith(".helium-config-"))).toEqual([]);
    });

    it("prioritizes an explicitly configured build directory", async () => {
        const dist = path.join(root, "dist");
        fs.mkdirSync(dist);
        fs.writeFileSync(path.join(root, "helium.config.ts"), "export default { trustProxyDepth: 1 };");
        fs.writeFileSync(path.join(dist, "helium.config.mjs"), "export default { trustProxyDepth: 3 };");
        vi.stubEnv("HELIUM_CONFIG_DIR", dist);
        expect((await loadConfig(root)).trustProxyDepth).toBe(3);
    });
});
