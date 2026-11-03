// REQ-D1–D6 preview suite (#90).
//
// Strategy: pre-seed chat history via the hps-test-state.json backdoor so a
// canned assistant turn with HTML already exists. That lets us exercise the
// preview path (▶Run, sandbox, panel reuse, save-to-workspace, previewReady
// handshake) without depending on a live LLM round-trip.
//
// Two preview paths ship (`revealBuilt` in chatPanelProvider.ts). A cohort whose
// profile says `preview.type: "live_server"` gets the workspace served on 127.0.0.1
// in a native browser tab (REQ-N1); a webview cohort (`preview.type: "iframe"`), and
// a live server that fails to start, gets the sandboxed srcdoc webview (`#frame`).
// REQ-D3 and REQ-D6 belong to the webview path; studio-requirements.md §N says
// REQ-N1 replaces REQ-D3 for live_server cohorts. Each check finds which path opened
// and asserts that path's contract. Which path is expected is read from the profile
// the app was served, so a cohort that takes the other path fails.
//
// Every test runs twice (recon F1, #1391, #1506):
//   - "served": the profile the dev Service serves for the token, unchanged. Every
//     profile in worker/src/profiles is live_server, so on the dev stack this is the
//     live path.
//   - "webview": the same Service behind a forwarder (`webviewProfileProxy`) that
//     changes one field of the served profile, `preview.type`, to "iframe" and passes
//     every other request and response through. The App code that reads the field is
//     the shipped one. Before this variant no dev-stack run reached REQ-D3 or REQ-D6.
//     Evidence class: live-host App, synthetic profile field.
// Until 2026-10-01 the spec looked only for `#frame`, so on a live_server cohort it
// measured a path the product never takes there and failed on the unchanged tree too
// (recon F1).

import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import type { FrameLocator, Page } from "@playwright/test";
import {
  type AppContext,
  chatFrame,
  closeApp,
  launchApp,
  openChatContainer,
  runCommand,
  runCommandById,
} from "../fixtures/app";
import { TOKEN_FILE } from "../fixtures/global-setup";

/** The dev Service the fixture points the app at by default. */
const SERVICE = (process.env.HPS_E2E_PROXY_URL?.trim() || "http://localhost:8787/v1").replace(/\/$/, "");

type Variant = "served" | "webview";
const VARIANTS: Variant[] = ["served", "webview"];

/** The canned game sets this title once its script runs; a browser tab is labelled by its page title. */
const LOADED_TITLE = "preview-test-loaded";
const MARKER = "REQ-D preview test game";
const liveTabs = (win: Page) => win.locator(".tabs-container .tab", { hasText: LOADED_TITLE });

type Opened = { path: "live" } | { path: "iframe"; shell: FrameLocator };

/**
 * Which preview opened: a native browser tab showing the canned game (live_server,
 * REQ-N1) or the webview whose shell holds the sandboxed `#frame`. For the webview the
 * shell is located by the webview's own name, not by its position among the editor's
 * webviews. Neither within the timeout fails the check.
 */
async function openedPreview(win: Page): Promise<Opened> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if ((await liveTabs(win).count()) > 0) return { path: "live" };
    const outer = win.locator("iframe.webview.ready");
    for (let i = 0; i < (await outer.count()); i++) {
      const inner = win.frameLocator("iframe.webview.ready").nth(i).frameLocator("#active-frame");
      if ((await inner.locator("#frame").count().catch(() => 0)) > 0) {
        const name = await outer.nth(i).getAttribute("name").catch(() => null);
        const shell = name && /^[A-Za-z0-9_-]+$/.test(name)
          ? win.frameLocator(`iframe.webview.ready[name="${name}"]`).frameLocator("#active-frame")
          : inner;
        return { path: "iframe", shell };
      }
    }
    await win.waitForTimeout(250);
  }
  throw new Error(`no preview opened: neither a browser tab titled "${LOADED_TITLE}" nor a webview with #frame`);
}

