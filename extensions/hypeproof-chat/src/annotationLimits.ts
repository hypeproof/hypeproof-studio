// CGP-ART-R-001: limits shared by the host batch and the webview tray (no imports: the webview bundles it).
export const ANNOTATION_LIMIT = 10;
export const COMMENT_MAX = 300;

/** C0/C1 controls, soft hyphen, Arabic letter mark, zero-width and joiner marks, LRM/RLM,
 * U+2028/2029, the bidi embeddings, overrides and isolates, word joiner and invisible operators, BOM. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
export function neutralizeComment(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').slice(0, COMMENT_MAX);
}
