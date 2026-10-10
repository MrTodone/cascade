import path from "node:path";

/**
 * Runtime helpers for the three execution modes.
 *
 *  - compiled (cascade.exe / cascade): single-executable bundle built by bun.
 *        pkgRoot = dataRoot = dirname(process.execPath).
 *  - npm (installed from the npm tarball, run by node): the prebuilt JS lives
 *        in the package dir, user data lives in CASCADE_HOME (~/.cascade).
 *        bin/cascade.js exports CASCADE_PKG_ROOT + CASCADE_HOME before spawning.
 *  - dev (bun/node tsx from the repo): pkgRoot = dataRoot = process.cwd().
 *
 * appPath()/appRoot() resolve PACKAGE ASSETS (dist/, cascade-router/, configs/).
 * dataPath()/dataRoot() resolve USER DATA (cascade-run/, .env, routing overrides).
 */

export function isCompiled(): boolean {
  return process.env.CASCADE_COMPILED === "1";
}

export function isNpm(): boolean {
  return !isCompiled() && !!process.env.CASCADE_PKG_ROOT;
}

const DEV_RUNTIMES = new Set(["bun", "bun.exe", "node", "node.exe", "tsx", "tsx.exe"]);

/** Marks the process as compiled when the entry binary is not a dev runtime. */
export function detectCompiled(): void {
  if (process.env.CASCADE_COMPILED) return;
  if (process.env.CASCADE_PKG_ROOT) return; // npm mode runs under node, never compiled
  const base = path.basename(process.execPath).toLowerCase().replace(/\.exe$/i, "");
  if (!DEV_RUNTIMES.has(base)) process.env.CASCADE_COMPILED = "1";
}

/** Package install root: prebuilt assets read-only. */
export function appRoot(): string {
  if (isCompiled()) return path.dirname(process.execPath);
  if (isNpm()) return path.resolve(process.env.CASCADE_PKG_ROOT as string);
  return process.cwd();
}

/** User data root: config, state, .env, logs — writable. */
export function dataRoot(): string {
  if (isCompiled()) return path.dirname(process.execPath);
  if (isNpm()) return path.resolve(process.env.CASCADE_HOME || appRoot());
  return process.cwd();
}

export function appPath(...segments: string[]): string {
  return path.join(appRoot(), ...segments);
}

export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}
