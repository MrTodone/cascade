# CORE-SPEC: cascade-router — поведенческая спецификация собственного ядра

Введение
- cascade-router — собственное ядро (clean-room). Производная НЕ от внешней библиотеки (чистый рерайт, не форк). Допустимы ТОЛЬКО фактические константы (базовые URL, id моделей, имена заголовков, схемы API провайдеров — факты, не авторство).
- Разработа параллельно на :19081. Старый роутер :19080 живёт весь этап 2 (до этапа 3 переключения).
- Конфиг dev: cascade-router/dev-config.json (копия cascade-run/router/config.json). Состояние: ~/.cascade-router-dev/ (tokens.json, history.json, breakers.json, log). Порт 127.0.0.1:19081.

1. ID-моделей и парсинг
- Формы ядра: `cascade`, `cascade:<set>`, `cascade:@provider/model`. Короткий алиас снят 2026-09-29 (задача 31): любая другая форма → unknown-путь, без принятия запроса.
- Строгий пин: `cascade:@provider/model` — без каскада, failover отключён (1 попытка). Если candidate не резолвится (unknown/нет ключа/не routeable) → HTTP 400 (invalid_model), не каскадит.
- set: `cascade:<set>`. default/пустой → активный сет.
- unknown (любая форма кроме `cascade*`) — ОСОЗНАННОЕ ОТЛИЧИЕ #1 (см. п.11): старое ядро молча каскадило через активный сет (getSet(null)); новое ядро → явная ошибка 400 (invalid_model) на :19080 либо 404 `model_not_found` на фасаде :3000. Фасад — привратник, роутер не подменяет молча.

2. Резолв сета/кандидатов и порядок каскада
- getSet(name): sets[name] || (name отсутствует → activeSet). Нет сета → 404 set_not_found.
- listSetModels: сортировка по priority (asc).
- getRoutingCandidates(set): отбор usable (skip: quota_paused; circuit state вне {CLOSED, DEGRADED, HALF_OPEN}); сортировка comparator: (1) priority asc авторитетно; (2) circuit state порядок CLOSED(0) < DEGRADED(1) < HALF_OPEN(2); (3) score desc.
- Строгий пин: candidate = [resolvedPinned] только; обходит breaker skip (намеренно, чтобы пин давал живой attempt), но уважает catalog + наличие ключа.
- resolvePinnedCandidate: нет в catalog → error Unknown model; не routeable → Provider is not routeable; нет ключа → No API key configured. Всё → 400 invalid_model.

3. failover-триггеры и failure_kinds
- Классификатор: HTTP status → kind; kind → verdict{kind, blame, failover, healthDamage, blockProvider, quotaPauseMs, clientStatus}.
- STATUS_KIND_MAP (факт): 401,403→auth_error; 408→timeout; 429→rate_limit; 500,502,503,504→provider_server_error; 529→model_overloaded. Прочие: >=500→provider_server_error, >=400→invalid_request, иначе network_error.
- FAILURE_KINDS: auth_error, rate_limit, quota_exhausted, timeout, network_error, provider_server_error, model_overloaded, invalid_request, invalid_json, empty_choices, empty_content, error_payload, html_maintenance, empty_stream, stream_stall, provider_url_unresolvable.
- auth_error: blame=provider, failover=true, healthDamage=false, blockProvider=true, clientStatus=401. Ключ плохой — модель цела, breaker не растравливаем (authError sticky-флаг).
- rate_limit/quota_exhausted: blame=model, healthDamage=true, quotaPauseMs=clamp(retry-after, 0..15min) (null если нет retry-after), clientStatus=429.
- invalid_request: blame=client, failover=true, healthDamage=false, clientStatus=status||400 (400/404/413/422).
- model_overloaded(529): healthDamage=true, clientStatus=529. timeout/stream_stall: healthDamage, clientStatus=504. network/server/provider_url: healthDamage, 502. html_maintenance: healthDamage, 503. Семейство "HTTP 200 но мусор" (invalid_json, empty_choices, empty_content, error_payload, empty_stream): healthDamage=true, 502. default: healthDamage, 502.
- Максимум попыток: pinned→1, иначе min(1+failover.maxRetries, failover.maxAttemptsCap ?? 8) (MAX_ATTEMPTS_CAP=8, конфиг-поле failover.maxAttemptsCap, дефолт 8). Бюджет времени: deadline = now + totalBudgetMs; при превышении — warn и all_failed. В потолок входят только кандидаты каскада; lastResort — сверх него (одна попытка).
- Двухстадийный failover: после неудачи предпочитает здоровую модель ТОЙ ЖЕ СЕМЬИ на другом провайдере (familyFailover, если set.familyFailover !== false), иначе следующий по порядку. blockedProviders не повторяются в рамках запроса.
- Rate-limit-aware пропуск провайдера (мягкий, только в рамках одного запроса): kind=rate_limit от провайдера, накопивший >= failover.rateLimitProviderSkipAfter (дефолт 2) РАЗ в этом запросе, исключает ОСТАЛЬНЫЕ модели этого провайдера из дальнейшего подбора. Breaker не трогается, blockedProviders (auth_error) не меняется, счётчик и skip живут только внутри route(). Первое срабатывание логируется одной строкой: `[cascade] provider-skip rate_limit <provider> after N`. Жёсткие kind (5xx/timeout/network/auth) пропуск не включают — только семейный фолбэк. Если после skip кандидатов не осталось — skip снимается и подбор повторяется (лучше лишняя попытка, чем 503 при живых моделях; лог `provider-skip release`); при release счётчики rate_limit этого запроса обнуляются, поэтому каждая следующая волна skip требует снова `rateLimitProviderSkipAfter` НОВЫХ rate_limit от провайдера (счётчики жёстких kind и auth_error не сбрасываются — они живут в breakers/blockedProviders).

