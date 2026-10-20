import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints:[fileURLToPath(new URL('../src/chatPanelProvider.ts', import.meta.url))], bundle:true, platform:'node', format:'cjs', external:['vscode'], write:false, logLevel:'silent' });
const module = { exports:{} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports:module.exports, require:id=>id==='vscode'?{}:require(id), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, URL, AbortSignal, TextEncoder, TextDecoder });
const provider = Object.create(module.exports.ChatPanelProvider.prototype);
Object.assign(provider, { _instructorMode:{isInstructor:false}, resolveCoachCwd:()=>'/activity', turnRequestScope:()=> 'activity/task', taskChanging:false, connectionChanging:false });
for (const profile of [{activity_kind:'personal'}, {activity_kind:'trial'}, {pass:{}}, {activity_kind:'classroom',minor_cohort:true}, {lesson:{}}]) {
  provider.cachedProfile = profile;
  assert.equal(provider.activityTrashBinding.root,'/activity');
  assert.equal(provider.activityTrashBinding.scope,'activity/task');
}
provider.cachedProfile = null; assert.equal(provider.activityTrashBinding,undefined);
provider.cachedProfile = {activity_kind:'classroom'};
for (const instructor of [true,null]) { provider._instructorMode.isInstructor=instructor; assert.equal(provider.activityTrashBinding,undefined); }
provider._instructorMode.isInstructor=false;provider.taskChanging=true;assert.equal(provider.activityTrashBinding,undefined);
provider.taskChanging=false;provider.connectionChanging=true;assert.equal(provider.activityTrashBinding,undefined);
// Default-off for every seat (DEC-12, Confirmed by Jay: no): the shipped setting is false, machine-scoped.
const manifest = JSON.parse(require('node:fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const setting = manifest.contributes.configuration.properties['hypeproofChat.activityTrashEnabled'];
assert.equal(setting.default, false);
assert.equal(setting.scope, 'machine');
console.log('activity trash seats: known learner seats eligible for opt-in; unknown/instructor/transition denied PASS');
