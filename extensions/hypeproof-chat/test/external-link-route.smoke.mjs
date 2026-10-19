// CGP-ART-R-008 — links a learner clicks in chat never leave a minor cohort's safe
// browser, and adults confirm the host before the system browser opens. vscode-free. Run:
//   node --experimental-strip-types test/external-link-route.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { linkSafety, resolveBrowserSafety, routeExternalLink } = await import("../src/browserSafetyHelpers.ts");

const minor = resolveBrowserSafety({ browser_session: { mode: "safe", allowlist: ["example.org"] } });
const adult = resolveBrowserSafety({ browser_session: { mode: "browse" } });
const unknown = resolveBrowserSafety(null);

// Minor cohort: the integrated (hardened) browser, never the system browser.
assert.deepEqual(routeExternalLink("https://example.org/a?b=1", minor), { kind: "integrated", url: "https://example.org/a?b=1" });
assert.equal(routeExternalLink("https://not-allowlisted.example/", minor).kind, "integrated",
  "the hardened session enforces the allowlist; the route must not fall back to the system browser");

// Adult or unknown cohort: confirm, naming the host.
assert.deepEqual(routeExternalLink("https://news.example.com/x", adult), { kind: "confirm", url: "https://news.example.com/x", host: "news.example.com" });
assert.equal(routeExternalLink("http://a.example/", unknown).kind, "confirm");

// No profile loaded (first load, refetch, token expiry): the persisted setting decides and
// an unknown value fails closed, so a minor never gets the adult path in that window.
assert.equal(routeExternalLink("https://x.example/", linkSafety(null, true)).kind, "integrated");
assert.equal(routeExternalLink("https://x.example/", linkSafety(null, undefined)).kind, "integrated", "unknown fails closed");
assert.equal(routeExternalLink("https://x.example/", linkSafety(undefined, "garbage")).kind, "integrated");
assert.equal(routeExternalLink("https://x.example/", linkSafety(null, false)).kind, "confirm", "a known adult setting confirms");
// A loaded profile wins over a stale persisted value in both directions.
assert.equal(routeExternalLink("https://x.example/", linkSafety({ browser_session: { mode: "browse" } }, true)).kind, "confirm");
assert.equal(routeExternalLink("https://x.example/", linkSafety({ browser_session: { mode: "safe" } }, false)).kind, "integrated");

// Negative control: non-web schemes and junk are refused for everyone.
for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "vscode://x", "https://", "", 42, null, undefined]) {
  assert.deepEqual(routeExternalLink(bad, adult), { kind: "refuse" }, String(bad));
  assert.deepEqual(routeExternalLink(bad, minor), { kind: "refuse" }, String(bad));
}

// Wiring: the chat panel's two learner link paths go through openLearnerLink, and the
// system browser is reached only from the confirmed branch.
const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const exits = src.match(/vscode\.env\.openExternal\(/g) ?? [];
assert.equal(exits.length, 1, "exactly one system-browser exit in chatPanelProvider");
assert.match(src, /if \(choice === "열기"\) await vscode\.env\.openExternal/, "that exit is behind the confirmation");
assert.match(src, /case "openExternal":[\s\S]{0,400}this\.openLearnerLink\(msg\.url\)/, "citation chips use openLearnerLink");
assert.match(src, /else await this\.openLearnerLink\(url\)/, "inbox links use openLearnerLink");

assert.match(src, /routeExternalLink\(raw, linkSafety\(this\.cachedProfile, persisted\)\)/, "the click uses the fail-closed safety");

// The webview never opens an external page itself: every anchor with target=_blank is gone
// from the chat UI, and the error-banner runbook link posts to the host.
const ui = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(ui, /target="_blank"/, "no raw new-window anchors in ChatPanel");
assert.match(ui, /postToHost\(\{ type: "openExternal", url: runbookUrl \}\)/, "runbook link goes through the host");

console.log("external-link-route smoke OK");
