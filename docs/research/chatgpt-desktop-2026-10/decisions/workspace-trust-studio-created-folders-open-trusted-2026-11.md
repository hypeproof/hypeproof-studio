## Workspace Trust: Studio-created folders open trusted (2026-11-10)

Problem (v2026.1109.0-rc.1 clean-Mac black-box run): on first open VS Code's Workspace Trust modal blocks the chat until clicked. #3577 removed it only for the review Dev copy, by turning trust off for that copy.

- Jay, 2026-11-10 (security setting): auto-trust only folders Studio itself created (class, free and trial work folders, numbered next folders, activity folders); any other folder the learner opens keeps the normal prompt; Workspace Trust is never disabled globally. Approved the core patch the same day, after the extension API turned out to have no way to trust a folder (`workspace.isTrusted` is read-only, `requestWorkspaceTrust` only prompts, the trust store is internal).
- Mechanism: `scripts/patches/core/hps-studio-folder-trust.patch` (hand-maintained, applied to the pristine 1.116 `workspaceTrust.ts`) adds a pure decision file and one hook in `doGetUriTrustInfo`. The chat extension records a folder's real path in its `globalState` only when the directory did not exist before Studio prepared it. The key is that record, not a path name; a same-path folder Studio did not create, a child, a parent and a remote folder all prompt.
- Default off (agent-selected flag): `hypeproofChat.trustStudioFolders`, machine scope, default false. Off, behaviour is unchanged. Turning it on is a later step after the core batch base rebuild and a clean-Mac check.
- Minor seats: same rule, Studio-created folders only.
- Ships with the next core batch base rebuild; nothing changes until that base is built and the flag is on.
- Known limit (closed by the blocker fix below): a learner who deletes a Studio-created folder and recreates the same path by hand stayed trusted while the record existed.
- Confirmed by Jay: yes (2026-11-10).

