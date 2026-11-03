#!/usr/bin/env bash
# Mint the review instructor token with the Service package's issuer CLI.
# Called by scripts/review-pr.sh step 4. Works from any working directory: the
# loader and the issuer script are absolute paths under <worker-dir>.
#
#   HPS_SIGNING_SECRET=… review-pr-issue-token.sh <worker-dir> <json-out> <err-out> <issuer args…>
#
# The token JSON goes only to <json-out>; nothing is printed on success.
# stderr goes to <err-out>. On failure it is printed with secrets redacted and
# the script exits 1.
set -Eeuo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: review-pr-issue-token.sh <worker-dir> <json-out> <err-out> <issuer args...>" >&2
  exit 2
fi
WORKER_DIR="$1"; JSON_OUT="$2"; ERR_OUT="$3"; shift 3

set +e
node --import "$WORKER_DIR/test/harness/loader.mjs" --experimental-strip-types \
  "$WORKER_DIR/scripts/issue-issuer-token.ts" "$@" >"$JSON_OUT" 2>"$ERR_OUT"
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  echo "ERROR: instructor token issue failed (exit $RC). Redacted stderr follows:" >&2
  python3 - "$ERR_OUT" <<'PY' >&2
import os, re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
secret = os.environ.get("HPS_SIGNING_SECRET", "")
if secret:
    text = text.replace(secret, "<redacted>")
text = re.sub(r"HPS_SIGNING_SECRET=\S+", "HPS_SIGNING_SECRET=<redacted>", text)
text = re.sub(r"eyJ[A-Za-z0-9_.\-]{8,}", "<redacted-jwt>", text)
text = re.sub(r"dev-local-[0-9a-f]+", "dev-local-<redacted>", text)
text = re.sub(r'("token"\s*:\s*")[^"]+', r"\1<redacted>", text)
sys.stdout.write(text[-8000:])
PY
  exit 1
fi
