/** Shared, confirmed clipboard feedback. No credentials are captured in messages or logs. */
export const COPY_FEEDBACK_SCRIPT = String.raw`(()=>{
  const attempts=new WeakMap();
  window.chalkClearCopyFeedback=button=>{const state=attempts.get(button);if(state){state.note.textContent='';state.note.setAttribute('role','status');attempts.set(button,{note:state.note});}};
  window.chalkCopyFeedback=async(button,read,note,success='복사했습니다.',failure='복사하지 못했습니다. 내용을 선택해 직접 복사해 주세요.')=>{
    const previous=attempts.get(button);
    const state={note:note??previous?.note};
    if(!state.note){state.note=document.createElement('p');state.note.className='chalk-copy-feedback';state.note.setAttribute('role','status');button.after(state.note);}
    attempts.set(button,state);state.note.textContent='';state.note.setAttribute('role','status');
    let text;
    try{text=read();if(typeof text!=='string'||!text)throw Error('empty');await navigator.clipboard.writeText(text);}
    catch{
      if(attempts.get(button)!==state||!button.isConnected)return false;
      try{if(text!==undefined&&read()!==text)return false;}catch{return false;}
      state.note.setAttribute('role','alert');state.note.textContent=failure;
      return false;
    }
    if(attempts.get(button)!==state||!button.isConnected)return false;
    try{if(read()!==text)return false;}catch{return false;}
    state.note.setAttribute('role','status');state.note.textContent=success;
    // Persistent until the next action or scope replacement; no failure or success timeout.
    return true;
  };
})();`;
export function withCopyFeedback(html: string): string {
  const entry=/<head\b[^>]*>/i.test(html)?/<head\b[^>]*>/i:/<html\b[^>]*>/i;
  if (!entry.test(html)) throw new Error('Chalk page is missing its document root');
  return html.replace(entry, head => `${head}<script data-copy-feedback>${COPY_FEEDBACK_SCRIPT}</script>`);
}
