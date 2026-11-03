// CGP-ART-R-008 — links a learner clicks in chat never leave a minor cohort's safe
// browser, and adults confirm the host before the system browser opens. vscode-free. Run:
//   node --experimental-strip-types test/external-link-route.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { externalLinkDialog, hostAllowed, linkSafety, resolveBrowserSafety, routeExternalLink, LINK_HOST_MAX } = await import("../src/browserSafetyHelpers.ts");

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

assert.match(src, /routeExternalLink\(raw, linkSafety\(this\.cachedProfile, browser\.get<boolean>\("safeSession"\), browser\.get<string\[\]>\("safeAllowlist"\)\), \{ enforceAllowlist \}\)/, "the click uses the fail-closed safety and the flag");

// The webview never opens an external page itself: every anchor with target=_blank is gone
// from the chat UI, and the error-banner runbook link posts to the host.
const ui = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(ui, /target="_blank"/, "no raw new-window anchors in ChatPanel");
assert.match(ui, /postToHost\(\{ type: "openExternal", url: runbookUrl \}\)/, "runbook link goes through the host");

// ---- CGP-ART-D-008 ----
// Adult dialog: the host is the bold message line (second line of the message), the full address the detail.
{
  const d = externalLinkDialog({ url: "https://news.example.com/a?b=1", host: "news.example.com" });
  assert.equal(d.message, "바깥 사이트를 열까요?\nnews.example.com");
  assert.equal(d.detail, "https://news.example.com/a?b=1");
  const long = "a-very-long-subdomain-name-for-testing.another-long-label.example-host.co.kr";
  const shown = externalLinkDialog({ url: `https://${long}/`, host: long }).message.split("\n")[1];
  assert.equal(shown.length, LINK_HOST_MAX, "long host capped at 48");
  assert.ok(shown.includes("…") && shown.indexOf("…") > 0 && !shown.endsWith("…"), "ellipsis in the middle");
  assert.ok(shown.replace("…", "").length >= 24, "never below 24 characters");
  assert.ok(shown.endsWith(".co.kr"), "the registrable end stays visible");
  const exact = "x".repeat(44) + ".com";
  assert.equal(externalLinkDialog({ url: `https://${exact}/`, host: exact }).message.split("\n")[1], exact, "48 characters stay whole");
}
// No dialog for the learner's own loopback preview: the integrated browser, for every cohort.
for (const u of ["http://127.0.0.1:51884/index.html", "http://localhost:9000/", "http://[::1]:3000/", "http://2130706433/"]) {
  assert.equal(routeExternalLink(u, adult).kind, "integrated", u);
  assert.equal(routeExternalLink(u, minor, { enforceAllowlist: true }).kind, "integrated", u + " (minor, flag on)");
}
// Look-alikes are external: the adult dialog, never the loopback shortcut.
for (const u of ["http://localhost.evil.com/", "http://127.0.0.1.nip.io/", "http://localhost@evil.com/"]) {
  assert.equal(routeExternalLink(u, adult).kind, "confirm", u);
}
// Minor allowlist block (flag on). Positive controls first: the list admits these.
const safeList = resolveBrowserSafety({ browser_session: { mode: "safe", allowlist: ["example.org", "*.school.example", "https://docs.example.net/guide"] } });
for (const u of ["https://example.org/", "http://www.example.org/x", "https://a.b.school.example/", "https://docs.example.net/guide", "https://docs.example.net/guide/page"]) {
  assert.equal(routeExternalLink(u, safeList, { enforceAllowlist: true }).kind, "integrated", "admitted: " + u);
}
// Negative controls: suffix tricks, other origin, path prefix without a segment boundary, userinfo.
for (const u of ["https://evilexample.org/", "https://example.org.evil.com/", "https://docs.example.net/guidebook", "http://docs.example.net/guide", "https://docs.example.net/", "https://example.org@evil.com/", "https://games.example.com/"]) {
  const r = routeExternalLink(u, safeList, { enforceAllowlist: true });
  assert.equal(r.kind, "blocked", "blocked: " + u);
  assert.equal(r.host, new URL(u).hostname);
}
assert.equal(routeExternalLink("https://EXAMPLE.ORG./x", safeList, { enforceAllowlist: true }).kind, "integrated", "trailing dot and case");
// Flag off (the default): today's behavior, the integrated browser.
assert.equal(routeExternalLink("https://games.example.com/", safeList).kind, "integrated", "flag off keeps the integrated route");
// Empty list or no profile: fail closed when the flag is on; the persisted list is used without a profile.
assert.equal(routeExternalLink("https://example.org/", resolveBrowserSafety({ browser_session: { mode: "safe" } }), { enforceAllowlist: true }).kind, "blocked");
assert.equal(routeExternalLink("https://example.org/", linkSafety(null, undefined, ["example.org"]), { enforceAllowlist: true }).kind, "integrated");
assert.equal(routeExternalLink("https://example.org/", linkSafety(null, undefined, "garbage"), { enforceAllowlist: true }).kind, "blocked");
// Adults are never blocked by the allowlist.
assert.equal(routeExternalLink("https://games.example.com/", adult, { enforceAllowlist: true }).kind, "confirm");
// Malformed entries only narrow.
assert.equal(hostAllowed(new URL("https://example.org/"), ["", "   ", "https://", "exa mple.org", "/example.org", 42]), false);

// Wiring: the blocked branch posts the notice and never navigates; the flag is machine-scoped and default off.
assert.match(src, /if \(route\.kind === "blocked"\) \{[\s\S]{0,200}type: "externalLinkBlocked", host: route\.host[\s\S]{0,40}return;/, "blocked posts the notice and returns");
assert.match(src, /const dialog = externalLinkDialog\(route\);\s*const choice = await vscode\.window\.showWarningMessage\(dialog\.message, \{ modal: true, detail: dialog\.detail \}, "열기", "링크 복사"\)/, "the adult modal uses the dialog helper");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const flag = pkg.contributes.configuration.properties?.["hypeproofChat.safeLinkAllowlistEnabled"]
  ?? [].concat(pkg.contributes.configuration).map((c) => c.properties?.["hypeproofChat.safeLinkAllowlistEnabled"]).find(Boolean);
assert.equal(flag?.default, false, "flag default off");
assert.equal(flag?.scope, "machine", "flag machine-scoped");
assert.match(ui, /\{linkBlockedBanner\}[\s\S]*\{linkBlockedBanner\}/, "both chat layouts draw the blocked notice");
assert.match(ui, /msg\.type === "externalLinkBlocked"/, "the panel listens for the notice");

console.log("external-link-route smoke OK");
