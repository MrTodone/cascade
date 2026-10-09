#!/usr/bin/env bun
/**
 * cascade-router/tests/heal.test.ts — контракт autoHeal.
 *
 * Проверяет тонкие места: замена ТОЛЬКО сломанных, приоритет сохранён,
 * userCustomized выше автоматики, дубли не плодятся, no-op не трогает конфиг.
 */
import { Router } from "../router.ts";
import { Catalog } from "../catalog.ts";
import { autoHealSet } from "../state/heal.ts";
import type { RouterConfig } from "../types.ts";

let pass = 0, fail = 0;
const failed: string[] = [];
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const catalog = new Catalog("cascade-router/tests/mock-catalog.json");

/** Каталог с двумя провайдерами одной модели — чтобы замена была возможна. */
const healCatalog = new Catalog("cascade-router/tests/heal-catalog.json");

function makeRouter(set: { name: string; models: any[] }, autoHeal = true, userCustomized = false): Router {
  const cfg = {
    apiKeys: { a: "k", b: "k" },
    settings: {},
    router: {
      activeSet: set.name,
      sets: { [set.name]: set },
      circuitBreaker: { failureThreshold: 3, successThreshold: 1, initialCooldownMs: 60000, maxCooldownMs: 300000, halfOpenProbes: 1 },
      failover: { maxRetries: 3, requestTimeoutMs: 2000, bodyReadTimeoutMs: 2000, totalBudgetMs: 8000, contentValidation: "basic", lastResortModel: null },
      autoHeal,
      userCustomized,
    },
  } as unknown as RouterConfig;
  return new Router(cfg, healCatalog, null);
}

console.log("heal.test");

// Каталог для heal: model-X есть у a и у b; model-Y только у a.
{
  const r = makeRouter({ name: "s", models: [{ provider: "a", model: "model-x", priority: 1 }] });
  const set = r.getSet("s");
  // Ничего не сломано → no-op.
  const res0 = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  ok("нет сломанных → healed=false", res0.healed === false && res0.skipped === "nothing_broken");

  // Ломаем: OPEN.
  r.breakers.markFailure("a/model-x", { detail: "provider_server_error" });
  r.breakers.markFailure("a/model-x", { detail: "provider_server_error" });
  r.breakers.markFailure("a/model-x", { detail: "provider_server_error" });
  ok("модель сломана (OPEN)", r.breakers.get("a/model-x")?.state === "OPEN", r.breakers.get("a/model-x")?.state);
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  ok("сломанная заменена", res.healed === true, JSON.stringify(res.actions));
  ok("замена на ту же модель другого провайдера", set!.models[0].provider === "b" && set!.models[0].model === "model-x",
    `${set!.models[0].provider}/${set!.models[0].model}`);
  ok("ПРИОРИТЕТ СОХРАНЁН", set!.models[0].priority === 1, `priority=${set!.models[0].priority}`);
  ok("в отчёте есть откуда/куда", res.actions[0].from === "a/model-x" && res.actions[0].to === "b/model-x");
}

// AUTH_ERROR тоже лечится.
{
  const r = makeRouter({ name: "s", models: [{ provider: "a", model: "model-x", priority: 1 }] });
  r.breakers.markFailure("a/model-x", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  ok("AUTH_ERROR лечится", res.healed === true && set!.models[0].provider === "b", `${set!.models[0].provider}`);
}

// Здоровая модель НЕ трогается (даже если есть замена).
{
  const r = makeRouter({ name: "s", models: [
    { provider: "a", model: "model-x", priority: 1 },
    { provider: "a", model: "model-y", priority: 2 },
  ] });
  r.breakers.markFailure("a/model-y", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  ok("здоровая model-x не тронута", set!.models[0].provider === "a", set!.models[0].provider);
  ok("сломанная model-y заменена", set!.models[1].provider === "b", set!.models[1].provider);
  ok("приоритеты 1 и 2 на месте", set!.models[0].priority === 1 && set!.models[1].priority === 2,
    `${set!.models.map((m: any) => m.priority).join(",")}`);
  ok("замен ровно одна", res.actions.length === 1);
}

// userCustomized → не трогаем (человеческая правка выше автоматики).
{
  const r = makeRouter({ name: "s", models: [{ provider: "a", model: "model-x", priority: 1 }] }, true, true);
  r.breakers.markFailure("a/model-x", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: true });
  ok("userCustomized → пропуск", res.healed === false && res.skipped === "user_customized", res.skipped || "");
  ok("модель не изменена", set!.models[0].provider === "a");
}

// autoHeal выключен → пропуск.
{
  const r = makeRouter({ name: "s", models: [{ provider: "a", model: "model-x", priority: 1 }] }, false, false);
  r.breakers.markFailure("a/model-x", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: false, userCustomized: false });
  ok("autoHeal=false → пропуск", res.healed === false && res.skipped === "disabled", res.skipped || "");
  ok("модель не изменена", set!.models[0].provider === "a");
}

// Нет замены → оставляем как есть, не выкидываем слот.
// model-z есть только у провайдера a и в каталоге других провайдеров не имеет.
{
  const r = makeRouter({ name: "s", models: [{ provider: "a", model: "model-z", priority: 1 }] });
  r.breakers.markFailure("a/model-z", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  const res = autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  ok("нет замены → no-op", res.healed === false, `skipped=${res.skipped}`);
  ok("слот НЕ выкинут", set!.models.length === 1 && set!.models[0].model === "model-z", JSON.stringify(set!.models));
}

// Дубли не плодятся: обе модели уже заняты — замена ищет свободный слот.
{
  const r = makeRouter({ name: "s", models: [
    { provider: "a", model: "model-x", priority: 1 },
    { provider: "a", model: "model-x2", priority: 2 },
  ] });
  // Сломаны обе a/model-x и a/model-x2; в каталоге замена есть только для model-x.
  r.breakers.markFailure("a/model-x", { detail: "auth_error", authError: true });
  r.breakers.markFailure("a/model-x2", { detail: "auth_error", authError: true });
  const set = r.getSet("s");
  autoHealSet(set as never, { breakers: r.breakers, catalog: healCatalog, enabled: true, userCustomized: false });
  const keys = set!.models.map((m: any) => `${m.provider}/${m.model}`);
  ok("нет дублей после heal", new Set(keys).size === keys.length, keys.join(" | "));
  ok("длина сета сохранена", set!.models.length === 2, `${set!.models.length}`);
}

console.log(`\n══ heal.test: ${pass} PASS / ${fail} FAIL ══`);
if (fail > 0) { console.log(`Провалено: ${failed.join(", ")}`); process.exit(1); }
