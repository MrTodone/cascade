#!/usr/bin/env bun
/**
 * cascade-router/tests/config.test.ts — тонкое место (а): дуализм v1/v2 конфига.
 * Свой код, без зависимостей: assert-функция вручную.
 *
 *   bun cascade-router/tests/config.test.ts
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouterConfigStore, detectConfigDialect, normalizeFailover, FAILOVER_DEFAULTS } from "../config.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const dir = mkdtempSync(join(tmpdir(), "cascade-cfg-"));
const p = (n: string) => join(dir, n);

// ── A1: v2-конфиг (прод-форма) load→save→load идентичен ─────────────────────
{
  const v2 = {
    apiKeys: { mock: "k" },
    settings: { cloudflareAccountId: "acct" },
    router: {
      activeSet: "s1",
      sets: { s1: { name: "s1", models: [{ provider: "mock", model: "ok-fast", priority: 1 }], familyFailover: true } },
      failover: { maxRetries: 4, requestTimeoutMs: 2000, streamStallTimeoutMs: 3000, lastResortModel: "mock/lastresort-ok", bodyReadTimeoutMs: 2500, totalBudgetMs: 8000, contentValidation: "basic" },
    },
  };
  const f = p("v2.json");
  writeFileSync(f, JSON.stringify(v2, null, 2));
  const s1 = new RouterConfigStore(f);
  check("A1 диалект v2 опознан", s1.dialect === "v2", `dialect=${s1.dialect}`);
  s1.save();
  const raw = JSON.parse(readFileSync(f, "utf8"));
  const fo = raw.router.failover;
  check("A1 v2-поля пережили save", fo.bodyReadTimeoutMs === 2500 && fo.totalBudgetMs === 8000 && fo.contentValidation === "basic",
    `bodyReadTimeoutMs=${fo.bodyReadTimeoutMs} totalBudgetMs=${fo.totalBudgetMs} contentValidation=${fo.contentValidation}`);
  const s2 = new RouterConfigStore(f);
  check("A1 load→save→load идентичен (failover)", JSON.stringify(s2.failover()) === JSON.stringify(s1.failover()));
  check("A1 lastResortModel сохранён", s2.failover().lastResortModel === "mock/lastresort-ok");
}

// ── A2: синтетический v1-конфиг читается, v2-поля = дефолты спеки ──────────
{
  const v1 = {
    apiKeys: { mock: "k" },
    settings: {},
    router: {
      activeSet: "s1",
      sets: { s1: { name: "s1", models: [{ provider: "mock", model: "ok-fast", priority: 1 }] } },
      failover: { maxRetries: 2, requestTimeoutMs: 5000 },
    },
  };
  const f = p("v1.json");
  writeFileSync(f, JSON.stringify(v1, null, 2));
  const s = new RouterConfigStore(f);
  check("A2 диалект v1 опознан", s.dialect === "v1", `dialect=${s.dialect}`);
  const fo = s.failover();
  check("A2 v1-поля прочитаны", fo.maxRetries === 2 && fo.requestTimeoutMs === 5000);
  check("A2 v2-поля = дефолты спеки", fo.bodyReadTimeoutMs === FAILOVER_DEFAULTS.bodyReadTimeoutMs
    && fo.totalBudgetMs === FAILOVER_DEFAULTS.totalBudgetMs
    && fo.contentValidation === FAILOVER_DEFAULTS.contentValidation,
    `bodyRead=${fo.bodyReadTimeoutMs} budget=${fo.totalBudgetMs} validation=${fo.contentValidation}`);
  s.save();
  const after = JSON.parse(readFileSync(f, "utf8")).router.failover;
  check("A2 после save v1 стал полным (дополнен дефолтами)", after.bodyReadTimeoutMs === FAILOVER_DEFAULTS.bodyReadTimeoutMs);
  check("A2 re-load = v2-диалект", new RouterConfigStore(f).dialect === "v2");
}

// ── A3: нормализация границ ───────────────────────────────────────────────
{
  const n = normalizeFailover({ maxRetries: "nope", requestTimeoutMs: null, totalBudgetMs: 999999999, contentValidation: "weird" });
  check("A3 мусор → дефолты", n.maxRetries === FAILOVER_DEFAULTS.maxRetries && n.requestTimeoutMs === FAILOVER_DEFAULTS.requestTimeoutMs);
  check("A3 невалидный contentValidation → strict", n.contentValidation === "strict");
  check("A3 absurd budget пробрасывается (clamp — задача 3, не здесь)", n.totalBudgetMs === 999999999);
  check("A3 пустой объект = empty-диалект", detectConfigDialect({ router: { failover: {} } }) === "v1");
  check("A3 failover отсутствует = empty", detectConfigDialect({ router: {} }) === "empty");
}

// ── A4: атомарная запись (tmp+rename) — файла .tmp не остаётся ───────────
{
  const f = p("v2.json");
  new RouterConfigStore(f).save();
  const leftovers = readFileSync(f, "utf8").includes(".tmp-");
  check("A4 save() не оставляет .tmp мусор", !leftovers);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n══ config.test: ${pass} PASS / ${fail} FAIL ══`);
process.exit(fail === 0 ? 0 : 1);
