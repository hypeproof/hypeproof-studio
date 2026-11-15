## CGP-AGENT-R-014 / CGP-AGENT-D-012: AI에게 설정 부탁하기 in Chalk (2026-11-11)

Agent implementation choice for the Chalk half of the authoring assistant. Jay approved building it (2026-11-11); the Service half is live behind the default-off flag (hypeproof-service#370, service-v2026.11.11-1). Confirmed by Jay: no.

- Chalk only forwards, shows and applies. The proposal comes from the Service already validated like a manual save; Apply fills the form and saves through the existing draft save with `expected_revision` = the revision the proposal was based on, so a stale draft gets the Service's 409 and Chalk shows a calm "다시 제안을 받아 주세요". Discard and merely showing the card write nothing.
- Availability probe (agent choice): after a saved draft is opened, Chalk sends one POST with an empty body. The Service answers 404 with the flag off and 400 (request required) with it on, before any model call or charge, so the box is hidden while the flag is off without a visible failure. A 404 on a real request also hides it.
- Frozen versions (agent choice): the page edits the draft only, so "frozen" is read as the frozen-version summary being open (and as unsaved edits): the box is disabled with a one-line reason until the draft is opened again. Opening a saved draft closes the frozen summary.
- Dependency: `@hypeproof/service-contracts` 0.1.2 admits the proposal route in the instructor-endpoint allow-list that Chalk's forwarder uses. Studio takes it as a pinned private release asset (`config/service-packages.json`, `service-contracts-v0.1.2`); the asset must be published in hypeproof-service before CI can bootstrap it.
- Copy (the box label, buttons, error and limit sentences) is the agent's wording.

