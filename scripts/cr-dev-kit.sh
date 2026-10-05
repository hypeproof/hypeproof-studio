#!/usr/bin/env bash
# cr-dev-kit.sh — one command to try the Curriculum Runtime on this Mac (cr-e2e, #1400).
#
# Starts, in this order:
#   1. (--phone) an ngrok tunnel to the local Service, so a phone on mobile data can open a
#      published test link (a dev-only shared origin; the Service refuses it in production). The
#      tunnel's request inspector is off and no ngrok log is kept: at its default level ngrok logs
#      every connection with the client's public IP address, and the clients are participants' phones;
#   2. the local Service, e2e/curriculum-runtime/app-service.mjs: the real Service router with
#      the CR switch ON for an adult workshop profile, the publish storage (SQLite D1 and an
#      in-memory R2), its test control routes OFF (HPS_CR_CONTROL=0) and, unless --real-model,
#      the scripted coach (no key, no cost);
#   3. the isolated development app, scripts/studio-dev.py --provider service run --service local,
#      built from this checkout and launched with in-memory secret storage (never the login
#      keychain), the kiosk-practice fixture in its workspace.
# With --phone, before it prints the tunnel's address, the kit checks that only the published
# runtime (/l/…) answers through the tunnel: the Service's API, its control routes, dot-segment
# and encoded paths and a port-suffixed Host must all be refused. If any answers, it stops. The
# Service needs the tunnel's address when it starts, so the tunnel is already open, through the
# same gate, for the few seconds the check takes; only the printed address waits for the check.
# Then follow the §14 checklist in docs/testing/curriculum-runtime-dev.md (section cr-e2e).
#
# Usage:
#   bash scripts/cr-dev-kit.sh               published links open on this Mac at http://prj-….localhost:8787 (Chrome)
#   bash scripts/cr-dev-kit.sh --fresh       start the §14 loop over: the kiosk as handed out (v0) and an app with no
#                                            stored results (the previous workspace and app state are kept as *.previous)
#   bash scripts/cr-dev-kit.sh --phone       + an ngrok tunnel: published links open on a phone
#   bash scripts/cr-dev-kit.sh --real-model  the coach and the skills ask a real model (ANTHROPIC_API_KEY
#                                            from worker/.dev.vars, into the Service process only; spends credit)
#   bash scripts/cr-dev-kit.sh --no-app      the Service (and tunnel) only
#   bash scripts/cr-dev-kit.sh --dry-run     print what would start; start nothing
#   --state-dir DIR                          default: one directory per checkout, ~/Library/Application Support/
#                                            HypeProof Studio Development/cr-dev-kit-<first 12 hex of the SHA-256 of
#                                            the checkout path> (studio-dev.py binds a state directory to one checkout)
#
# Ctrl-C stops the Service and the tunnel. The development app keeps running; quit it yourself.
# What the Service stored lives in memory and is gone when it stops; the app's token is re-read
# from the state directory at every launch. An ngrok.log an earlier version of this kit left in
# the state directory (it named every client's IP address) is deleted at the next start. Without --fresh the workspace and the app's stored
# results stay from the last run, so the §14 checklist's expected values (v0, "검증 안 됨") hold
# only after --fresh. Port 8787 must be free (the development app's local Service address): stop
# scripts/dev-stack.sh's wrangler first.
set -euo pipefail
# Written for macOS's /bin/bash 3.2 too: no negative array subscripts, no associative arrays.

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PORT=8787
PHONE=0
REAL=0
APP=1
DRY=0
FRESH=0
CHECKOUT_ID="$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-12)"
STATE="$HOME/Library/Application Support/HypeProof Studio Development/cr-dev-kit-$CHECKOUT_ID"
NGROK="${NGROK:-$(command -v ngrok || echo /opt/homebrew/bin/ngrok)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone) PHONE=1 ;;
    --real-model) REAL=1 ;;
    --no-app) APP=0 ;;
    --dry-run) DRY=1 ;;
    --fresh) FRESH=1 ;;
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
NGROK_CMD=("$NGROK" http "127.0.0.1:$PORT" --inspect=false --log=stdout --log-format=json --log-level=info)

if [[ $DRY -eq 1 ]]; then
  echo "state:   $STATE"
  [[ $FRESH -eq 1 ]] && echo "fresh:   $STATE/workspace and $STATE/user-data → *.previous; the kiosk fixture copied in"
  [[ $PHONE -eq 1 ]] && echo "tunnel:  ${NGROK_CMD[*]}  (its log read for the address only, kept nowhere)  →  HPS_TEST_ORIGIN=https://<ngrok host>, checked before the address is printed"
  [[ $PHONE -eq 0 ]] && echo "origin:  HPS_TEST_ORIGIN=http://{project}.localhost:$PORT"
  echo "service: HPS_CR_CONTROL=0 ${SERVICE_CMD[*]}$([[ $REAL -eq 1 ]] && echo "   (HPS_CR_MODEL=real, key from worker/.dev.vars)")"
  [[ $APP -eq 1 ]] && echo "app:     ${APP_CMD[*]}"
  exit 0
