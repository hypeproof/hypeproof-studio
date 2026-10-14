// site_check: a deterministic 390/1280 check of the learner's page (orchestrator
// spec §6.1, FO-09). Pure and vscode-free.
//
// - The measurement is one script for ONE CDP `Runtime.evaluate` in the live
//   server's `/__hp_viewport` wrapper (liveServerHelpers serveViewport). The
//   shipped shell ignores Emulation.setDeviceMetricsOverride
//   (experimentBrowser readViewport), so the script sets the wrapper iframe's
//   width and measures the page inside it, which is same-origin.
// - The verdict is computed here from what the script returned. The CDP runner
//   (A4, siteCheckRunner.ts) only sends `siteCheckExpression` and passes the value
//   to `siteCheckResult`.
// - Zero model requests: nothing here and nothing the script does calls the
//   gateway. The script reloads the page from the local live server only.
// - The floor is "no claim it did not observe": a page not measured at both
//   widths is never `pass`. Without a measurement the verdict is `unverified`.

/** The two reference widths of the homepage quality floor (REQ-STUDIO-PREVIEW-WIDTH). */
export const SITE_CHECK_WIDTHS = [390, 1280] as const;
/** The whole check, load and both widths, must finish inside this budget. */
export const SITE_CHECK_BUDGET_MS = 5000;
/** PostToolUse `additionalContext` limit (spec §6.1). */
export const SITE_CHECK_SUMMARY_MAX = 400;

/** An element is past the edge when its right side is beyond innerWidth + 1px (sub-pixel layout). */
const OVERFLOW_TOLERANCE_PX = 1;
const BODY_FONT_MIN_PX = 16;
const OFFENDER_LIMIT = 5;
const SAMPLE_LIMIT = 5;
const HOST_LIMIT = 3;
const LABEL_MAX = 80;

export type SiteCheckVerdict = "pass" | "fail" | "unverified";

/**
 * Why nothing (or not everything) was measured. The runner reports the first
 * four; the script reports the next five; `invalid` and `wrong_page` come from
 * reading its value; `partial` means a width is missing.
 */
export type SiteCheckUnverifiedReason =
  | "no_preview" | "no_cdp" | "timeout" | "error"
  | "no_frame" | "reloaded" | "missing" | "not_html" | "bad_target"
  | "invalid" | "wrong_page" | "partial";

export interface SiteCheckWidth {
  w: number;
  measured: boolean;
  inner: number | null;
  scroll: number | null;
  overflow_px: number | null;
  /** Up to 5 outermost elements past the right edge, in document order. */
  offenders: string[];
  /** All of them, when there are more than 5. */
  offender_count: number;
  /** In-flow content cut at the visible edge by a box with `overflow-x: hidden|clip`: overflow hidden instead of fixed. */
  clipped: number;
  /** html or body has `overflow-x: hidden|clip`, so the learner cannot scroll to the overflow. */
  root_clips: boolean;
}

export interface SiteCheckChecks {
  viewport_meta: boolean;
  img_without_alt: number;
  /** Distinct resources loaded from another origin (the preview contract forbids them). */
  external_urls: number;
  body_font_px: number;
  /** Tap targets under 44×44px, inline links in a sentence excepted. Advice: not part of the verdict. */
  small_targets: number;
}

export interface SiteCheckResult {
  verdict: SiteCheckVerdict;
  widths: SiteCheckWidth[];
  /** The worst value over the measured widths; null when nothing was measured. */
  checks: SiteCheckChecks | null;
  /** Why the verdict is `fail`: `overflow@390`, `clipped@390`, `viewport_meta`, `img_without_alt`, `external_urls`, `body_font`. */
  fail_reasons: string[];
  unverified_reason?: SiteCheckUnverifiedReason;
  samples: { small_targets: string[]; external_hosts: string[] };
  measured_at: string;
  path: string;
}

/**
 * The page path the wrapper loads, from a workspace-relative `.html` path.
 * Null for anything else: absolute, `..`, backslashes, other types, and the
 * app's own `.hypeproof/` folder.
 */
