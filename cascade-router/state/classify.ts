/**
 * cascade-router/state/classify.ts — классификатор отказов и вердикты.
 * Собственный код; поведение — CORE-SPEC §3 (таблица kind → политика).
 */

export const FAILURE_KINDS = {
  AUTH: "auth_error",
  RATE_LIMIT: "rate_limit",
  QUOTA: "quota_exhausted",
  TIMEOUT: "timeout",
  NETWORK: "network_error",
  SERVER: "provider_server_error",
  OVERLOADED: "model_overloaded",
  INVALID_REQUEST: "invalid_request",
  INVALID_JSON: "invalid_json",
  EMPTY_CHOICES: "empty_choices",
  EMPTY_CONTENT: "empty_content",
  ERROR_PAYLOAD: "error_payload",
  HTML: "html_maintenance",
  EMPTY_STREAM: "empty_stream",
  STREAM_STALL: "stream_stall",
  PROVIDER_URL: "provider_url_unresolvable",
} as const;

export type FailureKind = (typeof FAILURE_KINDS)[keyof typeof FAILURE_KINDS];

export interface Verdict {
  kind: FailureKind;
  blame: "provider" | "model" | "client";
  failover: boolean;
  healthDamage: boolean;
  blockProvider: boolean;
  quotaPauseMs: number | null;
  clientStatus: number;
}

export const MAX_QUOTA_PAUSE_MS = 15 * 60 * 1000;

/** HTTP-статус → грубый kind (§3). 529 — нестандартный «Overloaded», модельный. */
const STATUS_KIND: Record<number, FailureKind> = {
  401: FAILURE_KINDS.AUTH,
  403: FAILURE_KINDS.AUTH,
  408: FAILURE_KINDS.TIMEOUT,
  429: FAILURE_KINDS.RATE_LIMIT,
  500: FAILURE_KINDS.SERVER,
  502: FAILURE_KINDS.SERVER,
  503: FAILURE_KINDS.SERVER,
  504: FAILURE_KINDS.SERVER,
  529: FAILURE_KINDS.OVERLOADED,
};

export function classifyStatus(status: number): FailureKind {
  const mapped = STATUS_KIND[status];
  if (mapped) return mapped;
  if (status >= 500) return FAILURE_KINDS.SERVER;
  if (status >= 400) return FAILURE_KINDS.INVALID_REQUEST;
  return FAILURE_KINDS.NETWORK;
}

/** Retry-After: секунды или HTTP-date → мс; null если нечитаемо. */
export function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

export function classifyFailure({
  kind = null,
  status = null,
  retryAfterMs = null,
}: { kind?: FailureKind | null; status?: number | null; retryAfterMs?: number | null } = {}): Verdict {
  const resolved: FailureKind = kind || (status != null ? classifyStatus(status) : FAILURE_KINDS.NETWORK);

  switch (resolved) {
    // Мёртвый ключ: фолбэк ДА, блокировка провайдера ДА, здоровье модели НЕ страдает.
    case FAILURE_KINDS.AUTH:
      return { kind: resolved, blame: "provider", failover: true, healthDamage: false, blockProvider: true, quotaPauseMs: null, clientStatus: 401 };

    // Rate limit: пауза THIS-модели на окно Retry-After (cap 15 мин), здоровье страдает.
    case FAILURE_KINDS.RATE_LIMIT:
    case FAILURE_KINDS.QUOTA: {
      const pauseMs = retryAfterMs != null ? Math.min(Math.max(0, retryAfterMs), MAX_QUOTA_PAUSE_MS) : null;
      return { kind: resolved, blame: "model", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: pauseMs, clientStatus: 429 };
    }

    // 400/404/413/422: виноват КЛИЕНТ. Фолбэк продолжается, breaker НЕ трогаем.
    case FAILURE_KINDS.INVALID_REQUEST:
      return { kind: resolved, blame: "client", failover: true, healthDamage: false, blockProvider: false, quotaPauseMs: null, clientStatus: status || 400 };

    // 529 — перегрузка модели, не провайдера.
    case FAILURE_KINDS.OVERLOADED:
      return { kind: resolved, blame: "model", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: null, clientStatus: 529 };

    case FAILURE_KINDS.TIMEOUT:
    case FAILURE_KINDS.STREAM_STALL:
      return { kind: resolved, blame: "provider", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: null, clientStatus: 504 };

    case FAILURE_KINDS.NETWORK:
    case FAILURE_KINDS.SERVER:
    case FAILURE_KINDS.PROVIDER_URL:
      return { kind: resolved, blame: "provider", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: null, clientStatus: 502 };

    case FAILURE_KINDS.HTML:
      return { kind: resolved, blame: "provider", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: null, clientStatus: 503 };

    // «HTTP 200 но мусор»: фолбэк ОБЯЗАТЕЛЕН и это настоящий провал.
    case FAILURE_KINDS.INVALID_JSON:
    case FAILURE_KINDS.EMPTY_CHOICES:
    case FAILURE_KINDS.EMPTY_CONTENT:
    case FAILURE_KINDS.ERROR_PAYLOAD:
    case FAILURE_KINDS.EMPTY_STREAM:
    default:
      return { kind: resolved, blame: "provider", failover: true, healthDamage: true, blockProvider: false, quotaPauseMs: null, clientStatus: 502 };
  }
}

/** Финальный клиентский код: одинаковые kind → код этого kind, иначе 503 (§3). */
export function clientStatusForKind(kind: FailureKind): number {
  return classifyFailure({ kind }).clientStatus;
}

export function finalStatusForKinds(kinds: FailureKind[]): number {
  if (kinds.length === 0) return 503;
  const allSame = kinds.every((k) => k === kinds[0]);
  return allSame ? clientStatusForKind(kinds[0]) : 503;
}

/** Клиентский code в all_models_failed (совместимость с OpenAI-конвенцией). */
export function finalErrorCode(kinds: FailureKind[]): string {
  if (kinds.length === 0) return "all_models_failed";
  const allSame = kinds.every((k) => k === kinds[0]);
  if (!allSame) return "all_models_failed";
  if (kinds[0] === FAILURE_KINDS.RATE_LIMIT || kinds[0] === FAILURE_KINDS.QUOTA) return "insufficient_quota";
  if (kinds[0] === FAILURE_KINDS.AUTH) return "invalid_api_key";
  return kinds[0];
}
