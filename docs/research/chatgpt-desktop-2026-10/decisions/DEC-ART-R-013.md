## DEC-ART-R-013: 7-day counts per test version (2026-11-13, agent choice)

- Source (agent choice): the existing evidence read (`GET /v1/curriculum/experiments/:id/evidence`), whose sessions
  the Service recomputes from stored CR-23 events on every call. There is no new Service route and no stored
  aggregate, so a count cannot drift from its events. The project read's all-time per-channel `sessions_opened` has
  no time window and no completions, so it was not used.
- Read budget (agent choice): the counts never block the panel. Missing reads start in the background, in parallel
  (at most 6 per view, 4 s timeout each), and the panel redraws when they settle. Successful reads are kept for 60 s; a
  failed read says `횟수를 확인하지 못했어요` and is retried after 30 s. While a read is in flight the version says
  `횟수 확인 중`, quietly.
- Copy (agent choice, deviates from DES-ART-13): the tiles say `열어 본 횟수` and `끝까지 한 횟수`, not `연 사람` and
  `끝까지 한 사람`. CR-72 says counts are of sessions and device pseudonyms, never of people. A returning visitor opens
  several sessions, so "people" would overstate. The required empty sentence `아직 연 사람이 없어요` is kept because it
  states an absence, not a count.
- "Finished" (agent choice): a session with at least one `task_complete`. An experiment with several declared tasks
  therefore counts a session that finished any of them. The per-task breakdown stays in the evidence panel.
- Attribution (agent choice): a session counts for the `product_version` it records, else its experiment's pinned
  version, so a comparison experiment's variant sessions land on their own version.

Confirmed by Jay: no.

