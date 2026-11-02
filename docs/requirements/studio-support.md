# Durable Studio support — #3384

Owner: Jay (`jayleekr`). Parent: ST-INT-NATIVE and ST-REQ-OUTBOUND-CONSENT.
User decision, 2026-11-02: support must cover automatic detected faults and manual reports;
people must not need a GitHub account. GitHub is an internal engineering destination.

## Contract

- Manual reporting is reachable before account or participation-code login, from chat, and
  from the renderer failure surface. Native fallback commands are registered before activity
  restoration. A dead process cannot send: `/v1/report/help` is the independent browser path.
- Machine fault classification uses numeric status and an allowlist of fault codes, not a
  model or the learner's prose. Normal cancellation, denied login, expired entitlement,
  invalid participation input and safety denials are not automatic incidents. A manual
  report remains available for a problem without a machine-detectable fault.
- The existing per-device automatic-diagnostic opt-in remains off by default. When enabled,
  faults reach the existing anonymous `/problems/auto` aggregation and issue filer. Its
  production flags and dedicated GitHub App are deployment prerequisites, not assumptions.
- Manual payloads are disclosed before sending, including device storage/retry. Queue bodies
  are held in VS Code SecretStorage, capped at 20 reports and 32 KiB per report; credentials
  are never stored in the queue or sent on a retry. A cross-window lock protects read/write.
- Persist the approved frozen body and UUID before the first POST. Retry identical bytes,
  two reports per minute at most during background draining, with bounded backoff. Automatic
  entries expire in seven days and are removed on opt-out. Manual entries remain until
  server receipt or user deletion. Permanent refusals require an explicit action.
- A server receipt remains successful if local cleanup fails. Local-only queue IDs never
  claim server acceptance. The pending-request command offers retry, copy and deletion.
- Service #290 deduplicates the exact UUID-bearing body with an atomic unique report id.
  Concurrent/repeated deliveries return the same receipt; triage notification happens once.
  Service must be deployed before shipping the retrying client. No DB migration is required.
- The recovery browser form sends description, optional contact and version, with no login.
  Its single pending payload stays in sessionStorage until receipt or explicit deletion;
  it offers explicit retry, not an unbounded background loop. Closing the tab can discard it.

## Cost and limits

No model calls. Per-report request cap is 32 KiB; per-device encrypted queue is at most
640 KiB plus metadata. Existing server/IP limits and automatic fingerprint aggregation
remain authoritative. Existing issue filer caps five GitHub creations per scheduled run.

## Acceptance evidence

`support-outbox.smoke.mjs`: offline/restart exact retry, storage failure, multi-window
serialization, permanent refusal, opt-out, accepted receipt with failed cleanup.
`support-login.smoke.mjs`: actual internal AccountSession failures and expected-denial control.
`outbound-consent-host.smoke.mjs`: real host report flow, no send on cancellation.
Service `report-idempotency.test.mjs`: Hono → real local SQLite, duplicates/receipt/status,
legacy clients and anonymous help surface. Installed Windows and production behavior are
separate from these local checks and must be recorded in the release check.