4. circuit breaker
- Состояния: CLOSED / DEGRADED / OPEN / HALF_OPEN + флаги authError / stale / unsupported (STALE, UNSUPPORTED — отображаемый слой поверх state).
- Пороги (прод-конфиг): failureThreshold=2, initialCooldownMs=10000, maxCooldownMs=60000, backoffMultiplier=2. Умолчания ядра при отсутствии: threshold=3, initial=30000, max=300000, backoff=2.
- DEGRADED при consecutiveFailures >= max(1, ceil(threshold*0.6)).
- OPEN при state==HALF_OPEN при провале или consecutiveFailures >= threshold. openedAt=t, tripCount++ (выживает успех). cooldownMs = min(max, max(initial, initial*backoff^(tripCount-1))), escalation cap = 16x (min(tripCount-1, 4)).
- evaluate (лениво): OPEN → HALF_OPEN когда elapsed >= cooldownMs. Успех (markSuccess) → полный сброс CLOSED/0/initial cooldown, сбрасывает authError, quota pause; tripCount сохраняется.
- authError: sticky-флаг, breaker НЕ открывается (конфиг, не здоровье). Снимается успехом.
- Персист: breakers.json в stateDir, переживает рестарт.

5. probeCache (hide/unhide, TTL)
- Персист-кеш probe-результатов (provider/modelId → status ok/broken, lastLatency, lastError).
- hide: модель в autoHideBrokenModels-режиме скрывается при broken. unhide при ok. TTL записи: STALE по probeCacheStats; агрегаты в /stats.probeCache.
- В этапе 1 скелет — интерфейс; реализация этап 2.

6. quota pause
- recordQuotaPause(key, pauseMs|DEFAULT_QUOTA_PAUSE_MS=60000, status, meta). until = now+pauseMs; retry_after_ms = pauseMs; rate_limit_headers; last_seen ISO. Держит quotaExhausted + quotaDetails.
- Активируется по verdict (rate_limit/quota_exhausted с quotaPauseMs>0, или meta.quotaExhausted). При успехе пауза снимается.
- В /stats: quotaPauses[] c retry_after_ms; /health: quotaPauses[].until ISO.
- TTL: до expires; по истечении автоматически удаляется при чтении (quotaPauseActive).

7. lastResort
- lastResortModel в failover (строка "provider/model" — прод: "cloudflare/@cf/openai/gpt-oss-120b"). Escape hatch: ОДНА финальная попытка вне ротации, когда все кандидаты упали.
- GUARD (строго): не для пин-ов (только !pinned), не повторять tried, не если провайдер blocked, только пока Date.now() <= deadline.
- /stats: failover.lastResortModel; /health: lastResort (ключ).

8. autoHeal
- Замена в сете ТОЛЬКО BROKEN-моделей (authError/stale/unsupported по catalog). Здоровые не трогаются. Приоритеты сохраняются (тот же priority у замены; порядок каскада сохраняется).
- userCustomized: если true — автозамена не применяется.
- Метрика: brokenModelCount в /health = count моделей сета с broken-флагом.

