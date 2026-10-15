#!/usr/bin/env bash
# Local end-to-end dev stack: wrangler dev + roster + active session + token.
#
# After this prints, you can:
#   1. Open browser → http://localhost:8787   (admin UI; user: leave blank, pass: dev)
#   2. Open HypeProof Studio.app, change settings (instructions printed)
#   3. Paste the token, type "안녕" → expect HypeProof Coach reply
#
# Stop: pkill -f "wrangler dev"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_WORKER_ROOT="$(node "$ROOT/scripts/service-tooling.mjs")"
DEV_VARS="$(node "$ROOT/scripts/service-tooling.mjs" --dev-vars)"
cd "$SERVICE_WORKER_ROOT"

# Pin Node 22
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh" >/dev/null 2>&1
command -v nvm >/dev/null 2>&1 && nvm use 22.22.1 --silent >/dev/null 2>&1 || true

# Ensure .dev.vars exists with real Anthropic key
if [[ ! -f "$DEV_VARS" ]]; then
  echo "ERROR: local Service environment file missing: $DEV_VARS" >&2
  echo "Set HPS_SERVICE_DEV_VARS or prepare this file with signing/admin credentials and the provider key used for API mode." >&2
  exit 1
fi

SIGNING=$(grep "^HPS_SIGNING_SECRET=" "$DEV_VARS" | cut -d= -f2-)
ADMIN_PASS=$(grep "^HPS_ADMIN_PASSWORD=" "$DEV_VARS" | cut -d= -f2-)
if [[ -z "$SIGNING" || -z "$ADMIN_PASS" ]]; then
  echo "ERROR: .dev.vars missing HPS_SIGNING_SECRET or HPS_ADMIN_PASSWORD" >&2
  exit 1
fi

# Cohort/profile/user — env-overridable. Defaults are the kids quest track
# (grades 3-4), read from the Service registry by scripts/service-profile.mjs,
# so the existing e2e specs run unchanged. Override to run the *same* specs
# against another cohort, e.g. the search teaser:
#   HPS_COHORT="$(service_profile pilot-cohort)" HPS_PROFILE="$(service_profile search-teaser)" \
#     HPS_USER=smoke-dental bash scripts/dev-stack.sh
service_profile() { (cd "$ROOT" && node --import @hypeproof/service-testkit/test/harness/loader.mjs --experimental-strip-types --no-warnings scripts/service-profile.mjs "$1"); }
HPS_COHORT="${HPS_COHORT:-$(service_profile kids-cohort)}"
HPS_PROFILE="${HPS_PROFILE:-$(service_profile kids-lower)}"
HPS_USER="${HPS_USER:-jay-test}"
TOKEN_FILE="/tmp/hps-token.txt"   # e2e global-setup + extension auto-import read this

# Stop any previous instance
pkill -f "wrangler dev" 2>/dev/null || true
sleep 1

echo "▶ starting wrangler dev (local miniflare)…"
nohup npm exec -- wrangler dev --local --port 8787 --env-file "$DEV_VARS" > /tmp/wrangler-dev.log 2>&1 &
sleep 2

# Wait until ready
for _ in $(seq 1 20); do
  if curl -fsS http://localhost:8787/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS http://localhost:8787/v1/health >/dev/null 2>&1; then
  echo "✗ wrangler dev did not become ready. Tail of log:" >&2
  tail -20 /tmp/wrangler-dev.log >&2
  exit 1
fi

AUTH_B64=$(printf ":%s" "$ADMIN_PASS" | base64)

echo "▶ setting roster… ($HPS_COHORT)"
curl -fsS -X POST "http://localhost:8787/admin/cohorts/$HPS_COHORT/roster" \
  -H "Authorization: Basic $AUTH_B64" -H "content-type: application/json" \
  -d "{\"users\":[\"kid01\",\"kid02\",\"kid03\",\"$HPS_USER\"]}" >/dev/null

echo "▶ starting class window (now → +2h)…"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
END=$(date -u -v+2H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
   || date -u -d "+2 hours" +"%Y-%m-%dT%H:%M:%SZ")
curl -fsS -X POST "http://localhost:8787/admin/cohorts/$HPS_COHORT/session" \
  -H "Authorization: Basic $AUTH_B64" -H "content-type: application/json" \
  -d "{\"profile_id\":\"$HPS_PROFILE\",\"starts_at\":\"$NOW\",\"ends_at\":\"$END\"}" >/dev/null

echo "▶ issuing token for '$HPS_USER'…"
TOKEN=$(HPS_SIGNING_SECRET="$SIGNING" node --import @hypeproof/service-testkit/test/harness/loader.mjs --experimental-strip-types scripts/issue-token.ts \
  --user "$HPS_USER" --cohort "$HPS_COHORT" --profile "$HPS_PROFILE" --hours 2)

# e2e global-setup + the extension's local-dev auto-import both read this file.
# Without it the e2e preflight fails and the app can't auto-seed the token.
printf '%s' "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

cat <<EOF

═══════════════════════════════════════════════════════════════════════
  HypeProof Studio — dev stack ready
═══════════════════════════════════════════════════════════════════════

  Worker:        http://localhost:8787
  Admin UI:      http://localhost:8787/      (uses your local admin password)
  Health:        http://localhost:8787/v1/health
  Class window:  $NOW  →  $END  (2 hours)
  Cohort:        $HPS_COHORT
  Profile:       $HPS_PROFILE
  Roster:        kid01, kid02, kid03, $HPS_USER
  Token file:    $TOKEN_FILE   (e2e + extension auto-import)

  Workshop token: read the local token file when manually importing it.

─── How to test in the app ───────────────────────────────────────────

  1. Open the app:
       open "$ROOT/vscodium-base/VSCode-darwin-arm64/HypeProof Studio.app"

  2. In the app: Cmd+, (settings) → search "hypeproofChat" →
     Change "Hypeproof Chat: Proxy Url" to:
       http://localhost:8787/v1

  3. Open Command Palette (Cmd+Shift+P) →
     "HypeProof Chat: Set Workshop Token" → paste the value from $TOKEN_FILE

  4. Click the 💬 icon on the left → type "안녕"
     → Expect HypeProof Coach reply in Korean

─── Direct curl test (no app needed) ────────────────────────────────

  curl -N -X POST http://localhost:8787/v1/chat/completions \\
    -H "authorization: Bearer \$(cat '$TOKEN_FILE')" \\
    -H "content-type: application/json" \\
    -d '{"model":"hypeproof-default","stream":true,"max_tokens":200,
         "messages":[{"role":"user","content":"삼각형이 점프하는 게임 만들어줘"}]}'

─── Stop ────────────────────────────────────────────────────────────

  pkill -f "wrangler dev"
  Logs: tail -f /tmp/wrangler-dev.log

═══════════════════════════════════════════════════════════════════════
EOF
