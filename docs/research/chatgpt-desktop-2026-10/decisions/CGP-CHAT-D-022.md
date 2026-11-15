## CGP-CHAT-D-022: math layout (2026-10-26, agent choice)

- Found met on main: REQ-STUDIO-ANSWER-MATH (CGP-CHAT-R-022) already centres display math in its own scroller, loads only bundled KaTeX fonts and lets math inherit the prose colour. No product code changes.
- "Baseline-aligned" is measured, not assumed: a zero-size inline-block before each inline formula marks the sentence baseline and one at the end of each KaTeX base marks the formula's; they must agree within 0.5px for a plain term, a fraction and a sub/superscript, in both seats, both themes, both widths and forced colours.
- "Text token colour" is `--vscode-foreground` with the `--hp-text-primary-default` fallback, the token answer controls use. Math must equal it, not only the surrounding prose, so a later prose override that drifts off the token is caught.
- Default state: unchanged (display only).

