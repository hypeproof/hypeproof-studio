// Explicit gateway-only --import. Never set NODE_OPTIONS or preload the App.
import fs from 'node:fs';
import path from 'node:path';
import {compatibilityOutputGuard} from './output-bound.mjs';
if(process.env.HPS_SERVICE_ACCEPTANCE!=='1'||process.env.HPS_UNIFIED_LIVE!=='1'||!path.isAbsolute(process.env.HPS_NATIVE_EVIDENCE_DIR??''))throw Error('Compatibility output guard requires the explicit isolated activity configuration');
const file=path.join(process.env.HPS_NATIVE_EVIDENCE_DIR,'compatibility-output-guard.json');
if(fs.existsSync(file))throw Error('Refusing to reuse compatibility output proof; retain previous activity evidence');
const guard=compatibilityOutputGuard(globalThis.fetch.bind(globalThis),proof=>fs.writeFileSync(file,JSON.stringify(proof,null,2),{mode:0o600}));
fs.writeFileSync(file,JSON.stringify(guard.snapshot(),null,2),{flag:'wx',mode:0o600});
globalThis.fetch=guard.fetch;
