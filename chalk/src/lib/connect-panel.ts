// Shared "Lab 로그인으로 연결" panel for the instructor pages.
//
// A page marks the spot with CONNECT_MARKER; withConnectPanel() puts the panel and
// its script there, so it runs before the page's own script. The script reads
// GET /connect/status (member, expiry and scope list, never a token) and exposes
//   window.chalkConnection = { ready, current, refresh(), disconnect(), onChange(fn) }
// Pages send no Authorization header: the server takes the issuer from the
// httpOnly session (src/lib/connect.ts).

export const CONNECT_MARKER = "<!--@chalk-connect-->";

export const CONNECT_PANEL_SCRIPT = String.raw`(()=>{
if(window.chalkConnection)return;
const listeners=new Set();let current=null;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(label,fn,cls)=>{const b=node('button',label,cls);b.type='button';b.onclick=fn;return b;};
const go=()=>{location.assign('/connect/start?next='+encodeURIComponent(location.pathname));};
function draw(){for(const box of document.querySelectorAll('[data-chalk-connect]')){box.replaceChildren();const s=current;
 if(!s){box.dataset.state='checking';box.append(node('p','강사 연결을 확인하고 있습니다…'));continue;}
 if(s.connected){box.dataset.state='connected';const until=new Date(s.expires_at);
  box.append(node('p',(s.member&&s.member.name?s.member.name+' · ':'')+'Lab 로그인으로 연결됨 · '+until.toLocaleString()+'까지'),button('다시 연결',go),button('연결 해제',disconnect,'ghost'));continue;}
 box.dataset.state=s.unavailable?'unknown':s.expired?'expired':'disconnected';
 box.append(node('p',s.expired?'강사 연결이 만료됐습니다. 다시 연결해주세요.':s.unavailable?'강사 연결 상태를 확인하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.':s.configured===false?'Lab 연결이 아직 설정되지 않았습니다. 운영진에게 알려주세요.':'Lab 멤버 로그인으로 강사 권한을 연결합니다. 강사 토큰은 입력하지 않습니다.'));
 if(s.configured!==false)box.append(button(s.expired?'다시 연결':'Lab 로그인으로 연결',go,'primary'));}}
async function read(){try{const r=await fetch('/connect/status',{cache:'no-store',credentials:'same-origin'});current=r.ok?await r.json():{connected:false,unavailable:true};}catch{current={connected:false,unavailable:true};}
 draw();for(const f of listeners){try{f(current);}catch{}}return current;}
async function disconnect(){try{await fetch('/connect/disconnect',{method:'POST',credentials:'same-origin'});}catch{}return read();}
draw();const ready=read();
window.chalkConnection={ready,get current(){return current;},refresh:read,disconnect,onChange(f){listeners.add(f);}};
})();`;

// The attribute keeps `<script>` (bare) meaning "the page's own script" for the
// page-contract tests that read it; the browser runs both the same way.
const PANEL = `<div class="chalk-connect" data-chalk-connect role="status" aria-live="polite"></div><script data-chalk-connect-panel>${CONNECT_PANEL_SCRIPT}</script>`;

export function withConnectPanel(html: string): string {
  return html.includes(CONNECT_MARKER) ? html.replace(CONNECT_MARKER, () => PANEL) : html;
}
