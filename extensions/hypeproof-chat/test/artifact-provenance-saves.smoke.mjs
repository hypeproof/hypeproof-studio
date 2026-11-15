// #4124 follow-up (verify-r027 on #4138) — artifact provenance never learns about the learner's own saves.
// Provenance records only what Studio and the AI wrote (REQ-STUDIO-ARTIFACT-PROVENANCE). The lock has two rules:
//
// 1. A SAVE-EVENT SUBSCRIPTION IS ALLOWED ONLY IN THE FILES LISTED IN `ALLOWED_FILES`. Every other src/**/*.ts fails if
//    it names a save event in any spelling: a property or element access, an alias, a method reference, `.bind`,
//    `.call`, a string (also one folded from `+` of literals or a template), or an element access on `workspace` with
//    a computed key (which it cannot read, so it fails).
// 2. IN THOSE FILES, EVERY SAVE CALLBACK IS AN INLINE FUNCTION, AND EVERYTHING IT CAN REACH IS A REVIEWED NODE.
//    The walk follows each call from the callback into the listed `GRAPH` nodes (methods or functions, in any src file),
//    and into nested functions inside them. A call is accepted only if its root is a pure built-in (`SAFE_ROOTS`), or it
//    names a reviewed node, or it is an explicit `CUTS` edge with a reason (a call that runs on something other than the
//    save, such as a webview message). Anything else fails: a provenance import, a call into an unreviewed function, a
//    call through a field or a local the walk cannot resolve. A new call on the save path needs a reviewed entry.
//
// This is a closed, reviewed graph, not a proof over the whole program: a node's reason is a human review of that
// function. The negative controls plant each case verify-r027 found missed by the earlier lock.
// Run: node --experimental-strip-types test/artifact-provenance-saves.smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');
const PROVENANCE = new Set(['artifactProvenance.ts', 'artifactProvenanceView.ts']);
const SAVE_EXACT = /^on(Did|Will)Save(Text|Notebook)Document$/;
const SAVE_HINT = /on(Did|Will)Save|Save(Text|Notebook)Document/;
/** The only files that may subscribe to a save event, with why. */
const ALLOWED_FILES = new Map([
  ['extension.ts', 'records a version in the artifact history (author "unknown"), never a provenance label'],
  ['memoryEditorSaves.ts', 'notes the learner\'s own memory-file save for the memory-folder guard only'],
  ['previewProvider.ts', 'reloads the watched preview'],
]);
/** Each save callback's first calls, by callee text, to the node they reach (null = a pure call, nothing to follow). */
const CALLBACK_CALLS = new Map([
  ['extension.ts', new Map([['provider.recordArtifactSave', 'chatPanelProvider.ts#recordArtifactSave']])],
  ['memoryEditorSaves.ts', new Map([['noteStudioMemorySave', 'memoryFolderGuard.ts#noteStudioMemorySave']])],
  ['previewProvider.ts', new Map([['this.reloadWatched', 'previewProvider.ts#reloadWatched']])],
]);
/** Reviewed nodes on a save path: `file#name` (a class method or a top-level function) → what it does with the save. */
const GRAPH = new Map([
  ['chatPanelProvider.ts#recordArtifactSave', 'copies the saved bytes into the artifact history (turnRestore), author "unknown"'],
  ['chatPanelProvider.ts#resolveCoachCwd', 'reads the work folder path'],
  ['chatPanelProvider.ts#artifactHistoryEnabled', 'reads a setting and the seat state'],
  ['chatPanelProvider.ts#turnRestoreTaskKey', 'reads the open task id'],
  ['turnRestore.ts#captureArtifactVersion', 'writes a history version; turnRestore imports no provenance'],
  ['turnRestore.ts#artifactHistoryStore', 'computes the history folder path'],
  ['memoryFolderGuard.ts#noteStudioMemorySave', 'journals the memory file\'s bytes for the keep-off turn check'],
  ['previewProvider.ts#reloadWatched', 'reads the watched file and re-renders it'],
  ['previewProvider.ts#show', 'renders html into the preview panel'],
  ['previewProvider.ts#shellHtml', 'builds the static shell html'],
  ['previewProvider.ts#postAskState', 'posts whether 이 파일 물어보기 is available to the preview webview'],
  ['chatPanelProvider.ts#currentTaskStore', 'returns the open task store'],
  ['extension.ts#resolveWorkspaceRoot', 'expands ~ and resolves the configured work folder path'],
]);
/** Calls inside a reviewed node that do not run on the save, with why. The walk does not follow them. */
const CUTS = new Map([
  ['previewProvider.ts#show → this.panel.webview.onDidReceiveMessage', 'registers the webview message handler; it runs on webview messages (preview_request_action can append an artifact and note a host write), never on the save'],
  ['previewProvider.ts#show → this.panel.onDidDispose', 'registers the panel dispose handler; it runs when the panel closes'],
]);
/**
 * Calls on a save path the walk cannot follow by itself (through a field, or on a returned object), each reviewed, with
 * why. Keyed `node → callee text`. They are accepted without being followed.
 */
