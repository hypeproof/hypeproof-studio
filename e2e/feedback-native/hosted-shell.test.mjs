// Command transport/selection only: no asset download, extraction, Service or desktop launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCommands,runtimeEnvironment,portableShellAsset,selectPlatformRelease} from './hosted-shell.mjs';
const digest='sha256:'+'a'.repeat(64),mac={name:'HypeProof-Studio-darwin-arm64.zip',digest},win={name:'HypeProof.Studio-win32-x64-1.116.06953.zip',digest};
const older={tag_name:'v2026.1017.0',draft:false,prerelease:false,published_at:'2026-10-16T18:24:28Z',assets:[mac,win]};
const latest={tag_name:'v2026.1020.2',draft:false,prerelease:false,published_at:'2026-10-20T07:05:37Z',assets:[mac]};
test('newest published stable is selected per platform, never a draft or an unrelated archive',()=>{
 const catalog=[{...older,tag_name:'v2026.1025.0-rc.1',draft:true,prerelease:true,published_at:null},older,latest];
 assert.equal(selectPlatformRelease(catalog,'darwin-arm64'),latest);
 assert.equal(selectPlatformRelease(catalog,'win32-x64'),older);
 assert.equal(portableShellAsset(older,'win32-x64'),win);
 assert.throws(()=>selectPlatformRelease([latest,{...older,assets:[{name:'fixture-win32-x64.zip',digest}]}],'win32-x64'),/no published stable/);
 assert.throws(()=>selectPlatformRelease([{...older,draft:true},{...older,prerelease:true}],'win32-x64'),/no published stable/);
 assert.throws(()=>selectPlatformRelease(catalog,'linux-x64'),/Unsupported/);
});
test('same-repository bounded catalog works without mirror access; only release calls receive credentials',()=>{
 const calls=[],env={PATH:'test-bin',GH_TOKEN:'synthetic-read-token',GITHUB_TOKEN:'other-secret',HPS_SERVICE_SHA:'a'.repeat(40)};
 const commands=hostedCommands('/checkout',env,(exe,argv,options)=>{calls.push({exe,argv,options});assert.equal(exe,'gh');assert.equal(options.env.GH_TOKEN,env.GH_TOKEN);assert.equal(options.env.GITHUB_TOKEN,undefined);assert(!argv.join(' ').includes('hypeproof-studio-releases'));assert.equal(options.timeout,30000);return JSON.stringify([[latest],[older]]);});
 assert.equal(commands.release('win32-x64').tag_name,older.tag_name);
 assert.deepEqual(calls[0].argv,['api','--paginate','--slurp','repos/hypeproof/hypeproof-studio/releases?per_page=100']);
});
test('explicit tag is strict and cannot silently select a previous platform release',()=>{
 const calls=[],commands=hostedCommands('/checkout',{},(_exe,argv)=>{calls.push(argv);return JSON.stringify(latest);});
 assert.deepEqual(commands.release('darwin-arm64',latest.tag_name),latest);
 assert.deepEqual(calls[0],['api','repos/hypeproof/hypeproof-studio/releases/tags/'+latest.tag_name]);
 assert.throws(()=>commands.release('win32-x64',latest.tag_name),/platform=win32-x64 matches=0/);
 for(const release of [{...latest,draft:true},{...latest,prerelease:true},{...latest,draft:undefined},{...latest,assets:null},{...latest,tag_name:older.tag_name}])assert.throws(()=>hostedCommands('/checkout',{},()=>JSON.stringify(release)).release('darwin-arm64',latest.tag_name),/exact published stable/);
 let failures=0;assert.throws(()=>hostedCommands('/checkout',{},()=>{failures++;throw Error('404 synthetic secret');}).release('darwin-arm64'),error=>error.message.startsWith('BLOCKED:')&&!error.message.includes('synthetic secret'));assert.equal(failures,1,'no repository/credential fallback');
 assert.throws(()=>commands.release('darwin-arm64','main'),/Invalid/);
});
test('ambiguous or unverifiable matching portable assets fail before any download',()=>{
 const duplicate={...older,assets:[win,{name:'HypeProof-Studio-win32-x64.zip',digest}]};
 assert.throws(()=>selectPlatformRelease([duplicate],'win32-x64'),/matches=2/);
 assert.throws(()=>selectPlatformRelease([{...older,assets:[{...win,digest:null}]}],'win32-x64'),/lacks digest/);
 assert.throws(()=>portableShellAsset({...older,assets:[{...win,digest:'sha256:bad'},{name:'unified-acceptance.json'}]},'win32-x64'),/Invalid official shell digest/);
 const acceptance={...older,assets:[{...win,digest:null},{name:'unified-acceptance.json'}]};
 assert.equal(portableShellAsset(acceptance,'win32-x64').name,win.name,'published acceptance hash fallback remains verified by hosted download path');
 assert.throws(()=>selectPlatformRelease([{...older,published_at:'bad'}],'win32-x64'),/publication time/);
 assert.throws(()=>hostedCommands('/checkout',{},()=>JSON.stringify([latest])).release('darwin-arm64'),/catalog pages/);
});
test('download identity and native runtime remain separate from release credentials',()=>{
 const env={GH_TOKEN:'gh-secret',GITHUB_TOKEN:'job-secret',HYPEPROOF_READ_TOKEN:'read-secret',MIRROR_RELEASE_PAT:'mirror-credential',ANTHROPIC_API_KEY:'provider-secret',OPENAI_API_KEY:'provider-secret',HPS_OWNER_SERVICE_SECRET:'owner-secret',ACTIONS_RUNTIME_TOKEN:'actions-secret',HPS_DEV_TOKEN_FILE:'/private/bootstrap',PATH:'native-bin',RUNNER_TEMP:'/temporary',HOME:'/unchanged-home',HPS_SERVICE_SOURCE:'/actual-service',HPS_SERVICE_SHA:'a'.repeat(40),GITHUB_ACTIONS:'true'};
 const calls=[],commands=hostedCommands('/checkout',env,(exe,argv,options)=>{calls.push({exe,argv,env:options.env});return JSON.stringify([[latest]]);});
 commands.release('darwin-arm64');commands.download(latest.tag_name,mac.name,'/assets');
 assert.deepEqual(calls[1].argv,['release','download',latest.tag_name,'--repo','hypeproof/hypeproof-studio','--pattern',mac.name,'--dir','/assets']);
 for(const call of calls){assert.equal(call.env.GH_TOKEN,'gh-secret');assert.equal(call.env.GITHUB_TOKEN,undefined);assert.equal(call.env.MIRROR_RELEASE_PAT,undefined);assert.equal(call.env.ANTHROPIC_API_KEY,undefined);}
 for(const [exe,argv]of [['ditto',['-xk','shell.zip','/released']],['python3',['scripts/studio-dev.py','prepare']],['node',['prepare-config.mjs']],['node',['run.mjs','--allow-foreground']]])commands.run(exe,argv);
 for(const call of calls.slice(2)){for(const value of Object.values(call.env))assert(!String(value).includes('secret')&&!String(value).includes('credential')&&!String(value).includes('bootstrap'));assert.equal(call.env.HOME,env.HOME);assert.equal(call.env.HPS_SERVICE_SOURCE,env.HPS_SERVICE_SOURCE);assert.equal(call.env.HPS_SERVICE_SHA,env.HPS_SERVICE_SHA);}
 for(const name of ['../escape.zip','C:\\secret.zip','',null])assert.throws(()=>commands.download(latest.tag_name,name,'/assets'),/Invalid/);
 assert.deepEqual(commands.runtimeEnv,runtimeEnvironment(env));assert.equal(env.GH_TOKEN,'gh-secret');
});
