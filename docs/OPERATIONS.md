# Cascade — эксплуатационная документация (OPERATIONS)

Дата состояния: 2026-09-29. Активный сет: `cascade:fast-coding` (60 моделей). Ядро роутера — **собственное** `cascade-router` (задача 31, этап 3). Исполняемый код — исходник (`server.ts` через bun), бандл используется только как проверка типов.

> Секретов в этом файле нет. Ключи лежат в `cascade-run/router/config.json` и маскируются при любом выводе (первые+последние 4 символа).

---

## 1. Архитектура

| Компонент | Порт | Биндинг | launchd | Поток |
|---|---|---|---|---|
| Фасад (API+дашборд) | `:3000` | **`127.0.0.1`** | `<лейбл фасада>` (см. заметку ниже) | `bun run server.ts` |
| Роутер cascade-router (собственное ядро) | `:19080` | `127.0.0.1` | — (нет plist) | спавнится фасадом по требованию |
| Туннель sing-box | `:10808` | `127.0.0.1` | `vpn.singboxServiceLabel` (из конфига) | `sing-box run -D cascade-run -c singbox.json` |

> **Лейблы сервисов — локальные идентификаторы macOS** (в коде не упоминаются): лейбл sing-box берётся из `vpn.singboxServiceLabel` конфига, лейбл фасада — из plist. Поставляемые примеры используют `com.cascade.*` (`configs/launchd/`); при миграции существующей инсталляции укажи фактические лейблы в конфиге/plist.

- **Правило №3 проекта — «:3000 только localhost» (задача 24, enforced кодом)**: фасад биндится на `127.0.0.1` (`server.ts` → `app.listen(PORT, "127.0.0.1")`), НЕ на `0.0.0.0`. Это защита от доступа из локальной сети: в API фасада чувствительные действия (`/api/routing`, `/api/vpn/*`, пины, квоты через `/v1`). Доступ только с локальной машины; с внешнего интерфейса (например `192.168.0.252:3000`) — connection refused. Если перестало биндиться на localhost — признак того, что `server.ts` откатился к `0.0.0.0` (пересобрать + kickstart).
- **Vite HMR-порт `:24678` (задача 24, разгадан)**: порт 24678 — **дефолтный HMR-WebSocket Vite 6** (`node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js:32400` — `const port = hmrPort || 24678`), поднимается `createViteServer({ server: { middlewareMode: true } })`, когда деплой идёт dev-веткой (`NODE_ENV !== "production"`). Вопрос задачи 23 «источник не найден в коде» решён: его в проекте нет — это внутренний порт Vite. Биндинг зажат на `127.0.0.1` тем же `hmr: { host: "127.0.0.1" }` в `server.ts`. В проде (`NODE_ENV=production`) Vite-middleware не используется — 24678 не поднимается вовсе.

- Роутер запускается **лениво**: `bun cascade-router/server.ts` (спавн в `server/routerService.ts`) стартует первым обращением к `/v1/...` через фасад и перезапускается так же после `pkill`.
- Прокси-env роутера задаёт фасад в `server/routerService.ts`: `HTTP(S)_PROXY/ALL_PROXY=http://127.0.0.1:10808`, `NO_PROXY` — прямые провайдеры, `NODE_USE_ENV_PROXY=1` (fetch чтит прокси и в node-запусках).
- Туннель НЕ тянет подписку сам (статичный `singbox.json`); обновляет его `server/vpnService.ts`.
- **Фоновый egress-проб (задача 7)**: после каждого часового синка vpnService запускает построчную пробу всех строк подписки (алгоритм `scripts/probe-core.mjs`, тот же, что у CLI `probe-vless-subscription.mjs`: parallel ≤8, порты 12100+, TCP-чек + cloudflare trace + ipify для живых, SIGKILL после, бюджет 10 мин, без секретов в логах/файле). Результат — `cascade-run/vpn-egress-probe.json`, сводка в `/api/vpn/status` → `egressProbe {total, ok, checkedAt}`.
- Часовые хуки фасада: синк подписки VLESS каждые 60 мин → **egress-проб** → бенчмарк каждые 10 мин → `apply` при нездоровье туннеля (egress-проверка).
- **Внешний пакет роутера списан полностью**: сначала (задача 13, 2026-09-22) выгружен его launchd-стенд на `:19280` — агент unload, plist в `backups/task13/plists/`, глобальный npm-экземпляр и bin-симлинк удалены, ключи/конфиги в `backups/task13/keys/`; затем (задача 31, 2026-09-29) удалён npm-пакет из `node_modules` проекта вместе с патчами. Роутер :19080 теперь — собственное ядро `cascade-router` из репозитория; npm-пакет роутера и его патчи списаны (задача 31). Откат/архивы: `backups/task13/`, `backups/task31/`.
- **ЖИВОЕ состояние роутера Cascade (:19080), НЕ удалять (задача 14)**: каталог `cascade-run/router/state/` — `breakers.json`, `quota.json`, `probes.json`, `history.json` (атомарная запись tmp+rename, debounce + flush на SIGTERM). Путь задаётся через `CASCADE_ROUTER_STATE_DIR`. Прежние файлы состояния в `~/` удалены (задача 31), бэкапы — `backups/task31/legacy-state/`.
  - Логи фасада: `cascade-run/server-launchd.out|err` (launchd-лейбл фасада), растут без ротации.
    В них попадают служебные строки vite вида `page reload <путь>` и — законно — строки отклонённых
    запросов вида `[cascadePin] rejected unknown model <старый-короткий-алиас>`: их пишет R3-страж (см. §2),
    поэтому такие файлы исключены из source-grep-аудита (иначе он всегда даёт не 0). Ротация при разрастании: `: > cascade-run/server-launchd.out`

    переименованные/удалённые файлы всплывают именно там. Ротация при разрастании: `: > cascade-run/server-launchd.out`
    (копию при необходимости — в `backups/task{N}/`). Ядро роутера своего файла лога не имеет.

## 2. Использование в opencode

```
baseURL: http://localhost:3000/v1
model:   "cascade"                    # каскад активного сета
         "cascade:fast-coding"        # тот же сет по имени
         "cascade:@<provider>/<model>"  # пиннинг конкретной модели
```

