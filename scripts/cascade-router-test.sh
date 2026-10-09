#!/usr/bin/env bash
# scripts/cascade-router-test.sh — поднимает mock-инстанс :19082 и гоняет сьют.
# Собственный скрипт этапа 2. Внешних вызовов нет, квоты не расходуются.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MOCK_PORT:-19082}"
STATE_DIR="${MOCK_STATE_DIR:-/tmp/cascade-mock-state}"
LOG="${MOCK_LOG:-/tmp/cascade-mock.log}"
CONFIG="$ROOT/cascade-router/tests/mock-config.json"
CATALOG="$ROOT/cascade-router/tests/mock-catalog.json"

cleanup() {
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Изоляция: чистое состояние на каждый прогон.
rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"

# Сверить каталог и конфиг: рассинхрон = сбой теста, а не молчаливый 400.
python3 - "$CONFIG" "$CATALOG" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
cat = json.load(open(sys.argv[2]))
have = {(m["provider"], m["model"]) for m in cat["models"]}
missing = []
# Свёрка только для СЕТ ИЗ ФАЙЛА. Сьют дополнительно строит сеты через PUT /sets
# в runtime — их пары берутся из пула mockt*/mockb*, который тоже есть в каталоге.
for name, st in cfg["router"]["sets"].items():
    for m in st["models"]:
        if (m["provider"], m["model"]) not in have:
            missing.append(f'{name}: {m["provider"]}/{m["model"]}')
lr = cfg["router"]["failover"].get("lastResortModel")
if lr and ("mock", lr.split("/", 1)[1]) not in have:
    missing.append(f"lastResortModel: {lr}")
if missing:
    print("MOCK CATALOG OUT OF SYNC:")
    for x in missing: print("  -", x)
    sys.exit(1)
print(f"mock-каталог согласован: {len(have)} пар")
PY

echo "старт mock-инстанса :$PORT (state: $STATE_DIR)"
CASCADE_ROUTER_PORT="$PORT" \
CASCADE_ROUTER_CONFIG="$CONFIG" \
CASCADE_ROUTER_STATE_DIR="$STATE_DIR" \
CASCADE_ROUTER_CATALOG="$CATALOG" \
  bun "$ROOT/cascade-router/server.ts" > "$LOG" 2>&1 &
PID=$!

# Ждём готовности.
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "mock-инстанс не поднялся:"; cat "$LOG"; exit 1
fi

echo "health: $(curl -fsS "http://127.0.0.1:$PORT/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["version"], "set:", d["activeSet"], "сетов:", d["setCount"])')"
echo

MOCK_LOG="$LOG" MOCK_PORT="$PORT" bun "$ROOT/cascade-router/tests/mock-suite.ts"
