import { describe, expect, it } from "vitest";

import { defineHTTPRequest, type HeliumHTTPDef, type HTTPMethod, type HTTPRequest } from "../../src/server/defineHTTPRequest";
import type { HeliumContext } from "../../src/server/context";

describe("defineHTTPRequest", () => {
    describe("defineHTTPRequest function", () => {
        it("should create an HTTP handler definition for GET", () => {
            const handler = defineHTTPRequest("GET", "/api/users", async (req, ctx) => {
                return { users: [] };
            });

            expect(handler.__kind).toBe("http");
            expect(handler.method).toBe("GET");
            expect(handler.path).toBe("/api/users");
        });

        it("should create an HTTP handler definition for POST", () => {
            const handler = defineHTTPRequest("POST", "/api/users", async (req, ctx) => {
                const body = await req.json();
                return { created: true };
            });

            expect(handler.__kind).toBe("http");
            expect(handler.method).toBe("POST");
            expect(handler.path).toBe("/api/users");
        });

        it("should support all HTTP methods", () => {
            const methods: HTTPMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL"];

            for (const method of methods) {
                const handler = defineHTTPRequest(method, "/test", async (req, ctx) => ({}));
                expect(handler.method).toBe(method);
            }
        });

        it("should throw when method is not provided", () => {
            expect(() =>
                defineHTTPRequest("" as HTTPMethod, "/path", async (req, ctx) => ({}))
            ).toThrow("defineHTTPRequest requires a method");
        });

        it("should throw when path is not provided", () => {
            expect(() =>
                defineHTTPRequest("GET", "", async (req, ctx) => ({}))
            ).toThrow("defineHTTPRequest requires a path");
        });

        it("should throw when handler is not provided", () => {
            expect(() =>
                defineHTTPRequest("GET", "/path", null as unknown as (req: HTTPRequest, ctx: HeliumContext) => Promise<unknown>)
            ).toThrow("defineHTTPRequest requires a handler");
        });

        it("should support dynamic path parameters", () => {
            const handler = defineHTTPRequest("GET", "/api/users/:id", async (req, ctx) => {
                const userId = req.params.id;
                return { userId };
            });

            expect(handler.path).toBe("/api/users/:id");
        });

        it("should support multiple path parameters", () => {
            const handler = defineHTTPRequest("GET", "/api/orgs/:orgId/users/:userId", async (req, ctx) => {
                return {
                    orgId: req.params.orgId,
                    userId: req.params.userId,
                };
            });

            expect(handler.path).toBe("/api/orgs/:orgId/users/:userId");
        });

        it("should preserve handler reference", () => {
            const handlerFn = async (req: HTTPRequest, ctx: HeliumContext) => {
                return { success: true };
            };

            const handler = defineHTTPRequest("GET", "/test", handlerFn);

            expect(handler.handler).toBe(handlerFn);
        });

        it("should support synchronous handlers", () => {
            const handler = defineHTTPRequest("GET", "/sync", (req, ctx) => {
                return { sync: true };
            });

            expect(handler.__kind).toBe("http");
        });

        it("should allow accessing request properties in handler", async () => {
            const handler = defineHTTPRequest("POST", "/api/data", async (req, ctx) => {
                return {
                    method: req.method,
                    path: req.path,
                    query: req.query,
                    params: req.params,
                };
            });

            // Create a mock request
            const mockReq: HTTPRequest = {
                method: "POST",
                path: "/api/data",
                headers: {},
                query: { filter: "active" },
                params: {},
                cookies: {},
                json: async () => ({}),
                text: async () => "",
                formData: async () => new FormData(),
                toWebRequest: async () => new Request("http://localhost/api/data"),
            };

            const mockCtx: HeliumContext = {
                req: {
                    ip: "127.0.0.1",
                    headers: {},
                    raw: {} as HeliumContext["req"]["raw"],
                },
            };

            const result = await handler.handler(mockReq, mockCtx);

            expect(result).toEqual({
                method: "POST",
                path: "/api/data",
                query: { filter: "active" },
                params: {},
            });
        });
    });

    describe("HTTPRequest interface", () => {
        it("should have all required properties", () => {
            const mockReq: HTTPRequest = {
                method: "GET",
                path: "/test",
                headers: { "content-type": "application/json" },
                query: { page: "1" },
                params: { id: "123" },
                cookies: { session: "abc" },
                json: async () => ({ data: "test" }),
                text: async () => "text content",
                formData: async () => new FormData(),
                toWebRequest: async () => new Request("http://localhost/test"),
            };

            expect(mockReq.method).toBe("GET");
            expect(mockReq.path).toBe("/test");
            expect(mockReq.headers["content-type"]).toBe("application/json");
            expect(mockReq.query.page).toBe("1");
            expect(mockReq.params.id).toBe("123");
            expect(mockReq.cookies.session).toBe("abc");
        });

        it("should support body parsing methods", async () => {
            const mockReq: HTTPRequest = {
                method: "POST",
                path: "/test",
                headers: {},
                query: {},
                params: {},
                cookies: {},
                json: async () => ({ name: "Test", value: 42 }),
                text: async () => '{"name":"Test","value":42}',
                formData: async () => {
                    const fd = new FormData();
                    fd.append("field", "value");
                    return fd;
                },
                toWebRequest: async () => new Request("http://localhost/test"),
            };

            const jsonBody = await mockReq.json();
            expect(jsonBody).toEqual({ name: "Test", value: 42 });

            const textBody = await mockReq.text();
            expect(textBody).toBe('{"name":"Test","value":42}');
        });
    });
});
