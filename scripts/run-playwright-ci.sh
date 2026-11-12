#!/usr/bin/env bash
# Browser dependencies are baked into the official version-matched image.
# Keep gh/private-package bootstrap, builds and evidence handling on the hosted runner.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" || "$(uname -s)" != "Linux" ]]; then
  echo 'run-playwright-ci: requires a disposable GitHub Linux runner' >&2
  exit 2
fi
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
working=$(pwd -P)
case "$working" in
  "$repo") relative='' ;;
  "$repo"/*) relative=${working#"$repo"/} ;;
  *) echo 'run-playwright-ci: working directory must be inside this checkout' >&2; exit 2 ;;
esac
version=$(node -p 'require(process.argv[1]).packages["node_modules/playwright"].version' "$repo/e2e/package-lock.json")
if [[ "$version" != '1.60.0' ]]; then
  echo 'run-playwright-ci: update the pinned image to match e2e Playwright before running' >&2
  exit 2
fi
# Verified against Microsoft Artifact Registry. Match e2e/package-lock.json.
image='mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948'
action=${1:-}; shift || true
case "$action" in
  prepare)
    [[ $# == 0 ]] || exit 2
    timeout 300 docker pull "$image"
    ;;
  run)
    [[ $# -gt 0 ]] || exit 2
    # No credentials or host home/socket are mounted. Results retain the runner uid.
    exec docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
      --mount "type=bind,source=$repo,target=/work" --workdir "/work/$relative" \
      --env CI=true --env NPM_CONFIG_CACHE=/tmp/hp-playwright-npm \
      "$image" "$@"
    ;;
  *) echo 'usage: run-playwright-ci.sh prepare | run COMMAND [ARG...]' >&2; exit 2 ;;
esac
