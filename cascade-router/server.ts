/**
 * cascade-router/server.ts — HTTP-сервер собственного ядра (dev: 127.0.0.1:19081,
 * mock-инстанс: 127.0.0.1:19082).
 *
 * Собственный код. Прод старого ядра (:19080) не трогается: этот процесс
 * читает ТОЛЬКО свой config (CASCADE_ROUTER_CONFIG) и пишёт состояние в
 * CASCADE_ROUTER_STATE_DIR (по умолчанию ~/.cascade-router-dev/).
 *
 * Запуск: bun cascade-router/server.ts   (или scripts/cascade-router-dev.sh)
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { RouterConfigStore, DEV_CONFIG_PATH, STATE_DIR } from "./config.ts";
import { Catalog } from "./catalog.ts";
import { Router, parseModelSpec } from "./router.ts";
import { sendJson, sendError, readJsonBody } from "./http.ts";
import { mockCounters, mockResetCounters } from "./adapters/mock.ts";
import { autoHealSet, type HealResult } from "./state/heal.ts";

const PORT = Number(process.env.CASCADE_ROUTER_PORT || 19081);
const HOST = "127.0.0.1";
const VERSION = "cascade-router-dev-0.2.0";
const STARTED_AT = Date.now();
const isMock = PORT === 19082;

const store = new RouterConfigStore();
const catalog = new Catalog();
const router = new Router(store.get(), catalog, STATE_DIR);
store.ensureStateDir();

let requestsRouted = 0;
let inFlight = 0;
const startedAt = STARTED_AT;

/** DNS-rebinding guard (SPEC §8, T16): только наш хост/локал. */
function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

function activeSetName(): string {
  return store.get().router.activeSet;
}

function modelsHealth(): any[] {
  const set = router.getSet(activeSetName());
  if (!set) return [];
  return [...set.models]
    .sort((a, b) => a.priority - b.priority)
    .map((m) => {
      const key = `${m.provider}/${m.model}`;
      const breaker = router.breakers.evaluate(key);
      const state = breaker?.authError ? "AUTH_ERROR" : (breaker?.state || "CLOSED");
      const pause = router.quota.all().find((p) => p.model === key);
      return {
        provider: m.provider, model: m.model, key, priority: m.priority,
        state, score: 0,
        last_latency_ms: router.probeCache.get(key)?.latencyMs ?? null,
        uptime: null,
        last_error: breaker?.lastError || null,
        quota_paused_until: pause && pause.until > Date.now() ? new Date(pause.until).toISOString() : null,
        isBenchmarking: false, benchmark: null,
      };
    });
}

function statusPayload(): any {
  const cfg = store.get();
  const set = router.getSet(activeSetName());
  const models = modelsHealth();
  const failover = store.failover();
  const keys = models.map((m) => m.key);
  const brokenModelCount = models.filter((m) => ["OPEN", "AUTH_ERROR", "STALE", "UNSUPPORTED"].includes(m.state)).length;
  return {
    ok: true,
    running: true,
    version: VERSION,
    pid: process.pid,
    port: PORT,
    mock: isMock,
    enabled: cfg.router.enabled !== false,
    activeSet: activeSetName(),
    activeModelCount: set?.models?.length || 0,
    setCount: Object.keys(cfg.router.sets || {}).length,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requestsRouted,
    autoHeal: cfg.router.autoHeal !== false,
    userCustomized: cfg.router.userCustomized === true,
    brokenModelCount,
    inFlight,
    shuttingDown: false,
    probeMode: cfg.router.probeMode || "aggressive",
    lastProbeAt: null,
    crashRecovered: false,
    configPath: DEV_CONFIG_PATH,
    tokenStatsPath: `${STATE_DIR}/tokens.json`,
    logPath: `${STATE_DIR}/router.log`,
    router: "v2",
    failover: {
      maxRetries: failover.maxRetries,
      requestTimeoutMs: failover.requestTimeoutMs,
      bodyReadTimeoutMs: failover.bodyReadTimeoutMs,
      totalBudgetMs: failover.totalBudgetMs,
      contentValidation: failover.contentValidation,
      lastResortModel: failover.lastResortModel,
      rateLimitProviderSkipAfter: failover.rateLimitProviderSkipAfter,
      maxAttemptsCap: failover.maxAttemptsCap,
    },
    modelStates: router.breakers.census(keys),
    quotaPauses: router.quota.all().map((p) => ({
      model: p.model, until: new Date(p.until).toISOString(), retry_after_ms: p.retry_after_ms,
    })),
    history: router.history.stats(),
    probeCache: router.probeCache.stats(),
    quota: {},
    runtimeTelemetry: { stats: { models: 0, entries: 0 }, models: {} },
    persistence: {
      dir: STATE_DIR,
      files: ["breakers.json", "quota.json", "probes.json", "history.json"],
      pending: router.persist?.hasPending() ?? false,
    },
  };
}

