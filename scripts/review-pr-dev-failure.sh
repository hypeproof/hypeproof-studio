# Sourced by scripts/review-pr.sh. When studio-dev.py run fails, the ERR trap shows only a
# line number. This prints the last lines of its output to stderr instead, with
# token-like values redacted, the same way review-pr-issue-token.sh does.

# $1 exit status of studio-dev.py, $2 its captured output, $3 literal local secret (may be empty).
print_dev_app_failure() {
  local rc="$1" output="$2" secret="${3:-}" tail_text
  tail_text="$(printf '%s\n' "$output" | tail -n 40)"
  echo "ERROR: studio-dev.py run failed (exit $rc). Its last lines follow, with secrets redacted:" >&2
  HPS_TAIL="$tail_text" python3 - "$secret" >&2 <<'PY'
import os, re, sys
text = os.environ.get("HPS_TAIL", "")
secret = sys.argv[1] if len(sys.argv) > 1 else ""
if secret:
    text = text.replace(secret, "<redacted>")
text = re.sub(r"HPS_SIGNING_SECRET=\S+", "HPS_SIGNING_SECRET=<redacted>", text)
text = re.sub(r"eyJ[A-Za-z0-9_.\-]{8,}", "<redacted-jwt>", text)
text = re.sub(r"dev-local-[0-9a-f]+", "dev-local-<redacted>", text)
text = re.sub(r'("token"\s*:\s*")[^"]+', r"\1<redacted>", text)
sys.stdout.write(text + ("\n" if text and not text.endswith("\n") else ""))
PY
}
