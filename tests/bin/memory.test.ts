// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changeCard, initializeMemory, inspectCard, loadCards, redact, resolveSymbol, safePath, writeCard } from "../../src/bin/memory/cards";
import { memoryCommand } from "../../src/bin/memory/command";
import { loadLocalEmbedder, tokenWindows } from "../../src/bin/memory/localEmbedding";
import { indexMemory, memoryContext, searchMemory } from "../../src/bin/memory/index";

let root: string;
const write = (file: string, text: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
};
const add = (id = "cancel-stream") =>
    writeCard(root, {
        id,
        title: "Cancel provider streams",
        body: "Aborting streaming releases the provider reader. Preserve partial text; never persist a completed answer on cancellation.",
        symbols: [{ file: "src/stream.ts", name: "cancel" }],
        tests: ["tests/stream.test.ts"],
    });
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "helium-memory-"));
    write("src/stream.ts", 'export function cancel() { return "stopped"; }');
    write("tests/stream.test.ts", "// cancellation regression evidence\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("version-controlled concept cards", () => {
    it("never executes source, never overwrites cards and ignores only derived cache", () => {
        write("src/stream.ts", 'throw new Error("must not execute"); export function cancel() { return 1; }');
        add();
        const before = fs.readFileSync(path.join(root, ".helium/memory/cancel-stream.md"), "utf8");
        expect(() => add()).toThrow();
        expect(fs.readFileSync(path.join(root, ".helium/memory/cancel-stream.md"), "utf8")).toBe(before);
        expect(loadCards(root)[0].symbols[0]).not.toHaveProperty("line");
        expect(inspectCard(root, loadCards(root)[0]).stale).toEqual([]);
        expect(fs.readFileSync(path.join(root, ".helium/cache/.gitignore"), "utf8")).toBe("*\n");
    });
    it("resolves moved lines without marking an unchanged symbol stale, then detects changed code/tests", () => {
        add();
        write("src/stream.ts", '\n\nexport function cancel() { return "stopped"; }');
        expect(inspectCard(root, loadCards(root)[0])).toMatchObject({ stale: [], symbols: [{ line: 3 }] });
        write("src/stream.ts", 'export function cancel() { return "different"; }');
        write("tests/stream.test.ts", "// changed evidence");
        expect(inspectCard(root, loadCards(root)[0]).stale).toHaveLength(2);
        fs.unlinkSync(path.join(root, "src/stream.ts"));
        expect(inspectCard(root, loadCards(root)[0]).symbols[0].line).toBeNull();
    });
    it("groups overloads and resolves class methods; rejects ambiguous duplicate variable symbols", () => {
        write(
            "src/types.ts",
            "export function run(x:string):string; export function run(x:number):number; export function run(x:unknown){return x;} export class Queue { stop(){} }"
        );
        expect(resolveSymbol(root, "src/types.ts", "run").line).toBe(1);
        expect(resolveSymbol(root, "src/types.ts", "Queue.stop").name).toBe("Queue.stop");
        write("src/duplicate.ts", "const item=1; const item=2;");
        expect(() => resolveSymbol(root, "src/duplicate.ts", "item")).toThrow(/Ambiguous/);
    });
    it("diagnoses merge conflicts, duplicate stable IDs and unknown schema versions", () => {
        add();
        const filename = path.join(root, ".helium/memory/cancel-stream.md"),
            text = fs.readFileSync(filename, "utf8");
        write(".helium/memory/other.md", text);
        expect(() => loadCards(root)).toThrow(/Duplicate/);
        fs.unlinkSync(path.join(root, ".helium/memory/other.md"));
        fs.writeFileSync(filename, text.replace('"version": 1', '"version": 2'));
        expect(() => loadCards(root)).toThrow(/schema\/version/);
        fs.writeFileSync(filename, "<<<<<<< ours\n" + text);
        expect(() => loadCards(root)).toThrow(/merge conflict/);
    });
    it("refuses traversal, sensitive evidence paths, dangling/real symlinks and secret-like card summaries", () => {
        for (const file of ["../outside.ts", ".env", "src/private.pem", "/tmp/file.ts", "node_modules/module.ts"]) expect(() => safePath(root, file)).toThrow();
        fs.symlinkSync("/nonexistent/target", path.join(root, "dangling"));
        expect(() => safePath(root, "dangling/file.ts")).toThrow(/Symlink/);
        fs.symlinkSync(os.tmpdir(), path.join(root, "external"));
        expect(() => safePath(root, "external/file.ts")).toThrow(/Symlink/);
        expect(() =>
            writeCard(root, { id: "secret", title: "Key", body: 'api_key="do-not-store"', symbols: [{ file: "src/stream.ts", name: "cancel" }], tests: ["tests/stream.test.ts"] })
        ).toThrow(/secret/);
        expect(redact('password="not-public" sk-abcdefghijklmnopqrst')).not.toContain("not-public");
    });
});

