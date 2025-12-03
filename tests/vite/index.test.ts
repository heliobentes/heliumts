import { describe, expect, it } from "vitest";

// Test that the vite barrel export works
describe("vite index exports", () => {
    it("should export helium plugin as default", async () => {
        const viteModule = await import("../../src/vite/index");
        expect(viteModule.default).toBeDefined();
        expect(typeof viteModule.default).toBe("function");
    });

    it("should return a Vite plugin when called", async () => {
        const viteModule = await import("../../src/vite/index");
        const plugin = viteModule.default();

        expect(plugin).toBeDefined();
        expect(plugin.name).toBe("vite-plugin-helium");
    });
});
