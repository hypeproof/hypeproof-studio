// CGP-KNOW-D-017 (DES-KNOW-30) — the version side panel's page, checked where a learner meets it:
// the stylesheet and the webview script of the real generated HTML.
//   * CSS rules are read as rules (selector, declarations, media context), the ui-polish-1 pattern:
//     44px targets, 14px text, a 2px focus ring, no motion under prefers-reduced-motion.
//   * The webview script runs in a vm against a small fake DOM built from that same HTML: one action
//     at a time, controls disabled while pending, the compare toggle, the error that stays until it
//     is dismissed, and focus returning to 새로 고침.
// Every check is a function over the generated HTML, and each one also runs against a mutated copy
// that must fail (negative controls), so a regression of any clause turns this test red.
//   node --experimental-strip-types test/artifact-history-panel-client.smoke.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const entry = process.env.ARTIFACT_PANEL_SOURCE ?? path.join(dir, 'src/artifactHistoryPanel.ts');
const built = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
const mod = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => (id === 'vscode' ? {} : require(id)), process, Buffer, console, TextDecoder, setTimeout, clearTimeout });
const { artifactHistoryHtml } = mod.exports;

const point = (id, turnId, createdAt) => ({ id, turnId, createdAt, files: [{ rel: 'a.html', sha256: id.repeat(8), size: 1 }] });
const POINTS = [point('c', 'artifact-unknown', 3000), point('b', 'artifact-learner', 2000), point('a', 'artifact-ai', 1000)];
const REAL = artifactHistoryHtml(POINTS, 'c', 'a.html', 'nonce1', '');
const section = (html, tag) => html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';

