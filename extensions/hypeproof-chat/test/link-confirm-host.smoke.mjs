// CGP-SHELL-R-026 (REQ-SHELL-26) — the host side of the external link confirm: the request primitive, the browser-panel
// navigation guard over a fake CDP session, and the real ChatPanelProvider (bundled with a scripted `vscode`) for the
// three entry points. The host is the boundary for the preview: a message in the relay's shape posted straight to the
// host (no click, so the page's isTrusted check never ran) still gets the confirm dialog and the 2 s rate limit.
//   node --experimental-strip-types test/link-confirm-host.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

const { LinkConfirmRequest } = await import("../src/linkConfirm.ts");
const { LinkNavigationGuard } = await import("../src/linkNavigationGuard.ts");
const tick = () => new Promise((r) => setTimeout(r, 0));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---- LinkConfirmRequest ----
{
  let scope = "a"; const shown = [];
  const req = new LinkConfirmRequest({ scope: () => scope, present: async (p) => { shown.push(p); return true; } }, 50);
  const prompt = { id: "p1", host: "news.example.com", unicodeHost: null, warning: false, url: "https://news.example.com/", where: "system", source: "chat" };
  const first = req.confirm(prompt);
  ok((await req.confirm({ ...prompt, id: "p2" })) === "cancel", "a second prompt while one is open is cancelled");
  req.respond("p1", "open"); ok((await first) === "open", "the answer resolves the prompt");
  ok(shown.at(-1) === null, "the dialog is closed after the answer");
  const late = req.confirm({ ...prompt, id: "p3" }); scope = "b"; req.respond("p3", "open");
  ok((await late) === "cancel", "a seat change cancels instead of opening");
  scope = "a";
  ok((await req.confirm({ ...prompt, id: "p4" })) === "cancel", "a timeout cancels");
  const hidden = new LinkConfirmRequest({ scope: () => "a", present: async () => false });
  ok((await hidden.confirm({ ...prompt, id: "p5" })) === "cancel", "a chat that cannot draw the dialog: nothing opens");
  const odd = req.confirm({ ...prompt, id: "p6" }); req.respond("p6", "maybe"); req.respond("other", "open");
  req.respond("p6", "copy"); ok((await odd) === "copy", "unknown ids and choices are ignored");
}

// ---- LinkNavigationGuard over a fake CDP session ----
{
  const sent = []; let listener;
  const cdp = { send: async (method, params) => { sent.push([method, params]); if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: "https://school.example/lesson" } } }; return {}; },
    onEvent: (l) => { listener = l; return { dispose() {} }; } };
  const asked = []; let answer = false;
  const guard = new LinkNavigationGuard(cdp, async (url) => { asked.push(url); return answer; });
  await guard.start();
  ok(sent.some(([m, p]) => m === "Fetch.enable" && p.patterns[0].resourceType === "Document"), "main-frame documents are paused");
  const paused = (id, url, frameId = "main") => listener({ method: "Fetch.requestPaused", params: { requestId: id, request: { url }, resourceType: "Document", frameId } });
  const asks = (url, frameId = "main") => listener({ method: "Page.frameRequestedNavigation", params: { frameId, url } });
  const last = () => sent.at(-1);
  // A link to another site: held, the dialog decides.
  asks("https://news.example.com/story#top"); paused("r1", "https://news.example.com/story"); await tick();
  ok(asked.at(-1) === "https://news.example.com/story" && last()[0] === "Fetch.failRequest", "취소: the navigation is aborted");
  answer = true; asks("https://news.example.com/story"); paused("r2", "https://news.example.com/story"); await tick();
  ok(last()[0] === "Fetch.continueRequest" && last()[1].requestId === "r2", "열기: it goes on in the tab");
  // Negative controls: not page-requested (address bar, Studio, the coach), same origin, a subframe.
  const n = asked.length;
  paused("r3", "https://elsewhere.example/"); await tick();
  asks("https://school.example/next"); paused("r4", "https://school.example/next"); await tick();
  asks("https://ads.example/", "child"); paused("r5", "https://ads.example/", "child"); await tick();
  ok(asked.length === n && sent.filter(([m]) => m === "Fetch.continueRequest").length === 4, "only page-requested cross-site main-frame navigations ask");
  // The page moved: same-origin is judged against the new page.
  listener({ method: "Page.frameNavigated", params: { frame: { id: "main", url: "https://news.example.com/story" } } });
  asks("https://school.example/back"); paused("r6", "https://school.example/back"); await tick();
  ok(asked.at(-1) === "https://school.example/back", "leaving the new site asks again");
  guard.dispose();
}

