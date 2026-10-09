#!/usr/bin/env node
/**
 * scripts/catalog-bootstrap.mjs — нативный каталог cascade-router.
 *
 * ИСТОЧНИКИ (provenance на каждую запись):
 *   1) live-api — живой GET списочного эндпоинта провайдера (ключ из
 *      cascade-router/dev-config.json). Списочные GET не жгут квоту.
 *   2) verified — наша верификация: backups/task4/artifacts/* (задачи 4/15),
 *      upstream/live-verification.md.
 *   3) config-set — пары из активного сета dev-конфига, для которых нет
 *      ни живого списка, ни верификации (честная пометка, не выдумка).
 * sources.js старого пакета НЕ используется.
 *
 * СКОРЫ/ТИРЫ — наша эвристика (правила описаны ниже), не данные провайдеров.
 *
 * Запуск: node scripts/catalog-bootstrap.mjs [--out cascade-router/catalog.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 ? process.argv[i + 1] : join(ROOT, "cascade-router", "catalog.json");
})();

const devCfg = JSON.parse(readFileSync(join(ROOT, "cascade-router", "dev-config.json"), "utf8"));
const apiKeys = devCfg.apiKeys || {};
const setModels = devCfg.router?.sets?.[devCfg.router.activeSet]?.models || [];

// ── Списочные эндпоинты провайдеров (факты о публичных API) ─────────────────
const LIST_ENDPOINTS = {
  mistral: { url: "https://api.mistral.ai/v1/models", auth: "bearer" },
  openrouter: { url: "https://openrouter.ai/api/v1/models", auth: "bearer" },
  groq: { url: "https://api.groq.com/v1/models", auth: "bearer" },
  qwen: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", auth: "bearer" },
  zai: { url: "https://api.z.ai/api/paas/v4/models", auth: "bearer" },
  llm7: { url: "https://api.llm7.io/v1/models", auth: "bearer" },
  orcarouter: { url: "https://api.orcarouter.ai/v1/models", auth: "bearer" },
};

const live = {};      // provider -> [modelId]
const liveErrors = {};

async function fetchLive(provider) {
  const ep = LIST_ENDPOINTS[provider];
  if (!ep) return;
  if (!apiKeys[provider]) {
    liveErrors[provider] = "no key in dev-config";
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(ep.url, {
      headers: { Authorization: `Bearer ${apiKeys[provider]}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      liveErrors[provider] = `HTTP ${res.status}`;
      return;
    }
    const body = await res.json();
    const ids = (Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [])
      .map((m) => (typeof m === "string" ? m : m?.id))
      .filter((id) => typeof id === "string" && id.length > 0);
    live[provider] = [...new Set(ids)];
  } catch (e) {
    liveErrors[provider] = String(e?.message || e).slice(0, 80);
  }
}

// ── Верифицированные данные ────────────────────────────────────────────────
function loadVerified() {
  const verified = [];
  const read = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

  // Задача 4: полный проверенный сет 60 пар (order = priority).
  const set60 = read(join(ROOT, "backups/task4/artifacts/fast-coding-models.json"));
  if (Array.isArray(set60)) {
    for (const m of set60) {
      verified.push({ ...m, provenance: "verified-2026-09", note: "задача 4: проверенный сет fast-coding (60 пар)" });
    }
  }
  // Задача 15/upstream: статусы mistral-моделей (live-verification.md — текст;
  // машинный дубль — задача 4 артефакт mistral-live.json = живой /v1/models).
  const mistralLive = read(join(ROOT, "backups/task4/artifacts/mistral-live.json"));
  if (mistralLive?.data) {
    for (const m of mistralLive.data) {
      verified.push({
        provider: "mistral", model: m.id, provenance: "verified-2026-09",
        note: `задача 4/15: живой /v1/models, chat-capable=${m.capabilities?.completion_chat ?? "?"}`,
      });
    }
  }
  // Задача 4: cloudflare — живой ответ Workers AI (cf-direct.json) подтверждает @cf/openai/gpt-oss-120b.
  const cfLive = read(join(ROOT, "backups/task4/artifacts/cf-direct.json"));
  if (cfLive?.model) {
    verified.push({
      provider: "cloudflare", model: cfLive.model, provenance: "verified-2026-09",
      note: "задача 4: живой ответ Workers AI 200",
    });
  }
  // Задача 27: googleai — гео-блок; живые id из upstream/live-verification.md не тянутся.
  verified.push({ provider: "googleai", model: "gemini-3.6-flash", provenance: "verified-2026-09", note: "задача 27: живой id, но гео-блок с нашего egress" });
  verified.push({ provider: "googleai", model: "gemini-2.0-flash", provenance: "verified-2026-09", note: "задача 27: id каталога фасада, в API мёртв (404)" });
  return verified;
}

// ── Эвристика скоров/тиров (наша; правила) ────────────────────────────────
// tier:  S = кодерские/флагманные (роль coder — главная), A = сильные general,
//        B = эконом/малые.  score 0..1 — для tie-break, приоритет не смешиваем.
// Правила (детерминированные):
//   tier S: имя содержит code/coder/codestral/starcoder/glm/qwen3-coder/gpt-oss/minimax-m2/nemotron-code
//   tier A: большие general (70b+) и reasoning-семейства
//   tier B: mini/small/flash-lite/8b/4b
//   score: 0.5 база; +0.2 coder; +0.1 context>=100k; +0.05 tier S; -0.1 tier B.
function heuristic(provider, model) {
  const m = model.toLowerCase();
  const isCoder = /codestral|code-latest|coder|code\b|gpt-oss|qwen3-coder|minimax-m2|nemotron-3|nemotron-code/.test(m)
    && !/code-interpreter/.test(m);
  const isSmall = /mini|small|lite|8b|4b|3b|nano|haiku|flash-lite/.test(m);
  const ctx = contextGuess(m);
  let tier = "A";
  if (isCoder) tier = "S";
  else if (isSmall) tier = "B";
  let score = 0.5;
  if (isCoder) score += 0.2;
  if (ctx && ctx >= 100000) score += 0.1;
  if (tier === "S") score += 0.05;
  if (tier === "B") score -= 0.1;
  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return { tier, score, context: ctx };
}

function contextGuess(m) {
  if (/gpt-oss|qwen3|glm-4|minimax-m2|nemotron-3|llama-?4/.test(m)) return 131072;
  if (/codestral|ministral-3|ministral-3b/.test(m)) return 32768;
  if (/qwen.*(flash|7b)|llama-?3/.test(m)) return 8192;
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────
const verified = loadVerified();
for (const provider of Object.keys(LIST_ENDPOINTS)) await fetchLive(provider);

const byKey = new Map();
const setOf = (provider, model, entry) => {
  const key = `${provider}/${model}`;
  const prev = byKey.get(key);
  // Приоритет источников: live-api > verified > config-set.
  const rank = { "live-api": 3, "verified-2026-09": 2, "config-set": 1 };
  if (!prev || rank[entry.provenance] > rank[prev.provenance]) byKey.set(key, entry);
  else if (prev.provenance === entry.provenance) prev.mergedFrom = [...new Set([...(prev.mergedFrom || []), entry.provenance])];
};

for (const [provider, ids] of Object.entries(live)) {
  for (const model of ids) {
    const h = heuristic(provider, model);
    setOf(provider, model, { provider, model, ...h, provenance: "live-api", note: `GET ${LIST_ENDPOINTS[provider].url}` });
  }
}
for (const v of verified) {
  const h = heuristic(v.provider, v.model);
  setOf(v.provider, v.model, { provider: v.provider, model: v.model, ...h, provenance: v.provenance, note: v.note });
}
for (const m of setModels) {
  const key = `${m.provider}/${m.model}`;
  if (byKey.has(key)) continue;
  const h = heuristic(m.provider, m.model);
  setOf(m.provider, m.model, {
    provider: m.provider, model: m.model, ...h, provenance: "config-set",
    note: "пара из активного сета; ни живой список, ни верификация",
  });
}

const models = [...byKey.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
const byProvenance = models.reduce((acc, m) => { acc[m.provenance] = (acc[m.provenance] || 0) + 1; return acc; }, {});

const out = {
  $comment: "cascade-router native catalog. Generated by scripts/catalog-bootstrap.mjs from LIVE provider APIs + our own verification (tasks 4/15/27). sources.js NOT used. Scores/tiers = our heuristic (see script), not provider data.",
  generatedAt: new Date().toISOString(),
  generator: "scripts/catalog-bootstrap.mjs",
  sources: {
    live: Object.fromEntries(Object.entries(LIST_ENDPOINTS).map(([p, e]) => [p, { url: e.url, ok: Boolean(live[p]), count: live[p]?.length || 0, error: liveErrors[p] || null }])),
    verifiedFiles: [
      "backups/task4/artifacts/fast-coding-models.json",
      "backups/task4/artifacts/mistral-live.json",
      "backups/task4/artifacts/cf-direct.json",
      "upstream/live-verification.md",
    ],
  },
  byProvenance,
  models,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`catalog: ${models.length} записей → ${OUT}`);
console.log(`provenance: ${JSON.stringify(byProvenance)}`);
for (const [p, s] of Object.entries(out.sources.live)) {
  console.log(`  live ${p}: ${s.ok ? `${s.count} моделей` : `ошибка ${s.error}`}`);
}
