// REQ-STUDIO-TYPE-SCALE — CGP-DS-R-008 (REQ-CGP-DS-09, DES-CGP-DS-09; DES-02 extended to the
// personal chat surface by DEC-29): learner-read text uses a semantic type scale whose smallest
// step is 14px, and the scale follows the learner's text-size choice (CGP-DS-R-009, #1902).
//   node --experimental-strip-types test/type-scale.smoke.mjs
//
// The webview has no DOM in tests, so this smoke computes font sizes itself: it parses every
// webview CSS file in bundle order, matches selectors against element chains that mirror the
// personal chat's markup (task workspace → conversation → chat shell), and runs the cascade
// (media queries, !important, specificity, source order, inheritance, custom properties
// substituted where they are declared, calc). It cannot see a real render; the cascade it models
// is the one the browser applies to these chains.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const read = (f) => readFileSync(new URL(f, SRC), "utf8");
// Stylesheet order in the built bundle (vite build, checked in dist/assets/index.css): main.tsx
// imports tokens.css first, then modules pull in localReview/start/citationPreview/quoteAction/codeBlock/
// quoteAction/taskWorkspace before the explicit styles.css and chatDetails.css imports.
const ORDER = ["tokens.css", "localReview.css", "start.css", "writeApprovalDialog.css", "citationPreview.css", "quoteAction.css", "codeBlock.css", "refusalBanner.css", "taskWorkspace.css", "styles.css", "chatDetails.css"];
// The DEC-29 scope: files that style only the personal task workspace and its chat.
const PERSONAL_FILES = ["chatDetails.css", "taskWorkspace.css", "citationPreview.css", "codeBlock.css"];
const FLOOR = 14;
// Files whose rules also style other surfaces (classroom chat, start page).
const SHARED_FILES = ["refusalBanner.css", "styles.css", "start.css", "quoteAction.css", "writeApprovalDialog.css"];
const STEPS = { base: 0, large: 2, xlarge: 4 };

// ─── CSS parsing ───────────────────────────────────────────────────────────────────────────────
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function parseCss(raw, file, base) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      const close = j - 1;
      if (/^@media\b/.test(head)) walk(open + 1, close, [...media, head.replace(/^@media\s*/, "")]);
      else if (!head.startsWith("@")) {
        const decls = splitTop(css.slice(open + 1, close), ";").map((d) => {
          const k = d.indexOf(":");
          let v = d.slice(k + 1).trim(); const important = /!\s*important$/i.test(v);
          if (important) v = v.replace(/!\s*important$/i, "").trim();
          return { prop: d.slice(0, k).trim().toLowerCase(), value: v, important };
        }).filter((d) => d.prop);
        rules.push({ file, media, text: head.replace(/\s+/g, " "), selectors: splitTop(head, ",").map(parseSelector), decls, order: base + rules.length });
      }
      i = close + 1;
    }
  };
  walk(0, css.length, []);
  return rules;
}

// Selector → list of { combinator, compound } from left to right.
function parseCompound(s) {
  const c = { tag: null, classes: [], attrs: [], pseudos: [], element: null };
  let i = 0;
  const ident = () => { const m = /^-?[\w-]+/.exec(s.slice(i)); i += m ? m[0].length : 0; return m ? m[0] : ""; };
  const group = () => { let depth = 0, start = i; for (; i < s.length; i++) { if (s[i] === "(") depth++; if (s[i] === ")" && --depth === 0) { i++; break; } } return s.slice(start + 1, i - 1); };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "*") { i++; continue; }
    if (ch === ".") { i++; c.classes.push(ident()); continue; }
    if (ch === "#") { i++; c.attrs.push({ name: "id", op: "=", value: ident() }); continue; }
    if (ch === "[") {
      const end = s.indexOf("]", i);
      const m = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("?)([^"\]]*)\3\s*(i)?)?\s*\]$/.exec(s.slice(i, end + 1));
      if (!m) throw new Error(`attribute selector not understood: ${s}`);
      c.attrs.push({ name: m[1], op: m[2] ?? null, value: m[4] ?? null });
      i = end + 1; continue;
    }
    if (ch === ":") {
      if (s[i + 1] === ":") { i += 2; c.element = ident(); continue; }
      i++; const name = ident().toLowerCase();
      const arg = s[i] === "(" ? group() : null;
      c.pseudos.push({ name, arg, list: arg !== null && /^(not|is|where|has)$/.test(name) ? splitTop(arg, ",").map(parseSelector) : null });
      continue;
    }
    if (/[\w-]/.test(ch)) { c.tag = ident().toLowerCase(); continue; }
    throw new Error(`selector not understood: ${s}`);
  }
  return c;
}
function parseSelector(sel) {
  const parts = []; let comb = " ", cur = "", depth = 0;
  const flush = () => { if (cur.trim()) parts.push({ comb, compound: parseCompound(cur.trim()) }); cur = ""; };
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      let j = i; while (j < sel.length && /\s/.test(sel[j])) j++;
      const sym = /[>+~]/.test(sel[j]) ? sel[j] : null;
      if (sym) { j++; while (j < sel.length && /\s/.test(sel[j])) j++; }
      if (cur.trim()) { flush(); comb = sym ?? " "; }
      i = j - 1; continue;
    }
    cur += ch;
  }
  flush();
  if (parts.length) parts[0].comb = null;
  return { text: sel, parts, spec: specificityOf(parts) };
}
function specificityOf(parts) {
  let a = 0, b = 0, c = 0;
  for (const { compound: k } of parts) {
    a += k.attrs.filter((x) => x.name === "id" && x.op === "=").length;
    b += k.classes.length + k.attrs.filter((x) => !(x.name === "id" && x.op === "=")).length;
    c += (k.tag ? 1 : 0) + (k.element ? 1 : 0);
    for (const p of k.pseudos) {
      if (p.name === "where") continue;
      if (p.list) { const best = p.list.map((s) => s.spec).sort((x, y) => y - x)[0] ?? 0; a += Math.floor(best / 1e6); b += Math.floor(best / 1e3) % 1e3; c += best % 1e3; }
      else b++;
    }
  }
  return a * 1e6 + b * 1e3 + c;
}

