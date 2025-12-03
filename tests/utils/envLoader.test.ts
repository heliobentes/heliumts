import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEnvDefines, filterClientEnv, injectEnvToProcess, loadEnvFiles } from "../../src/utils/envLoader";

// Mock dotenv
vi.mock("dotenv", () => ({
    default: {
        parse: (content: string) => {
            const result: Record<string, string> = {};
            content.split("\n").forEach((line) => {
                const [key, value] = line.split("=");
                if (key && value) {
                    result[key.trim()] = value.trim();
                }
            });
            return result;
        },
    },
}));

describe("envLoader", () => {
    let existsSyncSpy: ReturnType<typeof vi.spyOn>;
    let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        existsSyncSpy = vi.spyOn(fs, "existsSync");
        readFileSyncSpy = vi.spyOn(fs, "readFileSync");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("loadEnvFiles", () => {
        it("should load .env file when it exists", () => {
            const mockCwd = "/test/project";
            vi.spyOn(process, "cwd").mockReturnValue(mockCwd);
            existsSyncSpy.mockImplementation((p) => {
                return p === path.resolve(mockCwd, ".env");
            });
            readFileSyncSpy.mockReturnValue("TEST_VAR=test_value");

            const result = loadEnvFiles({ root: mockCwd, mode: "development" });

            expect(result).toEqual({ TEST_VAR: "test_value" });
        });

        it("should load mode-specific env file", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockImplementation((p) => {
                return p === path.resolve(mockCwd, ".env.production");
            });
            readFileSyncSpy.mockReturnValue("PROD_VAR=prod_value");

            const result = loadEnvFiles({ root: mockCwd, mode: "production" });

            expect(result).toEqual({ PROD_VAR: "prod_value" });
        });

        it("should not load .env.local in test mode", () => {
            const mockCwd = "/test/project";
            const existsCalls: string[] = [];
            existsSyncSpy.mockImplementation((p) => {
                existsCalls.push(p as string);
                return false;
            });

            loadEnvFiles({ root: mockCwd, mode: "test" });

            expect(existsCalls).not.toContain(path.resolve(mockCwd, ".env.local"));
        });

        it("should override values from earlier files with later ones", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockImplementation((p) => {
                const pStr = p as string;
                return pStr.endsWith(".env") || pStr.endsWith(".env.development");
            });
            readFileSyncSpy.mockImplementation((p) => {
                const pStr = p as string;
                if (pStr.endsWith(".env.development")) {
                    return "VAR=development_value";
                }
                return "VAR=base_value";
            });

            const result = loadEnvFiles({ root: mockCwd, mode: "development" });

            expect(result.VAR).toBe("development_value");
        });
    });

    describe("injectEnvToProcess", () => {
        it("should inject env variables into process.env", () => {
            const originalEnv = process.env.TEST_INJECT_VAR;
            delete process.env.TEST_INJECT_VAR;

            injectEnvToProcess({ TEST_INJECT_VAR: "injected" });

            expect(process.env.TEST_INJECT_VAR).toBe("injected");

            // Cleanup
            if (originalEnv !== undefined) {
                process.env.TEST_INJECT_VAR = originalEnv;
            } else {
                delete process.env.TEST_INJECT_VAR;
            }
        });

        it("should not override existing process.env values", () => {
            process.env.EXISTING_VAR = "original";

            injectEnvToProcess({ EXISTING_VAR: "new_value" });

            expect(process.env.EXISTING_VAR).toBe("original");

            // Cleanup
            delete process.env.EXISTING_VAR;
        });
    });

    describe("filterClientEnv", () => {
        it("should filter variables with HELIUM_PUBLIC_ prefix", () => {
            const env = {
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
                HELIUM_PUBLIC_APP_NAME: "Test App",
                SECRET_KEY: "secret",
                DATABASE_URL: "postgres://localhost",
            };

            const result = filterClientEnv(env);

            expect(result).toEqual({
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
                HELIUM_PUBLIC_APP_NAME: "Test App",
            });
        });

        it("should use custom prefix when provided", () => {
            const env = {
                CUSTOM_PUBLIC_VAR: "value1",
                HELIUM_PUBLIC_VAR: "value2",
                PRIVATE_VAR: "secret",
            };

            const result = filterClientEnv(env, "CUSTOM_PUBLIC_");

            expect(result).toEqual({
                CUSTOM_PUBLIC_VAR: "value1",
            });
        });

        it("should return empty object when no matching variables", () => {
            const env = {
                SECRET_KEY: "secret",
                DATABASE_URL: "postgres://localhost",
            };

            const result = filterClientEnv(env);

            expect(result).toEqual({});
        });
    });

    describe("createEnvDefines", () => {
        it("should create Vite define config for client env", () => {
            const env = {
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
                SECRET_KEY: "secret",
            };

            const result = createEnvDefines(env);

            expect(result).toEqual({
                "import.meta.env.HELIUM_PUBLIC_API_URL": '"https://api.example.com"',
            });
        });

        it("should properly stringify values", () => {
            const env = {
                HELIUM_PUBLIC_DEBUG: "true",
                HELIUM_PUBLIC_COUNT: "42",
            };

            const result = createEnvDefines(env);

            expect(result["import.meta.env.HELIUM_PUBLIC_DEBUG"]).toBe('"true"');
            expect(result["import.meta.env.HELIUM_PUBLIC_COUNT"]).toBe('"42"');
        });
    });
});
