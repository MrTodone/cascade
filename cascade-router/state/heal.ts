/**
 * cascade-router/state/heal.ts — autoHeal: подмена сломанных моделей на свежие.
 *
 * Собственный код. Контракт (SPEC §6):
 *  - ТОЛЬКО для моделей в состоянии BROKEN/AUTH_ERROR/OPEN;
 *  - замена идёт из каталога, и только в свободные слоты (не размножаем дубли);
 *  - ПРИОРИТЕТ СОХРАНЯЕТСЯ: сломанная на priority 2 заменяется на priority 2;
 *  - userCustomized=true → НЕ трогаем (человеческая правка выше автоматики);
 *  - отчёт: что/откуда/куда заменено, чтобы изменение было видно.
 */
import type { Catalog } from "../catalog.ts";
import type { CircuitStore } from "./circuit.ts";

export interface HealCandidate {
  provider: string;
  model: string;
  priority: number;
}

export interface HealAction {
  priority: number;
  from: string;
  to: string;
  reason: string;
}

export interface HealResult {
  healed: boolean;
  actions: HealAction[];
  skipped: "disabled" | "user_customized" | "nothing_broken" | "no_replacement" | null;
  userCustomized: boolean;
}

const BROKEN_STATES = new Set(["OPEN", "AUTH_ERROR", "STALE", "UNSUPPORTED"]);

/** Модель считается сломанной, если breaker открыт или ключ провайдера мёртв. */
function isBroken(breakers: CircuitStore, key: string): boolean {
  const e = breakers.get(key);
  if (!e) return false;
  if (e.authError) return true;
  return BROKEN_STATES.has(e.state);
}

/**
 * Подобрать замену: та же модель на другом провайдере, иначе модель той же
 * семьи с близким score, иначе ничего. Кандидат обязан быть незанятым.
 */
function findReplacement(
  broken: HealCandidate,
  occupied: Set<string>,
  catalog: Catalog,
): HealCandidate | null {
  const all = catalog.all();

  // 1) Та же модель на другом провайдере — самая честная замена.
  for (const e of all) {
    if (e.model !== broken.model) continue;
    if (occupied.has(`${e.provider}/${e.model}`)) continue;
    if (e.provider === broken.provider) continue;
    return { provider: e.provider, model: e.model, priority: broken.priority };
  }
  return null;
}

/**
 * Один проход autoHeal по active set. Чистая функция: возвращает новый список
 * моделей, вызывающий сам сохраняет конфиг.
 */
export function autoHealSet(
  set: { name: string; models: HealCandidate[] } | undefined,
  opts: {
    breakers: CircuitStore;
    catalog: Catalog;
    enabled: boolean;
    userCustomized: boolean;
  },
): HealResult {
  const base: HealResult = { healed: false, actions: [], skipped: null, userCustomized: opts.userCustomized };
  if (!set || set.models.length === 0) return { ...base, skipped: "nothing_broken" };

  // Человеческая правка выше автоматики.
  if (opts.userCustomized) return { ...base, skipped: "user_customized" };
  if (!opts.enabled) return { ...base, skipped: "disabled" };

  const models = set.models.map((m) => ({ ...m }));
  const occupied = new Set(models.map((m) => `${m.provider}/${m.model}`));
  const actions: HealAction[] = [];

  for (const m of models) {
    const key = `${m.provider}/${m.model}`;
    if (!isBroken(opts.breakers, key)) continue;
    // Слот модели считаем освобождённым ДО подбора: иначе замена ищет себя же.
    occupied.delete(key);
    const repl = findReplacement(m, occupied, opts.catalog);
    if (!repl) {
      occupied.add(key);
      continue;
    }
    m.provider = repl.provider;
    m.model = repl.model;
    occupied.add(`${repl.provider}/${repl.model}`);
    actions.push({ priority: m.priority, from: key, to: `${repl.provider}/${repl.model}`, reason: "broken_model_replaced" });
  }

  if (actions.length === 0) return { ...base, skipped: "nothing_broken" };
  // ПРИОРИТЕТЫ НЕ МЕНЯЕМ: массив уже отсортирован, значения priority сохранены 1:1.
  (set as { models: HealCandidate[] }).models = models;
  return { healed: true, actions, skipped: null, userCustomized: false };
}
