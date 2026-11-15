// CGP-ART-R-008 / CGP-SHELL-R-026 — links a learner clicks never leave a minor cohort's safe browser, and a minor
// confirms every link the lesson allowlist does not admit; adults open the system browser, confirming only with
// hypeproofChat.confirmExternalLinks; a preview link always confirms. vscode-free. Run:
//   node --experimental-strip-types test/external-link-route.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { hostAllowed, linkHostDisplay, LinkOpenLimiter, linkSafety, resolveBrowserSafety, routeExternalLink, safeLinkEnforced, LINK_HOST_MAX } = await import("../src/browserSafetyHelpers.ts");
const { domainToUnicode } = await import("node:url");

const minor = resolveBrowserSafety({ browser_session: { mode: "safe", allowlist: ["example.org"] } });
const adult = resolveBrowserSafety({ browser_session: { mode: "browse" } });
const unknown = resolveBrowserSafety(null);

// Minor cohort: the integrated (hardened) browser, never the system browser. A trusted list admits with no dialog.
assert.deepEqual(routeExternalLink("https://example.org/a?b=1", minor, { enforceAllowlist: true }), { kind: "integrated", url: "https://example.org/a?b=1" });
assert.deepEqual(routeExternalLink("https://not-allowlisted.example/", minor, { enforceAllowlist: true }), { kind: "confirm", url: "https://not-allowlisted.example/", host: "not-allowlisted.example", where: "integrated" },
  "outside the list: asks, and 열기 stays in Studio's browser");
assert.equal(routeExternalLink("https://example.org/a", minor).kind, "confirm", "an untrusted list (no minor flag): asks");

// Adult: the system browser with no dialog by default; the setting turns the confirm on. Unknown fails closed (safe).
assert.deepEqual(routeExternalLink("https://news.example.com/x", adult), { kind: "system", url: "https://news.example.com/x" });
assert.deepEqual(routeExternalLink("https://news.example.com/x", adult, { confirmAdult: true }), { kind: "confirm", url: "https://news.example.com/x", host: "news.example.com", where: "system" });
assert.equal(routeExternalLink("http://a.example/", unknown).kind, "system", "a resolved non-safe profile is an adult seat");
// A link from the preview (generated HTML) always asks, for every seat and setting.
assert.equal(routeExternalLink("https://news.example.com/x", adult, { source: "preview" }).kind, "confirm");
assert.equal(routeExternalLink("https://example.org/a", minor, { enforceAllowlist: true, source: "preview" }).kind, "confirm", "even an allowlisted link");
assert.equal(routeExternalLink("http://127.0.0.1:5500/", adult, { source: "preview" }).kind, "integrated", "the learner's own preview server stays dialog-free");
// Userinfo is stripped: the host shown and opened is the real one.
assert.deepEqual(routeExternalLink("https://google.com@evil.example/p", adult, { confirmAdult: true }), { kind: "confirm", url: "https://evil.example/p", host: "evil.example", where: "system" });

// No profile loaded (first load, refetch, token expiry): the persisted setting decides and
// an unknown value fails closed, so a minor never gets the adult path in that window.
for (const s of [linkSafety(null, true), linkSafety(null, undefined), linkSafety(undefined, "garbage")]) {
  const r = routeExternalLink("https://x.example/", s);
  assert.equal(r.kind, "confirm", "unknown fails closed to the minor rule"); assert.equal(r.where, "integrated");
}
assert.equal(routeExternalLink("https://x.example/", linkSafety(null, false)).kind, "system", "a known adult setting: the adult route");
// A loaded profile wins over a stale persisted value in both directions.
assert.equal(routeExternalLink("https://x.example/", linkSafety({ browser_session: { mode: "browse" } }, true)).kind, "system");
assert.equal(routeExternalLink("https://x.example/", linkSafety({ browser_session: { mode: "safe" } }, false)).kind, "confirm");

// Negative control: non-web schemes and junk are refused for everyone.
for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "vscode://x", "data:text/html,x", "blob:https://a.example/1", "about:blank", "mailto:a@b.example", "ftp://a.example/", "https://", "", 42, null, undefined]) {
  assert.deepEqual(routeExternalLink(bad, adult), { kind: "refuse" }, String(bad));
  assert.deepEqual(routeExternalLink(bad, minor), { kind: "refuse" }, String(bad));
}