// ─── Matching ──────────────────────────────────────────────────────────────────────────────────
// A probe element: { tag, classes:Set, attrs:Map, root:boolean }. Resting state: no hover, focus,
// disabled or checked. Structural pseudo-classes may hold for some instance, so they match.
const STATE = new Set(["hover", "active", "focus", "focus-visible", "focus-within", "disabled", "checked", "placeholder-shown", "visited", "target", "invalid", "indeterminate", "empty", "popover-open", "modal", "open", "fullscreen", "autofill"]);
const STRUCTURAL = new Set(["first-child", "last-child", "nth-child", "nth-of-type", "nth-last-child", "first-of-type", "last-of-type", "only-child", "only-of-type", "lang", "dir", "enabled", "link", "any-link", "defined", "read-only", "read-write"]);
function attrOk(el, a) {
  if (!el.attrs.has(a.name)) return false;
  if (a.op === null) return true;
  const v = el.attrs.get(a.name);
  if (a.op === "=") return v === a.value;
  if (a.op === "~=") return v.split(/\s+/).includes(a.value);
  if (a.op === "^=") return v.startsWith(a.value);
  if (a.op === "$=") return v.endsWith(a.value);
  if (a.op === "*=") return v.includes(a.value);
  return v === a.value || v.startsWith(`${a.value}-`);
}
function compoundOk(el, k, chain, idx) {
  if (k.element) return false; // pseudo-elements are not the element's own text
  if (k.tag && k.tag !== el.tag) return false;
  for (const c of k.classes) if (!el.classes.has(c)) return false;
  for (const a of k.attrs) if (!attrOk(el, a)) return false;
  for (const p of k.pseudos) {
    if (p.name === "root") { if (!el.root) return false; continue; }
    if (p.name === "not") { if (p.list.some((s) => matchesAt(s, chain, idx))) return false; continue; }
    if (p.name === "is" || p.name === "where") { if (!p.list.some((s) => matchesAt(s, chain, idx))) return false; continue; }
    if (p.name === "has") { if (!el.has?.includes(p.arg.trim())) return false; continue; }
    if (STATE.has(p.name)) return false;
    if (STRUCTURAL.has(p.name)) continue;
    throw new Error(`pseudo-class :${p.name} is not modelled; add it to STATE or STRUCTURAL`);
  }
  return true;
}
// Right-to-left with descendant and child combinators. Siblings are not modelled, so a sibling
// combinator (+ ~) counts as possible: the rule may apply, and it is never silently dropped.
function matchesAt(sel, chain, idx) {
  const go = (pi, ci) => {
    if (!compoundOk(chain[ci], sel.parts[pi].compound, chain, ci)) return false;
    if (pi === 0) return true;
    const comb = sel.parts[pi].comb;
    if (comb === ">") return ci > 0 && go(pi - 1, ci - 1);
    if (comb === "+" || comb === "~") return true;
    for (let up = ci - 1; up >= 0; up--) if (go(pi - 1, up)) return true;
    return false;
  };
  return go(sel.parts.length - 1, idx);
}

// ─── Media ─────────────────────────────────────────────────────────────────────────────────────
function mediaOk(list, env) {
  return list.every((q) => splitTop(q, ",").some((alt) => alt.split(/\s+and\s+/).every((f) => {
    const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(f.trim());
    if (!m) throw new Error(`media feature not modelled: ${f}`);
    const [, name, v] = m; const px = parseFloat(v);
    if (name === "max-width") return env.w <= px;
    if (name === "min-width") return env.w >= px;
    if (name === "max-height") return env.h <= px;
    if (name === "min-height") return env.h >= px;
    if (name === "forced-colors") return v === "active" ? env.forced : !env.forced;
    if (name === "prefers-reduced-motion") return v === "reduce" ? env.reduce : !env.reduce;
    throw new Error(`media feature not modelled: ${name}`);
  })));
}

// ─── Cascade ───────────────────────────────────────────────────────────────────────────────────
function element(desc) {
  const k = parseCompound(desc);
  const attrs = new Map(k.attrs.map((a) => [a.name, a.value ?? ""]));
  return { tag: k.tag ?? "div", classes: new Set(k.classes), attrs, root: false, desc };
}
function substitute(value, lookup, seen = new Set()) {
  let out = value, guard = 0;
  while (/var\(/.test(out)) {
    if (++guard > 50) throw new Error(`var() did not resolve: ${value}`);
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (_, name, fb) => {
      const v = seen.has(name) ? undefined : lookup(name);
      if (v !== undefined) return v;
      if (fb !== undefined) return fb.trim();
      throw new Error(`undefined custom property ${name} in "${value}"`);
    });
  }
  return out;
}
function evalLength(v, parentPx) {
  v = v.trim();
  if (v === "inherit") return parentPx;
  const one = (t) => {
    t = t.trim();
    let m;
    if ((m = /^(-?\d*\.?\d+)px$/.exec(t))) return +m[1];
    if ((m = /^(-?\d*\.?\d+)em$/.exec(t))) return +m[1] * parentPx;
    if ((m = /^(-?\d*\.?\d+)%$/.exec(t))) return (+m[1] / 100) * parentPx;
    return null;
  };
  const simple = one(v);
  if (simple !== null) return simple;
  const calc = /^calc\((.*)\)$/.exec(v);
  if (calc) {
    const expr = calc[1].replace(/(-?\d*\.?\d+)(px|em|%)/g, (t) => String(one(t)));
    if (!/^[\d.\s+\-*/()]+$/.test(expr)) throw new Error(`calc() not modelled: ${v}`);
    return Function(`"use strict"; return (${expr});`)();
  }
  throw new Error(`font-size value not modelled: ${v}`);
}
// Cascade order: importance, then specificity, then source order (rule, then declaration).
const beats = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
// Computes font-size (px) and the winning declaration for the last element of `descs`.
function compute(rules, descs, env) {
  const chain = [{ tag: "html", classes: new Set(), attrs: new Map(), root: true, desc: "html" }, ...descs.map(element)];
  const live = rules.filter((r) => mediaOk(r.media, env));
  let parentPx = 16, parentVars = new Map(), winner = null;
  for (let ci = 0; ci < chain.length; ci++) {
    const best = new Map();
    for (const r of live) {
      const spec = r.selectors.filter((s) => matchesAt(s, chain, ci)).map((s) => s.spec).sort((x, y) => y - x)[0];
      if (spec === undefined) continue;
      r.decls.forEach((d, di) => {
        if (d.prop !== "font-size" && !d.prop.startsWith("--")) return;
        const key = [d.important ? 1 : 0, spec, r.order, di];
        const cur = best.get(d.prop);
        if (!cur || beats(key, cur.key)) best.set(d.prop, { key, d, r });
      });
    }
    // Custom properties: substituted on the element that declares them, then inherited as values.
    const vars = new Map(parentVars);
    const declared = new Map([...best].filter(([p]) => p.startsWith("--")).map(([p, w]) => [p, w.d.value]));
    const resolving = new Set();
    const lookup = (name) => {
      if (declared.has(name)) {
        if (resolving.has(name)) throw new Error(`custom property cycle at ${name}`);
        resolving.add(name);
        const v = substitute(declared.get(name), lookup);
        resolving.delete(name); declared.delete(name); vars.set(name, v);
        return v;
      }
      return vars.get(name);
    };
    for (const name of [...declared.keys()]) if (declared.has(name)) lookup(name);
    const fs = best.get("font-size");
    // The VS Code webview injects `body { font-size: var(--vscode-font-size) }` (13px).
    const px = fs ? evalLength(substitute(fs.d.value, (n) => vars.get(n)), parentPx) : chain[ci].tag === "body" ? 13 : parentPx;
    if (fs || ci === chain.length - 1) winner = fs ? { px, file: fs.r.file, rule: fs.r.text, value: fs.d.value, own: true } : winner && { ...winner, px, own: false };
    parentPx = px; parentVars = vars;
  }
  return winner ?? { px: parentPx, own: false };
}

