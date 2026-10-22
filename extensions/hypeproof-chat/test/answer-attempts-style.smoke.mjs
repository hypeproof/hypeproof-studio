import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
const real={style:readDesignFile(new URL('../webview-ui/src/answerAttempts.css',import.meta.url),'utf8')};
function splitTop(list) {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
function rules(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, ""));
      else if (!head.startsWith("@")) {
        const body = css.slice(open + 1, j - 1);
        const decls = {};
        for (const d of body.split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: splitTop(head).map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r) => ({ ...r, file })));
/** Every declaration of `prop` on an exact selector (later wins), within one media context. */
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of all(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};

function check(css){
 const button='.hps-answer-attempts button', focus=button+':focus-visible';
 assert.equal(value(css,button,'min-width'),'44px');
 assert.equal(value(css,button,'min-height'),'44px');
 assert.equal(value(css,button,'font-size'),'14px');
 assert.equal(value(css,'.hps-answer-attempts','font-size'),'14px');
 assert.equal(value(css,'.hps-answer-attempts .hps-version-pager','font-size'),'inherit');
 assert.equal(value(css,focus,'outline'),'2px solid var(--hp-ring-focus-default)');
 assert.equal(value(css,focus,'outline-offset'),'2px');
 assert.equal(value(css,'.hps-answer-attempts','flex-wrap'),'wrap');
 assert.equal(value(css,'.hps-answer-attempts','max-width'),'100%');
 assert.equal(value(css,button,'color','(forced-colors: active)'),'ButtonText');
}
check(real);
for(const [from,to] of [['min-width: 44px','min-width: 20px'],['min-height: 44px','min-height: 20px'],['font-size: 14px','font-size: 11px'],['outline: 2px','outline: 0px'],['outline-offset: 2px','outline-offset: 0px'],['flex-wrap: wrap','flex-wrap: nowrap'],['max-width: 100%','max-width: none'],['color: ButtonText','color: red']]){
 const altered={style:real.style.replace(from,to)};assert.notEqual(altered.style,real.style,from);assert.throws(()=>check(altered),from);
}
console.log('answer attempt stylesheet: 8 guards and 8 negative controls passed');
