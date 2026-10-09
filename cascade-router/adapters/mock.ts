/**
 * cascade-router/adapters/mock.ts — детерминированный mock-провайдер.
 *
 * Собственный код. Поведение задаётся ИМЕНЕМ МОДЕЛИ (никаких внешних вызовов,
 * ноль квот, полная воспроизводимость):
 *   ok-fast            → 200 быстро
 *   ok-slow            → 200 после задержки (для проверки таймаутов)
 *   fail-429           → 429 + Retry-After: 2
 *   fail-429-long      → 429 + Retry-After: 3600 (длинная пауза)
 *   fail-429-passive   → 400/500 c rate-limit заголовками (remaining=0) БЕЗ 429
 *   fail-500           → 500
 *   fail-400           → 400 (вина клиента)
 *   fail-413           → 413 (вина клиента)
 *   fail-auth          → 401
 *   fail-forbidden     → 403
 *   fail-timeout       → молчит дольше requestTimeoutMs
 *   fail-garbage       → 200 с мусором (нет choices) → empty_choices
 *   fail-network       → обрыв соединения
 *   lastresort-ok      → 200 (для lastResort-проверок)
 *   lasstresort-fail   → 500 (lastResort сам падает → не ретраится)
 *
 * Счётчики попыток: /mock/stats в mock-инстансе (для ассертов M-сьюта).
 */
import type { ProviderAdapter, ChatRequest, ChatOutcome } from "./index.ts";

const okBody = (model: string) => ({
  id: `mock-${Date.now()}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
});

const errBody = (msg: string, code: string) => ({ error: { message: msg, type: "invalid_request_error", code } });

/** Счётчики по моделям — чтобы сьют проверял «сколько раз пробовали». */
export const mockCounters = new Map<string, number>();
export function mockResetCounters(): void {
  mockCounters.clear();
}

export const MockAdapter: ProviderAdapter = {
  provider: "mock",
  kind: "openai-compatible",
  supportsStream: true,

  async chat(req: ChatRequest): Promise<ChatOutcome> {
    const model = req.model;
    mockCounters.set(model, (mockCounters.get(model) || 0) + 1);
    const started = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const done = (o: Partial<ChatOutcome>): ChatOutcome => ({
      ok: false, status: null, json: null, latencyMs: Date.now() - started, error: null, ...o,
    } as ChatOutcome);

    switch (model) {
      case "ok-fast":
      case "lastresort-ok":
        return done({ ok: true, status: 200, json: okBody(model) });

      case "ok-slow":
        await sleep(Math.min(req.timeoutMs - 50, 800));
        return done({ ok: true, status: 200, json: okBody(model) });

      case "fail-429":
      case "fail-429-c": // M22: вторая волна skip в том же провайдере после release.
      case "fail-429-d": // M22: третья/четвёртая 429-кандидатура для волны с чистого порога.
        return done({ status: 429, json: errBody("rate limited", "rate_limit_exceeded"), error: "HTTP 429", retryAfter: "2" });

      case "fail-429-long":
        return done({ status: 429, json: errBody("rate limited", "rate_limit_exceeded"), error: "HTTP 429", retryAfter: "3600" });

      // 400/500 с rate-limit заголовками, remaining=0 → пассивная пауза (M12).
      case "fail-429-passive":
        return done({
          status: 500, json: errBody("upstream hiccup", "server_error"), error: "HTTP 500",
          rateLimitHeaders: { "x-ratelimit-remaining": "0", "x-ratelimit-limit": "100" },
        });

      case "fail-500":
        return done({ status: 500, json: errBody("boom", "server_error"), error: "HTTP 500" });

      case "fail-400":
        return done({ status: 400, json: errBody("bad request", "invalid_request"), error: "HTTP 400" });

      case "fail-413":
        return done({ status: 413, json: errBody("too large", "payload_too_large"), error: "HTTP 413" });

      case "fail-auth":
        return done({ status: 401, json: errBody("invalid api key", "invalid_api_key"), error: "HTTP 401" });

      case "fail-forbidden":
        return done({ status: 403, json: errBody("forbidden", "invalid_api_key"), error: "HTTP 403" });

      case "fail-timeout":
        await sleep(req.timeoutMs + 1500); // гарантированно дольше таймаута
        return done({ status: null, error: "timeout" });

      case "fail-garbage":
        // HTTP 200 без choices → kind empty_choices (§3: мусор = настоящий провал).
        return done({ ok: false, status: 200, json: { id: "mock-garbage", object: "chat.completion", model }, error: "empty_choices", kind: "empty_choices" });

      case "fail-network":
        return done({ status: null, error: "ECONNREFUSED mock" });

      case "lastresort-fail":
        return done({ status: 500, json: errBody("last resort down", "server_error"), error: "HTTP 500" });

      default:
        // Неизвестная mock-модель: 404 (вина клиента по классификации §3).
        return done({ status: 404, json: errBody(`unknown mock model: ${model}`, "model_not_found"), error: "HTTP 404" });
    }
  },
};