// ─── Contexts and probes ───────────────────────────────────────────────────────────────────────
const PAGE = ["body", "div#root"];
const WS = [...PAGE, "div.tw-workspace"];
const MAIN = [...WS, "section.tw-main"];
const shellCtx = (size) => [...MAIN, "div.tw-conversation", `div.hps-shell[data-chat-detail="personal"]${size === "base" ? "" : `[data-text-size="${size}"]`}`];
// The personal chat header is portalled into the task heading (ChatPanel createPortal → headingSlot).
const HEAD = [...MAIN, "header.tw-heading"];
const PORTAL = [...HEAD, "div.tw-heading-slot", "header.hps-header"];
const RAIL = [...WS, "nav.tw-rail"];
const SOURCES = [...WS, "aside.tw-sources"];
const CONTEXT_COMPOUNDS = new Set(["div.tw-workspace", ".tw-workspace", '.hps-shell[data-chat-detail="personal"]', ".tw-heading", ".tw-conversation", ".tw-main"]);
// Element chain for a selector: its compounds become nested elements (pseudo-classes dropped; the
// element then lacks whatever a :not() excludes, which is the case :not() selects).
function chainOf(selector) {
  const out = [];
  for (const part of splitTop(selector.replace(/\s*>\s*/g, " "), " ")) {
    const bare = part.replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "");
    if (!bare || CONTEXT_COMPOUNDS.has(bare)) continue;
    out.push(/^[a-z]/.test(bare) ? bare : `span${bare}`);
  }
  return out;
}
function contextOf(selector) {
  if (/\.tw-rail|\.tw-search|\.tw-task|\.tw-local-note|\.tw-empty-search|\.tw-brand|\.tw-mark/.test(selector)) return () => RAIL;
  if (/\.tw-source|\.tw-sources|\.cp-preview|\.cp-source|\.cp-other-source/.test(selector)) return () => SOURCES;
  if (/\.hps-header|\.hps-activity-now|\.hps-trial-left|\.hps-coach-name|\.tw-chat-menu/.test(selector)) return () => PORTAL;
  if (/\.tw-heading|\.tw-run-note/.test(selector)) return () => HEAD;
  if (/^\.tw-workspace$/.test(selector)) return () => WS;
  return shellCtx;
}
const inShell = (ctx) => ctx === shellCtx;

