import { useEffect, useRef } from 'react';
import { ChatPreferences } from './ChatPreferences';
import { chatShortcuts, opensShortcutSheet, shortcutPlatform } from './chatShortcuts';

/**
 * CGP-CHAT-R-030 — 키보드 단축키: a modal that lists the chat keys this webview binds, with the
 * platform's modifier names (⌘ on macOS, Ctrl elsewhere), as a key / action table (CGP-CHAT-D-030).
 * It reuses the settings dialog surface and its focus contract (REQ-STUDIO-FOCUS-RESTORE): Escape, × and the backdrop close it and focus goes back to the
 * opener, else the composer.
 */
export function ShortcutSheet({ open, onClose, opener }: { open: boolean; onClose: () => void; opener?: () => HTMLElement | null }) {
  if (!open) return null;
  const platform = shortcutPlatform(typeof navigator === 'undefined' ? undefined : navigator.platform || navigator.userAgent);
  // Read when the sheet opens: the personal task layout (and its Alt+Shift+J) may come and go.
  const taskWorkspace = typeof document !== 'undefined' && !!document.querySelector('.tw-workspace');
  const rows = chatShortcuts(platform, { taskWorkspace });
  return <ChatPreferences open={open} onClose={onClose} title="키보드 단축키" closeLabel="키보드 단축키 닫기" className="hps-shortcuts" {...(opener ? { opener } : {})}>
    {/* CGP-CHAT-D-030: a two-column table, keys then what they do. */}
    <table className="hps-shortcut-list">
      <thead><tr><th scope="col">키</th><th scope="col">하는 일</th></tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.id} className="hps-shortcut-row" data-shortcut={row.id}>
          <th scope="row" className="hps-shortcut-keys">{row.keys.map((key, index) => <span key={index}>{index > 0 && <span className="hps-shortcut-plus" aria-hidden="true"> + </span>}<kbd>{key}</kbd></span>)}</th>
          <td>{row.label}{row.note && <small>{row.note}</small>}</td>
        </tr>)}
      </tbody>
    </table>
  </ChatPreferences>;
}

/** `?` outside a text field opens the sheet (CGP-CHAT-R-030). `enabled` false detaches the key. */
export function useShortcutSheetKey(enabled: boolean, open: () => void): void {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!opensShortcutSheet(event)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