// ─── CSS ────────────────────────────────────────────────────────────────────────────────────────
function splitTop(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return [...out, cur].map(x => x.trim()).filter(Boolean);
}
function rules(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf('{', i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, '').replace(/\s+/g, ''));
      else if (!head.startsWith('@')) {
        const decls = {};
        for (const d of css.slice(open + 1, j - 1).split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: splitTop(head), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, '');
  return out;
}
const value = (html, selector, prop, media = '') => {
  let v;
  for (const r of rules(section(html, 'style'))) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const px = text => parseFloat(/(-?\d+(?:\.\d+)?)px/.exec(text ?? '')?.[1] ?? 'NaN');

const cssChecks = {
  'buttons are at least 44x44': html => {
    const bad = [];
    if (!(px(value(html, 'button', 'min-height')) >= 44)) bad.push(`button min-height ${value(html, 'button', 'min-height')}`);
    if (!(px(value(html, 'button', 'min-width')) >= 44)) bad.push(`button min-width ${value(html, 'button', 'min-width')}`);
    if (!(px(value(html, 'li', 'min-height')) >= 44)) bad.push(`row min-height ${value(html, 'li', 'min-height')}`);
    return bad;
  },
  'body text is at least 14px': html => {
    const size = px(value(html, 'body', 'font'));
    return size >= 14 ? [] : [`body font ${value(html, 'body', 'font')}`];
  },
  'keyboard focus draws a 2px ring with an offset': html => {
    const bad = [];
    if (!/^2px solid\b/.test(value(html, 'button:focus-visible', 'outline') ?? '')) bad.push(`outline ${value(html, 'button:focus-visible', 'outline')}`);
    if (!(px(value(html, 'button:focus-visible', 'outline-offset')) >= 2)) bad.push(`outline-offset ${value(html, 'button:focus-visible', 'outline-offset')}`);
    return bad;
  },
  'reduced motion removes animation and transition': html => {
    const media = '(prefers-reduced-motion:reduce)';
    const bad = [];
    if (value(html, '*', 'animation', media) !== 'none!important') bad.push(`animation ${value(html, '*', 'animation', media)}`);
    if (value(html, '*', 'transition', media) !== 'none!important') bad.push(`transition ${value(html, '*', 'transition', media)}`);
    return bad;
  },
  'forced colors keeps a visible border': html => {
    const r = rules(section(html, 'style')).find(x => x.media === '(forced-colors:active)' && x.selectors.includes('button'));
    return r?.decls['border-color'] === 'ButtonText' ? [] : ['no forced-colors border for buttons'];
  },
  'the error box only shows content a learner can dismiss': html => {
    const bad = [];
    if (value(html, '#error[hidden]', 'display') !== 'none') bad.push('hidden error box still displays');
    if (!/<button id="dismiss">오류 닫기<\/button>/.test(html)) bad.push('no 오류 닫기');
    if (/id="dismiss"[^>]*data-action/.test(html) || /data-action[^>]*id="dismiss"/.test(html)) bad.push('dismiss is in the disabled-while-pending set');
    return bad;
  },
};

// ─── Script, run against a fake DOM built from the generated HTML ───────────────────────────────
class El {
  constructor(attrs) {
    this.attrs = { ...attrs }; this.dataset = {}; this.disabled = false; this.hidden = 'hidden' in attrs; this.textContent = ''; this.listeners = {}; this.focused = 0;
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  /** What a person can do: a disabled button never fires. */
  click() { if (!this.disabled) this.listeners.click?.(); }
  /** What a script bug could do: the handler runs although the button is disabled. */
  force() { this.listeners.click?.(); }
  focus() { this.focused++; }
}
function dom(html) {
  const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].slice(1).map(m => [m[1], m[2] ?? '']));
  const buttons = [...section(html, 'body').matchAll(/<button\b([^>]*)>/g)].map(m => new El(attrsOf(`x ${m[1]}`)));
  const actions = buttons.filter(b => 'data-action' in b.attrs);
  const dismiss = buttons.find(b => b.attrs.id === 'dismiss');
  const errorTag = /<section id="error"([^>]*)>/.exec(html)?.[1] ?? '';
  const error = new El({ id: 'error', ...attrsOf(`x ${errorTag}`) });
  const errorText = new El({ id: 'error-text' });
  errorText.textContent = (/<p id="error-text">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '');
  const byId = { dismiss, error, 'error-text': errorText };
  const posted = []; let onMessage;
  const document = {
    getElementById: id => byId[id],
    querySelectorAll: sel => (sel === '[data-action]' ? actions : []),
    querySelector: sel => (sel === '[data-action=refresh]' ? actions.find(b => b.dataset.action === 'refresh') : null),
  };
  const sandbox = { document, window: { addEventListener: (t, fn) => { if (t === 'message') onMessage = fn; } }, acquireVsCodeApi: () => ({ postMessage: m => posted.push(m) }), String };
  vm.runInNewContext(section(html, 'script'), sandbox);
  const act = (action, id) => actions.find(b => b.dataset.action === action && (id === undefined || b.dataset.id === id));
  return { actions, dismiss, error, errorText, posted, act, send: data => onMessage({ data }) };
}

