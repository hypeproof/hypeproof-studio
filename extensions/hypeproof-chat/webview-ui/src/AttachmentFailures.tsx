import { useEffect, useRef, useState } from 'react';
import { attachmentDisplayName, attachmentReadFailure, type AttachmentFailure } from '../../src/attachmentFailure';
import { ChatIcon, type IconKind } from './ChatDetails';
import { onHostMessage, postToHost } from './vscode';


/** Classify only an existing diagnosis; never infer encryption or a new failure from a filename. */
export function attachmentFailureLabel(reason: string): {label:string; icon:IconKind} {
  if (/빈 파일/.test(reason)) return {label:'빈 파일',icon:'file'};
  if (/읽을 글자/.test(reason)) return {label:'글자 없음',icon:'file'};
  if (/너무 커|크기|MB까지|KB까지/.test(reason)) return {label:'크기 초과',icon:'ruler'};
  if (/글자가 너무 많/.test(reason)) return {label:'글자 수 초과',icon:'ruler'};
  if (/시간이 너무|응답이 늦/.test(reason)) return {label:'시간 초과',icon:'clock'};
  if (/권한/.test(reason)) return {label:'권한 없음',icon:'lock'};
  if (/지원하지 않는|글자로 된 파일/.test(reason)) return {label:'지원하지 않는 형식',icon:'file'};
  if (/다시 골라|다시 선택/.test(reason)) return {label:'다시 선택 필요',icon:'folder'};
  return {label:'첨부 실패',icon:'alert'};
}
export function AttachmentFailureBadge({reason}:{reason:string}) {
  const cause=attachmentFailureLabel(reason);
  return <span className="hps-attachment-failure-cause" data-testid="attachment-failure-cause"><ChatIcon kind={cause.icon} size={16}/><span>{cause.label}</span></span>;
}
/** One persistent polite region below the composer; chips retain the full reason for every item. */
export function AttachmentFailureNotice({items,fallback}:{items:AttachmentFailure[];fallback?:string|null}) {
  const item=items.at(-1);
  const message=item ? `${attachmentDisplayName(item.name)}: ${item.reason}` : fallback ?? '';
  return <p className="hps-attachment-error-summary" role="status" aria-live="polite" aria-atomic="true" data-testid="attachment-error-summary">{message && <span data-testid={!item?'file-attach-error':undefined}>{message}</span>}</p>;
}

export function AttachmentFailures({ items, retry, remove }: {
  items: (AttachmentFailure & { busy?: boolean; repick?:boolean })[]; retry: (id: string) => void; remove: (id: string) => void;
}) {
  // No failures, no markup: the footer stays byte-identical to main's (orchestrator-panel lock).
  if (items.length === 0) return null;
  return <div className="hps-attachment-failures" aria-label="다시 확인할 첨부 파일">
    {items.map(item => <div className="hps-attachment-failure" key={item.id} data-testid="attachment-failure">
      <strong>{attachmentDisplayName(item.name)}</strong><AttachmentFailureBadge reason={item.reason}/><p>{item.reason}</p>
      {!item.final && <button type="button" disabled={item.busy} onClick={() => retry(item.id)}>{item.busy ? '다시 읽는 중…' : item.repick ? '이 파일 다시 선택' : '이 파일만 다시 시도'}</button>}
      <button type="button" onClick={() => remove(item.id)} aria-label={`${attachmentDisplayName(item.name)} 빼기`}>빼기</button>
    </div>)}
  </div>;
}
export function useAttachmentFailures(scope: string) {
  const storageKey = `hps.attachment-failures.${scope}`;
  const [items, setItems] = useState<(AttachmentFailure & { busy?: boolean; repick?:boolean })[]>(() => {
    try { const value=JSON.parse(sessionStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? value.slice(0,10).filter(v=>v && typeof v.id==='string' && v.id.length<=128 && typeof v.name==='string' && typeof v.reason==='string').map(v=>({id:v.id,name:attachmentDisplayName(v.name),reason:v.reason.slice(0,500),repick:true})) : []; } catch { return []; }
  });
  const persistedScope=useRef(scope);
  useEffect(()=>{ if(persistedScope.current!==scope)return; try { if (items.length) sessionStorage.setItem(storageKey,JSON.stringify(items.map(({id,name,reason})=>({id,name,reason})))); else sessionStorage.removeItem(storageKey); } catch { /* metadata retention unavailable */ } },[storageKey,items]);
  const retries = useRef(new Map<string, () => Promise<void>>());
  const busy = useRef(new Set<string>());
  const versions = useRef(new Map<string, number>());
  const alive = useRef(true);
  const current = useRef(scope); current.current = scope;
  const add = (failure: AttachmentFailure, retry?: () => Promise<void>) => {
    if (retry) retries.current.set(failure.id, retry);
    busy.current.delete(failure.id);
    setItems(old => [...old.filter(item => item.id !== failure.id), { ...failure, name: attachmentDisplayName(failure.name), ...(old.find(item=>item.id===failure.id)?.repick ? {repick:true} : {}) }].slice(-10));
  };
  const resolve = (id: string) => { busy.current.delete(id); retries.current.delete(id); setItems(old => old.filter(item => item.id !== id)); };
  useEffect(() => { alive.current = true; if(persistedScope.current!==scope){persistedScope.current=scope;setItems([]);} retries.current.clear(); busy.current.clear(); return () => { alive.current = false; }; }, [scope]);
  useEffect(() => onHostMessage(message => {
    if (message.type === 'attachmentFailure') add(message.failure);
    if (message.type === 'attachmentFailureResolved') resolve(message.id);
  }), []);
  const retry = (id: string) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setItems(old => old.map(item => item.id === id ? { ...item, busy: true } : item));
    const run = retries.current.get(id);
    if (run) void run(); else if(items.find(item=>item.id===id)?.repick) postToHost({type:'repickAttachment',id,name:items.find(item=>item.id===id)!.name}); else postToHost({ type: 'retryAttachment', id });
  };
  const remove = (id: string) => { versions.current.set(id, (versions.current.get(id) ?? 0) + 1); resolve(id); postToHost({ type: 'discardAttachmentFailure', id }); };
  const attempt = async <T,>(id: string, name: string, read: () => Promise<T>, success: (value: T) => void): Promise<void> => {
    const started = current.current;
    const version = versions.current.get(id) ?? 0;
    const valid = () => alive.current && current.current === started && (versions.current.get(id) ?? 0) === version;
    const run = async () => {
      try { const value = await read(); if (!valid()) return; success(value); resolve(id); }
      catch (error) { if (valid()) add({ id, name, reason: attachmentReadFailure(error) }, run); }
    };
    await run();
  };
  return { items, add, resolve, retry, remove, attempt };
}
