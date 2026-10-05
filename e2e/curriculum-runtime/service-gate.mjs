// cr-e2e (#1400) — which requests may reach the local Service of app-service.mjs, decided before the
// Service router sees them.
//
// The dev kit puts this Service behind an ngrok tunnel so a phone can open a published test link
// (scripts/cr-dev-kit.sh --phone: one shared test origin). Through a tunnel only the published runtime
// (`/l/…`) may answer. The Service's API (/v1, /admin) and the spec-only control routes (/__cr/) stay on
// this Mac. The decision is made on the path the router will route, never on the raw request target,
// and by allowlist, never by naming the tunnel's host:
//
//   1. The request target must be origin-form ("/…", not "//…", "*" or absolute-form). Its path must
//      contain no dot segment ("." or ".."), no encoded dot, slash or backslash (%2e, %2f, %5c), no
//      backslash and no fragment, and parsing must leave it unchanged. Anything else is refused,
//      whatever the Host.
//   2. A loopback Host (127.0.0.1, localhost or [::1], any port) on a request that carries no forwarding
//      header (a tunnel adds X-Forwarded-For) is this Mac: every path, the /__cr/ control routes included.
//   3. A dedicated test-origin Host (HPS_TEST_ORIGIN with {project}: a prj-<hex> label under the
//      template's suffix, on its port) reaches every path but /__cr/. The router hands that whole host
//      to the published runtime (worker/src/index.ts), so nothing of the API answers on it.
//   4. Any other Host reaches /l/… only. That covers a tunnel's host, a shared origin's, a variant of
//      one with a port or other letter case, and a request with no Host at all.
//
// A refusal is a 404 carrying `x-hps-dev-gate: refused`, so a check can tell the gate's answer from the
// router's (cr-dev-kit.sh probes its tunnel this way before it prints the address).
import { matchTestOrigin, parseTestOrigin } from "../../worker/src/lib/curriculum/test-origin.ts";

export const GATE_HEADER = "x-hps-dev-gate";
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const HOST_LIKE = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/;
const FORWARDED = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip"];
const SPECIAL = /%2e|%2f|%5c/i;

/** Is `host` a project origin of a dedicated (`{project}`) test-origin template? */
function dedicatedTestOrigin(host, template, environment) {
  const parsed = parseTestOrigin(template, environment);
  if (!parsed.ok || parsed.config.mode !== "dedicated") return false;
  let url;
  try {
    url = new URL(`${parsed.config.scheme}//${host}/`);
  } catch {
    return false;
  }
  return matchTestOrigin(parsed.config, url) !== null;
}

/**
 * The gate's verdict on one request.
 *
 * @param {{ url?: string; headers: Record<string, string | string[] | undefined> }} req the Node request
 * @param {{ testOrigin?: string; environment?: string }} service the Service's HPS_TEST_ORIGIN and ENVIRONMENT
 * @returns {{ ok: true; kind: "local" | "test-origin" | "other"; host: string | null; pathname: string; search: string } | { ok: false; why: string }}
 *   `host` is the Host header to route by (lowercased; null when absent or not a host name).
 */
export function gate(req, service) {
  const raw = typeof req.url === "string" ? req.url : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return { ok: false, why: "not_origin_form" };
  if (raw.includes("#")) return { ok: false, why: "fragment" };
  const q = raw.indexOf("?");
  const rawPath = q < 0 ? raw : raw.slice(0, q);
  if (rawPath.includes("\\") || SPECIAL.test(rawPath) || rawPath.split("/").some((s) => s === "." || s === "..")) return { ok: false, why: "path_not_canonical" };
  let url;
  try {
    url = new URL(`http://gate.invalid${raw}`);
  } catch {
    return { ok: false, why: "unparsable" };
  }
  if (url.host !== "gate.invalid" || url.pathname !== rawPath) return { ok: false, why: "path_not_canonical" };

  const header = req.headers.host;
  const host = typeof header === "string" && HOST_LIKE.test(header.trim().toLowerCase()) ? header.trim().toLowerCase() : null;
  const forwarded = FORWARDED.some((h) => req.headers[h] !== undefined);
  let kind = "other";
  if (host && !forwarded && LOOPBACK.test(host)) kind = "local";
  else if (host && !forwarded && dedicatedTestOrigin(host, service.testOrigin, service.environment)) kind = "test-origin";

  const control = url.pathname === "/__cr" || url.pathname.startsWith("/__cr/");
  if (control && kind !== "local") return { ok: false, why: "control_route" };
  if (kind === "other" && !url.pathname.startsWith("/l/")) return { ok: false, why: "api_not_exposed" };
  return { ok: true, kind, host, pathname: url.pathname, search: url.search };
}