const clientChecks = {
  'one action at a time: controls disable while pending, a second press posts nothing': html => {
    const bad = [], d = dom(html);
    d.act('restore', 'b').click();
    if (d.posted.length !== 1) bad.push(`first press posted ${d.posted.length}`);
    if (!d.actions.every(b => b.disabled)) bad.push('controls stay enabled while pending');
    d.act('compare', 'a').force(); d.act('restore', 'a').force();
    if (d.posted.length !== 1) bad.push(`a second press reached the host (${d.posted.length} messages)`);
    d.send({ type: 'result' });
    if (d.actions.some(b => b.disabled)) bad.push('controls stay disabled after the result');
    d.act('restore', 'a').click();
    if (d.posted.length !== 2) bad.push('no new press after the result');
    return bad;
  },
  'the page sends only the action, the id and the toggle state (no paths)': html => {
    const d = dom(html); d.act('restore', 'b').click();
    return JSON.stringify(d.posted[0]) === JSON.stringify({ action: 'restore', id: 'b', close: false }) ? [] : [`posted ${JSON.stringify(d.posted[0])}`];
  },
  'compare toggles: aria-pressed follows the result and the next press asks to close': html => {
    const bad = [], d = dom(html);
    d.act('compare', 'a').click();
    if (d.posted[0]?.close !== false) bad.push(`opening posted close=${d.posted[0]?.close}`);
    d.send({ type: 'result', compared: 'a' });
    const pressed = d.actions.filter(b => b.dataset.action === 'compare').map(b => `${b.dataset.id}:${b.getAttribute('aria-pressed')}`).sort().join();
    if (pressed !== 'a:true,b:false,c:false') bad.push(`aria-pressed ${pressed}`);
    d.act('compare', 'a').click();
    if (d.posted[1]?.close !== true) bad.push(`closing posted close=${d.posted[1]?.close}`);
    d.send({ type: 'result', compared: '' });
    if (d.actions.filter(b => b.dataset.action === 'compare').some(b => b.getAttribute('aria-pressed') !== 'false')) bad.push('aria-pressed not cleared after closing');
    d.act('compare', 'b').click(); d.send({ type: 'result', compared: 'b' });
    if (d.act('compare', 'a').getAttribute('aria-pressed') !== 'false' || d.act('compare', 'b').getAttribute('aria-pressed') !== 'true') bad.push('switching the compared version leaves two pressed');
    return bad;
  },
  'a failure shows on the result and stays until dismissed': html => {
    const bad = [], d = dom(html);
    d.act('restore', 'b').click();
    d.send({ type: 'result', error: '파일이 바뀌었어요.' });
    if (d.error.hidden) bad.push('error is not shown on the result');
    if (d.errorText.textContent !== '파일이 바뀌었어요.') bad.push(`error text ${d.errorText.textContent}`);
    d.act('compare', 'a').click(); d.send({ type: 'result', compared: 'a' });
    if (d.error.hidden) bad.push('a later successful result hid the error the learner had not dismissed');
    return bad;
  },
  'dismiss hides the error, tells the host, returns focus to 새로 고침 and is never disabled': html => {
    const bad = [], d = dom(html);
    d.act('restore', 'b').click();
    d.send({ type: 'result', error: '오류' });
    d.act('restore', 'b').click();                       // pending again
    if (d.dismiss.disabled) bad.push('dismiss is disabled while pending');
    d.dismiss.click();
    if (!d.error.hidden) bad.push('dismiss did not hide the error');
    if (!d.posted.some(m => m.action === 'dismiss')) bad.push('the host was not told about the dismiss while pending');
    if (d.act('refresh').focused !== 1) bad.push(`focus returned to 새로 고침 ${d.act('refresh').focused} times`);
    d.send({ type: 'result' });
    if (!d.error.hidden) bad.push('the result brought a dismissed error back');
    return bad;
  },
};

