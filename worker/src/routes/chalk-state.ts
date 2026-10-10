// Service owns instructor authorization, state reads and profile filtering.
// Response preserves the Chalk state contract; no roster handles or prompt text.
import { Hono } from "hono";
import type { Env } from "../env.ts";
import {
  getActiveSession,
  getCohortPause,
  getRoster,
} from "../lib/kv.ts";
import { authorizeIssuerForCohort } from "../lib/instructor-auth.ts";
import { listProfiles } from "../profiles/index.ts";

export const chalkState = new Hono<{ Bindings: Env }>();

chalkState.use("/chalk/cohorts/:id/state", async (c, next) => {
  c.header("cache-control", "no-store");
  await next();
});

chalkState.get("/chalk/cohorts/:id/state", async (c) => {
  const cohortId = c.req.param("id");
  const authz = await authorizeIssuerForCohort(c, cohortId);
  if (authz instanceof Response) return authz;
  if (authz === null) {
    return c.json({ error: "instructor issuer token required (Authorization: Bearer …)" }, 401);
  }
  const [session, roster, paused] = await Promise.all([
    getActiveSession(c.env.HPS_KV, cohortId),
    getRoster(c.env.HPS_KV, cohortId),
    getCohortPause(c.env.HPS_KV, cohortId),
  ]);
  const scopedIds = authz.scope.profiles ?? [];
  // #384 — hide dashboard_hidden tracks from the console (session cards + mint
  // dropdown both read this), and order by dashboard_order (lower first; absent
  // sorts last, then registry order). Does not touch /v1/profile resolution.
  const profiles = listProfiles()
    .filter((p) => p.session.cohort_id === cohortId)
    .filter((p) => scopedIds.includes(p.id))
    .filter((p) => p.dashboard_hidden !== true)
    .sort((a, b) => (a.dashboard_order ?? Number.MAX_SAFE_INTEGER) - (b.dashboard_order ?? Number.MAX_SAFE_INTEGER))
    .map((p) => ({ id: p.id, display_name: p.display_name }));
  // #1006 IC-02 — reviewed neutral execution templates the admin put in this
  // scope. Listed even when dashboard_hidden (they are authoring choices, not
  // console session cards). Scope is the only grant; the flag never widens it.
  const templates = listProfiles()
    .filter((p) => p.execution_template === true && p.session.cohort_id === cohortId && scopedIds.includes(p.id))
    .map((p) => ({ id: p.id, display_name: p.display_name, revision: p.version }));
  return c.json({
    id: cohortId,
    now: new Date().toISOString(),
    session,
    roster_size: roster?.users.length ?? 0,
    paused,
    profiles,
    templates,
    // Server-authoritative caps so the console renders the same limits the
    // Service's mutation endpoints will enforce on the forwarded writes.
    scope: {
      can_start_session: authz.scope.can_start_session === true,
      max_session_hours: authz.scope.max_session_hours ?? 4,
      max_hours: authz.scope.max_hours ?? 12,
    },
  });
});
