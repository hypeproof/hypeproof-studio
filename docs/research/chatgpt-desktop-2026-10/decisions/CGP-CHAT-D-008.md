| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| CGP-CHAT-D-008 (copy feedback lifetime) | Code-block copy success stays at least 4s and is announced through role=status; failure is role=alert and never times out. CGP-DS-R-025 wins over the D-008 "2s, status only" wording. | CGP-DS-R-025 is the design-system rule for copy feedback and is already merged on main; keeping one lifetime for answer and code copy avoids two timers. D-008 keeps its chrome (32px strip, 44px targets, 160ms label, monospace, contrast). | On | owner decision 2026-10-24 |
