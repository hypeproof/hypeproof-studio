import { useEffect, useRef, useState } from 'react';
import type { AttachmentFailure } from '../../src/attachmentFailure';
import { onHostMessage, postToHost } from './vscode';
export interface PreparationFile { id: string; stageId?: string; dataUrl?: string }
/** A prepare request never calls the model or clears composer state. */
export function useAttachmentSendPreparation(scope: string, sketch = false) {
  const [failures, setFailures] = useState<(AttachmentFailure & {busy?:boolean})[]>([]);
  const [busy, setBusy] = useState(false);
  const inputs = useRef(new Map<string,PreparationFile>());
  const pending = useRef<{id:string; resolve:(ok:boolean)=>void; timer:ReturnType<typeof setTimeout>} | null>(null);
  const current = useRef(scope); current.current=scope;
  useEffect(() => {
    setFailures([]); setBusy(false); inputs.current.clear();
    return () => { const p=pending.current; if(p) {clearTimeout(p.timer);p.resolve(false);} pending.current=null; };
  },[scope]);
  useEffect(() => onHostMessage(msg => {
    if(msg.type!=='attachmentsPrepared' || pending.current?.id!==msg.requestId) return;
    const p=pending.current; pending.current=null;clearTimeout(p.timer);setBusy(false);
    setFailures(old => [...old.filter(f=>!inputs.current.has(f.id)),...msg.failures]);
    p.resolve(msg.failures.length===0);
  }),[]);
  const request = (files:PreparationFile[]):Promise<boolean> => {
    if(pending.current) return Promise.resolve(false);
    inputs.current=new Map(files.map(f=>[f.id,f]));
    if(!files.length) return Promise.resolve(true);
    const id=crypto.randomUUID();setBusy(true);
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{if(pending.current?.id!==id)return;pending.current=null;setBusy(false);setFailures(files.map(f=>({id:f.id,name:'첨부 파일',reason:'파일 저장 응답이 늦어요. 이 파일만 다시 시도해 주세요.'})));resolve(false);},15000);
      pending.current={id,resolve,timer};postToHost({type:'prepareAttachments',requestId:id,files,...(sketch?{sketch:true}:{})});
    });
  };
  const allInputs=useRef(new Map<string,PreparationFile>());
  const prepare=(files:PreparationFile[])=>{if(pending.current)return Promise.resolve(false);allInputs.current=new Map(files.map(f=>[f.id,f]));return request(files);};
  const retry=(id:string)=>{const f=allInputs.current.get(id);if(f)void request([f]);};
  const remove=(id:string)=>{const p=pending.current;if(p){clearTimeout(p.timer);pending.current=null;p.resolve(false);setBusy(false);} const file=allInputs.current.get(id);allInputs.current.delete(id);setFailures(old=>old.filter(f=>f.id!==id));return file;};
  return {prepare,retry,remove,failures,busy};
}
