/**
 * cascade-router/state/circuit.ts — circuit breaker.
 *
 * ЭТАП 1: контракт-интерфейс + in-memory реализация, полностью покрывающая
 * поведение CORE-SPEC §4 (DEGRADED@0.6·threshold, OPEN@threshold, эскалация
 * backoff с cap 16x, ленивый OPEN→HALF_OPEN по cooldown, sticky authError,
 * tripCount переживает успех). Персист breakers.json — этап 2.
 * Собственный код.
 */
import type { CircuitParams, CircuitState } from "../types.ts";

export interface BreakerEntry {
  key: string;
  state: CircuitState;
  consecutiveFailures: number;
  cooldownMs: number;
  openedAt: number | null;
  lastError: string | null;
  authError: boolean;
  tripCount: number;
  updatedAt: number;
}

const MAX_ESCALATION_STEPS = 4; // initial * 2^4 = 16x — cap (SPEC §4)

export class CircuitStore {
  private breakers = new Map<string, BreakerEntry>();
  constructor(private params: CircuitParams) {}

  get(key: string): BreakerEntry | undefined {
    return this.breakers.get(key);
  }

  ensure(key: string): BreakerEntry {
    let e = this.breakers.get(key);
    if (!e) {
      e = {
        key, state: "CLOSED", consecutiveFailures: 0, cooldownMs: this.params.initialCooldownMs,
        openedAt: null, lastError: null, authError: false, tripCount: 0, updatedAt: Date.now(),
      };
      this.breakers.set(key, e);
    }
    return e;
  }

  /** Ленивая промоция OPEN → HALF_OPEN после истечения cooldown (SPEC §4). */
  evaluate(key: string): BreakerEntry | undefined {
    const e = this.breakers.get(key);
    if (!e || e.state !== "OPEN") return e;
    if (e.openedAt !== null && Date.now() - e.openedAt >= e.cooldownMs) {
      e.state = "HALF_OPEN";
      e.updatedAt = Date.now();
    }
    return e;
  }

  markFailure(key: string, { detail = "unknown", authError = false } = {}): BreakerEntry {
    const e = this.ensure(key);
    if (authError) {
      // Мёртвый ключ — проблема конфигурации, не здоровья: флаг стики, без OPEN.
      e.authError = true;
      e.lastError = detail;
      e.updatedAt = Date.now();
      return e;
    }
    e.authError = false;
    e.consecutiveFailures += 1;
    e.lastError = detail;
    e.updatedAt = Date.now();
    const degradedThreshold = Math.max(1, Math.ceil(this.params.failureThreshold * 0.6));
    if (e.state === "HALF_OPEN" || e.consecutiveFailures >= this.params.failureThreshold) {
      e.state = "OPEN";
      e.openedAt = Date.now();
      e.tripCount += 1;
      const escalation = Math.min(e.tripCount - 1, MAX_ESCALATION_STEPS);
      e.cooldownMs = Math.min(
        this.params.maxCooldownMs,
        Math.max(this.params.initialCooldownMs, this.params.initialCooldownMs * this.params.backoffMultiplier ** escalation),
      );
    } else if (e.consecutiveFailures >= degradedThreshold) {
      e.state = "DEGRADED";
    }
    return e;
  }

  /**
   * Пометить ошибку БЕЗ вреда здоровью (вина клиента: 400/404/413/422).
   * Причина видна в дашбордах (last_error), breaker к OPEN/DEGRADED не идёт.
   */
  noteError(key: string, detail: string): BreakerEntry {
    const e = this.ensure(key);
    e.lastError = detail;
    e.updatedAt = Date.now();
    return e;
  }

  /** Полный сброс после успеха; tripCount (память эскалации) сохраняется. */
  markSuccess(key: string): BreakerEntry | undefined {
    const e = this.breakers.get(key);
    if (!e) return undefined;
    e.state = "CLOSED";
    e.consecutiveFailures = 0;
    e.cooldownMs = this.params.initialCooldownMs;
    e.openedAt = null;
    e.lastError = null;
    e.authError = false;
    e.updatedAt = Date.now();
    return e;
  }

  /** Персист: восстановление всех breaker-записей при старте (SPEC §4, C). */
  load(entries: Record<string, BreakerEntry>): void {
    for (const [key, raw] of Object.entries(entries || {})) {
      if (!raw || typeof raw !== "object") continue;
      this.breakers.set(key, {
        key,
        state: (["CLOSED", "DEGRADED", "OPEN", "HALF_OPEN"] as const).includes(raw.state) ? raw.state : "CLOSED",
        consecutiveFailures: Number.isFinite(raw.consecutiveFailures) ? Math.max(0, raw.consecutiveFailures) : 0,
        cooldownMs: Number.isFinite(raw.cooldownMs) && raw.cooldownMs > 0 ? raw.cooldownMs : this.params.initialCooldownMs,
        openedAt: Number.isFinite(raw.openedAt) ? raw.openedAt : null,
        lastError: typeof raw.lastError === "string" ? raw.lastError : null,
        authError: raw.authError === true,
        tripCount: Number.isFinite(raw.tripCount) ? Math.max(0, raw.tripCount) : 0,
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
      });
    }
  }

  /** Чистая сериализация для диска. */
  serialize(): Record<string, BreakerEntry> {
    return this.snapshot();
  }

  /** Сводка для /stats: сколько моделей в каждом состоянии (§4). */
  summary(): { total: number; CLOSED: number; DEGRADED: number; OPEN: number; HALF_OPEN: number } {
    const out = { total: 0, CLOSED: 0, DEGRADED: 0, OPEN: 0, HALF_OPEN: 0 };
    for (const e of this.breakers.values()) {
      out.total += 1;
      if (out[e.state] != null) out[e.state] += 1;
    }
    return out;
  }

  snapshot(): Record<string, BreakerEntry> {
    const out: Record<string, BreakerEntry> = {};
    for (const [k, v] of this.breakers) out[k] = { ...v };
    return out;
  }

  census(keys: string[]): Record<CircuitState | "AUTH_ERROR" | "QUOTA_PAUSED", number> {
    const counts = { CLOSED: 0, DEGRADED: 0, OPEN: 0, HALF_OPEN: 0, AUTH_ERROR: 0, QUOTA_PAUSED: 0 };
    for (const key of keys) {
      const e = this.evaluate(key);
      if (!e) { counts.CLOSED += 1; continue; }
      if (e.authError) { counts.AUTH_ERROR += 1; continue; }
      counts[e.state] += 1;
    }
    return counts;
  }
}
