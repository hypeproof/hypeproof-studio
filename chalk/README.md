# Chalk — instructor pages and Service HTTP transport

The existing web pages remain at `chalk.hypeproof-ai.xyz`, with their current URLs,
Korean copy and instructor workflows. The later move into Studio App is separate
from this Worker dependency removal.

Chalk serves HTML and forwards explicit HTTP requests. HypeProof Service owns
participant state, token verification/signing, cohort authorization, profile
filtering, calibrated board verdicts, SQL aggregation, log consent checks and R2
reads. Chalk has no KV/D1/R2 bindings, provider key, token signing key or admin
password. It installs the version-pinned public `@hypeproof/service-contracts`
package for the shared instructor routing predicate.

| Public Chalk path | Service path | Authorization |
|---|---|---|
| `GET /admin/cohorts/:id/state` | `GET /admin/chalk/cohorts/:id/state` | scoped instructor issuer (Lab connection) |
| `GET /admin/cohorts/:id/board` | `GET /admin/chalk/cohorts/:id/board` | scoped instructor issuer (Lab connection) |
| `GET /admin/cohorts/:id/logs` | `GET /admin/chalk/cohorts/:id/logs` | scoped instructor or operator |
| `GET /admin/cohorts/:id/logs/:seat` | same suffix under `/admin/chalk/cohorts/:id` | scoped instructor or operator |
| `GET .../logs/:seat/:day/:session/:filename` | same suffix under `/admin/chalk/cohorts/:id` | operator only; instructor alone never suffices |
| Instructor writes and authoring/classroom reads | existing Service HTTP paths | existing exact allowlist; the connected issuer as Bearer |

In every row "instructor" means the issuer of the Lab login connection described
below. Chalk sends it to the Service as `Authorization: Bearer`; it never accepts
one from the browser.

Read transport preserves query parameters, Service status/body, request correlation,
raw file bytes and log-key headers. Requests have an eight-second deadline and
refuse redirects. A failed Service read returns 502, never an invented empty board.
Board metadata remains free of participant prompt text. Every roster row selected
by the Service is rendered; omitted `seat_prefix` still reports the cumulative
roster limitation and degradation instead of inventing a complete batch.

## Operator retrieval

The Service retains the dedicated `HPS_LOGS_OPERATOR_SECRET` gate and rechecks
`analytics.upload_session_logs` on every raw read. Chalk forwards only the existing
`x-hps-operator-secret` for the log routes, never for instructor writes.

For a Cloudflare Access operator, Chalk attests the edge-provided identity using
server-only `HPS_CHALK_SERVICE_SECRET` (at least 32 characters) and
`x-hps-chalk-operator-identity`. Service trusts that identity only after verifying
the matching transport credential. Incoming client attestation headers are never
forwarded, and the trusted `cf-access-authenticated-user-email` header itself is
never forwarded. This credential does not sign participant tokens and must never
be placed in Studio App, browser code, a package or a tracked file.

Both servers need that transport credential configured during the later operational
rollout. Without it, Access-only raw retrieval fails closed. No secrets or production
bindings are changed by this source transition; operational setup remains separately
tracked. Deploy the Service read endpoints before activating the corresponding
Chalk artifact. The `c*` train still deploys only Chalk and observes the Service
version before and after.

## Lab login connection

No instructor pastes an issuer token into Chalk (CHALK-CONNECT-01). The instructor
pages (`/console`, `/issuer`, `/board`, `/authoring`, `/manage`, `/budgets`) have no
token field. They show one panel: "Lab 로그인으로 연결", or the connected member,
the expiry, "다시 연결" and "연결 해제". The student pages `/learn` and `/sharing`
keep their participation-code field.

1. `GET /connect/start?next=<page>` sets an httpOnly `SameSite=Lax` state cookie
   (10 minutes) and redirects to the Lab page
   `https://hypeproof-ai.xyz/members/chalk/connect?state=…&return=<origin>/connect/callback`.
2. The Lab requires its member login and the class-page instructor rule, mints a
   one-day issuer for the cohorts the member confirms, parks it under a one-time
   code (60 seconds, single use, bound to `state`) and redirects back with `code`
   and `state` only.
3. `GET /connect/callback` checks `state` against the cookie, then trades the code
   server-to-server at the Lab `POST /api/chalk/connect/exchange` with the shared
   secret `HPS_CHALK_CONNECT_SECRET` in `x-hps-chalk-connect-secret`.
4. Chalk keeps the issuer in AES-GCM sealed `__Host-` cookies (`HttpOnly`, `Secure`,
   `SameSite=Strict`, expiring with the issuer), keyed from the same secret. Chalk
   still has no storage binding.