// Wiring: every learner link path goes through openLearnerLink, and the system browser is reached only from openRoute,
// which runs for the route's own "system" kind or after the dialog's 열기.
const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const exits = src.match(/vscode\.env\.openExternal\(/g) ?? [];
assert.equal(exits.length, 1, "exactly one system-browser exit in chatPanelProvider");
assert.match(src, /private async openRoute\(where: "integrated" \| "system", url: string\)[\s\S]{0,400}vscode\.env\.openExternal\(vscode\.Uri\.parse\(url\)\)/, "that exit is openRoute");
assert.match(src, /if \(route\.kind === "integrated" \|\| route\.kind === "system"\) return this\.openRoute\(route\.kind, route\.url\);/, "no-dialog routes");
assert.match(src, /const choice = await this\.linkConfirmRequest\.confirm\(prompt\);\s*if \(choice === "open"\) return this\.openRoute\(route\.where, route\.url\);/, "the dialog's 열기");
assert.match(src, /case "openExternal":[\s\S]{0,400}this\.openLearnerLink\(msg\.url\)/, "citation chips use openLearnerLink");
assert.match(src, /else await this\.openLearnerLink\(url\)/, "inbox links use openLearnerLink");

// REQ-N11 (2026-11-05): learnerLinkPolicy = linkSafety + safeLinkEnforced over the loaded profile, else this seat's
// saved copy, else the REQ-N11 settings lock (2026-11-07), else the persisted settings (test/saved-link-safety-host.smoke.mjs
// and test/browser-settings-lock.smoke.mjs drive the real route).
assert.match(src, /const \{ safety, enforceAllowlist \} = learnerLinkPolicy\(\{ profile: profile \?\? this\.cachedProfile, saved, persistedSafeSession: lock\?\.safeSession \? true : browser\.get<boolean>\("safeSession"\), persistedAllowlist: lock \? lock\.allowlist : browser\.get<string\[\]>\("safeAllowlist"\), setting: vscode\.workspace\.getConfiguration\("hypeproofChat"\)\.get<boolean>\("safeLinkAllowlistEnabled"\) \}\);/, "the profile decides; the machine setting can only force it off");
assert.match(src, /return routeExternalLink\(raw, safety, \{ enforceAllowlist, confirmAdult, source \}\);/, "one route for every learner link");

// The webview never opens an external page itself: every anchor with target=_blank is gone
// from the chat UI, and the error-banner runbook link posts to the host.
const ui = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(ui, /target="_blank"/, "no raw new-window anchors in ChatPanel");
assert.match(ui, /postToHost\(\{ type: "openExternal", url: runbookUrl \}\)/, "runbook link goes through the host");

// ---- CGP-SHELL-R-026 (supersedes CGP-ART-D-008's block for this scope; Jay, 2026-11-14, #4090) ----
// The host line: ASCII, middle-ellipsized past 48 characters; IDN and mixed-script hosts are shown decoded and flagged.
{
  const shown = (h) => linkHostDisplay(h, domainToUnicode);
  assert.deepEqual(shown("news.example.com"), { ascii: "news.example.com", unicode: null, warning: false });
  const long = "a-very-long-subdomain-name-for-testing.another-long-label.example-host.co.kr";
  const cut = shown(long).ascii;
  assert.equal(cut.length, LINK_HOST_MAX, "long host capped at 48");
  assert.ok(cut.includes("…") && cut.indexOf("…") > 0 && !cut.endsWith("…"), "ellipsis in the middle");
  assert.ok(cut.endsWith(".co.kr"), "the registrable end stays visible");
  const exact = "x".repeat(44) + ".com";
  assert.equal(shown(exact).ascii, exact, "48 characters stay whole");
  // IDN: WHATWG gives punycode; the decoded form is shown beside it with the warning.
  const apple = new URL("https://аpple.com/").hostname; // Cyrillic а
  assert.ok(apple.startsWith("xn--"), "a Cyrillic look-alike is punycode in the URL");
  const idn = shown(apple);
  assert.equal(idn.ascii, apple); assert.equal(idn.unicode, "аpple.com"); assert.equal(idn.warning, true);
  assert.equal(shown(new URL("https://한국.example/").hostname).warning, true, "any IDN label warns");
  assert.equal(shown("paypal.com").warning, false, "plain ASCII: no warning (negative control)");
  // Through the route: the shown host is the punycode one, and userinfo never decides it.
  const r = routeExternalLink("https://user:pw@аpple.com/login", adult, { confirmAdult: true });
  assert.equal(r.host, apple); assert.equal(r.url, `https://${apple}/login`);
}
// The preview limiter: one open per 2 s.
{
  let t = 0; const lim = new LinkOpenLimiter(2000, () => t);
  assert.equal(lim.take(), true); t = 1999; assert.equal(lim.take(), false); t = 2000; assert.equal(lim.take(), true);
}
// No dialog for the learner's own loopback preview: the integrated browser, for every cohort.
for (const u of ["http://127.0.0.1:51884/index.html", "http://localhost:9000/", "http://[::1]:3000/", "http://2130706433/"]) {
  assert.equal(routeExternalLink(u, adult).kind, "integrated", u);
  assert.equal(routeExternalLink(u, minor, { enforceAllowlist: true }).kind, "integrated", u + " (minor)");
}
// Look-alikes are external: never the loopback shortcut.
for (const u of ["http://localhost.evil.com/", "http://127.0.0.1.nip.io/", "http://localhost@evil.com/"]) {
  assert.equal(routeExternalLink(u, adult, { confirmAdult: true }).kind, "confirm", u);
  assert.equal(routeExternalLink(u, minor, { enforceAllowlist: true }).kind, "confirm", u + " (minor)");
}
// Minor allowlist (trusted). Positive controls first: the list admits these with no dialog.
const safeList = resolveBrowserSafety({ browser_session: { mode: "safe", allowlist: ["example.org", "*.school.example", "https://docs.example.net/guide"] } });
for (const u of ["https://example.org/", "http://www.example.org/x", "https://a.b.school.example/", "https://docs.example.net/guide", "https://docs.example.net/guide/page"]) {
  assert.equal(routeExternalLink(u, safeList, { enforceAllowlist: true }).kind, "integrated", "admitted: " + u);
}
// Negative controls: suffix tricks, other origin, path prefix without a segment boundary, userinfo. They ask, never block.
for (const u of ["https://evilexample.org/", "https://example.org.evil.com/", "https://docs.example.net/guidebook", "http://docs.example.net/guide", "https://docs.example.net/", "https://example.org@evil.com/", "https://games.example.com/"]) {
  const r = routeExternalLink(u, safeList, { enforceAllowlist: true });
  assert.equal(r.kind, "confirm", "asks: " + u);
  assert.equal(r.where, "integrated");
  assert.equal(r.host, new URL(u).hostname);
}
assert.equal(routeExternalLink("https://EXAMPLE.ORG./x", safeList, { enforceAllowlist: true }).kind, "integrated", "trailing dot and case");
// The list is trusted only with enforceAllowlist: otherwise every link asks.
assert.equal(routeExternalLink("https://example.org/", safeList).kind, "confirm", "untrusted list: asks");
// Empty list or no profile: asks for every external link (it used to block every one with the flag on).
assert.equal(routeExternalLink("https://example.org/", resolveBrowserSafety({ browser_session: { mode: "safe" } }), { enforceAllowlist: true }).kind, "confirm");
assert.equal(routeExternalLink("https://example.org/", linkSafety(null, undefined, ["example.org"]), { enforceAllowlist: true }).kind, "integrated");
assert.equal(routeExternalLink("https://example.org/", linkSafety(null, undefined, "garbage"), { enforceAllowlist: true }).kind, "confirm");
// Adults never see the allowlist.
assert.equal(routeExternalLink("https://games.example.com/", adult, { enforceAllowlist: true }).kind, "system");
// Malformed entries only narrow.
assert.equal(hostAllowed(new URL("https://example.org/"), ["", "   ", "https://", "exa mple.org", "/example.org", 42]), false);

// 2026-11-04 (Jay) — the allowlist is trusted only for a seat the served profile marks minor (`minor_cohort: true`) in
// the safe session with a usable list; `false` in the machine setting stops trusting it (support; CGP-SHELL-R-026:
// then every external link asks).
{
  const kid = { minor_cohort: true, browser_session: { mode: "safe", allowlist: ["https://hypeproof-ai.xyz/live/x/gallery"] } };
  const kidEmpty = { minor_cohort: true, browser_session: { mode: "safe", allowlist: [] } };
  const kidNoFlag = { browser_session: { mode: "safe", allowlist: ["example.org"] } };
  const grown = { minor_cohort: false, browser_session: { mode: "browse", allowlist: ["example.org"] } };
  const on = (p, setting) => safeLinkEnforced(p, linkSafety(p, undefined, undefined), setting);
  assert.equal(on(kid, undefined), true, "minor + list: trusted by default");
  assert.equal(on(kid, true), true);
  assert.equal(on(kid, false), false, "machine setting false: not trusted");
  assert.equal(on(kidEmpty, undefined), false, "an empty served list is nothing to trust");
  assert.equal(on({ ...kid, browser_session: { mode: "safe", allowlist: ["https://", "exa mple.org", "/x"] } }, undefined), false, "only malformed entries count as empty");
  assert.equal(on({ ...kid, browser_session: { mode: "safe", allowlist: ["https://", "example.org"] } }, undefined), true, "one usable entry is enough");
  assert.equal(on(kidNoFlag, undefined), false, "the profile must mark the seat minor");
  assert.equal(on(grown, undefined), false, "adults: never");
  assert.equal(on({ minor_cohort: true, browser_session: { mode: "browse", allowlist: ["example.org"] } }, undefined), false, "no safe session: unchanged");
  assert.equal(safeLinkEnforced(null, linkSafety(null, true, ["example.org"]), undefined), true);
  assert.equal(safeLinkEnforced(null, linkSafety(null, undefined, []), undefined), false);
  assert.equal(safeLinkEnforced(null, linkSafety(null, false, ["example.org"]), undefined), false, "a known adult setting");
  assert.equal(safeLinkEnforced(null, linkSafety(null, true, ["example.org"]), false), false, "override wins without a profile too");
  // End to end: the kid's own gallery opens, a search citation asks; with the override both ask; an adult opens directly.
  const route = (p, u, setting, extra = {}) => { const s = linkSafety(p, undefined, undefined); return routeExternalLink(u, s, { enforceAllowlist: safeLinkEnforced(p, s, setting), ...extra }).kind; };
  assert.equal(route(kid, "https://hypeproof-ai.xyz/live/x/gallery/abc?room=1"), "integrated");
  assert.equal(route(kid, "https://news.example.com/story"), "confirm");
  assert.equal(route(kid, "https://hypeproof-ai.xyz/live/x/gallery/abc", false), "confirm", "override: confirm everything");
  assert.equal(route(kidEmpty, "https://news.example.com/story"), "confirm", "empty list: asks, not block-all and not open");
  assert.equal(route(grown, "https://news.example.com/story"), "system");
  assert.equal(route(grown, "https://news.example.com/story", undefined, { confirmAdult: true }), "confirm");
}

// Wiring: no blocked notice any more; the settings are registered as decided.
assert.doesNotMatch(src, /externalLinkBlocked/, "the CGP-ART-D-008 notice is gone");
assert.doesNotMatch(src, /showWarningMessage\([^)]*바깥 사이트/, "no native modal for links (it cannot default to 취소)");
assert.match(src, /linkHostDisplay\(route\.host, domainToUnicode\)/, "the dialog's host is built from the punycode host");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const prop = (k) => pkg.contributes.configuration.properties?.[k] ?? [].concat(pkg.contributes.configuration).map((c) => c.properties?.[k]).find(Boolean);
const flag = prop("hypeproofChat.safeLinkAllowlistEnabled");
assert.equal(flag?.default, true, "default: the served profile decides (2026-11-04, Jay); false is the support override");
assert.equal(flag?.scope, "machine", "flag machine-scoped");
const adultSetting = prop("hypeproofChat.confirmExternalLinks");
assert.equal(adultSetting?.default, false, "adults: off by default (Jay, 2026-11-14)");
assert.equal(adultSetting?.type, "boolean");
assert.doesNotMatch(ui, /externalLinkBlocked|ExternalLinkBlocked/, "the panel no longer draws the blocked notice");

console.log("external-link-route smoke OK");
