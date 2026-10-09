import path from "node:path";

/**
 * Runtime helpers for compiled single-executable mode (Windows/macOS bundle).
 *
 * Dev mode (bun tsx / node dist/server.cjs): APP_ROOT = process.cwd() — exactly
 * the historical behavior.
 * Compiled mode (cascade.exe / cascade): APP_ROOT = directory of the executable,
 * so all config/catalog/dist reads resolve next to the exe, not to the CWD.
 */
export function isCompiled(): boolean {
  return process.env.CASCADE_COMPILED === "1";
}

const DEV_RUNTIMES = new Set(["bun", "bun.exe", "node", "node.exe", "tsx", "tsx.exe"]);

/** Marks the process as compiled when the entry binary is not a dev runtime. */
export function detectCompiled(): void {
  if (process.env.CASCADE_COMPILED) return;
  const base = path.basename(process.execPath).toLowerCase().replace(/\.exe$/i, "");
  if (!DEV_RUNTIMES.has(base)) process.env.CASCADE_COMPILED = "1";
}

export function appRoot(): string {
  return isCompiled() ? path.dirname(process.execPath) : process.cwd();
}

export function appPath(...segments: string[]): string {
  return path.join(appRoot(), ...segments);
}