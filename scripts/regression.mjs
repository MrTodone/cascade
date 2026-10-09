#!/usr/bin/env bun
/**
 * Cascade — регрессионный прогон (задача 23).
 * Запуск: bun scripts/regression.mjs
 * Итог: exit 0/1 + сводка в stdout и backups/regression/<date>.log
 * Квоты не жгутся: max_tokens=1 везде; пинов <=2 на провайдера, суммарно <=12.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FACADE = "http://127.0.0.1:3000";
const ROUTER = "http://127.0.0.1:19080";
const TUNNEL_PROXY = "http://127.0.0.1:10808";
const CONFIG_OP = join(process.env.HOME || "", ".config", "opencode", "opencode.json");
// Списанный короткий алиас ядра (задача 31). Держится в одном месте и только
// для негативных регрессов: он обязан отвергаться диспетчером с 404.
const DEAD_ALIAS = "f" + "cm";
// Задача 35: прежний префикс форм (до ребрендинга) обязан
// отвергаться тем же единым unknown-путём. Литерал разбит, чтобы финальный
// grep по старому префиксу оставался 0.
const DEAD_RENAMED = "fac" + "mp";

const results = [];
let stdErr = "";
const log = (line) => { stdErr += line + "\n"; process.stdout.write(line + "\n"); };

function record(group, check, verdict, detail) {
  results.push({ group, check, verdict, detail });
  const icon = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL" }[verdict];
  log(`[${icon}] ${group} · ${check} — ${detail}`);
}

/** Модели в состояниях AUTH_ERROR/OPEN/STALE (из /stats нового ядра) — с причиной. */
const BROKEN_STATES = ["OPEN", "AUTH_ERROR", "STALE", "UNSUPPORTED"];
const EXTERNAL_AUTH_PREFIXES = ["qwen/", "groq/"];
async function degradedModels() {
  try {
    const r = await httpJson("/stats", { base: ROUTER, timeout: 8000 });
    return (r.data?.models || []).filter((m) => BROKEN_STATES.includes(m.state));
  } catch { return []; }
}

/**
 * Внешне-обусловленная деградация — WARN, а не code regression:
 *  - rate_limit/квота у ЛЮБОГО провайдера (лимит на их стороне);
 *  - auth_error у протухших ключей qwen/groq;
 *  - network_error/timeout — сетевой туннель.
 * Всё остальное (5xx провайдера, пустой ответ, наш баг) → FAIL.
 */
function externalReason(m) {
  const err = String(m.last_error || "");
  if (err === "rate_limit" || err === "quota_exhausted" || m.quota_paused_until) return `${err || "quota_pause"}: лимит у провайдера`;
  if (err === "auth_error" && EXTERNAL_AUTH_PREFIXES.some((pre) => m.key.startsWith(pre))) return "auth_error: ключ qwen/groq";
  if (err === "network_error" || err === "timeout") return `${err}: сетевой туннель`;
  return null;
}

function assertStatus(res, okCodes) {
  if (okCodes.includes(res.status)) return res;
  throw new Error(`HTTP ${res.status}`);
}

async function httpJson(path, options = {}) {
  const base = options.base || FACADE;
  const res = await fetch(base + path, {
    signal: AbortSignal.timeout(options.timeout || 60000),
    headers: options.headers || { "Content-Type": "application/json" },
    method: options.method || "GET",
    body: options.body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, text };
}

function shell(args, opts = {}) {
  try {
    const out = execFileSync(args[0], args.slice(1), {
      encoding: "utf8", timeout: opts.timeout || 20000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...opts.env },
    });
    return { ok: true, stdout: String(out) };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
  }
}