// ---- The real provider ----
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
const settings = { "hypeproof.browser": {}, hypeproofChat: {} };
const posted = [], opened = [], copied = [], infos = [];
let tabOpened = null;
const vscode = {
  env: { appName: "HypeProof Studio", openExternal: async (u) => { opened.push(["system", String(u)]); return true; }, clipboard: { writeText: async (t) => { copied.push(t); } } },
  Uri: { parse: (s) => s }, ViewColumn: { Beside: -2 }, ConfigurationTarget: { Global: 1 },
  commands: { executeCommand: async () => undefined },
  window: { openBrowserTab: async (url) => opened.push(["integrated", url]), showInformationMessage: async (m) => { infos.push(m); }, showWarningMessage: async () => { throw new Error("no native modal"); },
    browserTabs: [], onDidOpenBrowserTab: (l) => { tabOpened = l; return { dispose() {} }; }, onDidCloseBrowserTab: () => ({ dispose() {} }) },
  workspace: { getConfiguration: (section) => ({ get: (key, fallback) => (settings[section]?.[key] ?? fallback), update: async () => {} }) },
};
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout,
  setInterval, clearInterval, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, Response, structuredClone,
  fetch: async () => new Response("{}", { status: 503 }),
});
const proto = mod.exports.ChatPanelProvider.prototype;
function host(profile, view = { visible: true }) {
  const h = Object.create(proto);
  const fields = {
    context: { secrets: { get: async () => undefined }, globalState: { get: (k, d) => d, update: async () => {} }, workspaceState: { get: () => undefined } },
    cachedProfile: profile, profileGeneration: 0, view, post: async (m) => { posted.push(m); return true; },
    _instructorMode: { isInstructor: false, reset() {} },
  };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(h, key, { value, writable: true, configurable: true });
  return h;
}
const kid = { minor_cohort: true, browser_session: { mode: "safe", allowlist: ["https://hypeproof-ai.xyz/live/x/gallery"] } };
const grown = { minor_cohort: false, browser_session: { mode: "browse" } };
const promptOf = () => posted.filter((m) => m.type === "linkConfirmPrompt" && m.prompt).at(-1)?.prompt;
const answer = async (h, run, choice) => { posted.length = 0; const p = run(); await tick(); const pr = promptOf(); if (pr) h.linkConfirmRequest.respond(pr.id, choice); return { outcome: await p, prompt: pr }; };
const reset = () => { posted.length = 0; opened.length = 0; copied.length = 0; infos.length = 0; };

