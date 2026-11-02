// @vitest-environment node
import { decode, encode } from "@msgpack/msgpack";
import type { IncomingMessage } from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeRpcRequest, MAX_RPC_REQUEST_DEPTH } from "../../src/server/rpcDecoder";
import { PublicError, RpcRegistry } from "../../src/server/rpcRegistry";

vi.mock("@msgpack/msgpack", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@msgpack/msgpack")>();
    return { ...actual, decode: vi.fn(actual.decode) };
});

beforeEach(() => {
    vi.mocked(decode).mockClear();
});

describe("RPC request decoding", () => {
    it.each([
        ["array32", 0xdd],
        ["map32", 0xdf],
        ["str32", 0xdb],
        ["bin32", 0xc6],
        ["ext32", 0xc9],
    ])("rejects an oversized %s declaration before its content is read", (_name, type) => {
        const body = Buffer.alloc(6);
        body[0] = type as number;
        body.writeUInt32BE(1_000_000, 1);
        expect(() => decodeRpcRequest(body)).toThrow(/Invalid MessagePack request structure/);
        expect(decode).not.toHaveBeenCalled();
    });

    it("preserves legitimate nested arrays, objects, strings, binary values, and dates", () => {
        const request = {
            id: "valid",
            method: "echo",
            args: { arrays: [[], [1, true, null, ["hello"]]], map: { nested: { value: "🎈" } }, binary: new Uint8Array([0, 128, 255]), date: new Date("2026-11-02T12:00:00Z") },
        };
        const decoded = decodeRpcRequest(Buffer.from(encode(request))) as typeof request;
        expect(decoded).toEqual({ ...request, args: { ...request.args, binary: expect.any(Uint8Array) } });
        expect([...decoded.args.binary]).toEqual([...request.args.binary]);
        const bytes = Buffer.from(encode(request));
        expect(decode).toHaveBeenLastCalledWith(bytes, {
            maxStrLength: bytes.byteLength,
            maxBinLength: bytes.byteLength,
            maxArrayLength: bytes.byteLength,
            maxMapLength: bytes.byteLength,
            maxExtLength: bytes.byteLength,
        });
    });

    it("uses the same bounded decoder for unary and streaming endpoints", async () => {
        const registry = new RpcRegistry();
        const req = { headers: {}, method: "POST", url: "/__helium__/rpc" } as IncomingMessage;
        const body = Buffer.from([0xdd, 0, 0x0f, 0x42, 0x40]);
        const unary = await registry.handleHttpRequest(body, "127.0.0.1", req);
        expect(unary.response).toMatchObject({ ok: false, error: "Invalid request format" });
        await expect(registry.handleStreamRequest(body, "127.0.0.1", req, new AbortController().signal, vi.fn())).rejects.toEqual(new PublicError("Invalid request format"));
        expect(decode).not.toHaveBeenCalled();
    });

    it("rejects aggregate nested declarations even when each array fits its individual cap", () => {
        const body = Buffer.alloc(64, 0xc0);
        for (let offset = 0; offset < 15; offset += 5) {
            body[offset] = 0xdd;
            body.writeUInt32BE(20, offset + 1);
        }
        expect(() => decodeRpcRequest(body)).toThrow(/Invalid MessagePack request structure/);
        expect(decode).not.toHaveBeenCalled();
    });

    it("accepts the nesting boundary and rejects the next level before decoding", () => {
        const nested = Buffer.alloc(MAX_RPC_REQUEST_DEPTH + 1, 0x91);
        nested[nested.length - 1] = 0xc0;
        let decoded = decodeRpcRequest(nested);
        let depth = 0;
        while (Array.isArray(decoded)) {
            expect(decoded.length).toBe(1);
            decoded = decoded[0];
            depth++;
        }
        expect(depth).toBe(MAX_RPC_REQUEST_DEPTH);
        expect(decoded).toBe(null);
        vi.mocked(decode).mockClear();
        expect(() => decodeRpcRequest(Buffer.concat([Buffer.from([0x91]), nested]))).toThrow(/Invalid MessagePack request structure/);
        expect(decode).not.toHaveBeenCalled();
    });

    const validEncodings = [
        ["positive fixint", "7f"],
        ["negative fixint", "e0"],
        ["fixmap", "81a16bc0"],
        ["empty map", "80"],
        ["fixarray", "91c0"],
        ["empty array", "90"],
        ["fixstr", "a178"],
        ["nil", "c0"],
        ["false", "c2"],
        ["true", "c3"],
        ["bin8", "c40180"],
        ["bin16", "c5000180"],
        ["bin32", "c60000000180"],
        ["ext8", "c7010580"],
        ["ext16", "c800010580"],
        ["ext32", "c9000000010580"],
        ["float32", "ca00000000"],
        ["float64", "cb0000000000000000"],
        ["uint8", "cc01"],
        ["uint16", "cd0001"],
        ["uint32", "ce00000001"],
        ["uint64", "cf0000000000000001"],
        ["int8", "d0ff"],
        ["int16", "d1ffff"],
        ["int32", "d2ffffffff"],
        ["int64", "d3ffffffffffffffff"],
        ["fixext1", "d40500"],
        ["fixext2", "d5050000"],
        ["fixext4", "d60500000000"],
        ["fixext8", "d7050000000000000000"],
        ["fixext16", "d80500000000000000000000000000000000"],
        ["str8", "d90178"],
        ["str16", "da000178"],
        ["str32", "db0000000178"],
        ["array16", "dc0001c0"],
        ["array32", "dd00000001c0"],
        ["map16", "de0001a16bc0"],
        ["map32", "df00000001a16bc0"],
        ["timestamp32", "d6ff00000001"],
        ["timestamp64", "d7ff0000000000000000"],
        ["timestamp96", "c70cff000000000000000000000000"],
    ];
    it.each(validEncodings)("accepts valid %s and rejects all incomplete prefixes and trailing values", (_name, hex) => {
        const body = Buffer.from(hex!, "hex");
        expect(() => decodeRpcRequest(body)).not.toThrow();
        for (let size = 0; size < body.byteLength; size++) {
            vi.mocked(decode).mockClear();
            expect(() => decodeRpcRequest(body.subarray(0, size))).toThrow();
            expect(decode).not.toHaveBeenCalled();
        }
        expect(() => decodeRpcRequest(Buffer.concat([body, Buffer.from([0xc0])]))).toThrow();
    });

    it("rejects the reserved MessagePack tag", () => {
        expect(() => decodeRpcRequest(Buffer.from([0xc1]))).toThrow();
        expect(decode).not.toHaveBeenCalled();
    });
});
