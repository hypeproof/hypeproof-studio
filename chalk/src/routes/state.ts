// The Service owns authorization, profile filtering and state reads.
import { Hono } from "hono";
import type { ChalkEnv } from "../env.ts";
import { forwardServiceRead } from "../lib/service-read.ts";

export const state = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
state.get("/cohorts/:id/state", (c) => forwardServiceRead(c, "state"));
