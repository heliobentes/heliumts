import { describe, expect, it } from "vitest";

import * as helium from "../src/index";

describe("helium main entry", () => {
    it("should export client module", () => {
        expect(helium.client).toBeDefined();
    });

    it("should export server module", () => {
        expect(helium.server).toBeDefined();
    });

    it("should export vite module", () => {
        expect(helium.vite).toBeDefined();
    });
});
