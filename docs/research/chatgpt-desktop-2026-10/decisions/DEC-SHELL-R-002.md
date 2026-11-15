## DEC-SHELL-R-002: prepared update handoff (2026-10-22; agent implementation choice)

Retain only an explicitly requested, verified download; do not add background downloads.
Install after all native shutdown vetoes accept an app exit, never on reload or
workspace switch. An app exit is QUIT (Cmd+Q, File > Exit) or, on Windows, closing
the last window (X, Alt+F4): the pinned VS Code reports that close as CLOSE and quits
from the main process after the window is gone, so the renderer hook treats CLOSE
with one window left on Windows as the exit, as upstream workingCopyBackupTracker
does. Closing a window on macOS, or one of several windows on Windows, never installs. A running turn or class hold still defers installation,
even when the learner accepts the active-turn quit dialog. The updater remains
available until its shutdown joiner finishes; local extension-host teardown becomes
a deferred Last joiner, matching the existing remote-host teardown contract.

Natural quit stays closed (Windows explicitly disables the remembered runcode task
and reboot). The existing explicit restart retains relaunch. Persist per installation,
recheck prepared bytes, reject stale/downgrade targets, consume once across windows,
and clear only the pending record belonging to the explicit-restart modal. A failed
or tampered handoff discards that record and keeps the old app; the learner may request
a fresh download. This adds no minors' permission or background installation flag and
is not a new human agreement.

Shared handoff exclusion uses the existing inter-process `accountLock` in a separate
update directory and a lease naming the detached installer (pid, per-launch nonce,
launch time). A second window or a newer pending download cannot launch another
installer while that process is alive. Because pids are reused, the lease also
expires 10 minutes after launch, so an unrelated process can hold updates back for at
most that long; a lease whose process is gone, or one that is unreadable, is deleted.
The Windows wrapper waits for Setup itself (`WaitForExit`), not `-Wait`, which also
waits for descendants and would hold the lease through the whole session Setup
relaunches after an explicit restart. A refused explicit restart (another installer
running, or a turn or class started) does not quit Studio; it says so in Korean and
keeps the prepared update for the next eligible quit.