// 1. Chat links: a minor asks outside the list and stays in Studio's browser; the list and loopback open directly.
{
  reset(); const h = host(kid);
  let r = await answer(h, () => h.openLearnerLink("https://news.example.com/story"), "open");
  ok(r.prompt?.host === "news.example.com" && r.prompt.where === "integrated" && r.prompt.source === "chat", "minor: the dialog, opening in Studio's browser");
  ok(r.outcome === "opened" && JSON.stringify(opened) === JSON.stringify([["integrated", "https://news.example.com/story"]]), "열기 opens it there");
  reset(); r = await answer(h, () => h.openLearnerLink("https://news.example.com/story"), "cancel");
  ok(r.outcome === "cancelled" && opened.length === 0, "취소 opens nothing");
  reset(); r = await answer(h, () => h.openLearnerLink("https://news.example.com/story"), "copy");
  ok(r.outcome === "copied" && opened.length === 0 && copied[0] === "https://news.example.com/story", "링크 복사 copies and opens nothing");
  reset(); ok((await h.openLearnerLink("https://hypeproof-ai.xyz/live/x/gallery/a")) === "opened" && !promptOf(), "the lesson allowlist opens with no dialog");
  reset(); ok((await h.openLearnerLink("javascript:alert(1)")) === "refused" && opened.length === 0 && !promptOf(), "javascript: is refused with no dialog");
}
// 2. Adults: no dialog by default; the setting turns it on.
{
  reset(); const h = host(grown);
  ok((await h.openLearnerLink("https://news.example.com/")) === "opened" && opened[0][0] === "system" && !promptOf(), "adult: the system browser, no dialog");
  settings.hypeproofChat = { confirmExternalLinks: true };
  reset(); const r = await answer(h, () => h.openLearnerLink("https://news.example.com/"), "open");
  ok(r.prompt?.where === "system" && opened[0][0] === "system", "with the setting: asks, then the system browser");
  settings.hypeproofChat = {};
}
// 3. Preview: the relay message shape sent straight to the host (no click, isTrusted never checked) still asks, for an
//    adult with the setting off, and a second open within 2 s is refused without a dialog.
{
  reset(); const h = host(grown);
  let r = await answer(h, () => h.openLearnerLink("https://phish.example/login", "preview"), "cancel");
  ok(r.prompt?.source === "preview" && r.outcome === "cancelled" && opened.length === 0, "a preview link asks even for an adult with the confirm off");
  reset();
  ok((await h.openLearnerLink("https://phish.example/login", "preview")) === "refused" && !promptOf(), "a second preview open within 2 s: refused, no dialog");
  // The limiter is the preview's only: a chat link right after is unaffected.
  ok((await h.openLearnerLink("https://news.example.com/")) === "opened", "chat links are not rate-limited");
  h.previewLinkLimiterInstance.last -= 2001;
  reset(); r = await answer(h, () => h.openLearnerLink("https://phish.example/login", "preview"), "open");
  ok(r.prompt && r.outcome === "opened" && opened[0][0] === "system", "after 2 s the preview may ask again");
}
// 4. Browser panel: page-requested navigation to another site.
{
  reset(); const h = host(kid);
  const p = h.confirmBrowserNavigation("https://news.example.com/"); await tick();
  ok(promptOf()?.source === "browser", "the browser panel uses the same dialog"); h.linkConfirmRequest.respond(promptOf().id, "open");
  ok((await p) === true, "열기 lets it go on");
  ok((await h.confirmBrowserNavigation("https://hypeproof-ai.xyz/live/x/gallery/b")) === true, "allowlisted: no dialog");
  const adult = host(grown);
  ok((await adult.confirmBrowserNavigation("https://news.example.com/")) === true, "adult without the setting: no dialog");
}
// 5. Fail closed: no chat to draw the dialog in.
{
  reset(); const h = host(kid, { visible: false });
  ok((await h.openLearnerLink("https://news.example.com/")) === "cancelled" && opened.length === 0, "no visible chat: nothing opens");
  ok(infos.length === 1, "and the learner is told to open the chat");
}
// 6. Chalk runtime links go through the same exit.
{
  reset(); const h = host(kid);
  const p = h.chalkOps().openExternal("https://news.example.com/"); await tick();
  h.linkConfirmRequest.respond(promptOf().id, "cancel");
  ok(JSON.stringify(await p) === JSON.stringify({ ok: false, reason: "cancelled" }), "Chalk: 취소 is not ok");
}

