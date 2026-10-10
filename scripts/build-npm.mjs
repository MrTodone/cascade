import { execSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const dist = join(ROOT, "dist");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "router"), { recursive: true });

execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
execSync(
  "node_modules/.bin/esbuild server/exe-entry.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/server.cjs --external:fsevents --external:vite",

  { cwd: ROOT, stdio: "inherit" }
);
execSync(
  "node_modules/.bin/esbuild cascade-router/server.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/router/server.mjs --external:fsevents",
  { cwd: ROOT, stdio: "inherit" }
);

writeFileSync(
  join(ROOT, "metadata.json"),
  JSON.stringify({ version: pkg.version, name: pkg.name, builtAt: new Date().toISOString() }, null, 2)
);

console.log(`build-npm: dist ready (v${pkg.version})`);
