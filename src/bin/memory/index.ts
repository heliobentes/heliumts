import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { hash, initializeMemory, inspectCard, loadCards, readReference, redact, safePath } from "./cards.js";

export interface MemoryEmbedder {
    /** Must include model revision, weight/tokenizer integrity and preprocessing version. */
    identity: string;
    dimensions: number;
    embed(texts: string[], options?: { query?: boolean }): Promise<number[][]>;
    /** Full document token windows; one or more vectors per document, no discarded tail. */
    embedDocuments?(texts: string[]): Promise<number[][][]>;
}
function git(root: string, args: string[]) {
    try {
        return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return "not-a-git-worktree";
    }
}
export function memoryContext(root: string) {
    const realRoot = fs.realpathSync(root);
    const gitDirectory = git(root, ["rev-parse", "--absolute-git-dir"]);
    return {
        root: realRoot,
        worktree: hash(realRoot + "\n" + gitDirectory).slice(0, 24),
        branch: git(root, ["symbolic-ref", "--short", "HEAD"]),
        head: git(root, ["rev-parse", "HEAD"]),
    };
}
function state(root: string) {
    const cards = loadCards(root);
    const inspected = cards.map((card) => inspectCard(root, card));
    // Hash full evidence contents, including changed test/source files, without storing their contents.
    const evidence = cards
        .flatMap((card) => [...card.symbols, ...card.tests])
        .map((ref) => {
            try {
                return { file: ref.file, hash: hash(readReference(root, ref.file)) };
            } catch {
                return { file: ref.file, missing: true };
            }
        });
    return { cards, inspected, fingerprint: hash(JSON.stringify({ version: 1, context: memoryContext(root), cards, evidence })) };
}
async function database(root: string, readonly = false) {
    const name = "node:sqlite";
    let sqlite: typeof import("node:sqlite");
    try {
        sqlite = await import(name);
    } catch {
        throw new Error(
            "Memory indexing/search requires a Node runtime with node:sqlite (Node22.13+ or Node24+). Normal Helium commands remain supported on Node20. Use memory status/show without the index."
        );
    }
    const directory = `.helium/cache/memory/${memoryContext(root).worktree}`;
    if (!readonly) {
        initializeMemory(root);
        fs.mkdirSync(safePath(root, directory), { recursive: true });
    }
    const filename = safePath(root, directory + "/index.sqlite", true);
    if (readonly && !fs.existsSync(filename)) {
        throw new Error("No memory index. Run helium memory index.");
    }
    const db = new sqlite.DatabaseSync(filename, { readOnly: readonly });
    db.exec("PRAGMA busy_timeout=2000");
    return db;
}
function vector(values: number[], dimensions: number) {
    if (!Array.isArray(values) || values.length !== dimensions || values.some((n) => !Number.isFinite(n)) || !values.some((n) => n !== 0)) {
        throw new Error("Invalid embedding vector/dimensions");
    }
    return values;
}
function cosine(a: number[], b: number[]) {
    let product = 0,
        left = 0,
        right = 0;
    for (let i = 0; i < a.length; i++) {
        product += a[i] * b[i];
        left += a[i] ** 2;
        right += b[i] ** 2;
    }
    return product / Math.sqrt(left * right);
}
export async function indexMemory(root: string, embedder?: MemoryEmbedder) {
    const current = state(root);
    if (embedder && (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1 || embedder.dimensions > 4096 || !embedder.identity)) {
        throw new Error("Invalid embedding provider metadata");
    }
    const db = await database(root);
    try {
        db.exec(
            "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS cards USING fts5(id UNINDEXED,title,body,symbols); CREATE TABLE IF NOT EXISTS card_content(id TEXT PRIMARY KEY,text_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS card_chunks(id TEXT PRIMARY KEY,vectors TEXT NOT NULL);"
        );
        const previous = metadata(db);
        const sameModel = previous?.embedding?.identity === embedder?.identity && previous?.embedding?.dimensions === embedder?.dimensions;
        const old = new Map((db.prepare("SELECT id,text_hash FROM card_content").all() as { id: string; text_hash: string }[]).map((row) => [row.id, row.text_hash]));
        const entries = current.inspected.map((card) => {
            const symbols = card.symbols.map((ref) => `${ref.file} ${ref.name}`).join(" ");
            return { card, symbols, text: `${card.title}\n${card.body}\n${symbols}` };
        });
        const storedChunks = new Set((db.prepare("SELECT id FROM card_chunks").all() as { id: string }[]).map((row) => row.id));
        const changed = entries.filter((entry) => !previous || old.get(entry.card.id) !== hash(entry.text));
        const embedded = embedder ? entries.filter((entry) => !sameModel || !storedChunks.has(entry.card.id) || old.get(entry.card.id) !== hash(entry.text)) : [];
        const vectors =
            embedder && embedded.length
                ? embedder.embedDocuments
                    ? await embedder.embedDocuments(embedded.map((entry) => entry.text))
                    : (await embedder.embed(embedded.map((entry) => entry.text))).map((value) => [value])
                : [];
        if (vectors.length !== embedded.length || vectors.some((chunks) => !chunks.length)) {
            throw new Error("Invalid embedding document/output count");
        }
        vectors.forEach((chunks) => chunks.forEach((values) => vector(values, embedder!.dimensions)));
        const removed = [...old.keys()].filter((id) => !entries.some((entry) => entry.card.id === id));
        db.exec("BEGIN IMMEDIATE");
        if (!previous) {
            db.exec("DELETE FROM cards");
        }
        for (const id of removed) {
            db.prepare("DELETE FROM cards WHERE id=?").run(id);
            db.prepare("DELETE FROM card_content WHERE id=?").run(id);
            db.prepare("DELETE FROM card_chunks WHERE id=?").run(id);
        }
        if (!sameModel || !embedder) {
            db.exec("DELETE FROM card_chunks");
        }
        for (const entry of changed) {
            db.prepare("DELETE FROM cards WHERE id=?").run(entry.card.id);
            db.prepare("INSERT INTO cards(id,title,body,symbols) VALUES(?,?,?,?)").run(entry.card.id, entry.card.title, entry.card.body, entry.symbols);
            db.prepare("INSERT OR REPLACE INTO card_content VALUES(?,?)").run(entry.card.id, hash(entry.text));
        }
        embedded.forEach((entry, index) => db.prepare("INSERT OR REPLACE INTO card_chunks VALUES(?,?)").run(entry.card.id, JSON.stringify(vectors[index])));
        db.prepare("INSERT OR REPLACE INTO metadata VALUES('state',?)").run(
            JSON.stringify({ schema: 2, fingerprint: current.fingerprint, embedding: embedder ? { identity: embedder.identity, dimensions: embedder.dimensions } : null })
        );
        db.exec("COMMIT");
        return {
            cards: current.cards.length,
            staleCards: current.inspected.filter((card) => card.stale.length).length,
            updated: changed.length,
            removed: removed.length,
            embedded: embedded.length,
            semanticChunks: (db.prepare("SELECT vectors FROM card_chunks").all() as { vectors: string }[]).reduce((sum, row) => sum + JSON.parse(row.vectors).length, 0),
            mode: embedder ? "hybrid" : "fts",
            context: memoryContext(root),
        };
    } finally {
        db.close();
    }
}
function metadata(db: DatabaseSync) {
    try {
        const row = db.prepare("SELECT value FROM metadata WHERE key='state'").get() as { value: string } | undefined;
        const value = row && JSON.parse(row.value);
        return value?.schema === 2 ? (value as { fingerprint: string; embedding: { identity: string; dimensions: number } | null }) : undefined;
    } catch {
        return undefined;
    }
}
export async function searchMemory(root: string, query: string, options: { limit?: number; embedder?: MemoryEmbedder } = {}) {
    const limit = options.limit ?? 5;
    if (typeof query !== "string" || !query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 10) {
        throw new Error("Provide a query of 1..500 characters and a limit of 1..10");
    }
    // Refresh only disposable cache; recorded card evidence is never rewritten or acknowledged here.
    await indexMemory(root, options.embedder);
    const current = state(root),
        db = await database(root, true);
    try {
        const meta = metadata(db);
        if (!meta || meta.fingerprint !== current.fingerprint) {
            throw new Error("Memory changed during search; retry. Cards are never automatically rewritten.");
        }
        const words = redact(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
        if (!words.length) {
            throw new Error("Query must contain searchable words");
        }
        const expression = [...new Set(words)].map((word) => `"${word}"`).join(" OR ");
        const lexical = db.prepare("SELECT id FROM cards WHERE cards MATCH ? ORDER BY rank LIMIT 500").all(expression) as { id: string }[];
        const scores = new Map(lexical.map((row, index) => [row.id, 1 / (index + 1)]));
        if (options.embedder) {
            const embedder = options.embedder;
            if (!meta.embedding || meta.embedding.identity !== embedder.identity || meta.embedding.dimensions !== embedder.dimensions) {
                throw new Error("Embedding model/revision mismatch. Rebuild with the selected local model.");
            }
            const output = await embedder.embed([redact(query)], { query: true });
            if (output.length !== 1) {
                throw new Error("Embedding provider must return one query vector");
            }
            const q = vector(output[0], embedder.dimensions);
            for (const row of db.prepare("SELECT id,vectors FROM card_chunks").all() as { id: string; vectors: string }[]) {
                const chunks = JSON.parse(row.vectors) as number[][];
                const similarity = Math.max(...chunks.map((chunk) => cosine(q, vector(chunk, embedder.dimensions))));
                scores.set(row.id, 0.5 * (scores.get(row.id) ?? 0) + 0.5 * Math.max(0, similarity));
            }
        }
        return {
            notice: "Candidates, not verified answers or calibrated relevance. Review evidence and stale flags.",
            mode: options.embedder ? "hybrid" : "fts",
            results: [...scores]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, limit)
                .map(([id, score]) => {
                    const card = current.inspected.find((item) => item.id === id)!;
                    return { ...card, body: card.body, score, candidate: true };
                }),
        };
    } finally {
        db.close();
    }
}
