// GET /studio/latest-release — the latest published formal Studio release (DEC-24), for /manage's 업데이트 필요 mark.
// Deliberately public and read-only: it answers public information (the public GitHub release) and holds no class,
// seat or instructor data, so it needs no connection. { version: null } means unknown: the page then flags nobody.
// Outside production HPS_STUDIO_LATEST_RELEASE answers instead of GitHub (tests, local runs).
import { Hono } from "hono";
import type { ChalkEnv } from "../env.ts";
import { latestFormalRelease } from "../lib/latest-release.ts";

export const studioRelease = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
studioRelease.get("/studio/latest-release", async (c) => {
  c.header("cache-control", "no-store");
  const fixed = c.env?.ENVIRONMENT !== "production" ? c.env?.HPS_STUDIO_LATEST_RELEASE?.trim() : undefined;
  if (fixed) {
    const version = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/.test(fixed) ? fixed : null;
    return c.json({ version, checked_at: null, source: "HPS_STUDIO_LATEST_RELEASE" });
  }
  const latest = await latestFormalRelease();
  return c.json({ version: latest.version, checked_at: latest.checked_at, source: "github.com/hypeproof/hypeproof-studio releases/latest" });
});
