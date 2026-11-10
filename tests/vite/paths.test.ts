import { describe, expect, it } from "vitest";

import {
    RESOLVED_VIRTUAL_ENTRY_MODULE_ID,
    RESOLVED_VIRTUAL_SERVER_MANIFEST_ID,
    SERVER_DIR,
    VIRTUAL_ENTRY_MODULE_ID,
    VIRTUAL_SERVER_MANIFEST_ID,
} from "../../src/vite/paths";

describe("paths", () => {
    describe("SERVER_DIR", () => {
        it("should be src/server", () => {
            expect(SERVER_DIR).toBe("src/server");
        });
    });

    describe("virtual module IDs", () => {
        it("should have correct virtual server manifest ID", () => {
            expect(VIRTUAL_SERVER_MANIFEST_ID).toBe("heliumts/__serverManifest");
        });

        it("should have correct virtual entry module ID", () => {
            expect(VIRTUAL_ENTRY_MODULE_ID).toBe("virtual:heliumts/entry");
        });
    });

    describe("resolved virtual module IDs", () => {
        it("should prefix with null character", () => {
            expect(RESOLVED_VIRTUAL_SERVER_MANIFEST_ID).toBe("\0heliumts/__serverManifest");
            expect(RESOLVED_VIRTUAL_ENTRY_MODULE_ID).toBe("\0virtual:heliumts/entry");
        });
    });
});
