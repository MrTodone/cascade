/**
 * cascade-router/state/family.ts — семейство модели по имени.
 * Собственный код: сигнатуры идентификаторов моделей публичных провайдеров
 * (факт о мире), чтобы предпочитать фолбэк внутри той же семьи (§2).
 */

const FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/qwen3?[-.]?coder|qwq/i, "qwen-coder"],
  [/qwen/i, "qwen"],
  [/codestral/i, "codestral"],
  [/ministral|mistral[-.]?small/i, "ministral"],
  [/mistral/i, "mistral"],
  [/glm/i, "glm"],
  [/gpt-oss|openai/i, "gpt"],
  [/nemotron/i, "nemotron"],
  [/llama/i, "llama"],
  [/minimax/i, "minimax"],
  [/grok/i, "grok"],
  [/deepseek/i, "deepseek"],
  [/gemini/i, "gemini"],
  [/phi/i, "phi"],
  [/hermes/i, "hermes"],
  [/olmo/i, "olmo"],
  [/exaone/i, "exaone"],
  [/kimi/i, "kimi"],
  [/seed|umi/i, "seed"],
];

export function modelFamily(modelId: string): string {
  for (const [re, family] of FAMILY_PATTERNS) {
    if (re.test(modelId)) return family;
  }
  return "unknown";
}

/**
 * Выбор следующего кандидата (§2, двухстадийный фолбэк):
 * 1) здоровая модель ТОЙ ЖЕ семьи на другом провайдере (если familyFailover включён);
 * 2) иначе — следующий по исходному порядку каскада.
 *
 * softSkippedProviders — мягкий per-request скип (задача 33): провайдеры, от
 * которых в этом запросе уже набралось rateLimitProviderSkipAfter вердиктов
 * rate_limit. Отличие от blockedProviders: жёсткий auth-блок живёт в breaker,
 * мягкий — только на время подбора кандидатов текущего запроса. Если после
 * скипа не осталось ничего, вызывающий снимает скип (лучше попытка, чем 503).
 */
export function pickNextCandidate<T extends { provider: string; model: string; key: string; family: string }>({
  candidates,
  failedCandidate,
  triedKeys,
  blockedProviders,
  familyFailover,
  softSkippedProviders,
}: {
  candidates: T[];
  failedCandidate: T;
  triedKeys: Set<string>;
  blockedProviders: Set<string>;
  familyFailover: boolean;
  softSkippedProviders?: ReadonlySet<string>;
}): { candidate: T | null; reason: "family_failover" | "order" | null } {
  const soft = softSkippedProviders;
  const usable = candidates.filter((c) => !triedKeys.has(c.key)
    && !blockedProviders.has(c.provider)
    && !(soft?.size ? soft.has(c.provider) : false));
  if (usable.length === 0) return { candidate: null, reason: null };

  if (familyFailover && failedCandidate.family !== "unknown") {
    const sameFamily = usable.find((c) => c.family === failedCandidate.family);
    if (sameFamily) return { candidate: sameFamily, reason: "family_failover" };
  }
  return { candidate: usable[0], reason: "order" };
}
