// Chalk owns pages and HTTP transport. It has no participant storage bindings,
// token signing key, provider key or administrator password.
export interface ChalkEnv {
  ENVIRONMENT: "production" | "dev";
  HPS_CHALK_VERSION?: string;
  HPS_SERVICE_ORIGIN?: string;
  /** Local integration testing only; production token reads use the fixed Lab origin. */
  HPS_LAB_ORIGIN?: string;
  // Server-to-server credential for attesting an Access operator to Service.
  // Never included in App/browser requests or instructor write forwarding.
  HPS_CHALK_SERVICE_SECRET?: string;
}

export const DEFAULT_SERVICE_ORIGIN = "https://api.hypeproof-ai.xyz";

export function resolveChalkVersion(env: Pick<ChalkEnv, "HPS_CHALK_VERSION">): string {
  const v = env.HPS_CHALK_VERSION;
  return typeof v === "string" && v.trim().length > 0 ? v : "unknown";
}

export function resolveServiceOrigin(env: Pick<ChalkEnv, "HPS_SERVICE_ORIGIN">): string {
  const v = env.HPS_SERVICE_ORIGIN?.trim();
  return v && v.length > 0 ? v.replace(/\/+$/, "") : DEFAULT_SERVICE_ORIGIN;
}
