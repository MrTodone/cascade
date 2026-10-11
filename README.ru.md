# Cascade — роутер моделей ИИ и VLESS-Reality ретранслятор

> Cascade — локальный ИИ-шлюз для агентов кодинга: один OpenAI-совместимый endpoint (http://localhost:3000/v1) перед каскадом из 60 бесплатных моделей кодинга от 6+ провайдеров с автоматическим фейловером — вы не увидите отказа, пока жива хотя бы одна модель. Подключается к opencode, Continue, Cline, Aider или любому OpenAI-совместимому клиенту. Встроенный VLESS-Reality ретранслятор направляет через туннель только геоблокированных провайдеров; всё остальное идёт напрямую.

**[English](README.md)**

---

## Содержание
1. [Возможности](#возможности)
2. [Архитектура](#архитектура)
3. [Быстрый старт](#быстрый-старт)
4. [Подключение агентов](#подключение-агентов)
5. [Идентификаторы моделей](#идентификаторы-моделей)
6. [VPN-ретранслятор](#vpn-ретранслятор)
7. [Безопасность](#безопасность)
8. [Тестирование и развитие](#тестирование-и-развитие)
9. [Документация](#документация)
10. [Скриншоты](#скриншоты)
11. [FAQ](#faq)
12. [Лицензия](#лицензия)

---

## Возможности

- **Каскад из 60 моделей, 6+ провайдеров** — активный набор (`fast-coding`) упорядочен по приоритету провайдера и скорингу каждой модели; роутер идёт по каскаду, пока одна из моделей не ответит.
- **Автоматический фейловер** — на HTTP 429 / исчерпание квоты / 5xx / таймауты / некорректные тела ответов. Проверка контента ловит и «HTTP 200 с ошибкой в теле», трактуя её как сбой.
- **Circuit breakers** — CLOSED / DEGRADED / OPEN / HALF_OPEN с нарастающей паузой, quota-pause с учётом `Retry-After`, кэш проб, пометка стабильных auth-ошибок, пропуск провайдера, последняя запасная модель (`lastResort`) и `autoHeal`.
- **Честный роутинг** — три явные формы: `cascade` (авто-каскад), `cascade:<набор>` (именованный набор), `cascade:@<провайдер>/<модель>` (жёсткий пин, фейловер выключен). Неизвестный id → `404 model_not_found`; голая строка `provider/model` — не пин и обрабатывается как обычный запрос каскада.
- **Собственное ядро роутера** на `:19080` — HTTP API, SSE-стриминг, Anthropic-совместимый `/v1/messages`, конфиг v1/v2 с атомарными записями, персистентное состояние (брейкеры, квоты, пробы, история).
- **Собственный каталог моделей — 530 записей с происхождением** (`cascade-router/catalog.json`: поле provider/model/tier/score/context/provenance/note), пересобирается скриптом `scripts/catalog-bootstrap.mjs`.
- **Встроенный VLESS-Reality ретранслятор** — парсит вашу подписку, пробивает egress каждого узла параллельными процессами sing-box, выбирает узел по результатам проб, проверяет кандидатов предпроверкой `sing-box check`, откатывается на последнюю рабочую конфигурацию и использует политику NO_PROXY, чтобы через туннель шли только геоблокированные провайдеры.
- **Веб-дашборд** (React + Vite + Tailwind) — каталог с фильтрами, панель каскада (Auto/Manual), менеджер VPN, песочница кода.
- **Безопасность** — всё слушает только `127.0.0.1` (включая Vite dev-сервер), ключи провайдеров живут только на бэкенде (в UI — лишь `hasApiKey`), статусы маскируются.
- **Эксплуатация** — launchd KeepAlive-шаблоны в `configs/launchd/` (метки `com.cascade.*`), регрессионный прогон `scripts/regression.mjs` (PASS / WARN / FAIL).

## Архитектура

```
агенты (opencode / Continue / Cline / Aider / любой OpenAI-совместимый клиент)
  │  OpenAI-совместимый HTTP → http://127.0.0.1:3000/v1
  ▼
facade :3000  (OpenAI-совместимый API + дашборд)
  │
  ▼
router :19080  (ядро каскада: 60 моделей / 6+ провайдеров, фейловер)
  │
  ├── [провайдеры] напрямую (NO_PROXY)
  └── sing-box :10808 (VLESS-Reality) → [провайдеры] только геоблокированные
```

Стек: **Bun 1.4.2 · TypeScript · Express · React · Vite · Tailwind · sing-box 1.14.1** (известный дефект: транспорт `xhttp` не поддерживается sing-box 1.14.1 — см. [FAQ](#faq)).

## Быстрый старт

Требования:
- **Bun 1.4.2+** (единый рантайм: установка зависимостей, запуск, сборка, тесты).
- **sing-box** — опционально, только для VLESS-Reality ретранслятора: `brew install sing-box`.
- **Платформы:** macOS / Linux / Windows — ядро шлюза работает нативно на всех трёх (Bun выпускает официальные сборки); launchd-шаблоны сервисов (`configs/launchd/`) — только macOS.

```sh
git clone https://github.com/MrTodone/cascade
cd cascade
bun install

# 1) Конфиг роутера (обязателен — без него ядро не стартует):
cp configs/router.config.example.json cascade-run/router/config.json
#    затем замените каждый YOUR_<PROVIDER>_KEY в этом файле на реальный ключ.
#    Провайдер без ключа просто не активен (hasApiKey = false).

# 2) Опциональные ключи facade (песочница / генерация кода):
cp .env.example .env
#    заполните GEMINI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY.

# 3) Запуск (dev, скрипты из package.json; для продакшн-сборки —
#    `bun run build`, затем `bun run start`):
bun run dev

# 4) Проверка:
curl http://localhost:3000/v1/models
```

**Первый запуск без конфига:** facade стартует, но ядро роутера не поднимается — загрузчик конфига падает с ENOENT, и `/v1` отвечает **503**. Поэтому шаг 1 обязателен.

Направьте агента на `http://localhost:3000/v1` — готово.

### npm (рекомендуется)

Публикуемый пакет содержит **готовый самодостаточный бандл** — установка **не запускает сборку** и
не тянет **инструменты сборки** (ни Vite, ни esbuild, ни TypeScript, ни Bun). Нужен только **Node.js >= 22**.

Из реестра npm:

```bash
npm i -g @mrtodone/cascade
cascade --version
cascade start        # facade на http://127.0.0.1:3000, роутер на 127.0.0.1:19080
```

Тот же пакет напрямую из GitHub Releases:

```bash
npm install -g https://github.com/MrTodone/cascade/releases/download/v0.4.0/cascade-npm-v0.4.0.tgz
```

Данные пользователя (конфиг, `.env`, состояние туннеля) лежат в `~/.cascade` — каталог меняется
переменной `CASCADE_HOME=/some/dir cascade start`.

### Docker

```bash
docker run -d --name cascade \
  -p 3000:3000 -p 19080:19080 \
  -v cascade-data:/data \
  ghcr.io/mrtodone/cascade:v0.4.0
```

или, из репозитория: `docker compose up -d`. Данные сохраняются в томе `/data`
(`CASCADE_HOME=/data`). Доступные теги: `latest`, `v0.4.0`, `0.4`.

### Готовые сборки (v0.4.0)

Самодостаточные сборки — **Node.js и Bun не нужны**: рантайм Bun, ядро роутера и sing-box уже внутри.
Скачивайте со страницы [Releases](https://github.com/MrTodone/cascade/releases); проверяйте по `SHA256SUMS`
(`sha256sum -c SHA256SUMS` в Linux, `shasum -a 256 -c SHA256SUMS` в macOS).

| Платформа | Ассет | Менеджер туннеля |
|---|---|---|
| **npm** (любая ОС) | `cascade-npm-v0.4.0.tgz` | наследуется от контракта хоста |
| **Docker** (linux/amd64) | `ghcr.io/mrtodone/cascade:v0.4.0` | `builtin` |
| **Windows x64** | `cascade-v0.4.0-windows-x64.zip` | `builtin` (в комплекте `sing-box.exe`) |
| **Linux x64** | `cascade-v0.4.0-linux-x64.tar.gz` | `builtin` (в комплекте `bin/sing-box`) |
| **macOS arm64** | из исходников (ниже) | `launchd` |

**Windows.** Распакуйте zip в любое место и запустите `START-Cascade.cmd`. При первом запуске SmartScreen
может показать «Windows protected your PC» — нажмите **More info → Run anyway** (файл не подписан; это тот самый
файл, что вы скачали из этого репозитория). Браузер откроет http://localhost:3000 с мастером первого запуска:
вставьте ключи хотя бы одного провайдера и сохраните. Подробности — в `README-WINDOWS.txt` внутри zip.

**Linux.**

```sh
tar xzf cascade-v0.4.0-linux-x64.tar.gz
cd cascade-v0.3.0-linux-x64
./START-cascade.sh          # или: ./cascade  (запускать из распакованного каталога)
```

Для автозапуска через systemd — шаблоны в `configs/systemd/`; полное руководство — в
[`README-LINUX.txt`](README-LINUX.txt).

**Менеджер туннеля** (`vpn.tunnelManager`): `auto` (по умолчанию) выбирает `launchd` в macOS и `builtin` в
Windows/Linux; `builtin` поднимает встроенный sing-box дочерним процессом фасада; `external` только опрашивает
уже запущенный туннель. Активный менеджер виден в `GET /api/vpn/status` → `manager`; кнопка **Стоп** в
дашборде (`POST /api/app/shutdown`) корректно гасит роутер и туннель и завершает процесс на всех платформах.

### Из исходников (для разработчиков)

Только для контрибьюторов — конечным пользователям подходят каналы выше. Сборка выполняется локально:

```bash
git clone https://github.com/MrTodone/cascade
cd cascade
npm install
node scripts/build-npm.mjs
node bin/cascade.js start      # или: npm link, затем `cascade start`
```

## Подключение агентов

**opencode** — добавьте локального провайдера (см. `configs/opencode.example.json`):

```json
{
  "provider": {
    "cascade": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:3000/v1", "apiKey": "cascade-local" },
      "models": { "cascade": { "name": "Cascade auto-router" } }
    }
  },
  "model": "cascade/cascade"
}
```

**Continue** (`~/.continue/config.json`):

```json
{
  "models": [{
    "title": "Cascade",
    "provider": "openai",
    "model": "cascade",
    "apiBase": "http://localhost:3000/v1",
    "apiKey": "local"
  }]
}
```

**Cline** — Settings → OpenAI-compatible provider: `Base URL: http://localhost:3000/v1`, `API Key: любой`, модель `cascade`.

**Aider**:

```sh
aider --openai-api-base http://localhost:3000/v1 --openai-api-key dummy --model cascade/cascade
```

Любой другой OpenAI-совместимый клиент подключается так же.

## Идентификаторы моделей

| ID | Значение |
|---|---|
| `cascade` | Авто-каскад по активному набору (`fast-coding`, 60 моделей) |
| `cascade:<набор>` | Конкретный именованный набор (например, `cascade:fast-coding`) |
| `cascade:@<провайдер>/<модель>` | **Жёсткий пин** — ровно одна модель, фейловер выключен (мёртвый пин → `502`) |
| что-либо ещё | `404 model_not_found` (голая строка `provider/model` обрабатывается как запрос каскада, а не пин) |

## VPN-ретранслятор

**Зачем.** Некоторые бесплатные AI-провайдеры (например, Google AI Studio) геоблокируются из отдельных регионов. Cascade содержит встроенный VLESS-Reality ретранслятор, который через исходящий туннель направляет *только* таких геоблокированных провайдеров; все остальные работают напрямую. Браузер, игры и локальные сервисы не затрагиваются.

**Подписка своя (bring-your-own).** URL подписки задаётся **только** в конфиге (`vpn.subscriptionUrl`) и никогда — в коде или примерах. Пустое/отсутствующее значение = ретранслятор корректно выключен: прямые провайдеры продолжают работать, а геоблокированные просто выпадают через каскад. Когда URL задан, `server/vpnService.ts` ежечасно перечитывает подписку, пробивает egress каждого узла параллельными процессами sing-box и применяет лучшего кандидата.

- Конфиг: `cascade-run/router/config.json` → `vpn.subscriptionUrl` (ваш собственный URL).
- Для существующей macOS-установки со своей launchd-меткой: `vpn.singboxServiceLabel`. Пусто = дефолт `com.cascade.singbox`; при миграции укажите фактическую метку сервиса (публичные примеры в `configs/launchd/` используют `com.cascade.*`).

**Установка sing-box:**

```sh
brew install sing-box
```

**launchd-шаблоны** (`configs/launchd/`): `com.cascade.server.plist.example` (facade) и `com.cascade.singbox.plist.example` (туннель). В них плейсхолдеры `<BUN_BIN>`, `<CASCADE_ROOT>`, `<SINGBOX_BIN>`, `<SUBSCRIPTION_HOST>` — подставьте значения под свою машину.

**Поддержка ОС, честно:** macOS — полный функционал (launchd KeepAlive + автоматическое управление туннелем). **Linux (v0.3.0+)** и **Windows (v0.2.0+)** — ядро шлюза работает нативно из готовых сборок, а туннель управляется менеджером `builtin` (фасад поднимает встроенный sing-box дочерним процессом и направляет трафик). Автоматическое управление сервисами: launchd-шаблоны для macOS (`configs/launchd/`) и systemd-юниты для Linux (`configs/systemd/`); в Windows установщика сервиса пока нет — запускайте `START-Cascade.cmd` напрямую или подключайте через Планировщик заданий / NSSM. См. [FAQ](#faq) — полная матрица.

**Политика NO_PROXY:** напрямую — loopback ipv4/ipv6, Google AI Studio, Cloudflare, OrcaRouter, консоль Groq, GitHub, HuggingFace, ollama.com, Mistral, LLM7, DashScope/Qwen, Z.ai. Трафик к OpenRouter и API-хосту Groq идёт через туннель (:10808).

**Известный дефект:** sing-box 1.14.1 не понимает транспорт `xhttp` — такие узлы не проходят предпроверку и пропускаются; `sing-box check` завершается FATAL. Лечение — апгрейд sing-box или отсев кандидатов с `xhttp` (в v1 не исправлено, отслеживается).

**Дисклеймер.** Бесплатные апстрим-провайдеры ограничены собственными квотами; каскад лишь скрывает отказы от агента, пока отвечает хотя бы одна модель. Ретранслятор предназначен для легитимных гео-ограничений — уважайте Terms of Service провайдеров и местные законы.

## Безопасность

- Facade слушает **только** `127.0.0.1` (закреплено в `server.ts`); Vite dev-прокси/HMR тоже привязаны к loopback. Доступ к `:3000` или `:24678` по сети запрещён.
- `/v1` — только localhost, и, как поставляется, без аутентификации — не открывайте его наружу.
- Ключи провайдеров — только на бэкенде. Дашборд получает лишь булевы `hasApiKey`.
- Статусы и ответы маскируются: ip обрезаются/маскируются, uuid/pbk/sid/сырые URL узлов не возвращаются никогда.
- Честный HTTP 413 на тела >10 МБ.
- Защита от DNS-rebinding в роутере (принимаются только хосты `127.0.0.1`, `localhost`, `::1`).

## Тестирование и развитие

Офлайн (без ключей, без сети, одна машина):

```sh
bun run lint                       # tsc --noEmit
./scripts/cascade-router-test.sh   # mock-сьют: 113 PASS / 0 FAIL
bun cascade-router/tests/config.test.ts   # 15 PASS
bun cascade-router/tests/persist.test.ts  # 20 PASS
bun cascade-router/tests/heal.test.ts     # 19 PASS
```

Живая регрессия (нужен запущенный роутер; для части проверок — ключи провайдеров):

```sh
bun scripts/regression.mjs   # PASS / WARN / FAIL; внешняя деградация → WARN, не FAIL
```

См. [CONTRIBUTING.md](CONTRIBUTING.md).

## Документация

- [OPERATIONS.md](docs/OPERATIONS.md) — порты, архитектура, план восстановления.
- [CORE-SPEC.md](docs/CORE-SPEC.md) — clean-room спецификация ядра (почему внешних патчей роутера нет).

## Скриншоты

<!-- Скриншоты лежат в docs/screenshots/. Раскомментируйте те, что загрузите.
<img src="docs/screenshots/dashboard.png" width="800" alt="Dashboard">
<img src="docs/screenshots/cascade-panel.png" width="800" alt="Cascade panel">
<img src="docs/screenshots/vpn-manager.png" width="800" alt="VPN manager">
-->

## FAQ

**Это форк?** Нет. У Cascade собственная архитектура и собственное ядро. Проект начинался как обёртка над MIT-пакетом `free-coding-models`, затем механика была переписана с нуля (clean-room, спецификация в `docs/CORE-SPEC.md`) и все внешние пакеты/патчи роутера удалены. Два контрибьют-пулл-реквеста приняты в апстрим.

**Нужны ли API-ключи?** Только для тех провайдеров, которые вы хотите использовать, — это бесплатные модели. Провайдер без ключа просто не активен.

**Нужны ли Bun или Node?** Нет — готовые сборки (zip для Windows, tar.gz для Linux) самодостаточны: рантайм Bun, ядро роутера и sing-box уже внутри. Для каналов npm и Docker нужен только **Node.js >= 22** (в tarball уже готовая сборка — ни сборки, ни инструментов сборки). Bun нужен только для запуска из исходников.

**Работает ли без VPN / sing-box?** Да. Прямые провайдеры работают сразу; геоблокированные корректно выпадают через каскад. Ретранслятор стартует только при заданном `vpn.subscriptionUrl`.

**Какая ОС?** macOS — полный функционал, включая launchd-шаблоны сервисов (`configs/launchd/`). **Linux (v0.3.0+)** — готовая сборка `cascade-v0.4.0-linux-x64.tar.gz`, менеджер туннеля `builtin` (в комплекте sing-box), systemd-юниты в `configs/systemd/`. **Windows (v0.2.0+)** — готовая сборка (`cascade.exe` + `cascade-router.exe`), в комплекте `sing-box.exe`, мастер первого запуска, `START-Cascade.cmd`, менеджер туннеля `builtin`. Установка сервисов вне macOS — вручную (systemd / Планировщик заданий / NSSM). Проект разрабатывается и покрыт регрессионными тестами на macOS; ядро шлюза на Linux и Windows ожидаемо работает, но живая регрессия — только macOS.

**Безопасны ли мои ключи?** Они остаются локальными на бэкенде, который слушает только loopback; дашборд их не получает.

**А лимиты?** Бесплатные тарифы автоматически ротируются через каскад; логика брейкера/квот держит число повторов ограниченным и на запрос, и на провайдера.

**Почему без конфига ничего не стартует?** Конфиг обязателен для ядра роутера: `cp configs/router.config.example.json cascade-run/router/config.json`.