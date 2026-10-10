#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const SERVER = join(PKG_ROOT, "dist", "server.cjs");

const args = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(join(PKG_ROOT, "package.json"), "utf8"));

if (args.includes("--version") || args.includes("-v") || args[0] === "version") {
  console.log(pkg.version);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
  console.log(`cascade ${pkg.version}\n\nUsage: cascade [start]\n\nEnv:\n  CASCADE_PORT         facade port (default 3000)\n  CASCADE_ROUTER_PORT  router port (default 19080)\n  CASCADE_HOME         data dir (default ~/.cascade)`);
  process.exit(0);
}

const cmd = args[0] || "start";
if (cmd !== "start") {
  console.error(`unknown command: ${cmd}\nUsage: cascade [start]`);
  process.exit(2);
}

if (!fs.existsSync(SERVER)) {
  console.error(`cascade: bundled server missing at ${SERVER}`);
  process.exit(1);
}

const home = process.env.CASCADE_HOME || join(os.homedir(), ".cascade");
const env = {
  ...process.env,
  CASCADE_PKG_ROOT: PKG_ROOT,
  CASCADE_HOME: home,
};

const child = spawn(process.execPath, [SERVER, ...args.slice(1)], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
const forward = (sig) => () => {
  try { child.kill(sig); } catch {}
};
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exit(code == null ? (signal ? 1 : 0) : code);
});
