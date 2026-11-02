import { describe, expect, it } from "vitest";

import type { MethodStub } from "../../src/client/types";
import { defineMethod } from "../../src/server/defineMethod";

describe("client types", () => {
    it("represents a method with a typed handler", () => {
        const stub: MethodStub<{ id: number }, { name: string }> = {
            __kind: "method",
            __id: "test.method",
            handler: ({ id }) => ({ name: String(id) }),
        };

        expect(stub.__id).toBe("test.method");
        expect(stub.handler({ id: 1 }, undefined)).toEqual({ name: "1" });
    });

    it("accepts server method definitions as client method stubs", async () => {
        const serverMethod = defineMethod(async ({ id }: { id: number }) => ({ success: id > 0 }));
        const stub: MethodStub<{ id: number }, { success: boolean }> = serverMethod;

        expect(stub.__kind).toBe("method");
        expect(await stub.handler({ id: 1 }, undefined)).toEqual({ success: true });
    });

    it("preserves generic argument and result types", () => {
        interface UserArgs {
            userId: string;
        }

        interface UserResult {
            name: string;
            email: string;
        }

        const stub: MethodStub<UserArgs, UserResult> = {
            __kind: "method",
            __id: "users.getUser",
            handler: ({ userId }) => ({ name: userId, email: `${userId}@example.com` }),
        };

        expect(stub.handler({ userId: "alice" }, undefined)).toEqual({ name: "alice", email: "alice@example.com" });
    });
});
