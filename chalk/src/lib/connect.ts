// Lab login connection for the instructor console.
//
// Instructors no longer paste an issuer. `/connect/start` sends the browser to the
// Lab, which mints an issuer for the logged-in instructor and redirects back with a
// one-time code. `/connect/callback` trades that code server-to-server and keeps the
// issuer here, sealed (AES-GCM) in httpOnly cookies the page script cannot read.
// Every instructor call then takes its Bearer from that session, never from the
// request. Chalk still holds no storage binding: the cookie is the only copy.
//
// The issuer never appears in a URL, a response body or a log line. The status
// endpoint returns the member name, the expiry and the scope list (cohort ids and
// caps), which the pages used to read by decoding the pasted token themselves.

import type { ChalkCtx } from "../middleware.ts";
import type { ChalkEnv } from "../env.ts";

export const SESSION_COOKIE = "__Host-hps_chalk_session";
export const STATE_COOKIE = "__Host-hps_chalk_connect";
/** Header that carries the shared secret on Chalk's server-to-server Lab calls. */
export const CONNECT_SECRET_HEADER = "x-hps-chalk-connect-secret";
/** Pages a connection may return to. Anything else returns to /console. */
export const CONNECT_PAGES = ["/console", "/issuer", "/board", "/authoring", "/manage", "/budgets"] as const;
export const STATE_TTL_SEC = 600;
const MIN_SECRET_LENGTH = 32;
const CHUNK_LENGTH = 3600;
const MAX_CHUNKS = 4;

export interface Connection {
  token: string;
  name: string;
  handle: string;
  /** Unix seconds. */
  exp: number;
}

/** The shared secret, or null when it is unset or too short (the feature is then off). */
export function connectSecret(env: Pick<ChalkEnv, "HPS_CHALK_CONNECT_SECRET">): string | null {
  const v = env.HPS_CHALK_CONNECT_SECRET?.trim();
  return v && v.length >= MIN_SECRET_LENGTH ? v : null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** Random base64url string of `bytes` bytes. */
export function randomId(bytes = 32): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time string comparison through HMAC, so lengths leak nothing either. */
export async function sameString(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [x, y] = await Promise.all([crypto.subtle.sign("HMAC", key, enc.encode(a)), crypto.subtle.sign("HMAC", key, enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i]! ^ v[i]!;
  return diff === 0;
}

async function sealKey(secret: string): Promise<CryptoKey> {
  const mac = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", mac, enc.encode("hypeproof-chalk/session/v1"));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Seals a connection. The token's base64url payload is decoded before deflate,
 * because base64 hides the JSON's repetition; a 20-scope issuer then fits one cookie.
 */
export async function sealConnection(secret: string, conn: Connection): Promise<string> {
  // Keep the raw token when decoding would not round-trip byte for byte.
  let body: { p: string; s: string } | { t: string } = { t: conn.token };
  try {
    const [payload, sig] = conn.token.split(".");
    const json = dec.decode(unb64u(payload!));
    if (sig && `${b64u(enc.encode(json))}.${sig}` === conn.token) body = { p: json, s: sig };
  } catch { /* not base64url: stored as is */ }
  const plain = enc.encode(JSON.stringify({ v: 1, ...body, n: conn.name, h: conn.handle, e: conn.exp }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(secret), await pipe(plain, new CompressionStream("deflate-raw"))));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}

export async function openConnection(secret: string, sealed: string): Promise<Connection | null> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const packed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await sealKey(secret), unb64u(ct)));
    const o = JSON.parse(dec.decode(await pipe(packed, new DecompressionStream("deflate-raw")))) as Record<string, unknown>;
    const token = typeof o.t === "string" ? o.t
      : typeof o.p === "string" && typeof o.s === "string" ? `${b64u(enc.encode(o.p))}.${o.s}` : "";
    // The GCM tag already proves Chalk sealed this; the callback checked the shape.
    if (o.v !== 1 || !/^\S{1,8192}$/.test(token) || typeof o.e !== "number") return null;
    return { token, name: typeof o.n === "string" ? o.n : "", handle: typeof o.h === "string" ? o.h : "", exp: o.e };
  } catch {
    // Wrong key (the secret rotated) or a tampered cookie: treat as not connected.
    return null;
  }
}

