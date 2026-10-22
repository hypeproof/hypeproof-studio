// CGP-DS-R-001: parsed declarations, tier graph, theme coverage and the actual Chalk HTML transport.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkTransport, source, tokenCss, transport } from '../../../scripts/sync-design-tokens.mjs';
import { staticTokens } from './lib/design-token-values.mjs';
import { withDesignTokens, DESIGN_TOKENS } from '../../../chalk/src/lib/design-tokens.ts';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const postcss = require('postcss');
const ts = require('typescript');
const css = readFileSync(source, 'utf8');
const tree = postcss.parse(css);
const groups = new Map();
tree.walkRules(r => groups.set(r.selector, new Map(r.nodes.filter(n => n.type === 'decl').map(d => [d.prop,d.value]))));
const primitives = groups.get(':root');
const dark = groups.get(':root, [data-theme="dark"], .vscode-dark');
const light = groups.get('[data-theme="light"], .vscode-light');
const components = groups.get(':root, body');
assert.ok(primitives?.size && dark?.size && light?.size && components?.size, 'all three tiers and both themes exist');
assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort(), 'every semantic role has both light and dark values');
for (const [name,value] of primitives) {
  assert.match(name, /^--ds-p-/);
  assert.doesNotMatch(value, /var\(/, 'primitives cannot capture host/context variables at root');
  assert.doesNotMatch(value, /^(inherit|initial|unset|revert|revert-layer)$/i, 'CSS-wide keywords stay at the consumer');
}
for (const [name,value] of [...dark,...light]) {
  assert.match(name, /^--ds-s-/);
  assert.match(value, /^var\(--ds-p-[\w-]+\)$/);
  assert.ok(primitives.has(value.slice(4,-1)), `missing primitive for ${name}`);
}
for (const [name,value] of components) {
  assert.match(name, /^--ds-c-/);
  assert.match(value, /^var\(--ds-s-[\w-]+\)$/);
  assert.ok(dark.has(value.slice(4,-1)), `missing semantic for ${name}`);
}
const expand = staticTokens(css);
// Every CSS color literal form: hex, color functions and the CSS named colors. System colors
// (CanvasText, Highlight...) and currentColor/transparent remain allowed for forced-colors modes.
const namedColors = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const rawColor = new RegExp(String.raw`#[\da-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(|(?<![\w-])(?:${namedColors.join('|')})(?![\w-])`, 'i');
// Absolute and font-relative lengths plus durations. Viewport units, ch and % stay structural layout.
const literalDimension = /(?<![\w-])(?:-?\d*\.\d+|-?\d+)(?:px|rem|em|pt|pc|cm|mm|in|q|ms|s)\b/i;
function reportViolations(){ if(violations.length){ console.error(`design-tokens: ${violations.length} violation(s)\n`+violations.join('\n')); process.exit(1); } }
let count=0;
const violations=[];
const flag=(ok,msg)=>{ if(!ok) violations.push(msg); };
function lint(text, file) {
  postcss.parse(text, { from:file }).walkDecls(d => {
    flag(!rawColor.test(d.value), `${file}:${d.source?.start?.line ?? '?'}: ${d.prop}: literal color: ${d.value}`);
    flag(!literalDimension.test(d.value), `${file}:${d.source?.start?.line ?? '?'}: ${d.prop}: literal dimension/duration: ${d.value}`);
    if (/^(font|font-family|font-weight|line-height|--hp-leading-label|--hp-leading-prose)$/.test(d.prop)) flag(/^(var\(|inherit$|normal$|bold$|initial$|unset$)/.test(d.value), `${file}:${d.source?.start?.line ?? '?'}: ${d.prop}: literal typography: ${d.value}`);
    for (const ref of d.value.matchAll(/var\((--ds-[\w-]+)/g)) flag(/^--ds-c-/.test(ref[1]), `${file}: ${d.prop}: consumer must use component tier: ${ref[1]}`);
    expand(d.value); // unresolved aliases are errors, including in fallbacks and gradients
    count++;
  });
}
const src = new URL('../webview-ui/src/', import.meta.url);
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory()?walk(new URL(e.name+'/',dir)):[new URL(e.name,dir)]); }
for (const file of walk(src).filter(f=>f.pathname.endsWith('.css') && f.href!==source.href)) lint(readFileSync(file,'utf8'),file.pathname);
assert.match(readFileSync(new URL('tokens.css',src),'utf8'), /^@import "\.\/designTokens\.css";/, 'Studio token entry imports canonical source');
assert.match(readFileSync(new URL('main.tsx',src),'utf8'), /import "\.\/tokens\.css";/, 'Studio imports token entry');
checkTransport();
assert.throws(()=>transport('</style><script>bad</script>'), /cannot close/, 'CSS cannot escape the token style element');
const ui = new URL('../../../chalk/src/ui/', import.meta.url);
for (const file of walk(ui).filter(f=>f.pathname.endsWith('.html'))) {
  const html=readFileSync(file,'utf8');
  for(const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))lint(m[1],file.pathname);
  for(const m of html.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi))lint('x{'+m[1]+'}',file.pathname);
  const response=withDesignTokens(html);
  assert.equal(response.match(/<style data-design-tokens>/g)?.length,1);
  assert.ok(response.indexOf(DESIGN_TOKENS)<response.indexOf('<style>',response.indexOf('</style>')), 'tokens precede page rules');
  assert.ok(response.includes(html.slice(html.indexOf('</head>'))), 'transport preserves page content and scripts');
}
assert.throws(()=>withDesignTokens('<body>missing head</body>'),/missing its document root/);
// Chalk routes also inject CSS from TS modules (board status chips, the safety pin); that CSS is
// served inside the same pages, so every exported `*Css` string under chalk/src is linted too.
const chalkSrc = new URL('../../../chalk/src/', import.meta.url);
const injected = [];
for (const file of walk(chalkSrc).filter(f=>f.pathname.endsWith('.ts') && !f.pathname.endsWith('/design-tokens.ts'))) {
  if (!/export const \w+Css\b/.test(readFileSync(file,'utf8'))) continue;
  for (const [name,value] of Object.entries(await import(file.href))) if (/Css$/.test(name) && typeof value === 'string') { lint(value,`${file.pathname}#${name}`); injected.push(name); }
}
for (const name of ['boardStatusCss','safetySignalCss']) assert.ok(injected.includes(name), `injected Chalk CSS ${name} is linted`);
assert.equal(DESIGN_TOKENS,tokenCss(),'Chalk serves exact canonical bytes');

