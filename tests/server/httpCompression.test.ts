// @vitest-environment node
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brotliCompress, brotliDecompress, constants, gunzip, inflate } from "zlib";

import { compressHttpRpcResponse } from "../../src/server/httpCompression";

vi.mock("zlib", async (importOriginal) => {
    const actual = await importOriginal<typeof import("zlib")>();
    return { ...actual, brotliCompress: vi.fn(actual.brotliCompress) };
});

afterEach(() => vi.clearAllMocks());

const payload = Buffer.from(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ id: index, description: "An RPC response with repeated structured data" }))));

describe("HTTP RPC compression", () => {
    it("uses quality 4 Brotli for dynamic responses and preserves the payload", async () => {
        const result = await compressHttpRpcResponse(payload, "gzip, deflate, br");
        expect(result.encoding).toBe("br");
        expect(await promisify(brotliDecompress)(result.body)).toEqual(payload);
        expect(result.body.length).toBeLessThan(payload.length);
        expect(brotliCompress).toHaveBeenCalledWith(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }, expect.any(Function));
    });

    it.each([
        { acceptEncoding: "gzip, deflate", encoding: "gzip", decompress: promisify(gunzip) },
        { acceptEncoding: "deflate", encoding: "deflate", decompress: promisify(inflate) },
    ])("preserves the $encoding fallback", async ({ acceptEncoding, encoding, decompress }) => {
        const result = await compressHttpRpcResponse(payload, acceptEncoding);
        expect(result.encoding).toBe(encoding);
        expect(await decompress(result.body)).toEqual(payload);
        expect(brotliCompress).not.toHaveBeenCalled();
    });

    it.each([undefined, "identity"])("leaves the payload unchanged without a supported encoding (%s)", async (acceptEncoding) => {
        const result = await compressHttpRpcResponse(payload, acceptEncoding);
        expect(result).toEqual({ body: payload });
        expect(result.body).toBe(payload);
        expect(brotliCompress).not.toHaveBeenCalled();
    });

    it.each([0, 1024])("leaves a %i-byte payload uncompressed", async (size) => {
        const body = Buffer.alloc(size, "x");
        expect(await compressHttpRpcResponse(body, "br")).toEqual({ body });
        expect(brotliCompress).not.toHaveBeenCalled();
    });

    it("compresses a payload immediately above the size threshold", async () => {
        const body = Buffer.alloc(1025, "x");
        const result = await compressHttpRpcResponse(body, "br");
        expect(result.encoding).toBe("br");
        expect(await promisify(brotliDecompress)(result.body)).toEqual(body);
    });

    it.each([
        { header: "BR", encoding: "br" },
        { header: "notbr, xbr", encoding: undefined },
        { header: "gzip;q=0.9, br;q=0.1", encoding: "gzip" },
        { header: "br;q=0, gzip;q=0.5", encoding: "gzip" },
        { header: "br;q=0, *;q=0.7", encoding: "gzip" },
        { header: "*;q=0", encoding: undefined },
        { header: "*;q=0.4", encoding: "br" },
        { header: "br;q=0, gzip;q=0, deflate;q=0", encoding: undefined },
        { header: "BR;Q=0.3, GZIP;q=0.3, DEFLATE; q=0.3", encoding: "br" },
        { header: "identity;q=1, gzip;q=0.5", encoding: undefined },
        { header: "br;q=banana, gzip;q=0.2", encoding: "gzip" },
        { header: "br;q=1.5, deflate;q=0.1", encoding: "deflate" },
    ])("negotiates $encoding for '$header'", async ({ header, encoding }) => {
        const result = await compressHttpRpcResponse(payload, header);
        expect(result.encoding).toBe(encoding);
        if (encoding === undefined) {
            expect(result.body).toBe(payload);
        }
    });
});
