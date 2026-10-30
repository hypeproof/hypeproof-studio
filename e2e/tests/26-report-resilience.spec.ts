// REQ-H6: report path stays alive when chat is broken.
//
// Mock: /v1/chat/completions returns 500 (chat dead) but /v1/report accepts
// reports normally. Run the reportProblem command, which opens the in-panel
// report form (REQ-STUDIO-PROBLEM-REPORT; the QuickInput cascade is only the
// fallback when no chat panel can be shown), then the REQ-KNOW-09 item-by-item
// confirmation. Verify the mock received the POST — proving the host's report
// path doesn't share a fate with the chat path.

import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { APP_BINARY, TOKEN_FILE } from "../fixtures/global-setup";
import { chatFrame, runCommand } from "../fixtures/app";

interface ReceivedReport { description: string; profile_id?: string; contact?: string; include_recent_turns?: boolean; recent_turns?: unknown }

async function startMock(reportStatus = 200): Promise<{ port: number; close: () => Promise<void>; received: ReceivedReport[] }> {
  const received: ReceivedReport[] = [];
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");

    if (req.method === "GET" && req.url?.endsWith("/profile")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        profile_id: "dental-teaser-2026-s1",
        display_name: "예시치과 v4", language: "ko", series_index: 1, series_total: 1,
        welcome: { greeting_md: "", example_prompts: [] },
        ux: {
          coach: { naming_mode: "fixed", fallback_name: "코디", naming_prompt_md: "", personality_prompt_md: "" },
          suggestions: { initial: [], follow_up: [] },
          hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
          retry_button: { enabled: false, show_counter: false },
        },
        publishing: { enabled: false, strategy: "none" },
        preview: { type: "iframe", auto_start: false },
      }));
      return;
    }

    // Chat is DEAD.
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "chat dead", type: "transport" } }));
      return;
    }

    // Report endpoint STAYS ALIVE.
    if (req.method === "POST" && req.url?.endsWith("/report")) {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as ReceivedReport;
          received.push(parsed);
        } catch { /* ignore */ }
        res.setHeader("content-type", "application/json");
        res.statusCode = reportStatus;
        res.end(JSON.stringify(reportStatus === 200 ? { report_id: "rep_test_h6_ok" } : { error: { message: 'synthetic receiver unavailable' } }));
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    received,
  };
}

interface Ctx { app: ElectronApplication; win: Page; userDataDir: string }

