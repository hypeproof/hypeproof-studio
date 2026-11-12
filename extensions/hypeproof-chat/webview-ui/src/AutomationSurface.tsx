import { useEffect, useRef, useState } from 'react';
import { AutomationPanel } from './AutomationPanel';
import { onHostMessage, postToHost } from './vscode';
import type { AutomationAction, AutomationView } from '../../src/automationProtocol';

/** This surface never persists recipient data in webview state or browser storage. */
export function AutomationSurface() {
  const [view, setView] = useState<AutomationView | null>(null);
  const pendingEdit = useRef<Extract<AutomationAction, { kind: 'edit' }> | null>(null);
  useEffect(() => {
    const off = onHostMessage(message => {
      if (message.type !== 'automationView') return;
      const pending = pendingEdit.current;
      if (pending && JSON.stringify([pending.recipe, pending.sheetUrl, pending.range]) === JSON.stringify([message.view.recipe, message.view.sheetUrl, message.view.range])) pendingEdit.current = null;
      const latest = pendingEdit.current;
      setView(latest ? { ...message.view, recipe: latest.recipe, sheetUrl: latest.sheetUrl, range: latest.range, preview: null, records: [] } : message.view);
    });
    postToHost({ type: 'automationAction', action: { kind: 'refresh' } });
    return off;
  }, []);
  const onAction = (action: AutomationAction) => {
    if (action.kind === 'edit') {
      pendingEdit.current = action;
      setView(previous => previous ? { ...previous, recipe: action.recipe, sheetUrl: action.sheetUrl, range: action.range, preview: null, records: [] } : previous);
    }
    postToHost({ type: 'automationAction', action });
  };
  if (!view) return <section className="automation-panel" aria-busy="true"><p role="status">수업과 자동화 연결을 확인하고 있어요…</p></section>;
  return <AutomationPanel view={view} onAction={onAction} onClose={() => postToHost({ type: 'automationClose' })} />;
}