function statsPayload(): any {
  const set = router.getSet(activeSetName());
  const order = set ? router.candidates(set) : [];
  return {
    ...statusPayload(),
    tokens: { total: 0 },
    models: modelsHealth(),
    routingOrder: order.map((c) => ({
      key: c.key, provider: c.provider, model: c.model, priority: c.priority, state: c.state, score: c.score,
    })),
    globalBenchmark: { running: false, total: 0, completed: 0 },
    requestLog: router.history.recent(20),
    routerStats: router.routerStats(),
    breakers: router.breakers.snapshot(),
    traces: [],
    activeRequests: [],
    circuitBreakers: Object.fromEntries(
      Object.entries(router.breakers.snapshot()).map(([k, v]) => [k, {
        state: v.authError ? "AUTH_ERROR" : v.state,
        consecutiveFailures: v.consecutiveFailures,
        cooldownMs: v.cooldownMs,
        openedAt: v.openedAt ? new Date(v.openedAt).toISOString() : null,
        lastError: v.lastError,
      }]),
    ),
  };
}

async function handleChat(req: any, res: any): Promise<void> {
  const requestId = randomUUID();
  const parsed = await readJsonBody(req);
  if ("tooLarge" in parsed) {
    // Отличие #3: честный 413 вместо ECONNRESET.
    sendError(res, 413, "Request body exceeds 10MB limit", "payload_too_large", "invalid_request_error", {}, { "x-request-id": requestId });
    return;
  }
  const body = parsed.body || {};
  const spec = parseModelSpec(body.model);
  const stream = body.stream === true;
  inFlight += 1;
  try {
    // SPEC §1: unknown → явная ошибка (отличие #1), никакого getSet(null)-каскада.
    if (spec.kind === "unknown") {
      sendError(res, 400,
        `Unknown model id: ${JSON.stringify(body.model)}. Use "cascade", "cascade:<set>" or "cascade:@provider/model".`,
        "invalid_model", "invalid_request_error");
      return;
    }

    const set = router.getSet(spec.kind === "set" ? spec.set : null);
    if (spec.kind !== "pinned" && !set) {
      sendError(res, 404, `Router set not found: ${spec.set || activeSetName()}`, "set_not_found");
      return;
    }

    // ЭТАП 2: полный failover-цикл (бюджет, семейный фолбэк, lastResort).
    requestsRouted += 1;
    const result = await router.routeWithFailover({
      set: spec.kind === "pinned" ? null : set,
      body,
      stream,
      pinned: spec.kind === "pinned" ? spec.pinned : null,
    });
    finishRoute(res, result, requestId, body);
  } finally {
    inFlight -= 1;
  }
}

/**
 * Стрим-ответ: SSE передаётся клиенту инкрементально, без буферизации.
 * Клиент (opencode) читает data:-кадры; после первого отправленного байта
 * откат на другую модель уже невозможен, поэтому контент-валидация не идёт.
 */
