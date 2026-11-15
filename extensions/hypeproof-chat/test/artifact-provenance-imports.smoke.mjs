// #4124 (CGP-KNOW-R-028 follow-up 2) — the artifact-provenance lock as an IMPORT-GRAPH lock, not a text ban.
// Provenance records only what Studio and the AI wrote (REQ-STUDIO-ARTIFACT-PROVENANCE); it must never learn about the
// learner's own saves. So: no module that imports artifactProvenance(.ts) or artifactProvenanceView(.ts) may subscribe to
// a save event (onDid/onWill Save Text/Notebook Document), except the allow-listed ones, and an allow-listed module's
// save callback must not reach a provenance import, directly or through a method of the same class it calls.
// The call check is a HEURISTIC: it follows `this.method()` calls one level into the same class, not the whole call graph.
// It fails closed where it cannot tell: any other call in an allowed save callback (a free function, another object's method,
// a `this.x()` it cannot find in the class) is a violation unless it is listed in ALLOWED_CALLS.
// The checker parses every src/**/*.ts with the TypeScript compiler (AST, not text). Negative controls plant violations
// in memory: a new importer that subscribes, and previewProvider with a save callback that reaches noteHostWrite.
// Run: node --experimental-strip-types test/artifact-provenance-imports.smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PROVENANCE = new Set(['artifactProvenance.ts', 'artifactProvenanceView.ts'].map((f) => path.join(SRC, f)));
const SAVE_EVENTS = new Set(['onDidSaveTextDocument', 'onWillSaveTextDocument', 'onDidSaveNotebookDocument', 'onWillSaveNotebookDocument']);
/** Allowed to import provenance AND subscribe to saves, with the reason. Its save callback is still checked. */
const ALLOWED = new Map([[path.join(SRC, 'previewProvider.ts'), 'reloads the watched preview on save; it records a host write only for its own append_artifact action']]);
/** Calls an allowed save callback may make that the check cannot resolve into the class, with the reason. Empty today. */
const ALLOWED_CALLS = new Map();

const resolves = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const p = path.resolve(path.dirname(from), spec);
  return [p, p + '.ts', path.join(p, 'index.ts')].find((x) => PROVENANCE.has(x)) ?? null;
};

/** Violations in one module, from its source text. */
export function check(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(); let imports = false;
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && resolves(file, st.moduleSpecifier.text)) {
      imports = true;
      const c = ts.isImportDeclaration(st) ? st.importClause : undefined;
      if (c?.name) names.add(c.name.text);
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.add(c.namedBindings.name.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.add(e.name.text);
    }
  }
  if (!imports) return [];
  const out = [], saves = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : null;
      if (name && SAVE_EVENTS.has(name)) saves.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!saves.length) return [];
  if (!ALLOWED.has(file)) return saves.map((s) => `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(s.getStart()).line + 1} imports provenance and subscribes to ${s.expression.getText(sf)}`);
  // Allowed: the callback (and same-class methods it calls via this.x()) must not reach a provenance import.
  const usesProvenance = (node) => { let hit = null; const v = (x) => { if (hit) return; if (ts.isIdentifier(x) && names.has(x.text)) hit = x.text; ts.forEachChild(x, v); }; v(node); return hit; };
  const methodsOf = (node) => { let c = node.parent; while (c && !ts.isClassLike(c)) c = c.parent; const m = new Map(); if (c) for (const mem of c.members) if ((ts.isMethodDeclaration(mem) || ts.isPropertyDeclaration(mem)) && mem.name && ts.isIdentifier(mem.name)) m.set(mem.name.text, mem); return m; };
  for (const s of saves) {
    const line = sf.getLineAndCharacterOfPosition(s.getStart()).line + 1, methods = methodsOf(s);
    for (const arg of s.arguments) {
      const direct = usesProvenance(arg);
      if (direct) out.push(`${path.relative(SRC, file)}:${line} save callback reaches provenance (${direct})`);
      const called = new Set(), unresolved = new Set();
      const v = (x) => {
        if (ts.isCallExpression(x)) {
          const e = x.expression;
          if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword) called.add(e.name.text);
          else if (!ALLOWED_CALLS.has(e.getText(sf))) unresolved.add(e.getText(sf));
        }
        ts.forEachChild(x, v);
      };
      v(arg);
      for (const m of called) {
        const decl = methods.get(m);
        if (!decl) { out.push(`${path.relative(SRC, file)}:${line} save callback calls this.${m}(), which is not in the class (fail closed)`); continue; }
        const hit = usesProvenance(decl); if (hit) out.push(`${path.relative(SRC, file)}:${line} save callback reaches provenance through this.${m}() (${hit})`);
      }
      for (const c of unresolved) out.push(`${path.relative(SRC, file)}:${line} save callback calls ${c}(), which the check cannot follow (fail closed; allow it in ALLOWED_CALLS with a reason)`);
    }
  }
  return out;
}

