Cascade — Windows build v0.2.0
===============================

A local router for free AI models. Everything is local — nothing installs to
the system.

CONTENTS
--------
  cascade.exe                 The dashboard server (web UI + API, port 3000)
  cascade-router.exe          Router core (spawned by cascade.exe on port 19080)
  sing-box.exe   (+libcronet.dll)  VLESS Reality tunnel binary (optional use)
  dist/                        Web dashboard (served by cascade.exe on port 3000)
  cascade-router/catalog.json  Model catalog
  configs/                     Example configs
  START-Cascade.cmd            Double-click to launch
  README-WINDOWS.txt           This file
  licenses/                    Third-party licenses (sing-box — GPLv3)

QUICK START
-----------
1. Unpack the zip to any folder (e.g. C:\Cascade).
2. Double-click START-Cascade.cmd (or run cascade.exe).
   First launch: Windows SmartScreen shows "Windows protected your PC" —
   click "More info" -> "Run anyway". This is normal for unsigned apps; the
   file is the one you downloaded from GitHub Releases.
3. Your browser opens http://localhost:3000 — the first-run wizard appears.
   Paste API keys for at least one provider and click "Save and start".
4. That's it. The dashboard now routes free AI models to your keys.

TUNNEL (OPTIONAL)
-----------------
- The VPN tunnel (VLESS Reality) is optional and OFF by default. Direct
  providers keep working without it.
- To enable it: open the VPN panel in the dashboard and paste your vless://
  subscription URL, then sync. cascade.exe manages sing-box.exe as a child
  process (no services, no extra install).
- Note: live egress has not been exercised in CI on Windows; if a subscription
  node fails, the relay disables gracefully and direct providers keep working.

STOPPING
--------
- Close the console window that runs cascade.exe, or Ctrl+C in it.
- Escalation fallback (e.g. from Task Manager):
    taskkill /IM cascade.exe /F

AUTO-START WITH WINDOWS (OPTIONAL)
----------------------------------
1. Win+R -> "taskschd.msc" -> Create Task.
2. General: run only when user is logged on, "Run with highest privileges".
3. Trigger: "At logon".
4. Action -> Start a program:
     Program/script: C:\Cascade\START-Cascade.cmd
     Start in:        C:\Cascade

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

Cascade — Windows-сборка v0.2.0
===============================

Локальный роутер бесплатных AI-моделей одним файлом. Всё лежит в этой папке —
ничего не ставится в систему.

СОДЕРЖИМОЕ
----------
  cascade.exe                 Сервер дашборда (веб-интерфейс + API, порт 3000)
  cascade-router.exe          Ядро роутера (запускается cascade.exe на порту 19080)
  sing-box.exe   (+libcronet.dll)  Бинарь VLESS Reality-туннеля (опционально)
  dist/                        Веб-дашборд (раздаёт cascade.exe на порту 3000)
  cascade-router/catalog.json  Каталог моделей
  configs/                     Примеры конфигов
  START-Cascade.cmd            Запуск двойным кликом
  README-WINDOWS.txt           Этот файл
  licenses/                    Лицензии сторонних компонентов (sing-box — GPLv3)

БЫСТРЫЙ СТАРТ
-------------
1. Распакуйте zip в любую папку (например C:\Cascade).
2. Запустите START-Cascade.cmd двойным кликом (или cascade.exe).
   При первом запуске Windows SmartScreen покажет «Windows защитил ваш ПК» —
   нажмите «Подробнее» -> «Выполнить в любом случае». Это нормально для
   неподписанных приложений; файл тот самый, что вы скачали из GitHub Releases.
3. Откроется браузер http://localhost:3000 — появится мастер первого запуска.
   Вставьте API-ключ хотя бы одного провайдера и нажмите «Save and start».
4. Готово: дашборд маршрутизирует бесплатные модели через ваши ключи.

ТУННЕЛЬ (ОПЦИОНАЛЬНО)
---------------------
- VPN-туннель (VLESS Reality) необязателен и по умолчанию ВЫКЛЮЧЕН. Прямые
  провайдеры работают и без него.
- Включение: в дашборде откройте VPN-панель, вставьте vless://-подписку и
  нажмите sync. cascade.exe держит sing-box.exe дочерним процессом (никаких
  служб и установок).
- Примечание: сквозной egress на Windows в CI не гонялся; если узел подписки
  не проходит, релей корректно отключается, прямые провайдеры продолжают работать.

ОСТАНОВКА
---------
- Закройте консольное окно cascade.exe (или Ctrl+C в нём).
- Запасной вариант (например из Диспетчера задач):
    taskkill /IM cascade.exe /F

АВТОЗАПУСК С WINDOWS (ОПЦИОНАЛЬНО)
----------------------------------
1. Win+R -> «taskschd.msc» -> «Создать задачу».
2. «Общие»: только когда пользователь вошёл в систему, «Выполнять с наивысшими правами».
3. «Триггеры»: «При входе в систему».
4. «Действия» -> «Запуск программы»:
     «Программа или сценарий»: C:\Cascade\START-Cascade.cmd
     «Рабочая папка»:           C:\Cascade

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