## CGP-VOICE-R-029: voice tip at most once (2026-11-16, agent-selected)

Confirmed by Jay: no. These are agent choices within REQ-CGPV-42 / DES-CGPV-42. The coordinator set three constraints: once per seat, 팁 그만 보기 respected, and never mid-task for any seat.

- **"Once" is per seat (coordinator).** Classroom PCs are shared, so once per computer would show it only to the first learner. The key is the 팁 보기 seat (`lessonTips.currentSeat`, from `collapseSeat`). Seats that have seen the tip go in a bounded globalState list (200, oldest first out), never synced. With no seat known, it is not shown and nothing is stored.
- **Tips off wins (coordinator).** A seat that chose 팁 그만 보기 never sees it. The tip is a tip, and the learner already said no to tips.
- **Never mid-task, for every seat (coordinator).** The register row says "never in minors cohorts mid-task"; Studio applies it to everyone. "Mid-task" means the current task has messages. The webview judges this only after that task's history has arrived, because the host posts config before history and an old task looks empty in between.
- **When it counts as seen (agent choice).** As soon as it is drawn, not only on close. A learner who closes the window without pressing close does not get it again; that is what "at most once" means. A panel remount in the same window keeps a tip that is still open (the 새로운 기능 pattern, CGP-SHELL-R-035), so a hide/show of the panel does not swallow it. Any hide after drawing (close, the task's first message, voice going away) closes it for good.
- **Placement (agent choice, differs from DES-CGPV-42's "popover").** It is a note in the flow, right under the voice control, with a border pointer aimed at the 음성 대화 button. A floating popover would cover the composer or the transcript at 320px, and it would need its own focus and dismiss rules. A row in the flow covers nothing, takes no focus and has no animation.
- **Copy (agent-written).** "음성 대화를 누르면 말로 코치와 이야기할 수 있어요." The close button is "음성 대화 팁 닫기". The copy names the button the learner sees and what it does, and nothing more. There is no capability or score wording.
- **Where it is not.** The unmounted VoicePanel, dictation alone and the instructor console. VoiceConversationControl and `voiceConversation.ts` are unchanged.
- **Not covered:** a real installed App, a real microphone and a real screen reader.
