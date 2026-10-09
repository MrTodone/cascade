import json, os, re, time, glob

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cascade-run")

def load(p):
    try:
        with open(os.path.join(APP, p), encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"__err__": "%s: %s" % (type(e).__name__, e)}

def m(s):
    s = str(s)
    s = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<UUID>', s)
    s = re.sub(r'vless://\S+', 'vless://<SEC>', s)
    s = re.sub(r'(pbk|sid|uuid|public_key)\s*=\s*\S{6,}', r'\1=<SEC>', s)
    return s

print("=== A. singbox.json: outbounds/inbounds (маск.) ===")
cfg = load("singbox.json")
if "__err__" not in cfg:
    for ob in cfg.get("outbounds", []):
        t = ob.get("type")
        print(" * outbound tag=%s type=%s server=%s:%s flow=%s" % (
            ob.get("tag"), t, m(ob.get("server")), ob.get("server_port"), m(ob.get("flow"))))
        tls = ob.get("tls") or {}
        rt = tls.get("reality") or {}
        print("     tls: sni=%s pbk=%s sid=%s fp=%s" % (
            m(tls.get("server_name")), m(rt.get("public_key"))[:10], m(rt.get("short_id"))[:8],
            m((tls.get("utls") or {}).get("fingerprint"))))
    for ib in cfg.get("inbounds", []):
        print(" * inbound tag=%s type=%s %s:%s" % (ib.get("tag"), ib.get("type"), ib.get("listen"), ib.get("listen_port")))
else:
    print("  ERR:", cfg["__err__"])

print()
print("=== B. status: активный vs лучший узел (маск. host:port) ===")
st = load("status.json") or load("status.txt")
if "__err__" not in st:
    act = st.get("activeNode") or {}
    best = st.get("bestNode") or {}
    print(" * активный: %s:%s  sni=%s  online=%s best=%s" % (
        m(act.get("host")), act.get("port"), m(act.get("sni")), act.get("isOnline"), act.get("isBest")))
    print(" * лучший:   %s:%s  sni=%s  online=%s best=%s" % (
        m(best.get("host")), best.get("port"), m(best.get("sni")), best.get("isOnline"), best.get("isBest")))
    print(" * всего узлов: %s, lastSync=%s" % (st.get("totalNodes"), st.get("lastSync")))
else:
    print("  ERR:", st["__err__"])

print()
print("=== C. Штатные команды пересборки: npm script / CLI / gen-файлы (пути) ===")
for pat in ("package.json", "server/*.ts", "*.mjs", "*gen*.py", "*gen*.js", "*update*.py", "*sync*.py"):
    for f in glob.glob(os.path.join(APP, pat)) + glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), pat)):
        print(" * %s" % f.replace(APP, "").replace(os.path.dirname(os.path.abspath(__file__)), ""))
pk = load("package.json")
if "__err__" not in pk:
    sc = pk.get("scripts", {})
    print(" * npm scripts:", list(sc.keys()))
    for k, v in sc.items():
        print("     %s: %s" % (k, m(v)[:80]))
