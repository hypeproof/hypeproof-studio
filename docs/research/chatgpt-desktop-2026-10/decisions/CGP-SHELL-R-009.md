## CGP-SHELL-R-009 implementation choice — 2026-10-22

Agent choice, not a new human agreement: use a host-owned, reference-counted
native helper for automatic system idle sleep only. macOS `caffeinate -i -w`
binds to the extension host PID. Windows executes a fixed C# method on one thread,
sets `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`, then waits for stdin EOF and clears it;
closing the host also closes that pipe. Explicit user sleep, lid close and display
sleep remain under OS/user control. No settings or learner safety policy changes.
A missing helper logs a fixed diagnostic and never prevents the learner's work.
The preview lease spans preparation through actual preview readiness, not the
lifetime of the local preview server. Queued unsent input holds no lease.
Windows API reference: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate

