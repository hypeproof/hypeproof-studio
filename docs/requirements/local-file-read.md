# Bounded local file reading

Scope: #3353, a bounded slice of #3225. Owner: Jay. Parent contract:
REQ-STUDIO-DEV-SUBSCRIPTION in [Studio Dev](../dev/studio-dev.md#local-subscriptions).
The explicit developer-only local subscription runtime uses the existing lesson
profile, workspace path checks and approval policy. This does not extend the
production SDK-native Read tool or its funding contract.

## REQ-LOCAL-FILE-READ

Read accepts a workspace `file_path` and optional nonnegative integer
`offset_bytes`. A complete small UTF-8 file is returned unchanged. Larger text
returns a bounded chunk, byte positions, total size and a `revision` token;
continuation must carry the returned offset and revision. Offset zero without a
revision restarts reading. UTF-8 code points must not be split or replaced.

The implementation reads at most 48 KiB at a time and also caps JSON-escaped
text to 48 KiB; metadata leaves the tested tool response below 64 KB. This is
one result's budget, not a promise that accumulated history fits a provider
request limit. Do not read the entire file merely to compute a chunk.

Reject malformed offsets, stale/missing continuation revisions, nonregular
files, invalid UTF-8, NUL bytes and known PDF/ZIP container headers. Explain that
binary documents require extraction; do not claim extraction happened. Revision
uses device/inode/size/mtime/ctime metadata, checked before and after reading.
It detects ordinary edits/replacements, not adversarial metadata restoration or
an atomic snapshot. Unknown binary formats are not exhaustively classified.

Preserve capability denials, workspace traversal/symlink restrictions and write
approval. Reading does not ask for write approval or broaden the tool grant.

## Verification

`extensions/hypeproof-chat/test/large-file-read.smoke.mjs` checks >2 MB HTML,
small Korean text, lossless multibyte continuation, escaped JSON response size,
invalid inputs, binary containers, stale revisions, actual authenticated MCP,
and actual Codex dynamic-tool dispatch with a scripted external app-server.
The default smoke loop discovers this file. Existing local-runtime smoke covers
approval, write/edit/read, isolation, credentials and cancellation.

Passing fixtures do not establish real CLI/model behavior, installed-app UX,
production HTTP 413 avoidance, PDF/Office extraction, outlines/search, aggregate
budget compaction or summary caching. Those remain under #3225; it stays open.
