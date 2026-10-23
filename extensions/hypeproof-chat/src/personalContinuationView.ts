/** The explicit, text-only personal-client review surface. No workspace access. */
export function personalContinuationHtml(nonce: string, initial: { projectLabel: string; draft: string; historyCount: number; direct?: boolean }): string {
  const data = JSON.stringify(initial).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:14px/1.65 var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0}main{max-width:780px;margin:32px auto;padding:0 24px 40px}h1{font-size:24px}h2{font-size:17px;margin-top:28px}p{margin:8px 0}.muted{color:var(--vscode-descriptionForeground)}label{display:block;margin:16px 0 6px}textarea{box-sizing:border-box;width:100%;min-height:104px;padding:12px;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}button{min-height:44px;padding:8px 16px;border:1px solid var(--vscode-button-border,transparent);border-radius:6px;font:inherit;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.check{display:flex;align-items:center;gap:10px;min-height:44px}.check input{width:18px;height:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid var(--vscode-panel-border);font:inherit}#status{min-height:24px}#account{white-space:pre-wrap}section[hidden],button[hidden]{display:none}code{user-select:all}
</style></head><body><main>
<p class="muted" id="project"></p><h1>개인 Claude Code로 이어하기</h1>
<p>만든 파일과 원래 대화, 작성 중인 내용은 그대로 남아요. ${initial.direct ? '개발 실험 모드에서 텍스트 답변을 받아 같은 작업에 저장해요.' : '검토한 내용을 복사해 공식 Claude Code에서 이어가고, 답변을 이 작업에 다시 가져올 수 있어요.'}</p>
<p class="muted">파일을 자동으로 읽거나 고치지 않아요. 보낼 자료가 있으면 아래에 직접 넣어 주세요.</p>
<p id="status" role="status" aria-live="polite">${initial.direct ? 'Claude Code 설치와 연결한 계정을 확인하고 있어요.' : 'Studio는 AI를 자동 호출하지 않아요. 터미널에서 공식 Claude Code 명령 claude를 직접 실행해 주세요.'}</p>
<p id="account"></p><p id="recovery" hidden>공식 Claude Code에서 설치·로그인·사용 한도를 확인한 뒤 다시 확인해 주세요. 터미널 명령: <code>claude</code>. Studio는 로그인 정보나 비밀번호를 받지 않아요.</p>
<div class="actions"><button id="inspect" ${initial.direct ? '' : 'hidden'}>연결 다시 확인</button><button id="close">AI 없이 작업으로 돌아가기</button></div>
<section id="editor"><h2>보낼 내용 고르기</h2>
<label for="draft">이어서 하고 싶은 요청</label><textarea id="draft" maxlength="24000"></textarea>
<label for="material">함께 보낼 자료 (선택)</label><textarea id="material" maxlength="24000" placeholder="보내도 되는 문장만 넣어 주세요."></textarea>
<label class="check"><input type="checkbox" id="history"><span id="historyLabel"></span></label>
<button id="review" disabled>전송 내용 검토</button></section>
<section id="reviewPane" hidden><h2>${initial.direct ? '이 내용이 전달돼요' : '이 내용을 복사해요'}</h2><p>${initial.direct ? '수신자: Anthropic · 개인 Claude Code 계정. Studio 이용권으로 자동 전환하지 않아요.' : '복사 대상: 이 컴퓨터의 클립보드. 실제 전송할 계정과 과금은 공식 Claude Code에서 확인한 뒤 보내 주세요.'}</p>
<pre id="payload" aria-label="전송할 전체 내용"></pre>
<label class="check"><input id="consent" type="checkbox"><span>${initial.direct ? '위 내용과 계정·과금 안내를 확인했고, 이 내용을 보내는 데 동의해요.' : '위 내용을 확인했고, 공식 Claude Code에 직접 전달할 수 있도록 클립보드에 복사할게요.'}</span></label>
<div class="actions"><button id="send" class="primary" disabled>${initial.direct ? '확인한 내용 보내기' : '확인한 내용 복사하기'}</button><button id="cancel">취소</button></div></section>
<section id="manualPane" hidden><h2>답변 가져오기 (선택)</h2><p>공식 Claude Code의 답변을 직접 붙여 넣고 확인해 주세요. 저장할 때 이 작업의 대화에 추가돼요.</p><label for="manualAnswer">가져온 답변</label><textarea id="manualAnswer" maxlength="24000"></textarea><button id="saveManual">이 답변을 작업에 저장</button></section>
<section id="answerPane" hidden><h2>Claude Code 답변</h2><pre id="answer"></pre><p class="muted">같은 작업의 대화에도 저장했어요. 내용과 근거를 직접 확인해 주세요.</p></section>
</main><script nonce="${nonce}">
const api=acquireVsCodeApi(), initial=${data}, nonce=${JSON.stringify(nonce)};
const el=id=>document.getElementById(id);let digest=null,ready=false,busy=false;
const post=(type,extra={})=>api.postMessage({type,nonce,...extra});
el('project').textContent=initial.projectLabel;el('draft').value=initial.draft;
el('historyLabel').textContent='현재 작업의 이전 텍스트 대화 '+initial.historyCount+'개 포함하기 (선택)';
function invalidate(){digest=null;el('consent').checked=false;el('send').disabled=true;el('reviewPane').hidden=true;el('manualPane').hidden=true;post('edit');}
function controls(value){busy=value;for(const id of ['draft','material','history','review','inspect'])el(id).disabled=value||(!ready&&id==='review');el('send').disabled=value||!digest||!el('consent').checked;}
for(const id of ['draft','material','history'])el(id).addEventListener('input',invalidate);
el('inspect').onclick=()=>{invalidate();post('inspect');};el('close').onclick=()=>post('close');
el('review').onclick=()=>{invalidate();post('review',{draft:el('draft').value,material:el('material').value,history:el('history').checked});};
el('consent').onchange=()=>{el('send').disabled=busy||!digest||!el('consent').checked;};
el('send').onclick=()=>{if(!digest||busy||!el('consent').checked)return;controls(true);post('send',{digest,consent:true});};
el('cancel').onclick=()=>{invalidate();controls(false);post('cancel');};
el('saveManual').onclick=()=>{if(busy||!el('manualAnswer').value.trim())return;el('saveManual').disabled=true;post('saveManualReply',{text:el('manualAnswer').value,consent:true});};
window.addEventListener('message',({data:m})=>{
 if(m.type==='inspection'){ready=m.ready;controls(false);el('status').textContent=m.message;el('account').textContent=m.account||'';el('recovery').hidden=ready;}
 if(m.type==='review'){digest=m.digest;el('payload').textContent=m.payload;el('reviewPane').hidden=false;el('consent').checked=false;el('send').disabled=true;}
 if(m.type==='sending'){controls(true);el('status').textContent='Claude Code의 답변을 기다리고 있어요.';}
 if(m.type==='copied'){controls(false);digest=null;el('consent').checked=false;el('send').disabled=true;el('status').textContent=m.message;el('manualPane').hidden=false;el('manualAnswer').value='';el('saveManual').disabled=false;}
 if(m.type==='result'){controls(false);digest=null;el('consent').checked=false;el('send').disabled=true;el('saveManual').disabled=false;el('status').textContent=m.message;if(m.text){el('answer').textContent=m.text;el('answerPane').hidden=false;el('manualPane').hidden=true;}}
});post('ready');
</script></body></html>`;
}
