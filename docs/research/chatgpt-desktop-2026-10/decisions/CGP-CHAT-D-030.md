## CGP-CHAT-D-030: shortcut sheet table and Cmd/Ctrl glyph (2026-10-26, agent choice)

- Gap on main: the CGP-CHAT-R-030 sheet was a definition list in flex rows (key and action wrapped onto separate lines in narrow windows) and listed no Cmd/Ctrl key, because none was bound when it shipped. The find bar (CGP-CHAT-R-027) has since bound Cmd+F on macOS and Ctrl+F elsewhere in every ChatPanel seat, and the sheet did not list it; the requirement text still said "no find in the chat webview".
- Built: the sheet is a `<table>` with column headers 키 and 하는 일, keys as the row header. A 대화에서 찾기 row shows `⌘ Cmd + F` on macOS and `Ctrl + F` elsewhere, with a note for Enter / Shift+Enter inside the find field (bound by the same bar). The R-030 rule stands: a row is listed only while its key is bound.
- Not listed: the sketch dialog's Cmd/Ctrl+Z (CGP-CHAT-D-020). It works only inside that dialog, which shows its own hint, and only in seats where the sketch tool is offered.
- Narrow windows: key caps stay on one line; at 480px and below they wrap between caps (never inside one), so the table keeps two columns at 320px. 44px close target and >=14px text are unchanged.
- Focus trap and Esc: unchanged code (the settings dialog's modal focus contract); now measured with real Tab / Shift+Tab input.
- Default state: on; display only, no host message, file or network request.

