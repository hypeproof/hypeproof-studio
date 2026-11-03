// studio#3396 item 1 — the layout-loop rule, and the guard it points to.
//   node --experimental-strip-types test/layout-loop-guard.smoke.mjs
//
// Rule: every `useLayoutEffect(...)` and every `new ResizeObserver(...)` in webview-ui/src whose body
// calls a React setter (`setX(`) must either route that state through the layout-loop guard
// (`useLayoutLoopGuard` / `guardLayoutSetter`, see webview-ui/src/layoutLoopGuard.ts) or carry a
// `// layout-loop-ok: <reason>` comment inside the block. 2026-11-02: the composer's auto-resize set
// state from a measurement, its own layout change flipped the measurement, and React stopped with #185.
//
// Self-test: the scanner must flag a planted unguarded effect and a planted ResizeObserver, accept the
// same blocks with a guard or a waiver, and reject an empty waiver reason.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../webview-ui/src');

/** The balanced `( … )` that follows a match: the effect's or observer's whole argument list. */
function argumentsOf(source, at) {
  const open = source.indexOf('(', at);
  for (let i = open, depth = 0; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

export function findUnguarded(source) {
  const out = [];
  for (const m of source.matchAll(/useLayoutEffect\(|new ResizeObserver\(/g)) {
    const body = argumentsOf(source, m.index);
    const setters = [...new Set(body.match(/\bset[A-Z]\w*(?=\()/g) ?? [])];
    if (!setters.length) continue;
    if (/\/\/ layout-loop-ok:[ \t]*\S/.test(body)) continue;
    out.push({ line: source.slice(0, m.index).split('\n').length, kind: m[0].replace('(', ''), setters });
  }
  return out;
}

// Self-test on planted sources.
assert.equal(findUnguarded('useLayoutEffect(() => { setOpen(el.offsetHeight > 10); }, []);').length, 1, 'a measured setter is flagged');
assert.equal(findUnguarded('const ro = new ResizeObserver(() => setWide(el.clientWidth > 400));').length, 1, 'an observer callback is flagged');
assert.equal(findUnguarded('const g = useLayoutLoopGuard(setOpen, "x"); useLayoutEffect(() => { g(el.offsetHeight > 10); }, [g]);').length, 0, 'the guarded call passes');
assert.equal(findUnguarded('useLayoutEffect(() => {\n  // layout-loop-ok: runs once on mount\n  setOpen(true);\n}, []);').length, 0, 'a waiver with a reason passes');
assert.equal(findUnguarded('useLayoutEffect(() => {\n  // layout-loop-ok:\n  setOpen(true);\n}, []);').length, 1, 'an empty waiver does not');
assert.equal(findUnguarded('useLayoutEffect(() => { el.scrollTop = 0; }, []);').length, 0, 'no setter, nothing to flag');

const files = [];
(function walk(dir) { for (const name of readdirSync(dir)) { const p = path.join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(name)) files.push(p); } })(root);
const problems = [];
let scanned = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (/useLayoutEffect\(|new ResizeObserver\(/.test(source)) scanned++;
  for (const p of findUnguarded(source)) problems.push(`${path.relative(root, file)}:${p.line} ${p.kind} sets ${p.setters.join(', ')} without the layout-loop guard or a // layout-loop-ok: reason`);
}
assert.ok(scanned >= 5, `control: the scan found layout effects in ${scanned} files`);
if (problems.length) { console.error('layout-loop-guard FAIL\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`layout-loop-guard PASS: ${scanned} files with layout effects or observers, every state setter guarded or waived`);
