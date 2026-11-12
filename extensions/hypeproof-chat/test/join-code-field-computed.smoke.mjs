// DES-SHELL-04 (CGP-SHELL-D-004; REQ-SHELL-05 / REQ-STUDIO-JOIN-LINK): the join screen a class link
// opens shows the class above an empty, focused code field; the field is a 44px learner control with
// 14px text that keeps the Korean IME out (type=password) and never blocks paste; a refused code is
// said directly under the field, in the flow, not in a toast and not at the card's end. The same
// field serves the ordinary start page (체험 and 수업 forms), so both paths are measured.
//
// Mounts the real webview bundle on the start surface in headless Chromium (CDP, no window, no
// clipboard) and measures it at 320 and 1280 px, dark and light host themes, and forced colours.
// Every geometric check is relational or token-derived (44px floor, 9px gap), never a font metric,
// so the CI runner's fonts cannot move it.
//
// What a headless run cannot show: whether the OS IME actually switches off. Chromium decides that
// from the field type (macOS: ASCII-capable input sources only, ui/base/cocoa/secure_password_input.mm;
// Windows TSF and Linux: no IME for password fields), so the field type is the contract checked here.
//   node --experimental-strip-types test/join-code-field-computed.smoke.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN join code field: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'start-assets',write:false,loader:{'.svg':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,js=app.outputFiles.find(f=>f.path.endsWith('.js')).text;

const CLASS_ID='class-2026-a';
// Synthetic, not a credential: the shape of a pasted learner code.
const CODE='SYNTHETIC-JOIN-CODE-7f3a9c';
const MISMATCH='이 참여 코드는 링크로 연 수업의 코드가 아니에요. 선생님께 받은 코드를 다시 확인해 주세요.';
const OTHER='설정을 저장하지 못했어요. 잠시 뒤 다시 골라 주세요.';
const FLOOR=44,TYPE_FLOOR=14,GAP_MAX=16;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};

const b=await launch(bin);
const ev=(expr)=>b.evaluate(expr);
const waitFor=async(expr,what)=>{for(let n=0;n<100;n++){const v=await ev(expr);if(v)return v;await new Promise(r=>setTimeout(r,20));}throw Error('timed out waiting for '+what);};
const state=(s)=>ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:Object.assign({checking:false,version:'1.0.0'},${JSON.stringify(s)})}}))`);
const click=(text)=>ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)}));if(!b)return false;b.click();return true;})()`);
// The code field and everything the clauses relate it to, in one read.
const measure=()=>ev(`(()=>{
  const r=(el)=>{if(!el)return null;const x=el.getBoundingClientRect();return {top:x.top,bottom:x.bottom,left:x.left,right:x.right,height:x.height};};
  const f=document.getElementById('course-code'),form=f&&f.closest('form'),errs=[...document.querySelectorAll('#connection-error')];
  const e=errs[0],submit=form&&form.querySelector('button[type=submit]'),help=document.getElementById('code-help'),link=document.querySelector('.studio-join-link');
  const before=(a,b)=>!!(a&&b)&&!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
  const fs=f&&getComputedStyle(f),es=e&&getComputedStyle(e);
  return {field:r(f),type:f&&f.type,value:f&&f.value,autocomplete:f&&f.getAttribute('autocomplete'),spellcheck:f&&f.spellcheck,
    invalid:f&&f.getAttribute('aria-invalid'),describedby:f&&f.getAttribute('aria-describedby'),focused:document.activeElement===f,
    fontPx:fs?parseFloat(fs.fontSize):0,errors:errs.length,error:r(e),errorText:e&&e.textContent,errorInForm:!!(e&&form&&form.contains(e)),
    errorRole:e&&e.getAttribute('role'),errorPosition:es&&es.position,errorFontPx:es?parseFloat(es.fontSize):0,
    fieldBeforeError:before(f,e),errorBeforeHelp:before(e,help),errorBeforeSubmit:before(e,submit),submit:r(submit),
    link:r(link),linkBeforeField:before(link,f),linkClass:document.querySelector('.studio-join-class strong')?.textContent??null,
    alerts:document.querySelectorAll('[role=alert]').length,page:document.documentElement.scrollWidth,
    html:document.body.innerHTML.includes(${JSON.stringify(CODE)})};})()`);

