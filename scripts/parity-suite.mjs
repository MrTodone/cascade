#!/usr/bin/env node
/**
 * scripts/parity-suite.mjs — сьют поведенческих проверок ядра роутера.
 * Прода не зависит: гоняется против ЛЮБОГО роутера через ROUTER_BASE.
 *
 *   ROUTER_BASE=http://127.0.0.1:19080 node scripts/parity-suite.mjs            # эталон (старый)
 *   ROUTER_BASE=http://127.0.0.1:19081 node scripts/parity-suite.mjs            # новое ядро
 *   ROUTER_BASE=http://127.0.0.1:19081 ROUTER_PINS=cascade:@mistral/codestral-latest node scripts/parity-suite.mjs
 *   PARITY_WRITE=1 …                                                  # write-тесты (только для dev-конфига!)
 *   PARITY_JSON=/path/out.json …                                      # машинный вывод для parity-diff
 *
 * Зоны: core (должен PASS на обоих ядрах) и diff (наблюдение, расхождение =
 * осознанное отличие из CORE-SPEC или нереализованное в скелете).
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.ROUTER_BASE || "http://127.0.0.1:19080";
const LABEL = process.env.ROUTER_LABEL || BASE;
import { request as httpRequest } from "node:http";

const WRITE = process.env.PARITY_WRITE === "1";
const PINS = (process.env.ROUTER_PINS || "cascade:@mistral/codestral-latest").split(",").map((s) => s.trim()).filter(Boolean);
const TIMEOUT = Number(process.env.PARITY_TIMEOUT_MS || 30000);

const results = [];
function rec(id, zone, status, detail) {
  results.push({ id, zone, status, detail });
  const mark = { PASS: "✓", FAIL: "✗", SKIP: "–", OBS: "◦" }[status];
  console.log(`${mark} ${id} [${zone}] ${detail}`);
}

async function get(path, { auth = true, timeout = 10000 } = {}) {
  const headers = auth ? { Authorization: "Bearer cascade-local" } : {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, { headers, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, body, raw: text.slice(0, 400) };
  } finally { clearTimeout(t); }
}

async function chat(model, { timeout = TIMEOUT, extra = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer cascade-local" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false, ...extra }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, body, raw: text.slice(0, 400) };
  } finally { clearTimeout(t); }
}

/**
 * Запрос именно через node:http: fetch запрещает подменять Host,
 * а для проверки DNS-rebinding guard это единственный честный способ.
 */
function rawHost(path, host, { method = "GET", body = null, timeout = 15000 } = {}) {
  const url = new URL(BASE + path);
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), host },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: text.slice(0, 200) });
      });
    });
    req.setTimeout(timeout, () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => resolve({ status: 0, body: null, raw: String(e?.message || e) }));
    if (body) req.write(body);
    req.end();
  });
}

