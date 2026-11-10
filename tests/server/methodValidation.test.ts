import { encode } from "@msgpack/msgpack";
import type http from "http";
import { describe, expect, it, vi } from "vitest";
import { defineMethod } from "../../src/server/defineMethod";
import { RpcRegistry } from "../../src/server/rpcRegistry";

const req = { headers: {}, method: "POST", url: "/__helium__/rpc" } as http.IncomingMessage;
const parser = {
    parse(value: unknown): { name: string } {
        if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") throw new Error("secret schema detail");
        return { name: value.name.trim() };
    },
};
const request = (args: unknown) => Buffer.from(encode({ id: 1, method: "validated", args }));

describe("method runtime input validation", () => {
    it("validates network input before a unary handler and transforms valid input", async () => {
        const registry = new RpcRegistry();
        const handler = vi.fn((args: { name: string }) => args.name);
        registry.register("validated", defineMethod(handler, { input: parser }));
        for (const args of [null, {}, { name: 42 }, "secret payload"]) {
            expect((await registry.handleHttpRequest(request(args), "test", req)).response).toMatchObject({ ok: false, error: "Invalid method arguments" });
        }
        expect(handler).not.toHaveBeenCalled();
        expect((await registry.handleHttpRequest(request({ name: " hello " }), "test", req)).response).toMatchObject({ ok: true, result: "hello" });
        expect(handler).toHaveBeenCalledOnce();
    });
    it("validates streaming input and supports asynchronous parser functions", async () => {
        const registry = new RpcRegistry();
        const handler = vi.fn(async function* (args: { name: string }) {
            yield args.name;
        });
        registry.register("validated", defineMethod(handler, { input: async (value) => parser.parse(value) }));
        const chunk = vi.fn();
        await expect(registry.handleStreamRequest(request({}), "test", req, new AbortController().signal, chunk)).rejects.toThrow("Invalid method arguments");
        expect(handler).not.toHaveBeenCalled();
        expect(chunk).not.toHaveBeenCalled();
        await registry.handleStreamRequest(request({ name: " hi " }), "test", req, new AbortController().signal, chunk);
        expect(chunk).toHaveBeenCalledWith("hi", expect.any(AbortSignal));
    });
    it("does not start a handler when disconnected during asynchronous validation", async () => {
        const registry = new RpcRegistry();
        let finish!: (value: string) => void;
        const pending = new Promise<string>((resolve) => {
            finish = resolve;
        });
        const handler = vi.fn((value: string) => value);
        registry.register("validated", defineMethod(handler, { input: () => pending }));
        const controller = new AbortController();
        const response = registry.handleHttpRequest(request("ok"), "test", req, controller.signal);
        controller.abort();
        finish("ok");
        await response;
        expect(handler).not.toHaveBeenCalled();
    });
});
