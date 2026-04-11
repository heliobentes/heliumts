import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPublicEnvScript, createEnvDefines, filterClientEnv, getPublicEnvFromProcess, injectEnvToProcess, injectPublicEnvIntoHtml, loadEnvFiles } from "../../src/utils/envLoader";

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
            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p === path.resolve(mockCwd, ".env");
            });
            readFileSyncSpy.mockReturnValue("TEST_VAR=test_value");

            const result = loadEnvFiles({ root: mockCwd, mode: "development" });

            expect(result.TEST_VAR).toBe("test_value");
        });

        it("should load mode-specific env file", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p === path.resolve(mockCwd, ".env.production");
            });
            readFileSyncSpy.mockReturnValue("PROD_VAR=prod_value");

            const result = loadEnvFiles({ root: mockCwd, mode: "production" });

            expect(result.PROD_VAR).toBe("prod_value");
        });

        it("should not load .env.local in test mode", () => {
            const mockCwd = "/test/project";
            const existsCalls: string[] = [];
            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                existsCalls.push(p as string);
                return false;
            });

            loadEnvFiles({ root: mockCwd, mode: "test" });

            expect(existsCalls).not.toContain(path.resolve(mockCwd, ".env.local"));
        });

        it("should override values from earlier files with later ones", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                const pStr = p as string;
                return pStr.endsWith(".env") || pStr.endsWith(".env.development");
            });
            readFileSyncSpy.mockImplementation((p: fs.PathLike) => {
                const pStr = p as string;
                if (pStr.endsWith(".env.development")) {
                    return "VAR=development_value";
                }
                return "VAR=base_value";
            });

            const result = loadEnvFiles({ root: mockCwd, mode: "development" });

            expect(result.VAR).toBe("development_value");
        });

        it("should pick up HELIUM_PUBLIC_ vars from process.env when no .env files exist", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockReturnValue(false);
            process.env.HELIUM_PUBLIC_PLATFORM_VAR = "platform_value";

            const result = loadEnvFiles({ root: mockCwd, mode: "production" });

            expect(result.HELIUM_PUBLIC_PLATFORM_VAR).toBe("platform_value");

            delete process.env.HELIUM_PUBLIC_PLATFORM_VAR;
        });

        it("should let .env file values override process.env HELIUM_PUBLIC_ vars", () => {
            const mockCwd = "/test/project";
            process.env.HELIUM_PUBLIC_API_KEY = "from_process";
            existsSyncSpy.mockImplementation((p: fs.PathLike) => {
                return p === path.resolve(mockCwd, ".env");
            });
            readFileSyncSpy.mockReturnValue("HELIUM_PUBLIC_API_KEY=from_file");

            const result = loadEnvFiles({ root: mockCwd, mode: "production" });

            expect(result.HELIUM_PUBLIC_API_KEY).toBe("from_file");

            delete process.env.HELIUM_PUBLIC_API_KEY;
        });

        it("should not pick up non-HELIUM_PUBLIC_ vars from process.env", () => {
            const mockCwd = "/test/project";
            existsSyncSpy.mockReturnValue(false);
            process.env.SECRET_DATABASE_URL = "secret_db";

            const result = loadEnvFiles({ root: mockCwd, mode: "production" });

            expect(result.SECRET_DATABASE_URL).toBeUndefined();

            delete process.env.SECRET_DATABASE_URL;
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

    describe("getPublicEnvFromProcess", () => {
        it("should collect HELIUM_PUBLIC_ vars from process.env", () => {
            process.env.HELIUM_PUBLIC_KEY1 = "value1";
            process.env.HELIUM_PUBLIC_KEY2 = "value2";
            process.env.SECRET_KEY = "secret";

            const result = getPublicEnvFromProcess();

            expect(result.HELIUM_PUBLIC_KEY1).toBe("value1");
            expect(result.HELIUM_PUBLIC_KEY2).toBe("value2");
            expect(result.SECRET_KEY).toBeUndefined();

            delete process.env.HELIUM_PUBLIC_KEY1;
            delete process.env.HELIUM_PUBLIC_KEY2;
            delete process.env.SECRET_KEY;
        });

        it("should support custom prefix", () => {
            process.env.CUSTOM_PUB_VAR = "custom";
            process.env.HELIUM_PUBLIC_VAR = "helium";

            const result = getPublicEnvFromProcess("CUSTOM_PUB_");

            expect(result.CUSTOM_PUB_VAR).toBe("custom");
            expect(result.HELIUM_PUBLIC_VAR).toBeUndefined();

            delete process.env.CUSTOM_PUB_VAR;
            delete process.env.HELIUM_PUBLIC_VAR;
        });

        it("should return empty object when no matching vars exist", () => {
            const result = getPublicEnvFromProcess("NONEXISTENT_PREFIX_");
            expect(result).toEqual({});
        });
    });

    describe("buildPublicEnvScript", () => {
        it("should generate script tag with HELIUM_PUBLIC_ vars from process.env", () => {
            process.env.HELIUM_PUBLIC_APP_NAME = "TestApp";

            const result = buildPublicEnvScript();

            expect(result).toContain("<script>");
            expect(result).toContain("window.__HELIUM_PUBLIC_ENV__=");
            expect(result).toContain("HELIUM_PUBLIC_APP_NAME");
            expect(result).toContain("TestApp");

            delete process.env.HELIUM_PUBLIC_APP_NAME;
        });

        it("should return empty string when no public vars exist", () => {
            const result = buildPublicEnvScript("NONEXISTENT_PREFIX_");
            expect(result).toBe("");
        });

        it("should properly escape JSON values", () => {
            process.env.HELIUM_PUBLIC_SPECIAL = 'value with "quotes"';

            const result = buildPublicEnvScript();

            expect(result).toContain("<script>");
            // Should be valid JSON inside the script
            const match = result.match(/window\.__HELIUM_PUBLIC_ENV__=(.+?)<\/script>/);
            expect(match).not.toBeNull();
            const parsed = JSON.parse(match![1]);
            expect(parsed.HELIUM_PUBLIC_SPECIAL).toBe('value with "quotes"');

            delete process.env.HELIUM_PUBLIC_SPECIAL;
        });
    });

    describe("injectPublicEnvIntoHtml", () => {
        it("should inject script at start of <head>", () => {
            process.env.HELIUM_PUBLIC_API = "https://api.test.com";

            const html = "<html><head><title>Test</title></head><body></body></html>";
            const result = injectPublicEnvIntoHtml(html);

            expect(result).toContain("<head>\n<script>window.__HELIUM_PUBLIC_ENV__=");
            expect(result).toContain("HELIUM_PUBLIC_API");
            expect(result).toContain("https://api.test.com");

            delete process.env.HELIUM_PUBLIC_API;
        });

        it("should return unchanged HTML when no public vars exist", () => {
            const html = "<html><head><title>Test</title></head><body></body></html>";
            const result = injectPublicEnvIntoHtml(html, "NONEXISTENT_PREFIX_");

            expect(result).toBe(html);
        });

        it("should fallback to prepending when no <head> tag found", () => {
            process.env.HELIUM_PUBLIC_VAR = "value";

            const html = "<html><body></body></html>";
            const result = injectPublicEnvIntoHtml(html);

            expect(result).toMatch(/^<script>window\.__HELIUM_PUBLIC_ENV__=/);

            delete process.env.HELIUM_PUBLIC_VAR;
        });
    });
});
