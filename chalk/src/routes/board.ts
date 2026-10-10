// The Service owns roster reads, aggregation and calibrated seat verdicts.
import { Hono } from "hono";
import type { ChalkEnv } from "../env.ts";
import { forwardServiceRead } from "../lib/service-read.ts";

export const board = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();
board.get("/cohorts/:id/board", (c) => forwardServiceRead(c, "board"));
