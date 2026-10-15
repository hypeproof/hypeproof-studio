#!/usr/bin/env bash
set +e
keychain="$1"
prior_default="$2"
prior_list="$3"
status=0

prior="$(cat "$prior_default")"
security default-keychain -d user -s "$prior" || status=1
existing=()
while IFS= read -r item; do [[ -n "$item" ]] && existing+=("$item"); done < "$prior_list"
security list-keychains -d user -s "${existing[@]}" || status=1
security delete-keychain "$keychain" >/dev/null 2>&1 || status=1

current="$(security default-keychain -d user 2>/dev/null | sed 's/^[[:space:]]*"//; s/"$//')" || status=1
[[ "$current" == "$prior" ]] || status=1
actual_list="$(mktemp)"
security list-keychains -d user 2>/dev/null | sed 's/^[[:space:]]*"//; s/"$//' > "$actual_list" || status=1
cmp -s "$prior_list" "$actual_list" || status=1
security show-keychain-info "$keychain" >/dev/null 2>&1 && status=1
rm -f "$actual_list" "$prior_default" "$prior_list" || status=1
exit "$status"
