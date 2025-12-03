import { describe, expect, it } from "vitest";

import type { MethodStub } from "../../src/client/types";

describe("client types", () => {
    it("should define MethodStub type", () => {
        // Type-only test - verify the structure works at runtime
        const stub: MethodStub<{ id: number }, { name: string }> = {
            __id: "test.method",
        };

        expect(stub.__id).toBe("test.method");
    });

    it("should allow optional __args and __result", () => {
        const stub: MethodStub = {
            __id: "test.method",
            __args: { id: 1 },
            __result: { success: true },
        };

        expect(stub.__id).toBe("test.method");
        expect(stub.__args).toEqual({ id: 1 });
        expect(stub.__result).toEqual({ success: true });
    });

    it("should work with generic types", () => {
        interface UserArgs {
            userId: string;
        }

        interface UserResult {
            name: string;
            email: string;
        }

        const stub: MethodStub<UserArgs, UserResult> = {
            __id: "users.getUser",
        };

        expect(stub.__id).toBe("users.getUser");
    });
});
