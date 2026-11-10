import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { MemoryEmbedder } from "./index.js";
import { trustedPacks } from "./trustedPacks.js";

type Tensor = { data: ArrayLike<number> };
type Runtime = {
    createTokenizer(json: unknown, config: unknown): (texts: string[], options: Record<string, unknown>) => Record<string, number[][]>;
    createTensor(values: number[], dimensions: number[]): unknown;
    createSession(
        bytes: Uint8Array,
        wasmURL: string
    ): Promise<{ inputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>; release(): Promise<void> }>;
};
export function verifiedPack(directory: string) {
    const root = fs.realpathSync(directory);
    const file = (relative: string) => {
        if (!relative || path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some((part) => part === ".." || part === "." || !part)) {
            throw new Error("Unsafe model-pack path");
        }
        let current = root;
        for (const part of relative.split("/")) {
            current = path.join(current, part);
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw new Error("Model packs cannot contain symlinks");
            }
        }
        return current;
    };
    if (fs.statSync(file("manifest.json")).size > 64_000) {
        throw new Error("Model manifest exceeds 64KB");
    }
    const bytes = fs.readFileSync(file("manifest.json"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const trusted = trustedPacks.find((pack) => pack.sha256 === digest);
    if (!trusted) {
        throw new Error(
            "Unrecognized model pack. Only reviewed, revision-pinned local Helium packs are supported; a self-authored checksum cannot authorize executable runtime code."
        );
    }
    const manifest = JSON.parse(bytes.toString("utf8")) as {
        id: string;
        revision: string;
        dimensions: number;
        maxLength: number;
        pooling: "mean" | "cls";
        queryPrefix: string;
        runtime: { module: string };
        files: { path: string; sha256: string; bytes: number }[];
    };
    if (manifest.id !== trusted.id || manifest.revision !== trusted.revision) {
        throw new Error("Model identity/revision mismatch");
    }
    for (const asset of manifest.files) {
        const location = file(asset.path);
        if (fs.statSync(location).size !== asset.bytes || createHash("sha256").update(fs.readFileSync(location)).digest("hex") !== asset.sha256) {
            throw new Error(`Model pack integrity failure: ${asset.path}`);
        }
    }
    return { manifest, file, identity: `helium-memory-v1:${digest}` };
}
/** Fixed, integrity-checked WASM runtime. No downloader, service, native addon or app module. */
export async function loadLocalEmbedder(directory: string): Promise<MemoryEmbedder & { dispose(): Promise<void> }> {
    const { manifest, file, identity } = verifiedPack(directory);
    const runtime = (await import(pathToFileURL(file(manifest.runtime.module)).href)) as Runtime;
    const tokenizer = runtime.createTokenizer(JSON.parse(fs.readFileSync(file("tokenizer.json"), "utf8")), JSON.parse(fs.readFileSync(file("tokenizer_config.json"), "utf8")));
    const session = await runtime.createSession(fs.readFileSync(file("onnx/model_quantized.onnx")), pathToFileURL(path.dirname(file("runtime/runtime.mjs")) + path.sep).href);
    async function documents(texts: string[], query = false) {
        const documents: number[][][] = [];
        for (const text of texts) {
            const tokens = tokenizer([query ? manifest.queryPrefix + text : text], { return_tensor: false, padding: false, truncation: false });
            const chunks: number[][] = [];
            for (const window of tokenWindows(tokens, manifest.maxLength)) {
                const length = window.input_ids[0].length;
                const feeds = Object.fromEntries(session.inputNames.map((name) => [name, runtime.createTensor(window[name].flat(), [1, length])]));
                const output = (await session.run(feeds)).last_hidden_state.data;
                const values = new Array<number>(manifest.dimensions).fill(0);
                let count = 0;
                for (let token = 0; token < (manifest.pooling === "cls" ? 1 : length); token++) {
                    if (!window.attention_mask[0][token]) {
                        continue;
                    }
                    count++;
                    for (let d = 0; d < values.length; d++) {
                        values[d] += Number(output[token * values.length + d]);
                    }
                }
                const norm = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0));
                if (!count || !Number.isFinite(norm) || norm === 0) {
                    throw new Error("Invalid local model output");
                }
                chunks.push(values.map((value) => value / norm));
            }
            documents.push(chunks);
        }
        return documents;
    }
    return {
        identity: `${identity}:overlapping-token-windows-v2`,
        dimensions: manifest.dimensions,
        dispose: () => session.release(),
        embedDocuments: (texts) => documents(texts),
        async embed(texts, options) {
            return (await documents(texts, options?.query)).map((chunks) => {
                const mean = chunks[0].map((_, i) => chunks.reduce((sum, chunk) => sum + chunk[i], 0) / chunks.length);
                const norm = Math.sqrt(mean.reduce((sum, value) => sum + value ** 2, 0));
                if (!norm) {
                    throw new Error("Invalid mean query vector");
                }
                return mean.map((value) => value / norm);
            });
        },
    };
}
/** Preserve BERT boundary tokens in overlapping windows; every content token is represented. */
export function tokenWindows(tokens: Record<string, number[][]>, maxLength: number): Record<string, number[][]>[] {
    if (!Number.isInteger(maxLength) || maxLength < 4) {
        throw new Error("Token window must allow boundary and content tokens");
    }
    const length = tokens.input_ids[0].length;
    if (length <= maxLength) {
        return [tokens];
    }
    const width = maxLength - 2;
    const stride = Math.max(1, width - Math.min(32, Math.floor(width / 4)));
    const windows: Record<string, number[][]>[] = [];
    for (let start = 1; start < length - 1; start += stride) {
        const end = Math.min(start + width, length - 1);
        windows.push(Object.fromEntries(Object.entries(tokens).map(([name, [values]]) => [name, [[values[0], ...values.slice(start, end), values[length - 1]]]])));
        if (end === length - 1) {
            break;
        }
    }
    return windows;
}