const runs=[{theme:'Dark+',width:320},{theme:'Dark+',width:1280},{theme:'Light+',width:320},{theme:'Light+',width:1280},{theme:'Dark+',width:320,forced:true}];
try{for(const run of runs){
  const label0=`${run.theme} ${run.width}px${run.forced?' forced colours':''}`;
  const dark=THEMES[run.theme].kind==='dark';
  const vars=Object.entries(THEMES[run.theme]).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await b.load(`<!doctype html><html data-surface="start" style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m)},getState(){},setState(){}});</script><script>${js}</script></body></html>`,{width:run.width,height:900,dark,forcedColors:!!run.forced});
  await state({});
  await waitFor(`!!document.querySelector('.studio-choice')`,'the start choices');

  // ── 1. The link path: class above an empty, focused field ────────────────────────────────────
  await state({joinLink:{classId:CLASS_ID,seq:1}});
  await waitFor(`!!document.getElementById('course-code')&&document.activeElement?.id==='course-code'`,'the focused code field');
  let m=await measure();let label=`${label0} link form: ${JSON.stringify(m)}`;
  ok(m.linkClass===CLASS_ID,'the class the link named is shown: '+label);
  ok(m.linkBeforeField&&m.link.bottom<=m.field.top+0.5,'the class sits above the code field: '+label);
  ok(m.value===''&&m.focused,'the code field is empty and focused: '+label);
  ok(Math.abs(m.field.height-FLOOR)<0.5,'the code field is 44px tall: '+label);
  ok(m.fontPx>=TYPE_FLOOR,'the code text is at least 14px: '+label);
  // IME: Chromium keeps the IME out of password fields (see the header); the rest stops the browser
  // from offering or correcting what the learner types.
  ok(m.type==='password'&&m.autocomplete==='off'&&m.spellcheck===false,'the field is a password field with no autocomplete or spellcheck: '+label);
  ok(m.page<=run.width+1,'no horizontal page scroll: '+label);

  // ── 2. Paste works: neither the paste nor its shortcut is cancelled, and the text reaches the form ──
  const pasteNotCancelled=await ev(`(()=>{const f=document.getElementById('course-code');const dt=new DataTransfer();dt.setData('text/plain',${JSON.stringify(CODE)});return f.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
  ok(pasteNotCancelled,'a paste into the code field is not cancelled: '+label0);
  const shortcutsNotCancelled=await ev(`['ctrlKey','metaKey'].every(k=>document.getElementById('course-code').dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',[k]:true,bubbles:true,cancelable:true})))`);
  ok(shortcutsNotCancelled,'Ctrl+V and Cmd+V reach the field: '+label0);
  // The browser's own insertion (what a paste does after the event): trusted input on the focused field.
  await b.send('Input.insertText',{text:CODE});
  await waitFor(`document.getElementById('course-code').value===${JSON.stringify(CODE)}`,'the pasted code in the field');
  ok(await ev(`!document.querySelector('form button[type=submit]').disabled`),'a pasted code can be submitted: '+label0);
  await ev(`document.querySelector('form button[type=submit]').click()`);
  const sent=await ev(`window.sent.filter(m=>m.type==='connectCourse')`);
  ok(sent.length===1&&sent[0].token===CODE&&sent[0].joinClass===CLASS_ID,'the pasted code is what is submitted, from the link form: '+label0+' '+JSON.stringify(sent.map(s=>Object.keys(s))));

  // ── 3. A refused code is said under the field ─────────────────────────────────────────────────
  await state({joinLink:{classId:CLASS_ID,seq:1},error:MISMATCH,errorAt:'code'});
  await waitFor(`!!document.getElementById('connection-error')&&!document.getElementById('course-code').disabled`,'the refusal');
  m=await measure();label=`${label0} refused: ${JSON.stringify(m)}`;
  ok(m.errors===1&&m.alerts===1&&m.errorRole==='alert','one error line, announced once: '+label);
  ok(m.errorText.startsWith(MISMATCH),'it says why the code was refused: '+label);
  ok(m.errorInForm&&m.fieldBeforeError&&m.errorBeforeHelp&&m.errorBeforeSubmit,'it follows the field directly, before the help line and the button: '+label);
  ok(m.error.top>=m.field.bottom-0.5&&m.error.top-m.field.bottom<=GAP_MAX&&m.error.bottom<=m.submit.top+0.5,'it is drawn directly under the field: '+label);
  ok(m.errorPosition==='static','it is in the flow, not a floating toast: '+label);
  ok(m.errorFontPx>=TYPE_FLOOR,'its text is at least 14px: '+label);
  ok(m.invalid==='true'&&/connection-error/.test(m.describedby),'the field is marked invalid and described by the error: '+label);
  ok(m.value===''&&!m.html,'the code is neither kept in the field nor echoed anywhere in the page: '+label);
  ok(Math.abs(m.field.height-FLOOR)<0.5,'the field keeps its 44px with an error: '+label);
  ok(m.page<=run.width+1,'no horizontal page scroll with an error: '+label);

  // Negative control: an error that is not a code refusal stays in the card's error area.
  await state({joinLink:{classId:CLASS_ID,seq:1},error:OTHER});
  await waitFor(`document.getElementById('connection-error')?.textContent.startsWith(${JSON.stringify(OTHER)})`,'the other error');
  m=await measure();label=`${label0} other error: ${JSON.stringify(m)}`;
  ok(m.errors===1&&!m.errorInForm&&m.invalid===null,'another error is not drawn under the field and does not mark it invalid: '+label);

  // ── 4. The ordinary start page uses the same field ───────────────────────────────────────────
  ok(await click('시작 방법 다시 선택'),'back to the choices: '+label0);
  await state({});
  ok(await click('AI 체험하기'),'the trial form opens: '+label0);
  await waitFor(`document.activeElement?.id==='course-code'`,'the trial code field');
  m=await measure();label=`${label0} trial form: ${JSON.stringify(m)}`;
  ok(m.focused&&m.value===''&&m.type==='password'&&Math.abs(m.field.height-FLOOR)<0.5&&m.fontPx>=TYPE_FLOOR&&m.link===null,'the trial form has the same empty, focused, 44px password field and no class line: '+label);
  await state({error:'인증에 실패했습니다. 참여 코드를 다시 확인하세요.',errorAt:'code'});
  await waitFor(`!!document.getElementById('connection-error')`,'the trial refusal');
  m=await measure();label=`${label0} trial refused: ${JSON.stringify(m)}`;
  ok(m.errors===1&&m.errorInForm&&m.fieldBeforeError&&m.errorBeforeSubmit&&m.error.top>=m.field.bottom-0.5&&m.error.top-m.field.bottom<=GAP_MAX,'a refused trial code is said under the field too: '+label);
  // Leaving the form keeps the message on screen, in the card's error area.
  ok(await click('시작 방법 다시 선택'),'back to the choices again: '+label0);
  await waitFor(`!document.getElementById('course-code')`,'the choices');
  m=await measure();label=`${label0} choices after a refusal: ${JSON.stringify(m)}`;
  ok(m.errors===1&&m.alerts===1,'the refusal is still shown once after leaving the form: '+label);
}
console.log(`PASS join code field: ${checks} checks; class above an empty focused 44px password field, paste, refusal under the field (320/1280 px, dark/light, forced colours)`);
}finally{await b.close();}