function pipeSse(res: any, sse: ReadableStream<Uint8Array>, headers: Record<string, string>): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...headers,
  });
  const writer = sse.getReader();
  void (async () => {
    // [DONE] апстрим присылает сам; добавляем только если его не было.
    let sawDone = false;
    let tail = "";
    try {
      for (;;) {
        const { done, value } = await writer.read();
        if (done) break;
        const text = Buffer.from(value).toString("utf8");
        tail = (tail + text).slice(-64);
        if (/\bdata:\s*\[DONE\]/.test(text)) sawDone = true;
        res.write(Buffer.from(value));
      }
      if (!sawDone && !/\bdata:\s*\[DONE\]/.test(tail)) res.write("data: [DONE]\n\n");
    } catch (e) {
      res.write(`data: {"error":{"message":${JSON.stringify(String(e?.message || e))}}}\n\n`);
    } finally {
      res.end();
    }
  })();
}

function finishRoute(res: any, result: any, requestId: string, body: any): void {
  if (result.ok) {
    if (result.sse) {
      pipeSse(res, result.sse, {
        "x-request-id": requestId,
        "x-cascade-served-model": result.servedModel,
        "x-cascade-attempts": String(result.attempts.length),
        "x-cascade-last-resort": result.lastResortUsed ? "1" : "0",
      });
      return;
    }
    if (result.json) {
      sendJson(res, 200, result.json, {
        "x-request-id": requestId,
        "x-cascade-served-model": result.servedModel,
        "x-cascade-attempts": String(result.attempts.length),
        "x-cascade-last-resort": result.lastResortUsed ? "1" : "0",
      });
    } else {
      sendError(res, 502, "Empty provider response", "provider_server_error", "api_error");
    }
    return;
  }
  // Финальный код: одинаковые kind → код kind, смешанные → 503 (§3).
  const status = result.status || 503;
  const type = status === 429 ? "rate_limit_error" : status === 401 || status === 403 ? "authentication_error" : "api_error";
  sendError(res, status, result.message, result.code, type, {
    failure_kinds: result.failedKinds,
    tried: result.tried,
    attempts: result.attempts,
    budget_exhausted: result.budgetExhausted === true,
    last_resort_used: result.lastResortUsed,
  }, {
    "x-request-id": requestId,
    "x-cascade-attempts": String(result.attempts.length),
    "x-cascade-tried": result.tried.join(","),
    "x-cascade-last-resort": result.lastResortUsed ? "1" : "0",
  });
}