export function siteCheckTarget(relPath: string = "index.html"): string | null {
  const p = String(relPath ?? "").trim().replace(/^\.\//, "");
  if (!p || p.startsWith("/") || p.includes("\\") || /^[a-z]:/i.test(p) || /[?#]/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return null;
  if (parts[0].toLowerCase() === ".hypeproof") return null;
  if (!/\.html?$/i.test(p)) return null;
  return "/" + parts.join("/");
}

/** The wrapper URL path for a target from `siteCheckTarget`. */
export function viewportWrapperPath(target: string): string {
  return `/__hp_viewport?path=${encodeURIComponent(target)}`;
}

// The script runs in the wrapper page. It takes `window`, the target path, the
// widths and the budget, and resolves to `{ path, widths: [...] }` or to
// `{ error }`. It must stay plain JavaScript for every browser the shell ships:
// it is sent as text, so the TypeScript compiler never sees it.
const SITE_CHECK_PROGRAM = String.raw`async (top, target, widths, budgetMs) => {
  const deadline = Date.now() + budgetMs;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = top.document.getElementById("site");
  if (!frame || String(frame.tagName).toUpperCase() !== "IFRAME") return { error: "no_frame" };
  let targetPath;
  try { targetPath = new URL(target, top.location.href).pathname; } catch (e) { return { error: "bad_target" }; }
  const docOf = () => { try { return frame.contentDocument || null; } catch (e) { return null; } };
  const restoreWidth = frame.style.width;

  const measure = (win, w) => {
    const doc = win.document;
    const root = doc.documentElement;
    const body = doc.body;
    const inner = win.innerWidth;
    const limit = inner + ${OVERFLOW_TOLERANCE_PX};
    const style = (el) => win.getComputedStyle(el);
    const visible = (cs) => cs.visibility !== "hidden" && cs.visibility !== "collapse" && Number(cs.opacity) !== 0;
    const clipsX = (el) => { const o = style(el).overflowX; return o === "hidden" || o === "clip"; };
    // overflow-x: hidden or clip on html/body still leaves the overflow in
    // scrollWidth (measured in Chromium), so the band-aid shows up as overflow.
    const scroll = Math.max(root ? root.scrollWidth : 0, body ? body.scrollWidth : 0);
    const rootClips = !!((root && clipsX(root)) || (body && clipsX(body)));
    // What the learner sees: a classic scrollbar takes its width out of innerWidth.
    const shown = root && root.clientWidth > 0 ? Math.min(root.clientWidth, inner) : inner;
    const SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, BR: 1, WBR: 1, TITLE: 1 };
    const inBody = body ? Array.prototype.slice.call(body.querySelectorAll("*"), 0, 6000).filter((el) => !SKIP[el.tagName]) : [];
    const order = new Map(inBody.map((el, i) => [el, i]));
    const classes = (el) => String(el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
    const own = (el) => {
      const tag = String(el.tagName).toLowerCase();
      const id = el.getAttribute("id");
      if (id) return tag + "#" + id;
      const cls = classes(el).slice(0, 2);
      return cls.length ? tag + "." + cls.join(".") : tag;
    };
    const label = (el) => {
      const mine = own(el);
      if (mine.indexOf("#") < 0 && mine.indexOf(".") < 0) {
        for (let p = el.parentElement; p && p !== body && p !== root; p = p.parentElement) {
          const id = p.getAttribute("id");
          if (id) return ("#" + id + " " + mine).slice(0, ${LABEL_MAX});
          const cls = classes(p)[0];
          if (cls) return ("." + cls + " " + mine).slice(0, ${LABEL_MAX});
        }
      }
      return mine.slice(0, ${LABEL_MAX});
    };
    // What keeps an element's overflow off the page: a box between it and the
    // page that fits and does not show overflow sideways. "scrolls" (auto or
    // scroll: a carousel, a table wrapper) can be scrolled to; "cut" (hidden or
    // clip) cannot.
    const keeper = (el) => {
      let cut = false;
      for (let p = el.parentElement; p && p !== body && p !== root; p = p.parentElement) {
        const o = style(p).overflowX;
        if (o === "visible" || p.getBoundingClientRect().right > limit) continue;
        if (o === "auto" || o === "scroll") return "scrolls";
        cut = true;
      }
      return cut ? "cut" : null;
    };

    // Boxes past the edge, outermost only (a wide table, not each of its cells).
    // Out of flow and cut on purpose (a decorative shape in an overflow-hidden
    // hero) is not an offender.
    const boxes = [];
    let lastBox = null;
    for (const el of inBody) {
      if (lastBox && lastBox.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.width <= 0 && r.height <= 0) || r.right <= limit) continue;
      const cs = style(el);
      if (!visible(cs)) continue;
      const kept = keeper(el);
      if (kept === "scrolls") continue;
      if (kept === "cut" && (cs.position === "absolute" || cs.position === "fixed")) continue;
      boxes.push({ el, left: r.left, cut: kept === "cut" });
      lastBox = el;
    }
    // Text past the edge of a box that fits (a long word in a heading), the
    // innermost such box only. Children come before parents in reverse order.
    const texts = [];
    for (let i = inBody.length - 1; i >= 0; i--) {
      const el = inBody[i];
      if (!(el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > limit || r.left + el.scrollWidth <= limit) continue;
      if (boxes.some((b) => b.el.contains(el) || el.contains(b.el))) continue;
      if (texts.some((t) => el.contains(t.el))) continue;
      const cs = style(el);
      if (cs.overflowX !== "visible" || !visible(cs)) continue;
      const kept = keeper(el);
      if (kept === "scrolls") continue;
      texts.push({ el, left: r.left, cut: kept === "cut" });
    }
    let offenders = boxes.concat(texts).sort((a, b) => order.get(a.el) - order.get(b.el));
    // When nothing overflows the page, only what the visible edge cuts through
    // counts; a panel wholly outside it (an off-canvas menu) does not.
    if (scroll <= limit) offenders = offenders.filter((o) => o.left < shown - 1);
    // Content a box cuts at the edge: hidden on a wrapper instead of fixed.
    const clipped = offenders.filter((o) => o.cut && o.left < shown - 1).length;

    // Tap targets. WCAG's inline exception: a link inside a sentence.
    let small = 0;
    const smallSample = [];
    for (const el of inBody) {
      const tag = el.tagName;
      const type = String(el.getAttribute("type") || "").toLowerCase();
      const role = el.getAttribute("role");
      const interactive = (tag === "A" && el.hasAttribute("href")) || tag === "BUTTON" || tag === "SELECT" ||
        tag === "TEXTAREA" || tag === "SUMMARY" || (tag === "INPUT" && type !== "hidden") || role === "button" || role === "link";
      if (!interactive || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= shown) continue;
      const cs = style(el);
      if (!visible(cs)) continue;
      if (cs.display === "inline" && el.parentNode && Array.prototype.some.call(el.parentNode.childNodes, (n) => n.nodeType === 3 && /\S/.test(n.textContent || ""))) continue;
      if (tag === "INPUT" && (type === "checkbox" || type === "radio") && el.labels && el.labels.length) continue;
      if (r.width < 44 || r.height < 44) {
        small++;
        if (smallSample.length < ${SAMPLE_LIMIT}) smallSample.push(label(el));
      }
    }

    // Document checks: viewport meta, alt, resources from another origin.
    let viewportMeta = false;
    let imgWithoutAlt = 0;
    const external = new Set();
    const origin = win.location.origin;
    const note = (raw) => {
      if (!raw) return;
      let url;
      try { url = new URL(String(raw).trim(), doc.baseURI); } catch (e) { return; }
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) external.add(url.href);
    };
    for (const el of Array.prototype.slice.call(doc.querySelectorAll("*"), 0, 20000)) {
      const tag = el.tagName;
      if (tag === "META" && String(el.getAttribute("name") || "").toLowerCase() === "viewport") viewportMeta = true;
      if (tag === "IMG" && !el.hasAttribute("alt")) imgWithoutAlt++;
      if (tag === "IMG" || tag === "SCRIPT" || tag === "IFRAME" || tag === "EMBED" || tag === "SOURCE" ||
        tag === "AUDIO" || tag === "VIDEO" || tag === "TRACK" || tag === "INPUT") note(el.getAttribute("src"));
      if (tag === "IMG" || tag === "SOURCE") String(el.getAttribute("srcset") || "").split(",").forEach((c) => note(c.trim().split(/\s+/)[0]));
      if (tag === "VIDEO") note(el.getAttribute("poster"));
      if (tag === "OBJECT") note(el.getAttribute("data"));
      if (tag === "LINK" && /(^|\s)(stylesheet|icon|preload|prefetch|modulepreload|manifest|apple-touch-icon)(\s|$)/i.test(String(el.getAttribute("rel") || ""))) note(el.getAttribute("href"));
    }
    try { for (const entry of win.performance.getEntriesByType("resource")) note(entry.name); } catch (e) {}
    const hosts = [];
    for (const href of external) { const host = new URL(href).host; if (hosts.indexOf(host) < 0) hosts.push(host); }
    const fontPx = body ? parseFloat(style(body).fontSize) : NaN;

    return {
      w, inner, scroll, root_clips: rootClips,
      offenders: offenders.slice(0, ${OFFENDER_LIMIT}).map((o) => label(o.el)), offender_count: offenders.length, clipped,
      viewport_meta: viewportMeta, img_without_alt: imgWithoutAlt, external_urls: external.size,
      external_hosts: hosts.slice(0, ${HOST_LIMIT}),
      body_font_px: Number.isFinite(fontPx) ? Math.round(fontPx * 10) / 10 : null,
      small_targets: small, small_target_sample: smallSample,
    };
  };

  const attempt = async () => {
    // Load the file as saved now: the live server's own reload may not have arrived yet.
    const previous = docOf();
    frame.src = target;
    let doc = null;
    for (;;) {
      const d = docOf();
      if (d && d !== previous && d.readyState === "complete" && d.location && d.location.pathname === targetPath) { doc = d; break; }
      if (Date.now() > deadline) return { error: "timeout" };
      await wait(25);
    }
    const win = frame.contentWindow;
    try {
      const nav = win.performance.getEntriesByType("navigation")[0];
      if (nav && nav.responseStatus >= 400) return { error: "missing" };
    } catch (e) {}
    if (doc.contentType && doc.contentType !== "text/html") return { error: "not_html" };
    const measured = [];
    for (const w of widths) {
      frame.style.width = w + "px";
      void frame.offsetWidth;
      while (win.innerWidth !== w) {
        if (Date.now() > deadline) return { error: "timeout" };
        await wait(16);
      }
      if (docOf() !== doc) return { error: "reloaded" };
      measured.push(measure(win, w));
    }
    if (docOf() !== doc) return { error: "reloaded" };
    return { path: doc.location.pathname, widths: measured };
  };

  try {
    let result = await attempt();
    if (result.error === "reloaded" && Date.now() < deadline) result = await attempt();
    return result;
  } finally {
    frame.style.width = restoreWidth;
  }
}`;

/**
 * The expression for `Runtime.evaluate` in the wrapper page, with
 * `awaitPromise: true` and `returnByValue: true`. It navigates the wrapper's
 * iframe to `target` (a path from `siteCheckTarget`), measures at each width,
 * restores the iframe width, and resolves within `budgetMs`.
 */
export function siteCheckExpression(
  target: string,
  opts: { widths?: readonly number[]; budgetMs?: number } = {},
): string {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    throw new TypeError(`site check target must be a local page path, got ${JSON.stringify(target)}`);
  }
  const widths = [...(opts.widths ?? SITE_CHECK_WIDTHS)];
  const budget = opts.budgetMs ?? SITE_CHECK_BUDGET_MS;
  return `(${SITE_CHECK_PROGRAM})(window, ${JSON.stringify(target)}, ${JSON.stringify(widths)}, ${JSON.stringify(budget)})`;
}

// ── Reading the script's value ──────────────────────────────────────────────

interface MeasuredWidth {
  w: number;
  inner: number;
  scroll: number;
  offenders: string[];
  offender_count: number;
  clipped: number;
  root_clips: boolean;
  viewport_meta: boolean;
  img_without_alt: number;
  external_urls: number;
  external_hosts: string[];
  body_font_px: number;
  small_targets: number;
  small_target_sample: string[];
}

const SCRIPT_ERRORS = new Set<SiteCheckUnverifiedReason>(["no_frame", "reloaded", "missing", "not_html", "bad_target", "timeout"]);

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function strings(v: unknown, limit: number): string[] | null {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) return null;
  return v.slice(0, limit).map((s) => s.slice(0, LABEL_MAX));
}

/** One width of the script's value, or null when it is not a measurement at width `w`. */
function readWidth(raw: unknown, w: number): MeasuredWidth | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  // Measured at the requested width, or it is not that width's measurement.
  if (m.w !== w || m.inner !== w) return null;
  const scroll = count(m.scroll);
  const offenders = strings(m.offenders, OFFENDER_LIMIT);
  const offenderCount = count(m.offender_count);
  const clipped = count(m.clipped);
  const img = count(m.img_without_alt);
  const external = count(m.external_urls);
  const hosts = strings(m.external_hosts, HOST_LIMIT);
  const small = count(m.small_targets);
  const sample = strings(m.small_target_sample, SAMPLE_LIMIT);
  const font = typeof m.body_font_px === "number" && Number.isFinite(m.body_font_px) && m.body_font_px > 0 ? m.body_font_px : null;
  if (scroll === null || offenders === null || offenderCount === null || clipped === null || img === null ||
    external === null || hosts === null || small === null || sample === null || font === null ||
    typeof m.viewport_meta !== "boolean" || typeof m.root_clips !== "boolean") {
    return null;
  }
  return {
    w, inner: w, scroll, offenders, offender_count: offenderCount, clipped, root_clips: m.root_clips,
    viewport_meta: m.viewport_meta, img_without_alt: img, external_urls: external, external_hosts: hosts,
    body_font_px: font, small_targets: small, small_target_sample: sample,
  };
}

