## CGP-VOICE-R-015 follow-up: a bad clip is never resent (2026-11-15, after verify-r004 on #4137)

- Finding: the host marks unreadable, `voice_empty` and `voice_type_mismatch` as `retry: true`. `recoveryFor` let "retryable with the clip kept" win, so a silent clip got `다시 보내기`. That resends the same silence, fails the same way and spends hosted transcription each time.
- Fix (agent choice): a problem with the clip itself (unreadable, too short, too large, too long) always gets `다시 말하기`, whatever the retry flag. Its clip is no longer kept in memory, because nothing will resend it. Retryable failures that are not about the clip still resend: network, a Service 5xx, provider unavailable and Service busy. The host's flags are unchanged: the Service contract stays as it is, and only the recovery choice moved.
- Test gaps closed:
  - `dictation-recovery-table.smoke.mjs` covers every cause against every (retry, clipKept) combination;
  - `dictation-level-meter.smoke.mjs` runs the real `webAudioLevelMeter`, moved into `voiceDictation.ts` so it can run without a DOM, on a fake AudioContext inside the real recorder. Stop, cancel and the hard stop must each disconnect the source and the analyser and close the context exactly once, and the analyser is never connected to the output.
  - `voice-conversation-browser.smoke.mjs` checks the conversation button naming why it is off while dictation records.
  - Each of verify-r004's mutants fails these: retry winning, a null `blockedReason`, and an empty `close()`.
- Confirmed by Jay: no.

