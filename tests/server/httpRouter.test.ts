/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HeliumHTTPDef } from "../../src/server/defineHTTPRequest";
import { type HTTPRoute, HTTPRouter } from "../../src/server/httpRouter";

describe("HTTPRouter", () => {
    let router: HTTPRouter;

    beforeEach(() => {
        router = new HTTPRouter();
    });

    describe("registerRoutes", () => {
        it("should register routes", () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/users",
                handler: vi.fn(),
            };

            const routes: HTTPRoute[] = [{ name: "getUsers", handler: mockHandler }];

            router.registerRoutes(routes);

            // Router should have registered the route internally
            // We'll test this via handleRequest
        });
    });

    describe("setTrustProxyDepth", () => {
        it("should set trust proxy depth", () => {
            router.setTrustProxyDepth(2);
            // Depth is used internally - we verify via integration test
        });
    });

    describe("handleRequest", () => {
        function createMockReq(method: string, url: string): IncomingMessage {
            return {
                method,
                url,
                headers: {},
                on: vi.fn(),
                socket: {
                    remoteAddress: "127.0.0.1",
                },
            } as unknown as IncomingMessage;
        }

        function createMockRes(): ServerResponse & {
            writtenHead?: { status: number; headers: Record<string, string> };
            writtenBody?: string;
        } {
            const res = {
                writeHead: vi.fn(function (this: ServerResponse & { writtenHead?: unknown }, status: number, headers: Record<string, string>) {
                    this.writtenHead = { status, headers };
                }),
                end: vi.fn(function (this: ServerResponse & { writtenBody?: string }, body?: string) {
                    this.writtenBody = body;
                }),
                setHeader: vi.fn(),
                statusCode: 200,
            } as unknown as ServerResponse & {
                writtenHead?: { status: number; headers: Record<string, string> };
                writtenBody?: string;
            };
            return res;
        }

        it("should return false when no route matches", async () => {
            const req = createMockReq("GET", "/nonexistent");
            const res = createMockRes();

            const result = await router.handleRequest(req, res);

            expect(result).toBe(false);
        });

        it("should match GET routes", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/users",
                handler: vi.fn().mockResolvedValue({ users: [] }),
            };

            router.registerRoutes([{ name: "getUsers", handler: mockHandler }]);

            const req = createMockReq("GET", "/api/users");
            const res = createMockRes();

            const result = await router.handleRequest(req, res);

            expect(result).toBe(true);
            expect(mockHandler.handler).toHaveBeenCalled();
        });

        it("should match POST routes", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "POST",
                path: "/api/users",
                handler: vi.fn().mockResolvedValue({ id: 1 }),
            };

            router.registerRoutes([{ name: "createUser", handler: mockHandler }]);

            const req = createMockReq("POST", "/api/users");
            const res = createMockRes();

            const result = await router.handleRequest(req, res);

            expect(result).toBe(true);
        });

        it("should not match wrong HTTP method", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "POST",
                path: "/api/users",
                handler: vi.fn(),
            };

            router.registerRoutes([{ name: "createUser", handler: mockHandler }]);

            const req = createMockReq("GET", "/api/users");
            const res = createMockRes();

            const result = await router.handleRequest(req, res);

            expect(result).toBe(false);
            expect(mockHandler.handler).not.toHaveBeenCalled();
        });

        it("should extract path parameters", async () => {
            let capturedRequest: unknown;
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/users/:id",
                handler: vi.fn().mockImplementation((req) => {
                    capturedRequest = req;
                    return { id: req.params.id };
                }),
            };

            router.registerRoutes([{ name: "getUser", handler: mockHandler }]);

            const req = createMockReq("GET", "/api/users/123");
            const res = createMockRes();

            await router.handleRequest(req, res);

            expect((capturedRequest as { params: { id: string } }).params.id).toBe("123");
        });

        it("should extract query parameters", async () => {
            let capturedRequest: unknown;
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/search",
                handler: vi.fn().mockImplementation((req) => {
                    capturedRequest = req;
                    return { query: req.query };
                }),
            };

            router.registerRoutes([{ name: "search", handler: mockHandler }]);

            const req = createMockReq("GET", "/api/search?q=hello&limit=10");
            const res = createMockRes();

            await router.handleRequest(req, res);

            const query = (capturedRequest as { query: Record<string, string> }).query;
            expect(query.q).toBe("hello");
            expect(query.limit).toBe("10");
        });

        it("should match ALL method for any HTTP method", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "ALL",
                path: "/api/proxy",
                handler: vi.fn().mockResolvedValue({ ok: true }),
            };

            router.registerRoutes([{ name: "proxy", handler: mockHandler }]);

            const getReq = createMockReq("GET", "/api/proxy");
            const postReq = createMockReq("POST", "/api/proxy");
            const res1 = createMockRes();
            const res2 = createMockRes();

            expect(await router.handleRequest(getReq, res1)).toBe(true);
            expect(await router.handleRequest(postReq, res2)).toBe(true);
        });

        it("should return 500 on handler error", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/error",
                handler: vi.fn().mockRejectedValue(new Error("Handler error")),
            };

            router.registerRoutes([{ name: "error", handler: mockHandler }]);

            const req = createMockReq("GET", "/api/error");
            const res = createMockRes();

            // Suppress console.error for this test
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            const result = await router.handleRequest(req, res);

            expect(result).toBe(true);
            expect(res.writtenHead?.status).toBe(500);

            consoleSpy.mockRestore();
        });
    });

    describe("setMiddleware", () => {
        it("should execute middleware before handler", async () => {
            const callOrder: string[] = [];

            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/test",
                handler: vi.fn().mockImplementation(() => {
                    callOrder.push("handler");
                    return { ok: true };
                }),
            };

            router.registerRoutes([{ name: "test", handler: mockHandler }]);

            router.setMiddleware({
                __kind: "middleware",
                handler: async (ctx, next) => {
                    callOrder.push("middleware-before");
                    await next();
                    callOrder.push("middleware-after");
                },
            });

            const req = {
                method: "GET",
                url: "/api/test",
                headers: {},
                on: vi.fn(),
                socket: {
                    remoteAddress: "127.0.0.1",
                },
            } as unknown as IncomingMessage;

            const res = {
                writeHead: vi.fn(),
                end: vi.fn(),
                setHeader: vi.fn(),
                statusCode: 200,
            } as unknown as ServerResponse;

            await router.handleRequest(req, res);

            expect(callOrder).toEqual(["middleware-before", "handler", "middleware-after"]);
        });

        it("should block request if middleware does not call next", async () => {
            const mockHandler: HeliumHTTPDef = {
                __kind: "http",
                method: "GET",
                path: "/api/blocked",
                handler: vi.fn().mockResolvedValue({ ok: true }),
            };

            router.registerRoutes([{ name: "blocked", handler: mockHandler }]);

            router.setMiddleware({
                __kind: "middleware",
                handler: async () => {
                    // Does not call next()
                },
            });

            const req = {
                method: "GET",
                url: "/api/blocked",
                headers: {},
                on: vi.fn(),
                socket: {
                    remoteAddress: "127.0.0.1",
                },
            } as unknown as IncomingMessage;

            const res = {
                writeHead: vi.fn(),
                end: vi.fn(),
                setHeader: vi.fn(),
                statusCode: 200,
            } as unknown as ServerResponse;

            await router.handleRequest(req, res);

            expect(mockHandler.handler).not.toHaveBeenCalled();
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        });
    });
});