// Inline chrome is authored CSS too. Parse JSX attributes and their named object constants;
// logo SVG artwork and the learner artifact document string are content, not style props.
const themedProps = /^(?:color|backgroundColor|fontFamily|fontSize|fontWeight|lineHeight|letterSpacing|(?:min|max)?(?:Width|Height)|width|height|gap|rowGap|columnGap|padding(?:Top|Right|Bottom|Left)?|margin(?:Top|Right|Bottom|Left)?|borderRadius|boxShadow|animationDuration|transitionDuration)$/;
for (const file of walk(src).filter(f=>f.pathname.endsWith('.tsx'))) {
  const text=readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file.pathname,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const objects=new Map();
  function unwrap(n) { return n && (ts.isAsExpression(n)||ts.isSatisfiesExpression(n)||ts.isParenthesizedExpression(n)) ? unwrap(n.expression) : n; }
  function gather(n) { if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))objects.set(n.name.text,unwrap(n.initializer)); ts.forEachChild(n,gather); }
  gather(ast);
  function inspect(n) {
    if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='style'&&n.initializer&&ts.isJsxExpression(n.initializer)) {
      let obj=unwrap(n.initializer.expression);
      if(obj&&ts.isIdentifier(obj))obj=objects.get(obj.text);
      assert.ok(obj&&ts.isObjectLiteralExpression(obj),`${file.pathname}: inline style must be inspectable`);
      for(const p of obj.properties) {
        assert.ok(ts.isPropertyAssignment(p),`${file.pathname}: uninspected style spread`);
        const key=p.name.getText(ast).replace(/['"]/g,'');
        if(!themedProps.test(key))continue;
        const value=p.initializer.getText(ast);
        const at=`${file.pathname}:${ast.getLineAndCharacterOfPosition(p.getStart(ast)).line+1}`;
        flag(value==='0'||/^['"][\d.]+%['"]$/.test(value)||/var\(--(?:ds-c-|hp-|vscode-)/.test(value)||/^['"](?:inherit|auto|normal|none|currentColor|transparent)['"]$/.test(value),`${at}: inline ${key} bypasses tokens: ${value}`);
        flag(!rawColor.test(value),`${at}: inline raw color: ${value}`);
        flag(!literalDimension.test(value),`${at}: inline literal dimension: ${value}`);
      }
    }
    ts.forEachChild(n,inspect);
  }
  inspect(ast);
}
reportViolations();
console.log(`design-tokens: ${count} declarations; ${dark.size} semantic light/dark pairs; Studio and all Chalk pages PASS`);
console.log('design-tokens: TSX inline chrome and consumer tier boundaries PASS');
