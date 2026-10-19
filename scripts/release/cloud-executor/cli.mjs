#!/usr/bin/env node
// Read-only CLI. Mutations require orchestrator-owned live callbacks, never JSON permission flags.
import fs from 'node:fs';
import {workflowApiBudget,boundApiTransport} from './workflow-api.mjs';
import {fileURLToPath} from 'node:url';
import {CloudExecutor,GitHubTransport} from './provider.mjs';
import {collectAssets,installedPlan,cacheIdentity} from './evidence.mjs';
export async function main(args, {transport = new GitHubTransport(),env=process.env,authorize}={}) {
  const [command,inputFile]=args;
  if(!inputFile||args.length!==2)throw Error('usage: cli.mjs observe|collect|installed-plan|cache-identity INPUT.json');
  const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));
  if(command==='observe'){const budget=await workflowApiBudget('observe-candidate',{identity:input,env,authorize});return new CloudExecutor({transport:boundApiTransport(transport,budget)}).observe(input);}
  if(command==='collect') {
    const downloads=Object.fromEntries(Object.entries(input.downloaded).map(([role,item])=>[role,{assetId:item.assetId,bytes:fs.readFileSync(item.path)}]));
    return collectAssets(input.observation,input.receipts,downloads);
  }
  if(command==='installed-plan')return installedPlan(input.policy,input.collection,input.pins);
  if(command==='cache-identity')return cacheIdentity(input);
  throw Error('unsupported read-only command');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)),null,2)); }
  catch { console.error('BLOCKED cloud executor: input/identity/provider validation failed; inspect sanitized orchestrator diagnostics'); process.exitCode=2; }
}
