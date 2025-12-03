import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    clearConfigCache,
    getCompressionConfig,
    getRpcClientConfig,
    getRpcConfig,
    getRpcSecurityConfig,
    getTrustProxyDepth,
    loadConfig,
    type HeliumConfig,
} from "../../src/server/config";

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

    describe("getRpcSecurityConfig", () => {
        it("should return defaults when no config provided", () => {
            const result = getRpcSecurityConfig({});

            expect(result).toEqual({
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            });
        });

        it("should merge partial config with defaults", () => {
            const config: HeliumConfig = {
                rpc: {
                    security: {
                        maxConnectionsPerIP: 5,
                    },
                },
            };

            const result = getRpcSecurityConfig(config);

            expect(result.maxConnectionsPerIP).toBe(5);
            expect(result.maxMessagesPerWindow).toBe(100); // default
            expect(result.rateLimitWindowMs).toBe(60000); // default
            expect(result.tokenValidityMs).toBe(30000); // default
        });

        it("should use all custom values when provided", () => {
            const config: HeliumConfig = {
                rpc: {
                    security: {
                        maxConnectionsPerIP: 5,
                        maxMessagesPerWindow: 50,
                        rateLimitWindowMs: 30000,
                        tokenValidityMs: 15000,
                    },
                },
            };

            const result = getRpcSecurityConfig(config);

            expect(result).toEqual({
                maxConnectionsPerIP: 5,
                maxMessagesPerWindow: 50,
                rateLimitWindowMs: 30000,
                tokenValidityMs: 15000,
            });
        });
    });

    describe("getCompressionConfig", () => {
        it("should return defaults when no config provided", () => {
            const result = getCompressionConfig({});

            expect(result).toEqual({
                enabled: true,
                threshold: 1024,
            });
        });

        it("should merge partial config with defaults", () => {
            const config: HeliumConfig = {
                rpc: {
                    compression: {
                        enabled: false,
                    },
                },
            };

            const result = getCompressionConfig(config);

            expect(result.enabled).toBe(false);
            expect(result.threshold).toBe(1024); // default
        });

        it("should use all custom values when provided", () => {
            const config: HeliumConfig = {
                rpc: {
                    compression: {
                        enabled: true,
                        threshold: 2048,
                    },
                },
            };

            const result = getCompressionConfig(config);

            expect(result).toEqual({
                enabled: true,
                threshold: 2048,
            });
        });
    });

    describe("getRpcConfig", () => {
        it("should return both compression and security configs", () => {
            const config: HeliumConfig = {
                rpc: {
                    compression: { enabled: false },
                    security: { maxConnectionsPerIP: 5 },
                },
            };

            const result = getRpcConfig(config);

            expect(result.compression.enabled).toBe(false);
            expect(result.security.maxConnectionsPerIP).toBe(5);
        });
    });

    describe("getRpcClientConfig", () => {
        it("should return default transport config", () => {
            const result = getRpcClientConfig({});

            expect(result).toEqual({
                transport: "websocket",
                autoHttpOnMobile: false,
            });
        });

        it("should use http transport when configured", () => {
            const config: HeliumConfig = {
                rpc: {
                    transport: "http",
                    autoHttpOnMobile: true,
                },
            };

            const result = getRpcClientConfig(config);

            expect(result).toEqual({
                transport: "http",
                autoHttpOnMobile: true,
            });
        });

        it("should use auto transport when configured", () => {
            const config: HeliumConfig = {
                rpc: {
                    transport: "auto",
                },
            };

            const result = getRpcClientConfig(config);

            expect(result.transport).toBe("auto");
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

        it("should handle .ts config file error in production", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            // Mock existsSync to return true for helium.config.ts
            existsSyncSpy.mockImplementation((filePath: fs.PathLike) => {
                return String(filePath).endsWith("helium.config.ts");
            });

            // The import will fail in production for .ts files
            // We can't easily mock dynamic imports, but we can verify the function
            // handles the case when no valid config is found
            clearConfigCache();
            const result = await loadConfig("/test/project");

            // Should return empty config after failing to load .ts file
            expect(result).toEqual({});

            warnSpy.mockRestore();
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
