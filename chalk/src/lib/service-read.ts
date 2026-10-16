// Bounded read transport shared by Chalk routes. The upstream verdict and bytes
// remain authoritative; an unavailable Service never becomes an empty board.
import type { ChalkCtx } from "../middleware.ts";
import { resolveServiceOrigin } from "../env.ts";

export async function forwardServiceRead(
  c: ChalkCtx,
  suffix: string,
  options: { operator?: boolean; retrieval?: boolean } = {},
): Promise<Response> {
  const rid = c.get("requestId") ?? "no-request-id";
  c.header("cache-control", "no-store");
  const auth = c.req.header("authorization")?.trim() ?? "";
  const headers = new Headers({ "x-request-id": rid });
  if (/^Bearer\s+\S/i.test(auth)) headers.set("authorization", auth);
  if (options.operator) {
    const operatorSecret = c.req.header("x-hps-operator-secret");
    if (operatorSecret) headers.set("x-hps-operator-secret", operatorSecret);
    const access = c.req.header("cf-access-authenticated-user-email")?.trim();
    const transportSecret = c.env.HPS_CHALK_SERVICE_SECRET?.trim();
    if (access && transportSecret && transportSecret.length >= 32) {
      headers.set("x-hps-chalk-operator-identity", access);
      headers.set("x-hps-chalk-service-secret", transportSecret);
    }
  }
  if (!options.retrieval && !headers.has("authorization") &&
      !headers.has("x-hps-operator-secret") && !headers.has("x-hps-chalk-operator-identity")) {
    return c.json({ error: "instructor issuer token required (Authorization: Bearer …)" }, 401);
  }
  const search = new URL(c.req.url).search;
  const cohortId = c.req.param("id");
  if (!cohortId) return c.json({ error: "invalid cohort id" }, 400);
  const target = `${resolveServiceOrigin(c.env)}/admin/chalk/cohorts/${encodeURIComponent(cohortId)}/${suffix}${search}`;
  try {
    // workerd rejects redirect: "error" (it throws before sending), so take
    // "manual" and refuse any 3xx ourselves.
    const upstream = await fetch(target, {
      method: "GET", headers, signal: AbortSignal.timeout(8_000), redirect: "manual",
    });
    if (upstream.status >= 300 && upstream.status < 400) throw new Error(`upstream redirect ${upstream.status}`);
    const out = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": rid,
    });
    for (const name of ["content-length", "x-hps-log-key"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    const serviceRid = upstream.headers.get("x-request-id");
    if (serviceRid) out.set("x-hps-service-request-id", serviceRid);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return c.json({ error: { type: "upstream", message: "service read unavailable", request_id: rid } }, 502);
  }
}
