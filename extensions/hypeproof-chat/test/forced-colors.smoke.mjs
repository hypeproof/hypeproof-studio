import { readDesignFile } from "./lib/design-token-values.mjs";
// REQ-STUDIO-FORCED-COLORS — CGP-DS-R-016 (REQ-CGP-DS-17, DES-CGP-DS-17): under forced colors
// (Windows high contrast) every control keeps a boundary, focus keeps an outline in Highlight,
// selected/pressed states stay apart, and no status mark is carried by colour alone.
//   node --experimental-strip-types test/forced-colors.smoke.mjs
//
// Forced colors replaces author colours with the system palette and drops box-shadow and gradient
// backgrounds. What survives is geometry (border, outline, shape) and system colour keywords, so
// this smoke reads the CSS and checks exactly those. It cannot see a real Windows high-contrast
// render; that check is manual (REQ-STUDIO-FORCED-COLORS, "Not covered").
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const read = (f) => readDesignFile(new URL(f, SRC), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const quotes = (s) => s.replace(/\[([\w-]+)=("?)([^"\]]+)\2\]/g, '[$1="$3"]');

const SYSTEM = /\b(?:Canvas|CanvasText|LinkText|GrayText|Highlight|HighlightText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Mark|MarkText)\b/;
// A system colour in normal mode, in any letter case (CSS keywords are case-insensitive), but not
// as part of an identifier such as --tw-canvas or .hp-mark.
const LEAK = /(?<![\w.#-])(?:canvas|canvastext|linktext|graytext|highlight|highlighttext|buttonface|buttontext|buttonborder|field|fieldtext|mark|marktext)(?![\w-])/i;
// Specificity as one comparable number (ids, then classes/attributes/pseudo-classes, then types).
// :not() counts its argument; pseudo-elements are ignored (none of the compared rules use one).
function specificity(sel) {
  const s = sel.replace(/:not\(([^()]*)\)/g, " $1 ").replace(/::[\w-]+/g, " ");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^()]*\))?/g) ?? []).length;
  const types = (s.replace(/\[[^\]]*\]/g, "").match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}
const lastClasses = (sel) => sel.replace(/:not\([^()]*\)/g, "").trim().split(/[\s>+~]+/).pop().match(/\.[\w-]+/g) ?? [];
const FORCED_OPEN = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/g;

// Splits a CSS text into the bodies of its `@media (forced-colors: active)` blocks and the rest.
function split(raw) {
  const css = strip(raw);
  const forced = [];
  let rest = "", from = 0, m;
  FORCED_OPEN.lastIndex = 0;
  while ((m = FORCED_OPEN.exec(css))) {
    let depth = 1, i = FORCED_OPEN.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    forced.push(css.slice(FORCED_OPEN.lastIndex, i - 1));
    rest += css.slice(from, m.index);
    from = FORCED_OPEN.lastIndex = i;
  }
  return { forced, rest: rest + css.slice(from) };
}
// Flat rules (the innermost `selector { decls }`), selectors split on top-level commas.
function rulesOf(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    parts: sel.split(",").map((p) => quotes(norm(p))).filter(Boolean),
    decls: body.split(";").map((d) => [d.slice(0, d.indexOf(":")).trim(), norm(d.slice(d.indexOf(":") + 1))]).filter(([k]) => k),
  }));
}
const value = (decls, ...props) => decls.filter(([k]) => props.includes(k)).map(([, v]) => v).pop();

