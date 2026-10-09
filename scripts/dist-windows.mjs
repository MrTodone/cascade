/**
 * Task 37 — build the Windows single-executable distribution:
 *   1. compile server.ts (+ router core, self-spawn) → cascade.exe
 *   2. download pinned sing-box v1.14.1 (windows-amd64), verify SHA-256
 *   3. assemble a release dir: cascade.exe, sing-box.exe(+dll), dist/, catalog,
 *      configs/, START-Cascade.cmd, README-WINDOWS.txt, licenses/
 *   4. zip it as cascade-v<VERSION>-windows-x64.zip and write SHA256SUMS
 *
 * Run after `vite build`. Uses only built-in node + system tools (unzip/zip on
 * POSIX, Expand-Archive/Compress-Archive on Windows).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, cpSync, writeFileSync, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const VERSION = process.env.CASCADE_VERSION || pkg.version;
const ZIP_SUFFIX = process.env.CASCADE_ZIP_SUFFIX || "windows-x64";
const OUT = process.env.CASCADE_DIST_DIR
  ? resolve(process.env.CASCADE_DIST_DIR)
  : resolve(tmpdir(), "cascade-dist", `${VERSION}-${ZIP_SUFFIX}`);
const STAGE = join(OUT, "stage");
const ZIP_PATH = join(OUT, `cascade-v${VERSION}-${ZIP_SUFFIX}.zip`);

const SINGBOX_VERSION = "1.14.1";
const SINGBOX_SHA256 = "5197f16d492d93202dc623622149a6ed040f8eca263128f91d603f2b901baa89";
const SINGBOX_ZIP = join(OUT, `sing-box-${SINGBOX_VERSION}-windows-amd64.zip`);
const SINGBOX_URL = `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-windows-amd64.zip`;
const SINGBOX_PREFIX = `sing-box-${SINGBOX_VERSION}-windows-amd64`;

const log = (m) => console.log(`[dist-windows] ${m}`);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function shEscape(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function unzip(zipPath, destDir, entries) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const ps = ['-NoProfile', '-Command', `Expand-Archive -Path ${shEscape(zipPath)} -DestinationPath ${shEscape(destDir)} -Force`];
    execFileSync("powershell.exe", ps, { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-o", "-q", zipPath, ...entries, "-d", destDir], { stdio: "inherit" });
  }
}

function zipDir(dir, zipOut) {
  if (process.platform === "win32") {
    const ps = ['-NoProfile', '-Command', `Compress-Archive -Path ${shEscape(join(dir, "*"))} -DestinationPath ${shEscape(zipOut)} -Force`];
    execFileSync("powershell.exe", ps, { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-r", "-q", zipOut, "."], { cwd: dir, stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------
log(`version=${VERSION} suffix=${ZIP_SUFFIX} out=${OUT}`);
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, "cascade-router"), { recursive: true });
mkdirSync(join(STAGE, "licenses"), { recursive: true });
mkdirSync(join(STAGE, "dist"), { recursive: true });

// 1. compile both executables (two-file layout: facade + router core).
//    cascade.exe: facade+dashboard из server/exe-entry.ts — vite отсутствует в
//    графе (он живёт только в dev-entry), поэтому никаких rollup/native deps.
//    cascade-router.exe: отдельный env-driven бинарь ядра роутера.
{
  const compileArgs = ["build", "--compile", "--minify"];
  if (process.platform !== "win32" && process.env.CASCADE_TARGET) compileArgs.push("--target", process.env.CASCADE_TARGET);

  const facadeOut = join(STAGE, "cascade.exe");
  log("compiling cascade.exe …");
  execFileSync("bun", [...compileArgs, "server/exe-entry.ts", "--outfile", facadeOut], { cwd: ROOT, stdio: "inherit" });
  if (!existsSync(facadeOut)) throw new Error("bun compile produced no cascade.exe");
  log(`cascade.exe ${(readFileSync(facadeOut).length / 1024 / 1024).toFixed(1)} MB`);

  const routerOut = join(STAGE, process.platform === "win32" ? "cascade-router.exe" : "cascade-router.bin");
  log("compiling cascade-router.exe …");
  execFileSync("bun", [...compileArgs, "cascade-router/server.ts", "--outfile", routerOut], { cwd: ROOT, stdio: "inherit" });
  // cross-compile to windows appends ".exe" on POSIX hosts ("cascade-router.bin.exe")
  const routerBuilt = [routerOut, `${routerOut}.exe`].find((f) => existsSync(f));
  if (!routerBuilt) throw new Error("bun compile produced no cascade-router");
  log(`cascade-router ${(readFileSync(routerBuilt).length / 1024 / 1024).toFixed(1)} MB`);
}

// 2. pinned sing-box binary + sha256 verification
{
  log("downloading sing-box v" + SINGBOX_VERSION + " …");
  const res = await fetch(SINGBOX_URL);
  if (!res.ok) throw new Error(`sing-box download failed: ${res.status} ${res.statusText}`);
  const file = createWriteStream(SINGBOX_ZIP);
  await pipeline(Readable.fromWeb(res.body), file);
  const got = sha256(SINGBOX_ZIP);
  if (got !== SINGBOX_SHA256) {
    rmSync(SINGBOX_ZIP, { force: true });
    throw new Error(`sing-box SHA-256 mismatch! expected ${SINGBOX_SHA256}, got ${got}`);
  }
  log("sing-box sha256 OK");
  const x = join(OUT, "singbox-x");
  unzip(SINGBOX_ZIP, x, [`${SINGBOX_PREFIX}/sing-box.exe`, `${SINGBOX_PREFIX}/libcronet.dll`, `${SINGBOX_PREFIX}/LICENSE`]);
  copyFileSync(join(x, SINGBOX_PREFIX, "sing-box.exe"), join(STAGE, "sing-box.exe"));
  const dll = join(x, SINGBOX_PREFIX, "libcronet.dll");
  if (existsSync(dll)) copyFileSync(dll, join(STAGE, "libcronet.dll"));
  copyFileSync(join(x, SINGBOX_PREFIX, "LICENSE"), join(STAGE, "licenses", "SING-BOX-GPLv3.txt"));
  rmSync(SINGBOX_ZIP, { force: true });
  rmSync(x, { recursive: true, force: true });
}

// 3. assemble the release layout
cpSync(join(ROOT, "dist"), join(STAGE, "dist"), { recursive: true });
cpSync(join(ROOT, "cascade-router", "catalog.json"), join(STAGE, "cascade-router", "catalog.json"));
cpSync(join(ROOT, "configs"), join(STAGE, "configs"), { recursive: true });
for (const f of ["START-Cascade.cmd", "README-WINDOWS.txt"]) {
  if (!existsSync(join(ROOT, f))) throw new Error(`missing dist file: ${f}`);
  copyFileSync(join(ROOT, f), join(STAGE, f));
}

// 4. zip + checksums
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH, { force: true });
log("zipping …");
zipDir(STAGE, ZIP_PATH);
const zipHash = sha256(ZIP_PATH);
writeFileSync(join(OUT, "SHA256SUMS"), `${zipHash}  ${basename(ZIP_PATH)}\n`);
log("done:");
log(`  ${ZIP_PATH}`);
log(`  ${zipHash}  ${basename(ZIP_PATH)}`);
console.log(`CASCADE_DIST=${OUT}`);
console.log(`CASCADE_ZIP=${ZIP_PATH}`);