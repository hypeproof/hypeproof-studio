## CGP-ART-R-021: overwrite change summary in the write approval (2026-10-26, agent-selected conservative implementation)

- Scope: only the optional write approval dialog (`writeFile` in `requireApprovalFor`; not in the default list). The default stays off; no new approval, data flow or permission. Every seat that reaches the dialog (personal, trial, pass, classroom/lesson, instructor local runtime) gets the same summary.
- Numbers: `diffGuard` on the current file and the call's resulting text, computed in the host before the dialog opens. Every rewrite in diffGuard's sense (`changed_ratio > 0.5`, `REWRITE_RATIO`) is warned. The register's label "거의 전부 바뀌어요" is shown from 80% (`ALMOST_ALL_RATIO`); between 50% and 80% the warning reads "절반 넘게 바뀌어요", because "거의 전부" next to "51%" would overstate it (copy honesty wins over the literal label).
- Whitespace-only changes read "글자는 그대로, 띄어쓰기·줄바꿈만 달라져요", not "그대로" (diffGuard ignores whitespace inside a unit).
- Unknown is a warning, not silence: when the change cannot be computed for an existing file, the dialog says so with the reason. The call's text is taken only from host-built requests (`sdkToolToActionRequest`); a webview-origin request never supplies it, so it cannot forge "내용은 그대로예요".
- Race: the file's sha256 (or absence) at prompt time must still hold after the answer, else the write is refused. A file that appears during the dialog is refused too: that would be an overwrite with no summary.
- Not built: DES-ART-21 bar and diff link (CGP-ART-D-021). Built by CGP-ART-D-021 below.

