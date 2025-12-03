import { describe, expect, it } from "vitest";
import type http from "http";

import type { HeliumContext } from "../../src/server/context";

describe("context", () => {
    describe("HeliumContext interface", () => {
        it("should have req property with expected shape", () => {
            const mockReq = {
                on: () => {},
                headers: {},
            } as unknown as http.IncomingMessage;

            const ctx: HeliumContext = {
                req: {
                    ip: "192.168.1.1",
                    headers: { "user-agent": "test" },
                    url: "/api/test",
                    method: "POST",
                    raw: mockReq,
                },
            };

            expect(ctx.req.ip).toBe("192.168.1.1");
            expect(ctx.req.headers["user-agent"]).toBe("test");
            expect(ctx.req.url).toBe("/api/test");
            expect(ctx.req.method).toBe("POST");
            expect(ctx.req.raw).toBe(mockReq);
        });

        it("should allow optional url and method", () => {
            const mockReq = {
                on: () => {},
                headers: {},
            } as unknown as http.IncomingMessage;

            const ctx: HeliumContext = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    raw: mockReq,
                },
            };

            expect(ctx.req.url).toBeUndefined();
            expect(ctx.req.method).toBeUndefined();
        });

        it("should allow custom properties via index signature", () => {
            const mockReq = {
                on: () => {},
                headers: {},
            } as unknown as http.IncomingMessage;

            const ctx: HeliumContext = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    raw: mockReq,
                },
                userId: "user-123",
                isAdmin: true,
                permissions: ["read", "write"],
            };

            expect(ctx.userId).toBe("user-123");
            expect(ctx.isAdmin).toBe(true);
            expect(ctx.permissions).toEqual(["read", "write"]);
        });

        it("should preserve headers from IncomingMessage", () => {
            const ctx: HeliumContext = {
                req: {
                    ip: "10.0.0.1",
                    headers: {
                        "content-type": "application/json",
                        authorization: "Bearer token123",
                        "x-custom-header": "custom-value",
                    },
                    raw: {} as http.IncomingMessage,
                },
            };

            expect(ctx.req.headers["content-type"]).toBe("application/json");
            expect(ctx.req.headers.authorization).toBe("Bearer token123");
            expect(ctx.req.headers["x-custom-header"]).toBe("custom-value");
        });
    });

    describe("context usage patterns", () => {
        it("should be usable in middleware to add properties", () => {
            const mockReq = {} as http.IncomingMessage;

            // Simulate middleware adding auth info
            function authMiddleware(ctx: HeliumContext) {
                ctx.user = { id: "123", name: "John" };
                ctx.authenticated = true;
            }

            const ctx: HeliumContext = {
                req: {
                    ip: "192.168.1.100",
                    headers: { authorization: "Bearer xyz" },
                    raw: mockReq,
                },
            };

            authMiddleware(ctx);

            expect(ctx.user).toEqual({ id: "123", name: "John" });
            expect(ctx.authenticated).toBe(true);
        });

        it("should be usable in method handlers", async () => {
            type Handler<TArgs, TResult> = (args: TArgs, ctx: HeliumContext) => Promise<TResult>;

            const mockReq = {} as http.IncomingMessage;

            const handler: Handler<{ name: string }, { greeting: string }> = async (args, ctx) => {
                const ip = ctx.req.ip;
                return { greeting: `Hello ${args.name} from ${ip}` };
            };

            const ctx: HeliumContext = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    raw: mockReq,
                },
            };

            // Verify handler can use context
            await expect(handler({ name: "World" }, ctx)).resolves.toEqual({
                greeting: "Hello World from 127.0.0.1",
            });
        });
    });
});
