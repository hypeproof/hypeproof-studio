## CGP-VOICE-R-003 / CGP-VOICE-D-002: microphone permission card (2026-11-09, agent-selected)

- A card above the composer (not inside the unmounted VoicePanel): title, one sentence, `마이크 설정 열기` primary, `글로 계속하기` secondary. DES-CGPV-03's labels `설정 열기` / `텍스트로 계속` are made specific.
- The host picks the OS pane from the platform (macOS, Windows; none elsewhere) and never takes a URL from the webview. No automatic retry.
- Real-device caveat: on a build without the microphone core patch (DEC-03) `getUserMedia` is refused by Studio itself and a learner sees this card although no OS setting would help. That is exactly what the real-device check must separate.
- Confirmed by Jay: no.