fi

# studio-dev.py claims the state directory (owner.json) before anything is written into it.
python3 "$ROOT/scripts/studio-dev.py" --state-dir "$STATE" status >/dev/null
# Up to 2026-10-06 the kit wrote ngrok's info log here, one line per client connection with the
# client's public IP address (a participant's phone, in the live run). Never keep one.
rm -f "$STATE/ngrok.log"

# --fresh: the §14 loop from its start. The Service is empty at every start; this empties the app's
# side too (its stored browser and verification results live in user-data) and puts the kiosk back
# as handed out. One previous generation of each is kept.
if [[ $FRESH -eq 1 ]]; then
  if pgrep -f -- "--user-data-dir=$STATE/user-data" >/dev/null 2>&1; then
    fail "the development app of this state directory is running: quit it first (--fresh replaces its state)"
  fi
  for part in workspace user-data; do
    if [[ -e "$STATE/$part" ]]; then
      rm -rf "$STATE/$part.previous"
      mv "$STATE/$part" "$STATE/$part.previous"
    fi
  done
fi

PIDS=()
TUNNEL_INFO=""
cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done
  if [[ -n "$TUNNEL_INFO" ]]; then rm -f "$TUNNEL_INFO"; fi
}
trap cleanup EXIT INT TERM

# ── 1. the tunnel ──────────────────────────────────────────────────────────────
ORIGIN="http://{project}.localhost:$PORT"
if [[ $PHONE -eq 1 ]]; then
  # ngrok's log goes to this filter and nowhere else. It keeps the tunnel's https address and, until
  # the tunnel has started (no client can have connected yet), ngrok's own warnings and errors for the
  # message below; every later line, one per client connection with its IP address, is read and
  # dropped. With --inspect=false ngrok holds no request in memory either (its inspector at :4040).
  TUNNEL_INFO="$STATE/tunnel.info"
  : > "$TUNNEL_INFO"
  "${NGROK_CMD[@]}" > >(python3 -c 'import json, sys
out = open(sys.argv[1], "a", encoding="utf-8")
def keep(text):
    out.write(text + "\n")
    out.flush()
started = False
for raw in iter(sys.stdin.buffer.readline, b""):
    if started:
        continue
    try:
        line = raw.decode("utf-8", "replace").strip()
        try:
            e = json.loads(line)
        except ValueError:
            if line:
                keep("ngrok: " + line[:300])
            continue
        if not isinstance(e, dict):
            continue
        if e.get("msg") == "started tunnel" and str(e.get("url", "")).startswith("https://"):
            keep("url " + e["url"])
            started = True
        elif e.get("lvl") not in ("info", "dbug", "debug", "trce"):
            keep("ngrok: %s %s %s" % (e.get("lvl", ""), e.get("msg", ""), e.get("err", "")))
    except Exception:
        pass' "$TUNNEL_INFO") 2>&1 &
  NGROK_PID=$!
  PIDS+=("$NGROK_PID")
  URL=""
  for _ in $(seq 1 30); do
    URL="$(sed -n 's/^url //p' "$TUNNEL_INFO" | head -1)"
    [[ -n "$URL" ]] && break
    kill -0 "$NGROK_PID" 2>/dev/null || break
    sleep 1
  done
  if [[ -z "$URL" ]]; then
    sleep 1
    grep -v '^url ' "$TUNNEL_INFO" | tail -3 >&2 || true
    fail "ngrok did not start a tunnel. It needs an account once: ngrok config add-authtoken <token> (Jay's step)"
  fi
  ORIGIN="$URL"
fi

# ── 2. the Service ─────────────────────────────────────────────────────────────
# HPS_CR_CONTROL=0: the Service's test control routes (/__cr/…) are off; nothing in the §14 checklist
# uses them, and a page open in the browser beside the kit must not reach them.
SERVICE_LOG="$STATE/service.log"
if [[ $REAL -eq 1 ]]; then
  HPS_CR_CONTROL=0 HPS_TEST_ORIGIN="$ORIGIN" HPS_CR_MODEL=real ANTHROPIC_API_KEY="$KEY" "${SERVICE_CMD[@]}" > "$SERVICE_LOG" 2>&1 &
else
  HPS_CR_CONTROL=0 HPS_TEST_ORIGIN="$ORIGIN" "${SERVICE_CMD[@]}" > "$SERVICE_LOG" 2>&1 &
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

# ── 2b. the checks: the control routes are off; (--phone) only the published runtime answers through the tunnel ─────
# Each probe is classified by what answered it: the gate's refusal (x-hps-dev-gate, from
# e2e/curriculum-runtime/service-gate.mjs), the Service's router (x-request-id), the published
# runtime (its referrer-policy header) or none of them (ngrok's edge, or a control route). A probe
# that must be refused and was answered stops the kit; the trap then ends the tunnel and the
# Service, so nothing stays exposed.
answered_by() {  # answered_by <URL> [Host] → "<status> <gate|router|runtime|edge>"
  local hdr=(-H "ngrok-skip-browser-warning: 1")
  [[ -n "${2:-}" ]] && hdr+=(-H "Host: $2")
  { curl -s -o /dev/null -D - --path-as-is --max-time 20 "${hdr[@]}" "$1" 2>/dev/null || true; } | tr -d '\r' | awk '
    NR == 1 { status = $2 }
    tolower($1) == "x-hps-dev-gate:" { gate = 1 }
    tolower($1) == "x-request-id:" { router = 1 }
    tolower($1) == "referrer-policy:" { runtime = 1 }
    END { print (status ? status : "000"), (gate ? "gate" : router ? "router" : runtime ? "runtime" : "edge") }'
}
# The test control routes are off: the gate refuses them on this Mac too.
CONTROL_GOT="$(answered_by "http://127.0.0.1:$PORT/__cr/state")"
[[ "$CONTROL_GOT" == "404 gate" ]] || fail "the Service's test control routes answer on this Mac (/__cr/state → $CONTROL_GOT); the kit runs it with HPS_CR_CONTROL=0"
if [[ $PHONE -eq 1 ]]; then
  TUNNEL_HOST="${URL#https://}"
  UPPER_HOST="$(printf '%s' "$TUNNEL_HOST" | tr '[:lower:]' '[:upper:]')"
  LEAKS=""
  N_LOCAL=0
  N_EDGE=0
  # As the tunnel delivers a request (its Host), sent on this Mac: the gate itself must refuse each.
  for probe in "$TUNNEL_HOST /v1/health" "$TUNNEL_HOST /v1/profile" "$TUNNEL_HOST /__cr/state" "$TUNNEL_HOST /admin/cohorts" \
               "$TUNNEL_HOST /l/%2e%2e/v1/profile" "$TUNNEL_HOST /l/../v1/profile" "$TUNNEL_HOST /l/x/..%2f..%2fv1/profile" \
               "$TUNNEL_HOST:443 /v1/profile" "$UPPER_HOST /v1/profile"; do
    got="$(answered_by "http://127.0.0.1:$PORT${probe#* }" "${probe%% *}")"
    N_LOCAL=$((N_LOCAL + 1))
    [[ "$got" == "404 gate" ]] || LEAKS="$LEAKS
    Host ${probe%% *} ${probe#* } → $got"
  done
  # Through the tunnel itself: refused by the gate, or never delivered by ngrok's edge.
  for path in /v1/health /v1/profile /__cr/state /l/%2e%2e/v1/profile /l/../v1/profile; do
    got="$(answered_by "$URL$path")"
    N_EDGE=$((N_EDGE + 1))
    case "$got" in
      "404 gate" | [345]??" edge") ;;
      *) LEAKS="$LEAKS
    $URL$path → $got" ;;
    esac
  done
  # Controls, so a check that sees nothing cannot pass: this Mac reaches the API, and the tunnel
  # reaches the published runtime (an unknown link answers the runtime's own 404).
  [[ "$(answered_by "http://127.0.0.1:$PORT/v1/health")" == "200 router" ]] || LEAKS="$LEAKS
    control: /v1/health on this Mac did not answer 200 from the Service"
  [[ "$(answered_by "$URL/l/AAAAAAAAAAAAAAAAAAAAAA/")" == "404 runtime" ]] || LEAKS="$LEAKS
    control: the published runtime did not answer through the tunnel"
  if [[ -n "$LEAKS" ]]; then
    echo "✗ tunnel check:$LEAKS" >&2
    fail "the tunnel would expose more than the published runtime, or the check could not run; the tunnel and the Service are stopped"
  fi
  echo "▶ tunnel checked: $N_LOCAL requests as the tunnel delivers them and $N_EDGE through $URL refused; the published runtime answers through it"
fi

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
  Logs          $SERVICE_LOG$([[ $PHONE -eq 1 ]] && echo " · ngrok: none kept, its request inspector off")

  Next: the §14 checklist in docs/testing/curriculum-runtime-dev.md (cr-e2e).
  Ctrl-C stops the Service$([[ $PHONE -eq 1 ]] && echo " and the tunnel"); quit the app yourself.

EOF
wait "$SERVICE_PID"
