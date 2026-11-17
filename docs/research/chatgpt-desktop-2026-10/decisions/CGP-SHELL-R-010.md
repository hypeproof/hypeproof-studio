## CGP-SHELL-R-010 / CGP-SHELL-D-009: microphone explainer before the OS prompt (2026-11-14, agent-selected)

Requirement: `docs/studio-requirements.md` "Microphone explainer before the OS prompt".

- **Audit.**
  - MET: no prompt at first launch. The capability probe is command-only (`src/voiceCapability.ts`), and dictation asks only on a press.
  - MET: a denial keeps text chat working and gives a way to retry (the denied card, DES-CGPV-03).
  - MISSING: Studio's own explanation before the OS prompt. The disclosure sheet explains storage once per policy version, not why the microphone is asked, and the OS prompt followed the press directly.
- **When (agent choice).** The card appears only when the Permissions API says `prompt`, or cannot say (`unknown`, which also covers a timeout). `granted` means no prompt will come. `denied` means no prompt will come either, and the denied card already explains. The card is shown once per dictation control, so it never nags.
- **Copy (agent choice).** The title is the register's `목소리로 말하려면 마이크가 필요해요`. The buttons are DES-SHELL-09's `허용하기` / `나중에`. One sentence says what happens next and that text chat keeps working.
- **Place (agent choice).** The card sits in the dictation status area above the text box, where every other dictation note already appears. It is inline, not a modal, and `허용하기` takes focus, so a keyboard user can answer at once.
- **Not changed.** There is no new flag, policy or seat rule, and the served-voice gate and disclosure come first, as before. Nothing is stored or logged. `VoicePanel.tsx` and `voiceAgentStatus.ts` are untouched. `DictationControl.tsx` is also touched by open #3928, but only on separate lines (and one shared return line).
- **Not covered.** The macOS bundle's purpose string (VSCodium default). A real OS prompt; the scripted env stands in for it. A screen reader.

