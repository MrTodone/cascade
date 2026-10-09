/**
 * Dev entry (npm run dev / tsx server/dev-entry.ts): Vite HMR middleware.
 * vite lives ONLY here — never in the compiled cascade.exe.
 */
import { start } from "../server";

async function dev() {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { host: "127.0.0.1" } },
    appType: "spa",
  });
  await start({ viteMiddleware: vite.middlewares });
}

void dev();