describe("rebuildable worktree-local SQLite index", () => {
    it("never executes an unreviewed local model runtime even if its manifest supplies self-consistent hashes", async () => {
        write("pack/manifest.json", JSON.stringify({ schemaVersion: 1, id: "untrusted", files: [], runtime: { module: "evil.mjs" } }));
        write("pack/evil.mjs", "throw new Error('must never execute');");
        await expect(loadLocalEmbedder(path.join(root, "pack"))).rejects.toThrow(/Unrecognized model pack/);
    });

    it("retrieves bounded FTS concept context, treats operators as text and detects user edits without rewriting", async () => {
        add();
        expect(await indexMemory(root)).toMatchObject({ cards: 1, mode: "fts" });
        const result = await searchMemory(root, "provider cancellation");
        expect(result.results[0].id).toBe("cancel-stream");
        expect((await searchMemory(root, '" OR 1=1 --')).results).toEqual([]);
        const file = path.join(root, ".helium/memory/cancel-stream.md");
        fs.appendFileSync(file, "\nUser decision: preserve errors.\n");
        expect((await searchMemory(root, "provider")).results[0].id).toBe("cancel-stream");
        await indexMemory(root);
        expect(fs.readFileSync(file, "utf8")).toContain("User decision");
        await expect(searchMemory(root, "provider", { limit: 11 })).rejects.toThrow(/limit/);
    });
    it("invalidates for evidence contents and branch changes, while separating worktrees", async () => {
        execFileSync("git", ["init", "-q"], { cwd: root });
        add();
        await indexMemory(root);
        execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/other"], { cwd: root });
        expect((await searchMemory(root, "provider")).results[0].id).toBe("cancel-stream");
        await indexMemory(root);
        write("tests/stream.test.ts", "// new test evidence");
        expect((await searchMemory(root, "provider")).results[0].id).toBe("cancel-stream");
        await indexMemory(root);
        expect((await searchMemory(root, "provider")).results[0].stale).toHaveLength(1);
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "helium-worktree-"));
        try {
            expect(memoryContext(other).worktree).not.toBe(memoryContext(root).worktree);
        } finally {
            fs.rmSync(other, { recursive: true });
        }
    });
    it("supports explicit hybrid vectors and refuses changed model integrity/revision", async () => {
        add();
        const embedder = { identity: "fixture@sha256-v1", dimensions: 2, embed: async (texts: string[]) => texts.map(() => [1, 0]) };
        await indexMemory(root, embedder);
        expect((await searchMemory(root, "disconnected synonyms", { embedder })).results[0].id).toBe("cancel-stream");
        expect((await searchMemory(root, "provider", { embedder: { ...embedder, identity: "fixture@sha256-v2" } })).results[0].id).toBe("cancel-stream");
        await expect(indexMemory(root, { ...embedder, embed: async () => [[NaN, 0]] })).rejects.toThrow(/Invalid embedding/);
        expect((await searchMemory(root, "provider")).results[0].id).toBe("cancel-stream");
    });
    it("redacts manually added secret-like text before FTS storage/output, leaving source card untouched", async () => {
        add();
        const file = path.join(root, ".helium/memory/cancel-stream.md");
        fs.appendFileSync(file, '\npassword="private-value"\n');
        await indexMemory(root);
        const result = await searchMemory(root, "provider");
        expect(JSON.stringify(result)).not.toContain("private-value");
        expect(fs.readFileSync(file, "utf8")).toContain("private-value");
    });
    it("rejects malformed CLI modes/options and preserves existing ignore/user files", async () => {
        await expect(memoryCommand(root, "add", "x", { symbol: "missing", title: "x", summary: "x", test: "x" })).rejects.toThrow(/file.ts#name/);
        await expect(memoryCommand(root, "search", "query", { title: "invalid" })).rejects.toThrow(/not supported/);
        await expect(memoryCommand(root, "index", "unexpected", {})).rejects.toThrow(/does not accept/);
        add();
        await indexMemory(root);
        expect(await memoryCommand(root, "search", "provider", { limit: 3, fts: true, "--": [] })).toMatchObject({ mode: "fts" });
        initializeMemory(root);
        write(".helium/cache/.gitignore", "user rule\n");
        expect(() => initializeMemory(root)).toThrow(/Existing/);
    });
});

