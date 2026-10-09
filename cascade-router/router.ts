/**
 * cascade-router/router.ts — резолв model-id, сета, кандидатов, исполнение.
 *
 * Собственный код. Поведение по CORE-SPEC §1-§3, §7:
 *  - основные формы "cascade"/"cascade:<set>"/"cascade:@provider/model";
 *  - unknown → явная ошибка (отличие #1), НЕ молчаливый каскад;
 *  - строгий пин: 1 попытка, без каскада; не резолвится → 400 invalid_model;
 *  - порядок каскада: priority → circuit state (CLOSED<DEGRADED<HALF_OPEN) → score;
 *  - ЭТАП 1: исполняется только ПЕРВАЯ доступная кандидатура; полный
 *    failover-цикл (budget, семейный подбор, lastResort) — этап 2.
 */
import type { Candidate, ModelSpec, RouterConfig, RouterSet } from "./types.ts";
import { CircuitStore } from "./state/circuit.ts";
import { QuotaRegistry, DEFAULT_QUOTA_PAUSE_MS } from "./state/quota.ts";
import { ProbeCache } from "./state/probe.ts";
import { StatePersistence, HistoryLog, type HistoryEntry } from "./state/persist.ts";
import { Catalog } from "./catalog.ts";
import { getAdapter } from "./adapters/index.ts";
import { modelFamily, pickNextCandidate } from "./state/family.ts";
import {
  classifyFailure, classifyStatus, parseRetryAfterMs, finalStatusForKinds, finalErrorCode,
  FAILURE_KINDS, type FailureKind, type Verdict,
} from "./state/classify.ts";
import { MAX_ATTEMPTS_CAP } from "./config.ts";
import type { ChatOutcome } from "./adapters/index.ts";

/** Пин lastResortModel: строка "provider/model" → пара. */
function parseLastResort(value: string | null): { provider: string; model: string } | null {
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

const ALL_KIND_VALUES = new Set<string>(Object.values(FAILURE_KINDS));
function isFailureKind(v: string): v is FailureKind {
  return ALL_KIND_VALUES.has(v);
}

export interface AttemptRecord {
  model: string;
  status: number | null;
  latency_ms: number;
  kind: string;
  ok: boolean;
  at: string;
  last_resort?: boolean;
}

export interface RouteResult {
  ok: boolean;
  status: number;
  code: string;
  message: string;
  json?: unknown;
  servedModel?: string;
  attempts: AttemptRecord[];
  tried: string[];
  failedKinds: FailureKind[];
  lastResortUsed: boolean;
  budgetExhausted?: boolean;
  wallMs: number;
  /** поток SSE провайдера при stream=true (буфер не читается) */
  sse?: ReadableStream<Uint8Array> | null;
}

const DIALECTS = ["cascade"] as const;

/**
 * Контент-валидация успешного (2xx) ответа провайдера — §3, семейство
 * "HTTP 200 но мусор": invalid_json / error_payload / empty_choices / empty_content.
 * null → ответ валиден.
 */
export function validateOkBody(json: any): FailureKind | null {
  if (json == null) return FAILURE_KINDS.INVALID_JSON;
  if (json.error != null) return FAILURE_KINDS.ERROR_PAYLOAD;
  if (!Array.isArray(json.choices) || json.choices.length === 0) return FAILURE_KINDS.EMPTY_CHOICES;
  const msg = json.choices[0]?.message || json.choices[0]?.delta || {};
  const text = typeof msg.content === "string" ? msg.content.trim() : "";
  const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? "").trim();
  const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  if (!text && !reasoning && !hasToolCalls) return FAILURE_KINDS.EMPTY_CONTENT;
  return null;
}

