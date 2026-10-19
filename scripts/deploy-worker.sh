#!/usr/bin/env bash
# Retired 2026-10-19: Studio no longer deploys the Service Worker (hypeproof-studio-api).
#
# hypeproof/hypeproof-service owns the deploy:
#   npm run release:deploy --prefix worker            # dry run
#   npm run release:deploy --prefix worker -- --apply # operator only
# (see worker/DEPLOY.md in hypeproof-service). Schema migrations are applied by
# hypeproof-ops opsdb.py. This stub stays so old instructions fail loudly instead of
# deploying from Studio.
set -euo pipefail
echo "scripts/deploy-worker.sh is retired: deploy the Worker from hypeproof-service with 'npm run release:deploy' (worker/DEPLOY.md)." >&2
exit 1