const REVIEWED_CALLS = new Map([
  ['chatPanelProvider.ts#turnRestoreTaskKey → this.currentTaskStore()?.getView', 'TaskWorkspaceStore.getView reads the task list (taskWorkspaceStore.ts)'],
  ['previewProvider.ts#reloadWatched → this.watchedRead', 'the page-card checked read handed to watchForReload (pageCardHost reload: a read, no write)'],
  ['previewProvider.ts#show → this.panel.webview.postMessage', 'vscode.Webview.postMessage of the rendered html'],
  ['previewProvider.ts#show → this.panel?.webview.postMessage', 'vscode.Webview.postMessage of the rendered html'],
  ['previewProvider.ts#show → this.panel.webview.asWebviewUri', 'vscode.Webview.asWebviewUri for the base href'],
  ['previewProvider.ts#show → this.panel.reveal', 'vscode.WebviewPanel.reveal'],
  ['previewProvider.ts#show → this.saveSubscription?.dispose', 'disposes the save watcher of an unrelated preview'],
  ['previewProvider.ts#postAskState → this.panel?.webview.postMessage', 'vscode.Webview.postMessage of the ask state'],
  ['extension.ts#resolveWorkspaceRoot → raw.trim', 'String.prototype.trim of its string parameter'],
  ['extension.ts#resolveWorkspaceRoot → v.startsWith', 'String.prototype.startsWith of the trimmed string'],
  ['extension.ts#resolveWorkspaceRoot → v.slice', 'String.prototype.slice of the trimmed string'],
]);
/** Roots whose calls are pure or platform calls with no route to provenance. */
const SAFE_ROOTS = new Set(['path', 'Buffer', 'JSON', 'Math', 'Date', 'Number', 'String', 'Object', 'Array', 'Promise', 'Reflect', 'Symbol', 'console', 'fs', 'syncFs', 'crypto', 'os', 'vscode']);

const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(p); } }; walk(SRC);
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** A string a literal expression folds to, or null (only literals, `+` of foldable parts and substitution-free templates). */
function fold(n) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isParenthesizedExpression(n)) return fold(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) { const a = fold(n.left), b = fold(n.right); return a === null || b === null ? null : a + b; }
  return null;
}

/** Rule 1: every place a file names a save event (or reads `workspace[...]` with a key it cannot fold). */
export function saveRefs(sf) {
  const refs = [];
  const v = (n) => {
    if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && SAVE_HINT.test(n.text)) refs.push({ node: n, why: `names ${n.text}` });
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && SAVE_HINT.test(n.text)) refs.push({ node: n, why: `string "${n.text}"` });
    else if (ts.isTemplateExpression(n) && SAVE_HINT.test(n.getText(sf))) refs.push({ node: n, why: 'template naming a save event' });
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && SAVE_EXACT.test(fold(n) ?? '')) refs.push({ node: n, why: `folded string "${fold(n)}"` });
    else if (ts.isElementAccessExpression(n) && /(^|\.)workspace$/.test(n.expression.getText(sf)) && fold(n.argumentExpression) === null) refs.push({ node: n, why: 'workspace[...] with a computed key (cannot tell, fails)' });
    ts.forEachChild(n, v);
  };
  v(sf);
  return refs;
}