/** SPEC §1: парсинг id в трёх формах + алиасы. */
export function parseModelSpec(model: unknown): ModelSpec {
  const raw = typeof model === "string" ? model : "";
  const value = raw.trim();
  const base = { raw, set: null as string | null, pinned: null as ModelSpec["pinned"] };
  if (!value) return { ...base, kind: "unknown", dialect: null };

  const d = DIALECTS.find((d) => value === d || value.startsWith(`${d}:`));
  if (!d) return { ...base, kind: "unknown", dialect: null };
  const dialect = d;

  if (value === d || value === `${d}:default`) return { ...base, kind: "default", dialect };

  if (value.startsWith(`${d}:@`)) {
    const rest = value.slice(d.length + 2);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return { ...base, kind: "unknown", dialect };
    return { kind: "pinned", set: null, pinned: { provider: rest.slice(0, slash), model: rest.slice(slash + 1) }, raw, dialect };
  }

  const setName = value.slice(d.length + 1).trim();
  if (!setName) return { ...base, kind: "default", dialect };
  return { kind: "set", set: setName, pinned: null, raw, dialect };
}

export class Router {
  readonly breakers: CircuitStore;
  readonly quota = new QuotaRegistry();
  readonly probeCache = new ProbeCache();
  readonly history = new HistoryLog(200);
  readonly persist: StatePersistence | null;
  private stats = { requests: 0, served: 0, failed: 0, pins: 0, lastResort: 0 };

  constructor(readonly config: RouterConfig, readonly catalog: Catalog, stateDir?: string | null) {
    this.breakers = new CircuitStore(
      config.router.circuitBreaker as never,
    );
    // Персист включается только когда задан stateDir; без него — чистая память (тесты).
    this.persist = stateDir ? new StatePersistence(stateDir) : null;
    if (this.persist) {
      // Загрузка при старте: breaker/quota/probes переживают рестарт процесса (SPEC §4).
      this.breakers.load(this.persist.read("breakers", {}));
      this.quota.load(this.persist.read("quota", {}));
      this.probeCache.load(this.persist.read("probes", {}));
      this.history.load(this.persist.read("history", []) as HistoryEntry[]);
    }
  }

  /** Отметить изменение состояния и запланировать атомарный сброс на диск. */
  private dirty(...names: string[]): void {
    if (!this.persist) return;
    for (const n of names) this.persist.mark(n);
  }

  /** Немедленный сброс всех файлов (graceful shutdown / тест рестарта). */
  flushState(): void {
    this.persist?.flushNow({
      breakers: this.breakers.serialize(),
      quota: this.quota.serialize(),
      probes: this.probeCache.serialize(),
      history: this.history.all(),
    });
  }

  private recordHistory(entry: HistoryEntry): void {
    this.history.append(entry);
    this.stats.requests += 1;
    if (entry.outcome === "served") this.stats.served += 1;
    if (entry.outcome === "all_failed") this.stats.failed += 1;
    if (entry.last_resort_used) this.stats.lastResort += 1;
    this.dirty("history");
  }

  getSet(name?: string | null): RouterSet | null {
    const setName = name || this.config.router.activeSet;
    return this.config.router.sets?.[setName] || null;
  }

