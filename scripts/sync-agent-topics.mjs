import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateTopics } from "./agent-topics.mjs";

const root = new URL("../", import.meta.url);
const check = process.argv.includes("--check");
const files = generateTopics(await readFile(new URL("docs/agent-guide.md", root), "utf8"));
const directory = new URL("docs/agent/", root);
if (!check) await mkdir(directory, { recursive: true });
for (const name of await readdir(directory)) {
    if (!files.has(name)) throw new Error(`Unexpected generated topic: ${name}. Remove obsolete topics explicitly.`);
}
for (const [name, content] of files) {
    const destination = new URL(name, directory);
    if (check) {
        if ((await readFile(destination, "utf8")) !== content) throw new Error(`${fileURLToPath(destination)} is stale. Run node scripts/sync-agent-topics.mjs.`);
    } else await writeFile(destination, content);
}
if (!process.argv.includes("--quiet")) console.log(check ? "Agent topics match the canonical guide." : "Generated agent topics.");
