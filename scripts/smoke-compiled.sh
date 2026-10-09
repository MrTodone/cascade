#!/usr/bin/env bash
# scripts/smoke-compiled.mjs -> bash helper: boots the two compiled canaries in an
# isolated layout and probes every endpoint. macOS only (dev tool, not part of dist).
#
#   scripts/smoke-compiled.sh          # uses /tmp/cascade-smoke fixture limits
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="${SMOKE_DIR:-/tmp/cascade-smoke/app}"
BIN="${CASCADE_EXE:-/tmp/cascade-compile-test/mac/cascade}"
RTR="${CASCADE_ROUTER_EXE:-/tmp/cascade-compile-test/mac/cascade-router}"
PORT_F="${SMOKE_PORT_F:-3111}"
PORT_R="${SMOKE_PORT_R:-19111}"

cleanup() {
  pkill -9 -f "$BIN" 2>/dev/null
  pkill -9 -f "$RTR" 2>/dev/null
  for p in $PORT_F $PORT_R; do
    lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | rg -v COMMAND | awk '{print $2}' | sort -u | xargs kill -9 2>/dev/null
  done
  true
}
trap cleanup EXIT
cleanup
sleep 1

rm -rf "$FIXTURE"; mkdir -p "$FIXTURE/cascade-run/router" "$FIXTURE/cascade-router" "$FIXTURE/rbin"
cp "$BIN" "$FIXTURE/cascade"
cp "$RTR" "$FIXTURE/rbin/cascade-router"
chmod +x "$FIXTURE/cascade" "$FIXTURE/rbin/cascade-router"
cp -r "$ROOT/dist" "$FIXTURE/dist"
cp "$ROOT/cascade-router/catalog.json" "$FIXTURE/cascade-router/catalog.json"
cp "$ROOT/configs/router.config.example.json" "$FIXTURE/configs-holder.json" 2>/dev/null || true

python3 - "$FIXTURE" <<'PY'
import json, sys
F = sys.argv[1]
cfg = {
  "routing": {"mode":"helper","defaultModel":"cascade:fast-coding","primary":"fast-coding",
    "activeSet":"fast-coding","sets":{"fast-coding":{"name":"fast-coding","models":[
      {"provider":"llm7","model":"deepseek-chat","priority":1}]}}},
  "apiKeys": {"llm7":"sk-test-fake-key-local-only"},
  "settings": {},
  "tunnel": {},
}
json.dump(cfg, open(f"{F}/cascade-run/router/config.json","w"), ensure_ascii=False, indent=2)
PY

CASCADE_PORT=$PORT_F CASCADE_ROUTER_PORT=$PORT_R NODE_ENV=production \
  CASCADE_ROUTER_BIN="$FIXTURE/rbin/cascade-router" "$FIXTURE/cascade" \
  > "$SMOKE_LOG" 2>&1 &
FPID=$!

ok=0; fail=0
check() { # $1=label $2=code $3=expected
  if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1 -> $2"
  else fail=$((fail+1)); echo "FAIL $1 -> $2 (expected $3)"; fi
}
wait_rtr() {
  for _ in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_R/stats" 2>/dev/null)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

sleep 4
check "GET /" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_F/")" 200
check "setup/status" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_F/api/setup/status")" 200
wait_rtr && echo "PASS router alive" || { echo "FAIL router never started"; cat "$SMOKE_LOG"; }
curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_F/v1/models" >/dev/null
check "v1/models (via facade)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_F/v1/models")" 200

echo "== summary: $ok pass / $fail fail =="
[ "$fail" = "0" ] && exit 0 || exit 1