// site_check over CDP (orchestrator spec §6.1, FO-09). Pure over its ports and vscode-free.
//
// A3's siteCheck.ts owns the measurement script and the verdict. This runner only:
// 1. finds the live server (never starts it: asking for its address must not turn it on);
// 2. asks the host for a CDP session on its viewport page, the live server's
//    `/__hp_viewport` wrapper. The shipped shell ignores Emulation.setDeviceMetricsOverride
//    (experimentBrowser readViewport), so the wrapper's same-origin iframe is what gets
//    resized;
// 3. makes sure that page is the wrapper on the live server's origin, and navigates it
//    there once when it shows another page of that origin. It never evaluates anything on
//    a page of another origin;
// 4. sends `siteCheckExpression` in ONE `Runtime.evaluate` (awaitPromise, returnByValue)
//    with a CDP timeout a little above the script's own budget;
// 5. hands the value to `siteCheckResult`.
//
// The floor is A3's: no claim it did not observe. A missing live server is `no_preview`,
// no page or session is `no_cdp`, a page that is not the wrapper is `no_frame`, a transport
// timeout or the 5 s budget is `timeout`, and a throw or an abort is `error`. None of them
// is ever `pass`.
//
// Zero model requests: nothing here calls the gateway.

import {
  SITE_CHECK_BUDGET_MS,
  siteCheckExpression,
  siteCheckResult,
  siteCheckSummary,
  siteCheckTarget,
  viewportWrapperPath,
  type SiteCheckResult,
  type SiteCheckUnverifiedReason,
} from "./siteCheck.ts";

/** The CDP surface the runner uses: CdpSession (cdpSession.ts) fits it as is. */
export interface SiteCheckCdp {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
}

/** A CDP session on the host's viewport page, and what to do when the check is over. */
export interface SiteCheckPage {
  cdp: SiteCheckCdp;
  /** Detach a session the host opened for this check. Errors are ignored. */
  release?(): Promise<void> | void;
}

/**
 * What the host gives the runner (A5 implements it on BrowserMcpHost). Both are
 * best-effort: null, or a throw, means "not available", which reads as unverified.
 */
export interface SiteCheckPort {
  /** The live server's base URL, or null when it is not running. Must not start it. */
  livePreviewUrl?(): Promise<string | null>;
  /**
   * A CDP session on a page that shows `wrapperUrl`, the live server's `/__hp_viewport`
   * wrapper. The host keeps that page open (or opens it); when the page is on another
   * path of the live server, the runner navigates it to the wrapper. Null when no browser
   * page can be had.
   */
  viewportPage?(wrapperUrl: string): Promise<SiteCheckPage | null>;
}

export interface SiteCheckRun {
  /** Workspace-relative `.html` path; index.html by default. */
  path?: string;
  /** The whole check, from asking for the page to the verdict. Defaults to SITE_CHECK_BUDGET_MS. */
  budgetMs?: number;
  /** The turn's signal (the learner pressed stop, or the hook was aborted). */
  signal?: AbortSignal;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Extra CDP time beyond the script's own budget before the transport counts as timed out. */
export const SITE_CHECK_CDP_SLACK_MS = 1500;
/** Below this, the script cannot load the page and measure two widths: report the timeout. */
const MIN_SCRIPT_BUDGET_MS = 500;
const WRAPPER_PATH = "/__hp_viewport";

class Unverified extends Error {
  readonly reason: SiteCheckUnverifiedReason;
  constructor(reason: SiteCheckUnverifiedReason) {
    super(reason);
    this.reason = reason;
  }
}

function isLoopbackHttp(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

/** Race `p` against the deadline and the abort signal. */
function bounded<T>(p: Promise<T>, msLeft: number, signal: AbortSignal | undefined): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Unverified("error"));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Unverified("timeout"));
    }, Math.max(1, msLeft));
    const onAbort = () => {
      cleanup();
      reject(new Unverified("error"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
  });
}

/** CdpSession rejects with "CDP <method> timed out" when its own timeout fires. */
function isCdpTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message);
}

/** Where the page is now, read with one cheap evaluate. */
async function pageLocation(cdp: SiteCheckCdp, msLeft: number, signal?: AbortSignal): Promise<{ href: string; ready: string } | null> {
  const r = await bounded(
    cdp.send(
      "Runtime.evaluate",
      { expression: "JSON.stringify({ href: String(location.href), ready: String(document.readyState) })", returnByValue: true },
      Math.max(1, msLeft),
    ),
    msLeft,
    signal,
  );
  const raw = r?.result?.value;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as { href?: unknown; ready?: unknown };
    return typeof v.href === "string" ? { href: v.href, ready: String(v.ready ?? "") } : null;
  } catch {
    return null;
  }
}

/**
 * Measure `run.path` at 390 and 1280 through the host's viewport page. Never throws:
 * every way it can fail is an unverified result with its reason.
 */
