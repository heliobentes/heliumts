import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface SymbolReference {
    file: string;
    name: string;
    hash: string;
}
export interface Evidence {
    file: string;
    hash: string;
}
export interface Card {
    version: 1;
    id: string;
    title: string;
    symbols: SymbolReference[];
    tests: Evidence[];
    body: string;
    /** Read-time location, never persisted as evidence. */
    sourceFile?: string;
}
const forbidden = /(^|\/)(\.git|node_modules|dist|build|coverage|\.next|\.env[^/]*)(\/|$)|\.(pem|key|sqlite|db|p12|pfx)$/i;

/** Explicit repository references only. Never traverse a symlink or load application code. */
export function safePath(root: string, relative: string, internalIndex = false): string {
    if (
        !relative ||
        relative.includes("\\") ||
        path.isAbsolute(relative) ||
        relative.split("/").some((part) => part === ".." || part === ".") ||
        (forbidden.test(relative) && !(internalIndex && /^\.helium\/cache\/memory\/[a-f0-9]{24}\/index\.sqlite$/.test(relative)))
    ) {
        throw new Error(`Unsafe memory reference: ${relative}`);
    }
    const base = fs.realpathSync(root);
    let current = base;
    for (const part of relative.split("/")) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw new Error(`Symlink memory reference: ${relative}`);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }
    return current;
}
export function readReference(root: string, file: string): string {
    const target = safePath(root, file);
    if (!/\.(?:[cm]?[jt]sx?|md|json)$/.test(file)) {
        throw new Error(`Unsupported evidence file: ${file}`);
    }
    if (fs.statSync(target).size > 256_000) {
        throw new Error(`Evidence exceeds 256KB: ${file}`);
    }
    return fs.readFileSync(target, "utf8");
}
export function resolveSymbol(root: string, file: string, name: string) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) {
        throw new Error("Symbol references require a JS/TS source file");
    }
    const text = readReference(root, file);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const matches: ts.Node[] = [];
    function visit(node: ts.Node, prefix = "") {
        const named = node as ts.Node & { name?: ts.Node };
        const local = named.name && ts.isIdentifier(named.name) ? named.name.text : undefined;
        const declaration =
            ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node) ||
            ts.isVariableDeclaration(node) ||
            ts.isMethodDeclaration(node);
        const qualified = prefix && local ? `${prefix}.${local}` : local;
        if (declaration && qualified === name) {
            matches.push(node);
        }
        // Resolve only declared lexical symbols, not arbitrary function-body names.
        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
            node.forEachChild((child) => visit(child, qualified));
        } else if (ts.isSourceFile(node) || ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) {
            node.forEachChild((child) => visit(child, prefix));
        }
    }
    visit(source);
    if (!matches.length) {
        throw new Error(`Symbol not found: ${file}#${name}`);
    }
    if (matches.length > 1 && !matches.every(ts.isFunctionDeclaration)) {
        throw new Error(`Ambiguous symbol: ${file}#${name}`);
    }
    return { file, name, line: source.getLineAndCharacterOfPosition(matches[0].getStart(source)).line + 1, hash: hash(matches.map((node) => node.getText(source)).join("\n")) };
}
export function redact(text: string): string {
    return text
        .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, "[REDACTED PRIVATE MATERIAL]")
        .replace(/\b(?:sk-[\w-]{16,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[REDACTED TOKEN]")
        .replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*)["']?[^\s,"']+/gi, "$1[REDACTED]");
}
export function cardDirectory(root: string) {
    return safePath(root, ".helium/memory");
}
export function initializeMemory(root: string) {
    fs.mkdirSync(cardDirectory(root), { recursive: true });
    const cache = safePath(root, ".helium/cache");
    fs.mkdirSync(cache, { recursive: true });
    const ignore = safePath(root, ".helium/cache/.gitignore");
    if (!fs.existsSync(ignore)) {
        fs.writeFileSync(ignore, "*\n", { flag: "wx" });
    } else if (fs.readFileSync(ignore, "utf8").trim() !== "*") {
        throw new Error("Existing .helium/cache/.gitignore must ignore all derived files (*)");
    }
}
export function writeCard(root: string, input: { id: string; title: string; body: string; symbols?: { file: string; name: string }[]; tests?: string[] }) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.id) || !input.title.trim() || !input.body.trim()) {
        throw new Error("Card needs a stable lowercase ID, title and behavior/decision summary");
    }
    if (!input.symbols?.length || !input.tests?.length) {
        throw new Error("A card requires at least one symbol and test evidence file");
    }
    if (redact(input.body) !== input.body || redact(input.title) !== input.title) {
        throw new Error("Potential secret in card; remove it before recording");
    }
    const card: Card = {
        version: 1,
        id: input.id,
        title: input.title,
        symbols: input.symbols.map((ref) => {
            const { file, name, hash } = resolveSymbol(root, ref.file, ref.name);
            return { file, name, hash };
        }),
        tests: input.tests.map((file) => ({ file, hash: hash(readReference(root, file)) })),
        body: input.body,
    };
    initializeMemory(root);
    const { body, ...metadata } = card;
    const filename = safePath(root, `.helium/memory/${input.id}.md`);
    const text = `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${body}\n`;
    if (Buffer.byteLength(text) > 32_000) {
        throw new Error("Card exceeds 32KB");
    }
    const temporary = safePath(root, `.helium/memory/.${input.id}.${process.pid}.${Date.now()}.tmp`);
    let created = false;
    try {
        fs.writeFileSync(temporary, text, { flag: "wx" });
        created = true;
        // Atomic publication with no replacement: an existing card always wins.
        fs.linkSync(temporary, filename);
    } finally {
        if (created) {
            fs.rmSync(temporary, { force: true });
        }
    }
    return card;
}
export function loadCards(root: string): Card[] {
    const directory = cardDirectory(root);
    if (!fs.existsSync(directory)) {
        return [];
    }
    const names = fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(".md"))
        .sort();
    if (names.length > 500) {
        throw new Error("Memory prototype supports at most 500 cards");
    }
    const ids = new Set<string>();
    return names.map((name) => {
        const filename = safePath(root, `.helium/memory/${name}`);
        if (fs.statSync(filename).size > 32_000) {
            throw new Error(`Card exceeds 32KB: ${name}`);
        }
        const text = fs.readFileSync(filename, "utf8");
        if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
            throw new Error(`Resolve card merge conflict: ${name}`);
        }
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
        if (!match) {
            throw new Error(`Invalid JSON front matter: ${name}`);
        }
        const value = JSON.parse(match[1]);
        if (
            value.version !== 1 ||
            !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
            typeof value.title !== "string" ||
            !value.title.trim() ||
            !Array.isArray(value.symbols) ||
            !value.symbols.length ||
            !Array.isArray(value.tests) ||
            !value.tests.length
        ) {
            throw new Error(`Invalid card schema/version: ${name}`);
        }
        if (ids.has(value.id)) {
            throw new Error(`Duplicate memory card ID: ${value.id}`);
        }
        ids.add(value.id);
        for (const ref of [...value.symbols, ...value.tests]) {
            if (!ref || typeof ref.file !== "string" || !/^[a-f0-9]{64}$/.test(ref.hash)) {
                throw new Error(`Invalid evidence: ${name}`);
            }
            safePath(root, ref.file);
        }
        if (value.symbols.some((ref: SymbolReference) => typeof ref.name !== "string" || !ref.name)) {
            throw new Error(`Invalid symbol: ${name}`);
        }
        return { ...value, body: match[2].trim(), sourceFile: `.helium/memory/${name}` } as Card;
    });
}
export function inspectCard(root: string, card: Card) {
    const stale: string[] = [];
    const symbols = card.symbols.map((ref) => {
        try {
            const current = resolveSymbol(root, ref.file, ref.name);
            if (current.hash !== ref.hash) {
                stale.push(`Changed symbol: ${ref.file}#${ref.name}`);
            }
            return current;
        } catch (error) {
            stale.push(String(error));
            return { file: ref.file, name: ref.name, line: null, hash: null };
        }
    });
    for (const ref of card.tests) {
        try {
            if (hash(readReference(root, ref.file)) !== ref.hash) {
                stale.push(`Changed test evidence: ${ref.file}`);
            }
        } catch (error) {
            stale.push(String(error));
        }
    }
    return {
        id: card.id,
        title: redact(card.title),
        body: redact(card.body),
        symbols,
        stale,
        revision: hash(fs.readFileSync(safePath(root, card.sourceFile ?? `.helium/memory/${card.id}.md`), "utf8")),
    };
}

