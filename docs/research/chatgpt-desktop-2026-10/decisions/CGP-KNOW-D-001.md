## CGP-KNOW-D-001: rail search field placement and folding (2026-10-26, agent choice)

- Found on main: the field already sat at the top of the task list (after 새 작업, before 최근 작업) with a 44px input, theme input colours and commit-only IME filtering (CGP-KNOW-R-001). The row adds the fold below 360px and the measured checks.
- What "below 360px" measures: the window (webview) width. The rail is resizable only between 200 and 320px, so a rail-width rule would fold it always. Below 700px the rail is already the narrow task-list dialog, so the fold applies inside that dialog.
- Fold rule: only an empty field that the learner has not opened folds. A typed or composing query never folds, so an active filter is never hidden. Opened state belongs to the activity, like the query, and ends on blur of an empty field or when the narrow list closes.
- Escape: not given a second meaning. On the narrow list it still closes the list (the dialog's existing rule); reopening shows the folded icon.
- Empty-result copy: the register's "찾는 작업이 없어요" is not adopted. The owner reconciliation of CHAT-R-026 × KNOW-R-001 (2026-10-25) kept "찾는 이름이 없습니다. 다른 이름으로 찾아보세요." for the title filter and uses "찾는 대화가 없어요" for the message group; a third wording would make the two lines disagree.
- Seats: personal and trial task workspaces (the only seats with a task rail). Default state: on; display only, no host message, nothing stored.

