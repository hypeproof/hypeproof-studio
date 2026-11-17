### DEC-ART-03 — Preserve annotations at the browser close boundary

Use the native modal's first/close-affordance action for keeping annotations and
a separate explicit discard action. Only a matching scope and revision can be
discarded. Native BrowserTab close notification arrives after closure, so preserve
the annotation draft and ask then; do not claim to cancel the browser's close.
Do not automatically navigate or send content when the learner chooses to keep.
Activity switching is blocked before credentials, folder or task mutation until
discard is chosen. A transient unexpected scope switch parks the prior draft in
this window only, without sending it or copying it to another activity.