- `/v1/models` на `:3000` отдаёт **`cascade`, `cascade:fast-coding` + все модели активного сета** (задача 9): id каждой модели = её id каталога на дашборде (`/api/parse-models`), т.е. `llm7-minimax-m2_7`, `qwen-qwen3-coder-next`, `cloudflare-_cf_openai_gpt-oss-120b` и т.д. Список динамический (пересборка раз в ≤60 c из текущего сета роутера). Проверить: `curl http://localhost:3000/v1/models`.
- Выбрать конкретную модель в opencode: id из `/v1/models` → `POST /v1/chat/completions` фасад **сам перепишет** его в `cascade:@<provider>/<model>` (строгий пиннинг, лог `[cascadePin] <id> -> cascade:@...`).
- **Пикер `/models` в opencode (микро-задачи 18-19, 2026-09-22)**: у провайдера `cascade` в `~/.config/opencode/opencode.json` секция `models` — **объект-мапа ровно с одной записью `cascade`**, значения — объекты `{"name": ...}` (эталон, см. блок ниже). В пикере ровно одна запись, все переключения моделей делает авто-каскад.
  - **ЭТАЛОН секции (copy-paste, `provider.cascade.models`)**:
    ```json
    "models": {
      "cascade": { "name": "Cascade auto-router" }
    }
    ```
    Формат НАСЛЕДУЕТСЯ из бэкапа конфига задачи 12 (`burst` `{"name": ...}`), каждая запись — объект, не строка.
  - **⚠️ Формат-ловушки (инцидент 2026-09-22)**:
    - **`models` МАССИВОМ** (`[{"id":"cascade","name":...}]`) → схемная ошибка opencode **`ConfigInvalidError`** (схема требует объект-мапу).
    - **Лишняя закрывающая `}` / битая запятая** → **`ConfigJsonError` / `EndOfFileExpected`** (JSON некорректен).
  - **Правило (обязательное)**: после ЛЮБОЙ правки `~/.config/opencode/opencode.json` запускать `python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null` (эталонный валидатор на этой macOS; `plutil -lint` произвольный JSON на macOS 26 НЕ принимает даже для `{"a":1}`). Схему провайдера можно проверить read-only: `NO_COLOR=1 opencode models cascade` → `cascade/cascade`.
  - Секцию `models` нельзя удалять целиком (opencode тогда вытянет все 62 из `/v1/models` и пикер снова распухнет).
