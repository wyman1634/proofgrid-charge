import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const children = [];
const childEnv = { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" };

function start(name, command, args) {
  const child = spawn(command, args, { cwd: root, env: childEnv, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`${name} stopped with code ${code}${signal ? ` (${signal})` : ""}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: childEnv, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function waitForChain() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      // The local EVM is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("local EVM did not become ready");
}

let stopping = false;
function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await rm(path.join(root, "web/public/deployment.json"), { force: true });
  start("local EVM", bin("hardhat"), ["node", "--hostname", "127.0.0.1"]);
  await waitForChain();
  await run(bin("hardhat"), ["run", "scripts/deploy.ts", "--network", "localhost"]);
  start("Go service", "go", ["run", "./cmd/service"]);
  start("Web app", bin("vite"), ["--config", "web/vite.config.ts", "--host", "127.0.0.1"]);
  console.log("ProofGrid Charge is ready at http://127.0.0.1:5173");
} catch (error) {
  console.error(error);
  shutdown(1);
}