const sources = new Map();
const sourceOf = (name, overrides) => {
  const key = name;
  if (overrides?.has(key)) return parse(path.join(SRC, name), overrides.get(key));
  if (!sources.has(key)) sources.set(key, parse(path.join(SRC, name), fs.readFileSync(path.join(SRC, name), 'utf8')));
  return sources.get(key);
};
/** Names a module imports from a provenance module. */
const provenanceNames = (sf) => { const s = new Set(); for (const st of sf.statements) if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && PROVENANCE.has(path.basename(st.moduleSpecifier.text).replace(/(\.ts)?$/, '.ts'))) { const c = st.importClause; if (c?.name) s.add(c.name.text); if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) s.add(c.namedBindings.name.text); if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) s.add(e.name.text); } return s; };
/** Whether a src module imports a provenance module, directly or through other src modules (relative imports). */
const reachesProvenance = (() => {
  const memo = new Map();
  const go = (file, stack = new Set()) => {
    if (PROVENANCE.has(file)) return true;
    if (memo.has(file)) return memo.get(file);
    if (stack.has(file)) return false;
    stack.add(file);
    let sf; try { sf = sourceOf(file); } catch { memo.set(file, true); return true; } // unreadable: cannot tell, fails
    let hit = false;
    for (const st of sf.statements) {
      const spec = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (!spec || !spec.startsWith('.')) continue;
      const target = rel(path.resolve(path.dirname(path.join(SRC, file)), spec)).replace(/(\.ts)?$/, '.ts');
      if (go(target, stack)) { hit = true; break; }
    }
    // A dynamic import() of a relative module counts too.
    if (!hit) { const v = (n) => { if (hit) return; if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text.startsWith('.')) { if (go(rel(path.resolve(path.dirname(path.join(SRC, file)), n.arguments[0].text)).replace(/(\.ts)?$/, '.ts'), stack)) hit = true; } ts.forEachChild(n, v); }; v(sf); }
    memo.set(file, hit);
    return hit;
  };
  return (file) => go(file);
})();
/** Imported name → the src file it comes from (relative imports only). */
const importsOf = (sf, file) => { const m = new Map(); for (const st of sf.statements) if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith('.')) { const target = rel(path.resolve(path.dirname(path.join(SRC, file)), st.moduleSpecifier.text)).replace(/(\.ts)?$/, '.ts'); const c = st.importClause; if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) m.set(e.name.text, target); if (c?.name) m.set(c.name.text, target); } return m; };
/** The declaration of `file#name`: a class method / property function, or a top-level function or const function. */
function declOf(sf, name) {
  let found = null;
  const v = (n) => {
    if (found) return;
    if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === name) found = n;
    else if (ts.isPropertyDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) found = n.initializer;
    else if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) found = n.initializer;
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
}
const rootOf = (e) => { while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression; return e; };

/** Rule 2 on one body: calls must be safe, reviewed or cut; no provenance name anywhere. Returns violations, queues nodes. */
function checkBody(file, sf, body, from, queue, out) {
  const prov = provenanceNames(sf), imports = importsOf(sf, file);
  const v = (n) => {
    if (ts.isIdentifier(n) && prov.has(n.text)) out.push(`${from}: reaches provenance (${n.text})`);
    if (ts.isCallExpression(n)) {
      const callee = n.expression, text = callee.getText(sf), root = rootOf(callee);
      // A reviewed cut: this call (and the callbacks passed to it) does not run on the save. Not followed at all.
      if (CUTS.has(`${from} → ${text}`)) return;
      if (REVIEWED_CALLS.has(`${from} → ${text}`)) { /* a reviewed call, see REVIEWED_CALLS */ }
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(root) && localLiteral(n, root.text)) { /* a method of a local array/object literal */ }
      else if (ts.isIdentifier(callee) && sameModuleFn(sf, callee.text) && !reachesProvenance(file)) { /* a helper in a module with no route to provenance */ }
      else if (ts.isIdentifier(root) && SAFE_ROOTS.has(root.text)) { /* pure or platform */ }
      else if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const node = `${file}#${callee.name.text}`;
        if (CUTS.has(`${from} → ${text}`)) { /* not on the save path, reviewed */ }
        else if (GRAPH.has(node)) queue.push(node);
        else out.push(`${from}: calls ${text}(), not a reviewed node (fails closed)`);
      } else if (ts.isIdentifier(callee) && imports.has(callee.text)) {
        const target = imports.get(callee.text), node = `${target}#${callee.text}`;
        if (PROVENANCE.has(target)) out.push(`${from}: reaches provenance (${callee.text})`);
        else if (!reachesProvenance(target)) { /* a module with no route to provenance at all: decided */ }
        else if (GRAPH.has(node)) queue.push(node);
        else out.push(`${from}: calls ${text}() from ${target}, not a reviewed node (fails closed)`);
      } else if (ts.isIdentifier(callee) && GRAPH.has(`${file}#${callee.text}`)) queue.push(`${file}#${callee.text}`);
      else if (ts.isIdentifier(callee) && ['Error', 'TypeError', 'Set', 'Map', 'URL'].includes(callee.text)) { /* constructors */ }
      else out.push(`${from}: calls ${text}(), which the walk cannot resolve (fails closed)`);
    }
    ts.forEachChild(n, v);
  };
  v(body);
}

