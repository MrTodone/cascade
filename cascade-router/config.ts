/**
 * cascade-router/config.ts — загрузка/сохранение dev-конфига.
 *
 * Свой код. Ключевые свойства (CORE-SPEC §10):
 *  - прод-конфиг cascade-run/router/config.json читается БЕЗ изменений;
 *  - v2-поля failover (bodyReadTimeoutMs, totalBudgetMs, contentValidation)
 *    нативно сохраняются при save — отличие #2 (старый v1-normalizer их ронял);
 *  - запись атомарная: tmp + rename.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { RouterConfig, FailoverSettings, CircuitParams } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEV_CONFIG_PATH = process.env.CASCADE_ROUTER_CONFIG
  || join(HERE, "dev-config.json");
export const STATE_DIR = process.env.CASCADE_ROUTER_STATE_DIR
  || join(homedir(), ".cascade-router-dev");

/** Дефолты спеки (§3): применяются, когда поле отсутствует (v1-конфиг). */
export const FAILOVER_DEFAULTS: FailoverSettings = {
  maxRetries: 3,
  requestTimeoutMs: 15000,
  streamStallTimeoutMs: 30000,
  lastResortModel: null,
  bodyReadTimeoutMs: 30000,
  totalBudgetMs: 120000,
  contentValidation: "strict",
  rateLimitProviderSkipAfter: 2,
  maxAttemptsCap: 8,
};

/** Потолок попыток каскада (§3): min(1+maxRetries, 8). */
export const MAX_ATTEMPTS_CAP = 8;

export const CIRCUIT_DEFAULTS: CircuitParams = {
  failureThreshold: 3,
  initialCooldownMs: 30000,
  maxCooldownMs: 300000,
  backoffMultiplier: 2,
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Нормализация только недостающего: v2-поля из файла проходят насквозь. */
export function normalizeFailover(raw: unknown): FailoverSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    maxRetries: num(r.maxRetries, FAILOVER_DEFAULTS.maxRetries),
    requestTimeoutMs: num(r.requestTimeoutMs, FAILOVER_DEFAULTS.requestTimeoutMs),
    streamStallTimeoutMs: num(r.streamStallTimeoutMs, FAILOVER_DEFAULTS.streamStallTimeoutMs ?? 30000),
    lastResortModel: typeof r.lastResortModel === "string" ? r.lastResortModel : null,
    bodyReadTimeoutMs: num(r.bodyReadTimeoutMs, FAILOVER_DEFAULTS.bodyReadTimeoutMs),
    totalBudgetMs: num(r.totalBudgetMs, FAILOVER_DEFAULTS.totalBudgetMs),
    contentValidation: (["strict", "basic", "off"] as const).includes(r.contentValidation as never)
      ? (r.contentValidation as FailoverSettings["contentValidation"])
      : FAILOVER_DEFAULTS.contentValidation,
    rateLimitProviderSkipAfter: Math.max(1, num(r.rateLimitProviderSkipAfter, FAILOVER_DEFAULTS.rateLimitProviderSkipAfter!)),
    maxAttemptsCap: Math.max(1, num(r.maxAttemptsCap, FAILOVER_DEFAULTS.maxAttemptsCap!)),
  };
}

export function normalizeCircuit(raw: unknown): CircuitParams {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    failureThreshold: num(r.failureThreshold, CIRCUIT_DEFAULTS.failureThreshold),
    initialCooldownMs: num(r.initialCooldownMs, CIRCUIT_DEFAULTS.initialCooldownMs),
    maxCooldownMs: num(r.maxCooldownMs, CIRCUIT_DEFAULTS.maxCooldownMs),
    backoffMultiplier: num(r.backoffMultiplier, CIRCUIT_DEFAULTS.backoffMultiplier),
  };
}

/**
 * Классификация v1/v2 формы конфига (SPEC §10, тонкое место (а)).
 * v1: есть только maxRetries/streamStallTimeoutMs/requestTimeoutMs/lastResortModel.
 * v2: + bodyReadTimeoutMs/totalBudgetMs/contentValidation — должны переживать
 *     load→save БЕЗ нормализации, теряющей поля (отличие #2).
 */
export function detectConfigDialect(raw: unknown): "v1" | "v2" | "empty" {
  const f = (raw as any)?.router?.failover;
  if (!f || typeof f !== "object") return "empty";
  const v2Keys = ["bodyReadTimeoutMs", "totalBudgetMs", "contentValidation"];
  return v2Keys.some((k) => f[k] !== undefined) ? "v2" : "v1";
}

export class RouterConfigStore {
  readonly path: string;
  private cfg: RouterConfig;
  /** диалект исходного файла, определён при load (см. detectConfigDialect). */
  readonly dialect: "v1" | "v2" | "empty";

  constructor(path: string = DEV_CONFIG_PATH) {
    this.path = path;
    this.dialect = detectConfigDialect(JSON.parse(readFileSync(this.path, "utf8")));
    this.cfg = this.load();
  }

  load(): RouterConfig {
    const raw = JSON.parse(readFileSync(this.path, "utf8"));
    const router = raw.router || (raw.router = {});
    router.activeSet = typeof router.activeSet === "string" ? router.activeSet : "fast-coding";
    router.sets = router.sets && typeof router.sets === "object" ? router.sets : {};
    router.failover = normalizeFailover(router.failover);
    router.circuitBreaker = normalizeCircuit(router.circuitBreaker);
    if (router.autoHeal !== false) router.autoHeal = true;
    raw.apiKeys = raw.apiKeys && typeof raw.apiKeys === "object" ? raw.apiKeys : {};
    raw.settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    for (const [name, set] of Object.entries(router.sets)) {
      (set as { name?: string }).name ||= name;
      (set as { models?: unknown[] }).models ||= [];
    }
    return raw as RouterConfig;
  }

  get(): RouterConfig {
    return this.cfg;
  }

  failover(): FailoverSettings {
    return normalizeFailover(this.cfg.router.failover);
  }

  circuit(): CircuitParams {
    return normalizeCircuit(this.cfg.router.circuitBreaker);
  }

  apiKey(provider: string): string | null {
    const v = this.cfg.apiKeys?.[provider];
    return typeof v === "string" && v.length > 0 ? v : null;
  }

  activeSet() {
    return this.cfg.router.sets?.[this.cfg.router.activeSet] || null;
  }

  /** Атомарная запись: tmp + rename. v2-поля уже нормализованы в памяти. */
  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(this.cfg, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
  }

  ensureStateDir(): string {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    return STATE_DIR;
  }
}