describe("pathToRegex logic", () => {
    function pathToRegex(path: string): { pattern: RegExp; keys: string[] } {
        const keys: string[] = [];
        const multiSegmentToken = "__WILDCARD_MULTI__";
        const pattern = path
            .replace(/\/\*\*/g, `/${multiSegmentToken}`)
            .replace(/\/:([^/]+)/g, (_, key) => {
                keys.push(key);
                return "/([^/]+)";
            })
            .replace(/\*/g, "[^/]*")
            .replace(new RegExp(multiSegmentToken, "g"), ".*")
            .replace(/\//g, "\\/");

        return {
            pattern: new RegExp(`^${pattern}$`),
            keys,
        };
    }

    it("should match static paths", () => {
        const { pattern, keys } = pathToRegex("/api/users");

        expect(keys).toEqual([]);
        expect(pattern.test("/api/users")).toBe(true);
        expect(pattern.test("/api/users/123")).toBe(false);
    });

    it("should extract single dynamic segment", () => {
        const { pattern, keys } = pathToRegex("/api/users/:id");

        expect(keys).toEqual(["id"]);
        expect(pattern.test("/api/users/123")).toBe(true);
        expect(pattern.test("/api/users/")).toBe(false);
    });

    it("should extract multiple dynamic segments", () => {
        const { pattern, keys } = pathToRegex("/api/users/:userId/posts/:postId");

        expect(keys).toEqual(["userId", "postId"]);
        expect(pattern.test("/api/users/1/posts/2")).toBe(true);
    });

    it("should handle single-segment wildcard", () => {
        const { pattern, keys } = pathToRegex("/api/*");

        expect(keys).toEqual([]);
        expect(pattern.test("/api/anything/here")).toBe(false);
        expect(pattern.test("/api/anything")).toBe(true);
        expect(pattern.test("/api/")).toBe(true);
    });

    it("should handle multi-segment wildcard", () => {
        const { pattern, keys } = pathToRegex("/api/**");

        expect(keys).toEqual([]);
        expect(pattern.test("/api/anything/here")).toBe(true);
        expect(pattern.test("/api/anything")).toBe(true);
        expect(pattern.test("/api/")).toBe(true);
    });
});

describe("parseCookies logic", () => {
    function parseCookies(cookieHeader: string): Record<string, string> {
        const cookies: Record<string, string> = {};
        if (!cookieHeader) {
            return cookies;
        }

        const pairs = cookieHeader.split(";");
        for (const pair of pairs) {
            const [key, value] = pair.split("=").map((s) => s.trim());
            if (key && value) {
                cookies[key] = decodeURIComponent(value);
            }
        }
        return cookies;
    }

    it("should parse empty cookie header", () => {
        expect(parseCookies("")).toEqual({});
    });

    it("should parse single cookie", () => {
        expect(parseCookies("session=abc123")).toEqual({ session: "abc123" });
    });

    it("should parse multiple cookies", () => {
        expect(parseCookies("session=abc123; theme=dark; lang=en")).toEqual({
            session: "abc123",
            theme: "dark",
            lang: "en",
        });
    });

    it("should decode URL-encoded values", () => {
        expect(parseCookies("name=John%20Doe")).toEqual({ name: "John Doe" });
    });
});

describe("HTTPRouter Response handling", () => {
    let router: HTTPRouter;

    beforeEach(() => {
        router = new HTTPRouter();
    });

    function createMockReq(method: string, url: string, body?: string): IncomingMessage & { bodyData?: string } {
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        return {
            method,
            url,
            headers: {
                cookie: "session=test123",
            },
            socket: {
                remoteAddress: "127.0.0.1",
            },
            on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
                if (!listeners[event]) {
                    listeners[event] = [];
                }
                listeners[event].push(callback);

                // Simulate data event and end event for body reading
                if (event === "data" && body) {
                    setTimeout(() => callback(Buffer.from(body)), 0);
                }
                if (event === "end") {
                    setTimeout(() => callback(), 1);
                }
            }),
            bodyData: body,
        } as unknown as IncomingMessage & { bodyData?: string };
    }

    function createMockRes(): ServerResponse & {
        writtenHead?: { status: number; headers: Record<string, string> };
        writtenBody?: string;
        statusCode: number;
    } {
        const res = {
            writeHead: vi.fn(function (this: ServerResponse & { writtenHead?: unknown }, status: number, headers: Record<string, string>) {
                this.writtenHead = { status, headers };
            }),
            end: vi.fn(function (this: ServerResponse & { writtenBody?: string }, body?: string) {
                this.writtenBody = body;
            }),
            setHeader: vi.fn(),
            statusCode: 200,
        } as unknown as ServerResponse & {
            writtenHead?: { status: number; headers: Record<string, string> };
            writtenBody?: string;
            statusCode: number;
        };
        return res;
    }

    it("should return JSON response for object results", async () => {
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/data",
            handler: vi.fn().mockResolvedValue({ message: "Hello", count: 42 }),
        };

        router.registerRoutes([{ name: "getData", handler: mockHandler }]);

        const req = createMockReq("GET", "/api/data");
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(res.writtenHead?.status).toBe(200);
        expect(res.writtenHead?.headers["Content-Type"]).toBe("application/json");
        expect(res.writtenBody).toBe(JSON.stringify({ message: "Hello", count: 42 }));
    });

    it("should handle cookies in request", async () => {
        let capturedCookies: Record<string, string> = {};
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/test",
            handler: vi.fn().mockImplementation((req) => {
                capturedCookies = req.cookies;
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "test", handler: mockHandler }]);

        const req = createMockReq("GET", "/api/test");
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedCookies.session).toBe("test123");
    });

    it("should pass request method and path", async () => {
        let capturedMethod: string | undefined;
        let capturedPath: string | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "PUT",
            path: "/api/items/:id",
            handler: vi.fn().mockImplementation((req) => {
                capturedMethod = req.method;
                capturedPath = req.path;
                return { updated: true };
            }),
        };

        router.registerRoutes([{ name: "updateItem", handler: mockHandler }]);

        const req = createMockReq("PUT", "/api/items/456");
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedMethod).toBe("PUT");
        expect(capturedPath).toBe("/api/items/456");
    });

    it("should handle DELETE requests", async () => {
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "DELETE",
            path: "/api/items/:id",
            handler: vi.fn().mockResolvedValue({ deleted: true }),
        };

        router.registerRoutes([{ name: "deleteItem", handler: mockHandler }]);

        const req = createMockReq("DELETE", "/api/items/789");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(mockHandler.handler).toHaveBeenCalled();
    });

    it("should handle PATCH requests", async () => {
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "PATCH",
            path: "/api/items/:id",
            handler: vi.fn().mockResolvedValue({ patched: true }),
        };

        router.registerRoutes([{ name: "patchItem", handler: mockHandler }]);

        const req = createMockReq("PATCH", "/api/items/101");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(mockHandler.handler).toHaveBeenCalled();
    });

    it("should normalize query arrays to single values", async () => {
        let capturedQuery: Record<string, string> = {};
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/filter",
            handler: vi.fn().mockImplementation((req) => {
                capturedQuery = req.query;
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "filter", handler: mockHandler }]);

        // Query with single value
        const req = createMockReq("GET", "/api/filter?type=active&page=1");
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedQuery.type).toBe("active");
        expect(capturedQuery.page).toBe("1");
    });

    it("should handle requests with no URL", async () => {
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/",
            handler: vi.fn().mockResolvedValue({ ok: true }),
        };

        router.registerRoutes([{ name: "root", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: undefined,
            headers: {},
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        // Should not throw
        await router.handleRequest(req, res);
    });

    it("should handle requests with no method", async () => {
        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/",
            handler: vi.fn().mockResolvedValue({ ok: true }),
        };

        router.registerRoutes([{ name: "root", handler: mockHandler }]);

        const req = {
            method: undefined,
            url: "/",
            headers: {},
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        // Defaults to GET
        const result = await router.handleRequest(req, res);
        expect(result).toBe(true);
    });

    it("should handle Response objects from handlers", async () => {
        // Create a mock Response that will be returned by the handler
        const responseBody = "Hello World";
        const mockResponse = new Response(responseBody, {
            status: 201,
            headers: { "X-Custom-Header": "custom-value" },
        });

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/response",
            handler: vi.fn().mockResolvedValue(mockResponse),
        };

        router.registerRoutes([{ name: "responseHandler", handler: mockHandler }]);

        const req = createMockReq("GET", "/api/response");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(res.statusCode).toBe(201);
        expect(res.setHeader).toHaveBeenCalledWith("x-custom-header", "custom-value");
        // Verify the body is fully written via res.end()
        const endCall = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(endCall).toBeDefined();
        expect(Buffer.isBuffer(endCall[0])).toBe(true);
        expect(endCall[0].toString()).toBe("Hello World");
    });

    it("should handle binary Response bodies without truncation", async () => {
        // Simulate a binary payload (e.g. an image) of known size
        const binaryData = new Uint8Array(4096);
        for (let i = 0; i < binaryData.length; i++) {
            binaryData[i] = i % 256;
        }

        const mockResponse = new Response(binaryData, {
            status: 200,
            headers: { "Content-Type": "image/png" },
        });

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/image",
            handler: vi.fn().mockResolvedValue(mockResponse),
        };

        router.registerRoutes([{ name: "imageHandler", handler: mockHandler }]);

        const req = createMockReq("GET", "/api/image");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.setHeader).toHaveBeenCalledWith("content-type", "image/png");

        const endCall = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(endCall).toBeDefined();
        const writtenBuffer = endCall[0] as Buffer;
        expect(Buffer.isBuffer(writtenBuffer)).toBe(true);
        // Verify the entire payload was written without truncation
        expect(writtenBuffer.length).toBe(4096);
        expect(writtenBuffer.equals(Buffer.from(binaryData))).toBe(true);
    });

    it("should detect cross-realm Response-like objects via duck-typing", async () => {
        // Simulate a Response from a different realm (e.g. Vite SSR) where
        // `instanceof Response` fails. We create a plain object that quacks
        // like a Response.
        const bodyContent = "cross-realm body";
        const bodyBytes = new TextEncoder().encode(bodyContent);
        const headers = new Headers({ "X-Realm": "other" });

        const fakeResponse = {
            status: 200,
            headers,
            body: true, // truthy, like a ReadableStream
            arrayBuffer: async () => bodyBytes.buffer,
        };

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/cross-realm",
            handler: vi.fn().mockResolvedValue(fakeResponse),
        };

        router.registerRoutes([{ name: "crossRealm", handler: mockHandler }]);

        const req = createMockReq("GET", "/api/cross-realm");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.setHeader).toHaveBeenCalledWith("x-realm", "other");
        const endCall = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(endCall).toBeDefined();
        expect(Buffer.isBuffer(endCall[0])).toBe(true);
        expect(endCall[0].toString()).toBe("cross-realm body");
    });

    it("should handle Response objects without body", async () => {
        const mockResponse = new Response(null, { status: 204 });

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "DELETE",
            path: "/api/items/:id",
            handler: vi.fn().mockResolvedValue(mockResponse),
        };

        router.registerRoutes([{ name: "deleteHandler", handler: mockHandler }]);

        const req = createMockReq("DELETE", "/api/items/123");
        const res = createMockRes();

        const result = await router.handleRequest(req, res);

        expect(result).toBe(true);
        expect(res.statusCode).toBe(204);
        // res.end() should be called with no body argument
        const endCall = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(endCall[0]).toBeUndefined();
    });

    it("should provide headers object to handler", async () => {
        let capturedHeaders: Record<string, string | string[] | undefined> = {};

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/headers",
            handler: vi.fn().mockImplementation((req) => {
                capturedHeaders = req.headers;
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "headersHandler", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: "/api/headers",
            headers: {
                "content-type": "application/json",
                authorization: "Bearer token123",
            },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedHeaders["content-type"]).toBe("application/json");
        expect(capturedHeaders.authorization).toBe("Bearer token123");
    });

    it("should parse JSON body via req.json()", async () => {
        let parsedBody: unknown;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/json",
            handler: vi.fn().mockImplementation(async (req) => {
                parsedBody = await req.json();
                return { received: true };
            }),
        };

        router.registerRoutes([{ name: "jsonHandler", handler: mockHandler }]);

        const bodyData = JSON.stringify({ name: "test", value: 123 });
        const req = {
            method: "POST",
            url: "/api/json",
            headers: { "content-type": "application/json" },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(bodyData));
                } else if (event === "end") {
                    handler();
                }
            }),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(parsedBody).toEqual({ name: "test", value: 123 });
    });

    it("should parse text body via req.text()", async () => {
        let textBody: string = "";

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/text",
            handler: vi.fn().mockImplementation(async (req) => {
                textBody = await req.text();
                return { received: true };
            }),
        };

        router.registerRoutes([{ name: "textHandler", handler: mockHandler }]);

        const bodyData = "Hello, this is plain text content";
        const req = {
            method: "POST",
            url: "/api/text",
            headers: { "content-type": "text/plain" },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(bodyData));
                } else if (event === "end") {
                    handler();
                }
            }),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(textBody).toBe("Hello, this is plain text content");
    });

    it("should throw error for formData (not implemented)", async () => {
        let formDataError: Error | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/form",
            handler: vi.fn().mockImplementation(async (req) => {
                try {
                    await req.formData();
                } catch (e) {
                    formDataError = e as Error;
                }
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "formHandler", handler: mockHandler }]);

        const req = createMockReq("POST", "/api/form");
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(formDataError).toBeDefined();
        expect(formDataError?.message).toBe("FormData not yet implemented");
    });

    it("should convert request to Web Request via toWebRequest()", async () => {
        let webRequest: Request | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/web",
            handler: vi.fn().mockImplementation(async (req) => {
                webRequest = await req.toWebRequest();
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "webHandler", handler: mockHandler }]);

        const bodyData = JSON.stringify({ test: true });
        const req = {
            method: "POST",
            url: "/api/web?foo=bar",
            headers: {
                host: "example.com",
                "x-forwarded-proto": "https",
                "content-type": "application/json",
            },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(bodyData));
                } else if (event === "end") {
                    handler();
                }
            }),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(webRequest).toBeDefined();
        expect(webRequest?.method).toBe("POST");
        expect(webRequest?.url).toBe("https://example.com/api/web?foo=bar");
        expect(webRequest?.headers.get("content-type")).toBe("application/json");
    });

    it("should honor configured maxBodySize in toWebRequest", async () => {
        const customRouter = new HTTPRouter({ maxBodySize: 2_500_000 });
        let webRequest: Request | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/large-body",
            handler: vi.fn().mockImplementation(async (req) => {
                webRequest = await req.toWebRequest();
                return { ok: true };
            }),
        };

        customRouter.registerRoutes([{ name: "largeBodyHandler", handler: mockHandler }]);

        const bodyData = "x".repeat(1_200_000);
        const req = {
            method: "POST",
            url: "/api/large-body",
            headers: {
                host: "example.com",
                "content-type": "text/plain",
            },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(bodyData));
                } else if (event === "end") {
                    handler();
                }
            }),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        const handled = await customRouter.handleRequest(req, res);

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(webRequest).toBeDefined();
        const requestPayload = await (webRequest as Request).text();
        expect(requestPayload).toBe(bodyData);
    });

    it("should handle toWebRequest with default protocol and host", async () => {
        let webRequest: Request | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/default",
            handler: vi.fn().mockImplementation(async (req) => {
                webRequest = await req.toWebRequest();
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "defaultWebHandler", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: "/api/default",
            headers: {},
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(webRequest).toBeDefined();
        expect(webRequest?.url).toBe("http://localhost/api/default");
    });

    it("should handle toWebRequest with array headers", async () => {
        let webRequest: Request | undefined;

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/array-headers",
            handler: vi.fn().mockImplementation(async (req) => {
                webRequest = await req.toWebRequest();
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "arrayHeadersHandler", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: "/api/array-headers",
            headers: {
                host: "example.com",
                "set-cookie": ["cookie1=value1", "cookie2=value2"],
            },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(webRequest).toBeDefined();
        expect(webRequest?.headers.get("set-cookie")).toBe("cookie1=value1, cookie2=value2");
    });

    it("should parse cookies with URL-encoded values", async () => {
        let capturedCookies: Record<string, string> = {};

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/cookies",
            handler: vi.fn().mockImplementation((req) => {
                capturedCookies = req.cookies;
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "cookiesHandler", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: "/api/cookies",
            headers: {
                cookie: "session=abc123; user=John%20Doe; path=%2Fhome",
            },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedCookies.session).toBe("abc123");
        expect(capturedCookies.user).toBe("John Doe");
        expect(capturedCookies.path).toBe("/home");
    });

    it("should handle empty cookie header", async () => {
        let capturedCookies: Record<string, string> = {};

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "GET",
            path: "/api/no-cookies",
            handler: vi.fn().mockImplementation((req) => {
                capturedCookies = req.cookies;
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "noCookiesHandler", handler: mockHandler }]);

        const req = {
            method: "GET",
            url: "/api/no-cookies",
            headers: {},
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn(),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(capturedCookies).toEqual({});
    });

    it("should reuse body buffer on multiple reads", async () => {
        let jsonResult: unknown;
        let textResult: string = "";

        const mockHandler: HeliumHTTPDef = {
            __kind: "http",
            method: "POST",
            path: "/api/multi-read",
            handler: vi.fn().mockImplementation(async (req) => {
                textResult = await req.text();
                // Reading text again should return the same buffered content
                jsonResult = JSON.parse(await req.text());
                return { ok: true };
            }),
        };

        router.registerRoutes([{ name: "multiReadHandler", handler: mockHandler }]);

        const bodyData = JSON.stringify({ reused: true });
        const req = {
            method: "POST",
            url: "/api/multi-read",
            headers: { "content-type": "application/json" },
            socket: { remoteAddress: "127.0.0.1" },
            on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(bodyData));
                } else if (event === "end") {
                    handler();
                }
            }),
        } as unknown as IncomingMessage;
        const res = createMockRes();

        await router.handleRequest(req, res);

        expect(textResult).toBe('{"reused":true}');
        expect(jsonResult).toEqual({ reused: true });
    });
});
