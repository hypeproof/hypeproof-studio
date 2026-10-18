---
title: Task workspace
product: studio
doc_type: design
status: canonical
owner: core
version: 0.1.0
last_reviewed: 2026-10-18
audience: maintainers
source_paths:
  - extensions/hypeproof-chat/src/taskWorkspaceStore.ts
  - extensions/hypeproof-chat/webview-ui/src/TaskWorkspace.tsx
quality_gates:
  - implementation-linked
---

# Task workspace (#1756)

Personal and trial activities keep multiple tasks in the existing Studio shell.
Each task owns its conversation, unsent draft and selected source. Classroom and
instructor layouts continue through their existing paths. The Service still owns
account access, tool grants and shared project memory.

The host stores a checksummed, versioned snapshot under private global storage,
partitioned by a digest of the activity identity and canonical workspace. Migration
imports only available local history and draft; it cannot recover messages an older
release already removed. The full transcript is separate from the model's
200-spoken-message context and from measurement spool retention. This v1 is local,
unencrypted at rest and protected by OS account/file permissions.

Writes serialize and check the disk revision under an exclusive owner lock. A
temporary file is flushed before atomic replacement. Invalid, corrupt, foreign or
stale state fails visibly without replacing the original. Only a demonstrably dead
process on this host can lose its lock; elapsed time never steals a lock. Unknown
ownership stays an explicit recovery error. A second process reloads after another
writer commits.

Actions carry activity and task identity. Navigation freezes input and flushes the
initiating view's draft before changing task. Pending model work blocks navigation.
A source opens only if its HTTP(S) URL belongs to the active task's citations;
native browser opening uses `preserveFocus` and grants no new tool authority. The
source shelf follows the latest citation until the user pins one.

Visual direction: quiet history rail, wide reading column, optional source shelf.
Existing theme tokens supply canvas, foreground, divider, muted text and focus
accent (dark fallbacks #202226, #e1e1e1, #34383e, #a4aab3, #799ed7). The host system
font preserves Korean text quality with no font download. The conversation carries
the visual weight; no marketing cards, decorative motion or invented metrics.
At narrow widths, navigation and sources open on explicit action. These drawers
contain keyboard focus, make background controls inert, close on Escape and return
focus to the opener. Personal tasks without a lesson omit the mission banner and
default classroom operations; explicit Service panel choices still apply. Failed
draft writes keep the current task and input, show one dismissible error and clear
the error after a successful save.

This is the approved VS-02/03 foundation. Standalone Electron, branches, durable
in-flight tool journals, curated memory, full-text search, OAuth popup ownership
and cross-device continuation need separate acceptance. Pinning governs the shelf,
not every autonomous browser tool. See [acceptance](../testing/task-workspace.md).

## Personal chat detail (CP-R1, 2026-10-18)

The user's follow-up asks for the conversation's visual finish as well as the
surrounding workspace. Keep the theme-native six-color palette: canvas #202226,
panel #17191d, text #e1e1e1, divider #34383e, muted #a4aab3, focus #799ed7 (host
light/high-contrast theme values override these fallbacks). System sans serves
Korean prose and controls; the existing editor monospace remains for code. This
is scoped to personal tasks, not a replacement of the learning-surface tokens.

Use one 740px maximum reading column for messages and composer. Assistant text
has a quiet identity mark and open paragraph rhythm; user text has a compact
rounded surface. Tool outcomes, citations and answer actions stay subordinate
to the answer. The composer is one rounded surface with its primary send/stop
action inside. It grows with the draft up to 192px, including restored drafts
and width changes, and then scrolls internally. Keyboard hints remain visible.

Motion signals an actual change: a live response enters once in 180ms, pending
dots move for at most 3.8 seconds, copy confirmation enters in 160ms, send/stop
react to hover/press in 140ms. No artificial typing delay, progress percentage,
token-by-token replay, font/network request or animation dependency is added.
Reduced-motion disables these effects, including scroll animation. Pending text
continues statically until the real stream ends; a guessed work stage is not used.

The transcript follows growth only while the reader is near its bottom. Reading
older content preserves the viewport; an explicit latest-message control or a
new send resumes following. Copy confirmation requires a successful clipboard
write; rejection remains visible. Controls work with keyboard and touch, without
hover-only actions. Existing Korean IME, queued-message and stop behavior remain.