9. HTTP-API ядра (что реально потребляют фасад + regression.mjs)
- GET /health → statusPayload: { ok, running, version, pid, port, enabled, activeSet, activeModelCount, setCount, uptimeSeconds, requestsRouted, autoHeal, userCustomized, brokenModelCount, inFlight, shuttingDown, probeMode, lastProbeAt, crashRecovered, configPath, tokenStatsPath, logPath, router:'v2', failover{maxRetries,requestTimeoutMs,bodyReadTimeoutMs,totalBudgetMs,contentValidation,lastResortModel,rateLimitProviderSkipAfter,maxAttemptsCap}, modelStates{CLOSED,DEGRADED,OPEN,HALF_OPEN,AUTH_ERROR,QUOTA_PAUSED}, quotaPauses[], history, probeCache, quota, runtimeTelemetry{stats,models} }.
- GET /stats → statsPayload = statusPayload + { tokens, models[ getModelHealth: {provider,model,key,priority,state,score,last_latency_ms,uptime,last_error,quota_paused_until,isBenchmarking,benchmark} ], routingOrder[{key,provider,model,priority,state,score}], globalBenchmark{running,total,completed}, requestLog (последние 20), breakers (персист snapshot), traces, activeRequests, circuitBreakers{key:{state,consecutiveFailures,cooldownMs,openedAt,lastError}} }.
- GET /stats/runtime → { ok, stats, models }.
- GET /stats/tokens, /stats/tokens/daily/:date → token summary.
- GET /v1/models (без токена) → { data: [{id:'cascade'},{id:'cascade:fast-coding'}, …60 сетевых] } — id форм.
- POST /v1/chat/completions (+ /v1/messages Anthropic-совместимый) — основной трафик.
- Sets CRUD: GET /sets → { activeSet, sets }; POST /sets (создать/обновить, 201); PUT /sets/:name; DELETE /sets/:name; POST /sets/:name/sync → syncSet.
- Авторизация: опциональный shared token (CASCADE_ROUTER_TOKEN) на /v1/*; в проде не задан — /v1/* открыт локально.
- DNS-rebinding guard (T16, `hostAllowed()` в server.ts): Host должен быть loopback — 127.0.0.1/localhost/::1; иначе 403 (error type `forbidden`). Без проверки только `/health`.
- Фасад читает: /stats → activeSet, modelCount(=models.length), autoHeal, lastResort(=failover.lastResortModel), models[].{key,state,priority,score,quota_paused_until,last_error}. Регрессия читает: /health → activeSet/activeModelCount/brokenModelCount/autoHeal; /stats → models[].state (для 'broken'/'ok'/'degraded'), circuitBreakers. Именно эти поля — контракт совместимости.

10. Схема config.json (наша, совместимая — прод-конфиг читается новым ядром без изменений)
- TOP: apiKeys{provider:key}, providers{}, settings{hideUnconfiguredModels,favoritesPinnedAndSticky,runAiSpeedTestOnStartup,autoHideBrokenModels,theme,cloudflareAccountId}, favorites, telemetry, sync, updater, endpointInstalls, hiddenModels, router{}.
- router: enabled, onboardingSeen, autoStartOnBoot, port, activeSet, sets{name:{name, models[{provider,model,priority}], created, familyFailover}}, probeMode, probeIntervals, circuitBreaker{failureThreshold,initialCooldownMs,maxCooldownMs,backoffMultiplier}, failover{ maxRetries, streamStallTimeoutMs, requestTimeoutMs, lastResortModel, bodyReadTimeoutMs, totalBudgetMs, contentValidation, rateLimitProviderSkipAfter, maxAttemptsCap }, scoring{latencyWeight,uptimeWeight,priorityWeight}, logLevel, prePrompt, autoHeal, userCustomized.
- Прод-конкретика: sets.fast-coding: 60 моделей (llm7,groq,mistral,openrouter,qwen,cloudflare), priority 1..N; failover.maxRetries=20 (эффективно cap 8), rateLimitProviderSkipAfter=2, maxAttemptsCap=8, totalBudgetMs=120000 (дефолт), lastResortModel="cloudflare/@cf/openai/gpt-oss-120b".
- Ключевое требование: v2-поля failover (bodyReadTimeoutMs, totalBudgetMs, contentValidation) нативно сохраняются при save/load — ОСОЗНАННОЕ ОТЛИЧИЕ #2 (старый normalizer их терял; чинили PR2).
- Атомарность записи: temp+rename; v2-поля не теряются round-trip.

11. Три осознанных отличия нового ядра
- #1 unknown id → явная ошибка (400 invalid_model), а не молчаливый каскад через getSet(null). Роутер больше не подменяет молча; фасад — привратник. (См. п.1.)
- #2 v2-поля failover выживают save/load нативно (атомарная запись, никакого v1-normalizer). Баг старого ядра устранён by design.
- #3 Тело запроса >10MB → честный HTTP 413 (payload_too_large) вместо destroy/ECONNRESET. Потребитель получает диагностируемый код.
- #4 DNS-rebinding guard: чужой Host-заголовок → 403 (старый ядро принимал любой Host; /health оставлен открытым для мониторинга).

12. Таблица «поведение → как проверяется»
| # | Поведение | Проверка |
|---|-----------|----------|
| 1 | ID: cascade/cascade:*/cascade:@ | T03 (строгий пин), T04 (cascade:@ →400) |
| 2 | Строгий пин: 1 попытка, без каскада, 400 при !resolve | T03 (200, исполнитель строго целевой), T04 |
| 3 | unknown → 400 explicit | T05 |
| 4 | set-чтение: /sets activeSet совпадает с /health | T06 |
| 5 | Каскад priority-first, stateOrder, score | T07 (/stats routingOrder[0]=min priority среди CLOSED) |
| 6 | failover.maxAttempts = min(1+maxRetries,6) | T08 (write) + M14 мок-сьюта (кандидатов ≤4, lastResort 5-й) |
| 7 | failure_kinds в all_models_failed | T08 (write) + M9/M10 мок-сьюта (смешанные → 503, одинаковые → код kind) |
| 8 | breaker DEGRADED@0.6*threshold, OPEN@threshold, backoff | T09 (/stats circuitBreakers + modelStates) |
| 9 | AUTH_ERROR не открывает breaker | T09 (AUTH_ERROR модель, breaker CLOSED) |
| 10 | quota pause от Retry-After, до 15min cap | T10 (/health quotaPauses) + M6/M11/M12 мок-сьюта |
| 11 | lastResort одна попытка вне ротации | T11 (write) + M7 мок-сьюта (lastResort даёт 200) |
| 12 | lastResort guard для пин-ов | T12 (write) + M15 мок-сьюта (пин упал → lastResort НЕ подменяет) |
| 13 | autoHeal заменяет только BROKEN, порядок сохранён | T13 + heal.test (19 ассертов: приоритет 1:1, userCustomized выше автоматики, дубли не плодятся) |
| 14 | v2 failover-поля round-trip | T14 (GET /sets) + config.test (15 ассертов: v1→save→v2, dialect) |
| 15 | /health shape (все поля п.9) | T01 |
| 16 | /stats shape (все поля п.9) | T02 |
| 17 | /v1/models id-формы | T17 |
| 18 | >10MB → 413 | T15 (PASS на новом, ECONNRESET на старом) + T14 мок-сьюта |
| 19 | DNS-rebinding guard | T16 (PASS на новом, чужой Host на старом) |
| 20 | короткий алиас снят: не-`cascade` формы → unknown | T03a |
| 21 | Бюджет totalBudgetMs жёстко режет каскад | M8 мок-сьюта (8.05с при бюджете 8с, budget_exhausted) |
| 22 | auth_error sticky: блокирует провайдера, breaker НЕ растёт | M3 мок-сьюта (authError=true, consecutiveFailures=0) |
| 23 | 400/413/422 = вина клиента: фолбэк есть, здоровья нет | M5 мок-сьюта (state=CLOSED, n=0, lastError сохранён) |
| 24 | Персист переживает рестарт | persist.test (20 ассертов: атомарность, рестарт-продолжение, битый файл) |
| 25 | Пассивная квота по заголовкам без 429 | M11 мок-сьюта (remaining=0 → пауза) |
| 26 | HTTP 200 с мусором = настоящий провал | M13 мок-сьюта (empty_choices → 502) |