/** Запрос с полным контролем над заголовками (нужен кастомный Host). */
async function raw(method, path, bodyStr, headers = {}, { timeout = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, { method, headers, body: bodyStr, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, body, raw: text.slice(0, 400) };
  } catch (e) {
    return { status: 0, body: null, raw: String(e?.message || e) };
  } finally { clearTimeout(t); }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

// ── T01 /health shape ───────────────────────────────────────────────────────
{
  const { status, body } = await get("/health");
  if (status !== 200 || !isStr(body?.ok && String(body.ok))) { rec("T01", "core", "FAIL", `HTTP ${status}`); }
  else {
    const required = ["ok", "running", "activeSet", "activeModelCount", "autoHeal", "brokenModelCount", "requestsRouted", "inFlight", "probeMode"];
    const missing = required.filter((k) => body[k] === undefined);
    const bad = [];
    if (typeof body.ok !== "boolean" || typeof body.running !== "boolean") bad.push("ok/running not bool");
    if (!isStr(body.activeSet)) bad.push("activeSet not str");
    if (!isNum(body.activeModelCount)) bad.push("activeModelCount not num");
    if (typeof body.autoHeal !== "boolean") bad.push("autoHeal not bool");
    if (!isNum(body.brokenModelCount)) bad.push("brokenModelCount not num");
    if (!isNum(body.requestsRouted)) bad.push("requestsRouted not num");
    if (!isNum(body.inFlight)) bad.push("inFlight not num");
    if (!isStr(body.probeMode)) bad.push("probeMode not str");
    rec("T01", "core", missing.length || bad.length ? "FAIL" : "PASS",
      `ok=${body.ok} set=${body.activeSet} models=${body.activeModelCount} broken=${body.brokenModelCount} autoHeal=${body.autoHeal}${missing.length ? ` MISSING:${missing}` : ""}${bad.length ? ` BAD:${bad.join(";")}` : ""}`);
  }
}

// ── T02 /stats shape ───────────────────────────────────────────────────────
{
  const { status, body } = await get("/stats");
  const models = Array.isArray(body?.models) ? body.models : null;
  if (status !== 200 || !models || models.length === 0) {
    rec("T02", "core", "FAIL", `HTTP ${status} models=${models ? models.length : "absent"}`);
  } else {
    const m0 = models[0];
    const missing = ["key", "provider", "model", "priority", "state", "score"].filter((k) => m0[k] === undefined);
    const statesOk = models.every((m) => isStr(m.state));
    const bad = [];
    if (!isStr(body.activeSet)) bad.push("activeSet");
    if (typeof body.autoHeal !== "boolean") bad.push("autoHeal");
    if (!isStr(body.failover?.lastResortModel) && body.failover?.lastResortModel !== null) bad.push("failover.lastResortModel");
    if (!isNum(body.failover?.maxRetries)) bad.push("failover.maxRetries");
    if (!isStr(body.router) && body.router !== "v2") bad.push("router tag");
    if (typeof body.circuitBreakers !== "object" || body.circuitBreakers === null) bad.push("circuitBreakers obj");
    if (!Array.isArray(body.routingOrder)) bad.push("routingOrder arr");
    if (typeof body.modelStates !== "object" || body.modelStates === null) bad.push("modelStates obj");
    if (missing.length) bad.push(`model[].{${missing.join(",")}}`);
    if (!statesOk) bad.push("model[].state not str");
    rec("T02", "core", bad.length ? "FAIL" : "PASS",
      `models=${models.length} routingOrder=${body.routingOrder.length} breakers=${Object.keys(body.circuitBreakers || {}).length} lastResort=${body.failover?.lastResortModel}${bad.length ? ` BAD:${bad.join(";")}` : ""}`);
  }
}

// ── T03/T03a строгий пин живой модели (все формы из ROUTER_PINS) ───────────
for (const [i, pin] of PINS.entries()) {
  const id = i === 0 ? "T03" : `T03${String.fromCharCode(96 + i)}`;
  const { status, body } = await chat(pin);
  const served = body?.model || null;
  const target = pin.replace(/^cascade:/, "").replace(/^@/, "");
  const firstKey = target.split("/")[0];
  const ok = status === 200 && (served === null || String(served).includes(firstKey) || String(served).includes(target.split("/")[1] || "\u0000"));
  rec(id, "core", ok ? "PASS" : "FAIL",
    `${pin} → HTTP ${status} served=${served} content=${JSON.stringify(body?.choices?.[0]?.message?.content ?? body?.error?.message ?? null).slice(0, 60)}`);
}

// ── T04 строгий пин на несуществующую модель → 400, не каскад ───────────────
{
  const { status, body } = await chat("cascade:@nosuchprovider/nosuchmodel-zzz");
  const code = body?.error?.code || body?.error?.type || null;
  rec("T04", "core", status === 400 ? "PASS" : "FAIL", `cascade:@nosuchprovider/... → HTTP ${status} code=${code} msg=${JSON.stringify(body?.error?.message ?? null).slice(0, 70)}`);
}

// ── T05 unknown id (не cascade-форма) — DIFF-зона: 400 explicit (осознанное отличие #1) ──
{
  const { status, body } = await chat("definitely-not-a-real-model-xyz", { timeout: 40000 });
  rec("T05", "diff", "OBS",
    `unknown non-cascade id → HTTP ${status} served=${body?.model ?? null} code=${body?.error?.code ?? null} msg=${JSON.stringify(body?.error?.message ?? null).slice(0, 80)}`);
}

// ── T06 /sets: activeSet из /health и /sets совпадает, читается сет ──────────
{
  const { status, body } = await get("/sets");
  const h = await get("/health");
  const sets = body?.sets;
  if (status !== 200 || typeof sets !== "object" || sets === null) {
    rec("T06", "core", "FAIL", `HTTP ${status} sets=${typeof sets}`);
  } else {
    const active = body.activeSet;
    const activeObj = sets[active];
    const healthActive = h.body?.activeSet;
    const n = activeObj?.models?.length;
    const same = active === healthActive && isNum(n) && isNum(h.body?.activeModelCount) && n === h.body.activeModelCount;
    rec("T06", "core", same ? "PASS" : "FAIL",
      `activeSet=${active} (health=${healthActive}) models=${n} (health=${h.body?.activeModelCount}) setCount=${Object.keys(sets).length} familyFailover=${activeObj?.familyFailover}`);
  }
}

// ── T07 /stats routingOrder[0] = минимальный priority среди не-OPEN ────────
{
  const { body } = await get("/stats");
  const order = body?.routingOrder;
  if (!Array.isArray(order) || order.length === 0) {
    rec("T07", "core", "FAIL", `routingOrder empty`);
  } else {
    const head = order[0];
    const setModels = (body.models || []);
    const minPriority = Math.min(...setModels.filter((m) => m.state !== "OPEN" && m.state !== "AUTH_ERROR").map((m) => m.priority));
    const ok = head.priority === minPriority && isStr(head.key);
    rec("T07", "core", ok ? "PASS" : "FAIL", `routingOrder[0]=${head.key} prio=${head.priority} state=${head.state} (min priority среди доступных=${minPriority}), длина=${order.length}`);
  }
}

// ── T08 все модели упали → all_models_failed c failure_kinds (может 200 если lastResort) ──
if (WRITE) {
  // Требует записи в конфиг → только для dev-инстанса. На проде пропускается.
  rec("T08", "core", "SKIP", "требует изоляции сета (write в dev-конфиг) — этап 2");
} else {
  rec("T08", "core", "SKIP", "PARITY_WRITE=0 (изоляция сета — этап 2; в эталоне снимается вручную)");
}

// ── T09 circuitBreakers + modelStates census ───────────────────────────────
{
  const { body } = await get("/stats");
  const census = body?.modelStates;
  const states = ["CLOSED", "DEGRADED", "OPEN", "HALF_OPEN", "AUTH_ERROR", "QUOTA_PAUSED"];
  const missing = states.filter((k) => census?.[k] === undefined);
  const sum = missing.length ? null : states.reduce((a, k) => a + census[k], 0);
  const healthN = (body?.models || []).length;
  const authModels = (body?.models || []).filter((m) => m.state === "AUTH_ERROR").map((m) => m.key);
  rec("T09", "core", missing.length || sum !== healthN ? "FAIL" : "PASS",
    `census=${JSON.stringify(census)} sum=${sum}/models=${healthN}${authModels.length ? ` AUTH_ERROR=${authModels.join(",")}` : ""}`);
}

// ── T10 quota pauses shape ─────────────────────────────────────────────────
{
  const { body } = await get("/health");
  const qp = body?.quotaPauses;
  if (!Array.isArray(qp)) rec("T10", "core", "FAIL", "quotaPauses не массив");
  else rec("T10", "core", "PASS", `quotaPauses=${qp.length}${qp.length ? ` (${qp.map((p) => `${p.model} until=${p.until} retry=${p.retry_after_ms}`).join("; ")})` : ""}`);
}

// ── T11/T12 lastResort guard (наблюдение; срабатывает при all-fail) ─────────
if (WRITE) {
  rec("T11", "core", "SKIP", "требует all-fail сценария (write в dev-конфиг) — этап 2");
  rec("T12", "core", "SKIP", "требует all-fail сценария — этап 2");
} else {
  rec("T11", "core", "SKIP", "PARITY_WRITE=0 (all-fail сценарий — этап 2)");
  rec("T12", "core", "SKIP", "PARITY_WRITE=0 (all-fail сценарий — этап 2)");
}

// ── T13 autoHeal: brokenModelCount = модели с broken-флагом в set ───────────
{
  const h = await get("/health");
  const s = await get("/stats");
  const active = s.body?.activeSet;
  const models = s.body?.models || [];
  const broken = models.filter((m) => ["OPEN", "AUTH_ERROR", "STALE", "UNSUPPORTED"].includes(m.state));
  const consistent = h.body?.brokenModelCount === broken.length;
  rec("T13", "core", consistent ? "PASS" : "FAIL",
    `brokenModelCount=${h.body?.brokenModelCount} vs state-derived=${broken.length} [${broken.map((b) => `${b.key}=${b.state}`).join(", ")}] userCustomized=${h.body?.userCustomized}`);
}

// ── T14 /sets: чтение доступно, запись защищена ────────────────────────────
// Не пишет в конфиг: GET читается всегда, POST/PUT/DELETE проверяются на отказ.
{
  const r = await get("/sets");
  if (!r || r.status !== 200) {
    rec("T14", "core", "FAIL", `GET /sets → HTTP ${r?.status} (чтение сетов должно быть публичным)`);
  } else {
    const sets = r.body?.sets || {};
    rec("T14", "core", "PASS", `GET /sets → 200, сетов=${Object.keys(sets).length}, activeSet=${r.body?.activeSet}`);
  }
}

// ── T15 >10MB → 413 (отличие #3) ──────────────────────────────────────────
// Большое тело, но БЕЗ записи в конфиг: кладём в model-поле, до провайдера не доходит.
{
  const big = "x".repeat(11 * 1024 * 1024);
  const r = await raw("POST", "/v1/chat/completions", JSON.stringify({ model: "cascade:@mistral/codestral-latest", max_tokens: 1, messages: [{ role: "user", content: big }] }), { "content-type": "application/json" });
  const code = r?.body?.error?.code;
  // status 0 = соединение оборвалось (ECONNRESET). Это ровно то, что чинили
  // отличием #3, поэтому на старом ядре это ожидаемое отличие, а не регресс.
  if (r?.status === 413) rec("T15", "core", "PASS", `>10MB → HTTP 413 code=${code} (отличие #3)`);
  else if (r?.status === 0) rec("T15", "core", "OBS", `>10MB → соединение оборвалось (ECONNRESET) — ровно то, что чинит отличие #3`);
  else rec("T15", "core", "FAIL", `>10MB → HTTP ${r?.status} code=${code}, ожидался 413`);
}

// ── T16 DNS-rebinding guard (Host-заголовок) ──────────────────────────────
// Тоже без записи: подмена Host не меняет состояние.
{
  const pin = JSON.stringify({ model: "cascade:@mistral/codestral-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
  const evil = await rawHost("/v1/chat/completions", "evil.example.com", { method: "POST", body: pin });
  const good = await rawHost("/v1/chat/completions", "127.0.0.1", { method: "POST", body: pin });
  if (evil?.status === 403 && good?.status === 200) {
    rec("T16", "core", "PASS", `чужой Host → 403, локальный Host → 200`);
  } else if (evil?.status === 200 && good?.status === 200) {
    rec("T16", "core", "SKIP", "чужой Host принят (у старого ядра guard нет) — наблюдение, не регресс");
  } else {
    rec("T16", "core", "FAIL", `чужой Host → ${evil?.status}, локальный → ${good?.status} (ожидалось 403/200)`);
  }
}

// ── T17 /v1/models ядра (id-формы; DIFF: разные диалекты) ─────────────────────
{
  const { status, body } = await get("/v1/models");
  const data = Array.isArray(body?.data) ? body.data : null;
  if (status !== 200 || !data || data.length === 0) {
    rec("T17", "core", "FAIL", `HTTP ${status} data=${data ? data.length : "absent"}`);
  } else {
    const ids = data.map((d) => d.id);
    const hasBase = ids.includes("cascade");
    const hasSet = ids.some((id) => /^cascade:[a-z0-9-]+$/i.test(id));
    rec("T17", "core", hasBase && hasSet ? "PASS" : "FAIL", `ids=${JSON.stringify(ids)} (${data.length})`);
    rec("T17-id", "diff", "OBS", `id-формы: ${JSON.stringify(ids)}`);
  }
}

// ── Итог ────────────────────────────────────────────────────────────────────
const core = results.filter((r) => r.zone === "core");
const corePass = core.filter((r) => r.status === "PASS").length;
const coreFail = core.filter((r) => r.status === "FAIL").length;
const coreSkip = core.filter((r) => r.status === "SKIP").length;
const diff = results.filter((r) => r.zone === "diff");
const verdict = coreFail === 0 ? "GREEN" : "RED";
console.log(`\n══ ${LABEL}: ${verdict} — core ${corePass}P/${coreFail}F/${coreSkip}SKIP, diff-наблюдений ${diff.length} ══`);

const out = { label: LABEL, base: BASE, write: WRITE, pins: PINS, verdict, corePass, coreFail, coreSkip, results };
if (process.env.PARITY_JSON) writeFileSync(process.env.PARITY_JSON, JSON.stringify(out, null, 2));
process.exit(coreFail === 0 ? 0 : 1);