// ─── Inventory and classification ──────────────────────────────────────────────────────────────
// Every font-size in the DEC-29 scope files is classified. LEARNER selectors must compute to
// ≥14px; the others may stay smaller (or are ≥14 anyway) for the reason given.
const NOT_LEARNER = {
  ".hps-composer-hint": "visually hidden (clip-path inset 50%): the keyboard hint is read by screen readers only",
  ".tw-mark": "decorative brand glyph (aria-hidden), 18px",
  '.hps-shell[data-chat-detail="personal"] .hps-assistant-mark': "decorative assistant mark, 15px",
  '.hps-shell[data-chat-detail="personal"] .hps-attachment-remove': "remove glyph (×) with an aria-label, 18px",
  ".hps-preferences > header button": "close glyph (×) with an aria-label, 24px",
  ".tw-source-empty > span": "decorative icon box (aria-hidden) for a 28px SVG",
};
// Unscoped rules in the scope files whose element the classroom chat also renders (header trial
// line, code-block copy status and tool buttons, composer tool captions, citation chips). The
// classroom keeps the literal; chatDetails.css raises each one under the personal shell, and the
// probe below checks that personal-scoped result.
const CLASSROOM_SHARED = {
  ".hps-trial-left": "classroom header shows the trial line too",
  ".hps-copy-status": "code-block copy status (CodeBlock) renders in classroom answers",
  ".hps-tools-menu button small": "classroom composer opens the same tools menu for file attach",
  ".hps-codeblock-tool": "code-block copy and wrap buttons render in classroom answers",
  ".cp-citation-number": "citation chips render in classroom answers (open the system browser there)",
  ".cp-citation-title": "citation chips render in classroom answers",
  ".cp-citation-domain": "citation chips render in classroom answers",
};
// Shared rules in styles.css (classroom and personal chat use the same class names). Those the
// personal chat shell can render are LEARNER here and get a personal-scoped token override in
// chatDetails.css; classroom rendering is out of DEC-29's scope and unchanged.
const SHARED_LEARNER = [
  ".hp-ai-can-do-label",
  ".hps-denial-notice",
  ".hps-coach-name", ".hps-header button", ".hps-msg-role", ".hps-user-actions button", ".hps-version-pager", ".hps-version-note",
  ".hps-edit-note", ".hps-cit-chip", ".hps-cit-domain", ".hps-msg-run, .hps-msg-retry", ".hps-naming-btn-ghost", ".hps-thinking-details pre",
  ".hps-code-progress", ".hps-codepill-toggle", ".hps-codepill-body", ".hps-empty-sub", ".hps-chips-label", ".hps-chip-text", ".hps-chip-caption",
  ".hps-error", ".hps-hint", ".hps-hint code", ".hps-input button", ".hps-queued", ".hps-img-note", ".hps-image-preparing", ".hps-attachment-name",
  ".hps-roll-hint", ".hps-roll-original", ".hps-roll-cancel", ".hps-error-banner-title", ".hps-error-banner-msg",
  ".hps-error-banner-retry, .hps-error-banner-dismiss, .hps-error-banner-report", ".hps-error-banner-rid", ".hps-update-banner-title",
  ".hps-update-banner-sub", ".hps-update-banner-notes", ".hps-update-banner-toggle", ".hps-update-banner-install, .hps-update-banner-dismiss",
  ".hps-ai-disclosure", ".hps-page-notice", ".hps-element-context", ".hps-stop-notice", ".hps-turn-review", ".hps-tool-log-line", ".hps-effort",
  ".hps-access", ".hps-verify", ".hps-verify-ai", ".hps-publish", ".hps-publish-note, .hps-publish-timing", ".hps-publish-declare legend",
  ".hps-evidence", ".hps-evidence-meta", ".hps-trial-end-card-fact", ".hps-trial-end-card-primary", ".hps-trial-end-card-escape",
  ".hps-notify-optin", ".hps-notify-optin-input", ".hps-notify-optin-submit", ".hps-notify-optin-consent", ".hps-notify-optin-withdraw",
  ".hps-recovery-notice", ".hps-recovered", ".hps-page-attachment", ".hps-page-attachment-note", ".hps-file-attach-notice", ".hps-file-attach-error",
  ".hps-input:not([data-expanded]) .hps-tools-menu button",
  // Learner panels the personal shell can also mount (lesson step, goal, evidence and completion,
  // help request, the instructor notice inbox, the trim marker #2079, the offline banner #2076).
  ".hps-context-note",
  ".hps-quote-action", ".hps-quote-note",
  ".hps-offline-banner, .hps-notice-caution",
  ".hps-delegation", ".hps-delegation-stop",
  ".hps-page-card",
  ".hp-mission-week",
  ".hp-rail-lesson-meta, .hp-rail-lesson-note",
  ".hp-goal-heading",
  ".hp-goal-error",
  ".hp-complete-why",
  ".hp-complete-note",
  ".hp-complete-notice",
  ".hp-evidence-verify",
  ".hp-evidence-form label",
  ".hp-evidence-filter",
  ".hp-evidence-empty",
  ".hp-evidence-group h4",
  ".hp-evidence-meta",
  ".hp-evidence-adopted",
  ".hp-evidence-previous",
  ".hp-evidence-diff summary",
  ".hp-evidence-diff-criterion",
  ".hp-evidence-diff-note",
  ".hp-evidence-compare h5",
  ".hp-evidence-compare pre",
  ".hp-evidence-compare small",
  ".hp-evidence-aside h5",
  ".hp-evidence-hint",
  ".hp-inbox-meta",
  ".hp-inbox-link-url",
  ".hp-help-label",
  ".hp-help-consent",
  ".hp-help-modes legend",
];
const SHARED_OUT = {
  ".hps-msg-body": "classroom body (13px); personal chat sets its own body size (checked below)",
  ".hp-ai-can-do-mark": "decorative stroke icon (check / minus, aria-hidden) in a 20px circle; the row's state word carries the state (REQ-STUDIO-UI-POLISH-1)",
  ".hps-queued-cancel": "glyph button (×) with an aria-label; personal gives it a 44px target",
  ".hps-attachment-remove": "glyph button (×) with an aria-label; personal sets 18px",
  ".hps-worlds-label": "classroom world strip (kids-quest cohorts), not rendered in personal chat",
  ".hps-world-name": "classroom world strip, not rendered in personal chat",
  ".hps-runner-say": "classroom runner bar (world cohorts), not rendered in personal chat",
  ".hps-gallery-notice": "classroom world gallery publish, not rendered in personal chat",
  ".hps-fatal-sub": "error boundary screen replaces the whole panel, outside the chat shell (follow-up)",
  ".hps-fatal-detail": "error boundary screen, outside the chat shell (follow-up)",
  ".hps-fatal-btn, .hps-fatal-btn-ghost": "error boundary screen, outside the chat shell (follow-up)",
  ".hps-instructor-band": "instructor-only",
  ".hps-instructor-model-input": "instructor-only",
  ".hps-instructor-model-error": "instructor-only",
  ".hps-voice-progress": "VoicePanel is not mounted by any screen today",
  ".hps-voice-resume": "VoicePanel is not mounted by any screen today",
  ".hps-voice-transcript": "VoicePanel is not mounted by any screen today",
  ".hps-voice-partial-tag": "VoicePanel is not mounted by any screen today",
  ".hps-voice-reference": "VoicePanel is not mounted by any screen today",
  ".hps-voice-info": "VoicePanel is not mounted by any screen today",
  ".hps-voice-compact": "VoicePanel is not mounted by any screen today",
  ".hps-shell:has(> .hp-mission .hp-mission-sentence) > .hp-mission .hp-mission-completion": "classroom mission header (personal chat has none, #1760)",
  ".hp-mission-activity": "classroom mission header (MissionHeader is not rendered in personal chat, #1760)",
  ".hp-mission-acceptance": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-mission-completion": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-mission-resume": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-mission-foot": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-mission-growth": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-mission-goal": "classroom mission header (MissionHeader, !personalWorkspace)",
  ".hp-inbox-quiet .hp-inbox-meta, .hp-inbox-quiet .hp-rail-lesson-note": "quiet inbox on the entry page (StartPage), not the personal chat",
  ".hp-inbox-quiet .hp-inbox-link-url": "quiet inbox on the entry page (StartPage), not the personal chat",
  ".hps-activity-header": "naming screen line outside the chat shell; raised by .tw-workspace .hps-activity-header in chatDetails.css (probed below)",
};

const ENVS = [1280, 1000, 690, 600, 380, 320].flatMap((w) => [900, 480].map((h) => ({ w, h, forced: false, reduce: false })));
const SCALE_ENVS = [{ w: 1280, h: 900, forced: false, reduce: false }, { w: 380, h: 480, forced: false, reduce: false }];
const pxOf = (v) => { const m = /^(\d*\.?\d+)px$/.exec(v.trim()); return m ? +m[1] : null; };


