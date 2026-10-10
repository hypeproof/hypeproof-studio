// Same-origin Chalk path; Service owns authorization, profile filtering and reads.
import { Hono } from "hono";
import { resolveServiceOrigin, type ChalkEnv } from "../env.ts";

export const state = new Hono<{ Bindings: ChalkEnv; Variables: { requestId: string } }>();

state.get("/cohorts/:id/state", async (c) => {
  const rid = c.get("requestId") ?? "no-request-id";
  const auth = c.req.header("authorization") ?? "";
  c.header("cache-control", "no-store");
  if (!/^Bearer\s+\S/i.test(auth.trim())) {
    return c.json({ error: "instructor issuer token required (Authorization: Bearer …)" }, 401);
  }
  const target = `${resolveServiceOrigin(c.env)}/admin/chalk/cohorts/${encodeURIComponent(c.req.param("id"))}/state`;
  try {
    const upstream = await fetch(target, {
      headers: { authorization: auth.trim(), "x-request-id": rid },
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": rid,
    });
    const serviceRid = upstream.headers.get("x-request-id");
    if (serviceRid) headers.set("x-hps-service-request-id", serviceRid);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return c.json({ error: { type: "upstream", message: "service state unavailable", request_id: rid } }, 502);
  }
});
