// #4092 — the rehearsal band uses the update banner's inset and margin (the banner shares its slot), its button is the
// existing quiet secondary (hp-cta-quiet), and the band adds no colour that the tokens do not already define.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../webview-ui/src/styles.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../webview-ui/src/tokens.css", import.meta.url), "utf8")
  + readFileSync(new URL("../webview-ui/src/designTokens.css", import.meta.url), "utf8");
const panel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");

// The declarations of one rule: `selector { ... }` (single-line or multi-line), first match.
function rule(selector) {
  const start = css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector}{`);
  assert.ok(start >= 0, `${selector} has a rule`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
};

const banner = rule(".hps-update-banner");
const band = rule(".hps-rehearsal-seat");

assert.equal(decl(band, "padding"), decl(banner, "padding"), "the band's inner inset is the update banner's");
assert.equal(decl(band, "margin"), decl(banner, "margin"), "the band's outer margin is the update banner's");

// The button uses the existing quiet secondary, and it is the only button class on the band.
assert.match(panel, /<button type="button" className="hp-cta-quiet" onClick=\{onEnd\}>끝내고 돌아가기<\/button>/);
assert.ok(rule(".hp-cta-quiet").includes("border:"), "hp-cta-quiet is defined (the secondary the band uses)");

// No new colour: every var() the band rule reads is defined by the tokens or the existing stylesheet.
const used = [...band.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
for (const name of used) {
  const defined = tokens.includes(`${name}:`) || css.includes(`${name}:`);
  assert.ok(defined, `${name} is an existing token, not a new colour`);
}
assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(band), "no literal colour in the band rule");

console.log("✓ rehearsal band: update-banner inset and margin, quiet secondary button, existing tokens only");
