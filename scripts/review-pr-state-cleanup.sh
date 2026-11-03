# Sourced by scripts/review-pr.sh. Removes the Dev state folder that this review
# created for its temporary worktree, and nothing else.

# Prints the PIDs whose command line names this state folder. The Dev app is started
# with --user-data-dir=<state>/user-data (studio-dev.py launch), and its executable lives
# under <state>; applicationName (hypeproof-studio-dev-<id>) is not in the arguments.
# Fixed-string match on "<state>/" with ENVIRON, so the path never appears in awk's own
# arguments and a sibling folder such as "<state>2" does not match.
dev_app_pids() {
  [[ -n "$1" ]] || return 0
  ps -axww -o pid= -o args= 2>/dev/null \
    | STATE_PATH="$1/" awk -v self="$$" 'index($0, ENVIRON["STATE_PATH"]) > 0 { if ($1 != self) print $1 }'
}

# Expects STATE_HASH,
# STATE_DIR_REAL and WORKTREE_DIR from review-pr.sh. Always returns 0: a failed
# removal is a warning, never a change of the review's exit status.
remove_review_state() {
  local owner real_wt
  [[ -n "${STATE_DIR_REAL:-}" && -n "${STATE_HASH:-}" && -n "${WORKTREE_DIR:-}" ]] || return 0
  [[ "$(basename "$STATE_DIR_REAL")" == "$STATE_HASH" ]] || return 0
  [[ "$STATE_DIR_REAL" == *"/HypeProof Studio Development/"* ]] || return 0
  [[ -d "$STATE_DIR_REAL" && ! -L "$STATE_DIR_REAL" ]] || return 0
  if [[ -n "$(dev_app_pids "$STATE_DIR_REAL")" ]]; then
    echo "NOTE: keeping $STATE_DIR_REAL: the Dev app is still running." >&2
    return 0
  fi
  real_wt="$(cd "$WORKTREE_DIR" 2>/dev/null && pwd -P)" || return 0
  owner="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("repo", ""))' "$STATE_DIR_REAL/owner.json" 2>/dev/null)" || owner=""
  if [[ -z "$owner" || "$owner" != "$real_wt" ]]; then
    echo "NOTE: keeping $STATE_DIR_REAL: owner.json does not name this review worktree." >&2
    return 0
  fi
  if rm -rf "$STATE_DIR_REAL" 2>/dev/null && [[ ! -e "$STATE_DIR_REAL" ]]; then
    echo "Removed the Dev state folder of this review worktree."
  else
    echo "WARNING: could not remove the Dev state folder $STATE_DIR_REAL" >&2
  fi
  return 0
}