function unmeasured(w: number): SiteCheckWidth {
  return { w, measured: false, inner: null, scroll: null, overflow_px: null, offenders: [], offender_count: 0, clipped: 0, root_clips: false };
}

export interface SiteCheckInput {
  /** Workspace-relative page path, as given to `siteCheckTarget`. */
  path: string;
  /** The value `siteCheckExpression` resolved to (an object, or its JSON text). */
  evaluation?: unknown;
  /** Set by the runner when it could not evaluate at all. Wins over `evaluation`. */
  unverified?: SiteCheckUnverifiedReason;
  now?: Date;
}

/**
 * The verdict. `fail` needs an observed defect: horizontal overflow or clipped
 * content at a measured width, no viewport meta, an image without alt, a
 * resource from another origin, or body text under 16px. `pass` needs both
 * widths measured and none of those. Anything else is `unverified`, so a
 * missing measurement can never read as a pass.
 */
export function siteCheckResult(input: SiteCheckInput): SiteCheckResult {
  const measuredAt = (input.now ?? new Date()).toISOString();
  const path = String(input.path ?? "");
  const unverified = (reason: SiteCheckUnverifiedReason): SiteCheckResult => ({
    verdict: "unverified",
    widths: SITE_CHECK_WIDTHS.map(unmeasured),
    checks: null,
    fail_reasons: [],
    unverified_reason: reason,
    samples: { small_targets: [], external_hosts: [] },
    measured_at: measuredAt,
    path,
  });

  if (input.unverified) return unverified(input.unverified);
  let value = input.evaluation;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return unverified("invalid"); }
  }
  if (!value || typeof value !== "object") return unverified("invalid");
  const v = value as Record<string, unknown>;
  if (typeof v.error === "string") {
    return unverified(SCRIPT_ERRORS.has(v.error as SiteCheckUnverifiedReason) ? (v.error as SiteCheckUnverifiedReason) : "error");
  }
  const target = siteCheckTarget(path);
  if (!target) return unverified("bad_target");
  if (v.path !== new URL(target, "http://localhost").pathname) return unverified("wrong_page");
  if (!Array.isArray(v.widths)) return unverified("invalid");

  const measured = new Map<number, MeasuredWidth>();
  for (const w of SITE_CHECK_WIDTHS) {
    const m = readWidth(v.widths.find((x) => (x as { w?: unknown } | null)?.w === w), w);
    if (m) measured.set(w, m);
  }
  if (measured.size === 0) return unverified("invalid");

  const failReasons: string[] = [];
  const widths = SITE_CHECK_WIDTHS.map((w): SiteCheckWidth => {
    const m = measured.get(w);
    if (!m) return unmeasured(w);
    const overflow = Math.max(0, m.scroll - m.inner);
    if (overflow > OVERFLOW_TOLERANCE_PX) failReasons.push(`overflow@${w}`);
    else if (m.clipped > 0) failReasons.push(`clipped@${w}`);
    return {
      w, measured: true, inner: m.inner, scroll: m.scroll, overflow_px: overflow,
      offenders: m.offenders, offender_count: Math.max(m.offender_count, m.offenders.length), clipped: m.clipped,
      root_clips: m.root_clips,
    };
  });

  const all = [...measured.values()];
  const checks: SiteCheckChecks = {
    viewport_meta: all.every((m) => m.viewport_meta),
    img_without_alt: Math.max(...all.map((m) => m.img_without_alt)),
    external_urls: Math.max(...all.map((m) => m.external_urls)),
    body_font_px: Math.min(...all.map((m) => m.body_font_px)),
    small_targets: Math.max(...all.map((m) => m.small_targets)),
  };
  if (!checks.viewport_meta) failReasons.push("viewport_meta");
  if (checks.img_without_alt > 0) failReasons.push("img_without_alt");
  if (checks.external_urls > 0) failReasons.push("external_urls");
  if (checks.body_font_px < BODY_FONT_MIN_PX) failReasons.push("body_font");

  const complete = measured.size === SITE_CHECK_WIDTHS.length;
  const worstSmall = all.reduce((a, b) => (b.small_targets > a.small_targets ? b : a));
  const hosts = [...new Set(all.flatMap((m) => m.external_hosts))].slice(0, HOST_LIMIT);
  return {
    verdict: failReasons.length > 0 ? "fail" : complete ? "pass" : "unverified",
    widths,
    checks,
    fail_reasons: failReasons,
    ...(complete || failReasons.length > 0 ? {} : { unverified_reason: "partial" as const }),
    samples: { small_targets: worstSmall.small_target_sample, external_hosts: hosts },
    measured_at: measuredAt,
    path,
  };
}