// ─── Mutants: each edits the generated HTML and must turn exactly the named check red ──────────
const cut = (html, find, replace = '') => { assert.ok(html.includes(find), `mutant target not found: ${find.slice(0, 60)}`); return html.replace(find, replace); };
const mutants = [
  ['buttons 24px', 'buttons are at least 44x44', h => cut(h, 'min-height:44px;min-width:44px', 'min-height:24px;min-width:24px')],
  ['row 20px', 'buttons are at least 44x44', h => cut(h, 'li{min-height:44px', 'li{min-height:20px')],
  ['body 10px', 'body text is at least 14px', h => cut(h, 'font:14px/1.6', 'font:10px/1.6')],
  ['focus ring removed', 'keyboard focus draws a 2px ring with an offset', h => cut(h, /button:focus-visible\{[^}]*\}/.exec(h)[0])],
  ['focus offset 0', 'keyboard focus draws a 2px ring with an offset', h => cut(h, 'outline-offset:2px', 'outline-offset:0')],
  ['reduced motion removed', 'reduced motion removes animation and transition', h => cut(h, /@media\(prefers-reduced-motion:reduce\)\{[^}]*\}\}/.exec(h)[0])],
  ['forced colors removed', 'forced colors keeps a visible border', h => cut(h, /@media\(forced-colors:active\)\{[^}]*\}\}/.exec(h)[0])],
  ['dismiss joins the disabled set', 'the error box only shows content a learner can dismiss', h => cut(h, '<button id="dismiss">', '<button id="dismiss" data-action="dismiss">')],
  ['no disable while pending', 'one action at a time: controls disable while pending, a second press posts nothing', h => cut(h, 'for(const b of buttons)b.disabled=true;')],
  ['no pending guard', 'one action at a time: controls disable while pending, a second press posts nothing', h => cut(h, 'if(pending)return;pending=true;', 'pending=true;')],
  ['never re-enabled', 'one action at a time: controls disable while pending, a second press posts nothing', h => cut(h, 'pending=false;for(const b of buttons)b.disabled=false;', 'pending=false;')],
  ['path-bearing message', 'the page sends only the action, the id and the toggle state (no paths)', h => cut(h, 'api.postMessage({action:button.dataset.action,id:button.dataset.id,', 'api.postMessage({action:button.dataset.action,id:button.dataset.id,path:1,')],
  ['aria-pressed never set', 'compare toggles: aria-pressed follows the result and the next press asks to close', h => cut(h, "b.setAttribute('aria-pressed',String(b.dataset.id===data.compared))", "b.setAttribute('aria-pressed','false')")],
  ['close flag always false', 'compare toggles: aria-pressed follows the result and the next press asks to close', h => cut(h, "close:button.getAttribute('aria-pressed')==='true'", 'close:false')],
  ['error not shown on result', 'a failure shows on the result and stays until dismissed', h => cut(h, "document.getElementById('error').hidden=false;")],
  ['error text not updated', 'a failure shows on the result and stays until dismissed', h => cut(h, "document.getElementById('error-text').textContent=data.error;")],
  ['result hides the error', 'a failure shows on the result and stays until dismissed', h => cut(h, 'if(data.compared!==undefined)', "if(!data.error)document.getElementById('error').hidden=true;if(data.compared!==undefined)")],
  ['dismiss does not hide', 'dismiss hides the error, tells the host, returns focus to 새로 고침 and is never disabled', h => cut(h, "document.getElementById('error').hidden=true;api.postMessage({action:'dismiss'})", "api.postMessage({action:'dismiss'})")],
  ['dismiss does not tell the host', 'dismiss hides the error, tells the host, returns focus to 새로 고침 and is never disabled', h => cut(h, "api.postMessage({action:'dismiss'});", '')],
  ['dismiss focus not returned', 'dismiss hides the error, tells the host, returns focus to 새로 고침 and is never disabled', h => cut(h, "document.querySelector('[data-action=refresh]').focus();")],
  ['dismiss waits for pending', 'dismiss hides the error, tells the host, returns focus to 새로 고침 and is never disabled', h => cut(h, "document.getElementById('dismiss').addEventListener('click',()=>{", "document.getElementById('dismiss').addEventListener('click',()=>{if(pending)return;")],
];

let passed = 0; const failures = [];
const all = { ...cssChecks, ...clientChecks };
for (const [label, fn] of Object.entries(all)) {
  const bad = fn(REAL);
  if (bad.length) { failures.push(label); console.error(`  FAIL ${label}: ${bad.join('; ')}`); } else { passed++; console.log(`  ok   ${label}`); }
}
for (const [name, check, mutate] of mutants) {
  const bad = all[check](mutate(REAL));
  if (bad.length) { passed++; console.log(`  ok   negative control "${name}" fails "${check.slice(0, 40)}"`); }
  else { failures.push(`mutant ${name}`); console.error(`  FAIL mutant "${name}" survived "${check}"`); }
}
if (failures.length) { console.error(`artifact-history-panel-client: ${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`artifact-history-panel-client: ${passed} passed`);
