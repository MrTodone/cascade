Cascade — Linux build v0.3.0
=============================

A local router for free AI models. Everything is local — nothing installs to
the system (no root, no packages).

CONTENTS
--------
  cascade                     The dashboard server (web UI + API, port 3000)
  cascade-router.bin          Router core (spawned by cascade on port 19080)
  bin/sing-box                VLESS Reality tunnel binary (optional use, :10808)
  dist/                        Web dashboard (served by cascade on port 3000)
  cascade-router/catalog.json  Model catalog
  configs/                     Example configs (incl. configs/systemd/)
  START-cascade.sh             Launch script (starts cascade + opens browser)
  README-LINUX.txt             This file
  licenses/                    Third-party licenses (sing-box — GPLv3)

QUICK START
-----------
1. Unpack the tarball to any folder (e.g. ~/Cascade):
     tar xzf cascade-v0.3.0-linux-x64.tar.gz
2. Run the launcher (bind mounts to localhost only):
     cd cascade-v0.3.0-linux-x64 && ./START-cascade.sh
   If the binaries lost their execute bit (some archivers), restore it:
     chmod +x cascade cascade-router.bin bin/sing-box START-cascade.sh
2a. No FUSE / no exec? Nothing to install — the binaries are static; just make
    sure the filesystem allows exec (not a noexec mount).
3. Your browser opens http://localhost:3000 — the first-run wizard appears.
   Paste API keys for at least one provider and click "Save and start".
4. That's it. The dashboard now routes free AI models to your keys.

TUNNEL (OPTIONAL)
-----------------
- The VPN tunnel (VLESS Reality) is optional and OFF by default. Direct
   providers keep working without it.
- To enable it: open the VPN panel in the dashboard and paste your vless://
   subscription URL, then sync. On Linux the facade manages sing-box as a
   child process (vpn.tunnelManager="auto" → "builtin"; no services needed).
- Prefer systemd to supervise sing-box instead? Install
  configs/systemd/cascade-singbox.service.example (see the file header) and set
  vpn.tunnelManager="external" in cascade-run/router/config.json.
- Note: live egress on Linux targets the pinned sing-box build; if a subscription
  node fails, the relay disables gracefully and direct providers keep working.

STOPPING
--------
- Ctrl+C in the terminal running cascade, or POST /api/app/shutdown.
- Escalation fallback:
    pkill -f cascade-router.bin; pkill -x cascade; pkill -x sing-box

AUTO-START WITH SYSTEMD (OPTIONAL)
----------------------------------
1. mkdir -p ~/.config/systemd/user
2. cp configs/systemd/cascade-server.service.example ~/.config/systemd/user/cascade-server.service
3. Edit it: replace <CASCADE_ROOT> (absolute path to this folder) and
   <SUBSCRIPTION_HOST>.
4. systemctl --user daemon-reload && systemctl --user enable --now cascade-server.service
5. To keep it running after logout: loginctl enable-linger "$USER"

FILES AND PRIVACY
-----------------
- API keys are stored ONLY locally, next to the app:
    cascade-run/router/config.json
  Nothing is uploaded anywhere; the dashboard only reports whether a provider
  has a key (hasApiKey), never the value.

VERSIONING / SOURCE
-------------------
- App source:     https://github.com/MrTodone/cascade
- sing-box (GPLv3) bundled in this package — binary from
  https://github.com/SagerNet/sing-box/releases/tag/v1.14.1
- License texts: licenses/
================================================================

Cascade — Linux-сборка v0.3.0
==============================

Локальный роутер бесплатных AI-моделей. Всё лежит в этой папке — ничего не
ставится в систему (без root и без пакетов).

СОДЕРЖИМОЕ
----------
  cascade                     Сервер дашборда (веб-интерфейс + API, порт 3000)
  cascade-router.bin          Ядро роутера (запускается cascade на порту 19080)
  bin/sing-box                Бинарь VLESS Reality-туннеля (опционально, :10808)
  dist/                        Веб-дашборд (раздаёт cascade на порту 3000)
  cascade-router/catalog.json  Каталог моделей
  configs/                     Примеры конфигов (в т.ч. configs/systemd/)
  START-cascade.sh             Скрипт запуска (стартует cascade + открывает браузер)
  README-LINUX.txt             Этот файл
  licenses/                    Лицензии сторонних компонентов (sing-box — GPLv3)

БЫСТРЫЙ СТАРТ
-------------
1. Распакуйте архив в любую папку (например ~/Cascade):
     tar xzf cascade-v0.3.0-linux-x64.tar.gz
2. Запустите:
     ./START-cascade.sh
3. Откроется браузер http://localhost:3000 — появится мастер первого запуска.
   Вставьте API-ключ хотя бы одного провайдера и нажмите «Save and start».
4. Готово: дашборд маршрутизирует бесплатные модели через ваши ключи.

ТУННЕЛЬ (ОПЦИОНАЛЬНО)
---------------------
- VPN-туннель (VLESS Reality) необязателен и по умолчанию ВЫКЛЮЧЕН. Прямые
  провайдеры работают и без него.
- Включение: в дашборде откройте VPN-панель, вставьте vless://-подписку и
  нажмите sync. cascade держит sing-box дочерним процессом
  (tunnelManager=builtin по умолчанию на Linux).
- Хотите, чтобы sing-box супервизил systemd? Установите
  configs/systemd/cascade-singbox.service.example (см. заголовок файла) и
  выставьте vpn.tunnelManager="external" в cascade-run/router/config.json.
- Примечание: если узел подписки не проходит, релей корректно отключается,
  прямые провайдеры продолжают работать.

ОСТАНОВКА
---------
- Ctrl+C в терминале с cascade, либо POST /api/app/shutdown.
- Запасной вариант:
    pkill -f cascade-router.bin; pkill -x cascade; pkill -x sing-box

АВТОЗАПУСК С SYSTEMD (ОПЦИОНАЛЬНО)
----------------------------------
1. mkdir -p ~/.config/systemd/user
2. cp configs/systemd/cascade-server.service.example ~/.config/systemd/user/cascade-server.service
3. Отредактируйте: замените <CASCADE_ROOT> (абсолютный путь к этой папке) и
   <SUBSCRIPTION_HOST>.
4. systemctl --user daemon-reload && systemctl --user enable --now cascade-server.service
5. Чтобы сервис жил после выхода из системы: loginctl enable-linger "$USER"

ФАЙЛЫ И ПРИВАТНОСТЬ
-------------------
- API-ключи хранятся ТОЛЬКО локально, рядом с приложением:
    cascade-run/router/config.json
  Никуда не загружаются; дашборд сообщает лишь наличие ключа провайдера
  (hasApiKey), никогда — его значение.

ВЕРСИЯ / ИСХОДНИКИ
------------------
- Исходники приложения: https://github.com/MrTodone/cascade
- sing-box (GPLv3) в комплекте — бинарь из
  https://github.com/SagerNet/sing-box/releases/tag/v1.14.1
- Тексты лицензий: licenses/
