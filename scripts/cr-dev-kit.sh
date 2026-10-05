#!/usr/bin/env bash
# cr-dev-kit.sh — one command to try the Curriculum Runtime on this Mac (cr-e2e, #1400).
#
# Starts, in this order:
#   1. (--phone) an ngrok tunnel to the local Service, so a phone on mobile data can open a
#      published test link (a dev-only shared origin; the Service refuses it in production);
#   2. the local Service, e2e/curriculum-runtime/app-service.mjs: the real Service router with
#      the CR switch ON for an adult workshop profile, the publish storage (SQLite D1 and an
#      in-memory R2) and, unless --real-model, the scripted coach (no key, no cost);
#   3. the isolated development app, scripts/studio-dev.py --provider service run --service local,
#      built from this checkout and launched with in-memory secret storage (never the login
#      keychain), the kiosk-practice fixture in its workspace.
# Then follow the §14 checklist in docs/testing/curriculum-runtime-dev.md (section cr-e2e).
#
# Usage:
#   bash scripts/cr-dev-kit.sh               published links open on this Mac at http://prj-….localhost:8787 (Chrome)
#   bash scripts/cr-dev-kit.sh --phone       + an ngrok tunnel: published links open on a phone
#   bash scripts/cr-dev-kit.sh --real-model  the coach and the skills ask a real model (ANTHROPIC_API_KEY
#                                            from worker/.dev.vars, into the Service process only; spends credit)
#   bash scripts/cr-dev-kit.sh --no-app      the Service (and tunnel) only
#   bash scripts/cr-dev-kit.sh --dry-run     print what would start; start nothing
#   --state-dir DIR                          default: ~/Library/Application Support/HypeProof Studio Development/cr-dev-kit
#
# Ctrl-C stops the Service and the tunnel. The development app keeps running; quit it yourself.
# What the Service stored lives in memory and is gone when it stops; the app's token is re-read
# from the state directory at every launch. Port 8787 must be free (the development app's
# local Service address): stop scripts/dev-stack.sh's wrangler first.
set -euo pipefail
# Written for macOS's /bin/bash 3.2 too: no negative array subscripts, no associative arrays.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8787
PHONE=0
REAL=0
APP=1
DRY=0
STATE="$HOME/Library/Application Support/HypeProof Studio Development/cr-dev-kit"
NGROK="${NGROK:-$(command -v ngrok || echo /opt/homebrew/bin/ngrok)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone) PHONE=1 ;;
    --real-model) REAL=1 ;;
    --no-app) APP=0 ;;
    --dry-run) DRY=1 ;;
    --state-dir) STATE="$2"; shift ;;
    -h|--help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    *) echo "✗ unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# The kit's children need no NODE_OPTIONS; a preload a shell profile left behind would stop them.
unset NODE_OPTIONS

fail() { echo "✗ $*" >&2; exit 1; }

