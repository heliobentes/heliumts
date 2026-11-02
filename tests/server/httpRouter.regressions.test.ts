// @vitest-environment node
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { defineHTTPRequest, type HTTPHandler, type HTTPRequest } from "../../src/server/defineHTTPRequest";
import { HTTPRouter } from "../../src/server/httpRouter";

function createRequest(method = "GET", url = "/test") {
    return Object.assign(new EventEmitter(), {
        method,
        url,
        headers: {} as Record<string, string>,
        socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
}

function createResponse() {
    const response = Object.assign(new EventEmitter(), {
        headersSent: false,
        destroyed: false,
        writableEnded: false,
        statusCode: 200,
        setHeader: vi.fn(),
        removeHeader: vi.fn(),
        writeHead: vi.fn((status: number) => {
            response.statusCode = status;
            response.headersSent = true;
        }),
        write: vi.fn((_chunk: Uint8Array) => {
            response.headersSent = true;
            return true;
        }),
        end: vi.fn((_body?: string) => {
            response.writableEnded = true;
        }),
        destroy: vi.fn(() => {
            response.destroyed = true;
            response.emit("close");
        }),
    });
    return response;
}

function createRouter(handler: HTTPHandler, path = "/test", maxBodySize?: number) {
    const router = new HTTPRouter({ maxBodySize });
    router.registerRoutes([{ name: "test", handler: defineHTTPRequest("ALL", path, handler) }]);
    return router;
}

describe("HTTPRouter regressions", () => {
    it("matches route metacharacters literally without capturing extra parameters", async () => {
        const handler = vi.fn((req: HTTPRequest) => ({ id: req.params.id }));
        const router = createRouter(handler, "/api/(version)/item.json/:id");
        const response = createResponse();
        expect(await router.handleRequest(createRequest("GET", "/api/(version)/item.json/42"), response as unknown as ServerResponse)).toBe(true);
        expect(handler.mock.calls[0][0].params).toEqual({ id: "42" });
        expect(await router.handleRequest(createRequest("GET", "/api/version/itemXjson/42"), createResponse() as unknown as ServerResponse)).toBe(false);
    });

    it("preserves the full value and empty value of cookies", async () => {
        const handler = vi.fn((_req: HTTPRequest) => ({}));
        const request = createRequest();
        request.headers.cookie = "token=abc==; empty=; malformed=%ZZ";
        await createRouter(handler).handleRequest(request, createResponse() as unknown as ServerResponse);
        expect(handler.mock.calls[0][0].cookies).toEqual({ token: "abc==", empty: "", malformed: "%ZZ" });
    });

    it.each([
        { depth: 0, encrypted: false, forwarded: "https", expected: "http" },
        { depth: 0, encrypted: true, forwarded: "http", expected: "https" },
        { depth: 1, encrypted: false, forwarded: "https", expected: "https" },
        { depth: 1, encrypted: false, forwarded: "https, http", expected: "http" },
        { depth: 2, encrypted: false, forwarded: "https, http", expected: "https" },
        { depth: 1, encrypted: false, forwarded: "javascript", expected: "http" },
    ])("uses $expected for TLS=$encrypted, trust depth=$depth and forwarded=$forwarded", async ({ depth, encrypted, forwarded, expected }) => {
        const request = createRequest();
        request.headers.host = "example.com";
        request.headers["x-forwarded-proto"] = forwarded;
        Object.assign(request.socket, { encrypted });
        let url: string | undefined;
        const router = createRouter(async (req) => {
            url = (await req.toWebRequest()).url;
            return {};
        });
        router.setTrustProxyDepth(depth);
        await router.handleRequest(request, createResponse() as unknown as ServerResponse);
        expect(url).toBe(`${expected}://example.com/test`);
    });

    it("normalizes absolute-form request targets without adopting their host", async () => {
        const request = createRequest("GET", "http://untrusted.example/test?x=1");
        request.headers.host = "example.com";
        let url: string | undefined;
        await createRouter(async (req) => {
            url = (await req.toWebRequest()).url;
            return {};
        }).handleRequest(request, createResponse() as unknown as ServerResponse);
        expect(url).toBe("http://example.com/test?x=1");
    });

    it("shares a single body read when another consumer starts after the first chunk", async () => {
        const request = createRequest("POST");
        const handler = vi.fn(async (req: HTTPRequest) => {
            const first = req.text();
            request.emit("data", Buffer.from("hello "));
            const second = req.text();
            request.emit("data", Buffer.from("world"));
            request.emit("end");
            return Promise.all([first, second]);
        });
        const response = createResponse();
        await createRouter(handler).handleRequest(request, response as unknown as ServerResponse);
        expect(response.end).toHaveBeenCalledWith(JSON.stringify(["hello world", "hello world"]));
        expect(request.listenerCount("data")).toBe(1);
    });

    it("returns 413 for oversized bodies while keeping the response writable", async () => {
        const request = createRequest("POST");
        const response = createResponse();
        const pending = createRouter((req) => req.text(), "/test", 3).handleRequest(request, response as unknown as ServerResponse);
        await Promise.resolve();
        request.emit("data", Buffer.from("four"));
        request.emit("end");
        await pending;
        expect(response.statusCode).toBe(413);
        expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: "Request entity too large" }));
    });

    it("returns 400 for invalid JSON", async () => {
        const request = createRequest("POST");
        const response = createResponse();
        const pending = createRouter((req) => req.json()).handleRequest(request, response as unknown as ServerResponse);
        await Promise.resolve();
        request.emit("data", Buffer.from("{"));
        request.emit("end");
        await pending;
        expect(response.statusCode).toBe(400);
    });

    it("settles aborted body reads", async () => {
        const request = createRequest("POST");
        const response = createResponse();
        const pending = createRouter((req) => req.text()).handleRequest(request, response as unknown as ServerResponse);
        await Promise.resolve();
        request.emit("aborted");
        await pending;
        expect(response.statusCode).toBe(400);
    });

    it("returns 500 before sending headers when JSON serialization fails", async () => {
        const result: Record<string, unknown> = {};
        result.self = result;
        const response = createResponse();
        await createRouter(() => result).handleRequest(createRequest(), response as unknown as ServerResponse);
        expect(response.statusCode).toBe(500);
        expect(response.writeHead).toHaveBeenCalledTimes(1);
        expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: "Internal server error" }));
    });

    it("waits for drain before writing the next streamed chunk", async () => {
        const response = createResponse();
        response.write.mockImplementationOnce(() => {
            response.headersSent = true;
            return false;
        });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1]));
                controller.enqueue(new Uint8Array([2]));
                controller.close();
            },
        });
        const pending = createRouter(() => new Response(body)).handleRequest(createRequest(), response as unknown as ServerResponse);
        await vi.waitFor(() => expect(response.listenerCount("drain")).toBe(1));
        expect(response.write).toHaveBeenCalledTimes(1);
        response.emit("drain");
        await pending;
        expect(response.write).toHaveBeenCalledTimes(2);
        expect(response.end).toHaveBeenCalledOnce();
        expect(response.listenerCount("drain")).toBe(0);
    });

    it("does not consume a streaming body for HEAD responses", async () => {
        const response = createResponse();
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel });
        await createRouter(() => new Response(body, { headers: { "content-type": "text/event-stream" } })).handleRequest(
            createRequest("HEAD"),
            response as unknown as ServerResponse
        );
        expect(cancel).toHaveBeenCalledOnce();
        expect(response.write).not.toHaveBeenCalled();
        expect(response.end).toHaveBeenCalledOnce();
    });

    it("cancels the source stream when a blocked response closes", async () => {
        const response = createResponse();
        response.write.mockImplementationOnce(() => false);
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1]));
            },
            cancel,
        });
        const pending = createRouter(() => new Response(body)).handleRequest(createRequest(), response as unknown as ServerResponse);
        await vi.waitFor(() => expect(response.listenerCount("drain")).toBe(1));
        response.emit("close");
        await pending;
        expect(cancel).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(body.locked).toBe(false);
        expect(response.listenerCount("close")).toBe(0);
    });

    it("closes a failed stream without attempting to rewrite sent headers", async () => {
        const response = createResponse();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1]));
            },
            pull(controller) {
                controller.error(new Error("upstream failed"));
            },
        });
        await createRouter(() => new Response(body)).handleRequest(createRequest(), response as unknown as ServerResponse);
        expect(response.write).toHaveBeenCalledOnce();
        expect(response.destroy).toHaveBeenCalledOnce();
        expect(response.writeHead).not.toHaveBeenCalled();
        expect(response.end).not.toHaveBeenCalled();
        expect(body.locked).toBe(false);
    });
});
