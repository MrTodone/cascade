import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Restrict a sensitive file so only its owner can read/write it.
 *
 *  - POSIX: chmod 0600.
 *  - Windows: strip inherited ACEs and grant only the current user via icacls.
 *  - CASCADE_DOCKER=1: skip (the container filesystem is already isolated and
 *    icacls/chmod semantics do not apply cleanly to mounted volumes).
 *
 * Applied at runtime (when the file is written), never in an install script.
 * Failures are logged and swallowed — a permission hardening step must never
 * take the app down.
 */
export function secureFile(filePath: string): void {
  if (process.env.CASCADE_DOCKER === "1") {
    console.log(`[secureFile] skip (docker): ${filePath}`);
    return;
  }
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[secureFile] skip (missing): ${filePath}`);
      return;
    }
    if (process.platform === "win32") {
      const user = process.env.USERNAME || process.env.USER;
      const args = [filePath, "/inheritance:r"];
      if (user) args.push("/grant:r", `${user}:F`);
      execFileSync("icacls", args, { stdio: "ignore" });
      console.log(`[secureFile] icacls hardened: ${filePath}`);
    } else {
      fs.chmodSync(filePath, 0o600);
      console.log(`[secureFile] chmod 0600: ${filePath}`);
    }
  } catch (err) {
    console.error(`[secureFile] failed for ${filePath}: ${(err as Error).message}`);
  }
}