/** The identifier is a local `const`/`let` in the enclosing function initialised by an array or object literal. */
function localLiteral(node, name) {
  let f = node.parent; while (f && !ts.isFunctionLike(f)) f = f.parent;
  if (!f || !f.body) return false;
  let ok = false;
  const v = (n) => { if (ok) return; if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && (ts.isArrayLiteralExpression(n.initializer) || ts.isObjectLiteralExpression(n.initializer))) ok = true; ts.forEachChild(n, v); };
  v(f.body);
  return ok;
}
const sameModuleFn = (sf, name) => sf.statements.some((st) => (ts.isFunctionDeclaration(st) && st.name?.text === name) || (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)));
/** The whole lock over a set of sources (`overrides`: file → planted text). */
export function lock(overrides = new Map()) {
  const out = [];
  const names = new Set([...files.map(rel), ...overrides.keys()]);
  for (const file of names) {
    const sf = sourceOf(file, overrides);
    const refs = saveRefs(sf);
    if (!refs.length) continue;
    if (!ALLOWED_FILES.has(file)) { for (const r of refs) out.push(`${file}:${sf.getLineAndCharacterOfPosition(r.node.getStart()).line + 1} ${r.why}: a save subscription outside the allowed files`); continue; }
    for (const r of refs) {
      const line = sf.getLineAndCharacterOfPosition(r.node.getStart()).line + 1;
      // Only `x.onDidSaveTextDocument(inline callback)` (or `?.(…)`) is a subscription the walk can follow.
      const p = r.node.parent, call = p && ts.isPropertyAccessExpression(p) && p.name === r.node ? p.parent : null;
      const cb = call && ts.isCallExpression(call) && call.expression === p ? call.arguments[0] : null;
      if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) { out.push(`${file}:${line} ${r.why}: not an inline-callback subscription (fails closed)`); continue; }
      const queue = [], seen = new Set(), first = CALLBACK_CALLS.get(file) ?? new Map();
      // The callback's own calls must be the listed first hops.
      const v = (n) => {
        if (ts.isCallExpression(n)) {
          const text = n.expression.getText(sf), root = rootOf(n.expression);
          if (first.has(text)) queue.push(first.get(text));
          else if (!(ts.isIdentifier(root) && SAFE_ROOTS.has(root.text))) out.push(`${file}:${line} save callback calls ${text}(), not a listed first call (fails closed)`);
        }
        if (ts.isIdentifier(n) && provenanceNames(sf).has(n.text)) out.push(`${file}:${line} save callback reaches provenance (${n.text})`);
        ts.forEachChild(n, v);
      };
      v(cb.body);
      while (queue.length) {
        const node = queue.shift(); if (seen.has(node)) continue; seen.add(node);
        const [nf, nn] = node.split('#'), nsf = sourceOf(nf, overrides), decl = declOf(nsf, nn);
        if (!decl) { out.push(`${node}: listed but not found (fails closed)`); continue; }
        checkBody(nf, nsf, decl.body ?? decl, node, queue, out);
      }
    }
  }
  return out;
}

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`); };

t('the shipped source: save subscriptions only in the three files, and every save path stays in the reviewed graph', () => {
  assert.deepEqual(lock(), []);
  const subscribing = files.map(rel).filter((f) => saveRefs(sourceOf(f)).length);
  assert.deepEqual(subscribing.sort(), [...ALLOWED_FILES.keys()].sort(), 'each allowed file really subscribes (no dead allowance)');
});

const planted = (file, text) => lock(new Map([[file, text]]));
t('negative: a save subscription outside the allowed files is caught in every spelling verify-r027 found missed', () => {
  const cases = {
    'property access': `import * as vscode from "vscode";\nvscode.workspace.onDidSaveTextDocument(() => {});`,
    'element access': `import * as vscode from "vscode";\nvscode.workspace["onDidSaveTextDocument"](() => {});`,
    'folded string': `import * as vscode from "vscode";\nvscode.workspace["onDid" + "Save" + "TextDocument"](() => {});`,
    'computed key': `import * as vscode from "vscode";\nconst k = ["onDid", "SaveTextDocument"].join("");\nvscode.workspace[k](() => {});`,
    'alias': `import * as vscode from "vscode";\nconst { onWillSaveTextDocument: hook } = vscode.workspace;\nhook(() => {});`,
    'method reference': `import * as vscode from "vscode";\nconst sub = vscode.workspace.onDidSaveNotebookDocument;\nsub(() => {});`,
    '.bind': `import * as vscode from "vscode";\nconst sub = vscode.workspace.onDidSaveTextDocument.bind(vscode.workspace);\nsub(() => {});`,
    '.call': `import * as vscode from "vscode";\nvscode.workspace.onDidSaveTextDocument.call(vscode.workspace, () => {});`,
    'dynamic import': `export async function later() { const v = await import("vscode"); v.workspace.onWillSaveNotebookDocument(() => {}); }`,
    'template key': "import * as vscode from \"vscode\";\nconst ev = `onDidSave${'Text'}Document`;\n(vscode.workspace as any)[ev](() => {});",
  };
  for (const [what, text] of Object.entries(cases)) assert.ok(planted('plantedTracker.ts', text).some((x) => x.startsWith('plantedTracker.ts:')), what);
  // Control: a file with no save event at all is not this lock's business.
  assert.deepEqual(planted('plantedTracker.ts', `import * as vscode from "vscode";\nvscode.workspace.onDidChangeTextDocument(() => {});`), []);
});

t('negative: an allowed file whose save path reaches provenance, or something unreviewed, is caught (two-level and cross-file)', () => {
  const src = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
  const pv = src('previewProvider.ts'), ext = src('extension.ts'), cp = src('chatPanelProvider.ts');
  const anchor = 'await this.reloadWatched();';
  assert.equal(pv.split(anchor).length, 2, 'the preview save anchor is unique');
  const cases = [
    ['direct provenance call in the callback', 'previewProvider.ts', pv.replace(anchor, `${anchor} noteHostWrite([], "studio");`)],
    ['an unlisted call in the callback', 'previewProvider.ts', pv.replace(anchor, `${anchor} this.postAskState();`)],
    ['a method reference as the callback', 'previewProvider.ts', pv.replace(/onDidSaveTextDocument\(async \(doc\) => \{/, 'onDidSaveTextDocument(this.onSaved); const unused = (async (doc: any) => {')],
    ['two levels down: reloadWatched → show → noteHostWrite', 'previewProvider.ts', pv.replace('this.previewRevision++;\n    this.askAboutFile = askAboutFile;', 'this.previewRevision++; noteHostWrite([], "studio");\n    this.askAboutFile = askAboutFile;')],
    ['a non-importer calling into an importer: extension.ts → provider.recordArtifactSave → provenance', 'chatPanelProvider.ts', cp.replace('const cwd = this.resolveCoachCwd();\n    if (!cwd || !this.artifactHistoryEnabled()) return;', 'const cwd = this.resolveCoachCwd(); noteHostWrite([], "studio");\n    if (!cwd || !this.artifactHistoryEnabled()) return;')],
    ['extension.ts calling something else on save', 'extension.ts', ext.replace('void provider.recordArtifactSave(document.uri.fsPath);', 'void provider.recordArtifactSave(document.uri.fsPath); void provider.takeMyWork();')],
  ];
  for (const [what, file, text] of cases) {
    assert.notEqual(text, src(file), `${what}: the plant applied`);
    assert.ok(lock(new Map([[file, text]])).length > 0, what);
  }
});

console.log(`artifact-provenance-saves: ${passed} passed`);
