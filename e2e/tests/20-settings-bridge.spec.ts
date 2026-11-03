// REQ-K2: webview ⚙ button → workbench.action.openSettings("hypeproofChat")
//
// Click the cog button in the chat panel header → assert the Settings editor
// opens with the hypeproofChat query pre-filtered.

import { test, expect } from "@playwright/test";
import { chatFrame, closeApp, launchApp, settingLabel } from "../fixtures/app";

test("REQ-K2: ⚙ click opens Settings editor pre-filtered to hypeproofChat", async () => {
  const ctx = await launchApp({
    preseedToken: true,
    preseedCoach: { name: "코디" }, // skip naming card so the cog is reachable
  });
  try {
    const cf = await chatFrame(ctx.win);
    // REQ-STUDIO-STROKE-ICONS: the cog is a stroke icon now; the button keeps its Korean name.
    const cog = cf.getByRole("button", { name: "설정", exact: true }).first();
    await cog.waitFor({ state: "visible", timeout: 15_000 });
    await cog.click();

    // The Settings editor opens in the editor area with our 3 settings
    // visible (filtered by "hypeproofChat" query). VS Code's display labels
    // come from the Korean shell patch (settingLabel), not the manifest titles.
    await expect(ctx.win.locator(".monaco-workbench"))
      .toContainText(settingLabel("hypeproofChat.model"), { timeout: 15_000 });
    await expect(ctx.win.locator(".monaco-workbench"))
      .toContainText(settingLabel("hypeproofChat.proxyUrl"));
    await expect(ctx.win.locator(".monaco-workbench"))
      .toContainText(settingLabel("hypeproofChat.requireApprovalFor"));
  } finally {
    await closeApp(ctx);
  }
});