export interface CardPatch {
    body?: string;
    title?: string;
    append?: string;
    symbols?: { file: string; name: string }[];
    tests?: string[];
}
/** Cooperative writers serialize; exact-byte revisions reject stale read/modify/write requests. */
export function changeCard(root: string, id: string, revision: string, patch: CardPatch, acknowledgeEvidence = false) {
    if (!/^[a-f0-9]{64}$/.test(revision)) {
        throw new Error("Provide --if-match with the revision from memory show/status --detail");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !fs.existsSync(cardDirectory(root))) {
        throw new Error(`No memory card: ${id}`);
    }
    const lock = safePath(root, `.helium/memory/.${id}.lock`);
    const descriptor = fs.openSync(lock, "wx");
    let temporary: string | undefined;
    try {
        const card = loadCards(root).find((entry) => entry.id === id);
        if (!card) {
            throw new Error(`No memory card: ${id}`);
        }
        const filename = safePath(root, card.sourceFile!);
        const original = fs.readFileSync(filename, "utf8");
        if (hash(original) !== revision) {
            throw new Error("Card changed since read; inspect it again before updating");
        }
        if (patch.body !== undefined && (!patch.body.trim() || redact(patch.body) !== patch.body || !acknowledgeEvidence)) {
            throw new Error("Body replacement requires nonempty prose without secret-like material and --acknowledge");
        }
        if (patch.body !== undefined && patch.append !== undefined) {
            throw new Error("Choose body replacement or append");
        }
        if (patch.append !== undefined && (!patch.append.trim() || redact(patch.append) !== patch.append)) {
            throw new Error("Append must be nonempty prose without secret-like material");
        }
        if (patch.title !== undefined && (!patch.title.trim() || redact(patch.title) !== patch.title)) {
            throw new Error("Title must be nonempty without secret-like material");
        }
        if ((patch.symbols || patch.tests) && !acknowledgeEvidence) {
            throw new Error("Changing evidence requires --acknowledge after reviewing current source/tests");
        }
        const symbols = patch.symbols ?? card.symbols;
        const tests = patch.tests ?? card.tests.map((entry) => entry.file);
        if (!symbols.length || !tests.length) {
            throw new Error("A card requires symbol and test evidence");
        }
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(original)!;
        const metadata = {
            ...JSON.parse(frontmatter[1]),
            version: card.version,
            id: card.id,
            title: patch.title ?? card.title,
            symbols: acknowledgeEvidence
                ? symbols.map((ref) => {
                      const { file, name, hash } = resolveSymbol(root, ref.file, ref.name);
                      return { file, name, hash };
                  })
                : card.symbols,
            tests: acknowledgeEvidence ? tests.map((file) => ({ file, hash: hash(readReference(root, file)) })) : card.tests,
        };
        // Preserve existing body bytes exactly, including user formatting and trailing whitespace.
        const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(original)!;
        const body = (patch.body === undefined ? match[1] : `\n${patch.body}\n`) + (patch.append === undefined ? "" : `\n${patch.append}\n`);
        const result = `---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`;
        if (Buffer.byteLength(result) > 32_000) {
            throw new Error("Card exceeds 32KB");
        }
        const staged = safePath(root, `.helium/memory/.${id}.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(staged, result, { flag: "wx" });
        temporary = staged;
        if (hash(fs.readFileSync(filename, "utf8")) !== revision) {
            throw new Error("Card changed during update; no card was replaced");
        }
        fs.renameSync(temporary, filename);
        temporary = undefined;
    } finally {
        if (temporary) {
            fs.rmSync(temporary, { force: true });
        }
        fs.closeSync(descriptor);
        fs.unlinkSync(lock);
    }
    return inspectCard(
        root,
        loadCards(root).find((entry) => entry.id === id)!
    );
}