export function readCookies(header: string | undefined | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

const chunkName = (i: number) => (i === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}_${i}`);
const attrs = (maxAge: number, sameSite: "Strict" | "Lax" = "Strict") =>
  `Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.max(0, Math.floor(maxAge))}`;

/** Set-Cookie values for a sealed session (split when it is long). */
export function sessionCookies(sealed: string, maxAge: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < sealed.length; i += CHUNK_LENGTH) parts.push(sealed.slice(i, i + CHUNK_LENGTH));
  if (parts.length > MAX_CHUNKS) throw new Error("session too large");
  const set = parts.map((p, i) => `${chunkName(i)}=${i === 0 ? `${parts.length}~` : ""}${p}; ${attrs(maxAge)}`);
  for (let i = parts.length; i < MAX_CHUNKS; i++) set.push(`${chunkName(i)}=; ${attrs(0)}`);
  return set;
}

export function clearSessionCookies(): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `${chunkName(i)}=; ${attrs(0)}`);
}

export function stateCookie(value: string): string {
  return `${STATE_COOKIE}=${value}; ${attrs(STATE_TTL_SEC, "Lax")}`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; ${attrs(0, "Lax")}`;
}

/** The connection in this request's cookies. `expired` when one was there but has ended. */
export async function readConnection(
  c: ChalkCtx,
): Promise<{ connection: Connection | null; expired: boolean }> {
  const secret = connectSecret(c.env);
  const jar = readCookies(c.req.header("cookie"));
  const head = jar.get(SESSION_COOKIE);
  if (!secret || !head) return { connection: null, expired: false };
  const m = /^([1-4])~(.*)$/.exec(head);
  if (!m) return { connection: null, expired: false };
  let sealed = m[2]!;
  for (let i = 1; i < Number(m[1]); i++) sealed += jar.get(chunkName(i)) ?? "";
  const conn = await openConnection(secret, sealed);
  if (!conn) return { connection: null, expired: false };
  if (conn.exp <= Math.floor(Date.now() / 1000)) return { connection: null, expired: true };
  return { connection: conn, expired: false };
}

export interface ScopeView {
  cohort: string;
  profiles: string[];
  max_hours?: number;
  can_start_session?: boolean;
  max_session_hours?: number;
  ops?: string[];
}

/**
 * Display claims of an issuer: handle, expiry and scopes. Not verified (the Service
 * verifies every call); used only to tell the pages which cohorts to offer.
 */
export function issuerClaims(token: string): { u: string; exp: number; scopes: ScopeView[] } | null {
  try {
    const p = JSON.parse(dec.decode(unb64u(token.split(".")[0]!))) as Record<string, unknown>;
    const scopes = Array.isArray(p.scopes) ? p.scopes : [];
    return {
      u: typeof p.u === "string" ? p.u : "",
      exp: typeof p.exp === "number" ? p.exp : 0,
      scopes: scopes.flatMap((s): ScopeView[] => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        if (typeof o.cohort !== "string" || !Array.isArray(o.profiles)) return [];
        return [{
          cohort: o.cohort,
          profiles: o.profiles.filter((x): x is string => typeof x === "string"),
          ...(typeof o.max_hours === "number" ? { max_hours: o.max_hours } : {}),
          ...(o.can_start_session === true ? { can_start_session: true } : {}),
          ...(typeof o.max_session_hours === "number" ? { max_session_hours: o.max_session_hours } : {}),
          ...(Array.isArray(o.ops) ? { ops: o.ops.filter((x): x is string => typeof x === "string") } : {}),
        }];
      }),
    };
  } catch {
    return null;
  }
}

/** A state-changing request must come from a Chalk page: the cookie alone is not enough. */
export function sameOriginWrite(c: ChalkCtx): boolean {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return c.req.header("origin") === new URL(c.req.url).origin;
}

export type InstructorAuth = { ok: true; authorization: string } | { ok: false; status: 401 | 403; reason: string; message: string };

/**
 * The instructor credential for this request: the connected issuer, and only that.
 * A request that brings its own Authorization header is refused, so a pasted token
 * has no way in.
 */
export async function instructorAuthorization(c: ChalkCtx): Promise<InstructorAuth> {
  if (c.req.header("authorization") !== undefined) {
    return { ok: false, status: 401, reason: "issuer_header_refused", message: "강사 토큰은 받지 않습니다. ‘Lab 로그인으로 연결’로 연결해주세요." };
  }
  const { connection, expired } = await readConnection(c);
  if (!connection) {
    return expired
      ? { ok: false, status: 401, reason: "connection_expired", message: "강사 연결이 만료됐습니다. ‘다시 연결’을 눌러주세요." }
      : { ok: false, status: 401, reason: "not_connected", message: "‘Lab 로그인으로 연결’로 강사 권한을 먼저 연결해주세요." };
  }
  if (!sameOriginWrite(c)) {
    return { ok: false, status: 403, reason: "cross_origin", message: "다른 사이트에서 보낸 요청은 받지 않습니다." };
  }
  return { ok: true, authorization: `Bearer ${connection.token}` };
}
