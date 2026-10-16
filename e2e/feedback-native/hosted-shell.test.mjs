// Command transport only: no asset download, extraction, Service or desktop launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCommands,runtimeEnvironment} from './hosted-shell.mjs';
const stable={tag_name:'v0.1.56',draft:false,prerelease:false,assets:[{name:'HypeProof-Studio-darwin-arm64.zip',digest:'sha256:'+'a'.repeat(64)}]};
test('same-repository official shell works when the token cannot access the private mirror',()=>{
 const calls=[],env={PATH:'test-bin',GH_TOKEN:'synthetic-read-token',HPS_SERVICE_SHA:'a'.repeat(40)};
 const commands=hostedCommands('/checkout',env,(exe,argv,options)=>{calls.push({exe,argv,options});assert.equal(exe,'gh');assert.equal(options.env.GH_TOKEN,env.GH_TOKEN);assert(!argv.join(' ').includes('hypeproof-studio-releases'),'mirror requires separate access and must not be tried');return JSON.stringify(stable);});
 assert.deepEqual(commands.release(),stable);commands.download(stable.tag_name,stable.assets[0].name,'/assets');
 assert.deepEqual(calls.map(c=>c.argv),[['api','repos/hypeproof/hypeproof-studio/releases/latest'],['release','download','v0.1.56','--repo','hypeproof/hypeproof-studio','--pattern','HypeProof-Studio-darwin-arm64.zip','--dir','/assets']]);
});
test('pinned tag uses the same official source; draft, prerelease, malformed metadata and inaccessible source fail without fallback',()=>{
 const calls=[];const execute=(_exe,argv)=>{calls.push(argv);return JSON.stringify(stable);};
 assert.equal(hostedCommands('/checkout',{},execute).release('v0.1.56').tag_name,'v0.1.56');assert.equal(calls[0][1],'repos/hypeproof/hypeproof-studio/releases/tags/v0.1.56');
 for(const release of [{...stable,draft:true},{...stable,prerelease:true},{...stable,draft:undefined},{...stable,assets:null},{...stable,tag_name:'../other'}])assert.throws(()=>hostedCommands('/checkout',{},()=>JSON.stringify(release)).release(),/published stable/);
 let failures=0;assert.throws(()=>hostedCommands('/checkout',{},()=>{failures++;throw Error('404 synthetic secret');}).release(),error=>error.message.startsWith('BLOCKED:')&&!error.message.includes('synthetic secret'));assert.equal(failures,1,'no fallback to another repository/credential');
 assert.throws(()=>hostedCommands('/checkout',{},()=>assert.fail('invalid input executed gh')).release('main'),/Invalid/);
 for(const name of ['../escape.zip','C:\\secret.zip','',null])assert.throws(()=>hostedCommands('/checkout',{},()=>assert.fail('invalid asset executed gh')).download('v0.1.56',name,'/assets'),/Invalid/);
});
test('only release metadata/download receive credentials; build/config/native chain and Service environment do not',()=>{
 const env={GH_TOKEN:'gh-secret',GITHUB_TOKEN:'job-secret',HYPEPROOF_READ_TOKEN:'read-secret',MIRROR_RELEASE_PAT:'mirror-credential',ANTHROPIC_API_KEY:'provider-secret',OPENAI_API_KEY:'provider-secret',HPS_OWNER_SERVICE_SECRET:'owner-secret',ACTIONS_RUNTIME_TOKEN:'actions-secret',HPS_DEV_TOKEN_FILE:'/private/bootstrap',PATH:'native-bin',RUNNER_TEMP:'/temporary',HOME:'/unchanged-home',HPS_SERVICE_SOURCE:'/actual-service',HPS_SERVICE_SHA:'a'.repeat(40),GITHUB_ACTIONS:'true'};
 const calls=[],commands=hostedCommands('/checkout',env,(exe,argv,options)=>{calls.push({exe,argv,env:options.env});return JSON.stringify(stable);});
 commands.release();commands.download('v0.1.56','shell.zip','/assets');
 for(const call of calls){assert.equal(call.env.GH_TOKEN,'gh-secret');assert.equal(call.env.GITHUB_TOKEN,undefined);assert.equal(call.env.MIRROR_RELEASE_PAT,undefined);assert.equal(call.env.ANTHROPIC_API_KEY,undefined);}
 for(const [exe,argv]of [['ditto',['-xk','shell.zip','/released']],['python3',['scripts/studio-dev.py','prepare']],['node',['prepare-config.mjs']],['node',['run.mjs','--allow-foreground']]])commands.run(exe,argv);
 for(const call of calls.slice(2)){for(const value of Object.values(call.env))assert(!String(value).includes('secret')&&!String(value).includes('credential')&&!String(value).includes('bootstrap'));assert.equal(call.env.HOME,env.HOME);assert.equal(call.env.HPS_SERVICE_SOURCE,env.HPS_SERVICE_SOURCE);assert.equal(call.env.HPS_SERVICE_SHA,env.HPS_SERVICE_SHA);}
 assert.deepEqual(commands.runtimeEnv,runtimeEnvironment(env),'actual Service spawn consumes this same scrubbed environment');
 assert.equal(env.GH_TOKEN,'gh-secret','caller environment is never mutated');
});