// ── Words for the coach and the timeline ────────────────────────────────────

const UNVERIFIED_LABELS: Record<SiteCheckUnverifiedReason, string> = {
  no_preview: "미리보기 꺼짐",
  no_cdp: "브라우저 연결 없음",
  timeout: "5초 안에 못 잼",
  error: "측정 오류",
  no_frame: "화면 크기 검수 창이 아님",
  reloaded: "재는 중에 페이지가 바뀜",
  missing: "파일 없음",
  not_html: "HTML 아님",
  bad_target: "검수할 수 없는 경로",
  invalid: "측정값 이상",
  wrong_page: "다른 페이지가 열림",
  partial: "한 너비를 못 잼",
};

function unverifiedLabel(result: SiteCheckResult): string {
  if (result.unverified_reason === "partial") {
    const missing = result.widths.filter((w) => !w.measured).map((w) => `${w.w}px`);
    return `${missing.join("·")} 못 잼`;
  }
  return UNVERIFIED_LABELS[result.unverified_reason ?? "error"];
}

/** At most `max` UTF-16 units, cut at a separator where possible and marked with "…". */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  const cut = Math.max(head.lastIndexOf(" · "), head.lastIndexOf(". "), head.lastIndexOf(", "));
  return (cut > max / 2 ? head.slice(0, cut) : head) + "…";
}