13. Статус реализации (этап 2 закрыт)
| Слой | Файл | Проверка | Итог |
|------|------|----------|------|
| Конфиг-дуализм v1/v2 | `config.ts` | `tests/config.test.ts` | 15 PASS |
| Вердикты/классификатор | `state/classify.ts` | `tests/mock-suite.ts` (M3–M13) | в составе 82 |
| Failover-цикл | `router.ts` (routeWithFailover) | M2, M8, M14, M16 | в составе 82 |
| Семейный фолбэк | `state/family.ts` | M16 | в составе 82 |
| Персист | `state/persist.ts` | `tests/persist.test.ts` | 20 PASS |
| autoHeal | `state/heal.ts` | `tests/heal.test.ts` | 19 PASS |
| Mock-провайдер | `adapters/mock.ts` | весь мок-сьют | 82 PASS |
| HTTP-контракт | `server.ts` | T01–T17 parity + мок-сьют | 13 PASS / 0 FAIL |
| Parity со старым | `scripts/parity-diff.mjs` | `backups/task30/` | 12 совпадений / 3 отличия / 0 регрессий |

Запуск проверок:
- `bun cascade-router/tests/config.test.ts` — конфиг-дуализм.
- `bun cascade-router/tests/persist.test.ts` — персист и рестарт.
- `bun cascade-router/tests/heal.test.ts` — autoHeal.
- `./scripts/cascade-router-test.sh` — поднимает :19082 и гоняет мок-сьют M1–M17 (82 ассерта).
- `ROUTER_BASE=http://127.0.0.1:19081 node scripts/parity-suite.mjs` — parity против нового ядра.
