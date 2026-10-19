# Controlled installed acceptance

The workflow checks out `testRevision`. The installed package remains pinned to the candidate source SHA, and the actual Service checkout is checked against the canonical `serviceSha`. The verifier's legacy `config/service-deployment.json` is not a controlled Service pin.

Managed installed PUBLIC-FLOW first consumes the actual S1–S6 runner. Every check needs a current Worker authorization for each configured finite resource. Missing context, OIDC, quota, resource configuration, scope, producer, or proof blocks before the dependent effects. Legacy release-cut refuses controlled mode; it cannot run issuer/model smoke before the canonical native verifier. No runner receipt settles capacity or consumption.

Configure `verify-start` paths for the current native verifier stage/trust:

- `smoke:S1:api`, `smoke:S2:api`, `smoke:S3:service`, `smoke:S3:api`
- `smoke:S4:model`, `smoke:S4:service`, `smoke:S4:api`
- `smoke:S5:api`, `smoke:S6:service`, `smoke:S6:api`
- `installed:<target>:public-<trial|classroom>:<model|service|api>`
- `installed:<target>:synthetic-<trial|classroom>:<model|api>`

Targets are `mac`, `win-user`, `win-system`. Authorize finite configured units covering the entire declared batch, including cleanup. S3 owns one classroom lifecycle; S4 owns one SDK lifecycle with six actual request shapes and 64 output tokens per generation; S5 reads at most 20 pages of 100 checks and their run metadata; S6 owns one lifecycle and compares two actual product views over the common canonical Service D1 producer. Public App activity owns one seat capped by the Service at 40 requests. Its model entitlement must cover that bounded lifecycle using the actual deployed model/output policy; this source does not invent a dollar amount or claim a runner-side public model-token cap. The synthetic gateway authorizes each actual outbound request, caps generation at 4096 output tokens and all attempts at twelve per activity. No automatic retry follows an unknown authorization result.

Public Service `/health.version` alone is not a source attestation. Protected verifier environment secret `HPS_ACCEPTANCE_SERVICE_DEPLOYMENT_JSON` must contain an explicitly accepted deployment mapping:

```json
{"schema":"hps-service-deployment-acceptance/1","repository":"hypeproof/hypeproof-service","serviceSha":"<canonical 40hex>","origin":"https://api.hypeproof-ai.xyz","version":"<actual health version>","deploymentId":"<actual provider deployment ID>","acceptedBy":"<reviewed operator identity>","observedAt":"<ISO timestamp>","expiresAt":"<ISO timestamp>"}
```

Observation and expiry must each be within 24 hours. This is labeled a protected-environment accepted mapping, not cryptographic provider attestation. The current health version must match before/after acceptance. No placeholder mapping is supplied.

Controlled public flows and S3/S4/S6 use the existing finite scoped issuers with Service's owned release-seat capability. Before POST, the client saves a random ownership key in a private recovery record under `HPS_RELEASE_SEAT_DIR`. A lost POST uses GET on the same known UUID/key; it never creates a replacement seat. The actual participant `/v1/profile` must confirm the activity. Every successful public receipt includes successful owned cleanup. Failed cleanup prevents PASS, retains the private recovery record, and the workflow always attempts only those known owned DELETEs. No shared cohort close, admin fallback, static acceptance code, or live cohort is used. Issuer, participant JWT and ownership key must never enter artifacts.

S6 requires the Lab instructor read proxy and Chalk alias deployed with the same exact owner issuer/key and profile, and reads only its new `release-test-UUID` seat. Both views read the canonical D1 producer; no independent storage comparison is claimed. Missing adapters are BLOCKED.

Actual Mac/Windows installation, signing, updater compatibility, model/provider consumption, Service/Lab/Chalk deployment and accepted source mapping remain external acceptance evidence. Local synthetic source tests do not replace them.