/** Anthropic-совместимый /v1/messages (SPEC §5): model "cascade*", ответ в формате Anthropic. */
async function handleMessages(req: any, res: any): Promise<void> {
  const requestId = randomUUID();
  const parsed = await readJsonBody(req);
  if ("tooLarge" in parsed) {
    sendError(res, 413, "Request body exceeds 10MB limit", "payload_too_large", "invalid_request_error", {}, { "x-request-id": requestId });
    return;
  }
  const body = parsed.body || {};
  const spec = parseModelSpec(body.model);
  if (spec.kind === "unknown") {
    sendJson(res, 400, {
      type: "error", error: { type: "invalid_request_error", message: `Unknown model id: ${JSON.stringify(body.model)}` },
    }, { "x-request-id": requestId });
    return;
  }
  const set = router.getSet(spec.kind === "set" ? spec.set : null);
  if (spec.kind !== "pinned" && !set) {
    sendJson(res, 404, {
      type: "error", error: { type: "not_found_error", message: `Router set not found: ${spec.set || activeSetName()}` },
    });
    return;
  }

  inFlight += 1;
  requestsRouted += 1;
  try {
    // Апстрим — OpenAI-форма; max_tokens обязателен для Anthropic-контракта.
    const upstream = {
      ...body,
      model: spec.kind === "pinned" ? `${spec.pinned!.provider}/${spec.pinned!.model}` : body.model,
      max_tokens: body.max_tokens ?? 1024,
      messages: body.messages,
      stream: false,
    };
    const result = await router.routeWithFailover({
      set: spec.kind === "pinned" ? null : set,
      body: upstream,
      stream: false,
      pinned: spec.kind === "pinned" ? spec.pinned : null,
    });
    if (!result.ok) {
      sendJson(res, result.status || 503, {
        type: "error",
        error: { type: result.status === 429 ? "rate_limit_error" : "api_error", message: result.message },
      }, { "x-request-id": requestId });
      return;
    }
    const raw = (result.json as any)?.choices?.[0]?.message?.content ?? "";
    const anthropic: any = {
      id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      type: "message",
      role: "assistant",
      model: result.servedModel,
      content: [{ type: "text", text: typeof raw === "string" ? raw : JSON.stringify(raw) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: (result.json as any)?.usage?.prompt_tokens ?? 0,
        output_tokens: (result.json as any)?.usage?.completion_tokens ?? 0,
      },
    };
    sendJson(res, 200, anthropic, {
      "x-request-id": requestId,
      "x-cascade-served-model": String(result.servedModel || ""),
    });
  } finally {
    inFlight -= 1;
  }
}

/** SPEC §10: CRUD сетов, только для mock-инстанса (прод-конфиг не трогаем). */
async function handleSetsAdmin(req: any, res: any, url: URL): Promise<void> {
  const name = url.pathname.split("/").filter(Boolean)[1];
  const cfg = store.get();
  const isWrite = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
  // Чтение — публичный контракт на любом инстансе; запись только на mock,
  // чтобы прод-конфиг нельзя было случайно переписать через API.
  if (isWrite && !isMock) {
    sendError(res, 403, "Sets WRITE API is available on the mock instance only", "forbidden");
    return;
  }

  if (req.method === "GET" && !name) {
    sendJson(res, 200, { activeSet: cfg.router.activeSet, sets: cfg.router.sets });
    return;
  }
  if (req.method === "GET" && name) {
    const s = cfg.router.sets[name];
    if (!s) { sendError(res, 404, `Set not found: ${name}`, "set_not_found"); return; }
    sendJson(res, 200, s);
    return;
  }
  const parsed = req.method === "PUT" || req.method === "POST" ? await readJsonBody(req) : { body: null };
  if ("tooLarge" in parsed) { sendError(res, 413, "Request body exceeds 10MB limit", "payload_too_large"); return; }
  const body = parsed.body || {};

  if (req.method === "PUT" && name) {
    const models = Array.isArray(body.models) ? body.models : [];
    cfg.router.sets[name] = {
      name,
      models: models.map((m: any, i: number) => ({
        provider: String(m.provider), model: String(m.model), priority: Number.isFinite(m.priority) ? m.priority : i + 1,
      })),
      familyFailover: body.familyFailover !== false,
      created: cfg.router.sets[name]?.created || new Date().toISOString(),
    };
    store.save();
    sendJson(res, 200, cfg.router.sets[name]);
    return;
  }
  if (req.method === "POST" && !name) {
    const setName = String(body.name || "");
    if (!setName) { sendError(res, 400, "name is required", "invalid_request"); return; }
    if (cfg.router.sets[setName]) { sendError(res, 409, `Set already exists: ${setName}`, "conflict"); return; }
    const models = Array.isArray(body.models) ? body.models : [];
    cfg.router.sets[setName] = {
      name: setName,
      models: models.map((m: any, i: number) => ({
        provider: String(m.provider), model: String(m.model), priority: Number.isFinite(m.priority) ? m.priority : i + 1,
      })),
      familyFailover: body.familyFailover !== false,
      created: new Date().toISOString(),
    };
    store.save();
    sendJson(res, 201, cfg.router.sets[setName]);
    return;
  }
  if (req.method === "DELETE" && name) {
    if (!cfg.router.sets[name]) { sendError(res, 404, `Set not found: ${name}`, "set_not_found"); return; }
    delete cfg.router.sets[name];
    store.save();
    sendJson(res, 200, { deleted: name });
    return;
  }
  sendError(res, 405, `Method not allowed: ${req.method} ${url.pathname}`, "method_not_allowed");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  try {
    // T16: DNS-rebinding guard. Только /health идёт без проверки (для мониторинга).
    if (url.pathname !== "/health" && !hostAllowed(req.headers.host)) {
      sendError(res, 403, "Forbidden host header", "forbidden");
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, statusPayload(), { "x-request-id": randomUUID() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/stats") {
      sendJson(res, 200, statsPayload(), { "x-request-id": randomUUID() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      const cfg = store.get();
      const ids = new Set<string>(["cascade"]);
      for (const name of Object.keys(cfg.router.sets || {})) {
        ids.add(`cascade:${name}`);
        ids.add(`cascade:${name}`);
      }
      sendJson(res, 200, { object: "list", data: [...ids].map((id) => ({ id, object: "model", owned_by: "cascade" })) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models/catalog") {
      sendJson(res, 200, { object: "list", data: catalog.all() });
      return;
    }
    if (url.pathname === "/sets" || url.pathname.startsWith("/sets/")) {
      await handleSetsAdmin(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/mock/stats") {
      if (!isMock) { sendError(res, 404, "Not found: /mock/stats", "not_found"); return; }
      sendJson(res, 200, { counters: Object.fromEntries(mockCounters) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/mock/reset") {
      if (!isMock) { sendError(res, 404, "Not found: /mock/reset", "not_found"); return; }
      mockResetCounters();
      sendJson(res, 200, { reset: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin/flush") {
      // Принудительный сброс персиста (тест рестарта, M14).
      router.flushState();
      sendJson(res, 200, { flushed: true, dir: STATE_DIR });
      return;
    }
    if (url.pathname === "/admin/autoheal") {
      if (req.method !== "POST" && req.method !== "GET") {
        sendError(res, 405, "Method not allowed", "method_not_allowed");
        return;
      }
      // Прогон по active set. Конфиг пишется только если что-то заменили.
      const cfg = store.get();
      const set = router.getSet(cfg.router.activeSet);
      const result: HealResult = autoHealSet(set as never, {
        breakers: router.breakers,
        catalog,
        enabled: cfg.router.autoHeal !== false,
        userCustomized: cfg.router.userCustomized === true,
      });
      if (result.healed) {
        store.save();
        router.flushState();
      }
      sendJson(res, 200, {
        activeSet: cfg.router.activeSet,
        autoHeal: cfg.router.autoHeal !== false,
        userCustomized: cfg.router.userCustomized === true,
        ...result,
        models: router.getSet(cfg.router.activeSet)?.models || [],
      });
      return;
    }
    if (url.pathname === "/admin/failover") {
      if (!isMock) { sendError(res, 403, "Admin API is available on the mock instance only", "forbidden"); return; }
      if (req.method === "GET") { sendJson(res, 200, store.failover()); return; }
      if (req.method === "PUT") {
        const parsed = await readJsonBody(req);
        if ("tooLarge" in parsed) { sendError(res, 413, "Request body exceeds 10MB limit", "payload_too_large"); return; }
        Object.assign(store.get().router.failover, parsed.body || {});
        store.save();
        sendJson(res, 200, store.failover());
        return;
      }
      sendError(res, 405, "Method not allowed", "method_not_allowed");
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChat(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      await handleMessages(req, res);
      return;
    }
    sendError(res, 404, `Not found: ${url.pathname}`, "not_found");
  } catch (e: any) {
    sendError(res, 500, String(e?.message || e), "internal_error", "api_error");
  }
});

// Graceful shutdown: сбросить персист перед выходом (SPEC §4).
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    try { router.flushState(); } catch { /* не блокируем выход */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

server.listen(PORT, HOST, () => {
  const cfg = store.get();
  console.log(`cascade-router ${isMock ? "MOCK" : "dev"} listening on http://${HOST}:${PORT}`);
  console.log(`config: ${DEV_CONFIG_PATH} | catalog: ${catalog.count} записей | state: ${STATE_DIR}`);
  console.log(`active set: ${cfg.router.activeSet} (${cfg.router.sets?.[cfg.router.activeSet]?.models?.length || 0} моделей)`);
  if (isMock) console.log("mock instance: внешних вызовов нет, квоты не расходуются");
});
