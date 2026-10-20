// REQ-L13 ⑧ (CGP-SHELL-R-022, DES-SHELL-21): the sign-in screen's 링크 복사, rendered.
// The button appears only while a sign-in waits with a copyable link, it posts an intent and
// carries no URL itself, the result line is a live status region, and the CSS gives a 44px
// target, ≥14px text and a forced-colors boundary. Bundled with esbuild, run with plain Node.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AccountEntry } from "../webview-ui/src/AccountEntry";
import { SIGN_IN_LINK_COPY } from "../src/signInLink";
import type { AccountView } from "../src/accountSession";

let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const LINK = "https://hypeproof-ai.xyz/studio/connect?code=HPDX-4K7Q";
const waiting = (extra: Partial<AccountView> = {}): AccountView => ({ status: "waiting", userCode: "HPDX-4K7Q", expiresAt: 0, message: "브라우저에서 Google 로그인 후 이 Studio 연결을 승인해 주세요.", ...extra });
const render = (account: AccountView, posted: unknown[] = []) => renderToStaticMarkup(<AccountEntry account={account} checking={false} post={(m) => posted.push(m)} />);
const button = /<button[^>]*class="[^"]*studio-signin-copy[^"]*"[^>]*>([\s\S]*?)<\/button>/;

t("waiting with a link: 링크 복사 under the reopen button, user code still shown", () => {
  const html = render(waiting({ link: "ready" }));
  const m = button.exec(html); ok(m, "no 링크 복사 button");
  ok(m![1].includes("링크 복사"), "label is 링크 복사");
  ok(html.indexOf("로그인 창 다시 열기") < html.indexOf("링크 복사"), "copy sits after the reopen action");
  ok(html.includes("HPDX-4K7Q"), "the user code stays on screen");
  ok(!html.includes("studio/connect"), "the URL itself is not in the page before a failure");
  // Device-code phishing (REQ-L13 ⑧): the hint says the link is for the learner's own browser or device only.
  ok(SIGN_IN_LINK_COPY.hint === "내 다른 브라우저나 기기에서만 여세요. 이 링크를 다른 사람에게 보내지 마세요.", `hint is ${SIGN_IN_LINK_COPY.hint}`);
  ok(html.includes(`class="studio-signin-copy-hint">${SIGN_IN_LINK_COPY.hint}<`), "the hint is rendered");
});
t("negative control: no link, no button (waiting, signed out, signed in)", () => {
  ok(!button.test(render(waiting())), "waiting without a link drew a button");
  ok(!button.test(render({ status: "signedOut" })), "signed out drew a button");
  ok(!button.test(render({ status: "signedIn", account: { id: "a", email: "a@example.test", display_name: "A" }, passes: [] })), "signed in drew a button");
});
t("copied: the confirmation is a live status line", () => {
  const html = render(waiting({ link: "copied" }));
  ok(new RegExp(`<p[^>]*class="studio-signin-copy-status"[^>]*role="status"[^>]*>${SIGN_IN_LINK_COPY.copied}`).test(html) || new RegExp(`<p[^>]*role="status"[^>]*class="studio-signin-copy-status"[^>]*>${SIGN_IN_LINK_COPY.copied}`).test(html), "copied confirmation missing or not role=status");
  ok(SIGN_IN_LINK_COPY.copied.includes("복사했어요"), "confirmation says it copied");
});
t("failed: says it could not copy and shows the link to type", () => {
  const html = render(waiting({ link: "failed", linkText: LINK }));
  ok(html.includes(SIGN_IN_LINK_COPY.failed), "honest failure line missing");
  ok(!html.includes(SIGN_IN_LINK_COPY.copied), "a failure must not claim a copy");
  ok(html.includes(`>${LINK.replace(/&/g, "&amp;")}<`), "the link is shown for manual entry");
});
t("negative control: ready has an empty live region, no claim of a copy", () => {
  const html = render(waiting({ link: "ready" }));
  ok(/class="studio-signin-copy-status"[^>]*role="status"[^>]*><\/p>|role="status"[^>]*class="studio-signin-copy-status"[^>]*><\/p>/.test(html), "the status region exists empty before the press");
  ok(!html.includes(SIGN_IN_LINK_COPY.copied) && !html.includes(SIGN_IN_LINK_COPY.failed), "no result before the press");
});
t("the press posts accountCopyLink and nothing else", () => {
  // renderToStaticMarkup drops handlers, so call the element tree's onClick directly.
  const posted: unknown[] = [];
  const tree = AccountEntry({ account: waiting({ link: "ready" }), checking: false, post: (m) => posted.push(m) }) as React.ReactElement;
  const find = (node: any): any => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f; } return; }
    if (typeof node.props?.className === "string" && node.props.className.includes("studio-signin-copy") && node.type === "button") return node;
    return find(node.props?.children);
  };
  const b = find(tree); ok(b, "button not found in the tree"); b.props.onClick();
  ok(JSON.stringify(posted) === JSON.stringify([{ type: "accountCopyLink" }]), `posted ${JSON.stringify(posted)}`);
});

// --- CSS: 44px target, ≥14px text, forced colors --------------------------------------------
const css = readFileSync("webview-ui/src/start.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => { const m = new RegExp(`(^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css); return m ? m[2] : ""; };
const px = (body: string, prop: string) => { const m = new RegExp(`(^|;|\\s)${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(body); return m ? Number(m[2]) : NaN; };
t("button: min-height ≥ 44px and font-size ≥ 14px", () => {
  const b = rule(".studio-account .studio-signin-copy"); ok(b, "no .studio-account .studio-signin-copy rule");
  ok(px(b, "min-height") >= 44, `min-height ${px(b, "min-height")}`);
  ok(px(b, "font-size") >= 14, `font-size ${px(b, "font-size")}`);
  ok(/border\s*:\s*1px solid/.test(b), "a real border keeps the boundary in forced colors");
});
t("hint and status text ≥ 14px; the link wraps", () => {
  for (const sel of [".studio-signin-copy-hint", ".studio-signin-copy-status"]) { const r = rule(sel); ok(r, `no ${sel} rule`); ok(px(r, "font-size") >= 14, `${sel} font-size ${px(r, "font-size")}`); }
  ok(/overflow-wrap\s*:\s*anywhere/.test(rule(".studio-signin-copy-link")), "the shown link wraps");
});
t("negative control: forced colors are not switched off for the copy", () => {
  ok(!/studio-signin-copy[^{]*\{[^}]*forced-color-adjust\s*:\s*none/.test(css), "forced-color-adjust:none on the copy");
});

if (fail) { console.error(`signin-copy-link render: ${fail} failed`); process.exit(1); }
console.log("PASS signin-copy-link render");