describe("public reviewed workflow and incremental semantic coverage", () => {
    it("preserves user body bytes, rejects stale revisions and acknowledges evidence only explicitly", async () => {
        add();
        const filename = path.join(root, ".helium/memory/cancel-stream.md");
        fs.writeFileSync(filename, fs.readFileSync(filename, "utf8").replace('"version": 1,', '"version": 1, "userMetadata": {"keep": true},'));
        fs.appendFileSync(filename, "\nUser prose  \n");
        const original = fs.readFileSync(filename, "utf8").split("---\n").slice(2).join("---\n");
        const card = inspectCard(root, loadCards(root)[0]);
        const updated = changeCard(root, card.id, card.revision, { append: "New decision." });
        expect(fs.readFileSync(filename, "utf8")).toContain(original);
        expect(fs.readFileSync(filename, "utf8")).toContain('"userMetadata"');
        expect(() => changeCard(root, card.id, card.revision, { append: "Lost update" })).toThrow(/changed since read/);
        write("src/stream.ts", "export function cancel(){return 2}");
        expect(inspectCard(root, loadCards(root)[0]).stale).toHaveLength(1);
        await expect(memoryCommand(root, "review", card.id, { ifMatch: updated.revision })).rejects.toThrow(/acknowledge/);
        const reviewed = await memoryCommand(root, "review", card.id, { ifMatch: updated.revision, acknowledge: true });
        expect(reviewed).toMatchObject({ stale: [] });
        expect(fs.readFileSync(filename, "utf8")).toContain(original);
        expect(fs.readFileSync(filename, "utf8")).toContain('"userMetadata"');
        expect(() => changeCard(root, card.id, (reviewed as typeof card).revision, { body: "Replace silently" })).toThrow(/acknowledge/);
    });
    it("supports public multi-evidence JSON creation/update and compact output without private imports", async () => {
        write(
            "card.json",
            JSON.stringify({ title: "Cancellation", body: "Keep user prose.", symbols: [{ file: "src/stream.ts", name: "cancel" }], tests: ["tests/stream.test.ts"] })
        );
        const created = (await memoryCommand(root, "create", "cancel", { input: "card.json" })) as { revision: string };
        write("patch.json", JSON.stringify({ append: "Only durable decisions need cards." }));
        await memoryCommand(root, "update", "cancel", { input: "patch.json", ifMatch: created.revision });
        const result = await memoryCommand(root, "search", "Cancellation", { fts: true });
        expect(result).toMatchObject({ mode: "fts", results: [{ id: "cancel", symbols: [{ line: 1 }] }] });
        expect((result as { results: Record<string, unknown>[] }).results[0]).not.toHaveProperty("body");
        expect(JSON.stringify(result)).toContain("Keep user prose");
        expect(JSON.stringify(await memoryCommand(root, "search", "Cancellation", { fts: true, detail: true }))).toContain("Keep user prose");
    });
    it("reuses vectors on evidence-only edits, keeps stale warnings, and incrementally updates/removes documents", async () => {
        add();
        const calls: string[][] = [];
        const embedder = {
            identity: "chunks-v1",
            dimensions: 2,
            embed: async () => [[0, 1]],
            embedDocuments: async (texts: string[]) => {
                calls.push(texts);
                return texts.map(() => [
                    [1, 0],
                    [0, 1],
                ]);
            },
        };
        await indexMemory(root, embedder);
        write("tests/stream.test.ts", "// evidence changed");
        const result = await searchMemory(root, "tail fact", { embedder });
        expect(result.results[0].stale).toHaveLength(1);
        expect(calls).toHaveLength(1);
        expect((await indexMemory(root, embedder)).embedded).toBe(0);
        expect(result.results[0].score).toBe(0.5);
        fs.appendFileSync(path.join(root, ".helium/memory/cancel-stream.md"), "\nTail decision");
        expect((await indexMemory(root, embedder)).embedded).toBe(1);
        fs.unlinkSync(path.join(root, ".helium/memory/cancel-stream.md"));
        expect((await searchMemory(root, "tail", { embedder })).results).toEqual([]);
    });
    it("migrates old cache schema without retaining deleted-card hits", async () => {
        add();
        await indexMemory(root);
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(path.join(root, `.helium/cache/memory/${memoryContext(root).worktree}/index.sqlite`));
        db.prepare("UPDATE metadata SET value=? WHERE key='state'").run(JSON.stringify({ schema: 1 }));
        db.exec("DELETE FROM card_content");
        db.close();
        fs.unlinkSync(path.join(root, ".helium/memory/cancel-stream.md"));
        expect((await searchMemory(root, "provider")).results).toEqual([]);
    });
    it("windows every long-document token including tail and keeps BERT boundaries", () => {
        const ids = Array.from({ length: 900 }, (_, i) => i);
        const windows = tokenWindows({ input_ids: [ids], attention_mask: [ids.map(() => 1)], token_type_ids: [ids.map(() => 0)] }, 256);
        const covered = new Set(windows.flatMap((w) => w.input_ids[0]));
        expect(covered.size).toBe(900);
        for (const w of windows) {
            expect(w.input_ids[0].length).toBeLessThanOrEqual(256);
            expect(w.input_ids[0][0]).toBe(0);
            expect(w.input_ids[0].at(-1)).toBe(899);
        }
    });
});
