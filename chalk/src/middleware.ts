import type { Context, Next } from "hono";
import type { ChalkEnv } from "./env.ts";

export type ChalkCtx = Context<{ Bindings: ChalkEnv; Variables: { requestId: string } }>;

export async function requestId(c: ChalkCtx, next: Next): Promise<void> {
  const cfRay = c.req.header("cf-ray");
  const id = cfRay ? cfRay.slice(0, 8) : crypto.randomUUID().slice(0, 8);
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
}

export function makeErrorBody(
  c: ChalkCtx,
  type: string,
  message: string,
  extra?: Record<string, unknown>,
): { error: { type: string; message: string; request_id: string } & Record<string, unknown> } {
  const request_id = c.get("requestId") ?? "no-request-id";
  return { error: { type, message, request_id, ...(extra ?? {}) } };
}
