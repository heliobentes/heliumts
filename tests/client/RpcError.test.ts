import { describe, expect, it } from "vitest";

import { RpcError } from "../../src/client/RpcError";

describe("RpcError", () => {
    it("should be an instance of Error", () => {
        const err = new RpcError("Something went wrong");
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(RpcError);
    });

    it("should have the correct name", () => {
        const err = new RpcError("fail");
        expect(err.name).toBe("RpcError");
    });

    it("should carry the error message", () => {
        const err = new RpcError("Server exploded");
        expect(err.message).toBe("Server exploded");
    });

    it("should carry stats when provided", () => {
        const stats = { remainingRequests: 5, resetInSeconds: 30 };
        const err = new RpcError("rate limited", stats);
        expect(err.stats).toEqual(stats);
    });

    it("should default stats to null when omitted", () => {
        const err = new RpcError("no stats");
        expect(err.stats).toBeNull();
    });

    it("should default stats to null when passed null", () => {
        const err = new RpcError("null stats", null);
        expect(err.stats).toBeNull();
    });

    it("should produce a useful stack trace", () => {
        const err = new RpcError("trace me");
        expect(err.stack).toBeDefined();
        expect(err.stack).toContain("trace me");
    });

    it("should be catchable with try/catch", () => {
        expect(() => {
            throw new RpcError("catch me");
        }).toThrow(RpcError);

        expect(() => {
            throw new RpcError("catch me");
        }).toThrow("catch me");
    });
});