async function launchAt(port: number): Promise<Ctx> {
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hps-e2e-h6-"));
  const userDir = path.join(userDataDir, "User");
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, "settings.json"), JSON.stringify({
    "hypeproofChat.proxyUrl": `http://127.0.0.1:${port}/v1`,
    "workbench.startupEditor": "none",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
  }));
  fs.writeFileSync(path.join(userDir, "hps-test-state.json"), JSON.stringify({
    token, coach: { name: "코디", personality: "" },
  }));
  const wsDir = path.join(userDataDir, "ws");
  fs.mkdirSync(wsDir, { recursive: true });
  const app = await electron.launch({
    executablePath: APP_BINARY,
    args: [
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${path.join(userDataDir, "extensions")}`,
      "--disable-workspace-trust", "--use-inmemory-secretstorage",
      "--disable-updates", "--skip-welcome", "--skip-release-notes",
      "--no-sandbox", wsDir,
    ],
    env: {
      ...(process.env as Record<string, string>),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HPS_TEST_E2E: "1", HPS_TEST_TOKEN: token, HPS_TEST_COACH_NAME: "코디",
    },
    timeout: 30_000,
  });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForSelector(".monaco-workbench", { timeout: 30_000 });
  return { app, win, userDataDir };
}

async function teardown(ctx: Ctx) {
  try { await ctx.app.close(); } catch { /* */ }
  try { fs.rmSync(ctx.userDataDir, { recursive: true, force: true }); } catch { /* */ }
}

type Frame = Awaited<ReturnType<typeof chatFrame>>;

/** Opens the in-panel form from the command palette and returns the chat frame. */
async function openForm(win: Page): Promise<Frame> {
  await runCommand(win, "HypeProof Chat: 문제 신고하기");
  const frame = await chatFrame(win);
  await expect(frame.locator(".hps-problem-report")).toBeVisible({ timeout: 15_000 });
  return frame;
}

/** The REQ-KNOW-09 confirmation: every item must be ticked before 보내기 is enabled. */
async function confirmOutbound(frame: Frame): Promise<void> {
  const dialog = frame.locator('[data-testid="outbound-dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  for (const box of await dialog.locator('input[type="checkbox"]').all()) await box.check();
  await dialog.locator(".hps-outbound-send").click();
}

test("REQ-H6: report path stays alive when chat is broken", async () => {
  const mock = await startMock();
  const ctx = await launchAt(mock.port);
  try {
    await ctx.win.waitForTimeout(2_500);
    const frame = await openForm(ctx.win);
    await frame.locator("[data-problem-description]").fill("H6 e2e probe: chat is dead but report should still work");
    await frame.locator("[data-problem-send]").click();
    await confirmOutbound(frame);
    await expect.poll(() => mock.received.length, { timeout: 15_000, intervals: [500, 500, 1000] }).toBeGreaterThanOrEqual(1);
    const r = mock.received[0]!;
    expect(r.description).toContain("H6 e2e probe");
    expect(r.include_recent_turns).toBe(false);
    expect(r.recent_turns).toBeUndefined();
    await expect(ctx.win.locator('.notifications-toasts')).toContainText('rep_test_h6_ok');
  } finally {
    await teardown(ctx);
    await mock.close();
  }
});

test('report: 취소, Escape and a cancelled confirmation each send nothing', async () => {
  const mock = await startMock();
  const ctx = await launchAt(mock.port);
  try {
    await ctx.win.waitForTimeout(2500);
    let frame = await openForm(ctx.win);
    await frame.locator('[data-problem-cancel]').click();
    await expect(frame.locator('.hps-problem-report')).toHaveCount(0);
    frame = await openForm(ctx.win);
    await ctx.win.keyboard.press('Escape');
    await expect(frame.locator('.hps-problem-report')).toHaveCount(0);
    frame = await openForm(ctx.win);
    await frame.locator('[data-problem-description]').fill('합성 신고 취소 테스트입니다. 외부로 전송하지 않습니다.');
    await frame.locator('[data-problem-send]').click();
    await frame.locator('[data-testid="outbound-dialog"] [data-outbound-cancel]').click();
    await ctx.win.waitForTimeout(1000);
    expect(mock.received).toHaveLength(0);
    if (process.env.HPS_NATIVE_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.HPS_NATIVE_EVIDENCE_DIR, 'report-cancellation.json'), JSON.stringify({ status: 'PASS', cancelled: ['form-cancel', 'form-escape', 'confirmation-cancel'], received: mock.received.length }));
  } finally { await teardown(ctx); await mock.close(); }
});

test('report: failed local receiver surfaces failure without a success ID', async () => {
  const mock = await startMock(503);
  const ctx = await launchAt(mock.port);
  try {
    await ctx.win.waitForTimeout(2500);
    const frame = await openForm(ctx.win);
    await frame.locator('[data-problem-description]').fill('합성 신고 실패 테스트입니다. 로컬 수신기만 사용합니다.');
    await frame.locator('[data-problem-contact]').fill('synthetic@example.invalid');
    await frame.locator('[data-problem-send]').click();
    await confirmOutbound(frame);
    await expect.poll(() => mock.received.length).toBe(1);
    await expect(ctx.win.locator('.notifications-toasts')).toContainText('문제를 보내지 못했어요');
    await expect(ctx.win.locator('.notifications-toasts')).not.toContainText('rep_test_h6_ok');
    expect(mock.received[0].contact).toBe('synthetic@example.invalid');
    if (process.env.HPS_NATIVE_EVIDENCE_DIR) await ctx.win.screenshot({ path: path.join(process.env.HPS_NATIVE_EVIDENCE_DIR, 'report-failure.png') });
  } finally { await teardown(ctx); await mock.close(); }
});

test('report: no conversation leaves without the opt-in; empty description is replaced, contact is capped', async () => {
  const mock = await startMock();
  const ctx = await launchAt(mock.port);
  try {
    await ctx.win.waitForTimeout(2500);
    const frame = await openForm(ctx.win);
    // Empty history: there is nothing to attach, so the opt-in is not offered.
    await expect(frame.locator('[data-problem-recent]')).toHaveCount(0);
    await frame.locator('[data-problem-contact]').fill('x'.repeat(201));
    await expect(frame.locator('[data-problem-contact]')).toHaveValue('x'.repeat(200));
    await frame.locator('[data-problem-contact]').fill('  synthetic@example.invalid  ');
    await frame.locator('[data-problem-send]').click();
    await confirmOutbound(frame);
    await expect.poll(() => mock.received.length).toBe(1);
    expect(mock.received[0].include_recent_turns).toBe(false);
    expect(mock.received[0].recent_turns).toBeUndefined();
    expect(mock.received[0].description).toBe('(설명 없음)');
    expect(mock.received[0].contact).toBe('synthetic@example.invalid');
    await expect(ctx.win.locator('.notifications-toasts')).toContainText('rep_test_h6_ok');
    if (process.env.HPS_NATIVE_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.HPS_NATIVE_EVIDENCE_DIR, 'report-opt-in.json'), JSON.stringify({ status: 'PASS', scope: 'in-panel report form with isolated empty history and local receiver', opt_in_offered: false, empty_history: true, contact_length_cap: true }));
  } finally { await teardown(ctx); await mock.close(); }
});
