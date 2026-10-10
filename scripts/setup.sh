#!/usr/bin/env bash
# One-command contributor setup. Idempotent and safe: does the deterministic
# parts (submodule, secrets, deps) and PRINTS exact commands for anything that
# needs a manual install — it never brew-installs behind your back.
#
# Usage (from repo root):  bash scripts/setup.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
todo(){ printf '  \033[33m→\033[0m %s\n' "$1"; }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

[ "$(uname -s)" = "Darwin" ] || { echo "Local dev is macOS-only. On Win/Linux use the web issue forms (see DEV-GUIDE.md)."; exit 1; }

hdr "1. Toolchain"
node --version 2>/dev/null | grep -q '^v22\.22\.1' && ok "node $(node -v)" || todo "install Node 22.22.1: brew install nvm && nvm install 22.22.1"
command -v gh >/dev/null && ok "gh present" || todo "install gh: brew install gh"
command -v jq >/dev/null && ok "jq present" || todo "brew install jq"
command -v gsed >/dev/null && command -v icns2png >/dev/null && command -v icotool >/dev/null && command -v composite >/dev/null && command -v rsvg-convert >/dev/null \
  && ok "build icon tools present" \
  || todo "install build/icon deps: brew install gnu-sed libicns icoutils imagemagick librsvg"
command -v cargo >/dev/null && command -v rustc >/dev/null && ok "rust toolchain present" || todo "install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
gh auth status >/dev/null 2>&1 && ok "gh authenticated" || todo "gh auth login   (needs 'repo' scope)"

hdr "2. Submodule"
if [ -f vscodium-base/.git ] || [ -d vscodium-base/.git ]; then ok "vscodium-base present"
else todo "git submodule update --init"; git submodule update --init && ok "submodule initialised"; fi

hdr "3. Dependencies"
( npm ci --silent >/dev/null 2>&1 ) && ok "public Service development artifact" || todo "npm ci"
( cd extensions/hypeproof-chat && npm ci --omit=optional --silent >/dev/null 2>&1 ) && ok "App dependencies" || todo "npm ci --prefix extensions/hypeproof-chat --omit=optional"
( cd extensions/hypeproof-chat/webview-ui && npm ci --silent >/dev/null 2>&1 ) && ok "webview dependencies" || todo "npm ci --prefix extensions/hypeproof-chat/webview-ui"
( cd chalk && npm ci --silent >/dev/null 2>&1 ) && ok "Chalk consumer dependencies" || todo "npm ci --prefix chalk"
( cd e2e && npm ci --silent >/dev/null 2>&1 ) && ok "e2e dependencies" || todo "npm ci --prefix e2e"

hdr "4. Optional local Service"
todo "For the local Service only: bash scripts/dev-secrets.sh; configure its development .dev.vars, then bash scripts/dev-stack.sh"

hdr "5. PR-safety guard"
git config core.hooksPath .githooks && ok "pre-push guard enabled (blocks accidental main push)"

hdr "Done"
echo "  Next:  bash scripts/dev-stack.sh   then open the app / run tests."
echo "  Build the app once (~1–2 h):  see DEV-GUIDE.md §3"
