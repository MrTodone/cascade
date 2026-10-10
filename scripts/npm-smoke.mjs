/**
 * Cross-platform smoke test for a globally installed `cascade` (npm channel).
 * Assumes `cascade` is on PATH (npm i -g <tarball>). Verifies:
 *   - facade `/` and `/v1/models` respond 200
 *   - bundled router `/health` responds 200
 *   - `POST /api/app/shutdown` terminates the whole process tree
 * Exits non-zero on any failure. Runs identically on macOS/Linux/Windows.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CASCADE_PORT || 3321);
const ROUTER_PORT = Number(process.env.CASCADE_ROUTER_PORT || 19321);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTER = `http://127.0.0.1:${ROUTER_PORT}`;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

const rootRes = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
if (rootRes.status !== 0 || !rootRes.stdout) fail(`cannot resolve npm global root (${rootRes.error?.message || rootRes.status})`);
const pkgDir = path.join(rootRes.stdout.trim(), "@mrtodone", "cascade");
const example = path.join(pkgDir, "configs", "router.config.example.json");
if (!fs.existsSync(example)) fail(`example config missing: ${example}`);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-smoke-"));
const cfgDir = path.join(home, "cascade-run", "router");
fs.mkdirSync(path.join(cfgDir, "state"), { recursive: true });
fs.copyFileSync(example, path.join(cfgDir, "config.json"));

const env = { ...process.env, CASCADE_HOME: home, CASCADE_PORT: String(PORT), CASCADE_ROUTER_PORT: String(ROUTER_PORT) };
const child = spawn("cascade", ["start"], { env, stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });

async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.status;
  } catch {
    return 0;
  }
}

async function waitUp(url, tries = 45) {
  for (let i = 0; i < tries; i++) {
    if ((await get(url)) === 200) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let exitCode = null;
child.on("exit", (c) => { exitCode = c ?? 1; });

try {
  if (!(await waitUp(`${BASE}/`))) fail("facade did not respond 200");
  if (!(await waitUp(`${ROUTER}/health`, 45))) fail("bundled router /health did not respond 200");
  let models = 0;
  for (let i = 0; i < 20 && models !== 200; i++) {
    models = await get(`${BASE}/v1/models`);
    if (models !== 200) await new Promise((r) => setTimeout(r, 1000));
  }
  if (models !== 200) fail(`/v1/models returned ${models}`);
  console.log(`OK facade=200 models=200 router=200`);

  const r = await fetch(`${BASE}/api/app/shutdown`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => null);
  console.log(`shutdown status=${r ? r.status : "n/a"}`);
  for (let i = 0; i < 15 && exitCode === null; i++) await new Promise((res) => setTimeout(res, 500));
  if (exitCode === null) {
    try { child.kill("SIGKILL"); } catch {}
    fail("process did not exit after /api/app/shutdown");
  }
  console.log(`SMOKE OK (exit=${exitCode})`);
  process.exit(0);
} catch (e) {
  try { child.kill("SIGKILL"); } catch {}
  fail(e?.message || String(e));
}
