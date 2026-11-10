import { describe, expect, it } from "vitest";

import { getMethodId, type MethodReference } from "../../src/client/types";
import { defineMethod } from "../../src/server/defineMethod";
import { methodReference } from "./methodReference";

describe("generated method references", () => {
    it("carries only the RPC identifier at runtime", () => {
        const method = methodReference<{ id: number }, { name: string }>("users.read");
        expect(getMethodId(method)).toBe("users.read");
        expect(Object.keys(method)).toEqual(["__id"]);
        expect(method).not.toHaveProperty("handler");
        expect(method).not.toHaveProperty("__kind");
    });

    it("rejects server implementations and malformed references before transport", () => {
        const serverMethod = defineMethod(({ id }: { id: number }) => ({ name: String(id) }));
        for (const value of [serverMethod, undefined, null, "users.read", {}, { __id: "" }, { __id: 42 }, { __id: "users.read", handler: () => true }]) {
            expect(() => getMethodId(value as unknown as MethodReference)).toThrow(/generated RPC reference/);
        }
    });
});
