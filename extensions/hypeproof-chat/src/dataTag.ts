// CGP-CHAT-R-011 / CGP-ART-R-007 — data delimiters around learner-attached text (node-free).

/**
 * Defuse anything that could read as an opening or closing data tag: `</file_content>`,
 * `</ file_content>`, a tag with no `>`, attributes, and fullwidth `＜/file_content＞`.
 * Every `<`/`＜` that starts such a tag becomes `‹` (and its `>`/`＞` `›`), so the text stays data.
 */
export function defuseTag(s: string, tag: string): string {
  const re = new RegExp(`[<＜]\\s*[/／]?\\s*${tag}\\b[^<>＜＞\\n]*[>＞]?`, "gi");
  return s.replace(re, (m) => m.replace(/[<＜]/g, "‹").replace(/[>＞]/g, "›"));
}
