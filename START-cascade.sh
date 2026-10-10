#!/usr/bin/env bash
# Cascade — start the facade (API + dashboard + /v1) and open the dashboard.
# The router core and the dashboard are served by the facade; sing-box is
# optional and only needed for the VLESS relay (:10808).
set -euo pipefail
cd "$(dirname "$0")"

( sleep 3; if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:3000" >/dev/null 2>&1 || true; fi ) &
exec ./cascade
