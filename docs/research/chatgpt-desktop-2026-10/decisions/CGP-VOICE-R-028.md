## CGP-VOICE-R-028 / CGP-VOICE-D-021 (autoplay part): blocked read-aloud recovery (2026-11-14, agent-selected)

Requirement: `docs/studio-requirements.md` "Blocked read-aloud recovery"; VO-42 sentence in `docs/requirements/voice-conversation.md`.

- **Scope (audit).** The only sound Studio plays today is read-aloud through the OS voice (`src/voiceReadAloud.ts`, `speechSynthesis`; MET for "OS voice", MISSING for a blocked state: a `not-allowed` error fell into the generic `error` status with nothing shown). The voice conversation's `speaking` state (`src/voiceSessionHelpers.ts`) has no audio transport yet, so it has nothing to block (NOT APPLICABLE until a transport lands; the same notice and `resume` path should be reused then). `VoicePanel.tsx` and `voiceAgentStatus.ts` are not touched.
- **Detection.** The synthesizer reports an autoplay refusal as the utterance error `not-allowed` (it never throws `NotAllowedError` from `speak`). Only that code shows the notice; `synthesis-failed`, `audio-busy` and the others keep today's behaviour, because a press cannot fix them.
- **Copy.** The register's `소리가 막혔어요. 눌러서 다시 듣기` is split into one sentence and one action, as DES-CGPV-39/41 asks ("1 sentence + action"). The action is labelled `소리 켜기`, as the coordinator specified, and the sentence is `소리가 막혔어요.`.
- **Resume point.** Read-aloud speaks sentence-sized chunks. It reads on from the first chunk without an `end` event. The engine reports no position inside a chunk, so a chunk cut off midway is read again from its start; nothing is skipped.
- **Placement.** The notice sits inline in the answer's action row, next to the button that started the reading, because that is where read-aloud lives. It is not in the voice panel's status area, since the panel is not open during a read-aloud.
- **Gate.** The press runs through `voice.gate` like every read-aloud press. There is no new flag, policy or seat rule. Nothing is stored or logged.
- **Not covered.** A real browser autoplay refusal (the scripted engine stands in), a screen reader, the packaged app, and the VAD half of D-021.
- Confirmed by Jay: no.

