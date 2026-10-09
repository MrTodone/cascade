#!/usr/bin/env bun
/**
 * cascade-router/tests/persist.test.ts — персист переживает рестарт процесса.
 *
 * Проверяет: breakers / quota / probes / history записаны атомарно в stateDir,
 * читаются новым процессом, битый файл не роняет ядро, рестарт = продолжение.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "../router.ts";
import { Catalog } from "../catalog.ts";
import { StatePersistence } from "../state/persist.ts";
import type { RouterConfig } from "../types.ts";

let pass = 0, fail = 0;
const failed: string[] = [];
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const CATALOG = new Catalog("cascade-router/tests/mock-catalog.json");

function config(): RouterConfig {
  return {
    apiKeys: { mock: "k", mock1: "k" },
    settings: {},
    router: {
      activeSet: "t",
      sets: { t: { name: "t", models: [{ provider: "mock", model: "ok-fast", priority: 1 }] } },
      circuitBreaker: { failureThreshold: 3, successThreshold: 1, initialCooldownMs: 60000, maxCooldownMs: 300000, halfOpenProbes: 1 },
      failover: { maxRetries: 3, requestTimeoutMs: 2000, bodyReadTimeoutMs: 2000, totalBudgetMs: 8000, contentValidation: "basic", lastResortModel: "mock/lastresort-ok" },
      autoHeal: false,
    },
  } as unknown as RouterConfig;
}

console.log("persist.test");

// 1) Атомарная запись: tmp-файлов не остаётся.
{
  const dir = mkdtempSync(join(tmpdir(), "cascade-persist-"));
  const p = new StatePersistence(dir, 0);
  p.writeNow("breakers", { "a/b": { state: "OPEN" } });
  const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
  ok("атомарная запись: tmp не остался", leftovers.length === 0, leftovers.join(","));
  ok("файл создан", existsSync(join(dir, "breakers.json")));
  ok("содержимое валидный JSON", JSON.parse(readFileSync(join(dir, "breakers.json"), "utf8"))["a/b"].state === "OPEN");
  rmSync(dir, { recursive: true, force: true });
}

// 2) Состояние → диск → новый Router (эмуляция рестарта).
{
  const dir = mkdtempSync(join(tmpdir(), "cascade-persist-"));
  // Процесс 1: набиваем состояние.
  const r1 = new Router(config(), CATALOG, dir);
  r1.breakers.markFailure("mock1/fail-500", { detail: "provider_server_error" });
  r1.breakers.markFailure("mock1/fail-500", { detail: "provider_server_error" });
  r1.quota.record("mock1/fail-429", 60000, 429);
  r1.probeCache.record({ model: "mock1/ok-fast", ok: false, latencyMs: 123, status: 500, at: Date.now() });
  r1.history.append({
    request_id: "req1", at: new Date().toISOString(), set: "t", served_model: "mock1/ok-fast",
    status: 500, latency_ms: 123, outcome: "all_failed", attempts: [{ model: "mock1/ok-fast", status: 500, latency_ms: 123, kind: "provider_server_error" }],
  });
  r1.flushState();

  for (const f of ["breakers.json", "quota.json", "probes.json", "history.json"]) {
    ok(`файл ${f} записан`, existsSync(join(dir, f)));
  }

  // Процесс 2: поднимаем новый Router на том же каталоге.
  const r2 = new Router(config(), CATALOG, dir);
  const b = r2.breakers.get("mock1/fail-500");
  ok("breaker пережил рестарт (2 провала)", b?.consecutiveFailures === 2, `n=${b?.consecutiveFailures}`);
  ok("last_error пережил рестарт", b?.lastError === "provider_server_error", `${b?.lastError}`);
  ok("quota-пауза пережила рестарт", r2.quota.active("mock1/fail-429") === true);
  ok("probe-результат пережил рестарт", r2.probeCache.get("mock1/ok-fast")?.latencyMs === 123,
    `${r2.probeCache.get("mock1/ok-fast")?.latencyMs}`);
  // TTL 24ч: свежая запись жива, протухшая — нет.
  ok("свежий probe виден", r2.probeCache.get("mock1/ok-fast") !== null);
  r2.probeCache.record({ model: "mock1/stale", ok: false, latencyMs: 1, status: 500, at: Date.now() - 25 * 3600 * 1000 });
  ok("протухший probe скрыт по TTL 24ч", r2.probeCache.get("mock1/stale") === null);
  ok("history пережила рестарт", r2.history.all().length === 1, `${r2.history.all().length}`);
  ok("served_model из истории", r2.history.all()[0]?.served_model === "mock1/ok-fast");

  // Продолжение работы: тот же breaker растёт дальше, а не начинает с нуля.
  r2.breakers.markFailure("mock1/fail-500", { detail: "provider_server_error" });
  ok("после рестарта breaker продолжает счёт (3)", r2.breakers.get("mock1/fail-500")?.consecutiveFailures === 3,
    `n=${r2.breakers.get("mock1/fail-500")?.consecutiveFailures}`);

  rmSync(dir, { recursive: true, force: true });
}

// 3) Битый файл не роняет ядро.
{
  const dir = mkdtempSync(join(tmpdir(), "cascade-persist-"));
  writeFileSync(join(dir, "breakers.json"), "{ ЭТО НЕ JSON", "utf8");
  let r: Router | null = null;
  try {
    r = new Router(config(), CATALOG, dir);
    ok("битый breakers.json: ядро поднялось", true);
    ok("битый файл → пустое состояние", Object.keys(r.breakers.snapshot()).length === 0);
  } catch (e: any) {
    ok("битый breakers.json: ядро поднялось", false, String(e?.message || e));
  }
  rmSync(dir, { recursive: true, force: true });
}

// 4) Без stateDir — чистая память, никаких файлов.
{
  const r = new Router(config(), CATALOG, null);
  r.breakers.markFailure("mock1/fail-500", { detail: "x" });
  ok("без stateDir persist выключен", r.persist === null);
  ok("состояние живёт в памяти", r.breakers.get("mock1/fail-500") !== null);
}

console.log(`\n══ persist.test: ${pass} PASS / ${fail} FAIL ══`);
if (fail > 0) { console.log(`Провалено: ${failed.join(", ")}`); process.exit(1); }
