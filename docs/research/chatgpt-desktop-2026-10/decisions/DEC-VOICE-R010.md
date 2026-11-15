## DEC-VOICE-R010: own-preview text only (2026-10-22; agent implementation choice)

Context attachments keep integrated-tab viewport screenshots, but collect no DOM or AX
text from external pages. Full body text (including off-screen text) requires the live
HTTP(S) document to match this window's current local preview origin and captured URL.
Unknown ownership fails closed, including screenshot-only callers that do not supply an
owner. The existing page-context grant remains default off; this does not enable voice,
add an OS capture API or expand any cohort grant. Learner copy changes only to stay
true: when no page text goes, the notice says 화면 사진만 or 주소와 제목만 and why, and
the chip reads 페이지 정보 with the reason on it (fix round 1, 2026-10-23).
Generic agent browser tools retain their independent CR-11 scope contract; this slice
changes the page-context attachment primitive and its command caller.

