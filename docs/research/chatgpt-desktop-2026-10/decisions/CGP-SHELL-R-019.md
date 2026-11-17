## CGP-SHELL-R-019 / CGP-SHELL-D-018: turning lesson tips off (2026-11-14, agent-selected; one clause parked)

Audit of main (origin/main 2026-11-14): both rows are `merged_into` CGP-CHAT-R-021 / D-021, which are built (#2767, #2972). The only tip is the served step's Chalk-authored hint (owner decision above, "CGP-CHAT-R-021: lesson tip source and action"), so there is no Studio tip catalogue to write or review. Never while a turn streams and one tip at a time are MET; D-018's 13px and 24px give way to the 14px and 44px floors, as D-021 already does. Missing: "팁 그만 보기 stops all tips until re-enabled".
- Preference (agent choice; per seat after coordinator review): globalState `hypeproofChat.lessonTips` holds `{ off: [seat…] }`, keyed by the collapsed-blocks seat id (`collapseSeat`, #4050/#4064), because classroom PCs are shared: one learner turning tips off must not hide them for the next. A seat not listed sees tips; an empty seat keeps its choice in memory only. Bounded to 200 seats, never synced, logged or sent; a corrupt value never removes help. The key and `LessonTipsPreference` are exported from vscode-free `src/lessonTips.ts` for the start page's 팁 보기 row.
- Action (agent choice): a third quiet button `팁 그만 보기` (muted ink, no underline, 44px) after `입력창에 넣기`. It hides only the tip row. The lesson's steps, instructions, mission header, 힌트 보기 and anything required by the instructor are untouched.
- Reversibility (agent copy; revised after verify-r027): right after the press the row says `팁을 껐어요. 여기 다시 켜기로 언제든 다시 켤 수 있어요.` with `다시 켜기` focused (role=status). It is never one-way: afterwards, and after a reload, a hinted step shows the quiet `팁을 꺼 두었어요.` with `다시 켜기` in the tip's place (no live region). A lesson seat's 설정 gear opens the app settings, and its in-chat settings dialog opens only from the access chip, so that quiet line is the always-present way back. The dialog also gets a lasting `팁 보기` checkbox (agent copy: hint `수업 단계의 도움말을 입력창 위에 보여 줘요.`). The start page row (CGP-SHELL-R-014) follows on the host's `lessonTipsState()` / `setLessonTips()`.
- Race (verify-r027): the host takes the seat only after the config build's staleness return.
- Parked (needs Jay): REQ-SHELL-19's "at most once per session and only after an observed trigger (e.g. 3 failed runs)". It contradicts the owner decision to show a step's hint from the start; gating instructor-written help behind three failures changes the lesson. Recommendation: keep hints shown from the start. If triggered help is wanted, add a separate Chalk-authored field (for example `hint_after_failures`) through a Service schema change, never Studio copy, with "once per session" applying only to it.
- Default state: tips on for everyone (unchanged). No flag, policy, Service or minor-seat change.
- Not covered: a real installed App and a screen reader: NOT RUN.
- The parked 3-failure clause only: Confirmed by Jay: yes (2026-11-15), chosen option "AI가 알아서 판단": REQ-SHELL-19's 3-failure hint is judged by the AI. Other choices in this entry: Confirmed by Jay: no.

## CGP-SHELL-R-019: AI-judged hint after failed runs (2026-11-15; Jay's scope, agent choices below)

**Jay (2026-11-15).** For REQ-SHELL-19's "after 3 failed runs", the coach judges when to give a hint; it is not a Chalk field. This supersedes the parked clause in "CGP-SHELL-R-019 / CGP-SHELL-D-018" in this file. Everything below is an agent choice under that decision, agreed with the coordinator, and is not Jay's.

**Audit.**
- The lesson part of the coach prompt is built in the Service (`worker/src/lib/chat-gate.ts`, both runtimes). Its intervention ladder (`learning-prompt.ts`) already says to climb when the learner "asked for help or failed repeatedly at the same step", and rung 3 is a hint that points at one place to check.
- The coach's history is text only (`proxyClient.ts`, #503): tool results of earlier turns are dropped, so the coach cannot see failures across turns.
- The tips switch (`hypeproofChat.lessonTips`, #4086) exists only in Studio.

**Choices.**
- **Studio observes; the coach decides.** There is no Service ladder edit. After 3 consecutive failed runs on a lesson step, the next request carries one model-only observation line (`src/runFailureHint.ts`, pinned verbatim). It carries a count only, never error text, paths or command output.
- **A failed run** is one learner turn whose last run-kind tool result was an error: Bash, PowerShell or the live preview start.
  - The host cannot tell a learner-requested run from a coach-chosen one, so it counts per learner turn: the coach's retries inside a turn are one run, and retries that ended in success are a success.
  - Whether a Bash non-zero exit is `is_error` is unmeasured here; the counter uses the host's `isError`.
- **Once per step per session.** The count resets on a successful run and on a step change, in memory only.
- **Channel.** The line rides on memory's per-turn context (`contextText` / `memoryContext`), so the learner's text, the Service's last-user-message record, the saved conversation, the spool and the webview never hold it. A turn carrying it runs as an ephemeral SDK session, like memory.
- **Never** with tips off, on a lesson without a `learning` block, for an instructor or on a local runtime.
  - Without `learning` there is no ladder, so a bare "the learner is stuck" could invite answer-giving. Those lessons are skipped; this is a stated limit in the requirement.
- **Minors.** The behaviour is the same and no new data leaves the computer (a count). On the proxy runtime the only run tool is the preview start in browser control; without browser control nothing is counted.
- **Prompt safety.** The line changes no grant, tool or policy. It says so itself, asks for one pointer and no answer, and lets the coach ignore it. It needs a prompt review in the verify.

**After verify-4219 (agent choices, coordinator).**
- The pinned line gains one restriction, `실패 횟수는 학생에게 말하지 마세요.`, so the coach never tells a learner how often they failed. It adds no permission.
- The host smoke pins that the hint turn runs as an ephemeral SDK session, so the line never persists in the CLI session file.

**Not covered.** A real coach's response to the line, and the SDK's real `is_error` on a failing Bash. Both are NOT RUN.

Confirmed by Jay: no (the decision to let the coach judge is Jay's; the choices above are not).