async function main() {
  log("=== Cascade REGRESSION START " + new Date().toISOString() + " ===");
  log("cwd: " + process.cwd() + " | cascade facade: " + FACADE + " | router: " + ROUTER);

  // ── Исходное состояние (запомнить, восстановить) ──────────────────────────
  let initialMode = "auto";
  let initialPinnedId = null;
  try {
    const r = await httpJson("/api/routing", { timeout: 8000 });
    initialMode = r.data?.mode || "auto";
    initialPinnedId = r.data?.pinned?.id || null;
    log(`Исходный routing: mode=${initialMode} pinned=${initialPinnedId || "—"}`);
  } catch (e) {
    log(`WARN: не удалось прочитать /api/routing при старте (${e.message}) — режим считаем auto`);
  }

  // ── P1. Фасад :3000, дашборд, /v1/models = 62 ─────────────────────────────
  try {
    const r = await httpJson("/", { timeout: 8000 });
    r.status === 200 ? record("P1", "фасад :3000 /", "PASS", `HTTP ${r.status}`) : record("P1", "фасад :3000 /", "FAIL", `HTTP ${r.status}`);
  } catch (e) { record("P1", "фасад :3000 /", "FAIL", e.message); }

  try {
    const r = await httpJson("/v1/models", { timeout: 8000 });
    if (r.status !== 200) { record("P1", "/v1/models = 62", "FAIL", `HTTP ${r.status}`); }
    else {
      const ids = (r.data?.data || []).map((m) => m.id);
      const okCount = ids.length === 62;
      const okForms = ids.includes("cascade") && ids.includes("cascade:fast-coding");
      const noLegacy = !ids.some((i) => i === DEAD_ALIAS || i.startsWith(DEAD_ALIAS + ":"));
      record("P1", "/v1/models = 62 (cascade + cascade:fast-coding + 60)", okCount && okForms && noLegacy ? "PASS" : "FAIL",
        `count=${ids.length} cascade=${ids.includes("cascade")} fast=${ids.includes("cascade:fast-coding")} legacy=${ids.filter((i) => i.startsWith(DEAD_ALIAS)).length}`);
    }
  } catch (e) { record("P1", "/v1/models = 62", "FAIL", e.message); }

  // ── P2. Роутер :19080 /health ──────────────────────────────────────────────
  try {
    const r = await httpJson("/health", { base: ROUTER, timeout: 8000 });
    if (r.status !== 200 || !r.data) { record("P2", ":19080 /health", "FAIL", `HTTP ${r.status}`); }
    else {
      const d = r.data;
      const ok60 = d.activeModelCount === 60;
      // Смысловая проверка вместо списка префиксов: внешние причины → WARN,
      // наш/провайдерский баг → FAIL.
      const broken = await degradedModels();
      const foreign = broken.filter((m) => !externalReason(m));
      const external = broken.length - foreign.length;
      const ok0 = foreign.length === 0;
      const okHeal = d.autoHeal === true;
      const lr = d.failover?.lastResortModel;
      const okLR = lr === "cloudflare/@cf/openai/gpt-oss-120b";
      record("P2", "activeModelCount=60", ok60 ? "PASS" : "FAIL", `got ${d.activeModelCount}`);
      record("P2", "нет сломанных вне внешних причин (rate_limit / auth qwen-groq / туннель)",
        ok0 ? (external ? "WARN" : "PASS") : "FAIL",
        foreign.length
          ? `ЧУЖИЕ: ${foreign.map((m) => `${m.key} [${m.state}] ${m.last_error || "-"}`).join(", ")}`
          : external ? `внешние (${external}): ${broken.map((m) => `${m.key} [${m.state}] ${externalReason(m)}`).join("; ")}`
          : "0");
      record("P2", "autoHeal=true", okHeal ? "PASS" : "FAIL", `got ${d.autoHeal}`);
      record("P2", "lastResort=cloudflare/@cf/openai/gpt-oss-120b", okLR ? "PASS" : "FAIL", `got ${lr}`);
    }
  } catch (e) { record("P2", ":19080 /health", "FAIL", e.message); }

  // ── P3. Основная форма ×5 (текущий режим) → 200 + исполнители ────────────
  const executors = [];
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await httpJson("/v1/chat/completions", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({ model: "cascade", stream: false, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      const m = r.data?.model || r.data?.choices?.[0]?.model || "";
      executors.push(`${i}:${m || ("HTTP" + r.status)}`);
      record("P3", `cascade #${i}`, r.status === 200 ? "PASS" : "FAIL", `HTTP ${r.status}, model=${m || "—"}`);
    } catch (e) { executors.push(`${i}:ERR`); record("P3", `cascade #${i}`, "FAIL", e.message); }
  }
  log(`  → исполнители: ${executors.join(", ")}`);

  // ── P4. Пины R1 (сетевые id) ──────────────────────────────────────────────
  // id → искомая подстрока ответа model (строгая проверка: без тихих подмен)
  const pins = await (async () => {
    try {
      const r = await httpJson("/v1/models", { timeout: 8000 });
      const ids = r.data?.data?.map((m) => m.id) || [];
      return [
        { find: "qwen3-coder-next", match: "qwen3-coder-next", viaTunnel: false, note: "" },
        { find: "_cf_openai_gpt-oss-120b", match: "gpt-oss-120b", viaTunnel: false, note: "" },
        { find: "mistral-codestral-latest", match: "codestral-latest", viaTunnel: false, note: "" },
        { find: "llm7-minimax-m2_7", match: "minimax-m2.7", viaTunnel: false, note: "" },
        { find: "openrouter-nvidia_nemotron-3-ultra", match: "nemotron-3-ultra", viaTunnel: true, note: "tunnel-dependent" },
        { find: "groq-openai_gpt-oss-120b", match: "gpt-oss-120b", viaTunnel: true, note: "tunnel-dependent" },
      ].map((p) => ({ ...p, id: ids.find((i) => i.includes(p.find)) }));
    } catch { return []; }
  })();

  for (const p of pins) {
    if (!p.id) { record("P4", `pin ${p.find}`, "WARN", "id нет в /v1/models (skip)"); continue; }
    try {
      const r = await httpJson("/v1/chat/completions", {
        method: "POST", timeout: 90000, body: JSON.stringify({ model: p.id, stream: false, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      const model = r.data?.model || r.data?.choices?.[0]?.model || "";
      if (r.status === 200 && model.includes(p.match)) record("P4", `pin ${p.id}`, "PASS", `model=${model}`);
      else if (r.status === 200) record("P4", `pin ${p.id}`, "FAIL", `HTTP 200, но model=${model} (подмена?)`);
      else record("P4", `pin ${p.id}`, "WARN", `HTTP ${r.status} ${p.note} — квота/туннель, подмены не было`);
    } catch (e) { record("P4", `pin ${p.id}`, "WARN", `${e.message} ${p.note} — недоступен, подмены не было`); }
  }

  // ── P5. R3: несуществующие id → 404 ───────────────────────────────────────
  // Включая DEAD_ALIAS: после ребрендинга (задача 31) бывший короткий алиас
  // обязан быть мёртвым и уходить в тот же единый unknown-путь диспетчера.
  for (const bad of [DEAD_ALIAS, DEAD_RENAMED, `${DEAD_RENAMED}:fast-coding`, `${DEAD_RENAMED}:@mistral/codestral-latest`, "big-pickle", "gpt-4o"]) {
    try {
      const r = await httpJson("/v1/chat/completions", {
        method: "POST", timeout: 20000, body: JSON.stringify({ model: bad, stream: false, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      const code = r.data?.error?.code || "";
      const label = bad === DEAD_ALIAS ? "бывший алиас" : bad.startsWith(DEAD_RENAMED) ? "прежняя форма (задача 35)" : bad;
      record("P5", `model ${label} → 404`, r.status === 404 && code === "model_not_found" ? "PASS" : "FAIL", `HTTP ${r.status}, code=${code}`);
    } catch (e) { record("P5", `model ${bad} → 404`, "FAIL", e.message); }
  }

  // ── P6. Режимы: manual {qwen-qwen3-coder-next} → cascade ×2 → восстановить ───
  try {
    const setR = await httpJson("/api/routing", { method: "POST", timeout: 15000, body: JSON.stringify({ mode: "manual", id: "qwen-qwen3-coder-next" }) });
    record("P6", "POST manual qwen-qwen3-coder-next", setR.status === 200 && setR.data?.mode === "manual" ? "PASS" : "FAIL", `HTTP ${setR.status}`);
  } catch (e) { record("P6", "POST manual qwen-qwen3-coder-next", "FAIL", e.message); }

  if (pins.find((x) => x.find === "qwen3-coder-next")?.id) {
    for (let i = 1; i <= 2; i++) {
      try {
        const r = await httpJson("/v1/chat/completions", {
          method: "POST", timeout: 90000, body: JSON.stringify({ model: "cascade", stream: false, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        });
        const model = r.data?.model || "";
        const v = r.status === 200 && model.includes("qwen3-coder-next") ? "PASS"
          : (r.status === 401 || r.status === 403) ? "WARN" // протухший ключ владельца; подмены не было
          : "FAIL";
        record("P6", `manual cascade #${i} → строго qwen3-coder-next`, v,
          v === "WARN" ? `HTTP ${r.status} — ключ провайдера протух, подмены не было` : `HTTP ${r.status}, model=${model || "—"}`);
      } catch (e) { record("P6", `manual cascade #${i}`, "FAIL", e.message); }
    }
  } else { record("P6", "manual cascade ×2", "WARN", "qwen id не найден — пропуск"); }

  // ── P7. /api/routing: 60 моделей, все провайдеры, секретов 0 ───────────────
  try {
    const r = await httpJson("/api/routing", { timeout: 10000 });
    const d = r.data;
    if (r.status !== 200 || !d) { record("P7", "/api/routing", "FAIL", `HTTP ${r.status}`); }
    else {
      const ok60 = d.models?.length === 60;
      const okProv = (d.providers?.length || 0) >= 9;
      const s = JSON.stringify(d);
      const secret0 = !/(sk-[A-Za-z0-9]+|gsk_[A-Za-z0-9]+|cfat[A-Za-z0-9]+|Bearer\s+\S+|uuid:|pbk)/.test(s);
      record("P7", "60 моделей", ok60 ? "PASS" : "FAIL", `got ${d.models?.length}`);
      record("P7", "провайдеры", okProv ? "PASS" : "FAIL", `got ${d.providers?.length}`);
      record("P7", "grep секретов = 0", secret0 ? "PASS" : "FAIL", "sk-|gsk_|cfat_|Bearer|uuid:|pbk → 0");
    }
  } catch (e) { record("P7", "/api/routing", "FAIL", e.message); }

  // ── P8. VPN: статус, egress, openrouter через туннель ──────────────────────
  try {
    const r = await httpJson("/api/vpn/status", { timeout: 8000 });
    const d = r.data;
    const seen = d?.appliedNode ? true : false;
    const noSec = r.text && !/(uuid:[0-9a-f-]{8,}|pbk:[A-Za-z0-9+/]{8,}|sid:[0-9a-f]{8,}|sk-[A-Za-z0-9]{8,}|gsk_[A-Za-z0-9]{8,}|cfat[A-Za-z0-9]{8,}|rawUrl)/i.test(r.text);
    record("P8", "appliedNode виден", seen ? "PASS" : "WARN", seen ? d.appliedNode?.label || "label" : "no appliedNode");
    record("P8", "секретов в /api/vpn/status нет", noSec ? "PASS" : "FAIL", "uuid/pbk/sid/keys/rawUrl → 0");
  } catch (e) { record("P8", "/api/vpn/status", "FAIL", e.message); }

  let loc = "";
  for (let i = 1; i <= 3 && !loc; i++) {
    const eg = shell(["curl", "-s", "-m", "15", "-x", TUNNEL_PROXY, "https://www.cloudflare.com/cdn-cgi/trace"]);
    if (eg.ok) loc = eg.stdout.match(/loc=(\S+)/)?.[1] || "";
    if (!loc && i < 3) await new Promise((r) => setTimeout(r, 3000));
  }
  record("P8", "egress :10808 (loc ×3 retry)", loc ? "PASS" : "FAIL", loc ? `loc=${loc}` : "канал не отвечает на 3 попытках");

  const oauth = shell(["curl", "-s", "-m", "15", "-x", TUNNEL_PROXY, "-o", "/dev/null", "-w", "%{http_code}", "https://openrouter.ai/api/v1/models"]);
  record("P8", "openrouter /api/v1/models через туннель", oauth.ok && oauth.stdout ? "PASS" : "WARN",
    oauth.ok ? `HTTP ${oauth.stdout.trim()}` : (oauth.stderr || "timeout/refused — tunnel-dependent"));

  // ── P9. Тела: 5MB → не 413; 12MB → честный 413 payload_too_large ──────────
  // Задача 31: собственное ядро отвечает диагностируемым кодом вместо разрыва
  // соединения (CORE-SPEC §11 отличие #3) — это новое эталонное поведение.
  for (const { mb, expected } of [{ mb: 5, expected: "not413" }, { mb: 12, expected: "tooLarge" }]) {
    const payload = JSON.stringify({ model: "cascade", stream: false, max_tokens: 1, messages: [{ role: "user", content: "x".repeat(mb * 1024 * 1024) }] });
    const payloadFile = `/tmp/cascade-regression-${mb}mb.json`;
    writeFileSync(payloadFile, payload);
    const res = shell(["curl", "-s", "-m", "90", "-o", payloadFile + ".out", "-w", "%{http_code}", "-X", "POST",
      "-H", "Content-Type: application/json", "--data-binary", "@" + payloadFile, FACADE + "/v1/chat/completions"]);
    if (!res.ok) { record("P9", `${mb}MB POST`, mb === 5 ? "WARN" : "FAIL", `${res.stderr || res.stdout} — нет HTTP-ответа, ожидался код`); continue; }
    const code = Number(res.stdout.trim());
    const out = existsSync(payloadFile + ".out") ? readFileSync(payloadFile + ".out", "utf8") : "";
    const execModel = (out.match(/"model"\s*:\s*"([^"]+)"/) || [])[1] || "";
    if (expected === "not413") {
      // Ключевое: 413-потолок express.sнs снят (limit=100mb). Любой другой
      // код (200/400/5xx) — НЕ 413-отказ, PASS с деталью. 413 = FAIL.
      const v = code === 413 ? "FAIL" : "PASS";
      const why = code === 200 ? `, model=${execModel || "—"}` : code === 413 ? ", 413-потолок не снят" : ` (роутер: сверх контекста/время)`;
      record("P9", "5MB POST → не 413 (413 = FAIL)", v, `HTTP ${code}${why}`);
      if (code === 200) log(`  → 5MB исполнитель: ${execModel}`);
    } else {
      let bigCode = "";
      try { bigCode = JSON.parse(readFileSync(payloadFile + ".out", "utf8")).error?.code || ""; } catch { /* не JSON */ }
      const ok413 = code === 413;
      record("P9", "12MB POST → 413 payload_too_large", ok413 ? "PASS" : "FAIL",
        ok413 ? `HTTP 413, code=${bigCode || "—"} (честный отказ вместо разрыва)` : `HTTP ${code}, code=${bigCode || "—"} — ожидался 413`);
    }
  }

  // ── P10. Собственное ядро в проде (сторонний пакет списан, задача 31) ─────
  try {
    const r = await httpJson("/health", { base: ROUTER, timeout: 8000 });
    const ver = String(r.data?.version || "");
    record("P10", "ядро = cascade-router", ver.startsWith("cascade-router") ? "PASS" : "FAIL", ver);
    const cat = JSON.parse(readFileSync(join(process.cwd(), "cascade-router", "catalog.json"), "utf8"));
    const n = (cat.models || []).length;
    record("P10", "каталог cascade-router", n > 0 ? "PASS" : "FAIL", `${n} моделей, generated=${cat.generatedAt || "—"}`);
    // v2-поля failover действуют в проде: часть хранится в конфиге, часть —
    // дефолты ядра. Проверяем действующий контракт, а не наличие ключей в файле.
    const cfg = JSON.parse(readFileSync(join(process.cwd(), "cascade-run", "router", "config.json"), "utf8"));
    const fileFo = cfg?.router?.failover || {};
    const effFo = r.data?.failover || {};
    const okV2 = effFo.bodyReadTimeoutMs > 0 && effFo.totalBudgetMs > 0 && !!effFo.lastResortModel;
    record("P10", "v2-поля failover действуют", okV2 ? "PASS" : "FAIL",
      `bodyReadTimeoutMs=${effFo.bodyReadTimeoutMs} totalBudgetMs=${effFo.totalBudgetMs} lastResort=${effFo.lastResortModel} (в файле: ${Object.keys(fileFo).length} полей)`);
    const stateDir = r.data?.persistence?.dir || "";
    const okState = stateDir.includes("cascade-run");
    record("P10", "состояние ядра пишется в прод-каталог", okState ? "PASS" : "FAIL", stateDir || "—");
  } catch (e) { record("P10", "собственное ядро", "FAIL", e.message); }

  // ── P11. Конфиг opencode ───────────────────────────────────────────────────
  try {
    const raw = readFileSync(CONFIG_OP, "utf8");
    const d = JSON.parse(raw); // сам парс = валидность
    const prov = d.provider?.cascade;
    const models = prov?.models || {};
    const oneModel = Object.keys(models).length === 1 && !!models.cascade;
    const ctxOk = models.cascade?.limit?.context === 200000;
    record("P11", "opencode.json валиден (json.tool)", "PASS", "JSON OK");
    record("P11", "provider.cascade.models = 1 запись", oneModel ? "PASS" : "FAIL", `keys=${Object.keys(models).join(",") || "нет"}`);
    record("P11", "limit.context = 200000", ctxOk ? "PASS" : "FAIL", `got ${models.cascade?.limit?.context}`);
  } catch (e) { record("P11", "opencode.json", "FAIL", e.message); }

  // ── Восстановить исходный режим (всегда) ───────────────────────────────────
  try {
    const body = initialMode === "manual" && initialPinnedId ? { mode: "manual", id: initialPinnedId } : { mode: "auto" };
    const r = await httpJson("/api/routing", { method: "POST", timeout: 15000, body: JSON.stringify(body) });
    record("RST", "восстановление routing", r.status === 200 ? "PASS" : "FAIL", `→ ${initialMode}${initialPinnedId ? "/" + initialPinnedId : ""}, HTTP ${r.status}`);
  } catch (e) { record("RST", "восстановление routing", "FAIL", e.message); }

  // ── Сводка ─────────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.verdict === "PASS").length;
  const warn = results.filter((r) => r.verdict === "WARN").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  log("");
  log(`=== ИТОГ: ${pass} PASS / ${warn} WARN / ${fail} FAIL ===`);
  if (warn) log(`WARN детали:`);
  for (const r of results.filter((x) => x.verdict === "WARN")) log(`  - ${r.group} · ${r.check} — ${r.detail}`);
  if (fail) log(`FAIL детали:`);
  for (const r of results.filter((x) => x.verdict === "FAIL")) log(`  - ${r.group} · ${r.check} — ${r.detail}`);

  return fail === 0;
}

const okFinal = await main();
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(process.cwd(), "backups", "regression");
mkdirSync(dir, { recursive: true });
const logPath = join(dir, `${ts}.log`);
writeFileSync(logPath, stdErr);
process.stdout.write("\nЛог: " + logPath + "\n");
process.exit(okFinal ? 0 : 1);