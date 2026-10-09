#!/usr/bin/env bun
/**
 * cascade-router/tests/mock-suite.ts — детерминированный сьют тонких мест.
 *
 * Запуск: bun cascade-router/tests/mock-suite.ts   (через scripts/cascade-router-test.sh)
 * Требует поднятый mock-инстанс на :19082 (см. scripts/cascade-router-test.sh).
 * Внешних вызовов нет, квоты не расходуются, состояние каждого теста изолировано.
 */
import { rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";

const HOST = "127.0.0.1:19082";
const BASE = `http://${HOST}`;
let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n── ${t} ──`);
}

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ code: number; json: any; headers: Record<string, string> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Host: HOST, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { code: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

const chat = (model: string, extra: Record<string, unknown> = {}) =>
  api("POST", "/v1/chat/completions", { model, max_tokens: 1, ...extra });
const setModel = (name: string) => `cascade:${name}`;

/** Свежий «провайдер» из пула: каждый тест изолирован от состояния остальных. */
let poolCursor = 0;
function fresh(): string {
  poolCursor += 1;
  return `mockt${poolCursor}`;
}

async function resetCounters(): Promise<void> {
  await api("POST", "/mock/reset");
}
async function counters(): Promise<Record<string, number>> {
  return (await api("GET", "/mock/stats")).json?.counters || {};
}
async function health(): Promise<any> {
  return (await api("GET", "/health")).json;
}
async function breakers(): Promise<Record<string, any>> {
  return (await api("GET", "/stats")).json?.breakers || {};
}
async function quota(): Promise<any[]> {
  return (await api("GET", "/stats")).json?.quotaPauses || [];
}

async function main(): Promise<void> {
  console.log(`cascade-router mock-suite → ${BASE}`);

  // ── (а) Конфиг-дуализм: /health отражает v2-поля и они не теряются ───────────
  section("(а) конфиг-дуализм");
  {
    const h = await health();
    ok("health 200 и version 0.2.0", h?.version === "cascade-router-dev-0.2.0", `version=${h?.version}`);
    ok("failover.maxRetries = 3 (v2)", h?.failover?.maxRetries === 3);
    ok("failover.requestTimeoutMs = 2000 (v2)", h?.failover?.requestTimeoutMs === 2000);
    ok("failover.totalBudgetMs = 8000 (v2)", h?.failover?.totalBudgetMs === 8000);
    ok("failover.contentValidation = basic (v2)", h?.failover?.contentValidation === "basic");
    ok("lastResortModel = mock/lastresort-ok (v2)", h?.failover?.lastResortModel === "mock/lastresort-ok");
    ok("router = v2", h?.router === "v2");
    ok("mock instance помечен", h?.mock === true);
    ok("персист-файлы объявлены", Array.isArray(h?.persistence?.files) && h.persistence.files.length === 4,
      (h?.persistence?.files || []).join(","));
  }

  // ── M1: базовый успех ─────────────────────────────────────────────────────
  section("M1 успех на первом кандидате");
  {
    await resetCounters();
    const r = await chat(setModel("m1"));
    const c = await counters();
    ok("200 OK", r.code === 200, `code=${r.code}`);
    ok("served = ok-fast", r.json?.model === "ok-fast", r.json?.model);
    ok("одна попытка", r.headers["x-cascade-attempts"] === "1", r.headers["x-cascade-attempts"]);
    ok("посчитана 1 попытка в mock", (c["ok-fast"] || 0) === 1, JSON.stringify(c));
    ok("OpenAI-форма ответа", Array.isArray(r.json?.choices) && !!r.json.choices[0]?.message?.content);
  }

  // ── M2: приоритет: первый кандидат здоров → второй не трогаем ──────────────
  section("M2 приоритет-first");
  {
    await resetCounters();
    const r = await chat(setModel("m2"));
    const c = await counters();
    ok("200 от ok-fast", r.code === 200 && r.json?.model === "ok-fast", r.json?.model);
    ok("fail-500 НЕ вызывался", (c["fail-500"] || 0) === 0, JSON.stringify(c));
  }

  // ── M3: auth_error → фолбэк, провайдер заблокирован, breaker sticky ───────
  section("M3 auth_error: фолбэк + блокировка провайдера");
  {
    await resetCounters();
    const r = await chat(setModel("m3"));
    const c = await counters();
    const b = await breakers();
    const m3cfg = JSON.parse(readFileSync("cascade-router/tests/mock-config.json", "utf8")).router.sets.m3.models;
    const authProv = m3cfg[0].provider;
    ok("200 от резервной модели", r.code === 200, `code=${r.code} served=${r.json?.model}`);
    ok("fail-auth был вызван", (c["fail-auth"] || 0) === 1, JSON.stringify(c));
    ok("провайдер auth заблокирован (AUTH_ERROR)", b[`${authProv}/fail-auth`]?.authError === true,
      `${authProv}/fail-auth authError=${b[`${authProv}/fail-auth`]?.authError}`);
    // Тонкое место (б): breaker НЕ растёт на auth (consecutiveFailures остаётся 0).
    ok("auth НЕ растит breaker (тонкое б)", (b[`${authProv}/fail-auth`]?.consecutiveFailures || 0) === 0,
      `consecutiveFailures=${b[`${authProv}/fail-auth`]?.consecutiveFailures}`);
    // Второй запрос: провайдер auth пропускается целиком.
    await resetCounters();
    await chat(setModel("m3"));
    const c2 = await counters();
    ok("повторный запрос НЕ бьёт в заблокированный провайдер", (c2["fail-auth"] || 0) === 0, JSON.stringify(c2));
  }

  // ── M4: таймаут → фолбэк ──────────────────────────────────────────────────
  section("M4 timeout → фолбэк");
  {
    await resetCounters();
    const t0 = Date.now();
    const r = await chat(setModel("m4"));
    const wall = Date.now() - t0;
    const c = await counters();
    ok("200 от резервной модели", r.code === 200, `code=${r.code} served=${r.json?.model}`);
    ok("fail-timeout был вызван", (c["fail-timeout"] || 0) === 1, JSON.stringify(c));
    ok("отсечён по requestTimeoutMs (2с), не 3.5с", wall < 2900, `wall=${wall}ms`);
  }

  // ── M5: 400 = вина клиента → фолбэк ДА, здоровье НЕ страдает (тонкое в) ───
  section("M5 400: фолбэк без вреда здоровью");
  {
    await resetCounters();
    const m5cfg = JSON.parse(readFileSync("cascade-router/tests/mock-config.json", "utf8")).router.sets.m5.models;
    const clientProv = m5cfg[0].provider;
    const r = await chat(setModel("m5"));
    const b = await breakers();
    const e = b[`${clientProv}/fail-400`];
    ok("200 от резервной модели", r.code === 200, `code=${r.code} served=${r.json?.model}`);
    ok("400 НЕ открыл breaker", e?.state === "CLOSED", `state=${e?.state}`);
    ok("400 НЕ растит consecutiveFailures", (e?.consecutiveFailures || 0) === 0, `n=${e?.consecutiveFailures}`);
    ok("причина сохранена для дашборда", e?.lastError === "invalid_request", `lastError=${e?.lastError}`);
  }

  // ── M6: 429 → пауза THIS-модели по Retry-After ────────────────────────────
  section("M6 429: пауза модели по Retry-After");
  {
    await resetCounters();
    const m6cfg = JSON.parse(readFileSync("cascade-router/tests/mock-config.json", "utf8")).router.sets.m6.models;
    const rlProv = m6cfg[0].provider;
    const r = await chat(setModel("m6"));
    const q = await quota();
    const pause = q.find((p) => p.model === `${rlProv}/fail-429`);
    ok("200 от резервной модели", r.code === 200, `code=${r.code} served=${r.json?.model}`);
    ok("пауза записана", !!pause, JSON.stringify(q));
    ok("retry_after_ms = 2000 (Retry-After: 2)", pause?.retry_after_ms === 2000, `${pause?.retry_after_ms}`);
    // Повторный запрос: модель на паузе не выбирается.
    await resetCounters();
    await chat(setModel("m6"));
    const c2 = await counters();
    ok("паузная модель пропущена (тонкое г)", (c2["fail-429"] || 0) === 0, JSON.stringify(c2));
  }

  // ── M7: все кандидаты упали → lastResort ─────────────────────────────────
  section("M7 lastResort после полного провала каскада");
  {
    await resetCounters();
    const r = await chat(setModel("m7"));
    ok("200 от lastResort", r.code === 200 && r.json?.model === "lastresort-ok", `served=${r.json?.model}`);
    ok("заголовок last-resort=1", r.headers["x-cascade-last-resort"] === "1");
  }

  // ── M8: totalBudgetMs жёстко режет каскад ────────────────────────────────
  section("M8 бюджет: totalBudgetMs");
  {
    // 10 кандидатов-таймаутов и maxRetries=10 (кап 6): обрыв может дать только бюджет.
    const models = Array.from({ length: 10 }, (_, i) => ({ provider: `mockb${i + 1}`, model: "fail-timeout", priority: i + 1 }));
    await api("PUT", "/sets/m8x", { models });
    await api("PUT", "/admin/failover", { maxRetries: 10, lastResortModel: null });
    await resetCounters();
    const t0 = Date.now();
    const r = await chat(setModel("m8x"));
    const wall = Date.now() - t0;
    const c = await counters();
    const attempts = Object.values(c).reduce((a: number, v: any) => a + v, 0);
    ok("все кандидаты — таймауты, ответ 504", r.code === 504, `code=${r.code}`);
    ok("бюджет 8с выдержан", wall <= 8600, `wall=${wall}ms`);
    ok("каскад остановлен до 10 кандидатов", attempts < 10, `attempts=${attempts}`);
    ok("маркер budget_exhausted", r.json?.error?.budget_exhausted === true, `flag=${r.json?.error?.budget_exhausted}`);
    ok("kind = timeout у всех попыток", (r.json?.error?.failure_kinds || []).every((k: string) => k === "timeout"),
      JSON.stringify(r.json?.error?.failure_kinds));
    await api("PUT", "/admin/failover", { maxRetries: 3, lastResortModel: "mock/lastresort-ok" });
  }

  // ── M9: смешанные kind → 503 (не 401/504) ────────────────────────────────
  section("M9 смешанные kind → 503");
  {
    await resetCounters();
    // lastResort выключен: иначе он закономерно спасёт запрос и замаскирует итог.
    await api("PUT", "/admin/failover", { lastResortModel: null });
    await api("PUT", "/sets/m9x", {
      models: [
        { provider: fresh(), model: "fail-500", priority: 1 },
        { provider: fresh(), model: "fail-forbidden", priority: 2 },
      ],
    });
    const r = await chat(setModel("m9x"));
    ok("смешанные kind → 503", r.code === 503, `code=${r.code}`);
    const kinds = r.json?.error?.failure_kinds || [];
    ok("в kinds есть server_error и auth_error", kinds.includes("provider_server_error") && kinds.includes("auth_error"),
      JSON.stringify(kinds));
    ok("lastResort выключен → провал не замаскирован", r.json?.error?.last_resort_used !== true);
    await api("PUT", "/admin/failover", { lastResortModel: "mock/lastresort-ok" });
  }

  // ── M10: все kind одинаковые → код этого kind ────────────────────────────
  section("M10 одинаковые kind → код kind");
  {
    const r = await chat(setModel("m10")); // единственный кандидат fail-400
    ok("одиночный invalid_request → 400", r.code === 400, `code=${r.code}`);
    ok("code = invalid_request", r.json?.error?.code === "invalid_request", r.json?.error?.code);
  }
  {
    await api("PUT", "/admin/failover", { lastResortModel: null });
    await api("PUT", "/sets/m10x", {
      models: [
        { provider: fresh(), model: "fail-500", priority: 1 },
        { provider: fresh(), model: "fail-500", priority: 2 },
      ],
    });
    const r = await chat(setModel("m10x"));
    ok("все 500 → 502 (код kind, не 503)", r.code === 502, `code=${r.code}`);
    await api("PUT", "/admin/failover", { lastResortModel: "mock/lastresort-ok" });
  }

  // ── M11: пассивная квота (rate-limit заголовки БЕЗ 429) ──────────────────
  section("M11 пассивная квота: remaining=0 без 429");
  {
    await resetCounters();
    const m11cfg = JSON.parse(readFileSync("cascade-router/tests/mock-config.json", "utf8")).router.sets.m11.models;
    const p = m11cfg[0].provider;
    const r = await chat(setModel("m11"));
    const q = await quota();
    const pause = q.find((x) => x.model === `${p}/fail-429-passive`);
    ok("200 от резервной модели", r.code === 200, `served=${r.json?.model}`);
    ok("пауза поставлена БЕЗ 429 (тонкое д)", !!pause, JSON.stringify(q.map((x) => x.model)));
  }

  // ── M12: длинный Retry-After уходит в lastResort ─────────────────────────
  section("M12 Retry-After 3600 → cap/пауза, lastResort");
  {
    await resetCounters();
    const r = await chat(setModel("m12"));
    const q = await quota();
    ok("200 от lastResort (модель на длинной паузе)", r.code === 200 && r.json?.model === "lastresort-ok",
      `served=${r.json?.model}`);
    ok("пауза записана", q.length > 0, JSON.stringify(q.map((x) => x.retry_after_ms)));
  }

  // ── M13: HTTP 200 с мусором → настоящий провал, фолбэк ──────────────────
  section("M13 HTTP 200 без choices = провал");
  {
    await resetCounters();
    const r = await chat(setModel("m13"));
    const c = await counters();
    ok("200 от резервной модели (не от мусора)", r.code === 200 && r.json?.model === "ok-fast", r.json?.model);
    ok("мусорная модель была вызвана", (c["fail-garbage"] || 0) === 1, JSON.stringify(c));
  }
  {
    // Изолированный мусор: lastResort выключен, чтобы увидеть собственный вердикт.
    await api("PUT", "/admin/failover", { lastResortModel: null });
    await api("PUT", "/sets/m13x", { models: [{ provider: fresh(), model: "fail-garbage", priority: 1 }] });
    const r = await chat(setModel("m13x"));
    ok("мусор без резерва → 502 + kind empty_choices", r.code === 502, `code=${r.code}`);
    const kinds = r.json?.error?.failure_kinds || [];
    ok("kind = empty_choices", kinds.includes("empty_choices"), JSON.stringify(kinds));
    await api("PUT", "/admin/failover", { lastResortModel: "mock/lastresort-ok" });
  }

  // ── M14: лимит попыток 1 + maxRetries ────────────────────────────────────
  section("M14 лимит попыток");
  {
    await api("PUT", "/sets/m14x", {
      models: [
        ...Array.from({ length: 7 }, (_, i) => ({ provider: fresh(), model: "fail-500", priority: i + 1 })),
      ],
    });
    await resetCounters();
    const r = await chat(setModel("m14x"));
    const c = await counters();
    const total = Object.entries(c).filter(([k]) => k === "fail-500").reduce((a, [, v]) => a + v, 0);
    // maxAttempts = min(1 + maxRetries=3, 6) = 4 кандидата, затем lastResort = 5-я.
    ok("кандидатов не больше 4 (1+maxRetries)", total <= 4, `candidates=${total}`);
    ok("lastResort отработал 5-й", r.headers["x-cascade-last-resort"] === "1", r.headers["x-cascade-last-resort"]);
    ok("попыток = 5 (4 + lastResort)", r.headers["x-cascade-attempts"] === "5", r.headers["x-cascade-attempts"]);
  }

  // ── M15: пин строго одна попытка, lastResort НЕ включается ───────────────
  section("M15 пин: одна попытка, без каскада");
  {
    await resetCounters();
    const pinProv = fresh();
    const r = await chat(`cascade:@${pinProv}/fail-429`);
    const c = await counters();
    ok("429 от pinned-модели (код kind, не 502)", r.code === 429, `code=${r.code}`);
    ok("Ровно одна попытка", r.headers["x-cascade-attempts"] === "1", r.headers["x-cascade-attempts"]);
    ok("fail-429 вызван 1 раз", (c["fail-429"] || 0) === 1, JSON.stringify(c));
    ok("ok-fast НЕ вызывался (нет каскада)", (c["ok-fast"] || 0) === 0, JSON.stringify(c));
    ok("lastResort НЕ использовался при пине", r.headers["x-cascade-last-resort"] === "0");
  }
  {
    const r = await chat("cascade:@mock/nonexistent-model");
    ok("пин не в каталоге → 400 invalid_model", r.code === 400 && r.json?.error?.code === "invalid_model",
      `code=${r.code} err=${r.json?.error?.code}`);
  }

  // ── M16: семейный фолбэк предпочитает ту же семью ────────────────────────
  section("M16 семейный фолбэк");
  {
    // Порядок каскада: 1→2→3, каждый следующий — следующий по приоритету.
    const a = fresh(), b = fresh(), c = fresh();
    await api("PUT", "/sets/m16x", {
      models: [
        { provider: a, model: "fail-500", priority: 1 },
        { provider: b, model: "ok-slow", priority: 2 },
        { provider: c, model: "ok-fast", priority: 3 },
      ],
    });
    await resetCounters();
    const r = await chat(setModel("m16x"));
    const cnt = await counters();
    ok("после 500 взял priority 2 (ok-slow)", r.json?.model === "ok-slow", `served=${r.json?.model}`);
    ok("priority 3 НЕ трогал", (cnt["ok-fast"] || 0) === 0, JSON.stringify(cnt));
    ok("attempts = 2", r.headers["x-cascade-attempts"] === "2", r.headers["x-cascade-attempts"]);
  }
  {
    // Семейный фолбэк: модели qwen3-coder на разных провайдерах — одна семья.
    // Провайдер «mistral» заблокирован auth в m3-подобном сце, поэтому строим свой.
    const p1 = fresh(), p2 = fresh();
    await api("PUT", "/sets/m16y", {
      models: [
        { provider: p1, model: "fail-500", priority: 1 },
        { provider: p2, model: "ok-fast", priority: 2 },
      ],
      familyFailover: true,
    });
    await resetCounters();
    const r = await chat(setModel("m16y"));
    ok("после отказа дошёл до ok-fast", r.code === 200 && r.json?.model === "ok-fast", `served=${r.json?.model}`);
    ok("attempts = 2", r.headers["x-cascade-attempts"] === "2", r.headers["x-cascade-attempts"]);
  }

  // ── M17: admin CRUD сетов ────────────────────────────────────────────────
  section("M17 CRUD сетов");
  {
    const create = await api("POST", "/sets", { name: "crud", models: [{ provider: "mock", model: "ok-fast", priority: 1 }] });
    ok("POST /sets → 201", create.code === 201, `code=${create.code}`);
    const get = await api("GET", "/sets/crud");
    ok("GET /sets/crud → 200", get.code === 200 && get.json?.name === "crud");
    const dup = await api("POST", "/sets", { name: "crud", models: [] });
    ok("дубль → 409", dup.code === 409, `code=${dup.code}`);
    const put = await api("PUT", "/sets/crud", { models: [{ provider: "mock", model: "ok-fast", priority: 1 }] });
    ok("PUT → 200", put.code === 200);
    const del = await api("DELETE", "/sets/crud");
    ok("DELETE → 200", del.code === 200);
    const gone = await api("GET", "/sets/crud");
    ok("после DELETE → 404", gone.code === 404, `code=${gone.code}`);
  }

  // ── M18: rate_limit-aware provider skip (задача 33) ──────────────────────
  // Провайдер mockt50 отдаёт 429 дважды → его третья модель НЕ должна быть
  // тронута; каскад обязан дойти до другого провайдера.
  section("M18 provider-skip по rate_limit");
  {
    await resetCounters();
    const r = await chat(setModel("m18"));
    const c = await counters();
    ok("200 от другого провайдера", r.code === 200 && r.json?.model === "ok-fast", `served=${r.json?.model} code=${r.code}`);
    ok("исполнитель НЕ из mockt50", r.headers["x-cascade-served-model"]?.startsWith("mockt51/") === true, r.headers["x-cascade-served-model"]);
    ok("skip сработал: 3-я модель mockt50 (ok-fast) не вызвана", (c["ok-fast"] || 0) === 1, `ok-fast=${c["ok-fast"]}`);
    ok("попыток ровно 3 (2×429 + 1 успех)", r.headers["x-cascade-attempts"] === "3", r.headers["x-cascade-attempts"]);
    const logText = readFileSync(process.env.MOCK_LOG || "/tmp/cascade-mock.log", "utf8");
    const skipLine = logText.split("\n").filter((l) => l.includes("provider-skip rate_limit mockt50")).pop() || "";
    ok("лог: ровно одна строка provider-skip rate_limit <provider> after N",
      skipLine.includes("provider-skip rate_limit mockt50 after 2"), skipLine.trim() || "(нет строки)");
    ok("лог: rate_limit-скип не сыпется на другие провайдеры",
      (logText.match(/provider-skip rate_limit/g) || []).length <= 2, `${(logText.match(/provider-skip rate_limit/g) || []).length} строк`);
  }

  // ── M19: все провайдеры в 429 → скипнутые возвращаются, все попытаны ───────
  section("M19 все провайдеры rate_limit: скип снят, попытки честные");
  {
    // lastResort тоже отдаёт 429 → финальный код виден как clientStatusForKind.
    const fo = (await api("GET", "/admin/failover")).json;
    await api("PUT", "/admin/failover", { lastResortModel: "mockt60/fail-429" });
    await resetCounters();
    const r = await chat(setModel("m19"));
    const c = await counters();
    ok("все 4 кандидата rate_limit вызваны (2 у каждого провайдера)",
      (c["fail-429-long"] || 0) === 2 && (c["fail-429"] || 0) === 3, `429=${c["fail-429"]} 429long=${c["fail-429-long"]}`);
    ok("попыток 5 = 4 кандидата + lastResort", r.headers["x-cascade-attempts"] === "5", r.headers["x-cascade-attempts"]);
    ok("finalStatusForKind(rate_limit) = 429, не 503", r.code === 429, `code=${r.code}`);
    ok("error = insufficient_quota (clientStatusForKind)", r.json?.error?.code === "insufficient_quota", r.json?.error?.code);
    await api("PUT", "/admin/failover", { lastResortModel: fo.lastResortModel });
  }
  {
    // Скип не должен превращать живые модели в 503: снятие возвращает провайдера.
    await resetCounters();
    const r = await chat(setModel("m19b"));
    ok("скип снят, живая модель провайдера спасена → 200", r.code === 200 && r.json?.model === "ok-fast", `served=${r.json?.model} code=${r.code}`);
    ok("обслужен единственный провайдер (а не 503)", r.headers["x-cascade-served-model"] === "mockt54/ok-fast", r.headers["x-cascade-served-model"]);
    ok("3 попытки: 2×429 + спасённый ok-fast", r.headers["x-cascade-attempts"] === "3", r.headers["x-cascade-attempts"]);
  }

  // ── M20: потолок попыток = 8 (было 6) ────────────────────────────────────
  section("M20 потолок попыток 8");
  {
    await resetCounters();
    const before = await api("GET", "/admin/failover");
    await api("PUT", "/admin/failover", { maxRetries: 7 });
    const r = await chat(setModel("m20"));
    const c = await counters();
    ok("10 кандидатов, maxRetries=7 → каскад упёрся в потолок: 8 моделей вызвано", (c["fail-500"] || 0) === 8, `fail-500=${c["fail-500"]}`);
    ok("попыток 9 = 8 (потолок) + 1 lastResort", r.headers["x-cascade-attempts"] === "9", r.headers["x-cascade-attempts"]);
    ok("lastResort отработал сверх каскада", r.headers["x-cascade-last-resort"] === "1", r.headers["x-cascade-last-resort"]);
    await api("PUT", "/admin/failover", { maxRetries: before.json.maxRetries });
    const h = await health();
    ok("failover.maxAttemptsCap = 8 виден в /health", h?.failover?.maxAttemptsCap === 8, `${h?.failover?.maxAttemptsCap}`);
    ok("failover.rateLimitProviderSkipAfter = 2 виден в /health", h?.failover?.rateLimitProviderSkipAfter === 2, `${h?.failover?.rateLimitProviderSkipAfter}`);
    ok("maxRetries восстановлен (3) — M14 не задет", h?.failover?.maxRetries === 3, `${h?.failover?.maxRetries}`);
  }

  // ── M21: жёсткие kind (5xx) НЕ триггерят provider-skip ───────────────────
  section("M21 жёсткие kind не вызывают skip");
  {
    await resetCounters();
    const r = await chat(setModel("m21"));
    const c = await counters();
    ok("200 после 500+timeout того же провайдера", r.code === 200 && r.json?.model === "ok-fast", `served=${r.json?.model}`);
    ok("обслужен сам mockt44: жёсткие kind НЕ дают soft-skip",
      r.headers["x-cascade-served-model"]?.startsWith("mockt44/") === true, r.headers["x-cascade-served-model"]);
    ok("его третья модель (ok-fast) вызвана — провайдер не скипнут", (c["ok-fast"] || 0) === 1, `ok-fast=${c["ok-fast"]}`);
    ok("жёсткие модели mockt44 вызваны (fail-500, fail-timeout)",
      (c["fail-500"] || 0) >= 1 && (c["fail-timeout"] || 0) >= 1, JSON.stringify(c));
  }

  // ── M22: release обнуляет счётчики rate_limit (задача 34) ──────────────────
  // Одна волна skip = 2×429 от mockt55. Все прочие кандидаты пусты → release.
  // Дальше провайдер снова отдаёт 429: первый НОВЫЙ 429 счётчик не триггерит
  // (порог сброшен), второй триггерит → вторая волна. Без сброса второй skip
  // пришёл бы на первом новом 429, fail-429-d остался бы невызванным (4 попытки).
  section("M22 release сбрасывает счётчики rate_limit");
  {
    const before = await api("GET", "/admin/failover");
    await api("PUT", "/admin/failover", { maxRetries: 7 });
    await resetCounters();
    const r = await chat(setModel("m22"));
    const c = await counters();
    ok("200 после двух волн skip", r.code === 200 && r.json?.model === "ok-fast", `served=${r.json?.model} code=${r.code}`);
    ok("обслужен mockt55 (тот же провайдер после release)", r.headers["x-cascade-served-model"] === "mockt55/ok-fast", r.headers["x-cascade-served-model"]);
    ok("попыток 5 = 4×429 (две волны) + ok-fast после release", r.headers["x-cascade-attempts"] === "5", r.headers["x-cascade-attempts"]);
    ok("второй новый 429 вызван (без сброса он был бы скипнут)", (c["fail-429-d"] || 0) === 1, `fail-429-d=${c["fail-429-d"]}`);
    ok("ok-fast вызван ровно один раз", (c["ok-fast"] || 0) === 1, `ok-fast=${c["ok-fast"]}`);
    const logText = readFileSync(process.env.MOCK_LOG || "/tmp/cascade-mock.log", "utf8");
    const skipLines = logText.split("\n").filter((l) => l.includes("provider-skip rate_limit mockt55"));
    ok("ровно две волны skip, обе after 2", skipLines.length === 2 && skipLines.every((l) => l.includes("after 2")),
      `${skipLines.length} строк: ${skipLines.map((l) => l.trim()).join(" | ")}`);
    const relLines = logText.split("\n").filter((l) => l.includes("provider-skip release"));
    ok("лог release прежний, с перечнем счётчиков", relLines.some((l) => l.includes("restore=mockt55:2")),
      relLines.map((l) => l.trim()).pop() || "(нет строки release)");
    await api("PUT", "/admin/failover", { maxRetries: before.json.maxRetries });
    const h = await health();
    ok("maxRetries восстановлен (3)", h?.failover?.maxRetries === 3, `${h?.failover?.maxRetries}`);
  }

  // ── T14: >10MB → 413 ─────────────────────────────────────────────────────
  section("T14 тело >10MB → 413");
  {
    const big = { model: setModel("m1"), max_tokens: 1, pad: "x".repeat(11 * 1024 * 1024) };
    const r = await chat(big.model, { pad: big.pad });
    ok("413 payload_too_large", r.code === 413, `code=${r.code}`);
    ok("code = payload_too_large", r.json?.error?.code === "payload_too_large", r.json?.error?.code);
  }

  // ── T16: Host guard (DNS-rebinding) ───────────────────────────────────────
  section("T16 Host guard");
  {
    const bad = await api("POST", "/v1/chat/completions", { model: setModel("m1"), max_tokens: 1 }, { Host: "evil.example.com" });
    ok("чужой Host → 403", bad.code === 403, `code=${bad.code}`);
    const good = await api("POST", "/v1/chat/completions", { model: setModel("m1"), max_tokens: 1 }, { Host: "localhost:19082" });
    ok("localhost → 200", good.code === 200, `code=${good.code}`);
    const healthBad = await api("GET", "/health", undefined, { Host: "evil.example.com" });
    ok("/health открыт без Host-guard (для мониторинга)", healthBad.code === 200, `code=${healthBad.code}`);
  }

  // ── Анthropic-форма /v1/messages ─────────────────────────────────────────
  section("Anthropic /v1/messages");
  {
    const r = await api("POST", "/v1/messages", { model: setModel("m1"), max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
    ok("200", r.code === 200, `code=${r.code}`);
    ok("type = message", r.json?.type === "message", r.json?.type);
    ok("content[0].type = text", r.json?.content?.[0]?.type === "text");
    ok("served-model в заголовке", !!r.headers["x-cascade-served-model"], r.headers["x-cascade-served-model"]);
  }

  console.log(`\n══ mock-suite: ${pass} PASS / ${fail} FAIL ══`);
  if (fail > 0) {
    console.log(`Провалено: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("mock-suite упал:", e);
  process.exit(1);
});
