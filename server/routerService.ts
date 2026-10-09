import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { spawn, ChildProcess } from "node:child_process";
import type { Request, Response, NextFunction } from "express";

export const CASCADE_ROUTER_PORT = 19080;
const CASCADE_ROUTER_URL = `http://127.0.0.1:${CASCADE_ROUTER_PORT}`;
const TUNNEL_PROXY = "http://127.0.0.1:10808";

const rootDir = process.cwd();
// Задача 31, этап 3: роутер — собственное ядро cascade-router/server.ts.
// Прежний cascade-run/router-run.mjs (обёртка над списанным внешним пакетом) больше не спавнится.
const routerRunner = path.join(rootDir, "cascade-router", "server.ts");
const routerConfigDir = path.join(rootDir, "cascade-run", "router");
const routerConfigFile = path.join(routerConfigDir, "config.json");
const routerStateDir = path.join(routerConfigDir, "state");
const routerCatalog = path.join(rootDir, "cascade-router", "catalog.json");

let routerProcess: ChildProcess | null = null;
let starting = false;

function pingRouter(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${CASCADE_ROUTER_URL}/v1/models`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function waitForRouter(deadlineMs = 30000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  const poll = async (): Promise<boolean> => {
    if (await pingRouter(1200)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
    return poll();
  };
  return poll();
}

export async function ensureRouterDaemon(): Promise<boolean> {
  if ((await pingRouter()) && routerProcess === null) return true;
  if (routerProcess !== null && routerProcess.exitCode === null && (await pingRouter())) return true;
  if (starting) return waitForRouter();

  starting = true;
  try {
    mkdirSync(routerStateDir, { recursive: true });
    routerProcess = spawn(
      process.execPath,
      [routerRunner],
      {
        env: {
          ...process.env,
          // Прокси-контракт старого спавна перенесён один-в-один (задача 31).
          NODE_USE_ENV_PROXY: "1",
          HTTPS_PROXY: TUNNEL_PROXY,
          HTTP_PROXY: TUNNEL_PROXY,
          ALL_PROXY: TUNNEL_PROXY,
          NO_PROXY: "127.0.0.1,localhost,::1,aistudio.google.com,api.cloudflare.com,api.orcarouter.ai,console.groq.com,github.com,huggingface.co,ollama.com,api.mistral.ai,api.llm7.io,dashscope-intl.aliyuncs.com,api.z.ai,generativelanguage.googleapis.com",
          // Контракт собственного ядра (cascade-router §10): прод-конфиг читается
          // без изменений, состояние пишется в каталог состояния рядом с ним.
          CASCADE_ROUTER_PORT: String(CASCADE_ROUTER_PORT),
          CASCADE_ROUTER_CONFIG: routerConfigFile,
          CASCADE_ROUTER_STATE_DIR: routerStateDir,
          CASCADE_ROUTER_CATALOG: routerCatalog,
        },
        stdio: ["ignore", "ignore", "pipe"],
        detached: false,
      }
    );
    if (routerProcess.stderr) {
      routerProcess.stderr.setEncoding("utf8");
      routerProcess.stderr.on("data", (d) => {
        const txt = String(d).trim();
        if (txt && txt.includes("ROUTER-DEBUG")) console.log("[cascadeRouterLog]", txt);
      });
    }

    if (routerProcess.stderr) {
      routerProcess.stderr.setEncoding("utf8");
      routerProcess.stderr.on("data", (d) => {
        const txt = String(d).trim();
        if (!txt) return;
        if (txt.includes("ROUTER-DEBUG") || txt.includes("fetch failed") || txt.startsWith("cause")) {
          console.log("[routerStderr]", txt.split("\n").slice(0, 6).join("\n"));
        }
      });
    }
    if (routerProcess.stderr) {
      routerProcess.stderr.on("data", (d) => console.log("[routerStderr]", String(d).trim()));
    }
    routerProcess.on("exit", () => {
      routerProcess = null;
    });
    return await waitForRouter();
  } finally {
    starting = false;
  }
}

export function startRouterHealthLoop() {
  setInterval(() => {
    if (routerProcess !== null && routerProcess.exitCode === null) return;
    void ensureRouterDaemon();
  }, 30000);
}

export function cascadeRouterProxy(req: Request, res: Response, next: NextFunction) {
  void handleProxy(req, res);
}

function handleProxy(req: Request, res: Response) {
  const method = req.method;
  const pathWithQuery = req.originalUrl;
  const headers: Record<string, string> = {
    ...(req.headers as Record<string, string>),
    host: `127.0.0.1:${CASCADE_ROUTER_PORT}`,
  };
  delete headers["content-length"];
  delete headers.connection;
  delete headers["transfer-encoding"];
  console.log("[cascadeProxy] sending headers:", JSON.stringify(headers));

  const upstream = http.request({
    host: "127.0.0.1",
    port: CASCADE_ROUTER_PORT,
    path: pathWithQuery,
    method,
    headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on("error", async (err) => {
    if (!res.headersSent) {
      await ensureRouterDaemon();
      try {
        const retry = http.request({
          host: "127.0.0.1",
          port: CASCADE_ROUTER_PORT,
          path: pathWithQuery,
          method,
          headers,
        }, (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
          upstreamRes.pipe(res);
        });
        const hasBody = Object.prototype.toString.call(req.body) === "[object Object]" && method !== "GET" && method !== "HEAD";
        if (hasBody) retry.write(JSON.stringify(req.body));
        retry.on("error", () => {
          if (!res.headersSent) res.status(503).json({ error: { message: `Cascade router unavailable: ${err.message}` } });
        });
        retry.end();
      } catch {
        if (!res.headersSent) res.status(503).json({ error: { message: `Cascade router unavailable: ${err.message}` } });
      }
    } else {
      res.end();
    }
  });

  const hasBody = Object.prototype.toString.call(req.body) === "[object Object]" && method !== "GET" && method !== "HEAD";
  if (hasBody) {
    const bodyStr = JSON.stringify(req.body);
    headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    upstream.write(bodyStr);
  }
  console.log("[cascadeProxy] final:", method, JSON.stringify(headers));
  upstream.end();
}