// ─── The inventory ─────────────────────────────────────────────────────────────────────────────
// Status marks that relied on colour (or on a background, which forced colors repaints as Canvas)
// and the non-colour cue each one gains in forced colors. `file` is where the forced rule lives.
const isBorder = (d) => /\b(solid|dashed|dotted|double)\b/.test(value(d, "border") ?? value(d, "border-style") ?? "");
const isSystemBg = (d) => SYSTEM.test(value(d, "background", "background-color") ?? "");
const INVENTORY = [
  { file: "styles.css", sel: ".hps-voice-dot", why: "voice capture dot: background only, vanishes", ok: (d) => isBorder(d) },
  { file: "styles.css", sel: ".hps-voice-dot-on", why: "capture on = red fill only", ok: (d) => /Highlight\b/.test(value(d, "background", "background-color") ?? "") },
  { file: "chatDetails.css", sel: ".hps-response-dots i", why: "pending dots: background currentColor", ok: isSystemBg },
  { file: "styles.css", sel: ".hps-runner-dust", why: "runner dust: background only", ok: isSystemBg },
  { file: "styles.css", sel: ".hps-voice-bar", why: "voice meter bars: background only", ok: isSystemBg },
  { file: "styles.css", sel: ".hps-voice-meter:not(.hps-voice-meter-live) .hps-voice-bar", why: "idle meter: a different grey", ok: (d) => /GrayText/.test(value(d, "background", "background-color") ?? "") },
  // CGP-DS-R-006: every status chip (verify state, task run, delegation, help, source state) is one
  // `.hp-status-chip`; forced colors keeps its per-intent edge style and paints it CanvasText.
  { file: "styles.css", sel: ".hp-status-chip[data-intent]", why: "status chip: tinted background per intent", ok: (d) => value(d, "border-color") === "CanvasText" },
  { file: "styles.css", sel: ".hps-instructor-badge", why: "instructor badge: tinted background only", ok: isBorder },
  { file: "styles.css", sel: ".hps-msg-user .hps-msg-body", why: "user bubble: background only (DES-CGP-DS-17)", ok: (d) => /CanvasText/.test(value(d, "border") ?? "") },
];
// Citation trust tiers 1-4 differ only by border colour: forced colors gives each its own line style.
const TIERS = [1, 2, 3, 4].map((n) => `.hps-cit-chip.hps-cit-tier-${n}`);
// Already carried by words, symbols or geometry in normal mode; these must stay that way.
const TEXT_CUES = [
  // REQ-STUDIO-STROKE-ICONS: the marks are stroke icons now (currentColor); the shape still differs per state.
  { file: "ChatPanel.tsx", what: "tool row marks", re: /t\.state === "running" \? <ChatIcon kind="dots"[^>]*\/> : t\.state === "error" \? <ChatIcon kind="alert"[^>]*\/> : <ChatIcon kind="check"/ },
  { file: "AnswerVerdict.tsx", what: "pressed verdict and reason check mark", re: /=== reason && <ChatIcon kind="check"|kind=\{state\?\.verdict === verdict \? "check"/g, count: 2 },
  { file: "TurnReviewBar.tsx", what: "failed review is an alert with a title", re: /data-state="failed" role="alert"/ },
  { file: "VerifyPanel.tsx", what: "verify state chip has its words", re: /<IntentChip chip=\{verifyChip\(view\.verification\.state\)\}/ },
  { file: "../../src/evidenceView.ts", what: "unresolved evidence source reads 확인 필요", re: /label: "확인 필요"/ },
];
const GEOMETRY_CUES = [
  // The task rail's approval and error badges are caution and danger status chips (CGP-DS-R-006).
  { file: "styles.css", sel: '.hp-status-chip[data-intent="caution"]', ok: (d) => value(d, "border-width") === "2px" && value(d, "border-style") === "solid" },
  { file: "styles.css", sel: '.hp-status-chip[data-intent="danger"]', ok: (d) => value(d, "border-width") === "3px" && value(d, "border-style") === "double" },
  { file: "styles.css", sel: ".hp-evidence-row.hp-amber", ok: (d) => /^3px solid\b/.test(value(d, "border-left") ?? "") },
  { file: "styles.css", sel: ".hps-chip-weak", ok: (d) => value(d, "border-style") === "dashed" },
];
// Small controls drawn over an image: without their own opaque system background the glyph sits on
// the picture once forced colors drops the dark disc.
const OVER_IMAGE = [".hps-attachment-remove", ".hps-edit-image button"];
// The only places allowed to opt out of forced colors.
// CGP-ART-R-006: a style-tweak swatch IS the colour the learner picks; repainting it would erase the choice.
const ADJUST_NONE_OK = [".hps-publish-link img", ".studio-guardian-pay img", ".hps-style-tweak-chip"];
// The only outline removals: a programmatic focus target, and a field whose wrapper draws the ring.
const OUTLINE_NONE_OK = [".hps-input textarea:focus", ".cp-preview h3:focus", '.hps-shell[data-chat-detail="personal"] .hps-input textarea'];
const COMPOSER_RING = '.hps-shell[data-chat-detail="personal"] .hps-input:focus-within';
const MUST_HAVE_BLOCK = ["tokens.css", "styles.css", "chatDetails.css", "start.css"];
const STATE = /\[aria-(?:pressed|checked|selected|current)="[^"]+"\]|\[aria-expanded="true"\]|:has\(input:checked\)/g;

function audit(files) {
  const bad = [];
  const parsed = Object.fromEntries(Object.entries(files).map(([f, raw]) => {
    const { forced, rest } = split(raw);
    return [f, { raw, forced, rest, forcedRules: forced.flatMap(rulesOf), restRules: rulesOf(rest) }];
  }));
  const forcedRules = Object.entries(parsed).flatMap(([f, p]) => p.forcedRules.map((r) => ({ ...r, f })));
  const restRules = Object.entries(parsed).flatMap(([f, p]) => p.restRules.map((r) => ({ ...r, f })));
  const forcedDecls = (sel, f) => forcedRules.filter((r) => (!f || r.f === f) && r.parts.includes(sel)).flatMap((r) => r.decls);

  for (const f of MUST_HAVE_BLOCK) if (!parsed[f]?.forced.length) bad.push(`${f}: no @media (forced-colors: active) block`);

  // Normal mode is untouched: no system colour keyword outside the forced blocks.
  for (const [f, p] of Object.entries(parsed)) {
    for (const v of p.restRules.flatMap((r) => r.decls.map(([, x]) => x))) {
      const leak = LEAK.exec(v);
      if (leak) bad.push(`${f}: system colour ${leak[0]} outside a forced-colors block changes normal mode`);
    }
  }

  // Focus. Every scope that sets --hp-ring-focus-default resets it to Highlight; the baseline and the composer
  // wrapper restate an outline (box-shadow is dropped in forced colors, so it can never be the ring).
  const ringScopes = restRules.filter((r) => r.decls.some(([k]) => k === "--hp-ring-focus-default")).flatMap((r) => r.parts);
  if (!ringScopes.includes(":root")) bad.push("no :root --hp-ring-focus-default found: the scan is not reading tokens.css");
  for (const s of ringScopes) if (value(forcedDecls(s), "--hp-ring-focus-default") !== "Highlight") bad.push(`"${s}" sets --hp-ring-focus-default but forced colors does not reset it to Highlight`);
  for (const [sel, f] of [[":focus-visible", "tokens.css"], [COMPOSER_RING, "chatDetails.css"]]) {
    const o = value(forcedDecls(sel, f), "outline") ?? "";
    if (!/^2px solid var\(--hp-ring-focus-default\)/.test(o)) bad.push(`${f}: forced "${sel}" outline is "${o}", not 2px solid var(--hp-ring-focus-default)`);
  }
  const sharedComposerOutline = value(restRules.filter(r => r.f === "styles.css" && r.parts.includes(".hps-input:focus-within")).flatMap(r => r.decls), "outline") ?? "";
  if (!(parseFloat(sharedComposerOutline) >= 2 && /px solid var\(--hp-ring-focus-default\)/.test(sharedComposerOutline))) bad.push("styles.css: shared composer wrapper must retain its focus outline");
  for (const { f, parts, decls } of [...restRules, ...forcedRules]) {
    const focus = parts.some((p) => /:focus(-visible|-within)?\b/.test(p));
    for (const [k, v] of decls) {
      if (focus && k === "box-shadow" && !/^none\b/.test(v)) bad.push(`${f}: "${parts[0]}" draws focus with box-shadow, which forced colors removes`);
      const removes = (k === "outline" && /^(none|0)\b/.test(v)) || (k === "outline-style" && /^none\b/.test(v));
      if (removes) for (const p of parts) if (!OUTLINE_NONE_OK.includes(p)) bad.push(`${f}: "${p}" removes the outline`);
    }
  }

  // Controls: one boundary rule for every native control and control role, winning over `border: 0`.
  const boundary = forcedRules.find((r) => r.f === "tokens.css" && r.parts.includes("button"));
  const bv = boundary && value(boundary.decls, "border");
  if (!boundary || !/^1px solid Button(?:Text|Border) !important$/.test(bv ?? "")) bad.push(`tokens.css: forced control boundary is "${bv}", not 1px solid ButtonText !important`);
  else for (const need of ["select", "textarea", "summary", '[role="button"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="radio"]']) {
    if (!boundary.parts.includes(need)) bad.push(`tokens.css: forced control boundary misses ${need}`);
  }
  if (boundary && !boundary.parts.some((p) => /^input:not\(\[type="checkbox"\]\)/.test(p))) bad.push("tokens.css: forced control boundary misses text inputs");

  // Selected / pressed / current / expanded: every state selector in normal CSS has a forced rule in
  // Highlight, either the generic attribute rule or the same selector.
  const generic = new Set(forcedRules.filter((r) => /Highlight\b/.test(value(r.decls, "background-color", "background") ?? "") && /HighlightText/.test(value(r.decls, "color") ?? "")).flatMap((r) => r.parts));
  const exactHl = new Set(forcedRules.filter((r) => r.decls.some(([k, v]) => /^(background|background-color|border|border-color)$/.test(k) && /\bHighlight\b/.test(v))).flatMap((r) => r.parts));
  let states = 0;
  for (const { f, parts } of restRules) for (const p of parts) {
    for (const [tok] of p.replace(/:not\([^()]*\)/g, "").matchAll(STATE)) {
      states++;
      if (!generic.has(tok) && !exactHl.has(p)) bad.push(`${f}: state "${p}" has no forced Highlight rule`);
    }
  }
  for (const tok of generic) if (/^\[aria-/.test(tok) && value(forcedDecls(`${tok} *`), "color") !== "HighlightText !important") bad.push(`forced "${tok}" leaves its children's colours to be forced to CanvasText`);
  if (states < 8) bad.push(`state scan saw ${states} state selectors: it is not reading the CSS`);
  // A forced fill must beat every more specific normal rule that paints the same element (same class
  // on the last compound), or that rule's colour is forced to Canvas under HighlightText. A hovered
  // open citation lost its text this way (.cp-citation:hover:not(:disabled) beat the forced rule).
  const PAINT = ["background", "background-color", "color"];
  for (const fr of forcedRules) {
    if (!/\bHighlight\b/.test(value(fr.decls, "background", "background-color") ?? "")) continue;
    const important = fr.decls.filter(([k]) => PAINT.includes(k)).every(([, v]) => /!important$/.test(v));
    for (const p of fr.parts) {
      const classes = lastClasses(p);
      if (!classes.length || important) continue;
      for (const r of restRules) if (r.decls.some(([k]) => PAINT.includes(k))) for (const q of r.parts) {
        if (lastClasses(q).some((c) => classes.includes(c)) && specificity(q) > specificity(p)) bad.push(`${fr.f}: forced "${p}" is beaten by the more specific "${q}" (${r.f}); mark its fill !important`);
      }
    }
  }
  // No focus ring on its own colour: forced colors fills pressed/current rows with Highlight and the
  // ring is Highlight too, so every inset ring (negative offset) must move outside in forced colors.
  for (const r of restRules) {
    const off = value(r.decls, "outline-offset");
    if (!off || !off.startsWith("-")) continue;
    for (const p of r.parts.filter((x) => /:focus/.test(x))) {
      const fo = value(forcedDecls(p, r.f), "outline-offset") ?? "";
      if (!/^[1-9]/.test(fo)) bad.push(`${r.f}: inset focus ring "${p}" would sit on a Highlight fill in forced colors; give it a positive offset there`);
    }
  }
  // Disabled reads GrayText (it must beat component colours, so it is !important).
  for (const s of [":disabled", '[aria-disabled="true"]']) if (value(forcedDecls(s, "tokens.css"), "color") !== "GrayText !important") bad.push(`tokens.css: forced "${s}" does not read GrayText`);

  // Colour-only status marks.
  for (const i of INVENTORY) if (!i.ok(forcedDecls(i.sel, i.file))) bad.push(`${i.file}: "${i.sel}" (${i.why}) has no non-colour cue in forced colors`);
  const tierStyles = TIERS.map((t) => /\b(solid|dashed|dotted|double|groove|ridge)\b/.exec(value(forcedDecls(t, "styles.css"), "border-left") ?? "")?.[1]);
  if (tierStyles.includes(undefined) || new Set(tierStyles).size !== TIERS.length) bad.push(`styles.css: citation tiers need four distinct forced border-left styles, got ${tierStyles}`);
  for (const g of GEOMETRY_CUES) if (!g.ok(restRules.filter((r) => r.f === g.file && r.parts.includes(g.sel)).flatMap((r) => r.decls))) bad.push(`${g.file}: "${g.sel}" lost its geometric cue`);
  for (const sel of OVER_IMAGE) if (!/^(ButtonFace|Canvas)\b/.test(value(forcedDecls(sel), "background", "background-color") ?? "")) bad.push(`"${sel}" sits on an image without an opaque system background`);

  for (const s of ADJUST_NONE_OK) if (value(forcedDecls(s), "forced-color-adjust") !== "none") bad.push(`"${s}" lost forced-color-adjust: none, so its white QR plate would be repainted`);
  // forced-color-adjust: none only where listed, only in a forced block, each with a CGP-DS-R-016 comment.
  for (const { f, parts, decls } of [...restRules, ...forcedRules]) {
    if (value(decls, "forced-color-adjust") !== "none") continue;
    for (const p of parts) if (!ADJUST_NONE_OK.includes(p)) bad.push(`${f}: "${p}" opts out of forced colors`);
  }
  for (const [f, p] of Object.entries(parsed)) {
    if (/forced-color-adjust/.test(p.rest)) bad.push(`${f}: forced-color-adjust outside a forced-colors block`);
    for (const m of p.raw.matchAll(/forced-color-adjust:\s*none/g)) {
      const before = p.raw.slice(0, m.index);
      const sel = before.lastIndexOf("}") + 1;
      const comment = before.lastIndexOf("*/");
      if (comment < 0 || before.slice(comment + 2, sel).trim() !== "" || !/CGP-DS-R-016/.test(before.slice(before.lastIndexOf("/*", comment), comment))) {
        bad.push(`${f}: forced-color-adjust: none without a CGP-DS-R-016 comment right before its rule`);
      }
    }
  }
  return bad;
}

// ─── Real CSS ──────────────────────────────────────────────────────────────────────────────────
const files = Object.fromEntries(readdirSync(SRC).filter((f) => f.endsWith(".css")).map((f) => [f, read(f)]));
assert.ok(Object.keys(files).length >= 7, `webview CSS files found: ${Object.keys(files).join(", ")}`);
const found = audit(files);
assert.deepEqual(found, [], `forced colors:\n${found.join("\n")}`);
for (const c of TEXT_CUES) {
  const src = readFileSync(new URL(c.file, SRC), "utf8");
  const hits = [...src.matchAll(c.re.global ? c.re : new RegExp(c.re.source, "g"))].length;
  assert.equal(hits, c.count ?? 1, `${c.file}: ${c.what} (non-colour cue) not found`);
}

// ─── Controls (red before green) ───────────────────────────────────────────────────────────────
// Each mutation must be caught. They break the real files, so the checker is proven on what ships.
const mutate = (f, from, to) => {
  assert.ok(files[f].includes(from), `negative control fixture missing in ${f}: ${from}`);
  return audit({ ...files, [f]: files[f].replace(from, to) });
};
const expectBad = (problems, re, label) => assert.ok(problems.some((p) => re.test(p)), `negative control not caught: ${label}\n${problems.join("\n")}`);
expectBad(mutate("styles.css", ".hps-input:focus-within", ".hps-input[data-no-focus]"), /shared composer wrapper/, "shared composer wrapper focus removed");
// origin/main: no forced-colors block anywhere.
const noBlocks = Object.fromEntries(Object.entries(files).map(([f, css]) => [f, split(css).rest]));
expectBad(audit(noBlocks), /tokens\.css: no @media \(forced-colors: active\) block/, "CSS without forced-colors blocks (origin/main)");
expectBad(audit({ ...files, "x.css": "@media (forced-colors: active) { .x:focus-visible { outline: none; } }" }), /removes the outline/, "forced focus outline: none");
expectBad(audit({ ...files, "x.css": ".x:focus-visible { outline: 0; box-shadow: 0 0 0 2px var(--hp-ring-focus-default); }" }), /box-shadow/, "focus drawn with box-shadow");
expectBad(audit({ ...files, "x.css": ".x { --hp-ring-focus-default: #D5F279; }" }), /"\.x" sets --hp-ring-focus-default/, "a new ring scope without a forced reset");
expectBad(audit({ ...files, "x.css": '.x[aria-expanded="true"] { background: #333; }' }), /state "\.x\[aria-expanded="true"\]"/, "a new expanded state without a forced rule");
assert.ok(!audit({ ...files, "x.css": '.x[aria-selected="true"] { background: #333; }' }).some((p) => p.includes(".x[")), "positive control: the generic [aria-selected] rule covers a new selected state");
expectBad(audit({ ...files, "x.css": ".x { color: Highlight; }" }), /system colour Highlight outside/, "a system colour leaking into normal mode");
expectBad(audit({ ...files, "x.css": "@media (forced-colors: active) { .x { forced-color-adjust: none; } }" }), /opts out|without a CGP-DS-R-016 comment/, "an unlisted, unexplained forced-color-adjust: none");
expectBad(mutate("styles.css", "border-left: 3px double CanvasText", "border-left: 3px solid CanvasText"), /four distinct forced border-left styles/, "two citation tiers with the same line");
expectBad(mutate("styles.css", ".hps-voice-dot { border: 1px solid CanvasText;", ".hps-voice-dot {"), /hps-voice-dot.*no non-colour cue/, "voice dot without a border");
expectBad(mutate("tokens.css", "border: 1px solid ButtonText !important;", "border: 1px solid ButtonText;"), /control boundary/, "a control boundary that loses to border: 0");
expectBad(mutate("tokens.css", "--hp-ring-focus-default: Highlight;", "--hp-ring-focus-default: CanvasText;"), /does not reset it to Highlight/, "a ring that is not Highlight");
expectBad(mutate("chatDetails.css", "background: CanvasText;", "background: currentColor;"), /hps-response-dots i/, "pending dots without a system colour");
expectBad(mutate("start.css", "still scans in dark high-contrast themes. */\n", "still scans in dark high-contrast themes. */\n  .studio-x { color: CanvasText; }\n"), /without a CGP-DS-R-016 comment/, "a QR opt-out whose justification is not right before it");
expectBad(mutate("citationPreview.css", "background-color: Highlight !important; color: HighlightText !important;", "background-color: Highlight; color: HighlightText;"), /beaten by the more specific "\.cp-citation:hover:not\(:disabled\)"/, "a forced fill that a hover rule outranks (defect D1)");
expectBad(mutate("taskWorkspace.css", "  .tw-workspace .tw-task-list button:focus-visible, .tw-workspace .tw-source-list button:focus-visible { outline-offset: 2px; }\n", ""), /inset focus ring "\.tw-workspace \.tw-task-list button:focus-visible"/, "an inset ring left on a Highlight fill (defect D2)");
expectBad(mutate("tokens.css", '  :disabled, [aria-disabled="true"] { color: GrayText !important; border-color: GrayText !important; }\n  :disabled *, [aria-disabled="true"] * { color: GrayText !important; }\n', ""), /does not read GrayText/, "disabled rules deleted");
expectBad(mutate("styles.css", "  .hps-publish-link img { forced-color-adjust: none; }\n", ""), /hps-publish-link img" lost forced-color-adjust/, "publish QR opt-out deleted");
expectBad(audit({ ...files, "x.css": ".x { color: canvastext; }" }), /system colour canvastext outside/, "a lowercase system colour leaking into normal mode");
assert.ok(!audit({ ...files, "x.css": ".hp-mark { background: var(--tw-canvas); }" }).some((p) => p.startsWith("x.css")), "positive control: identifiers containing a system colour word are not leaks");
assert.ok(specificity(".cp-citation:hover:not(:disabled)") > specificity('.cp-citation[aria-expanded="true"]'), "specificity: the hover rule really outranks the forced rule");
assert.equal(specificity('.hps-shell[data-chat-detail="personal"] .hps-input textarea'), 301, "specificity of a mixed selector");
expectBad(mutate("styles.css", "border-style: solid; border-width: 2px; border-color: var(--hp-text-warn-default);", "border-style: solid; border-color: var(--hp-text-warn-default);"), /data-intent="caution"\]" lost its geometric cue/, "a caution chip (approval) that is colour only");
expectBad(mutate("styles.css", "border-style: double; border-width: 3px;", "border-style: solid; border-width: 3px;"), /data-intent="danger"\]" lost its geometric cue/, "a danger chip (error) without its double edge");
expectBad(mutate("styles.css", "  .hp-status-chip[data-intent] { border-color: CanvasText;", "  .hp-status-chip[data-intent] {"), /hp-status-chip\[data-intent\]" .*no non-colour cue/, "a status chip whose edge vanishes in forced colors");
// Positive controls: the shapes the checker must accept.
assert.deepEqual(split("@media (forced-colors: active) { .a { color: CanvasText; } } .b { color: red; }").forced.map(norm), [".a { color: CanvasText; }"], "split reads a forced block");
assert.equal(norm(split("@media (forced-colors: active) { .a { color: CanvasText; } } .b { color: red; }").rest), ".b { color: red; }", "split keeps the rest");
assert.deepEqual(rulesOf('.a[aria-current=page] , .b { outline: 2px solid var(--hp-ring-focus-default) }')[0].parts, ['.a[aria-current="page"]', ".b"], "state attribute quotes are normalised");

console.log(`forced-colors smoke OK (${Object.keys(files).length} CSS files, ${INVENTORY.length + TIERS.length} colour-only marks, ${TEXT_CUES.length + GEOMETRY_CUES.length} existing cues)`);
