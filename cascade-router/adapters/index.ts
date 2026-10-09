/**
 * cascade-router/adapters/index.ts — адаптеры провайдеров.
 *
 * Собственный код. Base URL / имена заголовков / форма запроса — факты
 * о публичных API провайдеров (не код). Общий контракт OpenAI-совместимых
 * провайдеров покрывает mistral/llm7/openrouter/groq/zai/qwen/orcarouter;
 * cloudflare Workers AI — свой (account_id из settings); google — заглушка
 * (гео-блок, документировано в CORE-SPEC).
 */
import type { RouterConfig } from "../types.ts";

export interface ChatRequest {
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  stream: boolean;
}

export interface ChatOutcome {
  ok: boolean;
  status: number | null;
  /** тело ответа провайдера (для stream=false) */
  json: any | null;
  latencyMs: number;
  error: string | null;
  /** явный failure_kind от провайдера (например content-валидации), иначе null */
  kind?: string;
  /** сырой Retry-After из заголовков ответа */
  retryAfter?: string | null;
  /** rate-limit заголовки для пассивной квоты (SPEC §6, M12) */
  rateLimitHeaders?: Record<string, string>;
  /** поток тела ответа провайдера при stream=true; null — поток не передан */
  sse?: ReadableStream<Uint8Array> | null;
}

export interface ProviderAdapter {
  readonly provider: string;
  readonly kind: "openai-compatible" | "cloudflare-workers-ai" | "geo-blocked-stub";
  readonly supportsStream: boolean;
  chat(req: ChatRequest, apiKey: string, cfg: RouterConfig): Promise<ChatOutcome>;
}

/** Фактические публичные endpoint'ы (истина о мире, не чужой код). */
const OPENAI_BASES: Record<string, string> = {
  mistral: "https://api.mistral.ai/v1",
  llm7: "https://api.llm7.io/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/v1",
  zai: "https://api.z.ai/api/paas/v4",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  orcarouter: "https://api.orcarouter.ai/v1",
};

/** Заголовки пассивной квоты: часть провайдеров отдаёт лимит без 429 (SPEC §6). */
function readRateLimitHeaders(h: Headers): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const k of ["x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-remaining", "x-ratelimit-limit-requests"]) {
    const v = h.get(k);
    if (v != null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly kind = "openai-compatible" as const;
  readonly supportsStream = true;
  constructor(readonly provider: string, private base: string) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatOutcome> {
    const url = `${this.base}/chat/completions`;
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const payload = { ...req.body, model: req.model, stream: req.stream };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const base = {
        ok: res.ok,
        status: res.status,
        latencyMs: Date.now() - started,
        error: res.ok ? null : `HTTP ${res.status}`,
        ...(res.headers.get("retry-after") ? { retryAfter: res.headers.get("retry-after") } : {}),
        ...(readRateLimitHeaders(res.headers) ? { rateLimitHeaders: readRateLimitHeaders(res.headers) } : {}),
      };
      // Стрим отдаётся без буферизации: клиент (opencode) читает SSE инкрементально.
      if (req.stream && res.ok) return { ...base, json: null, sse: res.body };
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { ...base, json };
    } catch (e: any) {
      return { ok: false, status: null, json: null, latencyMs: Date.now() - started, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Cloudflare Workers AI: /accounts/{account_id}/ai/v1 — account_id из settings. */
class CloudflareAdapter implements ProviderAdapter {
  readonly provider = "cloudflare";
  readonly kind = "cloudflare-workers-ai" as const;
  readonly supportsStream = false;

  async chat(req: ChatRequest, apiKey: string, cfg: RouterConfig): Promise<ChatOutcome> {
    const accountId = cfg.settings?.cloudflareAccountId;
    if (!accountId) {
      return { ok: false, status: null, json: null, latencyMs: 0, error: "cloudflareAccountId not configured" };
    }
    // Модели приходят как '@cf/<vendor>/<name>' — Workers AI ждёт путь после /ai/v1/.
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/${req.model}/chat/completions`;
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...req.body, model: undefined, stream: req.stream }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { ok: res.ok, status: res.status, json, latencyMs: Date.now() - started, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, status: null, json: null, latencyMs: Date.now() - started, error: String(e?.message || e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Google AI Studio заглушка: гео-блок (задачи 27/29), не маршрутизируем в этом ядре. */
class GeoBlockedStubAdapter implements ProviderAdapter {
  readonly kind = "geo-blocked-stub" as const;
  readonly supportsStream = false;
  constructor(readonly provider: string, private reason: string) {}

  async chat(): Promise<ChatOutcome> {
    return {
      ok: false, status: 400, json: null, latencyMs: 0,
      error: `${this.provider}: ${this.reason}`,
    };
  }
}

import { MockAdapter } from "./mock.ts";

const registry = new Map<string, ProviderAdapter>();
for (const [p, base] of Object.entries(OPENAI_BASES)) {
  registry.set(p, new OpenAiCompatibleAdapter(p, base));
}
registry.set("cloudflare", new CloudflareAdapter());
registry.set("googleai", new GeoBlockedStubAdapter("googleai", "geo-blocked from this egress (see CORE-SPEC §11)"));
registry.set("google", new GeoBlockedStubAdapter("google", "geo-blocked from this egress (see CORE-SPEC §11)"));
// Mock-провайдер для детерминированного сьюта M1–M17: внешних вызовов нет, квот нет.
registry.set("mock", MockAdapter);

export function getAdapter(provider: string): ProviderAdapter | null {
  const hit = registry.get(provider);
  if (hit) return hit;
  // Mock-алиасы mock1/mock2/... в сьюте: у каждого свой apiKey, чтобы auth_error
  // блокировал только свой «провайдер», как у живых ключей (§3).
  if (provider.startsWith("mock") && provider !== "mock") return MockAdapter;
  return null;
}

export function knownProviders(): string[] {
  return [...registry.keys()];
}
