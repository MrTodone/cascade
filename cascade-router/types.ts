/**
 * cascade-router/types.ts — общие типы ядра.
 * Собственный код: описывает контракт из docs/CORE-SPEC.md.
 */

export type ModelSpecKind = "default" | "set" | "pinned" | "unknown";

export interface ModelSpec {
  kind: ModelSpecKind;
  set: string | null;
  pinned: { provider: string; model: string } | null;
  /** сырая строка как пришла от клиента */
  raw: string;
  /** какая форма была использована: "cascade" */
  dialect: "cascade" | null;
}

export interface SetModel {
  provider: string;
  model: string;
  priority: number;
}

export interface RouterSet {
  name: string;
  models: SetModel[];
  created?: string;
  familyFailover?: boolean;
}

export interface CatalogEntry {
  provider: string;
  model: string;
  context: number | null;
  tier: string;
  score: number;
  /** provenance: "live-api" | "verified-2026-09" | "config-set" */
  provenance: string;
  note?: string;
}

export interface RouterConfig {
  apiKeys: Record<string, string>;
  settings: {
    cloudflareAccountId?: string;
    hideUnconfiguredModels?: boolean;
    autoHideBrokenModels?: boolean;
    [k: string]: unknown;
  };
  router: {
    enabled?: boolean;
    port?: number;
    activeSet: string;
    sets: Record<string, RouterSet>;
    probeMode?: string;
    circuitBreaker?: Partial<CircuitParams>;
    /** v2-поля живут здесь и обязаны переживать save/load (отличие #2) */
    failover: FailoverSettings;
    scoring?: { latencyWeight?: number; uptimeWeight?: number; priorityWeight?: number };
    autoHeal?: boolean;
    userCustomized?: boolean;
    logLevel?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface FailoverSettings {
  maxRetries: number;
  streamStallTimeoutMs?: number;
  requestTimeoutMs: number;
  lastResortModel: string | null;
  /** v2 (нативно сохраняемые) */
  bodyReadTimeoutMs: number;
  totalBudgetMs: number;
  contentValidation: "strict" | "basic" | "off";
  /**
   * Мягкий per-request скип провайдера: столько вердиктов rate_limit от него
   * подряд/суммарно в одном запросе → остальные его модели пропускаются при
   * подборе кандидатов ЭТОГО запроса. Breaker не трогаем (задача 33).
   */
  rateLimitProviderSkipAfter?: number;
  /** Потолок попыток каскада; по умолчанию MAX_ATTEMPTS_CAP. */
  maxAttemptsCap?: number;
}

export interface CircuitParams {
  failureThreshold: number;
  initialCooldownMs: number;
  maxCooldownMs: number;
  backoffMultiplier: number;
}

export type CircuitState = "CLOSED" | "DEGRADED" | "OPEN" | "HALF_OPEN";

export interface Candidate {
  provider: string;
  model: string;
  key: string;
  priority: number;
  state: CircuitState;
  score: number;
  catalog: CatalogEntry | null;
}
