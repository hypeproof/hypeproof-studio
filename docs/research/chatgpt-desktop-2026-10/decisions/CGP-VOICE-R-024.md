## CGP-VOICE-R-024 / CGP-VOICE-D-018: served voice block, class-off state (2026-11-09, policy-backed)

- Policy: `hypeprooflab` `docs/decisions/2026-11-09-studio-voice-policy.md` (active), policy 4 and 6. The only input is the `voice` block on `/v1/profile`; absent means off, so every current seat renders byte-identical markup (`voice-mount.test.tsx` compares the real ChatPanel's markup with and without the wiring, both seats).
- Fail closed: a `policy_version` this build has no copy for is treated as off. A truthy non-`true` flag is off.
- Class off (D-018): the Service omits the block when a class turns voice off, so "was served in this window, not now" is the only signal; that state is kept in memory per window and seat, never stored. A Service refusal `voice_off` / `voice_consent_required` has the same effect.
- Copy: the policy's `이 수업에서는 쓸 수 없어요` (also what the Service answers with). The request named `이 수업에서는 음성을 쓰지 않아요`; the confirmed policy line was used, because the Service sends it verbatim and one line should not exist in two wordings. The follow-up `글로 이야기하면 돼요.` is agent-chosen.
- Confirmed by Jay: yes (2026-11-09) for the state and the line; no for `글로 이야기하면 돼요.`.

## CGP-VOICE-R-024 (read-aloud half) / CGP-CHAT-R-009: read-aloud (2026-11-09, policy-backed)

- Engine: the OS voice through `speechSynthesis`, Korean `ko-KR`, no Service call (policy D1). Only an on-device Korean voice is chosen; with none the default voice of the platform speaks (the Electron webview has no streaming voices). Unmeasured: voice quality on macOS and Windows.
- Per answer: personal seats in the answer action row, classroom seats beside the speaker's name (they have no action row). Plays on a press only; one at a time; the same button stops it; fenced code skipped and announced (`코드는 건너뛰었어요`, REQ-CGPV-24).
- Label `소리로 듣기` is the register's proposed copy, agent-chosen. Superseded 2026-11-12 by `읽어 주기` / `그만 읽기` (CGP-CHAT-D-009 below).
- Confirmed by Jay: yes (2026-11-09) for the engine; no for the label and placement.