// The winning declaration of `prop` on the last element of `descs` (inherited properties walk up).
const INHERITED = new Set(["white-space"]);
function declOf(rules, descs, env, prop) {
  const chain = [{ tag: "html", classes: new Set(), attrs: new Map(), root: true, desc: "html" }, ...descs.map(element)];
  const live = rules.filter((r) => mediaOk(r.media, env));
  for (let ci = chain.length - 1; ci >= 0; ci--) {
    let best = null;
    for (const r of live) {
      const spec = r.selectors.filter((sel) => matchesAt(sel, chain, ci)).map((sel) => sel.spec).sort((x, y) => y - x)[0];
      if (spec === undefined) continue;
      r.decls.forEach((d, di) => { if (d.prop === prop) { const key = [d.important ? 1 : 0, spec, r.order, di]; if (!best || beats(key, best.key)) best = { key, value: d.value, rule: r.text }; } });
    }
    if (best || !INHERITED.has(prop)) return best;
  }
  return null;
}
// flex-shrink from either the `flex` shorthand or the longhand, whichever wins the cascade.
function flexShrink(rules, descs, env) {
  const short = declOf(rules, descs, env, "flex"), long = declOf(rules, descs, env, "flex-shrink");
  const fromShort = short && (/^none$/.test(short.value) ? 0 : /^\S+\s+(\S+)/.exec(short.value) ? +/^\S+\s+(\S+)/.exec(short.value)[1] : 1);
  if (short && (!long || beats(short.key, long.key))) return fromShort;
  return long ? +long.value : 1;
}
function check(files) {
  const findings = [];
  const rules = []; for (const f of ORDER) rules.push(...parseCss(files[f], f, rules.length));
  const fontRules = (f) => rules.filter((r) => r.file === f && !r.media.some((m) => /forced-colors/.test(m)) && r.decls.some((d) => d.prop === "font-size"));

  // 1. Tokens exist with DES-CGP-DS-09 values and are declared where the text-size step is set.
  const tokenRule = rules.find((r) => r.file === "tokens.css" && r.media.length === 0 && r.decls.some((d) => d.prop === "--hp-text-caption"));
  const tokens = Object.fromEntries((tokenRule?.decls ?? []).map((d) => [d.prop, d.value]));
  for (const [name, want] of Object.entries(TOKENS)) if (tokens[name] !== want) findings.push(`tokens.css: ${name} is ${tokens[name] ?? "missing"}, want ${want}`);
  if (tokenRule && !/(^|, )\.hps-shell(,|$)/.test(tokenRule.text)) findings.push(`tokens.css: size tokens are declared on "${tokenRule?.text}", not also on .hps-shell, so the text-size step set on the shell cannot reach them`);
  const stepRoot = rules.find((r) => r.file === "tokens.css" && r.text === ":root" && r.decls.some((d) => d.prop === "--hp-text-step"));
  if (stepRoot?.decls.find((d) => d.prop === "--hp-text-step")?.value !== "0px") findings.push("tokens.css: :root { --hp-text-step: 0px } missing");
  for (const [size, step] of Object.entries(STEPS)) {
    if (!step) continue;
    const sel = `.hps-shell[data-chat-detail="personal"][data-text-size="${size}"]`;
    const r = rules.find((x) => x.file === "chatDetails.css" && x.text === sel && x.decls.some((d) => d.prop === "--hp-text-step"));
    if (r?.decls.find((d) => d.prop === "--hp-text-step").value !== `${step}px`) findings.push(`chatDetails.css: ${sel} { --hp-text-step: ${step}px } missing`);
  }

  // 2. Every font-size in the scope files is classified, and learner text is a token.
  const probes = [];
  for (const f of PERSONAL_FILES) for (const r of fontRules(f)) for (const s of r.selectors) {
    const sel = s.text;
    const d = r.decls.find((x) => x.prop === "font-size");
    if (NOT_LEARNER[sel]) continue;
    if (!CLASSROOM_SHARED[sel] && !/^var\(--hp-text-[a-z]+\)$/.test(d.value) && !(sel.includes("[data-text-size=") && /var\(--hp-text/.test(d.value))) findings.push(`${f}: ${sel} { font-size: ${d.value} } is learner text without a --hp-text-* token`);
    if (/:(hover|focus|active|disabled)/.test(sel)) continue;
    probes.push({ label: `${f}: ${sel}`, ctx: contextOf(sel), chain: chainOf(sel) });
  }
  // 3. Every rule in the shared files (styles.css, start.css) that can set a size below 14px, whatever
  // its prefix (.hps-, .hp-, plain elements), is classified; learner ones are probed in context. A
  // size below the floor is a px value under 14 or an em/% value under 1 (smaller than its parent).
  // Only rules whose every selector is a start-page (.studio-*) selector skip the list: StartPage is
  // its own surface, not the personal chat.
  const listed = new Set([...SHARED_LEARNER, ...Object.keys(SHARED_OUT)]);
  const small = (v) => { const px = pxOf(v); if (px !== null) return px < FLOOR; const m = /^(\d*\.?\d+)(em|%)$/.exec(v.trim()); return m ? +m[1] / (m[2] === "%" ? 100 : 1) < 1 : false; };
  for (const f of SHARED_FILES) for (const r of fontRules(f)) {
    const v = r.decls.find((d) => d.prop === "font-size").value;
    if (!small(v) || r.selectors.every((x) => /^\.studio-/.test(x.text))) continue;
    if (!listed.has(r.text)) findings.push(`${f}: ${r.text} sets ${v} and is not classified (SHARED_LEARNER or SHARED_OUT)`);
  }
  for (const sel of listed) if (!SHARED_FILES.some((f) => fontRules(f).some((r) => r.text === sel))) findings.push(`styles.css: classified selector "${sel}" no longer sets a font-size (stale inventory)`);
  for (const text of SHARED_LEARNER) for (const s of splitTop(text, ",")) probes.push({ label: `styles.css: ${s}`, ctx: contextOf(s), chain: chainOf(s) });
  probes.push(...EXTRA_PROBES);

  // 4. Every probe computes to ≥14px at every viewport, and shell probes follow the text-size step.
  for (const p of probes) {
    for (const env of ENVS) {
      const got = compute(rules, [...p.ctx("base"), ...p.chain], env);
      if (got.px < FLOOR) { findings.push(`${p.label} computes to ${got.px}px at ${env.w}x${env.h} (${got.file}: ${got.rule} { font-size: ${got.value} })`); break; }
    }
    if (!inShell(p.ctx)) continue;
    scale: for (const env of SCALE_ENVS) {
      const base = compute(rules, [...p.ctx("base"), ...p.chain], env).px;
      for (const [size, step] of Object.entries(STEPS)) {
        if (!step) continue;
        const got = compute(rules, [...p.ctx(size), ...p.chain], env);
        if (Math.abs(got.px - (base + step)) > 0.01) { findings.push(`${p.label} at ${size} is ${got.px}px, want ${base}+${step} (does not follow the text-size step; ${got.file}: ${got.rule})`); break scale; }
      }
    }
  }
  // 5. The narrow task heading (390px sidebar). Text there that cannot wrap must either give way with
  // an ellipsis and a title that carries the full text, or be a short fixed label; the trial count
  // never gives way (TUX-SP-13B).
  const narrow = { w: 390, h: 800, forced: false, reduce: false };
  for (const h of HEADER_TEXT) {
    const descs = [...h.ctx, ...h.chain];
    const ws = declOf(rules, descs, narrow, "white-space")?.value ?? "normal";
    const ellipsis = declOf(rules, descs, narrow, "text-overflow")?.value === "ellipsis";
    const shrink = flexShrink(rules, descs, narrow);
    if (h.keepWhole) { if (shrink !== 0) findings.push(`header: ${h.label} can shrink at 390px (flex-shrink ${shrink}); the count must stay whole`); continue; }
    if (ws !== "nowrap") continue;
    if (ellipsis) { if (!h.titled.test(files[h.tsx] ?? "")) findings.push(`header: ${h.label} is nowrap with an ellipsis but its markup has no title carrying the full text`); continue; }
    if (!h.shortFixed) findings.push(`header: ${h.label} is nowrap and cannot give way at 390px; it pushes the trial count or the task title into an ellipsis`);
  }
  return { findings, probes: probes.length, rules };
}

const TOKENS = {
  "--hp-text-caption": "calc(14px + var(--hp-text-step))",
  "--hp-text-body": "calc(16px + var(--hp-text-step))",
  "--hp-text-lead": "calc(18px + var(--hp-text-step))",
  "--hp-leading-label": "1.5",
  "--hp-leading-prose": "1.65",
};
// Elements whose size the scope files set through another selector or inherit (no own rule here).
const EXTRA_PROBES = [
  { label: "denial source", ctx: shellCtx, chain: ["div.hps-denial-notice", "div", "span.hps-denial-source"] },
  { label: "denial text", ctx: shellCtx, chain: ["div.hps-denial-notice", "div", "p"] },
  { label: "denial action", ctx: shellCtx, chain: ["div.hps-denial-notice", "button"] },
  { label: "personal assistant prose paragraph (inherits the body)", ctx: shellCtx, chain: ["div.hps-messages", "div.hps-msg.hps-msg-assistant", "div.hps-msg-body.hps-prose", "p"] },
  { label: "personal user bubble", ctx: shellCtx, chain: ["div.hps-messages", "div.hps-msg.hps-msg-user", "div.hps-msg-body"] },
  { label: "personal composer textarea", ctx: shellCtx, chain: ["footer.hps-input-area", "div.hps-input", "textarea"] },
  { label: "팀 브레인에 정리하기 answer action (CGP-KNOW-R-004)", ctx: shellCtx, chain: ["div.hps-messages", "div.hps-msg.hps-msg-assistant", "div.hps-answer-actions", "button.hps-answer-wiki.hps-answer-action", "span"] },
  { label: "long-step hint text (REQ-STUDIO-LONG-STEP-HINT)", ctx: shellCtx, chain: ["div.hps-messages", "section.hps-long-step", "span.hps-long-step-text"] },
  { label: "long-step hint 멈추기 (REQ-STUDIO-LONG-STEP-HINT)", ctx: shellCtx, chain: ["div.hps-messages", "section.hps-long-step", "span.hps-long-step-offer", "button.hps-long-step-stop"] },
  { label: "citation chip in an answer (cp-citation, inherits)", ctx: shellCtx, chain: ["div.hps-messages", "div.hps-msg.hps-msg-assistant", "div.cp-rack", "span", "button.cp-citation"] },
  { label: "tools menu item in the expanded composer", ctx: shellCtx, chain: ['div.hps-input[data-expanded="true"]', "div.hps-composer-tools", "div.hps-tools-menu", "button"] },
  { label: "text-size picker label in 대화 설정", ctx: shellCtx, chain: ["dialog.hps-preferences", "div.hps-preferences-body", "fieldset.hps-text-size", "label", "span"] },
  { label: "AI-can-do card note (지금 쓰는 체험·이용권에서 정해진 범위예요.)", ctx: shellCtx, chain: ["details.hp-rail-lesson.hp-ai-can-do", "p.hp-rail-lesson-note"] },
  { label: "AI-can-do summary count (4가지 · 자세히)", ctx: shellCtx, chain: ["details.hp-rail-lesson.hp-ai-can-do", "summary", "span.hp-ai-can-do-count"] },
  { label: "AI-can-do row label", ctx: shellCtx, chain: ["details.hp-rail-lesson.hp-ai-can-do", "ul", "li", "span.hp-ai-can-do-label"] },
  { label: "AI-can-do row state word (해요 / 안 해요)", ctx: shellCtx, chain: ["details.hp-rail-lesson.hp-ai-can-do", "ul", "li", "span.hp-ai-can-do-state"] },
  { label: "personal access notice (이용권 상태를 확인해 주세요.)", ctx: shellCtx, chain: ["footer.hps-input-area", "div.hps-notice-caution.hps-access-attention", "span"] },
  { label: "naming screen activity line (outside the shell)", ctx: () => [...MAIN, "div.tw-conversation"], chain: ["div.hps-activity-header"] },
  { label: "task rail title", ctx: () => RAIL, chain: ["ul.tw-task-list", "li", "button.tw-task", "span.tw-task-title"] },
  { label: "task rail count in the heading", ctx: () => RAIL, chain: ["div.tw-rail-heading", "span"] },
  { label: "source list title (h3 that is also .tw-source-list-title)", ctx: () => SOURCES, chain: ["h3.tw-source-list-title"] },
  { label: "source preview policy line", ctx: () => SOURCES, chain: ["div.tw-source-detail.cp-preview", "p.tw-source-policy"] },
  { label: "task title in the heading at 320px", ctx: () => HEAD, chain: ["h1", "button.tw-title-button"] },
  // REQ-STUDIO-PREVIEW-RECOVERY — the preview failure line, its one action and the folded detail (styles.css, shared).
  { label: "preview recovery cause line", ctx: shellCtx, chain: ["div.hps-preview-recovery", "p.hps-preview-recovery-text"] },
  { label: "preview recovery action (다시 켜기 / 파일 목록 보기 / 다시 시도)", ctx: shellCtx, chain: ["div.hps-preview-recovery", "button.hps-preview-recovery-action"] },
  { label: "preview recovery 자세히 detail", ctx: shellCtx, chain: ["div.hps-preview-recovery", "details.hps-preview-recovery-detail", "code"] },
  { label: "preview recovery 'did not run' line", ctx: shellCtx, chain: ["div.hps-preview-recovery", "p.hps-preview-recovery-note"] },
  { label: "preview recovery standalone 'did not run' line", ctx: shellCtx, chain: ["p.hps-preview-recovery.hps-preview-recovery-solo"] },
  // REQ-KNOW-09 (CGP-KNOW-R-006 fix 1) — the classroom help preview's "포함하지 않는 것" line is the disclosure itself:
  // body size, not the 12px .hp-inbox-meta caption DEC-29 still allows in the classroom.
  { label: "classroom help preview exclusion line (포함하지 않는 것)", ctx: () => PAGE, chain: ["div.hps-shell", "details.hp-inbox.hp-rail-lesson.hp-help", "section.hp-help-preview", "p.hp-outbound-excluded"] },
];

// Learner text in the task heading. `titled` matches the element's own title attribute in its
// component (the fallback for an ellipsis); `shortFixed` marks short labels allowed to stay rigid.
const HEADER_TEXT = [
  { label: "task title button", ctx: HEAD, chain: ["h1", "button.tw-title-button"], tsx: "TaskWorkspace.tsx", titled: /className="tw-title-button" title=\{`[^`]*\$\{active\?\.title/ },
  { label: "run note (승인 기다리는 중 / 작업 중)", ctx: HEAD, chain: ["span.tw-run-note"] },
  { label: "current activity", ctx: PORTAL, chain: ["span.hps-activity-now"], tsx: "ChatPanel.tsx", titled: /className="hps-activity-now" aria-label="현재 활동" title=\{`\$\{kind\} · \$\{config\.activity\.name\}`\}/ },
  { label: "trial remaining count", ctx: PORTAL, chain: ["span.hps-trial-left"], keepWhole: true },
  { label: "sources toggle (자료 N)", ctx: HEAD, chain: ["button.tw-quiet.tw-sources-toggle"], shortFixed: true },
  { label: "rail toggle (☰)", ctx: HEAD, chain: ["button.tw-rail-toggle.tw-quiet"], shortFixed: true },
];

// ─── Run on the real files ─────────────────────────────────────────────────────────────────────
const cssFiles = readdirSync(SRC).filter((n) => n.endsWith(".css")).sort();
assert.deepEqual(cssFiles, [...ORDER].sort(), "every webview CSS file is in the bundle order list");
const real = { ...Object.fromEntries(ORDER.map((f) => [f, read(f)])), "TaskWorkspace.tsx": read("TaskWorkspace.tsx"), "ChatPanel.tsx": read("ChatPanel.tsx") };

// Emulator self-checks on known cascade facts (fail loudly if the model drifts from the CSS).
{
  const rules = []; for (const f of ORDER) rules.push(...parseCss(real[f], f, rules.length));
  const env = { w: 1280, h: 900, forced: false, reduce: false };
  assert.equal(compute(rules, ["body"], env).px, 13, "body is the VS Code 13px");
  assert.ok(compute(rules, [...WS], env).px >= 14, "task workspace base is at least 14px");
  // .tw-conversation .hps-msg-body (0,2,0) loses to the personal body rule (0,3,0).
  assert.equal(compute(rules, [...shellCtx("base"), "div.hps-msg", "div.hps-msg-body"], env).px, 16, "personal body is 16px");
  assert.equal(compute(rules, [...shellCtx("xlarge"), "div.hps-msg", "div.hps-msg-body"], env).px, 20, "personal body at 아주 크게 is 20px");
  // Classroom (no personal shell) keeps its own sizes: the change is personal-scoped.
  assert.equal(compute(rules, [...PAGE, "div.hps-shell", "div.hps-msg", "div.hps-msg-role"], env).px, 11, "classroom role line is unchanged (11px)");
}

// CGP-AGENT-D-002: the capability label is body-sized in both seats, even at 320px.
const capabilityRules = []; for (const f of ORDER) capabilityRules.push(...parseCss(real[f], f, capabilityRules.length));
for (const personal of [true, false]) for (const w of [320, 800, 1420]) {
  const ctx = personal ? shellCtx("base") : ["body", "div.hps-shell"];
  const label = compute(capabilityRules, [...ctx, "details.hp-rail-lesson.hp-ai-can-do", "ul", "li", "span.hp-ai-can-do-label"], { w, h: 900, forced: false, reduce: false });
  assert.equal(label.px, 16, `capability label at ${w}px personal=${personal}`);
}
// Structural CSS checks supplement the rendered-row test. Actual geometry is a browser check.
const cardRule = selector => capabilityRules.find(r => r.text === selector);
const cardProperty = (selector, prop) => cardRule(selector)?.decls.find(d => d.prop === prop)?.value;
assert.equal(cardProperty(".hp-ai-can-do li", "min-height"), "44px", "capability row height floor");
assert.equal(cardProperty(".hp-ai-can-do ul", "grid-template-columns"), "minmax(0, 1fr)", "one shrinkable column");
assert.equal(cardProperty(".hp-ai-can-do li", "overflow-wrap"), "anywhere", "long labels wrap inside the column");
// CGP-AGENT-D-006: denial body and action remain 14px in both seat layouts at 320px.
{
  const rules = []; for (const f of ORDER) rules.push(...parseCss(real[f], f, rules.length));
  for (const ctx of [shellCtx("base"), ["body", "div.hps-shell"]]) for (const child of ["p", "button"]) {
    assert.equal(compute(rules, [...ctx, "div.hps-denial-notice", ...(child === "p" ? ["div"] : []), child], { w: 320, h: 900, forced: false, reduce: false }).px, 14, "denial notice text floor");
  }
  const button = rules.find(r => r.text === ".hps-denial-notice button");
  assert.equal(button?.decls.find(d => d.prop === "min-height")?.value, "44px", "denial action target floor");
}

const result = check(real);
if (result.findings.length) {
  console.error(`type-scale: ${result.findings.length} findings`);
  for (const f of result.findings) console.error(`  - ${f}`);
  process.exit(1);
}
assert.ok(result.probes >= 120, `only ${result.probes} probes ran; the inventory is not being read`);

// ─── Negative controls: each mutation must be caught ───────────────────────────────────────────
const mutate = (file, fn) => ({ ...real, [file]: fn(real[file]) });
const NEGATIVE = [
  ["caption token below the floor", mutate("tokens.css", (s) => s.replace("--hp-text-caption: calc(14px + var(--hp-text-step))", "--hp-text-caption: calc(13px + var(--hp-text-step))")), /hp-text-caption is calc\(13px/],
  ["size tokens declared on :root only (the shell's step cannot reach them)", mutate("tokens.css", (s) => s.replace(/:root, \.hps-shell \{/, ":root {")), /does not follow the text-size step|not also on \.hps-shell/],
  ["a later personal rule with a literal 12px", mutate("chatDetails.css", (s) => `${s}\n.hps-shell[data-chat-detail="personal"] .hps-tool-log-line { font-size: 12px; }\n`), /hps-tool-log-line.*(without a --hp-text|computes to 12px)/],
  ["a narrow-only rule below the floor (caught at 690px, not at 1280px)", mutate("styles.css", (s) => `${s}\n@media (max-width: 700px) { .tw-workspace .hps-shell[data-chat-detail="personal"] .hps-cit-chip { font-size: 12px; } }\n`), /hps-cit-chip computes to 12px at 690x900/],
  ["a size token that is not defined", mutate("chatDetails.css", (s) => `${s}\n.hps-shell[data-chat-detail="personal"] .hps-cit-chip { font-size: var(--hp-text-small); }\n`), /undefined custom property --hp-text-small/],
  ["an !important base rule outranks the personal override", mutate("styles.css", (s) => s.replace(".hps-edit-note { margin: 0; font-size: 12px;", ".hps-edit-note { margin: 0; font-size: 12px !important;")), /hps-edit-note computes to 12px/],
  ["a shared class left without its personal override", mutate("chatDetails.css", (s) => s.replace(/\n\.hps-shell\[data-chat-detail="personal"\] \.hps-effort,/, "\n")), /hps-effort computes to 12px/],
  ["the composer's tool buttons left at the compact-menu 13px", mutate("chatDetails.css", (s) => s.replace(/\n\.hps-shell\[data-chat-detail="personal"\] \.hps-input button,/, "\n").replace(/\n\.hps-shell\[data-chat-detail="personal"\] \.hps-input:not\(\[data-expanded\]\) \.hps-tools-menu button,/, "\n")), /tools-menu button computes to 13px/],
  ["an unclassified new shared rule below 14px", mutate("styles.css", (s) => `${s}\n.hps-new-meta { font-size: 12px; }\n`), /hps-new-meta sets 12px and is not classified/],
  ["the text-size step rule removed", mutate("chatDetails.css", (s) => s.replace('.hps-shell[data-chat-detail="personal"][data-text-size="large"] { --hp-text-step: 2px; }', "")), /data-text-size="large"\] \{ --hp-text-step: 2px \} missing/],
  ["a rail metadata line back at 10px", mutate("taskWorkspace.css", (s) => s.replace(/\.tw-task-meta \{([^}]*)font-size: var\(--hp-text-caption\)/, ".tw-task-meta {$1font-size: 10px")), /tw-task-meta.*(without a --hp-text|computes to 10px)/],
  ["the AI-can-do note left at 12px in personal chat", mutate("chatDetails.css", (s) => s.replace(/\n\.hps-shell\[data-chat-detail="personal"\] \.hp-rail-lesson-note,/, "\n")), /AI-can-do card note .* computes to 12px|hp-rail-lesson-note computes to 12px/],
  ["the run note back to nowrap and rigid", mutate("taskWorkspace.css", (s) => s.replace(/\.tw-run-note \{[^}]*\}/, ".tw-run-note { flex: 0 0 auto; color: var(--tw-muted); font-size: var(--hp-text-caption); white-space: nowrap; }")), /run note .* cannot give way at 390px/],
  ["the trial count allowed to shrink again", mutate("taskWorkspace.css", (s) => s.replace(/\n\s*\.tw-heading \.hps-trial-left \{ flex-shrink: 0; \}/, "")), /trial remaining count can shrink at 390px/],
  ["the task title's full-text title removed", { ...real, "TaskWorkspace.tsx": real["TaskWorkspace.tsx"].replace(/className="tw-title-button" title=\{`[^`]*`\}/, 'className="tw-title-button" title="작업 이름 바꾸기"') }, /task title button is nowrap with an ellipsis but its markup has no title/],
  ["a stale classification (rule deleted from styles.css)", mutate("styles.css", (s) => s.replace(/\.hps-roll-cancel \{[^}]*\}/, "")), /hps-roll-cancel" no longer sets a font-size/],
];
for (const [what, files, expect] of NEGATIVE) {
  let found;
  try { found = check(files).findings; } catch (e) { found = [String(e.message)]; }
  assert.ok(found.length > 0, `negative control not caught: ${what}`);
  assert.ok(found.some((f) => expect.test(f)), `negative control "${what}" caught for the wrong reason:\n  ${found.slice(0, 4).join("\n  ")}`);
}
// Positive control: a learner rule that moves up the scale must not be flagged.
assert.deepEqual(check(mutate("chatDetails.css", (s) => `${s}\n.hps-shell[data-chat-detail="personal"] .hps-cit-chip { font-size: var(--hp-text-body); }\n`)).findings, [], "positive control flagged");
console.log(`type-scale OK: ${result.probes} probes ≥${FLOOR}px across ${ENVS.length} viewports, text-size steps followed, ${NEGATIVE.length} negative controls caught`);
