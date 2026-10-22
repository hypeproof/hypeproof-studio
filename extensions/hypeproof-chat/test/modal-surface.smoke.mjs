import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {readDesignFile} from './lib/design-token-values.mjs';
const require=createRequire(new URL('../webview-ui/package.json',import.meta.url));
const css=require('postcss').parse(readDesignFile(new URL('../webview-ui/src/modalSurface.css',import.meta.url)));
function rule(selector,media='') { let out={};css.walkRules(r=>{if(r.selectors.includes(selector) && (r.parent.type==='root'?'':r.parent.params)===media)r.walkDecls(d=>out[d.prop]=d.value);});return out; }
const card=rule('.hp-modal.hp-modal');
for(const [property,value] of Object.entries({'box-sizing':'border-box',width:'min(480px, calc(100% - 24px))','min-width':'min(320px, calc(100% - 24px))','max-width':'480px','max-height':'calc(100dvh - 24px)',padding:'20px','border-radius':'12px',overflow:'auto','overflow-wrap':'anywhere',animation:'hp-modal-enter var(--hp-dur-modal-enter) ease-out both'})) assert.equal(card[property],value,property);
assert.equal(rule('.hp-modal.hp-modal::backdrop').background,'rgb(0 0 0 / 40%)');
assert.equal(rule('.hp-modal-backdrop.hp-modal-backdrop').background,'rgb(0 0 0 / 40%)');
for(const theme of ['vscode-light','vscode-high-contrast-light']) for(const target of ['.hp-modal::backdrop','.hp-modal-backdrop']) assert.equal(rule(`body.${theme} ${target}`).background,'rgb(0 0 0 / 30%)');
assert.equal(rule('.hp-modal[data-closing]').animation,'hp-modal-exit var(--hp-dur-modal-exit) ease-in both');
for(const [property,value] of Object.entries({position:'fixed',inset:'auto 0 0',width:'100%','min-width':'0','max-width':'none','max-height':'90dvh',margin:'0','border-radius':'12px 12px 0 0'})) assert.equal(rule('.hp-modal.hp-modal','(max-width: 390px)')[property],value,`sheet ${property}`);
assert.equal(rule('.hp-modal-backdrop.hp-modal-backdrop','(max-width: 390px)').padding,'0');
for(const selector of ['.hp-modal.hp-modal','.hp-modal[data-closing]']) assert.equal(rule(selector,'(prefers-reduced-motion: reduce)').animation,'none');
assert.equal(rule('.hps-preferences.hp-modal > header').padding,'0 0 20px');
assert.equal(rule('.hps-preferences.hp-modal .hps-preferences-body').padding,'20px 0 0');
for(const [name,values] of [['hp-modal-enter',['0','1']],['hp-modal-exit',['1','0']]]) {
 const frames=[];css.walkAtRules('keyframes',r=>{if(r.params===name)r.walkDecls('opacity',d=>frames.push(d.value));});assert.deepEqual(frames,values,name);
}
const source=readFileSync(new URL('../webview-ui/src/modalSurface.css',import.meta.url),'utf8');
const chalk=readFileSync(new URL('../../../chalk/src/ui/sharing.html',import.meta.url),'utf8');
assert.equal(chalk.split('/* modal-surface:start */\n')[1]?.split('/* modal-surface:end */')[0],source,'Chalk uses the same rules');
console.log('PASS modal surface: geometry, dim in four theme kinds, enter/exit, sheet, reduced motion, Chalk parity');
