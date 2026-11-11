// Mobile viewport verification; this is not installed-device acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
const origin = process.env.MOBILE_TEST_ORIGIN ?? "http://127.0.0.1:51879";
const output = process.env.MOBILE_TEST_OUTPUT ?? "/tmp/hp-mobile-browser";
await mkdir(output, { recursive: true });
const server = process.env.MOBILE_TEST_ORIGIN
  ? null
  : spawn(process.execPath, ["dev.mjs"], {
      env: { ...process.env, PORT: "51879" },
      stdio: "ignore",
    });
let browser, lastPage;
const checks = [];
const errors = [];
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await playwright[engine].launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  for (const [name, width, height] of [
    ["iphone-viewport", 390, 844],
    ["android-viewport", 360, 800],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      acceptDownloads: true,
    });
    const page = await context.newPage();
    lastPage = page;
    page.on("pageerror", (e) => errors.push(e.message));
    let mode = "success",
      chatCalls = 0;
    let release;
    await page.route("**/api/service?*", async (route) => {
      if (route.request().url().includes("claim"))
        return route.fulfill({
          json: {
            code: "fixture-token-explicitly-not-live",
            expires_at: Date.now() + 3600000,
          },
        });
      chatCalls++;
      if (mode === "delayed") {
        await new Promise((resolve) => (release = resolve));
        return route
          .fulfill({ json: { content: "늦게 도착한 답변" } })
          .catch(() => {});
      }
      if (mode === "refusal")
        return route.fulfill({
          status: 429,
          json: {
            error: {
              code: "trial_cost_exhausted",
              refills_at: Date.now() + 3600000,
            },
          },
        });
      return route.fulfill({
        json: {
          content: "그 장면에서 직접 본 사실과 짐작한 부분을 나눠 볼까요?",
        },
      });
    });
    await page.goto(origin);
    await page
      .locator("#newIdea")
      .fill("동네 공방의 일요일 수업을 알리고 싶어요.");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${output}/${name}-home.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "생각 펼치기" }).click();
    assert.equal(chatCalls, 0); // No transmission before explicit admission.
    await page.locator("#connect").click();
    await page.locator("#age").check();
    await page.locator("#claim").click();
    await page.locator("#connectDialog").waitFor({ state: "hidden" });
    await page.locator(".bubble.assistant").waitFor();
    assert.equal(chatCalls, 1);
    await page.locator("#intentTab").click();
    await page
      .locator("#intentText")
      .fill("공방을 처음 찾는 이웃에게 일요일 수업을 알린다.");
    await page.getByRole("button", { name: "이 의도로 기록하기" }).click();
    await page
      .locator("#intentText")
      .fill("처음에는 한 공방에서 수요를 확인한다.");
    await page.getByRole("button", { name: "이 의도로 기록하기" }).click();
    assert.equal(await page.locator(".revision").count(), 2);
    await page.screenshot({
      path: `${output}/${name}-intent.png`,
      fullPage: true,
    });
    await page.reload();
    await page.locator("#intentTab").click();
    assert.equal(await page.locator(".revision").count(), 2);
    await page.locator("#chatTab").click();
    await page.locator("#connect").click();
    await page.locator("#age").check();
    await page.locator("#claim").click();
    await page.locator("#connectDialog").waitFor({ state: "hidden" });
    mode = "delayed";
    await page.locator("#message").fill("검증할 방법을 알려 줘.");
    await page.locator("#send").click();
    await page.locator("#cancel").waitFor();
    for (let i = 0; !release && i < 30; i++) await delay(20);
    assert.ok(release);
    await page.locator("#cancel").click();
    release?.();
    await page.locator("#chatError").waitFor();
    assert.match(await page.locator("#chatError").textContent(), /중단/);
    assert.equal(await page.locator(".bubble.assistant").count(), 1);
    mode = "refusal";
    await page.locator("#retry").click();
    await page.waitForFunction(() =>
      document.querySelector("#chatError").textContent.includes("한도"),
    );
    assert.equal(await page.locator(".bubble.assistant").count(), 1);
    assert.equal(await page.locator("#message").inputValue(), "");
    await page.reload();
    assert.ok(
      (await page.locator(".bubble.user").allTextContents()).some((t) =>
        t.includes("검증할 방법"),
      ),
    );
    await page.locator("#settingsOpen").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportAll").click();
    const download = await downloadPromise;
    await download.saveAs(`${output}/${name}-records.json`);
    await page.locator('[data-close="settings"]').click();
    await page.locator("#intentTab").click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#deleteProject").click();
    assert.equal(await page.locator(".project-card").count(), 0);
    checks.push({
      name,
      result: "PASS",
      cases: [
        "explicit-consent",
        "real-ui-with-labeled-fixture-ai",
        "manual-revision",
        "restart",
        "cancel-late-response",
        "refusal-preserves-records",
        "export",
        "delete",
        "no-horizontal-overflow",
      ],
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    lastPage = page;
    let completeClaim,
      chatCalls = 0;
    await page.route("**/api/service?*", async (route) => {
      if (route.request().url().includes("claim")) {
        await new Promise((resolve) => (completeClaim = resolve));
        return route
          .fulfill({
            json: {
              code: "fixture-token-explicitly-not-live",
              expires_at: Date.now() + 3600000,
            },
          })
          .catch(() => {});
      }
      chatCalls++;
      return route.fulfill({ json: { content: "must not arrive" } });
    });
    await page.goto(origin);
    await page.locator("#newIdea").fill("<img src=x onerror=alert(1)> 관찰");
    await page.getByRole("button", { name: "생각 펼치기" }).click();
    assert.equal(await page.locator("#projectTitle img").count(), 0);
    await page.locator("#connect").click();
    await page.locator("#age").check();
    await page.locator("#claim").click();
    for (let i = 0; !completeClaim && i < 30; i++) await delay(20);
    assert.ok(completeClaim);
    await page.locator('[data-close="connectDialog"]').click();
    completeClaim();
    await delay(150);
    assert.equal(chatCalls, 0);
    assert.match(await page.locator("#connectionStatus").textContent(), /혼자/);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.failStorage = true;
      Storage.prototype.setItem = function (...args) {
        if (window.failStorage)
          throw new DOMException("full", "QuotaExceededError");
        return original.apply(this, args);
      };
    });
    await page.locator("#message").fill("저장 실패 중 작성한 최신 초안");
    await page.locator("#settingsOpen").click();
    const pending = page.waitForEvent("download");
    await page.locator("#exportAll").click();
    const exported = await pending;
    await exported.saveAs(output + "/quota-recovery.json");
    const { readFile } = await import("node:fs/promises");
    assert.match(
      await readFile(output + "/quota-recovery.json", "utf8"),
      /최신 초안/,
    );
    await page.locator('[data-close="settings"]').click();
    await page.locator("#intentTab").click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#deleteProject").click();
    assert.equal(await page.locator("#workspace").isVisible(), true);
    await page.evaluate(() => (window.failStorage = false));
    page.once("dialog", (d) => d.accept());
    await page.locator("#deleteProject").click();
    await page.reload();
    assert.equal(await page.locator(".project-card").count(), 0);
    checks.push({
      name: "consent-and-storage-regression",
      result: "PASS",
      cases: [
        "closed-claim-does-not-send",
        "text-not-html",
        "quota-export-keeps-current-draft",
        "failed-delete-not-committed",
        "retry-delete-survives-restart",
      ],
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        origin,
        engine,
        checks,
        pageErrors: errors,
        limitation:
          "Mobile browser viewports; AI mocked; not iPhone hardware or live AI acceptance.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", checks, output }));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({
      path: output + "/failure.png",
      fullPage: true,
    });
    console.error(await lastPage.locator("body").innerText());
  }
  throw error;
} finally {
  await browser?.close();
  server?.kill();
}
