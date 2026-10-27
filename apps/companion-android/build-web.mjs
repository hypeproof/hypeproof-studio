import {build} from 'esbuild';
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const csp="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><link rel="stylesheet" href="main.css"><title>HypeProof Companion DEV</title></head><body><div id="root"></div><script src="main.js"></script></body></html>';
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=async file=>digest(await readFile(file));

/** Same pipeline for focused in-memory boot verification and the explicit future APK asset build. */
export async function buildCompanionAndroidWeb({client,selection,reactDeps=process.env.COMPANION_REACT_DEPS??path.resolve(root,'../../extensions/hypeproof-chat/webview-ui/node_modules'),write=true}={}) {
 if(!client||!selection)throw Error('Explicit authorized DEV client and frozen selection source paths required');
 const reactRoot=await realpath(path.join(reactDeps,'react')),reactDomRoot=await realpath(path.join(reactDeps,'react-dom'));
 const reactVersion=JSON.parse(await readFile(path.join(reactRoot,'package.json'),'utf8')).version;
 const reactDomVersion=JSON.parse(await readFile(path.join(reactDomRoot,'package.json'),'utf8')).version;
 if(typeof reactVersion!=='string'||reactVersion!==reactDomVersion)throw Error('Android assets require one matching React/ReactDOM dependency root');
 const out=path.join(root,'app/src/main/assets/ui');
 // nodePaths alone is a fallback: ancestor node_modules can otherwise silently mix React19 JSX/hooks with DOM18.
 const result=await build({entryPoints:[path.join(root,'web/main.tsx')],outdir:out,write:false,metafile:true,bundle:true,platform:'browser',format:'iife',target:'chrome120',jsx:'automatic',minify:false,define:{'process.env.NODE_ENV':'"production"'},alias:{react:reactRoot,'react-dom':reactDomRoot},nodePaths:(process.env.COMPANION_NODE_PATHS??'').split(path.delimiter).filter(Boolean),plugins:[{name:'explicit-dev-inputs',setup(api){api.onResolve({filter:new RegExp('^@hypeproof/companion-client$')},()=>({path:client}));api.onResolve({filter:new RegExp('^@companion/selection$')},()=>({path:selection}));}}]});
 const reactInputs=[];
 for(const input of Object.keys(result.metafile.inputs)){
  const file=await realpath(path.resolve(input));
  if(file.startsWith(reactRoot+path.sep)||file.startsWith(reactDomRoot+path.sep))reactInputs.push({file,sha256:await hash(file)});
  else if(/[/\\]node_modules[/\\](react|react-dom)[/\\]/.test(file))throw Error('Unexpected second React runtime in Android bundle');
 }
 if(!reactInputs.length)throw Error('Android bundle React dependency graph is missing');
 const js=result.outputFiles.find(file=>path.basename(file.path)==='main.js')?.text;
 if(!js)throw Error('Android browser bundle missing');
 const report={client,clientEntrySha256:await hash(client),selection,selectionSha256:await hash(selection),reactRoot,reactDomRoot,reactVersion,reactDomVersion,reactInputs,jsSha256:digest(js),htmlSha256:digest(html)};
 if(write){await mkdir(out,{recursive:true});for(const file of result.outputFiles)await writeFile(file.path,file.contents);await writeFile(path.join(out,'index.html'),html);}
 return {js,html,report};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {report}=await buildCompanionAndroidWeb({client:process.env.COMPANION_CLIENT_ENTRY,selection:process.env.COMPANION_SELECTION_ENTRY});
 console.log(JSON.stringify(report,null,2));
}