/** The path the profile served at `service` picks: `preview.type: "live_server"` → live, anything else → iframe. */
async function expectedPreview(service: string): Promise<"live" | "iframe"> {
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  const res = await fetch(`${service}/profile`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`profile not served (${res.status}): cannot tell which preview path is expected`);
  const profile = (await res.json()) as { preview?: { type?: unknown } };
  return profile.preview?.type === "live_server" ? "live" : "iframe";
}

/**
 * A forwarder in front of the dev Service that serves the token's profile as a webview
 * cohort: `GET <base>/profile` answers the Service's own profile with `preview.type`
 * set to "iframe". Every other request and response passes through unchanged (bodies
 * are buffered: nothing in these tests streams).
 */
async function webviewProfileProxy(): Promise<{ url: string; close: () => Promise<void> }> {
  const upstream = new URL(SERVICE);
  const base = upstream.pathname.replace(/\/$/, "");
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && !["host", "connection", "content-length"].includes(k)) {
          headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
      }
      const target = new URL(req.url ?? "/", upstream.origin);
      const up = await fetch(target, {
        method: req.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });
      const out: Record<string, string> = {};
      up.headers.forEach((v, k) => {
        if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
      });
      let body = Buffer.from(await up.arrayBuffer());
      if (req.method === "GET" && target.pathname === `${base}/profile` && up.ok) {
        const profile = JSON.parse(body.toString("utf8")) as { preview?: Record<string, unknown> };
        profile.preview = { ...profile.preview, type: "iframe" };
        body = Buffer.from(JSON.stringify(profile));
      }
      res.writeHead(up.status, out);
      res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${base}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const CANNED_GAME = `<!doctype html>
<html><head><meta charset="utf-8"><title>preview-test</title></head>
<body style="background:#1b1b2a;color:#fff;font-family:sans-serif">
<h1 id="preview-marker">${MARKER}</h1>
<script>document.title="preview-test-loaded";</script>
</body></html>`;

const CANNED_ASSISTANT_TURN = {
  id: "test-asst-1",
  role: "assistant" as const,
  content: `Here's your game:\n\n\`\`\`html\n${CANNED_GAME}\n\`\`\``,
  createdAt: Date.now(),
};

const CANNED_USER_TURN = {
  id: "test-user-1",
  role: "user" as const,
  content: "게임 만들어줘",
  createdAt: Date.now() - 1000,
};

let ctx: AppContext | undefined;
let forwarder: { url: string; close: () => Promise<void> } | undefined;

test.afterEach(async () => {
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  if (forwarder) await forwarder.close();
  forwarder = undefined;
});

/** Launch the app with the canned turns on the variant's Service; returns the app and that Service's URL. */
async function launchVariant(
  variant: Variant,
  coach: { name: string; personality?: string },
): Promise<{ app: AppContext; service: string }> {
  let service = SERVICE;
  if (variant === "webview") {
    forwarder = await webviewProfileProxy();
    service = forwarder.url;
    // Instrument control: if the forwarder stopped changing the profile, this variant
    // would quietly measure the live path a second time.
    expect(await expectedPreview(service), "the forwarder serves a webview cohort").toBe("iframe");
  }
  ctx = await launchApp({
    preseedToken: true,
    preseedCoach: coach,
    preseedHistory: [CANNED_USER_TURN, CANNED_ASSISTANT_TURN],
    proxyUrl: service,
  });
  return { app: ctx, service };
}

