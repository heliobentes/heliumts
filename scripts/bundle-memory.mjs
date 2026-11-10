import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifiedPack } from "../dist/bin/memory/localEmbedding.js";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--model" || args[2] !== "--out") throw new Error("Use --model <reviewed local pack> --out <output directory>; run npm run build first");
const root = fileURLToPath(new URL("../", import.meta.url));
const pack = fs.realpathSync(args[1]);
const { manifest } = verifiedPack(pack);
const output = path.resolve(args[3]);
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, `heliumts-${JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version}-memory-experimental.tgz`);
if (fs.existsSync(target)) throw new Error("Refusing to overwrite an existing experimental bundle");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "helium-memory-bundle-"));
const env = {...process.env, npm_config_cache:path.join(temporary,"npm-cache"), npm_config_offline:"true"};
try {
    const normal = JSON.parse(execFileSync("npm",["pack","--ignore-scripts","--json","--pack-destination",temporary],{cwd:root,env,encoding:"utf8"}))[0].filename;
    execFileSync("tar",["-xzf",path.join(temporary,normal),"-C",temporary]);
    const stage = path.join(temporary,"package");
    // Normal packages never include model assets. Only this explicit experimental
    // artifact opts into them in its isolated manifest.
    const stagedManifestPath = path.join(stage, "package.json");
    const stagedManifest = JSON.parse(fs.readFileSync(stagedManifestPath, "utf8"));
    stagedManifest.files = [...new Set([...(stagedManifest.files ?? []), "memory-model"])];
    fs.writeFileSync(stagedManifestPath, JSON.stringify(stagedManifest, null, 2) + "\n");
    for (const relative of ["manifest.json",...manifest.files.map(file=>file.path)]) {
        const destination = path.join(stage,"memory-model",relative);
        fs.mkdirSync(path.dirname(destination),{recursive:true});
        fs.copyFileSync(path.join(pack,relative),destination,fs.constants.COPYFILE_EXCL);
    }
    const artifact = JSON.parse(execFileSync("npm",["pack","--ignore-scripts","--json","--pack-destination",temporary],{cwd:stage,env,encoding:"utf8"}))[0].filename;
    fs.copyFileSync(path.join(temporary,artifact),target,fs.constants.COPYFILE_EXCL);
    console.log(JSON.stringify({artifact:target,bytes:fs.statSync(target).size,model:manifest.id,revision:manifest.revision,network:false,normalDependenciesChanged:false},null,2));
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
