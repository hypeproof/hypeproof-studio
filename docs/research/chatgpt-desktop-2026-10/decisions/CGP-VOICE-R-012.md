## CGP-VOICE-R-012 / R-016, REQ-CGPV-17b/17c/18/19: dictation (2026-11-09, policy-backed with agent choices)

- Engine and path: the Service, never the webview (policy 1, D2). The webview's CSP allows no network and is not loosened; the finished clip goes to the host as base64 and the host posts it. Audio is memory only end to end (policy 3, D4); the host keeps no copy after the answer.
- Format: `audio/webm;codecs=opus` at 32 kbps, `audio/ogg;codecs=opus` as the only fallback, never `audio/mp4` (the Service parses nothing else).
- The request said "hard stop at 60 s". Studio stops at 58 s: the Service refuses a clip it measures over 60 s from the bytes, and the encoder flushes one more packet after `stop()`, so a stop at exactly 60 s could throw away a whole clip. Agent-chosen margin.
- No auto-send, ever; no "받아쓰고 보내기" action (REQ-CGPV-17 allows one as a separate action; not built).
- Retry (R-016): a failed clip is kept in memory for one retry for ten minutes (the policy's own figure), dropped on success, dismiss or unmount; a retried transcript needs `메시지에 넣기`.
- Hiding the window, `pagehide`, a task or seat switch (the chat remounts) and disposing the panel stop a recording, release the microphone and drop the clip and any kept retry copy: the chat view keeps its webview alive while hidden (`retainContextWhenHidden`), so without this a hidden window would keep recording for up to 58 s. Agent-chosen.
- A transcript that was inserted but never sent stays in the composer draft and is saved like any typed draft; that is ordinary chat text under DEC-05, not stored audio.
- Not an outbound-consent dialog: the first-use disclosure carries the statement, and a prompt per clip would be noise a learner learns to click through.
- Softer line `소리가 잘 들리지 않았어요. 다시 말해 볼까요?` for unreadable or silent clips is from the task brief, agent-written. The cap line is the policy's.
- Key: Alt+Shift+M start/stop, Escape cancels a recording, in-app only (beside the existing Alt+Shift+J). Agent-chosen.
- Confirmed by Jay: yes (2026-11-09) for the engine path, the data rule, the cap line and the ten minutes; no for the 58 s margin, the key, the failure lines and the card copy.

