// CGP-ART-R-006 / DES-ART-06: the style tweak rows inside the real ChatPanel element chip,
// measured in headless Chromium: 44px targets, 14px text, inside the chat column at 320/800/1420,
// personal and classroom, dark/light, forced colours, and a 2px focus ring.
// CGP-ART-D-006: the rows are a compact popover (<= 280px, inside the column at 320px) anchored
// under the chip's toggle, the selected swatch has a 2px ring (kept in forced colours), and every
// row has a labelled reset.
// FOCUS_REQUIRE_BROWSER=1 fails without a browser; STYLE_TWEAK_PNG_DIR=<dir> saves screenshots.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderComponent } from "./sx-render.mjs";
import { rules } from "./fixtures/stylesheet-rules.mjs";
import { findChromium, launch } from "./lib/headless-chromium.mjs";
import { THEMES } from "./lib/vscode-default-themes.mjs";

const read = (f) => readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), "utf8");
const tweakCss = read("styleTweak.css");
const value = (selector, property) => rules(tweakCss).filter((r) => !r.media && r.selectors.includes(selector)).at(-1)?.decls[property];
assert.equal(value(".hps-style-tweak button", "min-height"), "var(--hp-control-min)");
assert.equal(value(".hps-style-tweak button", "min-width"), "var(--hp-control-min)");
assert.equal(value(".hps-style-tweak button", "font-size"), "var(--ds-c-studio-styles-type-17)");
console.log("PASS style tweak stylesheet guards");

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Chromium required"); console.log("NOT RUN style tweak computed layout: no Chromium"); process.exit(0); }
let browser;
try { browser = await launch(bin); } catch (error) { if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw error; console.log(`NOT RUN style tweak computed layout: ${error.message}`); process.exit(0); }
const { chatPanelProps } = await import("./sx-screen-fixtures.mjs");
const { buildStyleTweak, chooseStyle, styleTweakView } = await import("../src/styleTweak.ts");
try {
  let state = buildStyleTweak("t1", { backendNodeId: 7, documentGeneration: "L1" }, {
    current: { color: "rgb(0, 0, 0)", "background-color": "rgba(0, 0, 0, 0)", "font-size": "16px", padding: "8px 16px", "border-radius": "0px" },
    styleAttr: null,
    pageColors: ["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(200, 30, 30)", "rgb(10, 120, 60)", "rgb(30, 60, 200)", "rgb(240, 200, 40)", "rgb(120, 120, 120)", "rgb(90, 20, 120)"],
  });
  for (const [p, v] of [["color", "rgb(200, 30, 30)"], ["font-size", "20px"]]) { const r = chooseStyle(state, "t1", p, v); assert.ok(r.ok); state = r.state; }
  const preview = { ref: "e2", tag: "h1", text: "우리 가게", source: "index.html:12", sentText: "[학생이 고른 화면 요소]\n…", imageDataUrl: null, styleTweak: { ...styleTweakView(state), requestText: "[학생이 고른 화면 요소]\n…\n\n[학생이 고른 스타일 변경 요청]\n{\"property\":\"color\",\"old\":\"rgb(0, 0, 0)\",\"new\":\"rgb(200, 30, 30)\"}" } };
  const markup = await renderComponent("ChatPanel", { ...chatPanelProps(), elementPreview: preview, onRemoveElement: () => {}, onStyleTweakSet: () => {} });
  assert.match(markup, /data-testid="style-tweak"/, "the rows render inside the element chip");
  assert.match(markup, /data-testid="style-tweak-request"/, "the exact request of the tweak send is shown");
  const css = ["designTokens.css", "tokens.css", "focusGeometry.css", "annotationTray.css", "styleTweak.css", "styles.css", "chatDetails.css"] /* bundle order (type-scale ORDER) */.map(read).join("\n");
  const measure = `(() => {
    const panel = document.querySelector('.hps-style-tweak');
    const r = panel.getBoundingClientRect();
    const buttons = [...panel.querySelectorAll('button, summary')].map(b => { const q = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label') || b.textContent, w: q.width, h: q.height, right: q.right, font: parseFloat(getComputedStyle(b).fontSize) }; });
    const texts = [...panel.querySelectorAll('.hps-style-tweak-label, .hps-style-tweak-note, .hps-style-tweak-value, .hps-style-tweak-change')].map(e => ({ text: e.textContent, font: parseFloat(getComputedStyle(e).fontSize), visible: e.getBoundingClientRect().width > 0 }));
    const chip = panel.querySelector('.hps-style-tweak-chip').getBoundingClientRect();
    const swatches = [...panel.querySelectorAll('[data-prop="color"] .hps-style-tweak-swatch')].map(b => ({ label: b.getAttribute('aria-label'), bg: getComputedStyle(b.querySelector('.hps-style-tweak-chip')).backgroundColor }));
    const column = document.querySelector('.hps-element-context').getBoundingClientRect();
    const scroller = panel.closest('.hps-messages').getBoundingClientRect();
    const toRgba = (c) => { const x = document.createElement('canvas').getContext('2d'); x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([R, G, B]) => 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
    // The colour actually behind an element: every ancestor background composited over white.
    const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(toRgba(getComputedStyle(e).backgroundColor)); let out = [255, 255, 255]; for (const [r, g, b, a] of chain.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]; return out; };
    const contrast = (el) => { const a = lum(toRgba(getComputedStyle(el).color)), b = lum(bgOf(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const chipBg = lum(bgOf(panel));
    const minContrast = Math.min(...[...panel.querySelectorAll('button:not(:disabled), .hps-style-tweak-label, .hps-style-tweak-value')].map(contrast));
    const pop = panel.querySelector('.hps-style-tweak-body'); const p = pop.getBoundingClientRect(); const ps = getComputedStyle(pop);
    const toggle = panel.querySelector('.hps-style-tweak-toggle').getBoundingClientRect();
    const ring = (b) => { const s = getComputedStyle(b); return { w: parseFloat(s.borderTopWidth), style: s.borderTopStyle, color: s.borderTopColor, bg: s.backgroundColor }; };
    const selected = [...panel.querySelectorAll('[data-prop="color"] .hps-style-tweak-swatch[aria-checked="true"]')].map(ring);
    const unselected = ring(panel.querySelector('[data-prop="color"] .hps-style-tweak-swatch[aria-checked="false"]'));
    const resets = [...panel.querySelectorAll('[data-prop]')].map(r => { const x = r.querySelector('.hps-style-tweak-reset'), q = x.getBoundingClientRect(), l = r.querySelector('.hps-style-tweak-label').getBoundingClientRect(), c = r.querySelector('.hps-style-tweak-swatches, .hps-style-tweak-stepper').getBoundingClientRect(); return { prop: r.dataset.prop, label: x.getAttribute('aria-label'), sameLine: q.top < l.bottom && l.top < q.bottom, controlsBelow: c.top >= q.bottom - 1, insideRight: q.right <= p.right }; });
    const popover = { w: p.width, left: p.left, right: p.right, top: p.top, toggleLeft: toggle.left, toggleBottom: toggle.bottom, border: parseFloat(ps.borderTopWidth), scroll: pop.scrollWidth, client: pop.clientWidth };
    return { popover, selected, unselected, resets, chipBg, minContrast, right: r.right, viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, panelScroll: panel.scrollWidth, panelClient: panel.clientWidth, columnRight: column.right, scrollerRight: scroller.right, rows: panel.querySelectorAll('[data-prop]').length, swatches, buttons, texts, chip: { w: chip.width, h: chip.height } };
  })()`;
  const pngDir = process.env.STYLE_TWEAK_PNG_DIR;
  if (pngDir) mkdirSync(pngDir, { recursive: true });
  let combos = 0;
  for (const width of [320, 800, 1420]) for (const dark of [true, false]) for (const seat of ["personal", "classroom"]) for (const forcedColors of [false, true]) {
    combos++;
    // The Studio themes come from VS Code's injected --vscode-* variables and body class; media emulation alone leaves the dark default.
    const vars = Object.entries(THEMES[dark ? "Dark+" : "Light+"]).filter(([k, v]) => typeof v === "string" && !["kind", "file"].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll(".", "-")}:${v}`).join(";");
    await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? "vscode-dark" : "vscode-light"}" data-theme="${dark ? "dark" : "light"}"><div class="hps-shell" data-chat-detail="${seat}">${markup}</div></body></html>`, { width, height: 1800, dark, forcedColors });
    const m = await browser.evaluate(measure);
    const ctx = `${width}px ${dark ? "dark" : "light"} ${seat}${forcedColors ? " forced" : ""}`;
    assert.equal(m.rows, 5, ctx);
    if (!forcedColors) {
      assert.ok(dark ? m.chipBg < 0.2 : m.chipBg > 0.6, `the ${dark ? "dark" : "light"} theme is the one rendered (chip luminance ${m.chipBg.toFixed(2)}): ${ctx}`);
      assert.ok(m.minContrast >= 4.5, `text contrast >= 4.5:1 (min ${m.minContrast.toFixed(2)}): ${ctx}`);
    }
    assert.ok(m.right <= m.viewport + 1 && m.scroll <= m.viewport + 1, `inside the viewport, no page scroll: ${ctx} ${JSON.stringify({ right: m.right, viewport: m.viewport, scroll: m.scroll })}`);
    assert.ok(m.panelScroll <= m.panelClient + 1 && m.right <= m.columnRight + 1 && m.right <= m.scrollerRight + 1, `inside the chip column and the message scroller: ${ctx}`);
    for (const b of m.buttons) {
      assert.ok(b.w >= 44 && b.h >= 44, `44px target ${b.label} ${b.w}x${b.h}: ${ctx}`);
      assert.ok(b.font >= 14, `14px text ${b.label}: ${ctx}`);
      assert.ok(b.right <= m.viewport + 1, `button inside viewport ${b.label}: ${ctx}`);
    }
    for (const t of m.texts) assert.ok(t.visible && t.font >= 14, `14px text "${t.text}": ${ctx}`);
    for (const w of m.swatches) assert.ok(w.label.includes(w.bg), `swatch shows its own colour ${w.label} -> ${w.bg}: ${ctx}`);
    assert.equal(m.swatches.length, 8, ctx);
    // DES-ART-06 popover: <= 280px, inside the chip column (fits at 320px), anchored under its toggle.
    const pop = m.popover;
    assert.ok(pop.w <= 280.5, `popover <= 280px wide: ${ctx} ${pop.w}`);
    assert.ok(pop.right <= m.columnRight + 1 && pop.scroll <= pop.client + 1, `popover inside the column, no inner scroll: ${ctx}`);
    assert.ok(Math.abs(pop.left - pop.toggleLeft) <= 1 && pop.top >= pop.toggleBottom - 1 && pop.top - pop.toggleBottom <= 12, `popover anchored under its toggle: ${ctx} ${JSON.stringify(pop)}`);
    assert.ok(pop.border >= 1, `popover has its own edge: ${ctx}`);
    if (width >= 800) assert.ok(pop.w >= 279.5, `popover is compact, not column wide, when there is room: ${ctx} ${pop.w}`);
    // 2px selected ring; unselected swatches keep the thin control border. Forced colours use the
    // system selection pair instead (tokens.css: every [aria-checked="true"] fills with Highlight).
    assert.equal(m.selected.length, 1, ctx);
    if (!forcedColors) {
      assert.ok(m.selected[0].w === 2 && m.selected[0].style === "solid", `2px selected ring: ${ctx} ${JSON.stringify(m.selected[0])}`);
      assert.ok(m.unselected.w < 2 && m.unselected.color !== m.selected[0].color, `the ring differs from an unselected swatch: ${ctx} ${JSON.stringify(m.selected[0])} ${JSON.stringify(m.unselected)}`);
    } else assert.ok(m.selected[0].bg !== m.unselected.bg, `forced colours: the selected swatch takes the selection fill: ${ctx} ${JSON.stringify(m.selected[0])} ${JSON.stringify(m.unselected)}`);
    assert.deepEqual(m.resets.map((r) => r.label), ["색 되돌리기", "배경 되돌리기", "글자 크기 되돌리기", "간격 되돌리기", "모서리 되돌리기"], `each row has a labelled reset: ${ctx}`);
    for (const r of m.resets) assert.ok(r.sameLine && r.controlsBelow && r.insideRight, `reset on the label line, controls below: ${r.prop} ${ctx} ${JSON.stringify(r)}`);
    assert.ok(m.chip.w >= 23 && m.chip.w <= 25 && m.chip.h >= 23 && m.chip.h <= 25, `24px swatch: ${ctx} ${JSON.stringify(m.chip)}`);
    for (const sel of [".hps-style-tweak-send", ".hps-style-tweak-swatch", ".hps-style-tweak-reset:not(:disabled)"]) {
      const f = await browser.focusVisibleStyle(sel);
      assert.ok(parseFloat(f["outline-width"]) >= 2 && f["outline-style"] === "solid", `focus ring on ${sel}: ${ctx}`);
    }
    if (pngDir) {
      const clip = await browser.evaluate(`(() => { const el = document.querySelector('.hps-element-context'); el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - 8) + scrollX, y: Math.max(0, r.top - 8) + scrollY, width: Math.min(document.documentElement.clientWidth, r.width + 16), height: r.height + 16, scale: 1 }; })()`);
      const shot = await browser.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
      writeFileSync(join(pngDir, `style-tweak-${seat}-${dark ? "dark" : "light"}-${width}${forcedColors ? "-forced" : ""}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  console.log(`PASS style tweak computed layout: personal/classroom x 320/800/1420 x dark/light/forced colours (${combos} renders)`);
} finally { await browser.close(); }
