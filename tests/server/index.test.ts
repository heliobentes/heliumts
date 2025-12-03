import { describe, expect, it } from "vitest";

// Test that the server barrel export works
describe("server index exports", () => {
    it("should export config functions", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.loadConfig).toBeDefined();
        expect(serverModule.getTrustProxyDepth).toBeDefined();
        expect(serverModule.getRpcSecurityConfig).toBeDefined();
        expect(serverModule.getCompressionConfig).toBeDefined();
        expect(serverModule.getRpcConfig).toBeDefined();
        expect(serverModule.getRpcClientConfig).toBeDefined();
        expect(serverModule.clearConfigCache).toBeDefined();
    });

    it("should export defineHTTPRequest", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.defineHTTPRequest).toBeDefined();
    });

    it("should export defineMethod", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.defineMethod).toBeDefined();
    });

    it("should export defineWorker", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.defineWorker).toBeDefined();
    });

    it("should export middleware", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.middleware).toBeDefined();
    });

    it("should export startProdServer", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.startProdServer).toBeDefined();
    });

    it("should export env utilities", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.loadEnvFiles).toBeDefined();
        expect(serverModule.injectEnvToProcess).toBeDefined();
    });

    it("should export log utility", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.log).toBeDefined();
    });
});
