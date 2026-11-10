import { describe, expect, it } from "vitest";

// Test that the server barrel export works
describe("server index exports", () => {
    it("should export config functions", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.loadConfig).toBeDefined();
        expect(serverModule.getTrustProxyDepth).toBeDefined();
        expect(serverModule.getRpcSecurityConfig).toBeDefined();
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

    it("should export defineSEOMetadata", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.defineSEOMetadata).toBeDefined();
    });

    it("should export defineWorker", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.defineWorker).toBeDefined();
    });

    it("should export social meta helpers", async () => {
        const serverModule = await import("../../src/server/index");
        expect(serverModule.injectSocialMetaIntoHtml).toBeDefined();
        expect(serverModule.buildSocialMetaTags).toBeDefined();
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

// Compare each formerly star-exported module to prevent accidental API removal.
it("preserves every historical runtime export while isolating generated-code helpers", async () => {
    const server = await import("../../src/server/index");
    const modules = await Promise.all([
        import("../../src/server/config"),
        import("../../src/server/context"),
        import("../../src/server/defineHTTPRequest"),
        import("../../src/server/defineMethod"),
        import("../../src/server/defineSEOMetadata"),
        import("../../src/server/defineServerSideProps"),
        import("../../src/server/defineWorker"),
        import("../../src/server/meta"),
        import("../../src/server/middleware"),
    ]);
    for (const module of modules) {
        for (const [name, value] of Object.entries(module)) {
            expect((server as Record<string, unknown>)[name], name).toBe(value);
        }
    }
    const internal = await import("../../src/internal/index");
    expect(Object.keys(internal).sort()).toEqual(["injectEnvToProcess", "loadEnvFiles", "log"]);
    expect(internal.injectEnvToProcess).toBe(server.injectEnvToProcess);
    expect(internal.loadEnvFiles).toBe(server.loadEnvFiles);
    expect(internal.log).toBe(server.log);
});
