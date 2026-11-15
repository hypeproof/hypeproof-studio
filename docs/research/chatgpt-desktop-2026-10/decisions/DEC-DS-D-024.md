## DEC-DS-D-024: the IME guard's key set and the host barrier (CGP-DS-D-024, 2026-10-22; agent choice, not a new human agreement)

| Choice | Decision | Why | Default | Needs Jay |
|---|---|---|---|---|
| Arrow-up history | No Arrow-up prompt recall is added. The composer's composition check runs before every other key branch, so a later recall (CGP-CHAT-R-002 / DEC-08) inherits it; the test already presses Arrow-up during composition | The row guards a key, not a feature; adding recall is out of this row's scope | No new behaviour | no |
| Host forwarding | One document-level bubble listener stops a composing keydown (`isComposing` or 229) before the window, where VS Code's webview host forwards keys to the workbench dispatcher. Plain keys are untouched | Fewest moving parts: one place covers every text field, including ones that do not stop propagation themselves | On (composition keys only) | no |
| Native default | The composer, edit box and dialog hook never call `preventDefault` on a composing key; the IME and the browser keep the commit/cancel and Tab's own focus move. Form fields (task rename, purge dialog) keep their existing hold on a composing Enter, which only stops implicit submission | Taking the key from the IME would eat the syllable | On | no |
| Keyup | The barrier covers keydown only. The host also forwards keyup, but workbench keybindings dispatch on keydown | Smallest change | On | no |
| Chalk | Only `manage.html`'s document Escape handler acted on a key a text field can see; it now ignores a composing Escape. Other Chalk pages have no key handlers; form submission during composition stays with the browser | Smallest change at the only handler found by `grep keydown chalk/src/ui` | On | no |

| CGP-DS-D-020 | Apply card geometry to Studio settings, write/outbound/purge and Chalk outbound consent; keep host-native confirms, navigation drawers and nonmodal voice contracts. Use 20px padding and viewport-clamp the 320px minimum; cancel deferred Studio answers on unmount. | Conservative existing-surface scope, no new learning interruptions or permission grants; CSS animations own dismissal timing. | On; visual/lifecycle only | no (agent-selected 2026-10-22) |