for (const variant of VARIANTS) {
  test(`REQ-D1 + REQ-D3 + REQ-D6: Run Last Code opens the preview the cohort's path names [${variant}]`, async () => {
    const { app, service } = await launchVariant(variant, { name: "코디", personality: "" });

    await openChatContainer(app.win);
    // Allow history to hydrate
    await app.win.waitForTimeout(1000);

    // REQ-D1: Run Last Code in Preview
    await runCommandById(app.win, "hypeproof-chat.runLastCode");
    const opened = await openedPreview(app.win);
    console.log(`09-preview [${variant}]: ${opened.path} path`);
    expect(opened.path, "the preview path the served profile's preview.type picks").toBe(await expectedPreview(service));

    if (opened.path === "live") {
      // REQ-D1 on the live-server path: the canned game itself is what the tab shows
      // (its script ran and set the title), served from the saved workspace file.
      await expect(liveTabs(app.win)).toHaveCount(1);
      expect(fs.readFileSync(path.join(app.wsDir, "index.html"), "utf8")).toContain(MARKER);
      test.info().annotations.push({ type: "path", description: "live_server: REQ-D3/D6 are the webview path's; REQ-N1 replaces REQ-D3 here" });
      return;
    }

    // The sandboxed iframe sits in the shell from the start, hidden; renderPreview shows it.
    const iframe = opened.shell.locator("#frame");
    await expect(iframe).toBeAttached({ timeout: 10_000 });

    // REQ-D3: sandbox attribute matches the locked-down posture
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-pointer-lock");
    expect(sandbox).toContain("allow-modals");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");

    // referrerpolicy = no-referrer (locked down)
    const referrerPolicy = await iframe.getAttribute("referrerpolicy");
    expect(referrerPolicy).toBe("no-referrer");

    // REQ-D6: the HTML sent before the shell's previewReady was queued and flushed: the
    // iframe left the placeholder branch and renders the canned game itself.
    await expect(iframe).toHaveCSS("display", "block", { timeout: 5_000 });
    await expect(opened.shell.frameLocator("#frame").locator("#preview-marker")).toHaveText(MARKER, { timeout: 10_000 });
  });

  test(`REQ-D4: second Run reuses the existing preview (no second WebviewPanel or tab) [${variant}]`, async () => {
    const { app, service } = await launchVariant(variant, { name: "코디" });

    await openChatContainer(app.win);
    await app.win.waitForTimeout(1000);

    // First run — opens preview
    await runCommandById(app.win, "hypeproof-chat.runLastCode");
    const opened = await openedPreview(app.win);
    console.log(`09-preview [${variant}]: ${opened.path} path`);
    expect(opened.path, "the preview path the served profile's preview.type picks").toBe(await expectedPreview(service));
    await app.win.waitForTimeout(800);

    if (opened.path === "live") {
      // The live-server path reuses its browser tab (startLivePreview: same URL → reload).
      await expect(liveTabs(app.win)).toHaveCount(1);
      await runCommandById(app.win, "hypeproof-chat.runLastCode");
      await app.win.waitForTimeout(1500);
      await expect(liveTabs(app.win)).toHaveCount(1);
      return;
    }

    // Count webview iframes before second run
    const beforeCount = await app.win.locator("iframe.webview.ready").count();
    expect(beforeCount).toBeGreaterThanOrEqual(2); // chat + preview at minimum

    // Second run — must reuse the panel, not spawn a new one
    await runCommandById(app.win, "hypeproof-chat.runLastCode");
    await app.win.waitForTimeout(1500);

    const afterCount = await app.win.locator("iframe.webview.ready").count();
    // The webview-host iframe count should NOT grow. Note: VS Code is allowed
    // to lazy-tear-down hidden webviews, so we assert "not greater than", not
    // strict equality.
    expect(afterCount).toBeLessThanOrEqual(beforeCount);
  });

  test(`REQ-D5: saved game lands at workspaceFolder/index.html [${variant}]`, async () => {
    const { app } = await launchVariant(variant, { name: "코디" });

    await openChatContainer(app.win);
    await app.win.waitForTimeout(1000);

    // Send a "show" message so the isShowIntent shortcut fires → preview opens
    // AND saveGameToWorkspace runs. This exercises the same code path as the
    // auto-reveal during streaming (REQ-D2) but without needing the LLM.
    const chat = await chatFrame(app.win);
    const input = chat.locator("textarea, input[type='text']").first();
    await input.fill("보여줘");
    await app.win.keyboard.press("Enter");

    // Wait for index.html to appear in the workspace
    const indexPath = path.join(app.wsDir, "index.html");
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, "utf8");
        if (content.includes(MARKER)) break;
      }
      await app.win.waitForTimeout(300);
    }

    expect(fs.existsSync(indexPath), `index.html should exist at ${indexPath}`).toBe(true);
    const content = fs.readFileSync(indexPath, "utf8");
    expect(content).toContain(MARKER);
    // Sanity: it's the canned HTML, not the chat-extension's placeholder
    expect(content).toContain("<!doctype html>");
  });
}