- **Длительные сессии opencode (задача 20, 2026-09-23)**:
  - **ЭТАЛОН модельной записи с context-limit** — у `cascade` ОБЯЗАТЕЛЬНО задан `limit` (иначе opencode считает контекст модели «неизвестным» и компактит по своему малому дефолту ~8k токенов → очень частые авто-сжатия):
    ```json
    "models": {
      "cascade": { "name": "Cascade auto-router", "limit": { "context": 200000, "output": 8000 } }
    }
    ```
    Поля по схеме opencode (`config.json`): `limit.context`/`limit.output` — номер, required: `context`+`output`. Бэкап до правки — `backups/task20/opencode.global.before.json`.
  - **Почему выбирают компакты ЧАСТО**: открытое ПО конфигурирует авто-компакт по лимиту исполнителя; фасад `:3000` в `/v1/models` контекст не отдаёт, а без `limit` в конфиге opencode дефолтный порог ≈ 8192 токена → сжатие каждые ~6.5k токенов. С `limit.context=200000` порог совпадает с самым узким из топ-5 исполнителей каскада (llm7/minimax-m2.7 = 200k; nemotron-ultra/qwen3.8-max = 1M; qwen3-coder-next/qwen3.5-35b = 256k). Завышать нерезонно: роутер v2 на `400/413/422` (`INVALID_REQUEST`) делает `failover:true, healthDamage:false` (blame=client) — большой payload просто пробегает каскад, не ломая брейкеры.
  - **Что значит `HTTP 504 "All routed models failed"` для агента**: все кандидаты сета разом отказали (dead ключ/квота/500/тайминги) — агент получает терминальную ошибку и останавливается. Смотреть причину: `curl :19080/stats` → `history{success_rate, all_failed, failover_rate}`, `breakers{<модель>: {state, lastError, authError}}`, `probeCache{ok,boken,providers}`. Агент может продолжать авто-повтором по каскаду пиннингу `cascade:@<model>` дело не в числе кандидатов, а в их статусе.
  - **⚠️ Физическое ограничение фасада `:3000` (причина 413)**: `app.use(express.json())` в `server.ts` без явного `limit` → дефолт **100kb** отбивает любой запрос с payload >100kb (компакт-запрос opencode шлёт отведённый контекст сессии целиком; длинная сессия=МБ, см. лог 22-09: 19× `Error: request entity too large`), ответ `413 Payload Too Large` → build НЕ может завершиться, агент без отчёта. **НЕ снимается** установкой `limit` модели — это отдельный лимит тела HTTP у фасада. Правка (решение владельца, НЕ применено в задаче 20): `express.json({ limit: "50mb" })` + `bun build` + kickstart фасада.
  - **Альтернатива под управлением компакт-порога (опции opencode `agents.<name>.compaction`, по схеме)**: `auto` (bool, компакт при заполнении, default true), `tail_turns`, `preserve_recent_tokens`, `reserved` (запас на время компакта), `prune` (чистка старых tool-output). Применять — решение владельца.
  - **Body-limit фасада (задача 21, 2026-09-23)**: `server.ts` теперь `app.use(express.json({ limit: "100mb" }))` — фасад больше не отбивает 413 на телах >100kb. **Потолок наследующий**: у своего ядра `MAX_BODY_BYTES = 10MB` (`cascade-router/http.ts`); тело >10MB отбивается честным `HTTP 413 payload_too_large` (CORE-SPEC §11, отличие #3). Значит: тела до 10MB — насквозь (проверено 1MB→200, 5MB→200), 11MB+/35MB — 413 с кодом `payload_too_large` (раньше был обрыв соединения и 503).
  - **Авто-continue после 413 — причина найдена (задача 21)**: при 413/сетевых сбоях opencode САМ автогенерирует user-сообщение «The previous request exceeded the provider's size limit due to large … Continue if you have next steps, or stop…» и повторно продолжает агента — это НЕ трекер todos и НЕ внешний «continue». Таким образом «агент без отчёта» = opencode-авто-retry после 413. Фикс 413 лимитом выше закрывает корень; авто-retry itself остаётся поведением opencode.
  - **ПРОТОКОЛ ЗАВЕРШЕНИЯ (все Cascade-задачи агента, задача 21)**: финальный ответ = ПОЛНЫЙ отчёт одним блоком; после отчёта НИ ОДНОГО действия; напоминания/«continue»/«незавершённые задачи» после сдачи = устаревший трекер или внешняя автоматика — максимум одна read-only сверка, ответ одной строкой «задача уже сдана, todo закрыты, СТОП», полное завершение. Не переделывать, не продолжать.
- Пиннинг конкретной модели по-прежнему доступен: через `curl` (`model: "cascade:@<provider>/<model>"`), либо временным добавлением нужной модели в `models` провайдера cascade конфига opencode. Список доступных id: `GET /v1/models`.
- Пиннинг пример: `cascade:@qwen/qwen3-coder-next`, `cascade:@mistral/codestral-latest`.
- **Диспетчер `body.model` на завершении (задача 10) — ровно три режима**:
  - **R1. catalog-id из активного сета** (id из `GET /v1/models`) → фасад переписывает в `cascade:@<provider>/<model>` → **строгий пиннинг** (200 = исполнитель строго выбранная модель).
  - **R2. `cascade`, `cascade:fast-coding` и всё, что начинается с `cascade:`** (в т.ч. прямой пин `cascade:@<provider>/<model>`) → проксируется без изменений (R1/R2 используют ту же TTL-мапу, новой логики нет).
  - **R3. ЛЮБОЕ другое значение** (`gpt-4o`, устаревшие id после autoHeal-ротаций, каталог-id вне сета) → фасад сам отвечает `HTTP 404 {"error":{type:"invalid_request_error",code:"model_not_found", message:"Unknown model '<id>'. Use 'cascade' (auto-cascade) or pick from GET /v1/models."}}`, **запрос до роутера НЕ доходит** (проверяется по отсутствию в `/stats` `requestLog`), лог `[cascadePin] rejected unknown model <id>`; отсутствующий/пустой `body.model` → `HTTP 400` той же структуры (`code:"missing_model"`). **Скрытая подмена выбранной модели на каскад исключена навсегда.**
  - Рекомендация: после autoHeal-ротаций обновить список моделей в opencode (`/models` пересобирается раз в ≤60 c); устаревший выбор превращается в явную ошибку «Unknown model» — вернись на `cascade` или перевыбери id из `/v1/models`.
- **Семантика пиннинга (задача 8, верифицирована кодом + живым тестом)**: `cascade:@<provider>/<model>` — **строго одна модель, failover выключен** (в своём ядре: `parseModelSpec` в `router.ts` — пин только с префиксом `cascade:@`; каскад при пине отключён, `lastResortModel` не применяется). Живой тест: пин в мёртвую модель (`cascade:@openrouter/...`:free, квотный 429) → `HTTP 502 "All routed models failed"`, **без фолбэка**; пин в живую → 200 и исполнитель строго запинненная модель.
  - ⚠️ **Голое `provider/model` БЕЗ префикса `cascade:@` — это НЕ пин**: парсер считает его `unknown` и запрос идёт обычным каскадом активного сета (поэтому в отчёте Задачи 7 «пины» отвечали через каскад — там был использован неверный синтаксис).

## 2b. Плагины opencode (задача 26, 2026-09-24)

- **Симптом и источник**: после сдачи Cascade-задач агенту приходили авто-«continue» («Continue if you have next steps…», 7 подряд в сессии задачи 25). Задача 21 уже закрыла opencode-авто-retry после 413 (тело >100kb), но continue ПРОДОЛЖАЛИСЬ — источником был плагин **opencode-auto-resume** (v1.1.13).
- **Что делал виновник (код `dist/index.js`)**: подписывался на `session.idle` и держал собственное состояние «busy»-сессий. Для сессии в состоянии `busy` без активных сабагентов орфан-детектор (`Parent … stuck with no active subagents. Triggering abort+resume`, стр. 13706) каждые ~9–15 с вызывал `tryAbortAndResume` → `ctx.client.session.abort()` → `sendContinuePrompt(sid, continuePrompt)` → реальное user-сообщение в сессию через `session.prompt`. Строка 12830 `sendContinuePrompt` вызывает `ctx.client.session.prompt({parts:[{type:"text",text}]})` — это и есть видимый пользователем «continue». Watchdog-пути без abort (12290-12944) слали `session.prompt` напрямую. Плюс плагин оверрайдил тул `task_complete` (возвращал «You have N unfinished task(s). Please complete…» при открытых todos) и слал «Continue» после session.idle с открытыми todos.
- **Лог-корреляция (доказательство)**: `~/.local/share/opencode/log/opencode.log`, сессия `ses_f3876af8ffe1BuFbIEbM0L3ij` (задача 25, сдана 2026-09-24 06:46): после сдачи 06:47:55+ пошли циклы `Parent … stuck with no active subagents. Triggering abort+resume.` → `abort OK` → `abort+continue done` (строки 06:48:09…06:49:15, **7 циклов подряд**, каждая пара строк дублируется плагином). Всего за время жизни лога **72 abort+continue** (13.09 — 34, 15.09 — 1, 17.09 — 4, 22.09 — 12, 23.09 — 7, 24.09 — 14). Логи плагина пишутся через `ctx.client.app.log({service:"auto-resume"})`.
- **Проверка остальных плагинов (никакого авторитета не имеют)**: grep по всем пакетам на `session.prompt` дал только 4: auto-resume (реальные continue-промпты, виновник), supermemory (шлёт «Continue» **только** после прекомпакта контекста, `[compaction] … usageRatio ≥ threshold` — параллельный, не виновен в 7 циклах), agent-skills (`injectSyntheticContent` с `noReply:true, synthetic:true` — скрытое, не «user»), graphify (`sendPrompt` — только из TUI по клику). omniroute/notify/worktree/ponytail/token-tracker/vibeguard/wakatime — 0 совпадений.
- **Действие**: плагин УДАЛЁН (выключен в `~/.config/opencode/opencode.json` — убрана строка `"opencode-auto-resume"` из `plugin[]`; пакет `opencode-auto-resume@1.1.13` удалён из `~/.cache/opencode/packages/`). Бэкапы: `backups/task26/opencode.before.json`, `backups/task26/auto-resume.package/latest` (полный экземпляр пакета, 62M). Конфиг валиден (`python3 -m json.tool` OK; `NO_COLOR=1 opencode models cascade` → `cascade/cascade`).
- **Верификация тишины**: в отдельной fresh-сессии `opencode run "…respond with exactly the single word DONE…"` → ответ `DONE`, затем 70+ с мониторинга `opencode.log` — **0 continue, 0 abort+continue, 0 авто-сообщений**. Повтор невозможен: плагина нет ни в конфиге, ни на диске.
- **Таблица плагин → назначение → статус** (актуально после задачи 26):

  | Плагин | Назначение | Статус |
  |---|---|---|
  | opencode-notify | уведомления (telegram/remote) | включён |
  | opencode-supermemory | память (supermemory), прекомпакты | включён |
  | opencode-worktree | ворктри | включён |
  | opencode-auto-resume | авто-возобновление сессий | **УДАЛЁН (задача 26) — источник авто-continue** |
  | @dietrichgebert/ponytail | минимализм кода | включён |
  | opencode-omniroute-plugin | роутинг моделей | включён |
  | @javargasm/opencode-graphify | граф знаний | включён |
  | opencode-agent-skills | навыки агента | включён |
  | opencode-token-tracker | трекинг токенов | включён |

- **Цена удаления**: auto-resume также спасал при сетевых сбоях/таймаутах (его заявленная функция — recovery после зависших stream). После удаления агент НЕ будет автоматически продолжен при разрыве stream на стороне провайдера — придётся явно писать «continue» вручную. Полезность была реальной, но цена (ложные continue на завершённых задачах, 72 abort+resume в логе) перевесила. Откат в любой момент: вернуть строку в `plugin[]` + вернуть пакет из `backups/task26/auto-resume.package/latest` в `~/.cache/opencode/packages/`.
- **Живой web-процесс**: opencode web (`launchctl ai.opencode.web`, pid меняется, запущен с 20.09) держит старый код плагина в памяти до перезапуска; чтобы выгрузить — `launchctl kickstart -k gui/$(id -u)/ai.opencode.web`. Новые сессии (и уже запущенная headless-проверка) плагин не загружают, т.к. конфиг чист.

## 3. Дашборд и вызовы

- Дашборд: `http://localhost:3000`
- Статус туннеля: `GET /api/vpn/status`
  - Поле `appliedNode` = **реально применённый** узел (id/label), `tunnelAppliedNodeId` — его id, `lastEgress` — результат последней egress-проверки (`ok`/`loc`), `egressProbe {total, ok, checkedAt}` — сводка последнего фонового проб. Поле `activeNode` остаётся benchmark-узлом памяти.
  - **Секретов в ответе больше нет** (задача 6): uuid/pbk/sid/rawUrl удалены из всех VPN-ответов, ip маскируется. При изменении кода — не возвращать сырые узлы наружу: использовать `vpnService.publicNode/publicNodes/appliedNode`.
  - Фактический wire-конфиг = `server`/`server_port` в `cascade-run/singbox.json`; проверка egress: `curl -x http://127.0.0.1:10808 https://www.cloudflare.com/cdn-cgi/trace` → `loc`.
  - **Защита apply от невалидных конфигов (задача 11)**: неподдерживаемые транспорты (`UNSUPPORTED_TRANSPORTS` в `server/vpnService.ts`, сейчас `xhttp` для sing-box 1.14.1) исключаются из кандидатов apply, а перед КАЖДОЙ записью конфига выполняется универсальный pre-flight `sing-box check -c <tmp>` (таймаут 5 c): FATAL/ненулевой exit → кандидат скипается («skip invalid config <host:port маскировано>: <причина>»), конфиг НЕ пишется, kickstart НЕ вызывается. Туннель не роняется невалидным конфигом ни на xhttp, ни на любых будущих неподдерживаемых полях.
- Кэш сырой подписки после каждого синка: `cascade-run/vpn-subscription-cache.txt` (последний снапшот для перепроверки).
- Переписать узел: `POST /api/vpn/apply {"force":true}` или `{"nodeId":"<id>"}` (пин конкретного узла, без deep-fallback)

### Ручной выбор модели (дашборд) — задача 22

- **Режим маршрутизации** (панель «Каскад активного сета» на дашборде или API):
  - `GET /api/routing` — состояние: `mode` (`auto`|`manual`), `pinned`, `stale`, `activeSet {name, modelCount, autoHeal, lastResort}`, `providers[]` (`key/name/hasApiKey/via: direct|tunnel` — только булевы флаги, ключей наружу нет), `models[]` (60: `id/name/provider/model/priority/context/hasApiKey/via/health`). Порядок — по приоритету (мощная→слабая). `health`: `ok`|`degraded`|`broken`|`unknown` из `/stats` роутера (CLOSED→ok, DEGRADED/HALF_OPEN→degraded, OPEN/QUOTA_PAUSED→broken; кэш 20 c, таймаут 3 c; роутер недоступен → всем `unknown`).
  - `POST /api/routing {"mode":"auto"}` — сброс в авто-каскад.
  - `POST /api/routing {"mode":"manual","id":"<catalog-id>"}` — строгий пин модели из активного сета. Неверный id → `400` `invalid_request_error` с подсказкой «Use ids from GET /api/routing models[]». Пина без `id` не существует — смена режима вручную без модели = `400`.
- **UX-флоу ручного режима (дашборд, задача 25)**: тумблер «Ручной» — это ТОЛЬКО локальное состояние выбора, на бэкенд в этот момент ничего не уходит (режим остаётся `auto`, заголовок ещё «Авто»); селект активируется с подсказкой «Выберите модель для закрепления»; выбор модели в селекте (или клик по строке модели) — единственный запрос для включения ручного режима: `POST {"mode":"manual","id":<id>}`. Успех → заголовок «Ручной: <имя>» + PIN-бейдж; ошибка API → сообщение в панели, состояние на бэкенде не меняется (остаётся auto). Тумблер «Авто» → `POST {"mode":"auto"}`. Других POST `/api/routing` из фронта нет (грепом подтверждено).
- **Персист**: файл `cascade-run/routing-override.json` `{mode, pinnedId, pinnedPin, updatedAt}` (атомарно tmp+rename), читается на буте/каждом запросе. Ручной режим переживает перезапуск фасада.
- **Диспетчер**: в `auto` голый `cascade` идёт в каскад из 60. В `manual` голый `cascade` **строго** пинится на выбранную модель (`body.model = pinnedPin`, лог `[cascadeRouting] manual: cascade -> <pin>`): без каскада, без тихих подмен — недоступность = явная ошибка.
- **Stale-пин**: если `pinnedId` выпал из активного сета (сет пересобрался), статус `stale:true`, а голый `cascade` получает `503` `routing_error`/`manual_pin_stale` с инструкцией `POST /api/routing {"mode":"auto"}`. Молчаливого сброса нет. Сетевые id (`qwen-qwen3_5-35b-a3b` и др.) и `cascade:*` (например `cascade:fast-coding`) не затрагиваются.
- **Ключи в дашборде**: каталог помечает провайдеров с подключённым ключом (значок «ключ подключён»); маска `sk-|gsk_|cfat_|Bearer` в `GET /api/routing` проверена = 0 вхождений.
- `via`: `direct` = домены провайдера в `NO_PROXY` роутера (см. `server/routerService.ts`); `tunnel` (openrouter и др.) — идёт через VLESS-туннель. Перезапуск и обслуживание те же, что для дашборда выше.

### Регрессионный прогон — задача 23

- **Запуск**: `bun scripts/regression.mjs` (корень Cascade). Скрипт не трогает конфиги, квоты не жжёт (`max_tokens=1`; пинов ≤2 на провайдера, суммарно ≤12 за прогон).
- **Что проверяет** (13 групп, ~36 проверок): P1 фасад `:3000`/`/` + `/v1/models = 62`; P2 роутер `:19080` `/health` (60 моделей, 0 broken, autoHeal, lastResort); P3 `cascade` ×5 → 200 (исполнители); P4 строгие пины (qwen/cloudflare/mistral/llm7 + openrouter/groq tunnel-dependent); P5 `big-pickle`/`gpt-4o` → 404; P6 переключение режимов (manual → cascade ×2 строго → восстановление исходного); P7 `/api/routing` (60, 12 пров, секретов 0); P8 VPN (appliedNode, секретов нет, egress `:10808`, openrouter через туннель); P9 тела (5MB → не 413; 12MB → 413 `payload_too_large`); P10 собственное ядро в проде (версия, каталог, действующие v2-поля failover, путь состояния); P11 конфиг opencode (JSON, 1 запись cascade, limit 200000); RST восстановление routing-режима.
- **Логи**: `backups/regression/<ISO-дата>.log` (stdout дублирует сводку). Exit 0 = нет FAIL, exit 1 = есть FAIL.
- **Семантика вердиктов**: `PASS` — эталон выполнен; `WARN` — НЕ ошибка системы: квота/туннель/внешняя недоступность (например 429/502 у openrouter/groq без подмены модели) или 400 сверх контекста; `FAIL` — поведение отклонилось от эталона (413-потолок, подмена пина, секрет в ответе, 404-ожидание не сработало и т.п.). Провал дела — `fail > 0` → exit 1.
- **Детектор секретов в `P8` (задача 24, ужесточён)**: раньше искал подстроки `uuid|pbk|sid|sk-|gsk_|cfat|rawUrl` без границ слов — нода «Houston (**Northside**/Northline)» давала ложный FAIL на подстроке `sid` внутри «North**sid**e». Теперь ищет полный секрет-паттерн (`uuid:<hex>`, `pbk:<b64>`, `sid:<hex>`, `sk-<key>`, `gsk_<key>`, `cfat<key>`, `rawUrl`) — единичное совпадение = только реальные ключи.

## 4. Что происходит само

- Каскад «мощная→слабая»: 60 моделей, топ: `llm7/minimax-m2.7` → `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` → `qwen/qwen3-coder-next` → `qwen3.8-max-0902` → `qwen3.5-35b-a3b`.
  Метрика: tier → sweScore% → контекст → латентность, + «лавлат-зажим»: медленные (>2.5s) большие qwen опущены в хвост.
- Фолбэк при 429/5xx/timeout → следующий кандидат; circuit breaker'ы, quota-pause (провайдер «засыпает» на время ретрая).
- `probeCache`: ok-модель живёт 24ч; broken перепроверяется по backoff.
- `autoHeal`: на старте заменяет только BROKEN-модели сета живыми из каталога, сохраняя порядок.
- `lastResort`: `llm7/minimax-m2.7` — финальный резерв, когда весь сет отказал.
- **⚠️ xhttp-транспорт (задача 8, находка)**: в ротацию подписки периодически попадают строки с `type=xhttp`. sing-box **1.14.1 их не понимает** — `sing-box check` → `FATAL ... outbounds[0].transport: unknown transport type: xhttp`, процесс не стартует. Последствия: ① в построчном пробе такие строки засчитываются `exit` (в прогоне 77 строк = ровно 20 «exit» = 20 xhttp-строк); ② хуже — если лучший узел по бенчмарку xhttp, `apply` пишет невалидный `singbox.json` и роняет туннель (наблюдалось 2026-09-22: `148.253.212.152:443 xhttp` = FATAL, туннель лёг, пока deep-fallback не пробежит весть бюджет). Пока лечится только ротацией/второй подпиской; правильный фикс — фильтр xhttp в кандидатах apply и/или апгрейд sing-box (вне scope, открыто как дефект).
- Туннель: часовой синк подписки → фоновый egress-проб → `apply` с egress-проверкой, откатом на known-good конфиг и **deep fallback**: если топ-8 по latency не дали egress, пробегаются все оставшиеся уникальные конфиги (от медленных к быстрым, мёртвые в конец, бюджет 15 мин). Дедупликация — по полному конфигу (uuid/host/port/security/sni/pbk/sid/transport/flow/fp), а не по host:port: один сервер:порт с разными fp/uuid — разные рабочие конфиги (задача 6).
- **Probe-aware порядок (задача 7)**: если есть свежий (<90 мин) egress-проб, кандидаты `apply` упорядочиваются живыми узлами по возрастанию latency (TCP-latency не предсказывает VLESS-egress — задача 6: 50–68 живых из 127 при любом пинге). Без свежего проба — прежнее поведение. force/пин nodeId/бэкапы/откат не меняются.

## 5. Что требует владельца

- **Google AI Studio (задача 27, 2026-09-24)**: ключ внесён в `apiKeys.googleai` (config.json), но провайдер НЕ в активном сете и каскадом не используется. Причина — гео-блок Google: запросы к `generativelanguage.googleapis.com` возвращают `400 User location is not supported` и напрямую (RU IP), и через VLESS-туннель (DE-датацентр 31.76.69.58, SERV.HOST GROUP); US-узлов в подписке нет. Каталоговый id `gemini-2.0-flash` (server.ts) в живом API МЁРТВ (404, Google советует `gemini-3.6-flash`). 11 моделей googleai видимы в каталоге роутера с `hasApiKey=true`, `inRouterSet=false`. Для активации нужен egress из поддерживаемой локации (резидентный IP, не датацентр) — тогда добавить модель в сет и поднять эталоны регрессии (62→63, 60→61). Бэкап конфига до правки: `backups/task27/config.before.json`.
- **ZAI**: исчерпан баланс (429) — пополнить, если нужны zai-модели.
- **OrcaRouter**: аккаунт не на free-тарифе — модели недоступны (429) до апгрейда.
- **Локальный ollama** не запущен — модели `ollama/*` недоступны.
- **hf / github** эндпоинты каталога мертвы — недоступны всегда.
- **Подписка VLESS живая и массовая** (задача 6, замер 22-09-2026): свежая подписка = 127 строк; построчная проба честным конфигом — 1-й прогон 68/127 живых (17 host:port), 2-й прогон через ~40 мин 50/127 (11 host:port; ipify/egress подтвердили 11/11). Подписка ротируется почасово — цифры плавают. При полной смерти подписки `openrouter/groq` (═ сета ~12+3 модели) выпадут из каскада до оживания; остальные провайдеры (llm7, cloudflare, qwen, mistral) от туннеля не зависят.
- **Рекомендация владельцу**: «1 живой из 50» в задаче 4 был артефактом (дедуп по host:port + потеря flow при явном `type=tcp` в пробе + ротация). Живые строки лучше перепроверять в обычном VPN-клиенте (например нечётный/чётный номер строки на разных прогонах) — потоковый VLESS-клиент фактличнее TCP-only пробы.
- **НЕ гонять**: массовый пинг всех моделей чпонентом (квота dashscope первого дня сжигается за один прогон).
- **После `bun install`/`npm i`**: ничего довколачивать не нужно — ядро роутера своё и лежит в репозитории (`cascade-router/`), внешних пакетов с патчами больше нет.

## 6. Recovery runbook

```sh
# Роутер упал / висит
pkill -f cascade-router/server.ts                      # фасад поднимет сам первым /v1-запросом
curl -s -m 40 -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"cascade","messages":[{"role":"user","content":"ping"}],"max_tokens":4}'

# Фасад
launchctl kickstart -k gui/$(id -u)/<лейбл фасада>   # см. заметку про лейблы в §1
lsof -nP -iTCP:3000 -sTCP:LISTEN        # ожидается ТОЛЬКО 127.0.0.1:3000 (правило №3, не *:3000)
curl -s -m 3 http://127.0.0.1:3000/     # 200
curl -s -m 3 http://<LAN-IP>:3000/      # connection refused — раз 200 — биндинг откатился на 0.0.0.0

# Туннель не едет (узел — из /api/vpn/status: appliedNode, или singbox.json)
curl -s -X POST http://127.0.0.1:3000/api/vpn/apply -H 'Content-Type: application/json' -d '{"force":true}'
node -e "console.log(JSON.parse(require('fs').readFileSync('cascade-run/singbox.json','utf8')).outbounds.map(o=>o.server+':'+o.port).filter(Boolean))"  # применённый узел(s)

# Построчная проба подписки (сколько строк реально живые):
bun scripts/probe-vless-subscription.mjs           # читает cache файл, пишет /tmp/cascade-sub-probe-results.json
# флаги: --filter <host:port> (=формат: --filter=value), --parallel N, --ipify-per-host, --reprobe-ok, --ports-base N
# fail-типы: tcp-blocked (TCP до узла не идёт), exit (sing-box упал), egress-timeout (туннель встал, но трафик не уходит)
# Автоматический фоновый проб уже встроен: /api/vpn/sync или часовой тик → cascade-run/vpn-egress-probe.json + egressProbe в /status

# Конфиги/эталоны
backups/task3/            # etalon: vpnService/routerService/server.ts, singbox.json (задача 3)
backups/task4/core/       # etalon: config.js/sources.js «до», config.json, server.ts/vpnService.ts «до» (задача 4)
backups/task4/artifacts/  # эталон сета set-fast-coding.json, verify-c.json, acceptance-pins.json, …
backups/task6/            # дедуп по полному конфигу + /status без секретов (vpnService.ts/server.ts «до»), probe-результаты (задача 6)

# Ядро роутера (своё, из репозитория — довколачивать нечего)
bun cascade-router/server.ts   # не вручную: спавнит фасад
```

## 7. Состояние и рекомендации апстриму

- Сет `cascade:fast-coding` = 60 моделей, провайдеры: llm7, openrouter, qwen, groq, cloudflare, mistral.
- Применённый узел туннеля: `201.24.50.94:443` (grpc+reality, 🇩🇪/🇫🇮, loc DE/FI; 22-09-2026). Узел взят построчной пробой: это **не** «единственный живой» — живы десятки строк (см. §5).
- **Патчи сняты (задача 31, 2026-09-29)**: оба фикса перенесены в собственное ядро и больше не нужны.
  - бывший патч каталога mistral (9 мёртвых id → живые) — учтён при генерации собственного каталога `cascade-router/catalog.json` (`scripts/catalog-bootstrap.mjs`), где нет ни мёртвых, ни устаревших id.
  - бывший патч `normalizeRouterFailover` (сохранение v2-полей `lastResortModel`, `bodyReadTimeoutMs`, `totalBudgetMs`, `contentValidation` сквозь load/save) — в своём ядре значения живут в типизированном конфиге нативно, отдельный патч не требуется (CORE-SPEC §11, отличие #2).
  - Архив патчей: `backups/task31/patches-retired/`.
- Итог: внешний пакет роутера и механизм патчей к нему больше не используются — своё ядро (задача 31).

## 8. Upstream — закрыт (задачи 15→17, итог 2026-09-29)

- Апстрим больше не используется: роутер :19080 — собственное ядро `cascade-router` (задача 31). Пакет из `node_modules` удалён, `bun.lock` очищен, патчи сняты (архив — `backups/task31/patches-retired/`).
- **Оба отправленных PR — MERGED апстримом 2026-09-26** (закрывать не потребовалось):
  - **PR2** (`#191`, репозиторий апстрима) — сохранение v2-полей failover сквозь load/save (merged 2026-09-26 11:30:00Z).
  - **PR3** (`#192`, репозиторий апстрима) — живые mistral-id (merged 2026-09-26 11:30:37Z).
  - Значит фиксы, ради которых мы их слали, в апстриме есть; в своём ядре они реализованы нативно (типизированный конфиг, CORE-SPEC §11 #2).
- Лок-документы по апстриму (PR1/PR2-диффы, план снятия патчей, live-верификация) перенесены в `backups/task31/legacy-artifacts/upstream/`.
- Активный лок-файл пакетов: `bun.lock`. Устаревший `package-lock.json` удалён (задача 31), копия — `backups/task31/legacy-artifacts/`.

## 9. Разработка собственного ядра cascade-router (путь Б, этап 1/3 — 2026-09-29)

- Идёт разработка **собственного** ядра роутера (clean-room рерайт, НЕ форк). Поведенческая спека: `docs/CORE-SPEC.md` (контракт: парсинг id, каскад, failure_kinds, breaker, quota, lastResort, autoHeal, HTTP-API, схема конфига, 3 осознанных отличия, таблица «поведение → проверка»).
- Историческая справка этапа 1: прод оставался на старом ядре, production-файлы не трогались. С 2026-09-29 (этап 3) прод переведён на своё ядро — см. §11.
- Новый роутер — **dev-инстанс на 127.0.0.1:19081**, запуск вручную: `scripts/cascade-router-dev.sh` (bun cascade-router/server.ts, БЕЗ launchd). Конфиг — копия `cascade-router/dev-config.json` (ключи читаются оттуда, чтобы два ядра не писали один конфиг). Своё состояние: `~/.cascade-router-dev/`.
- Собственные имена с первого дня: id только `cascade`/`cascade:<set>`/`cascade:@provider/model` (короткий алиас снят на этапе 3). Каталог — нативный `cascade-router/catalog.json` (генератор `scripts/catalog-bootstrap.mjs`: живые API + наша верификация задач 4/15/27).
- Проверки паритета: `scripts/parity-suite.mjs` (env `ROUTER_BASE`, runnable против любого роутера) и `scripts/parity-diff.mjs` (оба + diff с классификацией). Эталон старого: `backups/task29/parity-old.json`, diff: `backups/task29/parity-baseline.txt`.
- Три осознанных отличия нового ядра (задокументированы в CORE-SPEC §11): (1) unknown model id → явная ошибка 400 вместо молчаливого каскада; (2) v2-поля failover выживают save/load нативно; (3) тело >10MB → честный 413.
- Итог по этапам: этап 2 выполнен (failover-цикл, персист, quota, probe-cache, autoHeal, CRUD /sets, мок-сьют), этап 3 выполнен — см. §10 и §11.

## 10. Собственное ядро cascade-router — этап 2/3 закрыт (2026-09-29)

- Этап 2 завершён: полный failover-цикл, персист состояния, autoHeal, mock-инстанс и мок-сьют тонких мест. Прод-инвариант на этом этапе: фасад `cascade` → 200; `:19080 /health` = 60 моделей, `autoHeal=true`. Прод-файлы на этом этапе не менялись.
- Новые модули ядра: `state/classify.ts` (16 failure_kinds → вердикты), `state/family.ts` (семейный фолбэк), `state/persist.ts` (атомарный персист + лента истории), `state/heal.ts` (autoHeal), `adapters/mock.ts` (детерминированный mock-провайдер).
- **Персист (dev)**: `~/.cascade-router-dev/` → `breakers.json`, `quota.json`, `probes.json`, `history.json`. В проде — `cascade-run/router/state/`. Запись атомарная (tmp+rename, debounce 2с + flush на SIGTERM/SIGINT). При старте состояние читается: рестарт = продолжение, а не сброс.
- **Управление (только mock-инстанс :19082)**: `POST /admin/autoheal`, `GET|PUT /admin/failover`, `POST /sets`, `PUT /sets/:name`, `DELETE /sets/:name`, `POST /admin/flush`, `GET /mock/stats`, `POST /mock/reset`. На dev-инстансе :19081 чтение `/sets` открыто, запись закрыта — прод-конфиг нельзя переписать через API.
- **Проверки** (все зелёные на момент закрытия этапа):
  - `bun cascade-router/tests/config.test.ts` → 15 PASS (конфиг-дуализм v1/v2).
  - `bun cascade-router/tests/persist.test.ts` → 20 PASS (атомарность, рестарт, битый файл).
  - `bun cascade-router/tests/heal.test.ts` → 19 PASS (autoHeal).
  - `./scripts/cascade-router-test.sh` → 82 PASS / 0 FAIL (мок-сьют M1–M17 + T14/T15/T16 + Anthropic-форма). Внешних вызовов нет, квоты не расходуются.
  - Parity: старый 12 PASS / 0 FAIL, новый 13 PASS / 0 FAIL; diff = 12 совпадений, 3 осознанных отличия, **0 регрессий**. Эталон: `backups/task30/`.
- **Живые доказательства** (расход квот минимальный, `max_tokens=1`):
  - `live-failover` (qwen3-coder-next priority 1 → codestral-latest priority 2): qwen ответил 403/auth_error → фолбэк отдал mistral **200 за 1.25с, 2 попытки**. Второй запрос — 1 попытка, 0.30с: qwen пропущен целиком (auth sticky).
  - Auth-политика: `authError=true`, но `consecutiveFailures=0` — ключ помечен, breaker не растравливаем. Старое ядро на том же qwen даёт AUTH_ERROR (head-to-head совпал).
  - llm7 (`DeepSeek-V4-Flash-0731`): 200 за 0.48s.
  - Рестарт персиста: pid 75977 → 76090, breaker/history/probes пережили, qwen не вызывался повторно.
- Известные внешние блокеры (не код): ключи qwen (401) и groq (403) протухли — доступны обоим ядрам, поэтому 3 модели в проде числятся сломанными; Google AI Studio гео-заблокирован из этого egress. Коды провайдеров этапом 30 не менялись.

## 11. Прод на собственном ядре cascade-router (этап 3/3 закрыт — 2026-09-29)

- **Прод переключён**: `server/routerService.ts` спавнит `bun cascade-router/server.ts` (было — внешний npm-пакет роутера). Конфиг `cascade-run/router/config.json` и состояние — прежние прод-пути, значения `apiKeys`/`failover` сохранены 1-в-1.
- **Гейт этапа B пройден до списания legacy**: `scripts/regression.mjs` → 34 PASS / 6 WARN / 0 FAIL (все WARN — протухшие ключи qwen/groq и rate-limit llm7/tunnel, не регрессии), exit 0. Лог: `backups/task31/regression-after-switch.log`.
- **Имена**: только `cascade`, `cascade:fast-coding`, `cascade:@provider/model`. Короткий алиас снят и в фасаде, и в ядре (`DIALECTS`, `types.ts`, `server.ts`): старые формы и любые неизвестные id → 404 `model_not_found` через единый unknown-путь, без принятия запроса. `/v1/models` = 62 формы (2 основные + 60 сетевых).
- **Контент-валидация 200-х ответов добавлена в ядро** (`validateOkBody` в `router.ts`): провайдеры, отдающие HTTP 200 с телом-ошибкой (например OpenRouter `{"error":{...}}` без `choices`), теперь распознаются как провал модели → breaker + каскад дальше, вместо «200 с мусором» клиенту.
- **SSE**: стриминг идёт инкрементально (`ChatOutcome.sse` → `pipeSse`), заголовки SSE выставлены, двойной `[DONE]` устранён — opencode работает через `cascade/cascade`.
- **Зависимость списана**: пакет роутера удалён из `package.json`/`bun.lock`/`node_modules`; `/api/parse-models` и `/v1/models` строятся из собственного `cascade-router/catalog.json` + локальной карты провайдеров в `server.ts`.
- **Патчи и артефакты**: `patches/` → `backups/task31/patches-retired/`; `cascade-run/router-run.mjs` → `backups/task31/`; `upstream/`, каталог e2e-снимков под старый короткий алиас, `.aider.chat.history.md`, `.backups/hodA_*`, `package-lock.json`, авто-бэкаты старого конфига → `backups/task31/legacy-artifacts/`; файлы состояния из `~/` → `backups/task31/legacy-state/` и удалены.
- **Откат**: всё состоящее «до» — в `backups/task31/` (server.ts, routerService.ts, regression.mjs, package.json, bun.lock, прод-конфиг до переименования). Точка отката — `pre-regression prod-state + health` в `prod-state-before.txt`.
- **Известные внешние блокеры** (не код, ожидаемы): ключи qwen (401) и groq (403) протухли; Google AI Studio гео-заблокирован из egress. При полном свиче breakers стартуют с нуля и эти модели снова набирают `AUTH_ERROR` — это норма для чистого старта.

---

## 12. Аудит чистоты имён (задача 32 — 2026-09-29)

Полный скан проекта: содержимое (все расширения, бинарные включительно), имена файлов и каталогов,
скрытые файлы, артефакты сборок, lock-файлы, git-история.

**Результат: в живом проекте — 0 вхождений.** Проверено и то, чего прежний аудит не покрывал:
- **legacy-имя продукта** (в шаблоне задания оно не ловилось, т.к. между словами два символа) — найдено
  расширенным сканом в 6 местах: `<title>` и og-теги `index.html` (живой UI дашборда), корневой манифест,
  заголовок README и команда клонирования, шаблон промпта `opencode.json`, описание модели в API-метаданных,
  футер дашборда. Всё переименовано на `Cascade`.
- **Идентификатор константы отчёта о провайдерах** в `server.ts` (5 вхождений) → нейтральное имя.
- **System prompt** ядра в `dev-config.json` и `cascade-run/router/config.json` переформулирован.
- **Ссылка на несуществующий env** в `docs/CORE-SPEC.md` заменена описанием фактического поведения.
- **Удалён мусор**: пустой каталог `.backups/`, мёртвый sqlite-кэш тегов.
- **В архив** `backups/task32/legacy-artifacts/`: снапшот старого проекта (zip) и два артефакта
  прогона под старым коротким именем.
- **Пересобран `dist/`**: бандл фронта был от 24.09 и содержал старый футер; теперь соответствует `src/`.
- **`tsconfig.json`**: добавлены `include`/`exclude` — `tsc` больше не проверяет `backups/**`
  (иначе `bun run lint` падал на архивном файле со ссылкой на снесённый пакет). Lint чист.

### Легальные остатки — не чинить

1. `backups/**` — архив истории, 122 файла (класс 3).
2. `cascade-run/server-launchd.{out,err}` — R3-страж пишет отказы по старым коротким именам при проверках,
   vite дописывает `page reload` при перемещении файлов. Правильная работа стража (класс 2).
3. `bun.lock` — вхождение внутри sha512-хэша пакета `scheduler`; пакетов со следом legacy: 0 из 337 (класс 5).

Полная таблица «было → стало», эталонная команда перепроверки и обоснования по классам:
`backups/task32/audit-report.md` (архив — единственное место, где эти строки легальны).

### Функциональный долг P3 — ЗАКРЫТ (задача 33, 2026-09-29)

`P3 · cascade #2 → 503`: каскад исчерпывал потолок `MAX_ATTEMPTS_CAP=6`, и все 6 попыток уходили в одну
ветку одного провайдера (429/network_error при насыщении free-тира), 7-я — `lastResort` cloudflare (400)
→ 503, при том что в сете живые модели есть.

Закрыто (владелец выбрал гибрид из трёх):
1. **Мягкий пропуск провайдера по `rate_limit`**: 2 ответа `rate_limit` от одного провайдера в рамках
   одного запроса исключают его остальные модели из дальнейшего подбора (`rateLimitProviderSkipAfter`,
   дефолт 2). Только внутри `route()`: breaker, `blockedProviders` и `healthDamage` не меняются.
   Если после пропуска кандидатов не осталось — пропуск снимается (живые модели лучше 503).
2. **Потолок попыток 6 → 8** (`MAX_ATTEMPTS_CAP`, поле `failover.maxAttemptsCap`, дефолт 8).
   В потолок входят кандидаты каскада; `lastResort` — сверх него. `totalBudgetMs=120000` остаётся
   главным лимитом времени.
3. **Регрессия перестала считать внешнее кодом**: `rate_limit` (любой провайдер), `auth_error` у
   протухших ключей `qwen`/`groq` и сетевой туннель (`network_error`/`timeout`) дают **WARN**, а не FAIL.

Проверено: мок-сьют `105 PASS / 0 FAIL` (добавлены M18–M21), dev-инстанс `:19081` на копии прод-конфига
показал `attempts=8` там, где раньше было 6, и серию 200; регрессия — см. §13.

## 13. Хронология (changelog)

| Дата | Задача | Итог |
|---|---|---|
| 2026-09-29 | 33 — rate-limit-aware пропуск провайдера, потолок попыток 8, P2 по причинам | Каскад перестаёт жечь попытки в одной ветке; внешние деградации — WARN |
| 2026-10-09 | 35 — внутреннее переименование FACMP → Cascade (модель-id/провайдер, env `CASCADE_ROUTER_*`, заголовки `x-cascade-*`, каталоги `cascade-router`/`cascade-run`, доки/UI) | Живое дерево чистое; прежние формы → 404; launchd-лейблы `com.facmp.*` сохранены; публикация — задача 7 |
| 2026-10-09 | 36 — URL подписки конфигурируем (только в конфиге `vpn.subscriptionUrl`, в коде сервера отсутствует); example-файлы в `configs/`; снапшот для публикации | `vpnService` читает URL только из конфига, пусто → ретранслятор disabled graceful; в example-файлах секретов 0 |
