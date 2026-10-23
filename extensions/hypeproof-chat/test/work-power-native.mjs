// Isolated macOS OS assertion check; never opens a window or changes power settings.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { WorkPower } from '../src/workPower.ts';
const power = new WorkPower();
if (process.platform !== 'darwin') {
  console.log('NOT RUN: native pmset check requires macOS; Windows owner runs powercfg /requests');
} else {
  let release;
  try {
    release=power.acquire('coach-turn');
    const pid=power.child?.pid;
    assert.ok(pid,'native helper started');
    const assertion=()=>execFileSync('/usr/bin/pmset',['-g','assertions'],{encoding:'utf8'}).split('\n').filter(line=>line.includes(`pid ${pid}(`)).join('\n');
    let active=''; const until=Date.now()+4000;
    while(Date.now()<until && !(active=assertion())) await new Promise(r=>setTimeout(r,50));
    assert.match(active,/PreventUserIdleSystemSleep/);
    assert.doesNotMatch(active,/PreventUserIdleDisplaySleep|PreventSystemSleep/);
    release(); const stopped=Date.now();
    while(assertion() && Date.now()-stopped<5000) await new Promise(r=>setTimeout(r,50));
    assert.equal(assertion(),'','native assertion gone within five seconds');
    // A separate synthetic extension host crashes without running dispose.
    const moduleUrl=new URL('../src/workPower.ts',import.meta.url).href;
    const host=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {WorkPower} from ${JSON.stringify(moduleUrl)}; const p=new WorkPower();p.acquire('coach-turn');console.log(p.child.pid);`],{stdio:['ignore','pipe','ignore']});
    try {
      const orphanPid=await new Promise((resolve,reject)=>{host.stdout.once('data',data=>resolve(Number(String(data).trim())));host.once('error',reject);host.once('exit',()=>reject(Error('host exited before readiness')));});
      const orphan=()=>execFileSync('/usr/bin/pmset',['-g','assertions'],{encoding:'utf8'}).split('\n').filter(line=>line.includes(`pid ${orphanPid}(`)).join('\n');
      const readyUntil=Date.now()+4000;while(!orphan() && Date.now()<readyUntil)await new Promise(r=>setTimeout(r,50));
      assert.match(orphan(),/PreventUserIdleSystemSleep/,'crash control must start with a real assertion');
      host.kill('SIGKILL');const crashAt=Date.now();
      while(orphan() && Date.now()-crashAt<5000)await new Promise(r=>setTimeout(r,50));
      assert.equal(orphan(),'','host crash leaves no assertion within 5s');
    } finally { host.kill('SIGKILL'); }
    console.log('PASS: pmset system-idle only; normal release and host crash both clear within 5s');
  } finally { release?.(); power.dispose(); }
}
