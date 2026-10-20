/**
 * CGP-DS-R-018 / REQ-STUDIO-STROKE-ICONS — host glyph keys → stroke icons.
 *
 * The host protocol names a timeline line's icon (`toolLog.icon`, `ChatMessage.tool.icon`) and an
 * error banner's icon (`errorBannerPresentation().icon`) with an emoji string. Those strings are
 * stored in task history, pinned by host tests and read by older transcripts, so they stay as they
 * are: here they are keys. The webview never draws them. It maps each key to one icon of the
 * stroke set (ChatIcon), so the glyph follows the theme colour and forced colours on every OS.
 *
 * An unknown key draws the neutral dot, never the raw string: a new host icon cannot bring an
 * emoji back to the screen (test/stroke-icons.smoke.mjs).
 */
import type { IconKind } from './ChatDetails';

/** The variation selector and zero-width joiner are not part of the key. */
const normalize = (glyph: string): string => glyph.replace(/[\uFE0E\uFE0F\u200D]/g, '').trim();

const GLYPH_ICONS: Record<string, IconKind> = {
  // Tool and timeline lines (toolActivity.ts, chatPanelHelpers.browserToolLogLine, chatPanelProvider.ts).
  '🔍': 'search', '🔎': 'search',
  '✍': 'pencil', '📝': 'pencil', '✏': 'pencil',
  '⌨': 'terminal', '🖥': 'terminal',
  '🌐': 'globe',
  '🔧': 'tool', '🛠': 'tool', '🤖': 'tool',
  '💭': 'thought',
  '…': 'dots',
  '🖼': 'image', '📸': 'camera',
  '🔗': 'link', '↗': 'external',
  '👀': 'eye',
  '👆': 'pointer', '🖱': 'pointer',
  '◀': 'back', '▶': 'forward',
  '💬': 'message',
  '🔽': 'chevron-down',
  '↕': 'scroll',
  '🔄': 'retry',
  '🧪': 'flask',
  '💡': 'bulb',
  '⏳': 'clock',
  '🔒': 'lock',
  '📖': 'book', '📄': 'file',
  '📦': 'package',
  '🗂': 'folder',
  '📏': 'ruler',
  '🤝': 'people',
  '⚠': 'alert',
  '✓': 'check', '✅': 'check',
  // Error banner (errorBannerPresentation.ts).
  '🌙': 'moon',
  '🎟': 'ticket',
  '🧰': 'tool',
  '🔌': 'plug',
  // Naming card tone marks (TONE_LABELS.namingEmoji, mirrored in ChatPanel's namingIcon).
  '✨': 'sparkle', '🎮': 'game',
};

/** The stroke icon for a host glyph key; an unknown key gets the neutral dot. */
export function glyphIconKind(glyph: string | undefined | null): IconKind {
  return GLYPH_ICONS[normalize(glyph ?? '')] ?? 'dot';
}

/**
 * Some host labels repeat their icon as the first character (`📏 390·1280px 확인 — 통과`,
 * `🗂 이전 버전 보관 — …`). The icon slot already draws it, so the label drops one leading
 * pictograph and the space after it. Words are never touched.
 */
const LEADING_PICTOGRAPH = /^(?:\p{Extended_Pictographic}|[\u2190-\u21FF\u25A0-\u25FF])[\uFE0E\uFE0F\u200D]*\s*/u;
export function stripLeadingGlyph(label: string): string {
  return label.replace(LEADING_PICTOGRAPH, '');
}

/**
 * A host notice that opens with its own glyph (`🖼 화면과 내용을 … 붙였어요`): the glyph becomes the
 * icon and the words stay as they are. `glyph` is null when the text has no leading pictograph.
 */
export function splitLeadingGlyph(text: string): { glyph: string | null; text: string } {
  const match = LEADING_PICTOGRAPH.exec(text);
  return match ? { glyph: match[0].trim(), text: text.slice(match[0].length) } : { glyph: null, text };
}
