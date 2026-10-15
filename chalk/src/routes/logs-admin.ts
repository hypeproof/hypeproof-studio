// Metadata reads and operator-only raw retrieval retain their existing public
// paths. The Service owns authorization, consent checks and R2 access.
import { Hono } from "hono";
import type { ChalkEnv } from "../env.ts";
import { forwardServiceRead } from "../lib/service-read.ts";

export const logsAdmin = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
logsAdmin.get("/cohorts/:id/logs", (c) => forwardServiceRead(c, "logs", { operator: true }));
logsAdmin.get("/cohorts/:id/logs/:seat", (c) =>
  forwardServiceRead(c, `logs/${encodeURIComponent(c.req.param("seat"))}`, { operator: true }),
);
logsAdmin.get("/cohorts/:id/logs/:seat/:day/:session/:filename", (c) =>
  forwardServiceRead(c, ["logs", "seat", "day", "session", "filename"].map((part, i) =>
    i === 0 ? part : encodeURIComponent(c.req.param(part) ?? ""),
  ).join("/"), { operator: true, retrieval: true }),
);
