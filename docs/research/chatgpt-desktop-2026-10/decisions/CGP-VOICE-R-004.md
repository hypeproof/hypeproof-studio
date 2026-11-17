## CGP-VOICE-R-004 / CGP-VOICE-D-003: disclosure sheet (2026-11-09, policy-backed)

- Sentences are the policy's Appendix B, verbatim, keyed by policy version in `voiceCopy.ts`; one paragraph per served half; the button is `시작하기`. DES-CGPV-04's "at most 3 short sentences at a 2nd-grade level" gives way to the approved copy, which is what the register's own text says ("copy is generated from the active policy").
- Remembered once per seat and policy version (policy 5: once per account and policy version), in the host's `globalState` as one record keyed by the seat's own scope (activity connection plus profile id) holding version strings only. On a shared class laptop each seat reads the sheet once; a seat switch asks the host again. A different version shows the sheet again. An earlier revision of this change keyed it per install; that did not match the policy and was corrected.
- The sheet reuses the shared modal surface (focus trap, Escape, focus return). The title `음성 사용 안내` is agent-chosen.
- Confirmed by Jay: yes (2026-11-09) for the sentences, the button and the once-per-seat-and-version rule (the policy's own); no for the title and for the seat-key construction.

