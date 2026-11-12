import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateTopics, MAX_GUIDE_BYTES, topics } from "./agent-topics.mjs";

const source = await readFile(new URL("../docs/agent-guide.md", import.meta.url), "utf8");

test("short guides retain every canonical task once, with complete warning and navigation", () => {
    const files = generateTopics(source);
    const warning = source.split("\n## ")[0].replace(/^# .+\n+/, "").trim();
    assert.equal(files.size, topics.length + 1);
    assert.equal(topics.length, 22);
    assert.deepEqual(files, generateTopics(source));
    assert.equal(new Set(topics.map(([id]) => id)).size, topics.length);
    for (const [id, title, , prerequisites, related] of topics) {
        const section = source.split(`\n### ${title}\n`)[1].split(/\n##?\s|\n###\s/)[0].trim();
        const content = files.get(`${id}.md`);
        assert.ok(content.includes(section), `${id} contains its canonical task body`);
        assert.ok(content.startsWith(`# ${title}\n\n${warning}\n\nPrerequisites:`));
        assert.ok(Buffer.byteLength(content) <= MAX_GUIDE_BYTES);
        assert.ok(files.get("index.md").includes(`./${id}.md`));
        for (const target of [...prerequisites, ...related]) {
            assert.ok(topics.some(([slug]) => slug === target));
            assert.ok(content.includes(`./${target}.md`));
        }
    }
    for (const [name, content] of files) {
        assert.ok(name.endsWith(".md"), "Only Markdown guide assets are generated");
        assert.ok(!content.includes("helium knowledge"), "Guides use direct Markdown access");
    }
    assert.ok(Buffer.byteLength(files.get("index.md")) < 2400);
});

test("README local documentation links resolve to actual packaged assets", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const temporary = await mkdtemp(path.join(tmpdir(), "helium-doc-pack-"));
    try {
        const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--cache", temporary], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" });
        assert.equal(packed.status, 0, packed.stderr);
        const shipped = new Set(JSON.parse(packed.stdout)[0].files.map((entry) => entry.path));
        async function check(target) {
            const file = target.split("#")[0];
            assert.ok(shipped.has(file), `${file} must ship in the package`);
            assert.ok((await readFile(new URL(`../${file}`, import.meta.url), "utf8")).trim(), `${file} must resolve to content`);
        }
        for (const [, target] of readme.matchAll(/\]\((?:\.\/)?(docs\/[^)]+)\)/g)) await check(target);
        // Release assets are checked against npm's real allowlist, not a hand-maintained topic whitelist.
        await check("docs/agent-start.md");
        await check("docs/migration-0.11.md");
        await assert.rejects(() => check("docs/routing.md"), /must ship/);
        await assert.rejects(() => check("docs/not-a-packaged-guide.md"), /must ship/);
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("API lookup paths resolve to built declarations that ship in the package", async () => {
    const declarations = [...source.matchAll(/node_modules\/heliumts\/(dist\/[\w./-]+\.d\.ts)/g)].map((match) => match[1]);
    assert.ok(new Set(declarations).size >= 7, "The guide must point to focused API declarations");
    for (const relative of new Set(declarations)) {
        assert.ok((await readFile(new URL(`../${relative}`, import.meta.url), "utf8")).trim(), relative);
    }
});

test("unknown, missing, duplicate and unassigned tasks fail rather than drop content", () => {
    assert.throws(() => generateTopics(source + "\n## New section\nImportant\n"), /sections changed/);
    assert.throws(() => generateTopics(source.replace("### Keep imports at the right boundary", "### Unknown task")), /sections changed/);
    assert.throws(() => generateTopics(source + "\n### Measure successful agent tasks\nDuplicate\n"), /Duplicate/);
    assert.throws(() => generateTopics(source.replace("## Imports and files\n", "## Imports and files\nUnassigned paragraph\n")), /Unassigned/);
    assert.throws(() => generateTopics(source.replace(source.split("\n## ")[0], "# App reference\n\nNo version.")), /version notice/);
    assert.throws(() => generateTopics(source + "\n" + "Long paragraph. ".repeat(500)), /exceeds/);
});

test("headings inside complete Markdown fences are not guide boundaries", () => {
    for (const fence of ["```", "~~~~"]) {
        const snippet = `${fence}md\n## Not a section\n### Not a task\n${fence}`;
        assert.ok(generateTopics(source + "\n" + snippet + "\n").get("measuring.md").includes(snippet));
    }
    assert.throws(() => generateTopics(source + "\n```ts\nunclosed"), /Unclosed/);
});

test("packaging drift checks stay silent for machine-readable npm output", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./sync-agent-topics.mjs", import.meta.url)), "--check", "--quiet"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
});