const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(p); } }; walk(SRC);
let passed = 0; const t = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`); };

t('the shipped source: no module that imports provenance subscribes to saves, except previewProvider, whose callback stays clear', () => {
  const importers = files.filter((f) => !PROVENANCE.has(f) && check(f, fs.readFileSync(f, 'utf8')) !== null && ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true).statements.some((s) => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) && resolves(f, s.moduleSpecifier.text)));
  assert.ok(importers.length >= 5, `found the provenance importers (${importers.map((f) => path.relative(SRC, f))})`);
  assert.ok(importers.includes(path.join(SRC, 'previewProvider.ts')) && importers.includes(path.join(SRC, 'chatPanelProvider.ts')), 'previewProvider and chatPanelProvider are importers');
  const violations = files.flatMap((f) => check(f, fs.readFileSync(f, 'utf8')));
  assert.deepEqual(violations, []);
  // previewProvider really subscribes (the allowance is exercised, not dead).
  assert.match(fs.readFileSync(path.join(SRC, 'previewProvider.ts'), 'utf8'), /onDidSaveTextDocument/);
});

t('negative: a new module that imports provenance and subscribes to a save is caught, however the call is spelled', () => {
  const f = path.join(SRC, 'plantedTracker.ts');
  for (const body of [
    `import { noteHostWrite } from "./artifactProvenance";\nimport * as vscode from "vscode";\nvscode.workspace.onDidSaveTextDocument((d) => {});`,
    `import * as prov from "./artifactProvenanceView";\nimport { workspace } from "vscode";\nworkspace.onWillSaveTextDocument?.(() => {});`,
    `export { noteHostWrite } from "./artifactProvenance";\nimport * as vscode from "vscode";\nconst w = vscode.workspace;\nw.onDidSaveNotebookDocument(() => {});`,
  ]) assert.equal(check(f, body).length, 1, body);
  // Control: subscribing without importing provenance is not this lock's business.
  assert.deepEqual(check(f, `import * as vscode from "vscode";\nvscode.workspace.onDidSaveTextDocument(() => {});`), []);
});

t('negative: previewProvider\'s save callback reaching noteHostWrite, directly or via a this.method(), is caught', () => {
  const file = path.join(SRC, 'previewProvider.ts'), src = fs.readFileSync(file, 'utf8');
  const anchor = 'await this.reloadWatched();';
  assert.equal(src.split(anchor).length, 2, 'the save callback anchor is unique');
  const direct = src.replace(anchor, `${anchor} noteHostWrite([{ absPath: doc.uri.fsPath, data: "" }], "learner" as never);`);
  assert.ok(check(file, direct).some((x) => x.includes('reaches provenance (noteHostWrite)')), 'direct');
  const via = src.replace('if (html === null || revision !== this.previewRevision) return false;', 'if (html === null || revision !== this.previewRevision) return false; noteHostWrite([], "studio");');
  assert.notEqual(via, src, 'the reloadWatched anchor exists');
  assert.equal(check(file, via).filter((x) => x.includes('this.reloadWatched()')).length, 1, 'through reloadWatched');
});

t('fail closed: an allowed save callback that calls something the check cannot follow is a violation', () => {
  const file = path.join(SRC, 'previewProvider.ts'), src = fs.readFileSync(file, 'utf8');
  const anchor = 'await this.reloadWatched();';
  for (const call of ['recordSomewhere(doc);', 'helpers.track(doc.uri);', 'await this.notAMethodHere();']) {
    const planted = src.replace(anchor, `${anchor} ${call}`);
    assert.ok(check(file, planted).some((x) => /fail closed/.test(x)), call);
  }
});

console.log(`artifact-provenance-imports: ${passed} passed`);
