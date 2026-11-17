## CGP-DS-D-017: personal message bubble geometry (2026-10-25, owner decision)

- Identity mark: not rendered in the personal chat. The later personal-chat polish removed boxed assistant icons on purpose; DES-CGP-DS-22's 18px mark is adapted away. The test asserts no `.hps-assistant-mark` node and no 18px square node or pseudo-element in an assistant message.
- Bubble background: keep the host token (`--vscode-list-inactiveSelectionBackground`, as shipped) instead of the text colour at 6-8%. It follows the learner's VS Code theme and the host-theme-mapping contract. The test asserts the computed background equals the mapped host colour in Dark+ and Light+ and that the text keeps at least 4.5:1 on it.
- Radius: keep the shipped `18px 18px 6px 18px` (tail corner at bottom right). The test asserts the four computed radii.
- Kept as shipped: prose 40em, user bubble max-width 85% including padding (border-box).

