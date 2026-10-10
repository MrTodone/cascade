/**
 * Task 38 — build the Linux x64 distribution tarball:
 *   1. cross-compile server.ts (+ router core, self-spawn) → cascade and
 *      cascade-router.bin via `bun build --compile --target=bun-linux-x64`
 *   2. download pinned sing-box v1.14.1 (linux-amd64), verify SHA-256
 *   3. assemble a release dir: cascade, cascade-router.bin, bin/sing-box,
 *      cascade-router/catalog.json, dist/, configs/ (incl. systemd), START-cascade.sh,
 *      README-LINUX.txt, licenses/
 *   4. tar.gz it as cascade-v<VERSION>-linux-x64.tar.gz and write SHA256SUMS
 *
 * Run after `vite build`. Uses only built-in node + system tools.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, cpSync, writeFileSync, chmodSync, createWriteStream } from "node:fs";
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
const SUFFIX = process.env.CASCADE_TAR_SUFFIX || "linux-x64";
const OUT = process.env.CASCADE_DIST_DIR
  ? resolve(process.env.CASCADE_DIST_DIR)
  : resolve(tmpdir(), "cascade-dist", `${VERSION}-${SUFFIX}`);
const STAGE = join(OUT, "stage");
const TAR_PATH = join(OUT, `cascade-v${VERSION}-${SUFFIX}.tar.gz`);

const SINGBOX_VERSION = "1.14.1";
const SINGBOX_SHA256 = "12cb2816b52febb356f6a885b740cc8758c3f30b8ae0ca8edba80f0d2d35343f";
const SINGBOX_TGZ = join(OUT, `sing-box-${SINGBOX_VERSION}-linux-amd64.tar.gz`);
const SINGBOX_URL = `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-amd64.tar.gz`;
const SINGBOX_PREFIX = `sing-box-${SINGBOX_VERSION}-linux-amd64`;

const log = (m) => console.log(`[dist-linux] ${m}`);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---------------------------------------------------------------------------
log(`version=${VERSION} suffix=${SUFFIX} out=${OUT}`);
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, "bin"), { recursive: true });
mkdirSync(join(STAGE, "cascade-router"), { recursive: true });
mkdirSync(join(STAGE, "licenses"), { recursive: true });
mkdirSync(join(STAGE, "dist"), { recursive: true });

// 1. cross-compile both executables (two-file layout: facade + router core).
//    cascade: facade+dashboard из server/exe-entry.ts — vite отсутствует в
//    графе (он живёт только в dev-entry), поэтому никаких rollup/native deps.
//    cascade-router.bin: отдельный env-driven бинарь ядра роутера.
{
  const target = process.env.CASCADE_TARGET || "bun-linux-x64";
  const compileArgs = ["build", "--compile", "--minify", "--target", target];

  const facadeOut = join(STAGE, "cascade");
  log("compiling cascade …");
  execFileSync("bun", [...compileArgs, "server/exe-entry.ts", "--outfile", facadeOut], { cwd: ROOT, stdio: "inherit" });
  if (!existsSync(facadeOut)) throw new Error("bun compile produced no cascade");
  log(`cascade ${(readFileSync(facadeOut).length / 1024 / 1024).toFixed(1)} MB`);

  const routerOut = join(STAGE, "cascade-router.bin");
  log("compiling cascade-router.bin …");
  execFileSync("bun", [...compileArgs, "cascade-router/server.ts", "--outfile", routerOut], { cwd: ROOT, stdio: "inherit" });
  // cross-compile to linux may append nothing on POSIX hosts; guard both names.
  const routerBuilt = [routerOut, `${routerOut}.exe`].find((f) => existsSync(f));
  if (!routerBuilt) throw new Error("bun compile produced no cascade-router");
  if (routerBuilt !== routerOut) copyFileSync(routerBuilt, routerOut);
  log(`cascade-router ${(readFileSync(routerOut).length / 1024 / 1024).toFixed(1)} MB`);
  chmodSync(join(STAGE, "cascade"), 0o755);
  chmodSync(join(STAGE, "cascade-router.bin"), 0o755);
}

// 2. pinned sing-box binary + sha256 verification
{
  log("downloading sing-box v" + SINGBOX_VERSION + " …");
  const res = await fetch(SINGBOX_URL);
  if (!res.ok) throw new Error(`sing-box download failed: ${res.status} ${res.statusText}`);
  const file = createWriteStream(SINGBOX_TGZ);
  await pipeline(Readable.fromWeb(res.body), file);
  const got = sha256(SINGBOX_TGZ);
  if (got !== SINGBOX_SHA256) {
    rmSync(SINGBOX_TGZ, { force: true });
    throw new Error(`sing-box SHA-256 mismatch! expected ${SINGBOX_SHA256}, got ${got}`);
  }
  log("sing-box sha256 OK");
  const x = join(OUT, "singbox-x");
  mkdirSync(x, { recursive: true });
  execFileSync("tar", ["-xzf", SINGBOX_TGZ, "-C", x], { stdio: "inherit" });
  copyFileSync(join(x, SINGBOX_PREFIX, "sing-box"), join(STAGE, "bin", "sing-box"));
  chmodSync(join(STAGE, "bin", "sing-box"), 0o755);
  copyFileSync(join(x, SINGBOX_PREFIX, "LICENSE"), join(STAGE, "licenses", "SING-BOX-GPLv3.txt"));
  rmSync(SINGBOX_TGZ, { force: true });
  rmSync(x, { recursive: true, force: true });
}

// 3. assemble the release layout
cpSync(join(ROOT, "dist"), join(STAGE, "dist"), { recursive: true });
cpSync(join(ROOT, "cascade-router", "catalog.json"), join(STAGE, "cascade-router", "catalog.json"));
cpSync(join(ROOT, "configs"), join(STAGE, "configs"), { recursive: true });
for (const f of ["START-cascade.sh", "README-LINUX.txt"]) {
  if (!existsSync(join(ROOT, f))) throw new Error(`missing dist file: ${f}`);
  copyFileSync(join(ROOT, f), join(STAGE, f));
}
chmodSync(join(STAGE, "START-cascade.sh"), 0o755);

// 4. tar.gz + checksums (top-level dir named after the tarball stem)
if (existsSync(TAR_PATH)) rmSync(TAR_PATH, { force: true });
log("archiving …");
const stem = `cascade-v${VERSION}-${SUFFIX}`;
const root = join(OUT, "pack");
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, stem), { recursive: true });
cpSync(STAGE, join(root, stem), { recursive: true });
execFileSync("tar", ["-czf", TAR_PATH, "-C", root, stem], { stdio: "inherit" });
rmSync(root, { recursive: true, force: true });
const tarHash = sha256(TAR_PATH);
writeFileSync(join(OUT, "SHA256SUMS"), `${tarHash}  ${basename(TAR_PATH)}\n`);
log("done:");
log(`  ${TAR_PATH}`);
log(`  ${tarHash}  ${basename(TAR_PATH)}`);
console.log(`CASCADE_DIST=${OUT}`);
console.log(`CASCADE_TAR=${TAR_PATH}`);
