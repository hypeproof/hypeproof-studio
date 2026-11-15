## DEC-ART-R-011: version sharing summary (2026-10-22, agent choice)

Use the existing publish panel (DES-ART-11's location), without adding permissions or
creating links. Group experiments by immutable version ID, count distinct active links,
and display the latest active expiry; copy the longest-lived link so its expiry matches
that summary. A version with no links is unpublished; one with only revoked/expired links
is disconnected. A Service read that fails or answers malformed shows "공유 상태를 확인하지 못했어요"
in a status region, never "공개하지 못했어요" and never a claim that a page is private;
the last known rows stay, marked with their read time and with copy off. Refresh every 15 seconds and on focus; recheck immediately
before clipboard write. Remote changes are visible after that read, not pushed in real time.
The existing curriculum-runtime grant remains authoritative for every seat/runtime.
This display does not implement the separate minor-publication confirmation row R-012.
No new recipient, default, publication permission or human agreement is introduced.

