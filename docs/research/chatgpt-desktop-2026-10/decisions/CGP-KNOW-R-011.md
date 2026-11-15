## CGP-KNOW-R-011: open a file from 내 작품 (2026-11-16, agent choices within the coordinator's constraints)

- Built on REQ-STUDIO-MY-WORKS-DRAWER, which had listed opening as "Not built". It reuses the drawer's inventory and seat gate. No new write path.
- Only a path the last provenance list showed, for the same seat (activity scope and profile) and work folder, may open (verify-r027). Any sign-in change (the token, the issuer token, the account, a rehearsal seat) drops the list, even on the same activity and profile. The canonical check (the thumbnail's, plus folders and hard links refused) runs again at open time, so a file replaced by a link after the list is refused (coordinator: TOCTOU).
- HTML (`.html`/`.htm`) opens in Studio's preview.
- An allowlisted image (png, jpg, jpeg, gif, webp, svg) opens in the built-in image preview.
- Everything else opens in the default text editor (`vscode.openWith(uri, "default")`), never `vscode.open`, which could let a custom editor or a notebook renderer take the file (verify-r027). So `.ipynb` and `.code-workspace` open as text, and a `.vsix` gets the binary notice. The host smoke pins each.
- Never `vscode.env.openExternal` or the OS default app (coordinator).
- Windows names are refused: a colon in any segment (alternate data stream), and a trailing dot or space (verify-r027).
- A successful open closes the drawer, so the opened file is in view. A refusal shows one line in the drawer and keeps focus on the row.
- Not covered: a real installed app and a screen reader.
- Confirmed by Jay: no.
