// CONV-PURCHASE-R-002 (REQ-L12 ⑭) — the webview half of "back from the purchase-time sign-in, the
// same pass is still chosen": the login-at-purchase Google button sends the chosen pass with the
// sign-in intent, and the list's choice falls back to the pass the host gives back. The host half
// is in test/start-page-purchase.smoke.mjs. Bundled with esbuild, run with plain Node.
import React from "react";
import { AccountEntry } from "../webview-ui/src/AccountEntry";
import { chosenPass } from "../webview-ui/src/purchaseChoice";
import type { PassProduct } from "../src/passPurchase";

let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

/** Press the Google button of an AccountEntry tree without a DOM: walk the elements, call its onClick. */
function pressGoogle(productId?: string): unknown[] {
  const posted: unknown[] = [];
  const tree = AccountEntry({ account: { status: "signedOut" }, checking: false, post: m => posted.push(m), ...(productId ? { productId } : {}) });
  const walk = (node: unknown): React.ReactElement | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) { for (const n of node) { const f = walk(n); if (f) return f; } return undefined; }
    const el = node as React.ReactElement<{ className?: string; children?: unknown; onClick?: () => void }>;
    if (el.type === "button" && String(el.props.className).includes("studio-google")) return el;
    return walk(el.props?.children);
  };
  const button = walk(tree) as React.ReactElement<{ onClick: () => void }> | undefined;
  ok(button, "no Google button");
  button!.props.onClick();
  return posted;
}

const pass = (id: string, recommended = false): PassProduct => ({ id, label: id, amount: 1, durationDays: 30, requestLimit: 1, ...(recommended ? { recommended: true } : {}) } as PassProduct);
const products = [pass("pass-30d", true), pass("pass-90d")];

t("login at purchase: the Google button sends the chosen pass with the sign-in", () => {
  const posted = pressGoogle("pass-90d");
  ok(JSON.stringify(posted) === JSON.stringify([{ type: "accountSignIn", productId: "pass-90d" }]), `posted ${JSON.stringify(posted)}`);
});
t("negative control: an AccountEntry outside the pass list sends no pass", () => {
  const posted = pressGoogle();
  ok(JSON.stringify(posted) === JSON.stringify([{ type: "accountSignIn" }]), `posted ${JSON.stringify(posted)}`);
});
t("a fresh view (no local pick) shows the pass the host gave back, not the recommendation", () => {
  ok(chosenPass(products, null, "pass-90d")?.id === "pass-90d", "restored pass not chosen");
});
t("negative control: nothing given back → the recommended pass, as before", () => {
  ok(chosenPass(products, null, undefined)?.id === "pass-30d", "recommendation not chosen");
});
t("the person's own pick in this view wins over the restored id", () => {
  ok(chosenPass(products, "pass-30d", "pass-90d")?.id === "pass-30d", "local pick lost");
});
t("a restored id no longer sold is skipped", () => {
  ok(chosenPass(products, null, "pass-gone")?.id === "pass-30d", "unknown id was chosen");
});

if (fail) { console.error(`FAIL purchase-return render: ${fail}`); process.exit(1); }
console.log("PASS purchase-return render");