// 7. The nonce: only the answer to the open prompt's own id opens; a forged or replayed id opens nothing.
{
  reset(); const h = host(kid);
  const p1 = h.openLearnerLink("https://news.example.com/a"); await tick();
  const first = promptOf();
  ok(/^[0-9a-f-]{36}$/.test(first.id), "the prompt id is a random UUID nonce");
  h.linkConfirmRequest.respond("forged-id", "open");
  h.linkConfirmRequest.respond(first.id.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "open");
  ok(opened.length === 0 && h.linkConfirmRequest.open, "a forged id opens nothing and the prompt stays open");
  h.linkConfirmRequest.respond(first.id, "cancel"); await p1;
  const p2 = h.openLearnerLink("https://news.example.com/b"); await tick();
  h.linkConfirmRequest.respond(first.id, "open");
  ok(opened.length === 0 && h.linkConfirmRequest.open, "a replayed id (the last prompt's) opens nothing");
  h.linkConfirmRequest.respond(promptOf().id, "cancel"); await p2;
}
// 8. A second request while the dialog is open is refused, with a line; the open dialog stays as it was.
{
  reset(); const h = host(kid);
  const p1 = h.openLearnerLink("https://news.example.com/a"); await tick();
  const first = promptOf();
  ok((await h.openLearnerLink("https://other.example/b")) === "refused", "the second link is refused");
  ok(infos.at(-1) === "먼저 열린 링크 확인 창에 답해 주세요." && promptOf().id === first.id && h.linkConfirmRequest.open, "it says so, and the first prompt is not replaced");
  ok((await h.confirmBrowserNavigation("https://other.example/c")) === false, "a held browser navigation is refused too");
  h.linkConfirmRequest.respond(first.id, "open");
  ok((await p1) === "opened" && opened.length === 1 && opened[0][1] === "https://news.example.com/a", "the first link opens on its own 열기");
}
// 9. Minor seats fail closed on the ways round the guard: a tab a page opened, and a page that moved before attach.
{
  const raw = (current) => {
    const listeners = new Set();
    return { onDidReceiveMessage: (l) => { listeners.add(l); return { dispose: () => listeners.delete(l) }; }, onDidClose: () => ({ dispose() {} }), close: async () => {},
      sendMessage: async (m) => { const reply = (result) => queueMicrotask(() => { for (const l of [...listeners]) l({ id: m.id, result }); });
        if (m.method === "Target.getTargets") reply({ targetInfos: [{ type: "page", targetId: "t1" }] });
        else if (m.method === "Target.attachToTarget") reply({ sessionId: "s1" });
        else if (m.method === "Page.getFrameTree") reply({ frameTree: { frame: { id: "main", url: current } } });
        else reply({}); } };
  };
  const tab = (url, current = url) => { const t = { url, closed: 0, close: async () => { t.closed++; }, startCDPSession: async () => raw(current) }; return t; };
  reset(); const h = host(kid);
  h.registerBrowserLinkGuards({ subscriptions: [] });
  // A page-opened tab (Studio never opened this address): closed, and its address asks.
  const popup = tab("https://ads.example/win");
  tabOpened(popup); await tick(); await tick();
  ok(popup.closed === 1, "a tab a page opened is closed on a minor seat");
  ok(promptOf()?.url === "https://ads.example/win" && promptOf().source === "browser", "its address goes through the dialog");
  h.linkConfirmRequest.respond(promptOf().id, "open"); await tick(); await tick();
  ok(opened.at(-1)?.[1] === "https://ads.example/win", "열기 reopens it as a Studio tab");
  // A tab Studio opened (it went through openStudioTab) is kept.
  const reopenedUrl = opened.at(-1)[1];
  reset();
  const mine = tab(reopenedUrl);
  tabOpened(mine); await tick(); await tick(); await tick();
  ok(mine.closed === 0 && !promptOf(), "a tab Studio opened is not touched");
  // A Studio tab whose page moved to another site before the guard attached: closed, and the new address asks.
  reset();
  const moved = tab("https://ads.example/win", "https://phish.example/now");
  tabOpened(moved); await new Promise((r) => setTimeout(r, 30));
  ok(moved.closed === 1 && promptOf()?.url === "https://phish.example/now", "a move before the guard attached is caught after attach");
  h.linkConfirmRequest.respond(promptOf().id, "cancel"); await tick();
  // Adults: a known gap, left as it was (no close, no dialog).
  reset(); const a = host(grown); a.registerBrowserLinkGuards({ subscriptions: [] });
  const adultPopup = tab("https://ads.example/x");
  tabOpened(adultPopup); await tick(); await tick();
  ok(adultPopup.closed === 0 && !promptOf(), "adult seats: page-opened tabs are not held (recorded as a known gap)");
}