export async function runSiteCheck(port: SiteCheckPort | null | undefined, run: SiteCheckRun = {}): Promise<SiteCheckResult> {
  const now = run.now ?? (() => Date.now());
  const sleep = run.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const path = typeof run.path === "string" && run.path.trim() ? run.path.trim().replace(/^\.\//, "") : "index.html";
  const budget = Math.max(1, run.budgetMs ?? SITE_CHECK_BUDGET_MS);
  const startedAt = now();
  const left = () => budget - (now() - startedAt);
  const unverified = (reason: SiteCheckUnverifiedReason) => siteCheckResult({ path, unverified: reason, now: new Date(now()) });

  const target = siteCheckTarget(path);
  if (!target) return unverified("bad_target");
  if (typeof port?.livePreviewUrl !== "function") return unverified("no_preview");

  let page: SiteCheckPage | null = null;
  try {
    let base: URL;
    try {
      const raw = await bounded(port.livePreviewUrl(), left(), run.signal);
      if (typeof raw !== "string" || !raw) return unverified("no_preview");
      base = new URL(raw);
    } catch (e) {
      if (e instanceof Unverified) throw e;
      return unverified("no_preview");
    }
    // The wrapper is the live server's own page; anything else is not a preview.
    if (!isLoopbackHttp(base)) return unverified("no_preview");
    const wrapper = new URL(viewportWrapperPath(target), base);

    if (typeof port.viewportPage !== "function") return unverified("no_cdp");
    try {
      page = await bounded(port.viewportPage(wrapper.href), left(), run.signal);
    } catch (e) {
      if (e instanceof Unverified) throw e;
      return unverified("no_cdp");
    }
    if (!page || typeof page.cdp?.send !== "function") return unverified("no_cdp");
    const cdp = page.cdp;

    // The script runs in the page it is sent to, so the page must be the wrapper on the
    // live server's origin. A page of another origin is never measured (nor touched).
    let where = await pageLocation(cdp, left(), run.signal).catch((e) => {
      if (e instanceof Unverified) throw e;
      return null;
    });
    if (!where) return unverified("no_cdp");
    let at: URL;
    try {
      at = new URL(where.href);
    } catch {
      return unverified("no_frame");
    }
    if (at.origin !== wrapper.origin) return unverified("no_frame");
    if (at.pathname !== WRAPPER_PATH) {
      // Another page of the learner's own preview: take it to the wrapper, once.
      await bounded(cdp.send("Page.navigate", { url: wrapper.href }, Math.max(1, left())), left(), run.signal);
      for (;;) {
        await sleep(50);
        if (left() <= 0) return unverified("timeout");
        where = await pageLocation(cdp, left(), run.signal).catch((e) => {
          if (e instanceof Unverified) throw e;
          return null;
        });
        if (!where) continue;
        try {
          at = new URL(where.href);
        } catch {
          continue;
        }
        if (at.origin !== wrapper.origin) return unverified("no_frame");
        if (at.pathname === WRAPPER_PATH && where.ready === "complete") break;
      }
    }

    const scriptBudget = left();
    if (scriptBudget < MIN_SCRIPT_BUDGET_MS) return unverified("timeout");
    let response: any;
    try {
      response = await bounded(
        cdp.send(
          "Runtime.evaluate",
          { expression: siteCheckExpression(target, { budgetMs: scriptBudget }), awaitPromise: true, returnByValue: true },
          scriptBudget + SITE_CHECK_CDP_SLACK_MS,
        ),
        scriptBudget + SITE_CHECK_CDP_SLACK_MS,
        run.signal,
      );
    } catch (e) {
      if (e instanceof Unverified) throw e;
      return unverified(isCdpTimeout(e) ? "timeout" : "error");
    }
    if (!response || typeof response !== "object" || response.exceptionDetails) return unverified("error");
    return siteCheckResult({ path, evaluation: response.result?.value, now: new Date(now()) });
  } catch (e) {
    return unverified(e instanceof Unverified ? e.reason : isCdpTimeout(e) ? "timeout" : "error");
  } finally {
    if (page?.release) {
      try {
        await page.release();
      } catch {
        /* a session that cannot be detached is the host's to clean up */
      }
    }
  }
}

/** The on-demand tool (`mcp__hypeproof__site_check`, spec §14): description and input. */
export const SITE_CHECK_TOOL_DESCRIPTION =
  "학습자의 페이지를 390px·1280px 두 너비에서 잰다: 가로 넘침과 넘친 요소, viewport meta, alt 없는 이미지, " +
  "외부 주소, 본문 글자 크기, 작은 누름 영역. 모델 요청을 쓰지 않는다. path 는 작업 폴더 기준 .html 경로" +
  "(기본 index.html). 라이브 미리보기가 꺼져 있거나 잴 수 없으면 결과는 '미확인'이고, 그때는 통과라고 말하지 않는다. " +
  "HTML 파일을 저장하면 자동으로 한 번 재서 결과가 저장 결과에 붙으므로, 같은 파일을 바로 다시 잴 필요는 없다.";

/** The tool result text cap (the same budget as a consult result). */
export const SITE_CHECK_TOOL_RESULT_MAX = 2000;

/**
 * The tool's answer: the ≤400-character summary first, then the result as JSON. When the
 * JSON would pass the cap, the samples and then the offender lists are shortened; the
 * verdict, reasons and counts always stay.
 */
export function siteCheckToolText(result: SiteCheckResult): string {
  const summary = siteCheckSummary(result);
  const room = SITE_CHECK_TOOL_RESULT_MAX - summary.length - 1;
  let shown: SiteCheckResult = result;
  let json = JSON.stringify(shown);
  if (json.length > room) {
    shown = { ...shown, samples: { small_targets: shown.samples.small_targets.slice(0, 2), external_hosts: shown.samples.external_hosts.slice(0, 2) } };
    json = JSON.stringify(shown);
  }
  if (json.length > room) {
    shown = { ...shown, widths: shown.widths.map((w) => ({ ...w, offenders: w.offenders.slice(0, 2) })) };
    json = JSON.stringify(shown);
  }
  if (json.length > room) {
    shown = { ...shown, samples: { small_targets: [], external_hosts: [] }, widths: shown.widths.map((w) => ({ ...w, offenders: [] })) };
    json = JSON.stringify(shown);
  }
  return json.length > room ? summary : `${summary}\n${json}`;
}
