import { describe, expect, it } from "vitest";

import type { RpcBatchRequest, RpcBatchResponse, RpcError, RpcRequest, RpcResponse, RpcStats, RpcSuccess } from "../../src/runtime/protocol";

describe("protocol types", () => {
    describe("RpcRequest", () => {
        it("should allow valid RPC request with string id", () => {
            const request: RpcRequest = {
                id: "req-123",
                method: "getUser",
                args: { userId: 1 },
            };

            expect(request.id).toBe("req-123");
            expect(request.method).toBe("getUser");
            expect(request.args).toEqual({ userId: 1 });
        });

        it("should allow valid RPC request with number id", () => {
            const request: RpcRequest = {
                id: 123,
                method: "getUser",
            };

            expect(request.id).toBe(123);
            expect(request.method).toBe("getUser");
            expect(request.args).toBeUndefined();
        });

        it("should allow request without args", () => {
            const request: RpcRequest = {
                id: 1,
                method: "healthCheck",
            };

            expect(request.args).toBeUndefined();
        });
    });

    describe("RpcStats", () => {
        it("should represent rate limiting stats", () => {
            const stats: RpcStats = {
                remainingRequests: 95,
                resetInSeconds: 55,
            };

            expect(stats.remainingRequests).toBe(95);
            expect(stats.resetInSeconds).toBe(55);
        });
    });

    describe("RpcSuccess", () => {
        it("should represent a successful response", () => {
            const response: RpcSuccess = {
                id: "req-123",
                ok: true,
                stats: {
                    remainingRequests: 95,
                    resetInSeconds: 55,
                },
                result: { user: { id: 1, name: "Test" } },
            };

            expect(response.ok).toBe(true);
            expect(response.result).toEqual({ user: { id: 1, name: "Test" } });
        });
    });

    describe("RpcError", () => {
        it("should represent an error response", () => {
            const response: RpcError = {
                id: "req-123",
                ok: false,
                stats: {
                    remainingRequests: 0,
                    resetInSeconds: 30,
                },
                error: "Rate limit exceeded",
            };

            expect(response.ok).toBe(false);
            expect(response.error).toBe("Rate limit exceeded");
        });
    });

    describe("RpcResponse", () => {
        it("should be a union of success and error", () => {
            const success: RpcResponse = {
                id: 1,
                ok: true,
                stats: { remainingRequests: 100, resetInSeconds: 60 },
                result: "data",
            };

            const error: RpcResponse = {
                id: 1,
                ok: false,
                stats: { remainingRequests: 100, resetInSeconds: 60 },
                error: "Something went wrong",
            };

            // Type narrowing should work
            if (success.ok) {
                expect(success.result).toBe("data");
            }

            if (!error.ok) {
                expect(error.error).toBe("Something went wrong");
            }
        });
    });

    describe("RpcBatchRequest", () => {
        it("should be an array of RpcRequest", () => {
            const batch: RpcBatchRequest = [
                { id: 1, method: "getUser", args: { id: 1 } },
                { id: 2, method: "getUser", args: { id: 2 } },
                { id: 3, method: "listUsers" },
            ];

            expect(batch).toHaveLength(3);
            expect(batch[0].method).toBe("getUser");
            expect(batch[2].args).toBeUndefined();
        });
    });

    describe("RpcBatchResponse", () => {
        it("should be an array of RpcResponse", () => {
            const batch: RpcBatchResponse = [
                { id: 1, ok: true, stats: { remainingRequests: 98, resetInSeconds: 60 }, result: { name: "User 1" } },
                { id: 2, ok: false, stats: { remainingRequests: 97, resetInSeconds: 60 }, error: "Not found" },
                { id: 3, ok: true, stats: { remainingRequests: 96, resetInSeconds: 60 }, result: [] },
            ];

            expect(batch).toHaveLength(3);
            expect(batch[0].ok).toBe(true);
            expect(batch[1].ok).toBe(false);
        });
    });
});