// 10. Fail closed on a session that does not behave like Chromium (coordinator): a minor tab whose session rejects
//     Target.setAutoAttach (and, second, Fetch.enable too) falls back to the allowlist block — refuse, never confirm.
{
  const fake = (current, reject) => {
    const listeners = new Set(); const sent = [];
    const raw = { onDidReceiveMessage: (l) => { listeners.add(l); return { dispose: () => listeners.delete(l) }; }, onDidClose: () => ({ dispose() {} }), close: async () => {},
      sendMessage: async (m) => { sent.push(m.method); const reply = (msg) => queueMicrotask(() => { for (const l of [...listeners]) l({ id: m.id, ...msg }); });
        if (reject.includes(m.method)) reply({ error: { message: `'${m.method}' wasn't found` } });
        else if (m.method === "Target.getTargets") reply({ result: { targetInfos: [{ type: "page", targetId: "t1" }] } });
        else if (m.method === "Target.attachToTarget") reply({ result: { sessionId: "s1" } });
        else if (m.method === "Page.getFrameTree") reply({ result: { frameTree: { frame: { id: "main", url: current } } } });
        else reply({ result: {} }); } };
    const emit = (method, params) => { for (const l of [...listeners]) l({ method, params, sessionId: "s1" }); };
    return { raw, emit, sent };
  };
  const mk = (url, reject) => { const f = fake(url, reject); const t = { url, closed: 0, close: async () => { t.closed++; }, startCDPSession: async () => f.raw }; return { t, f }; };
  const settleLong = () => new Promise((r) => setTimeout(r, 40));
  // (a) setAutoAttach rejected, Fetch works: a page-requested cross-site move is failed with no dialog.
  reset(); const h = host(kid); h.registerBrowserLinkGuards({ subscriptions: [] });
  await h.openLearnerLink("https://hypeproof-ai.xyz/live/x/gallery/start"); // a Studio tab, allowlisted
  const a = mk("https://hypeproof-ai.xyz/live/x/gallery/start", ["Target.setAutoAttach"]);
  tabOpened(a.t); await settleLong();
  posted.length = 0;
  a.f.emit("Page.frameRequestedNavigation", { frameId: "main", url: "https://news.example.com/x" });
  a.f.emit("Fetch.requestPaused", { requestId: "q1", request: { url: "https://news.example.com/x" }, resourceType: "Document", frameId: "main" });
  await settleLong();
  ok(a.f.sent.includes("Fetch.failRequest") && !a.f.sent.includes("Fetch.continueRequest"), "no paused popups: a cross-site move is refused at the network layer");
  ok(!promptOf(), "and no confirm is shown (the allowlist block, not the dialog)");
  a.f.emit("Fetch.requestPaused", { requestId: "q2", request: { url: "https://hypeproof-ai.xyz/live/x/gallery/next" }, resourceType: "Document", frameId: "main" });
  await settleLong();
  ok(a.f.sent.includes("Fetch.continueRequest"), "positive control: a same-site move still goes on");
  // (b) Fetch.enable rejected too: nothing can be held, so a committed move off the list closes the tab.
  const b2 = mk("https://hypeproof-ai.xyz/live/x/gallery/start", ["Target.setAutoAttach", "Fetch.enable"]);
  tabOpened(b2.t); await settleLong();
  ok(b2.t.closed === 0, "the tab on the list stays open");
  b2.f.emit("Page.frameNavigated", { frame: { id: "main", url: "https://news.example.com/y" } });
  await settleLong();
  ok(b2.t.closed === 1 && infos.some((m) => m.includes("허용 목록 밖")), "without the network hold a move off the list closes the tab and says why");
  // Adults are not put in the fallback.
  reset(); const ad = host(grown); ad.registerBrowserLinkGuards({ subscriptions: [] });
  await ad.openLearnerLink("https://news.example.com/start");
  const c = mk("https://news.example.com/start", ["Target.setAutoAttach", "Fetch.enable"]);
  tabOpened(c.t); await settleLong();
  c.f.emit("Page.frameNavigated", { frame: { id: "main", url: "https://other.example/z" } }); await settleLong();
  ok(c.t.closed === 0, "adult seats keep today's behaviour (negative control)");
}

