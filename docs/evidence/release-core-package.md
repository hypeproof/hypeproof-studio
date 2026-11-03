# FIN-02 shared release core evidence

Scope: `REQ-STUDIO-RELEASE-ENGINE`, FIN-02 shared package and synchronous adapter
boundary. Implementer self-check, not independent acceptance.

Base: `862f757baea74b78aa9c0570d7ed334bd0a1671a` in the isolated
`release-engine-core-fin02` worktree. Final revision and log digests are recorded
in `artifacts/release-engine-completion-20261019/run-01/core-handoff.json` outside
the checkout.

| Check | Result | Observed |
|---|---|---|
| Pre-change package consumption | FAIL, reproduced | `npm pack --dry-run --json` in the engine directory exits 254: no package.json. `core/package-before.json` preserves it. |
| Async verifier bypass | FAIL, reproduced | Installed consumer expected BLOCKED but got AWAITING_APPROVAL with an async no-op verifier. `core/verifier-red.log` preserves it. |
| Pinned package/isolated installation | PASS | Version 0.1.0, lockfile integrity, packed source SHA-256, exact four-file allowlist, and public export boundaries pass. Consumer resides in an OS temporary directory and installs a regular package directory, not a source symlink. |
| Signed event replay | PASS | Installed consumer and actual local CLI filesystem adapter produce the same event results and final state digest. Signatures use throwaway keys and fixture bytes. |
| Actual workerd parity | PASS | Miniflare 5.20261006.1-alpha / workerd 1.20261006.1, compatibility date 2026-10-06, nodejs_compat: same canonical bytes, state digest, decisions and refusal results as Node. |
| Failure boundaries | PASS | Unsigned mutation, wrong key, changed bytes, missing/false/Promise/thenable verifiers refuse approval; artifact ingestion also blocks without recording an artifact. |
| Existing regressions | PASS | Eight existing local engine scenarios unchanged. Together with the two package/runtime scenarios: 10 pass, 0 fail, 0 skipped. |
| Installed-App/live Service/CI/publication | NOT_RUN | Local protocol fixtures and workerd simulation provide no product acceptance or operational approval. |

Commands executed on macOS arm64 / Node 24.4.1:

```bash
npm view miniflare@5.20261006.1-alpha version dist.integrity --json
npm ci --prefix scripts/release/engine --ignore-scripts --no-audit --no-fund
node --test scripts/release/test/engine-package.test.mjs scripts/release/test/engine.test.mjs
npm pack ./scripts/release/engine --ignore-scripts --json --pack-destination ARTIFACT_DIRECTORY
```

Registry lookup confirms the exact runtime version and its official npm integrity.
The runtime has no customer/provider connection. No GitHub write, branch creation,
deployment, publication, approval, signing credential or model invocation was used
by this implementer. Test-only generated Ed25519 signatures are protocol fixtures.
The core still relies on a trusted host's synchronous byte verifier; the engine
cannot prove that a callback actually observed remote bytes. No cloud ledger or
network adapter implementation is included in this slice.

## Independent repair 1: rejected verifier Promise

The independent verifier found that refusing an async verifier still leaked its
rejected Promise. A child process returned BLOCKED with no artifact, then exited
1 on an unhandled rejection. This invalidated the earlier boundary completeness
claim; the original independent evidence and `core/rejected-verifier-red.log`
remain preserved.

The core now attaches rejection handling before synchronously refusing a returned
thenable. It never awaits the verifier or accepts its eventual result. A packed
consumer child runs with `--unhandled-rejections=strict`, checks both an async
throw and an ordinary callback returning `Promise.reject`, and must exit 0 after
an event-loop turn with both decisions BLOCKED and no artifact recorded. The same
rejected-verifier cases also run in Node/workerd replay. Ten integrated scenarios
pass with zero skips after this repair (`core/rejected-verifier-after.log`). The
first implementation's tarball remains preserved; `core/repair-01` contains the
new source-hash-bound tarball and identity for consumer pin updates. Independent
reverification is still required; this is implementer self-check evidence.
