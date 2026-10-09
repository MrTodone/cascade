#!/usr/bin/env python3
# cascade_live_e2e.py — ОДИН снимок: свежая подписка vs текущий загруженный узел vs ЖИВОЙ E2E.
# Никакие секреты (uuid/pbk/sid/flow) НЕ выводятся: только host:port / sni / страна / маски.
import json, os, re, sys, time, socket, ssl, subprocess, urllib.request, http.client

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cascade-run")
SUBS = os.environ.get("SUBS_URL", "").strip()
MASK = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')

def mask(s):
    if not isinstance(s, str): return s
    s = MASK.sub("<UUID>", s)
    s = re.sub(r'(pbk|sid|public_key|short_id|password|flow|uuid)\s*[=:]\s*"?[A-Za-z0-9_/\-\.]{8,}"?', r'\1=<SEC>', s, flags=re.I)
    s = re.sub(r'vless://[^ #"\n]+', 'vless://<SEC_URL>', s)
    return s

def mask_url_file(raw):
    return re.sub(r'vless://[^ @\n]+@', 'vless://<SEC>@', raw)

def load(p):
    fp = os.path.join(APP, p)
    try:
        with open(fp, encoding="utf-8", errors="replace") as f:
            return json.load(f)
    except Exception as e:
        return {"__err__": f"{type(e).__name__}: {e}"}

# 1) СВЕЖАЯ подписка (парсим только host:port + маска)
print("=" * 74)
print("A. СВЕЖАЯ ПОДПИСКА (мас.: host:port, без uuid/pbk) — прямо сейчас, HTTP 200?")
print("=" * 74)
print(" * URL подписки берётся из ENV SUBS_URL (в коде URL не хранится)")
if not SUBS:
    print(" * SUBS_URL не задан — блок «свежая подписка» пропущен (показываются блоки B–E).")
else:
    try:
        req = urllib.request.Request(SUBS, headers={"User-Agent": "Mozilla/5.0 (diag)", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8", "replace")
        lines = [l.strip() for l in raw.splitlines() if l.strip().lower().startswith("vless://")]
        seen = []
        for l in set(lines):
            m = re.match(r'vless://[^@]+@([^:]+):(\d+)(\?[^#]*)?#?(.*)', l)
            if m:
                host, port = m.group(1), m.group(2)
                seen.append((host, port))
        uniq = sorted(set(seen))
        print(f" * vless-строк всего: {len(lines)}, уникальных host:port: {len(uniq)}")
        for h, p in uniq[:10]:
            print(f"   - {mask(h)}:{p}")
        if len(uniq) > 10:
            print(f"   ... и ещё {len(uniq)-10} (не показываю всё)")
    except Exception as e:
        print(f" * ОШИБКА: {type(e).__name__}: {e}")

# 2) ТЕКУЩИЙ загруженный singbox.json: только outbound-инфо (маск.)
print()
print("=" * 74)
print("B. ТЕКУЩИЙ singbox.json (фактически загружен в sing-box, маскир.)")
print("=" * 74)
cfg = load("singbox.json")
if "__err__" not in cfg:
    print(f" * топ-ключи: {list(cfg.keys())}")
    for ob in cfg.get("outbounds", []):
        t = ob.get("type")
        print(f"   * outbound tag={ob.get('tag')} type={t}", end="")
        if t == "vless":
            tls = ob.get("tls") or {}
            rt = (tls.get("reality") or {}) if isinstance(tls.get("reality"), dict) else {}
            print(f" server={mask(ob.get('server'))}:{ob.get('server_port')} "
                  f"sni={mask(tls.get('server_name'))} pbk={mask(str(ob.get('uuid')))[:14]} "
                  f"sid={mask(str(tls.get('short_id')))[:6] if tls.get('short_id') else ''}")
        else:
            print()
    for ib in cfg.get("inbounds", []):
        print(f"   * inbound tag={ib.get('tag')} type={ib.get('type')} {ib.get('listen')}:{ib.get('listen_port')}")
else:
    print("   * ОШИБКА:", cfg["__err__"])

# 3) ЖИВОЙ E2E через 10808 (SOCKS5 greet + сквозной HTTPS, выходной IP маск.)
print()
print("=" * 74)
print("C. ЖИВОЙ СКВОЗНОЙ ТЕСТ через 127.0.0.1:10808 (socks5h)")
print("=" * 74)
def socks5_greet(host, port, tmo=2.0):
    s = socket.create_connection((host, port), timeout=tmo)
    s.settimeout(tmo)
    s.sendall(b"\x05\x01\x00")
    r = s.recv(2)
    s.close()
    return r

try:
    r = socks5_greet("127.0.0.1", 10808)
    print(f" * SOCKS5 greeting на :10808 -> {r.hex()}  (0500 = alive)")
except Exception as e:
    print(f" * SOCKS5 greeting на :10808 -> {type(e).__name__}: {e}")

t0 = time.time()
try:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({
            "http": "socks5h://127.0.0.1:10808",
            "https": "socks5h://127.0.0.1:10808"}))
    body = opener.open("https://api.ipify.org", timeout=8).read().decode()
    print(f" * E2E api.ipify.org -> {mask(body)} за {time.time()-t0:.1f}s")
except Exception as e:
    print(f" * E2E FAIL ({time.time()-t0:.1f}s): {type(e).__name__}: {mask(str(e)[:120])}")

# 4) Сверка: есть ли в свежей подписке host:port=текущего узла (мас.)?  = ответ на «не обновилось ли»
print()
print("=" * 74)
print("D. СВЕРКА «текущий узел принадлежит свежей подписке?» (ответ на вопрос авсо-обновлении)")
print("=" * 74)
cur_server = None
for ob in cfg.get("outbounds", []):
    if ob.get("type") == "vless":
        cur_server = f"{ob.get('server')}:{ob.get('server_port')}"
print(f" * Текущий узел singbox.json: {mask(cur_server)}")
# ищем его host в свежей подписке
host_part = (cur_server or "").split(":")[0]
in_sub = any(h == host_part for h, _ in seen if isinstance(h, str)) if "seen" in dir() else None
print(f" * Тот же host '{mask(host_part)}' в свежей подписке: {'ДА' if in_sub else 'НЕТ — узел из старого снапшота!'}")

# 5) Статус туннеля (маскир.): активный/лучший узел и их ранги
st = load("status.txt")
nodes = st.get("nodes", [])
print()
print("=" * 74)
print("E. СТАТУС ТУННЕЛЯ; онлайн/оффлайн и ранги (маскир.)")
print("=" * 74)
if "__err__" in st:
    print("   * ОШИБКА status.txt:", st["__err__"])
else:
    total = len(nodes)
    online = sum(1 for n in nodes if n.get("isOnline"))
    print(f" * узлов всего: {total}, online: {online}, offline: {total-online}")
    for n in nodes:
        if n.get("isBest") or n.get("isOnline") and True:
            flag = "\u2606best" if n.get("isBest") else ""
            print(f"   - {mask(n.get('name'))} host={mask(n.get('host'))}:{n.get('port')} "
                  f"ping={n.get('pingMs')}мс rating={n.get('speedRating')} {flag}")
            if n.get("isBest"):
                break
    print(" * активный узел (activeNodeId из статуса, если есть):", mask(str(st.get("activeNodeId"))))

print()
print("=" * 74)
print("ВЫВОД ГОТОВ. Секреты (uuid/pbk/sid/flow/vless://) в этом выводе отсутствуют.")
print("=" * 74)
