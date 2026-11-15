## DEC-AGENT-R032: local lesson disclosure receipt (2026-10-22, agent choice)

Use the existing inline capability card expanded before the lesson content, with
`다음` as the requirement row specifies. The separately queued DES-CGP-AGENT-67
modal-sheet presentation is not introduced here. The first entry remains pending
until Next persists a receipt, so a crash or failed write does not silently skip
it. Header reopening uses the same read-only rows and does not change policy.
Receipts are device-local VS Code global state, keyed by SHA-256 of Service URL,
Service activity_id, course id, version and immutable content hash. Credential
renewal preserves the receipt. Older profiles without a valid activity_id use a
credential-scoped fallback and a replacement credential conservatively asks again.
No raw credential or lesson text is stored;
there is no cross-device seen-state API. Multiple views read the same receipt;
idempotent writes use one key per entry, not a shared read/modify/write array.
This is UI disclosure only, not minor-safety enablement, consent or new autonomy.

