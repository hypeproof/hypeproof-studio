// In-app SX runs (학습 경험 우선 Studio). Separate from the main suite: it brings its own
// local Service (sx-service.mjs) and never needs wrangler dev.
//
//   HPS_APP_PATH="<prepared app copy>" npx playwright test -c sx/playwright.config.ts
import { defineConfig } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SX_APP_PORT = Number(process.env.HPS_SX_APP_PORT || 18951);
// Read by fixtures/app.ts when the spec imports it (worker processes inherit this env).
process.env.HPS_E2E_TOKEN_FILE ||= path.join(here, "../test-results/sx-app/token.txt");
process.env.HPS_E2E_PROXY_URL ||= `http://127.0.0.1:${SX_APP_PORT}/v1`;

export default defineConfig({
  testDir: here,
  testMatch: /task-flow-app\.spec\.ts$/,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(here, "../test-results/sx-app/playwright"),
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
