import { describe, expect, it } from "vitest";

import { defineMiddleware, middleware, type HeliumMiddleware, type MiddlewareContext } from "../../src/server/middleware";

describe("middleware", () => {
    describe("middleware function", () => {
        it("should create a middleware definition", () => {
            const handler = async (context: MiddlewareContext, next: () => Promise<void>) => {
                await next();
            };

            const mw = middleware(handler);

            expect(mw.__kind).toBe("middleware");
            expect(mw.handler).toBe(handler);
        });

        it("should throw when handler is not provided", () => {
            expect(() => middleware(null as unknown as (ctx: MiddlewareContext, next: () => Promise<void>) => void)).toThrow(
                "middleware requires a handler"
            );
        });

        it("should allow middleware to call next()", async () => {
            let nextCalled = false;

            const mw = middleware(async (context, next) => {
                await next();
                nextCalled = true;
            });

            await mw.handler(
                {
                    ctx: { req: {} } as MiddlewareContext["ctx"],
                    type: "method",
                    methodName: "test",
                },
                async () => {}
            );

            expect(nextCalled).toBe(true);
        });

        it("should allow middleware to block by not calling next()", async () => {
            let handlerExecuted = false;

            const mw = middleware(async (context, next) => {
                // Don't call next() - blocking the request
                return;
            });

            await mw.handler(
                {
                    ctx: { req: {} } as MiddlewareContext["ctx"],
                    type: "method",
                    methodName: "test",
                },
                async () => {
                    handlerExecuted = true;
                }
            );

            expect(handlerExecuted).toBe(false);
        });

        it("should provide context information to middleware", async () => {
            let capturedContext: MiddlewareContext | null = null;

            const mw = middleware(async (context, next) => {
                capturedContext = context;
                await next();
            });

            const testContext: MiddlewareContext = {
                ctx: {
                    req: {
                        ip: "192.168.1.1",
                        headers: { authorization: "Bearer token" },
                        raw: {} as MiddlewareContext["ctx"]["req"]["raw"],
                    },
                },
                type: "method",
                methodName: "getUser",
            };

            await mw.handler(testContext, async () => {});

            expect(capturedContext).not.toBeNull();
            expect(capturedContext!.type).toBe("method");
            expect(capturedContext!.methodName).toBe("getUser");
            expect(capturedContext!.ctx.req.ip).toBe("192.168.1.1");
        });

        it("should support http type context", async () => {
            let capturedContext: MiddlewareContext | null = null;

            const mw = middleware(async (context, next) => {
                capturedContext = context;
                await next();
            });

            const testContext: MiddlewareContext = {
                ctx: {
                    req: {
                        ip: "192.168.1.1",
                        headers: {},
                        raw: {} as MiddlewareContext["ctx"]["req"]["raw"],
                    },
                },
                type: "http",
                httpMethod: "POST",
                httpPath: "/api/users",
            };

            await mw.handler(testContext, async () => {});

            expect(capturedContext!.type).toBe("http");
            expect(capturedContext!.httpMethod).toBe("POST");
            expect(capturedContext!.httpPath).toBe("/api/users");
        });
    });

    describe("defineMiddleware (alias)", () => {
        it("should be an alias for middleware function", () => {
            expect(defineMiddleware).toBe(middleware);
        });

        it("should work the same as middleware", () => {
            const handler = async (context: MiddlewareContext, next: () => Promise<void>) => {
                await next();
            };

            const mw = defineMiddleware(handler);

            expect(mw.__kind).toBe("middleware");
            expect(mw.handler).toBe(handler);
        });
    });

    describe("middleware patterns", () => {
        it("should support auth middleware pattern", async () => {
            const authMiddleware = middleware(async (context, next) => {
                const authHeader = context.ctx.req.headers.authorization;

                if (!authHeader || !authHeader.toString().startsWith("Bearer ")) {
                    // Block unauthorized requests
                    return;
                }

                // Add user info to context
                context.ctx.user = { id: 1, name: "Test User" };
                await next();
            });

            let handlerCalled = false;
            const testContext: MiddlewareContext = {
                ctx: {
                    req: {
                        ip: "192.168.1.1",
                        headers: { authorization: "Bearer valid-token" },
                        raw: {} as MiddlewareContext["ctx"]["req"]["raw"],
                    },
                },
                type: "method",
                methodName: "protectedMethod",
            };

            await authMiddleware.handler(testContext, async () => {
                handlerCalled = true;
            });

            expect(handlerCalled).toBe(true);
            expect(testContext.ctx.user).toEqual({ id: 1, name: "Test User" });
        });

        it("should support logging middleware pattern", async () => {
            const logs: string[] = [];

            const loggingMiddleware = middleware(async (context, next) => {
                const start = Date.now();
                logs.push(`[START] ${context.type}: ${context.methodName || context.httpPath}`);

                await next();

                const duration = Date.now() - start;
                logs.push(`[END] ${context.type}: ${context.methodName || context.httpPath} (${duration}ms)`);
            });

            const testContext: MiddlewareContext = {
                ctx: {
                    req: {
                        ip: "192.168.1.1",
                        headers: {},
                        raw: {} as MiddlewareContext["ctx"]["req"]["raw"],
                    },
                },
                type: "method",
                methodName: "doSomething",
            };

            await loggingMiddleware.handler(testContext, async () => {
                // Simulate some work
                await new Promise((resolve) => setTimeout(resolve, 10));
            });

            expect(logs).toHaveLength(2);
            expect(logs[0]).toContain("[START]");
            expect(logs[1]).toContain("[END]");
        });
    });
});