# ── preflight: everything checked before anything starts ───────────────────────
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || fail "this kit is for an Apple-silicon Mac (scripts/studio-dev.py builds the development app there)"
command -v node >/dev/null || fail "node is not on PATH"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "node 22 or newer is needed (--experimental-strip-types, node:sqlite)"
[[ -d "$ROOT/worker/node_modules" ]] || fail "worker dependencies are missing: npm ci --prefix worker"
if [[ $APP -eq 1 ]]; then
  [[ -f "$ROOT/extensions/hypeproof-chat/node_modules/esbuild/lib/main.js" && -f "$ROOT/extensions/hypeproof-chat/webview-ui/node_modules/vite/bin/vite.js" ]] \
    || fail "extension dependencies are missing: npm ci --prefix extensions/hypeproof-chat && npm ci --prefix extensions/hypeproof-chat/webview-ui"
  [[ -f "/Applications/HypeProof Studio.app/Contents/Resources/app/product.json" ]] || fail "no HypeProof Studio in /Applications to copy (studio-dev.py copies it; it never changes it)"
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port $PORT is in use (scripts/dev-stack.sh's wrangler? stop it: pkill -f 'wrangler dev')"
fi
if [[ $PHONE -eq 1 ]]; then
  [[ -x "$NGROK" ]] || fail "ngrok is not installed (brew install ngrok), or set NGROK=<path>"
fi
KEY=""
if [[ $REAL -eq 1 ]]; then
  [[ -f "$ROOT/worker/.dev.vars" ]] || fail "--real-model reads ANTHROPIC_API_KEY from worker/.dev.vars, which is missing"
  KEY="$(sed -n 's/^ANTHROPIC_API_KEY=//p' "$ROOT/worker/.dev.vars" | head -1)"
  [[ -n "$KEY" ]] || fail "worker/.dev.vars has no ANTHROPIC_API_KEY"
fi

TOKEN_FILE="$STATE/local-participant-token.txt"
SERVICE_CMD=(node --experimental-strip-types --experimental-sqlite --no-warnings "$ROOT/e2e/curriculum-runtime/app-service.mjs" "$PORT" "$TOKEN_FILE" on publish)
APP_CMD=(python3 "$ROOT/scripts/studio-dev.py" --state-dir "$STATE" --provider service run --service local --inmemory-secrets)

if [[ $DRY -eq 1 ]]; then
  echo "state:   $STATE"
  [[ $PHONE -eq 1 ]] && echo "tunnel:  $NGROK http 127.0.0.1:$PORT  →  HPS_TEST_ORIGIN=https://<ngrok host>"
  [[ $PHONE -eq 0 ]] && echo "origin:  HPS_TEST_ORIGIN=http://{project}.localhost:$PORT"
  echo "service: ${SERVICE_CMD[*]}$([[ $REAL -eq 1 ]] && echo "   (HPS_CR_MODEL=real, key from worker/.dev.vars)")"
  [[ $APP -eq 1 ]] && echo "app:     ${APP_CMD[*]}"
  exit 0
fi

# studio-dev.py claims the state directory (owner.json) before anything is written into it.
python3 "$ROOT/scripts/studio-dev.py" --state-dir "$STATE" status >/dev/null

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

# ── 1. the tunnel ──────────────────────────────────────────────────────────────
ORIGIN="http://{project}.localhost:$PORT"
if [[ $PHONE -eq 1 ]]; then
  NGROK_LOG="$STATE/ngrok.log"
  : > "$NGROK_LOG"
  "$NGROK" http "127.0.0.1:$PORT" --log="$NGROK_LOG" --log-format=json >/dev/null 2>&1 &
  NGROK_PID=$!
  PIDS+=("$NGROK_PID")
  URL=""
  for _ in $(seq 1 30); do
    URL="$(python3 -c 'import json,sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: e = json.loads(line)
    except ValueError: continue
    u = e.get("url", "")
    if e.get("msg") == "started tunnel" and u.startswith("https://"): print(u); break' "$NGROK_LOG")"
    [[ -n "$URL" ]] && break
    kill -0 "$NGROK_PID" 2>/dev/null || break
    sleep 1
  done
  if [[ -z "$URL" ]]; then
    tail -3 "$NGROK_LOG" >&2 || true
    fail "ngrok did not start a tunnel. It needs an account once: ngrok config add-authtoken <token> (Jay's step)"
  fi
  ORIGIN="$URL"
fi

# ── 2. the Service ─────────────────────────────────────────────────────────────
SERVICE_LOG="$STATE/service.log"
if [[ $REAL -eq 1 ]]; then
  HPS_TEST_ORIGIN="$ORIGIN" HPS_CR_MODEL=real ANTHROPIC_API_KEY="$KEY" "${SERVICE_CMD[@]}" > "$SERVICE_LOG" 2>&1 &
else
  HPS_TEST_ORIGIN="$ORIGIN" "${SERVICE_CMD[@]}" > "$SERVICE_LOG" 2>&1 &
fi
SERVICE_PID=$!
PIDS+=("$SERVICE_PID")
KEY=""
for _ in $(seq 1 60); do
  grep -q "^READY" "$SERVICE_LOG" 2>/dev/null && break
  kill -0 "$SERVICE_PID" 2>/dev/null || { tail -20 "$SERVICE_LOG" >&2; fail "the local Service exited"; }
  sleep 0.5
done
grep -q "^READY" "$SERVICE_LOG" || { tail -20 "$SERVICE_LOG" >&2; fail "the local Service did not start"; }

# ── 3. the development app ────────────────────────────────────────────────────
WORKSPACE="$STATE/workspace"
mkdir -p "$WORKSPACE"
[[ -e "$WORKSPACE/index.html" ]] || cp -R "$ROOT/e2e/curriculum-runtime/fixtures/kiosk-practice/." "$WORKSPACE/"
if [[ $APP -eq 1 ]]; then
  "${APP_CMD[@]}" > "$STATE/studio-dev.log" 2>&1 || { tail -20 "$STATE/studio-dev.log" >&2; fail "the development app did not start (log: $STATE/studio-dev.log)"; }
fi

cat <<EOF

  Curriculum Runtime dev kit — running
  ────────────────────────────────────
  Service       http://127.0.0.1:$PORT  (CR switch on · $([[ $REAL -eq 1 ]] && echo "real model, spends credit" || echo "scripted coach, no key"))
  Published at  $ORIGIN$([[ $PHONE -eq 1 ]] && echo "  (phone: mobile data is fine; ngrok shows its own notice page once)")
  App           $([[ $APP -eq 1 ]] && echo "HypeProof Studio Dev (in-memory secret storage), workspace: $WORKSPACE" || echo "not started (--no-app)")
  Tokens        $TOKEN_FILE (student, read by the app at launch)
                $TOKEN_FILE.issuer (director: paste with "Chalk: 강사 토큰 입력")
  Logs          $SERVICE_LOG$([[ $PHONE -eq 1 ]] && echo " · $STATE/ngrok.log")

  Next: the §14 checklist in docs/testing/curriculum-runtime-dev.md (cr-e2e).
  Ctrl-C stops the Service$([[ $PHONE -eq 1 ]] && echo " and the tunnel"); quit the app yourself.

EOF
wait "$SERVICE_PID"
