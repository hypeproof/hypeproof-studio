export interface ReplyChoices { before: string; after: string; options: { number: number; label: string; recommended?: boolean }[] }

// Cf covers bidi marks and overrides, zero-width and invisible characters, soft hyphen and tag characters.
// The whole text may keep TAB, LF and CR; a label may keep none of the controls.
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;
const UNSAFE_LABEL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** Only an explicit, flat invitation to choose becomes reply UI. Ordinary lists stay prose. */
export function replyChoices(text: string): ReplyChoices | null {
  if (text.length > 12000 || UNSAFE_TEXT.test(text) || /```|~~~/.test(text)) return null;
  const lines = text.split('\n');
  const start = lines.findIndex(line => /^1[.)]\s+\S/.test(line));
  if (start < 0) return null;
  const before = lines.slice(0, start).join('\n').trim();
  if (!/(객관식|번호만.{0,16}(답|선택)|골라|고르|선택해|선택하|어느 쪽|어떤 쪽|가까웠|가깝)/.test(before.slice(-650))) return null;
  const options: ReplyChoices['options'] = [];
  let end = start;
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (!line.trim()) continue;
    const match = /^(\d)[.)]\s+(.+)$/.exec(line);
    if (!match) break;
    if (Number(match[1]) !== options.length + 1 || options.length >= 8) return null;
    const rawLabel = match[2].replace(/\*\*|__/g, '').trim();
    // Only an explicit trailing marker is a recommendation; never infer from prose.
    const recommended = /\s+(?:\[추천\]|\(추천\))$/.test(rawLabel);
    const label = recommended ? rawLabel.replace(/\s+(?:\[추천\]|\(추천\))$/, '').trim() : rawLabel;
    if (!label || label.length > 220 || UNSAFE_LABEL.test(label) || /[<>`]|https?:|\[[^\]]*\]\(/.test(label)) return null;
    options.push({ number: Number(match[1]), label, ...(recommended ? { recommended: true } : {}) });
  }
  if (options.length < 2 || lines.slice(end).some(line => /^\s*\d+[.)]\s/.test(line))) return null;
  return { before, after: lines.slice(end).join('\n').trim(), options };
}