// 11. verify-r026 F3/F4: the minor flag reaches the guard (M4a), the page-opened-tab close needs no CDP (M4b), the
//     no-Page and no-CDP closes, and a stopped form says why.
{
  const fake = (current, reject = []) => {
    const listeners = new Set(); const sent = [];
    const raw = { onDidReceiveMessage: (l) => { listeners.add(l); return { dispose: () => listeners.delete(l) }; }, onDidClose: () => ({ dispose() {} }), close: async () => {},
      sendMessage: async (m) => { sent.push(m.method); const reply = (msg) => queueMicrotask(() => { for (const l of [...listeners]) l({ id: m.id, ...msg }); });
        if (reject.includes(m.method)) reply({ error: { message: `'${m.method}' wasn't found` } });
        else if (m.method === "Target.getTargets") reply({ result: { targetInfos: [{ type: "page", targetId: "t1" }] } });
        else if (m.method === "Target.attachToTarget") reply({ result: { sessionId: "s1" } });
        else if (m.method === "Page.getFrameTree") reply({ result: { frameTree: { frame: { id: "main", url: current } } } });
        else reply({ result: {} }); } };
    const emit = (method, params) => { for (const l of [...listeners]) l({ method, params, sessionId: "s1" }); };
    return { raw, emit, sent };
  };
  const mk = (url, reject, noCdp = false) => {
    const f = fake(url, reject);
    const t = { url, closed: 0, attaches: 0, close: async () => { t.closed++; }, startCDPSession: async () => { t.attaches++; if (noCdp) throw new Error("no CDP"); return f.raw; } };
    return { t, f };
  };
  const settleLong = () => new Promise((r) => setTimeout(r, 40));
  const LIST = "https://hypeproof-ai.xyz/live/x/gallery/start";
  const blockedLine = "이 창에서는 수업 허용 목록 밖의 사이트를 열 수 없어요. 선생님께 알려 주세요.";
  // Studio opens an address on a minor seat: through the dialog when it is off the list.
  const studioOpen = async (h, url) => { const p = h.openLearnerLink(url); await tick(); if (promptOf()) h.linkConfirmRequest.respond(promptOf().id, "open"); await p; };

  // M4a: on a minor seat the guard replaces the page's popup paths (the binding and the script before the page runs).
  reset(); const h = host(kid); h.registerBrowserLinkGuards({ subscriptions: [] });
  await studioOpen(h, LIST);
  const m = mk(LIST); tabOpened(m.t); await settleLong();
  ok(m.f.sent.includes("Runtime.addBinding") && m.f.sent.includes("Page.addScriptToEvaluateOnNewDocument"), "minor seat: the guard installs the popup replacement (layer 1)");
  // M4b: a tab a page opened is closed before any CDP session is made (the backstop does not lean on the guard).
  // (A host no earlier case opened: the ledger also admits other pages of a site Studio opened in the last 30 s.)
  reset();
  const pageOpened = mk("https://popups.example/pop"); tabOpened(pageOpened.t); await settleLong();
  ok(pageOpened.t.closed === 1 && pageOpened.t.attaches === 0, "minor seat: a page-opened tab is closed without attaching");
  ok(promptOf()?.url === "https://popups.example/pop", "and its address goes through the dialog");
  h.linkConfirmRequest.respond(promptOf().id, "cancel"); await tick();
  // No Page domain: a Studio tab off the list cannot be watched, so it is closed and says why; one on the list stays.
  reset();
  await studioOpen(h, "https://news.example.com/s");
  const noPage = mk("https://news.example.com/s", ["Page.enable"]); tabOpened(noPage.t); await settleLong();
  ok(noPage.t.closed === 1 && infos.includes(blockedLine), "no Page domain: an off-list tab is closed with the blocked line");
  reset();
  const noPageOk = mk(LIST, ["Page.enable"]); tabOpened(noPageOk.t); await settleLong();
  ok(noPageOk.t.closed === 0, "no Page domain: a tab on the list stays open (positive control)");
  // No CDP session at all: an off-list tab is closed; a tab on the list stays.
  reset();
  await studioOpen(h, "https://news.example.com/t");
  const noCdp = mk("https://news.example.com/t", [], true); tabOpened(noCdp.t); await settleLong();
  ok(noCdp.t.closed === 1, "no CDP session: an off-list tab is closed");
  reset();
  const noCdpOk = mk(LIST, [], true); tabOpened(noCdpOk.t); await settleLong();
  ok(noCdpOk.t.closed === 0, "no CDP session: a tab on the list stays open (positive control)");
  // F4: a form aimed at another window was stopped in the page. Off the list it says so; on the list it is silent.
  reset();
  const formTab = mk(LIST); tabOpened(formTab.t); await settleLong();
  const bind = (k, u) => formTab.f.emit("Runtime.bindingCalled", { name: "__hpsOpenLink", payload: JSON.stringify({ k, u }) });
  infos.length = 0;
  bind("form", "https://hypeproof-ai.xyz/live/x/gallery/submit"); await settleLong();
  ok(!infos.length && !promptOf(), "a stopped form on the list: no line, no dialog");
  // verify-r027 on #4182: the cap counts only the lines the learner is shown, so a silent on-list stop does not hide
  // an off-list one a second later.
  await new Promise((r) => setTimeout(r, 1000));
  bind("form", "https://forms.example/post"); await settleLong();
  ok(infos.filter((x) => x === blockedLine).length === 1 && !promptOf(), "a stopped form off the list 1 s after an on-list one: the blocked line, no dialog (F4)");
  bind("form", "https://forms.example/post"); await settleLong();
  ok(infos.filter((x) => x === blockedLine).length === 1, "a second stop within the window adds no line (rate limit)");
  // The host caps the lines it shows (verify-r027 on #4187): a page cycling action origins inside 3 s gets one line,
  // although the guard reports each origin.
  await new Promise((r) => setTimeout(r, 3100));
  const before = infos.filter((x) => x === blockedLine).length;
  for (let i = 0; i < 5; i++) bind("form", `https://forms${i}.example/post`);
  await settleLong();
  ok(infos.filter((x) => x === blockedLine).length === before + 1, "five off-list origins inside 3 s: one line");
  formTab.f.emit("Runtime.bindingCalled", { name: "__hpsOpenLink", payload: "https://ads.example/raw" }); await settleLong();
  ok(!promptOf(), "a payload that is not the guard's JSON does nothing");
  // Adults: no replacement is installed (negative control for M4a).
  reset(); const ad = host(grown); ad.registerBrowserLinkGuards({ subscriptions: [] });
  await ad.openLearnerLink("https://news.example.com/start");
  const adult = mk("https://news.example.com/start"); tabOpened(adult.t); await settleLong();
  ok(!adult.f.sent.includes("Runtime.addBinding"), "adult seat: no popup replacement (negative control)");
}

// Wiring: the preview forwards only a bounded http(s) string, and extension.ts routes it as a preview link.
const preview = readFileSync(new URL("../src/previewProvider.ts", import.meta.url), "utf8");
ok(/msg\?\.type === "preview_open_link"\) \{\s*if \(typeof msg\.href === "string" && msg\.href\.length <= 4096 && \/\^https\?:/.test(preview), "the panel forwards only bounded http(s) strings");
ok(/injectInnerCsp\(injectLinkRelay\(baseAware\)/.test(preview), "every rendered page carries the relay");
const ext = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");
ok(/preview\.onOpenLink\(\(href\) => void provider\.openLearnerLink\(href, "preview"\)\)/.test(ext), "extension.ts routes it as a preview link");
console.log(`PASS link confirm host: ${checks} checks (request, browser-panel guard, chat/adult/preview/browser/fail-closed/Chalk)`);