Rules (CHALK-CONNECT-02):
- The issuer never appears in a URL, a response body, a page or a log line.
  `GET /connect/status` returns the member name, the expiry and the scope list
  (cohort ids and caps) that the pages used to decode from a pasted token.
- Every instructor route takes its Bearer from the session only. A request that
  brings its own `Authorization` header is refused (401 `issuer_header_refused`),
  and without a session the answer is 401 `not_connected`. Student share and
  profile routes keep forwarding the student's own Bearer.
- A state-changing request with the session must be same-origin (`Origin`, and
  `Sec-Fetch-Site` when present); otherwise 403.
- Unset or short (< 32 characters) `HPS_CHALK_CONNECT_SECRET` turns the connection
  off: `/connect/start` answers 503 and instructor calls are refused.

Set the secret with `wrangler secret put HPS_CHALK_CONNECT_SECRET` in `chalk/`; the
Lab holds the same value. Tests seal synthetic issuers into the same session
(`test/harness/connect.mjs`); `test/connect.test.mjs` covers the flow.

## BOA token distribution

For the workshop identified by Lab's public routing metadata, console issuance must publish the
same student credentials on Lab's `/live/boa` participant board (BOA-DIST-01).
Chalk discovers eligible cohort/profile pairs with `GET /workshop/boa-tokens`,
without forwarding issuer credentials on that public metadata read. It forwards
`POST /workshop/boa-tokens` server-side to the fixed Lab
`POST /api/workshop/boa-tokens` endpoint with the connected issuer as Bearer and
the shared secret. The roster read `GET /admin/cohorts/:id/lab-tokens` goes to the
Lab `GET /api/workshop/boa-room/instructor` the same way. The Lab accepts a Bearer
there only with that secret. Lab owns temporary board registration; Service retains
issuer authorization, roster and token signatures. Other cohorts keep the existing
Service-only issuance path.

Issuer credentials must never enter participant HTML, board responses or links
(BOA-DIST-02). The instructor pages hold no issuer at all (see Lab login
connection above). Failed or uncertain distribution must be
reported without claiming successful publication or that no token was issued
(BOA-DIST-03). Named batches join the track's existing board, preserving other
students' seats and claims. Reissuing one handle replaces only that seat's token
and clears that claim; individual issuance failures and board errors stay visible.

Transport tests cover authorization, header filtering, fixed production origin,
Service/Lab errors and redirects. Cross-product browser acceptance uses actual
Chalk → Lab → Service HTTP handlers and an isolated board store, then compares the
console-issued credential with the student's claimed/copied credential. Production
deployment and clean-machine Studio installation remain separate observations.

## Development and verification

```bash
cd chalk
npm ci
npm run typecheck
npm run build                 # Wrangler dry run; no deployment
npm test
npm run dev                  # :8788; optional Service on :8787
```

Only the public version-pinned development dependency `@hypeproof/service-testkit`
provides the synthetic Service runtime/harness for tests. It is absent from the
production bundle. Tests execute the actual installed Service token verifier,
HTTP routes, SQL and consent checks; they do not require a private source tree or
sibling checkout. Board calibration retains the labelled historical fixture and
positive, negative and threshold-perturbation controls. Transport tests additionally
check header filtering, exact raw bytes, fail-closed operator forwarding and
unavailable reads. Source deployment isolation checks use the configuration
contained in that same public artifact.

For local Service development, run its Worker in the independent Service repository
and set `HPS_SERVICE_ORIGIN` to that server. Chalk never copies a Service `.dev.vars`
file or requires a local participant storage/signing binding.

## Existing page contracts

`/console`, `/start`, `/issuer`, `/board`, `/authoring`, `/manage`, `/budgets`,
`/sharing` and `/learn` keep their existing page behavior. `/health` reports Chalk's
own `HPS_CHALK_VERSION`; unset or blank means `unknown`.

Authoring keeps `hps-authoring-batch/1` and the existing Service draft/version contract
(ADR 0004). A 409 preserves the local form; a frozen version remains inactive and
unverified. Classroom sharing remains voluntary, recipient-scoped and revocable;
credentials remain in page memory. Raw session logs remain separate from that
workflow and operator-only.

References: [layer plan](../docs/plan/vessel-and-modules.md),
[authoring requirements](../docs/requirements/chalk-authoring.md),
[classroom requirements](../docs/requirements/classroom-admin.md),
[classroom tests](../docs/testing/classroom-admin.md),
[exit plan](../docs/exit/chalk.md).
