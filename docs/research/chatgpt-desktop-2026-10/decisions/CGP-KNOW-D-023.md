## CGP-KNOW-D-023: "AI가 기억하는 것" in the settings dialog (2026-11-01, agent-selected)

Builds DES-KNOW-41 on REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023): one store, one host, one view message.
- "Delete opens confirm with 취소 default focus": the host's native modal cannot promise which button has focus on every platform, so the settings list confirms in the chat's own dialog (a modal `<dialog>` over 대화 설정, 취소 focused first; the trash purge confirm is the precedent). To keep R-023's guarantee that the file deleted is the file the learner saw, each listed item carries a pin (a digest of device, inode, change and birth time, size and content digest) and the dialog's delete sends it; the host recomputes the pin and deletes that exact file or refuses ("바뀌었어요"). Without a valid pin (the 내 작품 view) the host still asks in its native modal.
- Search: committed text only (IME-safe). It filters the items' words (NFC, case-folded), not file names.
- Source link under the text on every width (so at 320px it is below the text, never beside it).
- The list mounts while the dialog is open: each opening reads the store fresh; nothing is drawn where the host has no view (class, lesson, instructor).
- Default: on wherever the memory store exists; learner floors 44px and 14px.
- Fix round 1 (verification): the confirm now uses `useDialogFocus` (modal) like the trash purge, so real Tab and Shift+Tab stay inside it and its Escape is stopped on its own element (대화 설정 stays open). Its class is in radius-scale-computed's DIALOGS list. The delete notice in this list reads "기억을 지웠어요." instead of the file name the list never shows.

