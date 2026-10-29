import assert from 'node:assert/strict';
export const PHASES=['seed','erase','absence'];
export const TEXT='한글 초안 · authenticated cold reopen';
export function fixtureOrigin(value){const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>0&&u.origin===value,'fixture_origin');return u.origin;}
export function accountId(value){assert(typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),'fixture_account');return value;}
// The runner explicitly arms each synthetic approval. No public approval route or credential bootstrap.
export class ApprovalSequence {
 index=-1; active=null;
 arm(phase){assert(PHASES[this.index+1]===phase&&(!this.active||this.active.me>=2),'fixture_phase');this.index++;this.active={phase,challenge:null,pending:false,approved:false,consumed:false,me:0};}
 started(value){const a=this.active;assert(a&&!a.challenge&&typeof value.user_code==='string'&&/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(value.user_code),'fixture_challenge');a.challenge=value.user_code;}
 pending(){const a=this.active;assert(a?.challenge&&!a.approved&&!a.consumed,'fixture_pending');a.pending=true;}
 approval(){const a=this.active;assert(a?.pending&&!a.approved,'fixture_approval');a.approved=true;return a.challenge;}
 consumed(){const a=this.active;assert(a?.approved&&!a.consumed,'fixture_consumed');a.consumed=true;}
 me(){const a=this.active;assert(a?.consumed,'fixture_me');assert(++a.me<=2,'fixture_me_bound');}
 complete(){assert(this.index===2&&this.active?.me===2,'fixture_incomplete');}
}
export function publicRoute(method,path){return method==='POST'&&['/v1/auth/device/start','/v1/auth/device/poll','/v1/auth/logout'].includes(path)||method==='GET'&&path==='/v1/me';}

export function recordDenial(rows,value){assert(Array.isArray(rows)&&rows.length<40,'fixture_denial_bound');rows.push(value);}
