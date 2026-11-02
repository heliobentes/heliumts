import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, getRpcClientConfig, getRpcConfig, getRpcSecurityConfig, getTrustProxyDepth, type HeliumConfig, loadConfig } from "../../src/server/config";

describe("config", () => {
    let existsSyncSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clearConfigCache();
        vi.resetAllMocks();
        existsSyncSpy = vi.spyOn(fs, "existsSync");
    });

    afterEach(() => {
        clearConfigCache();
        vi.restoreAllMocks();
    });

    describe("getTrustProxyDepth", () => {
        it("should return 0 by default", () => {
            const result = getTrustProxyDepth({});
            expect(result).toBe(0);
        });

        it("should return configured value", () => {
            const config: HeliumConfig = { trustProxyDepth: 2 };
            expect(getTrustProxyDepth(config)).toBe(2);
        });
    });

    describe("HTTP RPC configuration", () => {
        it("applies per-IP request and token defaults", () => {
            expect(getRpcSecurityConfig()).toEqual({ maxRequestsPerWindow: 100, rateLimitWindowMs: 60000, tokenValidityMs: 30000 });
            expect(getRpcSecurityConfig({ rpc: { security: { maxRequestsPerWindow: 3 } } }).maxRequestsPerWindow).toBe(3);
        });
        it("keeps request body and batch limits", () => {
            expect(getRpcConfig()).toMatchObject({ maxBodySize: 1048576, maxBatchSize: 20 });
            expect(getRpcConfig({ rpc: { maxBodySize: 512, maxBatchSize: 2 } })).toMatchObject({ maxBodySize: 512, maxBatchSize: 2 });
        });
        it("injects only token validity into the client", () => {
            expect(getRpcClientConfig()).toEqual({ tokenValidityMs: 30000 });
            expect(getRpcClientConfig({ rpc: { security: { tokenValidityMs: 60000 } } })).toEqual({ tokenValidityMs: 60000 });
        });
    });

    describe("loadConfig", () => {
        it("should return empty config when no config file exists", async () => {
            existsSyncSpy.mockReturnValue(false);

            const result = await loadConfig("/test/project");

            expect(result).toEqual({});
        });

        it("should cache the loaded config", async () => {
            existsSyncSpy.mockReturnValue(false);

            const result1 = await loadConfig("/test/project");
            const result2 = await loadConfig("/test/project");

            expect(result1).toBe(result2);
        });

        it("rejects a config that exists but cannot be loaded instead of silently defaulting", async () => {
            existsSyncSpy.mockImplementation((filePath: fs.PathLike) => String(filePath).endsWith("helium.config.ts"));
            await expect(loadConfig("/test/project")).rejects.toThrow("Failed to load Helium config");
        });

        it("should search HELIUM_CONFIG_DIR first when set", async () => {
            const originalEnv = process.env.HELIUM_CONFIG_DIR;
            process.env.HELIUM_CONFIG_DIR = "/custom/config/dir";

            const checkedPaths: string[] = [];
            existsSyncSpy.mockImplementation((filePath: fs.PathLike) => {
                checkedPaths.push(String(filePath));
                return false;
            });

            clearConfigCache();
            await loadConfig("/project/root");

            // Should check HELIUM_CONFIG_DIR first
            expect(checkedPaths[0]).toContain("/custom/config/dir");
            expect(checkedPaths.some((p) => p.includes("/project/root"))).toBe(true);

            if (originalEnv === undefined) {
                delete process.env.HELIUM_CONFIG_DIR;
            } else {
                process.env.HELIUM_CONFIG_DIR = originalEnv;
            }
        });

        it("should search for all config file types", async () => {
            const checkedFiles: string[] = [];
            existsSyncSpy.mockImplementation((filePath: fs.PathLike) => {
                checkedFiles.push(path.basename(String(filePath)));
                return false;
            });

            clearConfigCache();
            await loadConfig("/test/project");

            expect(checkedFiles).toContain("helium.config.js");
            expect(checkedFiles).toContain("helium.config.mjs");
            expect(checkedFiles).toContain("helium.config.ts");
        });
    });

    it("keeps caches separate for different project roots and config directories", async () => {
        existsSyncSpy.mockReturnValue(false);
        const first = await loadConfig("/first/project");
        existsSyncSpy.mockClear();
        const second = await loadConfig("/second/project");
        expect(second).not.toBe(first);
        expect(existsSyncSpy).toHaveBeenCalled();
        vi.stubEnv("HELIUM_CONFIG_DIR", "/another/config");
        try {
            expect(await loadConfig("/first/project")).not.toBe(first);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    describe("clearConfigCache", () => {
        it("should clear cached config", async () => {
            existsSyncSpy.mockReturnValue(false);

            await loadConfig("/test/project");
            clearConfigCache();

            // After clearing, existsSync should be called again
            existsSyncSpy.mockClear();
            await loadConfig("/test/project");

            expect(fs.existsSync).toHaveBeenCalled();
        });
    });
});
