// GET /studio/latest-release — the latest published formal Studio release (DEC-24), for /manage's 업데이트 필요 mark.
// Public information read from the public release (src/lib/latest-release.ts); no instructor credential is involved,
// so no connection is required. { version: null } means unknown: the page then flags nobody.
import { Hono } from "hono";
import type { ChalkEnv } from "../env.ts";
import { latestFormalRelease } from "../lib/latest-release.ts";

export const studioRelease = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
studioRelease.get("/studio/latest-release", async (c) => {
  const latest = await latestFormalRelease();
  c.header("cache-control", "no-store");
  return c.json({ version: latest.version, checked_at: latest.checked_at, source: "github.com/hypeproof/hypeproof-studio releases/latest" });
});
