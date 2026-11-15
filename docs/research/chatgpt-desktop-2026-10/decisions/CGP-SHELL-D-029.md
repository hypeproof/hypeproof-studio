## CGP-SHELL-D-029: reason choices and cooldown blocked on the Service (2026-10-25)

The parent REQ-SHELL-30 asks for an optional reason, approval/refusal states and a 10-minute cooldown between requests. The pinned Service requires a non-blank reason and has no cooldown, so Studio ships the part it can keep honestly: a free-text reason up to 200 characters (labelled required), an IME guard, a live counter and a receipt taken from the Service record. Reason choices and the cooldown are recorded as blocked on the Service contract (owner decision 2026-10-25); they are not simulated in the webview.

