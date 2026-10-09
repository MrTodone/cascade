#!/usr/bin/env bash
# scripts/cascade-router-dev.sh — запуск dev-инстанса cascade-router (без launchd).
# Прод (:19080) не трогает: ни порт, ни конфиг, ни state dir.
#   порт     : $CASCADE_ROUTER_PORT     (по умолчанию 19081)
#   конфиг   : $CASCADE_ROUTER_CONFIG   (по умолчанию cascade-router/dev-config.json)
#   state    : $CASCADE_ROUTER_STATE_DIR (по умолчанию ~/.cascade-router-dev)
#   каталог  : $CASCADE_ROUTER_CATALOG  (по умолчанию cascade-router/catalog.json)
set -euo pipefail
cd "$(dirname "$0")/.."
export CASCADE_ROUTER_PORT="${CASCADE_ROUTER_PORT:-19081}"
export CASCADE_ROUTER_CONFIG="${CASCADE_ROUTER_CONFIG:-$PWD/cascade-router/dev-config.json}"
export CASCADE_ROUTER_STATE_DIR="${CASCADE_ROUTER_STATE_DIR:-$HOME/.cascade-router-dev}"
mkdir -p "$CASCADE_ROUTER_STATE_DIR"
exec bun cascade-router/server.ts
