import { describe, expect, it } from "vitest";

import { compareRoutePatterns } from "../../src/runtime/routeOrder";

describe("route specificity", () => {
    it("prefers an earlier static segment over a longer dynamic parameter name", () => {
        const patterns = ["/:longParameter/edit", "/users/:id"];
        expect(patterns.sort(compareRoutePatterns)).toEqual(["/users/:id", "/:longParameter/edit"]);
    });

    it("prefers static, dynamic, then catch-all at the first differing segment", () => {
        const patterns = ["/users/*path", "/users/:id", "/users/new"];
        expect(patterns.sort(compareRoutePatterns)).toEqual(["/users/new", "/users/:id", "/users/*path"]);
    });

    it("prefers an exact route over a catch-all matching an empty suffix", () => {
        const patterns = ["/*slug", "/users/*path", "/users", "/"];
        expect(patterns.sort(compareRoutePatterns)).toEqual(["/", "/users", "/users/*path", "/*slug"]);
    });
});