  /** SPEC §2: usable-кандидаты в порядке каскада. */
  candidates(set: RouterSet): Candidate[] {
    const rows = [...(set.models || [])].sort((a, b) => a.priority - b.priority);
    const usable: Candidate[] = [];
    const seenKeys = new Set<string>();
    for (const m of rows) {
      const key = `${m.provider}/${m.model}`;
      if (seenKeys.has(key)) continue; // одна пара провайдер/модель = одна попытка
      seenKeys.add(key);
      if (this.quota.active(key)) continue;
      const entry = this.breakers.evaluate(key);
      // auth_error: ключ провайдера мёртв — модель не предлагается, пока не починят/сбросят.
      if (entry?.authError) continue;
      const state = entry?.state || "CLOSED";
      if (state !== "CLOSED" && state !== "DEGRADED" && state !== "HALF_OPEN") continue;
      usable.push({
        provider: m.provider, model: m.model, key, priority: m.priority,
        state, score: 0, catalog: this.catalog.get(m.provider, m.model),
      });
    }
    const stateOrder: Record<string, number> = { CLOSED: 0, DEGRADED: 1, HALF_OPEN: 2 };
    return usable.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const ra = stateOrder[a.state] ?? 3;
      const rb = stateOrder[b.state] ?? 3;
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    });
  }

  /**
   * SPEC §2 resolvePinnedCandidate: каталог → routeable → ключ.
   * Возвращает {error} → вызывающий отдаёт 400.
   */
  resolvePinned(provider: string, model: string): { candidate: Candidate } | { error: string; reason: string } {
    const key = `${provider}/${model}`;
    if (!this.catalog.has(provider, model)) return { error: `Unknown model: ${key}`, reason: "unknown_model" };
    const adapter = getAdapter(provider);
    if (!adapter) return { error: `Provider is not routeable: ${provider}`, reason: "provider_not_routeable" };
    if (!this.config.apiKeys?.[provider]) return { error: `No API key configured for ${provider}`, reason: "missing_api_key" };
    const breaker = this.breakers.get(key) || null;
    return {
      candidate: {
        provider, model, key, priority: 1,
        state: breaker?.authError ? "CLOSED" : (breaker?.state || "CLOSED"),
        score: 0, catalog: this.catalog.get(provider, model),
      },
    };
  }

  /**
   * ЕДИНАЯ ПОПЫТКА с применением вердикта по политике (§3):
   * auth → sticky без роста breaker; rate_limit → пауза; client 4xx → без вреда;
   * остальное → рост breaker. Успех → полный сброс.
   * СОХРАНЯЕТ ПРЕЖНЮЮ сигнатуру (используется этапом 1 и мок-сьютом).
   */
  async execute(candidate: Candidate, body: Record<string, unknown>, stream: boolean): Promise<ChatOutcome> {
    return this.attempt(candidate, body, stream, {});
  }

  async attempt(
    candidate: Candidate,
    body: Record<string, unknown>,
    stream: boolean,
    opts: { timeoutMs?: number; meta?: Record<string, unknown> } = {},
  ): Promise<ChatOutcome & { verdict?: Verdict }> {
    const apiKey = this.config.apiKeys?.[candidate.provider];
    if (!apiKey) {
      const verdict = classifyFailure({ kind: FAILURE_KINDS.AUTH });
      this.breakers.markFailure(candidate.key, { detail: "missing_api_key", authError: true });
      this.dirty("breakers");
      return { ok: false, status: null, json: null, latencyMs: 0, error: "missing_api_key", verdict };
    }
    const adapter = getAdapter(candidate.provider);
    if (!adapter) {
      const verdict = classifyFailure({ kind: FAILURE_KINDS.PROVIDER_URL });
      this.breakers.markFailure(candidate.key, { detail: "provider_not_routeable" });
      this.dirty("breakers");
      return { ok: false, status: null, json: null, latencyMs: 0, error: "provider_not_routeable", verdict };
    }

    const timeoutMs = opts.timeoutMs ?? this.config.router.failover?.requestTimeoutMs ?? 15000;
    // Единый timeout-race: ни один адаптер не может увести запрос за requestTimeoutMs,
    // даже если сам игнорирует AbortSignal (mock, заглушки).
    const outcome = await Promise.race([
      adapter.chat({ model: candidate.model, body, timeoutMs, stream }, apiKey, this.config),
      new Promise<ChatOutcome>((resolve) => {
        const t = setTimeout(
          () => resolve({ ok: false, status: null, json: null, latencyMs: timeoutMs, error: "timeout" }),
          timeoutMs + 50,
        );
        if (typeof t.unref === "function") t.unref();
      }),
    ]);

    if (outcome.ok) {
      // Контент-валидация 200-ответа (§3): провайдеры отдают 200 с телом-ошибкой
      // (например OpenRouter: {"error":{"code":503,...}} без choices). Такой ответ —
      // настоящий провал модели, а не успех: иначе клиент получает 200 без choices.
      // Стрим не валидируем: тело не прочитано, откат после первого байта невозможен.
      if (!stream) {
        const badKind = validateOkBody(outcome.json);
        if (badKind) {
          const verdict = classifyFailure({ kind: badKind, status: outcome.status ?? 200 });
          this.breakers.markFailure(candidate.key, { detail: badKind });
          this.quota.clear(candidate.key);
          this.dirty("breakers");
          this.probeCache.record({ model: candidate.key, ok: false, latencyMs: outcome.latencyMs, status: outcome.status ?? 200, at: Date.now() });
          this.dirty("probes");
          return { ...outcome, ok: false, kind: badKind, error: badKind, verdict };
        }
      }
      // Стрим коммитится сразу: откатываться на другую модель после отправки
      // первого байта клиенту уже нельзя, поэтому контент-валидация не выполняется.
      this.breakers.markSuccess(candidate.key);
      this.quota.clear(candidate.key);
      this.dirty("breakers", "quota");
      this.probeCache.record({ model: candidate.key, ok: true, latencyMs: outcome.latencyMs, status: outcome.status ?? 200, at: Date.now() });
      this.dirty("probes");
      return { ...outcome, verdict: classifyFailure({ kind: FAILURE_KINDS.NETWORK }) };
    }

    // kind: явный из адаптера, иначе по HTTP-статусу, иначе network/timeout.
    let kind: FailureKind;
    if (outcome.kind && isFailureKind(outcome.kind)) kind = outcome.kind;
    else if (outcome.error === "timeout") kind = FAILURE_KINDS.TIMEOUT;
    else if (outcome.status) kind = classifyStatus(outcome.status);
    else kind = FAILURE_KINDS.NETWORK;
    const retryAfterMs = parseRetryAfterMs(outcome.retryAfter ?? null);
    const verdict = classifyFailure({ kind, status: outcome.status, retryAfterMs });

    // Политика вердикта — единственная воронка (§3).
    if (verdict.kind === FAILURE_KINDS.AUTH) {
      this.breakers.markFailure(candidate.key, { detail: verdict.kind, authError: true });
      this.dirty("breakers");
    } else if (verdict.healthDamage) {
      this.breakers.markFailure(candidate.key, { detail: verdict.kind });
      this.dirty("breakers");
    } else {
      // Вина клиента: помнить причину для дашбордов, breaker НЕ растить.
      this.breakers.noteError(candidate.key, verdict.kind);
      this.dirty("breakers");
    }
    if ((verdict.quotaPauseMs != null && verdict.quotaPauseMs > 0) || verdict.kind === FAILURE_KINDS.RATE_LIMIT || verdict.kind === FAILURE_KINDS.QUOTA) {
      this.quota.record(candidate.key, verdict.quotaPauseMs || DEFAULT_QUOTA_PAUSE_MS, outcome.status ?? null);
      this.dirty("quota");
    }
    // Пассивная квота: rate-limit заголовки без 429 (SPEC §6/тонкое место M12).
    if (outcome.rateLimitHeaders && outcome.status !== 429 && outcome.ok === false) {
      const passive = outcome.rateLimitHeaders;
      if (passive["x-ratelimit-remaining"] === "0" || passive["ratelimit-remaining"] === "0") {
        this.quota.record(candidate.key, DEFAULT_QUOTA_PAUSE_MS, outcome.status ?? null);
        this.dirty("quota");
      }
    }
    this.probeCache.record({ model: candidate.key, ok: false, latencyMs: outcome.latencyMs, status: outcome.status ?? null, at: Date.now() });
    this.dirty("probes");
    return { ...outcome, verdict };
  }

  /**
   * ПОЛНЫЙ FAILOVER-ЦИКЛ (§2, §3, §7).
   * Возвращает итог запроса; сервер превращает его в HTTP-ответ.
   */
  async routeWithFailover({
    set,
    body,
    stream,
    pinned = null,
  }: {
    set: RouterSet | null;
    body: Record<string, unknown>;
    stream: boolean;
    pinned?: { provider: string; model: string } | null;
  }): Promise<RouteResult> {
    const settings = this.config.router.failover;
    const started = Date.now();
    const deadline = started + (settings.totalBudgetMs || 120000);
    const attemptsCap = Math.max(1, Math.min(1 + (settings.maxRetries || 0), settings.maxAttemptsCap || MAX_ATTEMPTS_CAP));
    const maxAttempts = pinned ? 1 : attemptsCap;
    // Задача 33: мягкий per-request скип провайдера по rate_limit. Breaker не трогаем.
    const rlSkipAfter = Math.max(1, settings.rateLimitProviderSkipAfter || 2);
    const rateLimitHits = new Map<string, number>();
    const softSkipped = new Set<string>();

    const tried: string[] = [];
    const failedKinds: FailureKind[] = [];
    const blockedProviders = new Set<string>();
    const attempts: AttemptRecord[] = [];
    const familyFailover = set?.familyFailover !== false;

    // Пин: строго одна попытка, guard lastResort не применяется (§7).
    if (pinned) {
      const resolved = this.resolvePinned(pinned.provider, pinned.model);
      if ("error" in resolved) {
        this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set?.name || null, served_model: null, status: 400, latency_ms: 0, outcome: "rejected", attempts: [] });
        return { ok: false, status: 400, code: "invalid_model", message: resolved.error, attempts, tried, failedKinds, lastResortUsed: false, wallMs: 0 };
      }
      const outcome = await this.attempt(resolved.candidate, body, stream, {});
      tried.push(resolved.candidate.key);
      attempts.push(this.attemptRecord(resolved.candidate.key, outcome));
      if (outcome.ok) {
        this.stats.pins += 1;
        this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set?.name || null, served_model: resolved.candidate.key, status: 200, latency_ms: Date.now() - started, outcome: "served", attempts: [{ model: resolved.candidate.key, status: 200, latency_ms: outcome.latencyMs, kind: "ok" }] });
        return { ok: true, status: 200, code: "ok", message: "", json: outcome.json, sse: outcome.sse, servedModel: resolved.candidate.key, attempts, tried, failedKinds, lastResortUsed: false, wallMs: Date.now() - started };
      }
      const pinKind = outcome.verdict?.kind || FAILURE_KINDS.NETWORK;
      failedKinds.push(pinKind);
      // Пин без каскада: наружу отдаём честный код kind (429 → 429, 401 → 401).
      const pinStatus = finalStatusForKinds(failedKinds);
      this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set?.name || null, served_model: null, status: pinStatus, latency_ms: Date.now() - started, outcome: "all_failed", attempts });
      return {
        ok: false, status: pinStatus, code: finalErrorCode(failedKinds),
        message: `Pinned model failed: ${resolved.candidate.key}`,
        attempts, tried, failedKinds, lastResortUsed: false, wallMs: Date.now() - started,
      };
    }

    if (!set) {
      this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: null, served_model: null, status: 404, latency_ms: 0, outcome: "rejected", attempts: [] });
      return { ok: false, status: 404, code: "set_not_found", message: "Router set not found", attempts, tried, failedKinds, lastResortUsed: false, wallMs: 0 };
    }

    // Цепочка кандидатов в порядке §2, обогащённая семейством для фолбэка.
    const chain = this.candidates(set).map((c) => ({ ...c, family: modelFamily(c.model) }));
    if (chain.length === 0) {
      this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set.name || null, served_model: null, status: 503, latency_ms: 0, outcome: "all_failed", attempts: [] });
      return { ok: false, status: 503, code: "all_models_unavailable", message: `All routed models failed for set: ${set.name || "?"}`, attempts, tried, failedKinds, lastResortUsed: false, wallMs: 0 };
    }

    let current = chain[0];
    // Подбор с учётом мягкого скипа; если после скипа пусто — снимаем скип и
    // пробуем снова (лучше честная попытка, чем 503 при живых моделях).
    const selectNext = (failed: typeof current) => {
      const next = pickNextCandidate({
        candidates: chain, failedCandidate: failed,
        triedKeys: new Set(tried), blockedProviders, familyFailover,
        softSkippedProviders: softSkipped,
      });
      if (next.candidate) return next.candidate;
      if (softSkipped.size === 0) return null;
      softSkipped.clear();
      console.log(`[cascade] provider-skip release (no candidates left) restore=${[...rateLimitHits.entries()].map(([p, n]) => `${p}:${n}`).join(",") || "-"}`);
      // Задача 34: каждая волна skip стартует с чистого порога — после release
      // счётчики rate_limit обнуляются, и повторный skip требует снова
      // rateLimitProviderSkipAfter НОВЫХ 429 от провайдера. Счётчики жёстких
      // kind и auth_error живут в breakers/blockedProviders и не затронуты.
      rateLimitHits.clear();
      return pickNextCandidate({
        candidates: chain, failedCandidate: failed,
        triedKeys: new Set(tried), blockedProviders, familyFailover,
      }).candidate;
    };
    while (tried.length < maxAttempts) {
      if (Date.now() > deadline) {
        // Бюджет исчерпан: дальше не идём (тонкое место (в)).
        this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set.name || null, served_model: null, status: finalStatusForKinds(failedKinds), latency_ms: Date.now() - started, outcome: "all_failed", attempts });
        return {
          ok: false, status: finalStatusForKinds(failedKinds), code: finalErrorCode(failedKinds),
          message: "All routed models failed: total budget exhausted",
          attempts, tried, failedKinds, lastResortUsed: false, budgetExhausted: true, wallMs: Date.now() - started,
        };
      }
      // Кандидат мог быть уже пройден, его провайдер заблокирован auth_error
      // или мягко скипнут по rate_limit (задача 33).
      if (tried.includes(current.key) || blockedProviders.has(current.provider) || softSkipped.has(current.provider)) {
        const skip = selectNext(current);
        if (!skip) break;
        current = skip;
        continue;
      }

      tried.push(current.key);
      const outcome = await this.attempt(current, body, stream, { timeoutMs: this.budgetedTimeout(deadline) });
      attempts.push(this.attemptRecord(current.key, outcome));
      if (outcome.ok) {
        this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set.name || null, served_model: current.key, status: 200, latency_ms: Date.now() - started, outcome: "served", attempts });
        return { ok: true, status: 200, code: "ok", message: "", json: outcome.json, sse: outcome.sse, servedModel: current.key, attempts, tried, failedKinds, lastResortUsed: false, wallMs: Date.now() - started };
      }
      const kind = outcome.verdict?.kind || FAILURE_KINDS.NETWORK;
      failedKinds.push(kind);
      if (outcome.verdict?.blockProvider) blockedProviders.add(current.provider);

      // Задача 33: rate_limit от провайдера N раз в этом запросе → мягкий скип
      // его остальных моделей (per-request, breaker не трогаем). Жёсткие kind
      // (5xx/timeout/network/auth) идут прежним путём — семейный фолбэк.
      if (kind === FAILURE_KINDS.RATE_LIMIT && !pinned) {
        const hits = (rateLimitHits.get(current.provider) || 0) + 1;
        rateLimitHits.set(current.provider, hits);
        if (hits >= rlSkipAfter && !softSkipped.has(current.provider)) {
          softSkipped.add(current.provider);
          console.log(`[cascade] provider-skip rate_limit ${current.provider} after ${hits} (set=${set.name || "?"})`);
        }
      }

      // Двухстадийный фолбэк: та же семья на другом провайдере, иначе по порядку (§2).
      const next = selectNext(current);
      if (!next) break;
      current = next;
    }

    // lastResort: 4 гварда (§7) — не пин, не повтор, не blocked, в бюджете.
    // Плюс тонкое место (г): если ПОСЛЕДНЯЯ неудача — вина клиента, lastResort НЕ
    // включается: тот же запрос упал бы точно так же, маскировать нечего.
    const lastKind = failedKinds[failedKinds.length - 1];
    const clientBlame = lastKind != null && !classifyFailure({ kind: lastKind }).healthDamage
      && !classifyFailure({ kind: lastKind }).blockProvider;
    const lr = parseLastResort(settings.lastResortModel);
    const lrKey = lr ? `${lr.provider}/${lr.model}` : null;
    const lastResortBudget = this.config.router.failover?.requestTimeoutMs ?? 15000;
    if (!pinned && lr && !clientBlame && !tried.includes(lrKey!) && !blockedProviders.has(lr.provider)
        && deadline - Date.now() > Math.min(1000, lastResortBudget)) {
      const resolved = this.resolvePinned(lr.provider, lr.model);
      if (!("error" in resolved)) {
        tried.push(resolved.candidate.key);
        const outcome = await this.attempt(resolved.candidate, body, stream, { timeoutMs: this.budgetedTimeout(deadline) });
        attempts.push(this.attemptRecord(resolved.candidate.key, outcome, true));
        if (outcome.ok) {
          this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set.name || null, served_model: resolved.candidate.key, status: 200, latency_ms: Date.now() - started, outcome: "served", attempts, last_resort_used: true });
          return { ok: true, status: 200, code: "ok", message: "", json: outcome.json, sse: outcome.sse, servedModel: resolved.candidate.key, attempts, tried, failedKinds, lastResortUsed: true, wallMs: Date.now() - started };
        }
        failedKinds.push(outcome.verdict?.kind || FAILURE_KINDS.NETWORK);
      }
    }

    this.recordHistory({ request_id: started.toString(36), at: new Date().toISOString(), set: set.name || null, served_model: null, status: finalStatusForKinds(failedKinds), latency_ms: Date.now() - started, outcome: "all_failed", attempts });
    return {
      ok: false,
      status: finalStatusForKinds(failedKinds),
      code: finalErrorCode(failedKinds),
      message: `All routed models failed for set: ${set.name || "?"}`,
      attempts, tried, failedKinds, lastResortUsed: false, wallMs: Date.now() - started,
    };
  }

  /** Сводка для /stats: счётчики + состояние. */
  routerStats() {
    return {
      requests: this.stats.requests,
      served: this.stats.served,
      failed: this.stats.failed,
      pins: this.stats.pins,
      lastResortUsed: this.stats.lastResort,
      breakers: this.breakers.summary(),
      quota: this.quota.all(),
      probes: this.probeCache.stats(),
      history: this.history.stats(),
    };
  }

  /** Таймаут попытки = min(requestTimeoutMs, остаток бюджета). Защита от выхода за totalBudgetMs. */
  private budgetedTimeout(deadline: number): number {
    const base = this.config.router.failover?.requestTimeoutMs ?? 15000;
    const remaining = deadline - Date.now();
    return Math.max(1, Math.min(base, remaining));
  }

  private attemptRecord(key: string, outcome: ChatOutcome & { verdict?: Verdict }, isLastResort = false): AttemptRecord {
    return {
      model: key, status: outcome.status ?? null, latency_ms: outcome.latencyMs,
      kind: outcome.ok ? "ok" : (outcome.verdict?.kind || FAILURE_KINDS.NETWORK), ok: outcome.ok,
      at: new Date().toISOString(), ...(isLastResort ? { last_resort: true } : {}),
    };
  }
}