function widthFacts(w: SiteCheckWidth): string | null {
  if (!w.measured) return null;
  const more = w.offender_count > w.offenders.length ? ` 외 ${w.offender_count - w.offenders.length}곳` : "";
  const where = w.offenders.length ? `(${w.offenders.join(", ")}${more})` : "";
  if ((w.overflow_px ?? 0) > OVERFLOW_TOLERANCE_PX) {
    const hidden = w.root_clips ? " — overflow-x:hidden 이라 옆으로 밀어도 안 보임" : "";
    return `${w.w}px 가로 ${w.overflow_px}px 넘침${where}${hidden}`;
  }
  if (w.clipped > 0) return `${w.w}px 화면 끝에서 잘림 ${w.clipped}곳${where} — overflow-x:hidden·clip 으로 가린 넘침`;
  return null;
}

/**
 * At most 400 characters for the coach (PostToolUse `additionalContext`, the
 * site_check tool's text). Facts first, then what to do; an unverified result
 * says plainly that it is not a pass.
 */
export function siteCheckSummary(result: SiteCheckResult): string {
  const file = result.path || "index.html";
  const head = "📏 390·1280px 확인";
  if (result.verdict === "unverified" && !result.checks) {
    return clamp(`${head} — 미확인(${unverifiedLabel(result)}) (${file}). 화면을 재지 못했으니 통과라고 말하지 마세요.`, SITE_CHECK_SUMMARY_MAX);
  }
  const c = result.checks!;
  const parts: string[] = [];
  for (const w of result.widths) {
    const fact = widthFacts(w);
    if (fact) parts.push(fact);
  }
  if (!c.viewport_meta) parts.push("viewport meta 없음");
  if (c.img_without_alt > 0) parts.push(`alt 빠진 이미지 ${c.img_without_alt}개`);
  if (c.external_urls > 0) {
    const hosts = result.samples.external_hosts.length ? `(${result.samples.external_hosts.join(", ")})` : "";
    parts.push(`외부 주소 ${c.external_urls}개${hosts}`);
  }
  if (c.body_font_px < BODY_FONT_MIN_PX) parts.push(`본문 글자 ${c.body_font_px}px(16px 이상)`);
  const advice = c.small_targets > 0
    ? ` 참고: 44px보다 작은 누름 영역 ${c.small_targets}곳${result.samples.small_targets.length ? `(${result.samples.small_targets.join(", ")})` : ""}.`
    : "";

  const missing = result.widths.filter((w) => !w.measured).map((w) => `${w.w}px`);
  if (result.verdict === "fail") {
    const unmeasuredNote = missing.length ? ` ${missing.join("·")}은 재지 못했습니다.` : "";
    return clamp(`${head} — 고칠 곳 있음 (${file}): ${parts.join(" · ")}. 고친 뒤 다시 확인하세요.${unmeasuredNote}${advice}`, SITE_CHECK_SUMMARY_MAX);
  }
  const seen = result.widths.filter((w) => w.measured).map((w) => `${w.w}px`).join("·");
  const facts = `${seen} 가로 넘침 없음 · viewport meta 있음 · alt 빠진 이미지 0 · 외부 주소 0 · 본문 ${c.body_font_px}px`;
  if (result.verdict === "pass") {
    return clamp(`${head} — 통과 (${file}): ${facts}.${advice}`, SITE_CHECK_SUMMARY_MAX);
  }
  return clamp(`${head} — 미확인(${unverifiedLabel(result)}) (${file}): ${facts}. 재지 못한 너비는 통과라고 말하지 마세요.${advice}`, SITE_CHECK_SUMMARY_MAX);
}

/** One timeline line (spec §5.2): `📏 390·1280px 확인 — 통과`, `📏 390px에서 2곳 넘침`, `📏 미확인(미리보기 꺼짐)`. */
export function siteCheckTimelineLabel(result: SiteCheckResult): string {
  if (result.verdict === "pass") return "📏 390·1280px 확인 — 통과";
  if (result.verdict === "unverified") return `📏 미확인(${unverifiedLabel(result)})`;
  const failing = result.widths.find((w) => w.measured && ((w.overflow_px ?? 0) > OVERFLOW_TOLERANCE_PX || w.clipped > 0));
  if (failing) {
    const n = failing.offender_count;
    return n > 0 ? `📏 ${failing.w}px에서 ${n}곳 넘침` : `📏 ${failing.w}px에서 가로 넘침`;
  }
  return `📏 390·1280px 확인 — 고칠 곳 ${result.fail_reasons.length}개`;
}
