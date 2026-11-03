// CGP-CHAT-R-030 — the learner's shortcut sheet lists only the chat keys this webview binds.
// Every row names the handler that owns it; a key with no handler (Esc to stop an answer, a
// focus-the-composer key) is not listed until it is built.

export type ShortcutPlatform = 'mac' | 'other';

export interface ChatShortcut {
  id: 'send' | 'newline' | 'close' | 'find' | 'conversation' | 'help';
  /** Key caps in press order, already in the platform's names. */
  keys: string[];
  label: string;
  /** Where it works, when that is narrower than "the chat". */
  note?: string;
}

/** `navigator.platform` reflects the host OS inside the VS Code webview renderer. */
export function shortcutPlatform(platform: string | undefined): ShortcutPlatform {
  return /mac|iphone|ipad/i.test(platform ?? '') ? 'mac' : 'other';
}

/** CGP-CHAT-D-030: the macOS glyph leads (⌘ ⌥ ⇧); Windows and Linux name the key (Ctrl, Alt, Shift). */
function modifier(name: 'Command' | 'Alt' | 'Shift', platform: ShortcutPlatform): string {
  if (platform !== 'mac') return name === 'Command' ? 'Ctrl' : name;
  return name === 'Command' ? '⌘ Cmd' : name === 'Alt' ? '⌥ Option' : '⇧ Shift';
}

/**
 * The rows, in the order a learner meets them. `taskWorkspace`: the personal task layout is
 * mounted, so its Alt+Shift+J conversation shortcut (TaskWorkspace.tsx, D019) is bound.
 */
export function chatShortcuts(platform: ShortcutPlatform, options: { taskWorkspace: boolean }): ChatShortcut[] {
  const rows: ChatShortcut[] = [
    // ChatPanel composer onKeyDown: Enter sends; during an answer it books the message (#416).
    { id: 'send', keys: ['Enter'], label: '메시지 보내기', note: '답하는 중에 누르면 끝나고 보내도록 예약해요' },
    // The textarea's own newline: the composer handler returns early for Shift+Enter.
    { id: 'newline', keys: [modifier('Shift', platform), 'Enter'], label: '줄 바꾸기' },
    // useDialogFocus / menu and panel handlers: Escape closes the open dialog, menu or panel.
    // (The composer ignores Enter while it is read-only: no activity or a missing task folder.)
    { id: 'close', keys: ['Esc'], label: '열린 창·메뉴 닫기' },
    // ChatFindBar isFindShortcut (CGP-CHAT-R-027): Cmd+F on macOS, Ctrl+F elsewhere, in every
    // ChatPanel seat; inside the bar Enter/Shift+Enter step through matches.
    { id: 'find', keys: [modifier('Command', platform), 'F'], label: '대화에서 찾기', note: `찾기 칸에서 Enter는 다음, ${modifier('Shift', platform)} + Enter는 이전 결과` },
  ];
  if (options.taskWorkspace) rows.push({ id: 'conversation', keys: [modifier('Alt', platform), modifier('Shift', platform), 'J'], label: '대화로 바로 가기', note: '작업 화면 안에서 눌러요' });
  // useShortcutSheetKey below.
  rows.push({ id: 'help', keys: ['?'], label: '이 단축키 목록 열기', note: '입력창 밖에서 눌러요' });
  return rows;
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"]';
const OWNS_KEYS = 'dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"], [role="dialog"]';

/**
 * Does this keydown open the sheet: a plain `?` (Shift+/ on most layouts) outside every text
 * field, with no IME composition, no Ctrl/Cmd/Alt, not repeated, not already handled, and not
 * inside an open dialog, menu or list that owns its own keys.
 */
export function opensShortcutSheet(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'defaultPrevented' | 'isComposing' | 'keyCode' | 'target'>, doc: Document = document): boolean {
  if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(TEXT_ENTRY) || target?.closest(OWNS_KEYS)) return false;
  // A modal elsewhere in the page (focus may sit on <body> under it) keeps the keyboard.
  if (doc.querySelector('dialog[open]:modal, [aria-modal="true"]')) return false;
  return true;
}
