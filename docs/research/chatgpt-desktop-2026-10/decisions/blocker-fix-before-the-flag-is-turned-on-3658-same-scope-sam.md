### Blocker fix before the flag is turned on (#3658, same scope, same approval)

Verifier findings S1 and S2 on #3657, plus hardening. The flag stays default off.

- S1 fail closed: the core reads `hypeproofChat.trustStudioFolders` itself at trust-decision time (`configurationService.inspect(...).userLocalValue === true`, never a workspace or default value). Turning the flag off applies to the very next session; the extension no longer writes an `enabled` copy. The core also reads the workbench's disabled-extension list, so with the chat extension disabled the record alone grants nothing. The disabled list is read at both the profile and the workspace scope (either disables), failing closed on an unreadable list. The extension is built in, so uninstalling does not apply.
- S2: an explicit "Don't Trust" on a file folder is stored in the application-scope key `hypeproof.studioFolderTrustDenied` and wins over the record in every later session; an explicit "Trust" removes it.
- Hardening: Studio creates the leaf folder with a non-recursive `mkdir` and records only when that call succeeded (no check-then-create race). The record stores the real path and the folder's creation time; the core compares it with `fileService.stat().ctime` (cached before the synchronous decision), so delete + recreate at the same path prompts. The record shape is now v2 (`{path, birth}`); the earlier v1 record was never shipped and is ignored.
- "Don't Trust" is stored even while the flag is off: it can only add prompts, and a refusal should survive the flag being turned on later.
- The extension creates the leaf folder before `ActivityConnections.prepare` (which makes the folder itself on the class, trial and activity paths); a smoke step runs that real sequence.
- If creating the leaf throws (parent is a file, dangling link, read-only), the extension ignores it so `ActivityConnections.prepare` still gives the #3213/#3218 guidance. If preparing fails after Studio made the folder (bad activity id), Studio removes it when it is still empty and still the same folder (non-recursive `rmdir`, creation time checked) rather than recording it: a failed open leaves nothing behind and the retry creates and records a fresh folder.
- Folders Studio creates while the flag is off are still recorded, so turning the flag on trusts them (intended).
- Not covered: content cloned or downloaded into a Studio-created folder later runs trusted; a UNC or network `workspace_root` is trusted like any other recorded folder; a symlinked `workspace_root` records the real path and prompts (fails closed).

