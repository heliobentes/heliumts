import { afterEach, describe, expect, it } from "vitest";

import { getPublicEnv, getPublicEnvValue, isDevEnvironment } from "../../src/client/env";

describe("client env helpers", () => {
    afterEach(() => {
        delete (globalThis as typeof globalThis & { __HELIUM__?: { env?: Record<string, string> } }).__HELIUM__;
    });

    it("should read public env from __HELIUM__.env", () => {
        (globalThis as typeof globalThis & { __HELIUM__?: { env?: Record<string, string> } }).__HELIUM__ = {
            env: {
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
                HELIUM_PUBLIC_FLAG: "true",
            },
        };

        expect(getPublicEnv()).toEqual({
            HELIUM_PUBLIC_API_URL: "https://api.example.com",
            HELIUM_PUBLIC_FLAG: "true",
        });
    });

    it("should return an empty object when __HELIUM__.env is missing", () => {
        expect(getPublicEnv()).toEqual({});
    });

    it("should read a single public env value", () => {
        (globalThis as typeof globalThis & { __HELIUM__?: { env?: Record<string, string> } }).__HELIUM__ = {
            env: {
                HELIUM_PUBLIC_API_URL: "https://api.example.com",
            },
        };

        expect(getPublicEnvValue("HELIUM_PUBLIC_API_URL")).toBe("https://api.example.com");
        expect(getPublicEnvValue("HELIUM_PUBLIC_MISSING")).toBeUndefined();
    });

    it("should expose dev mode through the existing define", () => {
        expect(typeof isDevEnvironment()).toBe("boolean");
    });
});