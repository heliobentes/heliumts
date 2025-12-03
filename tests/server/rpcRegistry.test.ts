import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type http from "http";
import type WebSocket from "ws";

import { RpcRegistry, type HttpRpcResult } from "../../src/server/rpcRegistry";
import type { HeliumMethodDef } from "../../src/server/defineMethod";

// Mock WebSocket
function createMockSocket(): WebSocket & { sentMessages: Buffer[] } {
    return {
        send: vi.fn(function (this: WebSocket & { sentMessages: Buffer[] }, data: Buffer) {
            this.sentMessages.push(data);
        }),
        sentMessages: [],
    } as unknown as WebSocket & { sentMessages: Buffer[] };
}

function createMockRequest(): http.IncomingMessage {
    return {
        headers: {
            "user-agent": "test-client",
            "x-forwarded-for": "192.168.1.100",
        },
        url: "/rpc?token=abc",
        method: "GET",
    } as unknown as http.IncomingMessage;
}

describe("RpcRegistry", () => {
    let registry: RpcRegistry;

    beforeEach(() => {
        registry = new RpcRegistry();
    });

    describe("register", () => {
        it("should register a method", () => {
            const method: HeliumMethodDef<{ id: number }, { name: string }> = {
                handler: vi.fn().mockResolvedValue({ name: "Test" }),
            };

            registry.register("getUser", method);

            // Method should be registered - we verify via handleMessage
            expect(method.__id).toBe("getUser");
        });

        it("should set __id on the method definition", () => {
            const method: HeliumMethodDef<unknown, unknown> = {
                handler: vi.fn(),
            };

            registry.register("myMethod", method);

            expect(method.__id).toBe("myMethod");
        });
    });

    describe("setSocketMetadata", () => {
        it("should store socket metadata", () => {
            const socket = createMockSocket();
            const req = createMockRequest();

            registry.setSocketMetadata(socket, "192.168.1.100", req);

            // Metadata is stored internally and used when processing requests
        });
    });

    describe("handleHttpRequest", () => {
        it("should process a single RPC request", async () => {
            const method: HeliumMethodDef<{ id: number }, { name: string }> = {
                handler: vi.fn().mockResolvedValue({ name: "John" }),
            };
            registry.register("getUser", method);

            // Encode a request using msgpack format
            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "getUser", args: { id: 123 } }));
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            expect(result.response).toBeDefined();

            const response = result.response as { id: number; ok: boolean; result?: unknown };
            expect(response.id).toBe(1);
            expect(response.ok).toBe(true);
            expect(response.result).toEqual({ name: "John" });
        });

        it("should process batch RPC requests", async () => {
            const method1: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result1"),
            };
            const method2: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result2"),
            };

            registry.register("method1", method1);
            registry.register("method2", method2);

            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(
                encode([
                    { id: 1, method: "method1", args: {} },
                    { id: 2, method: "method2", args: {} },
                ])
            );
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            expect(Array.isArray(result.response)).toBe(true);
            const responses = result.response as Array<{ id: number; ok: boolean; result?: unknown }>;
            expect(responses.length).toBe(2);
            expect(responses[0].result).toBe("result1");
            expect(responses[1].result).toBe("result2");
        });

        it("should return error for unknown method", async () => {
            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "unknownMethod", args: {} }));
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            const response = result.response as { id: number; ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toContain("unknownMethod");
        });

        it("should return error for handler exceptions", async () => {
            const method: HeliumMethodDef<unknown, unknown> = {
                handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
            };
            registry.register("failingMethod", method);

            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "failingMethod", args: {} }));
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            const response = result.response as { id: number; ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toBe("Handler failed");
        });

        it("should return error for invalid request format", async () => {
            const reqBody = Buffer.from("invalid data");
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            const response = result.response as { ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toBe("Invalid request format");
        });
    });

    describe("setMiddleware", () => {
        it("should execute middleware for HTTP requests", async () => {
            const middlewareCalls: string[] = [];

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockImplementation(() => {
                    middlewareCalls.push("handler");
                    return "result";
                }),
            };
            registry.register("testMethod", method);

            registry.setMiddleware({
                handler: async (ctx, next) => {
                    middlewareCalls.push("middleware-before");
                    await next();
                    middlewareCalls.push("middleware-after");
                },
            });

            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "testMethod", args: {} }));
            const httpReq = createMockRequest();

            await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            expect(middlewareCalls).toEqual(["middleware-before", "handler", "middleware-after"]);
        });

        it("should block request if middleware does not call next", async () => {
            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result"),
            };
            registry.register("blockedMethod", method);

            registry.setMiddleware({
                handler: async () => {
                    // Does not call next()
                },
            });

            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "blockedMethod", args: {} }));
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            const response = result.response as { ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toBe("Request blocked by middleware");
            expect(method.handler).not.toHaveBeenCalled();
        });
    });

    describe("setRateLimiter", () => {
        it("should track rate limit stats in response", async () => {
            const mockRateLimiter = {
                getConnectionStats: vi.fn().mockReturnValue({
                    remainingMessages: 95,
                    resetTimeMs: Date.now() + 60000,
                }),
            };

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result"),
            };
            registry.register("limitedMethod", method);
            registry.setRateLimiter(mockRateLimiter as unknown as Parameters<typeof registry.setRateLimiter>[0]);

            // For HTTP, we use handleHttpRequest which doesn't use socket-based rate limiting
            // but the response should include stats
            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "limitedMethod", args: {} }));
            const httpReq = createMockRequest();

            const result = await registry.handleHttpRequest(reqBody, "127.0.0.1", httpReq);

            const response = result.response as { stats: { remainingRequests: number; resetInSeconds: number } };
            expect(response.stats).toBeDefined();
            // HTTP requests don't go through rate limiter, so stats are default
            expect(response.stats.remainingRequests).toBe(Infinity);
        });
    });

    describe("context building", () => {
        it("should pass context with IP and headers to handler", async () => {
            let capturedCtx: unknown;

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockImplementation((args, ctx) => {
                    capturedCtx = ctx;
                    return "result";
                }),
            };
            registry.register("contextMethod", method);

            const { encode } = await import("@msgpack/msgpack");
            const reqBody = Buffer.from(encode({ id: 1, method: "contextMethod", args: {} }));
            const httpReq = {
                headers: { "user-agent": "my-client", authorization: "Bearer token" },
                url: "/rpc",
                method: "POST",
            } as unknown as http.IncomingMessage;

            await registry.handleHttpRequest(reqBody, "10.0.0.50", httpReq);

            const ctx = capturedCtx as { req: { ip: string; headers: Record<string, string>; url?: string; method?: string } };
            expect(ctx.req.ip).toBe("10.0.0.50");
            expect(ctx.req.headers["user-agent"]).toBe("my-client");
            expect(ctx.req.headers.authorization).toBe("Bearer token");
            expect(ctx.req.url).toBe("/rpc");
            expect(ctx.req.method).toBe("POST");
        });
    });

    describe("handleMessage (WebSocket)", () => {
        it("should process a single WebSocket RPC request", async () => {
            const method: HeliumMethodDef<{ id: number }, { name: string }> = {
                handler: vi.fn().mockResolvedValue({ name: "WebSocket User" }),
            };
            registry.register("wsGetUser", method);

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "192.168.1.50", req);

            const { encode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsGetUser", args: { id: 456 } }));

            await registry.handleMessage(socket, message);

            expect(socket.send).toHaveBeenCalled();
            expect(method.handler).toHaveBeenCalled();
        });

        it("should process batch WebSocket RPC requests", async () => {
            const method1: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("ws-result1"),
            };
            const method2: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("ws-result2"),
            };

            registry.register("wsMethod1", method1);
            registry.register("wsMethod2", method2);

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "192.168.1.50", req);

            const { encode } = await import("@msgpack/msgpack");
            const message = Buffer.from(
                encode([
                    { id: 1, method: "wsMethod1", args: {} },
                    { id: 2, method: "wsMethod2", args: {} },
                ])
            );

            await registry.handleMessage(socket, message);

            expect(method1.handler).toHaveBeenCalled();
            expect(method2.handler).toHaveBeenCalled();
            expect(socket.send).toHaveBeenCalled();
        });

        it("should return error for unknown method via WebSocket", async () => {
            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "192.168.1.50", req);

            const { encode, decode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "unknownWsMethod", args: {} }));

            await registry.handleMessage(socket, message);

            expect(socket.send).toHaveBeenCalled();
            // Response should contain error
            const sentData = socket.sentMessages[0];
            const response = decode(sentData) as { id: number; ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toContain("unknownWsMethod");
        });

        it("should handle WebSocket handler exceptions", async () => {
            const method: HeliumMethodDef<unknown, unknown> = {
                handler: vi.fn().mockRejectedValue(new Error("WebSocket handler failed")),
            };
            registry.register("wsFailingMethod", method);

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "192.168.1.50", req);

            const { encode, decode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsFailingMethod", args: {} }));

            await registry.handleMessage(socket, message);

            expect(socket.send).toHaveBeenCalled();
            const sentData = socket.sentMessages[0];
            const response = decode(sentData) as { id: number; ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toBe("WebSocket handler failed");
        });

        it("should silently ignore invalid message format", async () => {
            const socket = createMockSocket();

            // Send invalid data that can't be decoded
            await registry.handleMessage(socket, "invalid data not msgpack");

            // Should not throw and should not send any response
            expect(socket.send).not.toHaveBeenCalled();
        });

        it("should use socket metadata for context in WebSocket requests", async () => {
            let capturedCtx: unknown;

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockImplementation((args, ctx) => {
                    capturedCtx = ctx;
                    return "result";
                }),
            };
            registry.register("wsContextMethod", method);

            const socket = createMockSocket();
            const req = {
                headers: { "x-custom-header": "custom-value" },
                url: "/rpc?token=xyz",
                method: "GET",
            } as unknown as http.IncomingMessage;
            registry.setSocketMetadata(socket, "10.20.30.40", req);

            const { encode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsContextMethod", args: {} }));

            await registry.handleMessage(socket, message);

            const ctx = capturedCtx as { req: { ip: string; headers: Record<string, string> } };
            expect(ctx.req.ip).toBe("10.20.30.40");
            expect(ctx.req.headers["x-custom-header"]).toBe("custom-value");
        });

        it("should use 'unknown' IP when no socket metadata is set", async () => {
            let capturedCtx: unknown;

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockImplementation((args, ctx) => {
                    capturedCtx = ctx;
                    return "result";
                }),
            };
            registry.register("noMetadataMethod", method);

            const socket = createMockSocket();
            // Don't set socket metadata

            const { encode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "noMetadataMethod", args: {} }));

            await registry.handleMessage(socket, message);

            const ctx = capturedCtx as { req: { ip: string } };
            expect(ctx.req.ip).toBe("unknown");
        });

        it("should execute middleware for WebSocket requests", async () => {
            const middlewareCalls: string[] = [];

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockImplementation(() => {
                    middlewareCalls.push("handler");
                    return "result";
                }),
            };
            registry.register("wsMiddlewareMethod", method);

            registry.setMiddleware({
                handler: async (ctx, next) => {
                    middlewareCalls.push("middleware-before");
                    await next();
                    middlewareCalls.push("middleware-after");
                },
            });

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "127.0.0.1", req);

            const { encode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsMiddlewareMethod", args: {} }));

            await registry.handleMessage(socket, message);

            expect(middlewareCalls).toEqual(["middleware-before", "handler", "middleware-after"]);
        });

        it("should block WebSocket request if middleware does not call next", async () => {
            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result"),
            };
            registry.register("wsBlockedMethod", method);

            registry.setMiddleware({
                handler: async () => {
                    // Does not call next()
                },
            });

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "127.0.0.1", req);

            const { encode, decode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsBlockedMethod", args: {} }));

            await registry.handleMessage(socket, message);

            expect(method.handler).not.toHaveBeenCalled();
            const sentData = socket.sentMessages[0];
            const response = decode(sentData) as { ok: boolean; error?: string };
            expect(response.ok).toBe(false);
            expect(response.error).toBe("Request blocked by middleware");
        });
    });

    describe("rate limiter with WebSocket", () => {
        it("should include rate limit stats in WebSocket response", async () => {
            const mockRateLimiter = {
                getConnectionStats: vi.fn().mockReturnValue({
                    remainingMessages: 42,
                    resetTimeMs: Date.now() + 30000,
                }),
            };

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result"),
            };
            registry.register("wsRateLimitedMethod", method);
            registry.setRateLimiter(mockRateLimiter as unknown as Parameters<typeof registry.setRateLimiter>[0]);

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "127.0.0.1", req);

            const { encode, decode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "wsRateLimitedMethod", args: {} }));

            await registry.handleMessage(socket, message);

            const sentData = socket.sentMessages[0];
            const response = decode(sentData) as { stats: { remainingRequests: number; resetInSeconds: number } };
            expect(response.stats).toBeDefined();
            expect(response.stats.remainingRequests).toBe(42);
            expect(response.stats.resetInSeconds).toBeGreaterThan(0);
        });

        it("should return zero remaining when rate limiter has no stats", async () => {
            const mockRateLimiter = {
                getConnectionStats: vi.fn().mockReturnValue(null),
            };

            const method: HeliumMethodDef<unknown, string> = {
                handler: vi.fn().mockResolvedValue("result"),
            };
            registry.register("noStatsMethod", method);
            registry.setRateLimiter(mockRateLimiter as unknown as Parameters<typeof registry.setRateLimiter>[0]);

            const socket = createMockSocket();
            const req = createMockRequest();
            registry.setSocketMetadata(socket, "127.0.0.1", req);

            const { encode, decode } = await import("@msgpack/msgpack");
            const message = Buffer.from(encode({ id: 1, method: "noStatsMethod", args: {} }));

            await registry.handleMessage(socket, message);

            const sentData = socket.sentMessages[0];
            const response = decode(sentData) as { stats: { remainingRequests: number; resetInSeconds: number } };
            expect(response.stats.remainingRequests).toBe(0);
            expect(response.stats.resetInSeconds).toBe(0);
        });
    });
});
