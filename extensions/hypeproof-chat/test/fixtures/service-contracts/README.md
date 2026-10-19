# App consumer contract fixtures

`samples.json` contains synthetic input/response data captured from the canonical
HypeProof Service implementation. Its provenance names the Service revision and
SHA-256 of each source file. It contains no server implementation or production
credentials. Token samples were signed with an explicitly synthetic test key.

App tests compare real client output with accepted payload bytes, decode signed
claim examples, and replay recorded Service responses. They do not claim to run
Service authorization, signature verification, recovery evaluation or storage.
Those implementations have their own tests in `hypeproof-service/worker/test`.

The curriculum plan and model labels are example Service response data used to
exercise generic App rendering. They are not an App runtime curriculum registry.
Keep snapshots versioned when the Service contract deliberately changes; record
the producing Service revision and rerun both products' corresponding checks.

`trial-funnel.json` is the open-trial funnel event contract (`/v1/trial/events`).
Each sample's `accepted`/`message` is the verdict of the Service's own
`parseAppEvent`, captured by running it over every body the App builder can
produce plus refused controls. `test/funnel-events.smoke.mjs` replays it, and
runs the real Service parser too when `HPS_SERVICE_WORKER_DIR` points at a
`hypeproof-service/worker` checkout.
