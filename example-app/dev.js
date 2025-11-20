import { spawn } from "node:child_process";

function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: "pipe" });
  p.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  p.on("exit", (c) => console.log(`[${name}] exited ${c}`));
}

run("RPC", "npx", ["tsx", "src/helium-server.ts"]);
run("Vite", "npx", ["vite"]);
