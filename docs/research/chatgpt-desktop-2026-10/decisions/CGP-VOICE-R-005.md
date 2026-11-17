## CGP-VOICE-R-005: voice picker: device voices rejected, TTS research pending (2026-11-16, Jay)

- Question (parked 2026-11-15): build the voice picker on device voices before Chalk/Service serve `voice.allowed`?
- Jay, verbatim: "컴퓨터 목소리가 너무이상해서, 아예 사람목소리를 주는 저렴한 api를 알아봐야할거같아. 모바일버전도그러네"
- Agent's reading: a picker built on device voices is rejected, and research is requested into an affordable, human-sounding TTS API, for desktop and mobile.
- Status: research pending at the time of this answer; decided later the same day (below).
- Confirmed by Jay: yes (2026-11-16), for the rejection and the research request only.

### CGP-VOICE-R-005: voice choice after the TTS research (2026-11-16, Jay)

- Chosen: Studio picks the best installed Korean voice and shows a hint for downloading a premium voice.
- Chosen: open-source Supertonic is measured, as a measurement only. The question text Jay answered said the test runs on snts (the Ubuntu worker).
- On production server TTS, Jay, verbatim: "이건 때려치자. 나중에 이건 getson 같은거 구매해서 해결할예정"
- Agent's reading: no production server TTS now; Jay plans to solve it later with his own hardware (probably a Jetson-class device, where "getson" is read as Jetson).
- Confirmed by Jay: yes (2026-11-16).
