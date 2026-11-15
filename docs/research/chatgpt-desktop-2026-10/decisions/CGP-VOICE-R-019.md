## CGP-VOICE-R-019 / D-015: choosing the microphone (2026-11-15, agent-selected)

Audit (origin/main 797cb1700, built on #4164 55e8ae6e2): nothing listed devices, and dictation and the voice conversation both opened the default microphone through `DictationEnv.getUserMedia({ audio: true })`.
- **Per computer, not per seat** (agent choice, coordinator agreed).
  - The microphone belongs to the PC, and every learner at a shared classroom PC uses the same headset. The host's globalState keeps `hypeproofChat.micInput = { id, label }`; no record means `시스템 기본값`.
  - The label is kept only to find the same device when the browser hands out a new id (exactly one device with that label). A label can name a person ("OO의 AirPods"), so it stays on this computer: never logged, never sent to the Service, never in a problem report, never a sync key.
- **Unplugged: follow the row, no silent fallback** (coordinator's decision).
  - The register says it falls back "only on explicit choice", and recording from a microphone the learner did not choose is the worse surprise. When the chosen microphone is absent at capture time, nothing opens. Dictation shows `선택한 마이크가 연결되어 있지 않아요` with one action, `기본 마이크로 녹음`; one press records that once with the default.
  - The stored choice is kept, so plugging the device back in uses it again, and the next press asks again. An `OverconstrainedError` or `NotFoundError` on the exact constraint reads the same way. The picker shows `연결되지 않은 마이크`.
  - The voice conversation stops with `선택한 마이크가 연결되어 있지 않아 멈췄어요. 대화 설정에서 마이크를 바꾸거나 글로 계속할 수 있어요.`: an automatic loop never switches microphones on its own, and its one recovery is the settings dialog or text.
- **Changing it mid-session**: a recording in progress keeps its microphone, and the next recording uses the new one. A voice conversation picks it up at its next listening turn: the same session, with the previous turn's tracks already stopped (VO-29).
- **Permission (#4001)**:
  - Opening the row never asks for the microphone. Before the microphone was allowed once, Chromium lists inputs without ids. The row then offers only `시스템 기본값` (plus a stored choice by its stored label) and says `마이크를 한 번 허용하면 이름을 보고 고를 수 있어요.`.
  - Labels appear after a grant. The list refreshes on `devicechange` and after a test. The register's "마이크 1/2" numbering is used only when the browser gives ids without labels.
- **마이크 시험** (DES-CGPV-23 "live input meter", coordinator: build now):
  - It runs only on an explicit press, behind the voice disclosure and the same microphone explainer as dictation.
  - It listens to the chosen microphone for at most 5 s with #4164's `webAudioLevelMeter`. The bar is decorative and `aria-hidden`, with none under reduced motion. The result is in words: `소리가 들려요.` or `소리가 들리지 않았어요. …`, heard meaning a peak of at least -45 dB.
  - Nothing is recorded, sent or kept. The tracks are stopped and the context closed when it ends, on 시험 멈추기, when the dialog closes and on a hide.
- **Where**: the personal settings dialog and the lesson-seat dialog (the access chip), only where dictation is served, for adult and minor seats alike. An unserved seat draws nothing and touches no browser API.
- **Copy** (agent-written): `마이크`, `시스템 기본값`, `연결되지 않은 마이크`, `마이크 N`, the hints, `마이크 시험` / `시험 멈추기`, the two results, `선택한 마이크가 연결되어 있지 않아요`, `기본 마이크로 녹음`.
- **Unchanged**: no flag, policy, Service or minor-seat change; no audio stored or logged.
- **Not covered**: real microphones, and whether webview device ids stay stable across a Studio restart and an upgrade on a Windows class laptop and a Mac. The fallback (id, then one exact label match, then missing) is designed for an id that changes, but the real behaviour is part of the real-device check (#3626): NOT RUN.
- Confirmed by Jay: no.
