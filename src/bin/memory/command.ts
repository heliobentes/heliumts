import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { changeCard, initializeMemory, inspectCard, loadCards, readReference, writeCard } from "./cards.js";
import { indexMemory, memoryContext, searchMemory } from "./index.js";

function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Provide ${label} once with a non-empty value`);
    }
    return value;
}
export async function memoryCommand(root: string, action: string, value: unknown, options: Record<string, unknown>) {
    const allowed: Record<string, string[]> = {
        init: [],
        status: ["detail"],
        index: ["model", "fts"],
        search: ["limit", "model", "fts", "detail"],
        show: [],
        add: ["title", "summary", "symbol", "test"],
        create: ["input", "detail"],
        update: ["input", "ifMatch", "acknowledge", "detail"],
        review: ["ifMatch", "acknowledge", "detail"],
    };
    if (!Object.prototype.hasOwnProperty.call(allowed, action)) {
        throw new Error("Memory actions: init, create/add <id>, update <id>, review <id>, show <id>, status, index, search <query>");
    }
    for (const key of Object.keys(options)) {
        if (key === "--" && Array.isArray(options[key]) && options[key].length === 0) {
            continue;
        }
        if (options[key] !== undefined && !allowed[action].includes(key)) {
            throw new Error(`--${key} is not supported for memory ${action}`);
        }
    }
    if (!["add", "create", "update", "review", "show", "search"].includes(action) && value !== undefined) {
        throw new Error(`memory ${action} does not accept an argument`);
    }
    for (const flag of ["detail", "acknowledge"]) {
        if (options[flag] !== undefined && options[flag] !== true) {
            throw new Error(`Specify --${flag} once without a value`);
        }
    }
    const receipt = (card: ReturnType<typeof inspectCard>) =>
        options.detail ? card : { id: card.id, revision: card.revision, stale: card.stale, symbols: card.symbols.map(({ file, name, line }) => ({ file, name, line })) };
    if (["create", "update", "review"].includes(action)) {
        const id = text(value, "card ID");
        if (action === "review") {
            if (options.acknowledge !== true) {
                throw new Error("Review requires --acknowledge after inspecting current evidence; this does not certify prose");
            }
            return receipt(changeCard(root, id, text(options.ifMatch, "--if-match revision"), {}, true));
        }
        const input = JSON.parse(readReference(root, text(options.input, "--input repository-relative JSON file")));
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new Error("Card input must be a JSON object");
        }
        const fields = action === "create" ? ["title", "body", "symbols", "tests"] : ["title", "body", "append", "symbols", "tests"];
        if (
            Object.keys(input).some((key) => !fields.includes(key)) ||
            ["title", "body", "append"].some((key) => input[key] !== undefined && typeof input[key] !== "string") ||
            (input.symbols !== undefined &&
                (!Array.isArray(input.symbols) ||
                    input.symbols.some((ref: { file?: unknown; name?: unknown }) => !ref || typeof ref.file !== "string" || typeof ref.name !== "string"))) ||
            (input.tests !== undefined && (!Array.isArray(input.tests) || input.tests.some((file: unknown) => typeof file !== "string")))
        ) {
            throw new Error("Invalid card input fields; use title/body/append, symbols [{file,name}], tests [file]");
        }
        if (action === "create") {
            writeCard(root, { id, title: text(input.title, "title"), body: text(input.body, "body"), symbols: input.symbols, tests: input.tests });
            return receipt(
                inspectCard(
                    root,
                    loadCards(root).find((card) => card.id === id)!
                )
            );
        }
        if (!Object.keys(input).length) {
            throw new Error("Update requires at least one field; use review to acknowledge evidence only");
        }
        return receipt(changeCard(root, id, text(options.ifMatch, "--if-match revision"), input, options.acknowledge === true));
    }
    if (action === "init") {
        initializeMemory(root);
        return { cards: ".helium/memory", cache: ".helium/cache (ignored)", network: false };
    }
    if (action === "add") {
        const reference = text(options.symbol, "--symbol file#name"),
            split = reference.lastIndexOf("#");
        if (split < 1 || split === reference.length - 1) {
            throw new Error("Use --symbol path/to/file.ts#name");
        }
        return writeCard(root, {
            id: text(value, "card ID"),
            title: text(options.title, "--title"),
            body: text(options.summary, "--summary"),
            symbols: [{ file: reference.slice(0, split), name: reference.slice(split + 1) }],
            tests: [text(options.test, "--test path/to/test.ts")],
        });
    }
    if (action === "status") {
        const cards = loadCards(root).map((card) => inspectCard(root, card));
        return {
            cards: options.detail ? cards : cards.map(({ id, title, stale, revision }) => ({ id, title, stale, revision })),
            staleCards: cards.filter((card) => card.stale.length).length,
            ...(options.detail ? { context: memoryContext(root) } : {}),
            network: false,
        };
    }
    if (action === "show") {
        const id = text(value, "card ID"),
            card = loadCards(root).find((entry) => entry.id === id);
        if (!card) {
            throw new Error(`No memory card: ${id}`);
        }
        return inspectCard(root, card);
    }
    if (options.fts !== undefined && options.fts !== true) {
        throw new Error("Specify --fts once without a value");
    }
    if (options.fts && options.model !== undefined) {
        throw new Error("Choose --fts or --model, not both");
    }
    const bundled = fileURLToPath(new URL("../../../memory-model", import.meta.url));
    const directory = options.fts ? undefined : options.model === undefined ? (fs.existsSync(bundled) ? bundled : undefined) : text(options.model, "--model local-pack-directory");
    const embedder = directory ? await (await import("./localEmbedding.js")).loadLocalEmbedder(directory) : undefined;
    try {
        if (action === "index") {
            return await indexMemory(root, embedder);
        }
        const limit = options.limit === undefined ? 3 : typeof options.limit === "number" ? options.limit : Number(text(options.limit, "--limit"));
        const result = await searchMemory(root, text(value, "query"), { limit, embedder });
        return options.detail
            ? result
            : {
                  ...result,
                  results: result.results.map(({ id, title, body, stale, candidate, revision, symbols }) => ({
                      id,
                      title,
                      excerpt: body.slice(0, 240),
                      stale,
                      candidate,
                      revision,
                      symbols: symbols.map(({ file, name, line }) => ({ file, name, line })),
                  })),
              };
    } finally {
        await embedder?.dispose();
    }
}
