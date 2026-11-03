---
name: hype-deploy
description: Route a HypeProof Service Worker deploy (api.hypeproof-ai.xyz, hypeproof-studio-api) out of Studio to hypeproof-service, where `cd worker && npm run release:deploy` runs the release dependency check and the deploy. Use whenever someone in this repo asks to deploy the worker, push profiles or prompts to prod, or "prod 배포", even if they expect it to happen from Studio — Studio no longer deploys the Worker and its old deploy script refuses.
---

# hype-deploy

The production Worker (`hypeproof-studio-api`, `https://api.hypeproof-ai.xyz`) is owned
and deployed by `hypeproof/hypeproof-service`. Studio's `scripts/deploy-worker.sh` is a stub
that exits 1 (#1832), so do not run it or `wrangler deploy` from this repo. The canonical
runbook is `worker/DEPLOY.md` in hypeproof-service; read it there before deploying, since it
changes faster than this skill.

Chalk (`chalk/`) and the App are separate trains: `deploy-chalk.yml` and the `v*` release
process (`docs/dev/06-release-process.md`). This skill is only about the Service Worker.

## Flow

1. **Get the change onto Service `main`.** Worker code, profiles and prompts live in
   hypeproof-service now. A Studio PR cannot put them live.
2. **Apply migrations first.** Schema migrations go through hypeproof-ops `opsdb.py`. The
   deploy script never applies one and stops if the live DB head is behind the commit's
   highest migration.
3. **Dry run** from a clean Service checkout at `origin/main`:

   ```bash
   cd worker && npm run release:deploy                    # add --db-head NNNN until _ops_migrations exists
   ```

   It runs the Harness release dependency check (`release_deps.py check --candidate
   service=…`) and the provider contract suites. Anything but PASS stops it: report the
   engine's unmet or unresolved requirements instead of working around them.
4. **Deploy** only when the user asks for it, because it is a production write and tags
   `service-vYYYY.MM.DD-N`:

   ```bash
   cd worker && npm run release:deploy -- --apply
   ```

   The script checks the live-class freeze, deploys, tags, and verifies `/v1/health`
   reports the new version. A failure after the tag means the release is live; say so.
5. **Close the tracking issue** if the user passed an issue number: comment with the version, tag and what
   went live, then close it.

## Guardrails

- Do not deploy mid-class without explicit confirmation; it can drop active streams.
  `--override-live-session` is a recorded human decision, not a retry flag.
- Do not touch secrets from this skill.
- One deploy per invocation.
