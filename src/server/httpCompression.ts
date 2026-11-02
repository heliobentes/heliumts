import { promisify } from "util";
import { brotliCompress, constants, deflate, gzip } from "zlib";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);

interface CompressedHttpResponse {
    body: Buffer;
    encoding?: "br" | "gzip" | "deflate";
}

function selectEncoding(acceptEncoding: string): CompressedHttpResponse["encoding"] {
    const qualities = new Map<string, number>();
    for (const entry of acceptEncoding.split(",")) {
        const [name, ...parameters] = entry.trim().split(";");
        if (!name) {
            continue;
        }
        let quality = 1;
        for (const parameter of parameters) {
            const separator = parameter.indexOf("=");
            if (separator !== -1 && parameter.slice(0, separator).trim().toLowerCase() === "q") {
                const value = parameter.slice(separator + 1).trim();
                quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) ? Number(value) : 0;
                break;
            }
        }
        const coding = name.trim().toLowerCase();
        qualities.set(coding, Math.max(quality, qualities.get(coding) ?? 0));
    }

    let selected: CompressedHttpResponse["encoding"];
    let bestQuality = 0;
    for (const coding of ["br", "gzip", "deflate"] as const) {
        const quality = qualities.get(coding) ?? qualities.get("*") ?? 0;
        if (quality > bestQuality) {
            selected = coding;
            bestQuality = quality;
        }
    }
    return (qualities.get("identity") ?? 0) > bestQuality ? undefined : selected;
}

/** Compress dynamic RPC payloads without Brotli's expensive default quality. */
export async function compressHttpRpcResponse(body: Buffer, acceptEncoding?: string): Promise<CompressedHttpResponse> {
    if (!acceptEncoding || body.length <= 1024) {
        return { body };
    }

    const encoding = selectEncoding(acceptEncoding);
    if (encoding === "br") {
        return {
            body: await brotliCompressAsync(body, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
            }),
            encoding: "br",
        };
    }
    if (encoding === "gzip") {
        return { body: await gzipAsync(body), encoding: "gzip" };
    }
    if (encoding === "deflate") {
        return { body: await deflateAsync(body), encoding: "deflate" };
    }

    return { body };
}
