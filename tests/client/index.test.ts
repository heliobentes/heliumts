import { describe, expect, it } from "vitest";

// Test that the client barrel export works
describe("client index exports", () => {
    it("should export AppRouter", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.AppRouter).toBeDefined();
    });

    it("should export Link", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.Link).toBeDefined();
    });

    it("should export Redirect", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.Redirect).toBeDefined();
    });

    it("should export RouterContext", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.RouterContext).toBeDefined();
    });

    it("should export useRouter", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.useRouter).toBeDefined();
    });

    it("should export useCall", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.useCall).toBeDefined();
    });

    it("should export useFetch", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.useFetch).toBeDefined();
    });

    it("should export getRpcTransport", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.getRpcTransport).toBeDefined();
    });

    it("should export isAutoHttpOnMobileEnabled", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.isAutoHttpOnMobileEnabled).toBeDefined();
    });

    it("should export preconnect", async () => {
        const clientModule = await import("../../src/client/index");
        expect(clientModule.preconnect).toBeDefined();
    });
});
