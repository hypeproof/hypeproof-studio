import { referenceCaptureMetadata, referenceCaptureText, type ReferenceCapture } from "./referenceDesign.ts";
// #282 Phase 2 slice 2 — PURE builder for the in-process "hypeproof" SDK MCP
// server that exposes the native integrated browser (#309/#278) to the Agent
// SDK coach as tools:
//   browser_open(url)      — open the integrated browser tab (outward action:
//                            URL policy + the approval modal both apply);
//   browser_screenshot()   — capture the active browser tab as an image the
//                            model can SEE (vision) — the coach checking the
//                            student's page is verification_reflex pedagogy;
//   live_preview_start()   — serve the workspace over the #309 live server and
//                            open/refresh the integrated browser at its URL.
//
// PURE means: no `vscode`, no SDK import. Host capabilities (open a tab,
// capture via CDP, start the live server) come in as a BrowserMcpHost the
// orchestration layer (chatPanelProvider) implements, and the SDK factory
// functions (createSdkMcpServer / tool) + the zod module are injected by
// sdkCoach.ts, which loads them dynamically alongside the SDK. That keeps this
// file testable under `node --strip-types` with fakes (extension pure/
// orchestration split convention).
//
// SECURITY MODEL (REQ-M19/M20/M21): the server is registered ONLY when the
// worker profile grants `sdk_tools.browser` (permittedMcpToolsFor — minors are
// stripped unconditionally). Every call still routes through canUseTool
// (allowedTools stays []): browser_open → "ask" (modal), screenshot/preview →
// "allow" once the grant exists. The handlers below re-validate the URL policy
// (safeNavigateUrl) even though canUseTool already did — belt over suspenders.
// #415: browser_open 이 이미 열려 있는 페이지를 요청받으면 아무것도 열지 않으며,
// 그 경우 canUseTool 도 같은 판정(resolveAlreadyOpen)으로 모달을 건너뛴다 —
// "항상 모달"은 **실제로 여는 경우**를 뜻한다. 모든 도구 결과 끝에는 현재 열린
// 페이지 한 줄이 붙어, 모델이 브라우저 상태를 추측하지 않게 한다.

// Explicit .ts specifier: this pure-module graph must load under
// `node --experimental-strip-types` (smoke tests), which resolves ESM
// specifiers literally. esbuild + tsc (allowImportingTsExtensions) accept it.
import {
  BLANK_BROWSER_URL,
  browserOpenUrl,
  isSameBrowserUrl,
  isLoopbackUrl,
  resolveLivePreviewUrl,
} from "./browserControlHelpers.ts";
import { MCP_PUBLISH_SITE, PUBLISH_SITE_TOOL_NAME, type PublishSiteInput } from "./publish/publishContract.ts";
// Type only (erased): the site-check runner's page port, which the host implements here.
import type { SiteCheckPage } from "./siteCheckRunner.ts";
import { classifyDenial, denialToolText } from "./denialSource.ts";

/** REQ-STUDIO-DENIAL-SOURCE — this host did not wire the tool: the app/environment decided. */
const HOST_LACKS = (feature: string): string =>
  denialToolText({ source: "runtime", feature, reason: `이 연결에서는 ${feature} 도구가 준비되지 않았어요`, next: "코치 혼자 이어서 해 주세요" });

/** Server key in the SDK `mcpServers` option → tool prefix `mcp__hypeproof__`. */
export const HYPEPROOF_MCP_SERVER_NAME = "hypeproof";

// Full tool names as the model (and canUseTool) sees them.
export const MCP_BROWSER_OPEN = "mcp__hypeproof__browser_open";
export const MCP_BROWSER_SCREENSHOT = "mcp__hypeproof__browser_screenshot";
export const MCP_LIVE_PREVIEW_START = "mcp__hypeproof__live_preview_start";
// #3221 — PDF of a work-folder HTML page, printed by Studio's own browser (pagePdf.ts). The coach used to run Chrome's
// binary for this, and macOS denied App Management to Studio (2026-10-29).
export const MCP_PAGE_PDF_SAVE = "mcp__hypeproof__page_pdf_save";
// #457 — 검사(inspect) 3종. 스크린샷만으로는 "버튼이 실제로 눌리는가"를 알 수
// 없다. 큐시트 Loop Engineering(20:05–20:35)은 "검사 → 수정 → 재검사" 반복이고,
// 클릭이 없으면 그 검사가 반쪽이다. 2026-07-26 실사용에서 코치가 "제가 직접
// 클릭 도구가 없어서 … 직접 눌러봐 달라고 부탁드릴게요"라며 참가자에게
// 떠넘겼고 루브릭 "직접 눌러보며 확인"이 끝내 못 채워졌다.
// CDP 구현은 이미 browserControl.ts 에 있다(프록시 경로 #278). 여기서는 SDK
// 경로에 노출만 한다 — 새 능력이 아니라 안 이어져 있던 배선이다.
export const MCP_BROWSER_READ = "mcp__hypeproof__browser_read";
export const MCP_BROWSER_CLICK = "mcp__hypeproof__browser_click";
export const MCP_BROWSER_TYPE = "mcp__hypeproof__browser_type";

/** All hypeproof MCP browser tools, granted as one capability unit. */
export const MCP_BROWSER_TOOLS = [
  MCP_BROWSER_OPEN,
  MCP_BROWSER_SCREENSHOT,
  MCP_LIVE_PREVIEW_START,
  MCP_BROWSER_READ,
  MCP_BROWSER_CLICK,
  MCP_BROWSER_TYPE,
] as const;
/**
 * #3221 — tools granted with the browser capability that are not browser control: the Service's SDK
 * browser contract (browser-contract.test) describes MCP_BROWSER_TOOLS, and page_pdf_save carries its
 * own description instead.
 */
export const MCP_BROWSER_EXTRA_TOOLS = [MCP_PAGE_PDF_SAVE] as const;

/**
 * Curriculum Runtime Experiment Browser tools (CR-04, CR-06). Granted only when the
 * served profile has the CR switch on (CR-02; `permittedMcpToolsFor`), and registered
 * only when granted. Short names match the proxy's CR_BROWSER_TOOLS one for one.
 */
export const MCP_BROWSER_OBSERVE = "mcp__hypeproof__browser_observe";
export const MCP_BROWSER_SELECT = "mcp__hypeproof__browser_select";
export const MCP_BROWSER_SCROLL = "mcp__hypeproof__browser_scroll";
export const MCP_BROWSER_HOVER = "mcp__hypeproof__browser_hover";
export const MCP_BROWSER_RELOAD = "mcp__hypeproof__browser_reload";
export const MCP_CR_BROWSER_TOOLS = [
  MCP_BROWSER_OBSERVE,
  MCP_BROWSER_SELECT,
  MCP_BROWSER_SCROLL,
  MCP_BROWSER_HOVER,
  MCP_BROWSER_RELOAD,
] as const;

/**
 * AI Verify tools (cr-verify, CR-12–CR-16): the coach hands the runner a criterion's plan
 * (`verify_criterion`) or proposes criteria the student must confirm
 * (`verify_propose_criteria`). Same grant and switch as the CR browser tools; short names
 * match the proxy's CR_VERIFY_TOOLS one for one.
 */
export const MCP_VERIFY_CRITERION = "mcp__hypeproof__verify_criterion";
export const MCP_VERIFY_PROPOSE = "mcp__hypeproof__verify_propose_criteria";
export const MCP_CR_VERIFY_TOOLS = [MCP_VERIFY_CRITERION, MCP_VERIFY_PROPOSE] as const;

/**
 * One-click publish (src/publish/). Its own grant (`publishing` strategy
 * `per_user_github_pages`, adults only — permittedMcpToolsFor), independent of the browser
 * flag: a cohort may publish without the coach driving a browser, and vice versa.
 */
export { MCP_PUBLISH_SITE } from "./publish/publishContract.ts";

/** Which parts of the server to register, derived from the tools the profile granted. */
export function hypeproofMcpRegistration(permittedMcpTools: readonly string[]): { browser: boolean; publishSite: boolean } {
  return {
    browser: (MCP_BROWSER_TOOLS as readonly string[]).some((t) => permittedMcpTools.includes(t)),
    publishSite: permittedMcpTools.includes(MCP_PUBLISH_SITE),
  };
}

/** MCP CallToolResult content we produce (structural subset of the MCP SDK type). */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

/** A captured page for the vision path. imageBase64 has no `data:` prefix. */
export interface BrowserScreenshot {
  imageBase64: string;
  mimeType: string;
  capture?: ReferenceCapture;
  url?: string;
  title?: string;
}

/** 지금 통합 브라우저에 떠 있는 페이지 (#415) — 이미지 없이 URL/제목만. */
export interface BrowserPage {
  url: string;
  title?: string;
}

/**
 * `openBrowser` 가 실제로 무슨 일을 했는지 (#526).
 *
 * 슬롯당 탭 하나라는 규칙(#519) 때문에 "연다"는 요청이 실제로는 **기존 탭의
 * 이동**이 될 수 있다. 그때 밀려난 페이지를 여기 담아 도구 결과에 적는다 —
 * 안 그러면 코치는 참고 사이트 두 개가 나란히 떠 있다고 **믿는다**.
 */
export interface BrowserOpenOutcome {
  /** 같은 슬롯의 이 페이지가 요청 주소로 이동했다(= 화면에서 사라졌다). */
  replaced?: BrowserPage;
}

/**
 * Host capabilities the extension side (chatPanelProvider/extension.ts, which
 * has the `vscode` API) implements. All best-effort: return null / resolve on
 * failure rather than throwing user-facing errors — the handler converts
 * failures into isError tool results the model can react to in Korean.
 */
export interface BrowserMcpHost {
  /** Current turn asks only for a general browser. This is not a capability grant. */
  generalBrowserRequest?: boolean;
  /**
   * Open (or reveal) the integrated browser at an already-policy-checked URL.
   *
   * #526 — 슬롯이 차 있으면 기존 탭이 그 주소로 **이동**한다. 무엇이 밀려났는지
   * 돌려주면 결과에 적는다. 안 돌려줘도(구버전 호스트·fake) 동작은 그대로다.
   */
  openBrowser(url: string): Promise<BrowserOpenOutcome | void>;
  /** Capture the active integrated-browser tab; null when no tab / capture failed. */
  screenshot(): Promise<BrowserScreenshot | null>;
  /** Ensure the #309 live server + open the browser; returns the URL or null. */
  startLivePreview(): Promise<string | null>;
  /** #3221 — print a work-folder HTML page (path relative to the work folder) to <name>.pdf beside it. */
  savePagePdf?(path: string): Promise<{ ok: boolean; text: string }>;
  /**
   * HEAD-check a URL before opening it, so browser_open can surface a 404
   * instead of opening a blank or error page. Optional — absent means skip check.
   */
  fetchHead?(url: string): Promise<{ ok: boolean; status: number }>;
  /**
   * #507 — 지금 **떠 있는** 라이브 서버의 주소 (안 떠 있으면 null). 시작시키지
   * 않는다 — "주소가 뭐냐"를 묻는 것이 서버를 켜는 부작용을 가지면 안 된다.
   *
   * optional 인 이유는 currentPage 와 같다: 이 능력이 없는 호스트에서는 주소를
   * 모르는 것이고, 모르면 **교정하지 않는다**(짐작 금지).
   */
  livePreviewUrl?(): Promise<string | null>;
  /**
   * #415 — 지금 열려 있는 페이지를 **가볍게** 읽는다 (스크린샷 금지: URL 하나
   * 알자고 이미지를 뜨는 건 과하다). 탭이 없으면 null.
   *
   * optional 인 이유: 이 능력이 없는 호스트(구버전·테스트 fake)에서도 도구는
   * 그대로 동작해야 한다 — 없으면 예전처럼 무조건 여는 동작으로 폴백한다.
   */
  currentPage?(): Promise<BrowserPage | null>;
  /**
   * #519 — 지금 **열려 있는 모든** 페이지. 중복 판정(resolveAlreadyOpen)이 쓴다.
   *
   * `currentPage` 하나로는 부족하다: 코치 브라우징은 슬롯이 둘이다(참가자 결과물 /
   * 참고 사이트). 참고 사이트를 보는 중에 결과물 주소를 요청받으면 "지금 페이지"와
   * 다르다는 이유로 이미 떠 있는 페이지에 승인 모달이 또 뜬다 — #415 가 없애려던
   * 바로 그 잡음이다.
   *
   * optional 인 이유는 currentPage 와 같다: 없으면 currentPage 로 폴백한다.
   */
  openPages?(): Promise<BrowserPage[] | null>;
  /**
   * #523 — 이미 열려 있는 그 탭을 **코치의 운전 대상으로 고정**한다. 매칭된
   * 페이지를 돌려주고, 못 찾으면 null.
   *
   * 왜 필요한가: `browser_open` 이 "이미 열려 있다"고 판정하면 탭을 열지 않으므로
   * `setTargetTab` 을 태우는 경로(host.openBrowser)를 통째로 건너뛴다. 그러면
   * 뒤이은 browser_read/click/type 이 **직전 타깃**(다른 슬롯)에 붙어, 코치가
   * A 를 본다고 믿으면서 B 를 읽는다. #522 가 판정 범위를 열린 탭 전체로 넓히면서
   * 실제로 가능해진 상태다(그 전에는 매칭 = 타깃이라 무해했다).
   *
   * 왜 탭 핸들이 아니라 URL 인가: 이 모듈은 의도적으로 vscode-free 다(노드에서
   * 단위 테스트한다). `vscode.BrowserTab` 을 여기로 들이면 그 경계가 깨진다.
   * 탭을 찾아 고정하는 일은 vscode API 를 가진 호스트가 한다.
   *
   * optional 인 이유는 currentPage 와 같다 — 없으면 예전 동작(타깃 그대로)이다.
   */
  focusOpenPage?(url: string): Promise<BrowserPage | null>;
  /**
   * #457 — CDP 검사 도구 위임. `browserControl.ts` 의 execute() 를 그대로 태운다
   * (browser_read / browser_click / browser_type). optional 인 이유는
   * currentPage 와 같다: 이 능력이 없는 호스트에서도 나머지 도구는 동작해야 한다.
   */
  inspect?(name: string, input: Record<string, unknown>): Promise<McpToolResult | null>;
  /**
   * CR-02/CR-11 — is the Curriculum Runtime switch on for the served profile? With it on,
   * agent browser actions stay on the student's own preview origin (`crScope`), and the
   * CR executor's refusals are final: no tool falls back to a path that ignores scope.
   */
  crEnabled?(): boolean;
  /** CR-11 — may an agent open `url`? Asked only while `crEnabled()` is true. */
  crScope?(url: string): { ok: true } | { ok: false; reason: string };
  /** cr-verify — run `verify_criterion` / `verify_propose_criteria` (VerifySession). */
  verify?(name: string, input: Record<string, unknown>): Promise<McpToolResult>;
  /**
   * One-click publish — run the same pipeline the toolbar button runs and return its
   * `PublishSiteResult` as JSON text. Optional: a host without it answers isError.
   */
  publishSite?(input: PublishSiteInput): Promise<McpToolResult>;
  /**
   * A4 (orchestrator spec §6.1) — a CDP session on the page the host keeps for the site
   * check, showing `wrapperUrl` (the live server's `/__hp_viewport` wrapper). The runner
   * (siteCheckRunner.ts) measures inside it, and navigates it to the wrapper when it shows
   * another page of the live server; it never runs anything on a page of another origin.
   * Null when no browser page can be had. Optional: without it every site check is
   * `unverified` (`no_cdp`), never `pass`. Used only on an orchestrator seat whose roster
   * lists `site_check`, with or without the browser tools.
   *
   * A5: chatPanelProvider implements it with `SiteCheckViewports` below.
   */
  viewportPage?(wrapperUrl: string): Promise<SiteCheckPage | null>;
}

// ── The site check's page (A5; orchestrator spec §6.1) ──────────────────────
// The runner measures inside the live server's `/__hp_viewport` wrapper, because the shipped
// shell ignores CDP emulation. It must never take over the learner's own preview: navigating
// that tab to the wrapper on every save would turn the preview into the 390px inspection view
// (A4 D8 left the choice here). So a check measures in:
// 1. a tab that already shows exactly this wrapper (the learner opened 화면 크기 검수), left
//    open afterwards; or else
// 2. a tab of its own, opened in the background without focus and closed when the check is
//    over.
// One check page at a time. The host is handed the page only once the wrapper has finished
// loading, and a page the runner never releases (it gave up first) is released anyway, so a
// check tab cannot linger. Every failure is null, which the runner reports as unverified,
// never as a pass.

/** The live server's own viewport wrapper: loopback http(s), path `/__hp_viewport`. */
export function isViewportWrapperUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return isLoopbackUrl(u.href) && (u.protocol === "http:" || u.protocol === "https:") && u.pathname === "/__hp_viewport";
}

/** The CDP session a check page carries (CdpSession fits it). */
export interface ViewportCdp {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
}

/** What the host's integrated browser gives `SiteCheckViewports`. vscode-free; the host implements it. */
export interface ViewportTabsPort<Tab> {
  /** The open browser tabs, without the check tabs this class opened. */
  tabs(): readonly Tab[];
  urlOf(tab: Tab): string | undefined;
  /** Open `url` in a new tab that takes neither the focus nor the foreground. */
  open(url: string): Promise<Tab>;
  /** Close a tab `open` gave. Best effort. */
  close(tab: Tab): Promise<void>;
  /** A CDP session on the tab's page. */
  attach(tab: Tab): Promise<ViewportCdp>;
}

export interface SiteCheckViewportOptions {
  /** How long opening, attaching and loading the wrapper may take. */
  readyMs?: number;
  /** Between two reads of the page's location while it loads. */
  pollMs?: number;
  /** A page not released by then is released anyway. */
  holdMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Inside the runner's 5 s budget, with time left for the measurement itself. */
export const VIEWPORT_READY_MS = 2500;
export const VIEWPORT_POLL_MS = 100;
/** Longer than any check (the runner's budget is 5 s), short enough that a stray tab goes soon. */
export const VIEWPORT_HOLD_MS = 15_000;

class ViewportTimeout extends Error {}

/** `p`, or a ViewportTimeout after `ms`; what `p` brings after that goes to `late`. */
function within<T>(p: Promise<T>, ms: number, late: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reject(new ViewportTimeout("viewport page not ready in time"));
    }, Math.max(1, ms));
    p.then(
      (v) => {
        if (done) return late(v);
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class SiteCheckViewports<Tab> {
  private queue: Promise<void> = Promise.resolve();
  private readonly port: ViewportTabsPort<Tab>;
  private readonly opts: SiteCheckViewportOptions;

  constructor(port: ViewportTabsPort<Tab>, opts: SiteCheckViewportOptions = {}) {
    this.port = port;
    this.opts = opts;
  }

  /** A page showing `wrapperUrl`, loaded, for one check; or null. Never throws. */
  async page(wrapperUrl: string): Promise<SiteCheckPage | null> {
    if (!isViewportWrapperUrl(wrapperUrl)) return null;
    const now = this.opts.now ?? (() => Date.now());
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const readyMs = this.opts.readyMs ?? VIEWPORT_READY_MS;

    // One check page at a time, in call order.
    let endTurn!: () => void;
    const turn = new Promise<void>((resolve) => (endTurn = resolve));
    const previous = this.queue;
    this.queue = previous.then(() => turn);
    await previous;

    const startedAt = now();
    const left = () => readyMs - (now() - startedAt);
    let session: ViewportCdp | null = null;
    let opened: { tab: Tab } | null = null;
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      clearTimeout(hold);
      try {
        await session?.close();
      } catch {
        /* a session that cannot be closed is gone already */
      }
      if (opened) {
        try {
          await this.port.close(opened.tab);
        } catch {
          /* best effort: the tab may have been closed by the learner */
        }
      }
      endTurn();
    };
    const hold = setTimeout(() => void release(), this.opts.holdMs ?? VIEWPORT_HOLD_MS);
    (hold as { unref?: () => void }).unref?.();

    try {
      const existing = this.port.tabs().find((t) => isSameBrowserUrl(this.port.urlOf(t) ?? "", wrapperUrl));
      let tab: Tab;
      if (existing !== undefined) {
        tab = existing;
      } else {
        tab = await within(this.port.open(wrapperUrl), left(), (late) => void this.port.close(late).catch(() => {}));
        opened = { tab };
      }
      session = await within(this.port.attach(tab), left(), (late) => void late.close().catch(() => {}));
      const target = new URL(wrapperUrl);
      for (;;) {
        const r = await within(
          session.send(
            "Runtime.evaluate",
            { expression: "JSON.stringify({ href: String(location.href), ready: String(document.readyState) })", returnByValue: true },
            Math.max(1, left()),
          ),
          left(),
          () => {},
        ).catch(() => null);
        let at: URL | null = null;
        let ready = "";
        try {
          const v = JSON.parse(String(r?.result?.value ?? "null")) as { href?: unknown; ready?: unknown } | null;
          if (v && typeof v.href === "string") {
            at = new URL(v.href);
            ready = String(v.ready ?? "");
          }
        } catch {
          at = null;
        }
        if (at && at.origin === target.origin && at.pathname === target.pathname && ready === "complete") break;
        if (left() <= 0) throw new ViewportTimeout("viewport page not ready in time");
        await sleep(Math.min(this.opts.pollMs ?? VIEWPORT_POLL_MS, Math.max(1, left())));
      }
      const cdp = session;
      return { cdp, release };
    } catch {
      await release();
      return null;
    }
  }
}

/**
 * Tool name, description and JSON inputSchema for browser_open. Exported so the
 * instructor local runtime can register the same tool definition without duplicating
 * the description string.
 */
export const BROWSER_OPEN_TOOL_DEF = {
  name: "browser_open",
  description:
    "일반 웹 탐색이나 브라우저 열기 요청에 사용한다. URL이 없으면 url을 생략해 빈 통합 브라우저를 연다. " +
    "브라우저만 열어 달라는 요청에 파일을 만들거나 live_preview_start를 호출하지 않는다. " +
    "URL이 있으면 http(s)/localhost/file 주소 또는 about:blank만 허용되며, 실행 전 학생의 승인을 받는다. " +
    "이미 같은 주소가 열려 있으면 다시 열지 않는다(탭 중복·승인 모달 반복 방지).",
  inputSchema: { type: "object" as const, properties: { url: { type: "string" } }, required: [], additionalProperties: false },
} as const;

/**
 * Tool name, description and JSON inputSchema for live_preview_start. Exported for
 * reuse in the instructor local runtime path (same handler, different call path).
 */
export const LIVE_PREVIEW_START_TOOL_DEF = {
  name: "live_preview_start",
  description:
    "사용자가 만들거나 수정한 작업 폴더의 HTML을 미리 볼 때만 사용한다. 일반 브라우저 열기나 웹 탐색에는 browser_open을 사용한다. " +
    "학생 워크스페이스를 로컬 라이브 서버(127.0.0.1)로 서빙하고 통합 브라우저에서 연다. " +
    "파일이 바뀌면 자동 새로고침된다. 브라우저까지 열리므로 뒤이어 browser_open 을 부를 필요가 없다.",
  inputSchema: { type: "object" as const, properties: {}, required: [], additionalProperties: false },
} as const;

/**
 * CR-11 — the reason `browser_open` must refuse `url` with the switch on, or null. A
 * loopback address while no live server runs is left to #507, which starts the student's
 * own live server instead of opening the guessed port. Shared by canUseTool (so no
 * approval modal is raised for a request that will be refused) and the handler.
 */
export async function crBrowserOpenRefusal(host: BrowserMcpHost, url: string): Promise<string | null> {
  if (!host.crEnabled?.() || !host.crScope) return null;
  if (isLoopbackUrl(url) && (await readLivePreviewUrl(host)) === null) return null;
  const v = host.crScope(url);
  return v.ok ? null : v.reason;
}

/**
 * 호스트의 현재 페이지 조회. 세 상태를 구분한다:
 *   `undefined` = 호스트가 이 능력을 지원하지 않음(또는 조회 실패) → 상태를
 *                 모르니 짐작하지 않는다(중복 방지 생략, 상태 줄도 생략);
 *   `null`      = 지원하지만 열린 탭이 없음;
 *   `BrowserPage` = 지금 떠 있는 페이지.
 */
async function readCurrentPage(host: BrowserMcpHost): Promise<BrowserPage | null | undefined> {
  if (typeof host.currentPage !== "function") return undefined;
  try {
    const page = await host.currentPage();
    return page && typeof page.url === "string" && page.url ? page : null;
  } catch {
    // 호스트 조회 실패는 학생에게 보일 에러가 아니다 — 모른다고 취급.
    return undefined;
  }
}

/** `resolveAlreadyOpen` 의 결과 — 판정 + 상태 줄에 필요한 재료를 한 번에. */
export interface AlreadyOpenVerdict {
  /** 정책 통과 + 라이브 서버 교정(#507) 후의 URL (정책 위반이면 null). */
  url: string | null;
  /** #507 — 교정이 일어났다면 코치가 원래 요청했던 주소. */
  redirectedFrom?: string;
  /** 지금 열려 있는 페이지 (undefined = 모름 — 호스트 미지원/조회 실패). */
  current: BrowserPage | null | undefined;
  /** 요청한 URL 이 이미 떠 있는가. 모르면 false (= 평소대로 연다). */
  alreadyOpen: boolean;
}

/**
 * "이 URL, 지금 이미 열려 있나?" (#415) — `browser_open` 핸들러와 canUseTool
 * (승인 모달)이 **같은 함수**를 쓴다.
 *
 * 왜 단일 소스인가: 모달은 핸들러보다 **먼저** 뜬다. 그래서 모달을 건너뛰려면
 * canUseTool 도 같은 판정을 해야 하는데, 두 판정이 갈라지면 "모달 없이 실제로
 * 열리는" 구멍이 생긴다(승인 게이트 우회). 판정을 한 곳에 두어 그 구멍 자체를
 * 없앤다.
 */
export async function resolveAlreadyOpen(
  host: BrowserMcpHost,
  rawUrl: unknown,
): Promise<AlreadyOpenVerdict> {
  const raw = browserOpenUrl(rawUrl);
  if (!raw) return { url: null, current: undefined, alreadyOpen: false };
  // #507 — 추측된 루프백 포트를 **실제로 떠 있는** 라이브 서버로 교정한다.
  // 판정 함수 안에서 하는 이유: 승인 모달(canUseTool)과 핸들러가 같은 주소를
  // 봐야 한다. 갈라지면 모달에 뜬 주소와 실제로 여는 주소가 달라진다.
  const target = resolveLivePreviewUrl(raw, (await readLivePreviewUrl(host)) ?? null);
  const url = target?.url ?? raw;
  const redirectedFrom = target?.redirected ? target.requested : undefined;
  const current = await readCurrentPage(host);
  // #519 — 열린 탭 **전부**와 비교한다(호스트가 알려줄 때만). 슬롯이 둘이라
  // "지금 보고 있는 페이지"만으로는 이미 떠 있는 다른 슬롯을 놓친다.
  const open = await readOpenPages(host);
  const alreadyOpen = open
    ? open.some((p) => isSameBrowserUrl(p.url, url))
    : !!current && isSameBrowserUrl(current.url, url);
  return { url, current, alreadyOpen, ...(redirectedFrom ? { redirectedFrom } : {}) };
}

/**
 * 라이브 서버 주소 조회. 세 상태를 구분한다 (readCurrentPage 와 같은 규율):
 *   `undefined` = 호스트가 이 능력을 지원하지 않음(또는 조회 실패) → **모른다**;
 *   `null`      = 지원하는데 지금 서버가 안 떠 있음;
 *   `string`    = 떠 있는 주소.
 *
 * 모름과 없음을 뭉개면 안 된다: "모른다"에서 서버를 띄우거나 주소를 교정하면
 * 그게 곧 짐작이다.
 */
async function readLivePreviewUrl(host: BrowserMcpHost): Promise<string | null | undefined> {
  if (typeof host.livePreviewUrl !== "function") return undefined;
  try {
    const url = await host.livePreviewUrl();
    return typeof url === "string" && url ? url : null;
  } catch {
    return undefined;
  }
}

/**
 * 이번 open 으로 **밀려난** 페이지의 표기(제목 — 주소) (#526). 없으면 null.
 *
 * 요청 주소와 같은 페이지가 밀려난 것으로 보고되면 무시한다 — 같은 주소로의
 * 이동은 참가자 눈에 아무것도 사라지지 않은 것이라, 그걸 "사라졌다"고 적으면
 * 없는 상실을 코치에게 가르친다.
 */
function replacedPageOf(outcome: BrowserOpenOutcome | void, url: string): string | null {
  const page = outcome && typeof outcome === "object" ? outcome.replaced : undefined;
  if (!page || typeof page.url !== "string" || !page.url) return null;
  if (isSameBrowserUrl(page.url, url)) return null;
  return page.title ? `${page.title}(${page.url})` : page.url;
}

/**
 * 매칭된 탭을 코치의 운전 대상으로 고정하고 그 페이지를 돌려준다 (#523).
 * 지원 안 함 / 못 찾음 / 실패 → null (호출부가 예전 동작으로 폴백한다).
 */
async function focusOpenPage(host: BrowserMcpHost, url: string): Promise<BrowserPage | null> {
  if (typeof host.focusOpenPage !== "function") return null;
  try {
    const page = await host.focusOpenPage(url);
    return page && typeof page.url === "string" && page.url ? page : null;
  } catch {
    // 고정에 실패해도 "이미 열려 있다"는 판정 자체는 유효하다. 여기서 던지면
    // 멀쩡한 결과가 오류로 바뀐다.
    return null;
  }
}

/** 열린 페이지 목록 조회. 지원 안 함/실패 → undefined (짐작하지 않는다). */
async function readOpenPages(host: BrowserMcpHost): Promise<BrowserPage[] | undefined> {
  if (typeof host.openPages !== "function") return undefined;
  try {
    const pages = await host.openPages();
    if (!Array.isArray(pages)) return undefined;
    return pages.filter((p) => p && typeof p.url === "string" && p.url);
  } catch {
    return undefined;
  }
}

/**
 * 도구 결과 맨 끝에 붙는 브라우저 상태 한 줄 (#415). 도구 **설명**이 아니라
 * **결과**가 모델 컨텍스트에 남기 때문에, 결과에 현재 화면을 적어두는 것이
 * "지금 뭐가 열려 있지?"를 추측으로 메우지 않게 하는 유일한 수단이다.
 */
function pageStateLine(page: BrowserPage | null): string {
  if (!page) return "현재 열린 페이지: 없음";
  return page.title ? `현재 열린 페이지: ${page.url} — ${page.title}` : `현재 열린 페이지: ${page.url}`;
}

/** 상태를 아는 경우에만(=undefined 가 아닐 때만) 상태 줄을 덧붙인다. */
function withPageState(result: McpToolResult, page: BrowserPage | null | undefined): McpToolResult {
  if (page === undefined) return result;
  return { ...result, content: [...result.content, { type: "text", text: pageStateLine(page) }] };
}

/**
 * The two SDK factory functions this builder needs, injected by the caller
 * (sdkCoach.ts passes the real dynamically-imported SDK; tests pass fakes).
 * Signatures are structural — the SDK's own generics live on its side.
 */
export interface SdkMcpFactory {
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<McpToolResult>,
  ): unknown;
  createSdkMcpServer(options: { name: string; version?: string; tools?: unknown[] }): unknown;
}

/** Minimal zod surface we use (injected — zod is the SDK's peer dep). */
export interface ZodLike {
  string(): unknown;
  /** #457 — browser_type 의 submit 플래그용. */
  boolean?(): unknown;
  /** CR-06 — for browser_scroll's dy. */
  number?(): unknown;
  /** A4 — consult's `agent` (the served roster's names) and `focus` (orchestrator spec §3.2). */
  enum?(values: readonly [string, ...string[]]): unknown;
  object?(shape: Record<string, unknown>): unknown;
  array?(item: unknown): unknown;
}

/**
 * A4 — the same factory, whose server also carries `tools` (consult, site_check),
 * appended after the server's own. No tools → the factory itself, so a seat without the
 * orchestrator builds exactly the server it built before.
 */
export function withServerTools(factory: SdkMcpFactory, tools: readonly unknown[]): SdkMcpFactory {
  if (tools.length === 0) return factory;
  return {
    tool: factory.tool,
    createSdkMcpServer: (options) =>
      factory.createSdkMcpServer({ ...options, tools: [...(options.tools ?? []), ...tools] }),
  };
}

/**
 * A4 — the hypeproof server for a seat granted orchestrator tools but not the browser:
 * the given tools only (spec §3.2; A2 `permittedMcpToolsFor`). Same name and version as
 * buildHypeproofMcpServer's, so the tools are `mcp__hypeproof__<name>` either way.
 */
export function buildHypeproofToolsOnlyServer(factory: SdkMcpFactory, tools: readonly unknown[]): unknown {
  return factory.createSdkMcpServer({ name: HYPEPROOF_MCP_SERVER_NAME, version: "1.0.0", tools: [...tools] });
}

/** `schema.optional()` when the injected zod schema has it (the real one); else as is. */
function optionalSchema(schema: unknown): unknown {
  const opt = (schema as { optional?: () => unknown } | null)?.optional;
  return typeof opt === "function" ? opt.call(schema) : schema;
}

/**
 * BrowserToolResult (text | image_url) → McpToolResult (text | image). One conversion for
 * every delegated tool, so both coach runtimes see the same result (CR-03).
 */
export function toMcpToolResult(r: {
  content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  isError: boolean;
}): McpToolResult {
  return {
    content: r.content.map((b) =>
      b.type === "text"
        ? { type: "text" as const, text: b.text }
        : {
            type: "image" as const,
            data: b.image_url.url.replace(/^data:[^,]*,/, ""),
            mimeType: /^data:([^;,]+)/.exec(b.image_url.url)?.[1] ?? "image/jpeg",
          },
    ),
    ...(r.isError ? { isError: true } : {}),
  };
}

/**
 * Core handler for browser_open — extracted from buildHypeproofMcpServer so the
 * instructor local runtime path can reuse the same logic (404 check, #507 port
 * correction, #415 duplicate suppression, #526 slot-displaced notice) without
 * duplicating it. The MCP server factory.tool callback delegates here.
 */
export async function runBrowserOpen(host: BrowserMcpHost, raw?: unknown): Promise<McpToolResult> {
  const { url, current, alreadyOpen, redirectedFrom } = await resolveAlreadyOpen(host, raw);
  if (!url) {
    return {
      content: [{ type: "text", text: denialToolText({ source: classifyDenial("url_policy"), reason: `열 수 없는 주소예요: ${raw}` }) }],
      isError: true,
    };
  }
  if (host.generalBrowserRequest && url !== BLANK_BROWSER_URL) {
    return {
      content: [{ type: "text", text: "주소 없는 일반 브라우저 열기 요청이에요. 주소를 추측하지 말고 browser_open에서 url을 생략하세요." }],
      isError: true,
    };
  }
  const crRefused = await crBrowserOpenRefusal(host, url);
  if (crRefused) return { content: [{ type: "text", text: crRefused }], isError: true };
  if (alreadyOpen) {
    const focused = await focusOpenPage(host, url);
    return withPageState(
      { content: [{ type: "text", text: `이미 브라우저에 열려 있어요 — 다시 열지 않았어요: ${url}` }] },
      focused ?? current ?? null,
    );
  }
  if (isLoopbackUrl(url) && (await readLivePreviewUrl(host)) === null) {
    const started = await host.startLivePreview();
    if (started) {
      return withPageState(
        {
          content: [
            {
              type: "text",
              text:
                `${url} 은(는) 이 Studio 의 주소가 아니에요 — 라이브 서버 포트는 실행할 때마다 ` +
                `무작위로 정해집니다. 라이브 서버를 시작하고 브라우저에 열었어요: ${started}. ` +
                `앞으로 미리보기는 이 주소를 그대로 쓰세요(포트를 추측하거나 참가자에게 묻지 마세요).`,
            },
          ],
        },
        { url: started },
      );
    }
  }
  if (host.crEnabled?.() && host.crScope) {
    const v = host.crScope(url);
    if (!v.ok) return { content: [{ type: "text", text: v.reason }], isError: true };
  }
  if (isLoopbackUrl(url) && (await readLivePreviewUrl(host)) !== null && host.fetchHead) {
    try {
      const head = await host.fetchHead(url);
      if (!head.ok) {
        return withPageState(
          {
            content: [{ type: "text", text: `파일이 없어요: ${url} (HTTP ${head.status}). chalk_open_course로 파일을 먼저 만드세요.` }],
            isError: true,
          },
          await readCurrentPage(host),
        );
      }
    } catch { /* timeout 등 → 기존 경로로 진행 */ }
  }
  let outcome: BrowserOpenOutcome | void;
  try {
    outcome = await host.openBrowser(url);
  } catch (err) {
    if (!host.crEnabled?.()) throw err;
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
  const replaced = replacedPageOf(outcome, url);
  const opened = redirectedFrom
    ? `${redirectedFrom} 이 아니라 실제 라이브 서버 주소로 열었어요: ${url} ` +
      `(포트는 실행할 때마다 달라집니다 — 추측하지 말고 이 주소를 쓰세요).`
    : `브라우저에서 열었어요: ${url}`;
  const text = replaced
    ? `${opened}\n` +
      `(참고: 같은 자리에 있던 ${replaced} 는 이 주소로 이동했어요 — ` +
      `결과물 1개 · 참고 사이트 1개까지만 동시에 띄울 수 있어요. ` +
      `둘을 비교하려면 번갈아 열어야 합니다.)`
    : opened;
  return withPageState({ content: [{ type: "text", text }] }, { url });
}

/** Tool name, description and JSON inputSchema for page_pdf_save (#3221). */
export const PAGE_PDF_SAVE_TOOL_DEF = {
  name: "page_pdf_save",
  description:
    "작업 폴더의 HTML 파일(.html/.htm)을 PDF로 저장한다. PDF가 필요하면 이 도구만 쓴다: Studio 안의 브라우저로 인쇄하므로 " +
    "Chrome·wkhtmltopdf 같은 다른 앱이나 다른 앱 안의 프로그램을 실행하지 않는다(그런 실행은 막혀 있다). " +
    "path 는 작업 폴더 기준 상대 경로이고, 결과는 같은 폴더에 같은 이름의 .pdf 로 저장된다. " +
    "작업 폴더 밖의 파일은 저장할 수 없으니, 먼저 작업 폴더 안에 HTML을 만든다.",
  inputSchema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
} as const;

/** Core handler for page_pdf_save. */
export async function runPagePdfSave(host: BrowserMcpHost, input: { path?: unknown }): Promise<McpToolResult> {
  const p = typeof input?.path === "string" ? input.path.trim() : "";
  if (!p || p.length > 300) return { content: [{ type: "text", text: "path 에 작업 폴더 안 HTML 파일의 상대 경로를 적어 주세요." }], isError: true };
  if (!host.savePagePdf) return { content: [{ type: "text", text: HOST_LACKS("PDF로 저장") }], isError: true };
  const r = await host.savePagePdf(p);
  return { content: [{ type: "text", text: r.text }], ...(r.ok ? {} : { isError: true }) };
}

/**
 * Core handler for live_preview_start — extracted so the instructor local runtime
 * path can reuse the same logic. The MCP server factory.tool callback delegates here.
 */
export async function runLivePreviewStart(host: BrowserMcpHost): Promise<McpToolResult> {
  if (host.generalBrowserRequest) {
    return {
      content: [{ type: "text", text: "일반 브라우저 열기 요청에는 browser_open에서 url을 생략하세요. 작업 폴더 미리보기나 파일 생성은 요청되지 않아 시작하지 않았어요." }],
      isError: true,
    };
  }
  const url = await host.startLivePreview();
  if (!url) {
    return withPageState(
      {
        content: [
          { type: "text", text: "라이브 프리뷰를 시작하지 못했어요 (작업 폴더가 없나요?)." },
        ],
        isError: true,
      },
      await readCurrentPage(host),
    );
  }
  return withPageState(
    { content: [{ type: "text", text: `라이브 프리뷰를 시작하고 브라우저에 열었어요: ${url}` }] },
    { url },
  );
}

/**
 * Build the in-process "hypeproof" MCP server instance for one coach turn.
 * Register the RESULT under `mcpServers[HYPEPROOF_MCP_SERVER_NAME]` only when
 * the profile grants the browser capability (permittedMcpToolsFor decides —
 * never call this for an ungranted cohort).
 */
export function buildHypeproofMcpServer(
  factory: SdkMcpFactory,
  z: ZodLike,
  host: BrowserMcpHost,
  // `browser` defaults to true so existing callers keep today's server; sdkCoach passes the
  // flags from hypeproofMcpRegistration so a publish-only cohort gets no browser tool.
  opts: { curriculumRuntime?: boolean; browser?: boolean; publishSite?: boolean } = {},
): unknown {
  const browserOpen = factory.tool(
    BROWSER_OPEN_TOOL_DEF.name,
    BROWSER_OPEN_TOOL_DEF.description,
    { url: optionalSchema(z.string()) },
    async (args) => runBrowserOpen(host, args["url"]),
  );

  const browserScreenshot = factory.tool(
    "browser_screenshot",
    "지금 열려 있는 통합 브라우저 탭의 스크린샷을 찍어 이미지로 돌려준다. " +
      "학생이 만든 페이지가 실제로 어떻게 보이는지 확인할 때 사용.",
    {},
    async () => {
      // #457 후속 — 스크린샷 경로가 둘로 갈려 있었다. 이 도구는
      // host.screenshot()(capturePageContext: 매 호출 새 CDP 세션 attach+close)
      // 을 쓰고, browser_read 는 BrowserControl(세션 재사용)을 쓴다. 실측에서
      // **screenshot 만** 반복 실패했다(2026-07-26 T1: 2/2 실패, 실사용 로그에서도
      // 동일). 같은 Page.captureScreenshot 인데 세션 관리만 다르다.
      //
      // 그래서 inspect 가 있으면 그쪽(BrowserControl)을 먼저 쓴다 — 구현이 하나면
      // 한쪽만 고쳐지는 일이 없다. 없을 때만 기존 경로로 폴백한다.
      if (host.inspect) {
        const viaCdp = await host.inspect("browser_screenshot", {});
        if (viaCdp && !viaCdp.isError) return withPageState(viaCdp, await readCurrentPage(host));
        // CR-11 — with the switch on the CR executor's refusal (out of scope, no version,
        // a dialog open) is the answer; the fallback below would capture the tab anyway.
        if (viaCdp && host.crEnabled?.()) return withPageState(viaCdp, await readCurrentPage(host));
      }
      const shot = await host.screenshot();
      if (!shot || !shot.imageBase64) {
        return withPageState(
          {
            content: [
              { type: "text", text: "열려 있는 브라우저 탭이 없어서 스크린샷을 찍지 못했어요." },
            ],
            isError: true,
          },
          await readCurrentPage(host),
        );
      }
      const label = [shot.title, shot.url].filter(Boolean).join(" — ");
      return withPageState(
        {
          content: [
            { type: "image", data: shot.imageBase64, mimeType: shot.mimeType || "image/jpeg" },
            ...(label ? [{ type: "text", text: label } as const] : []),
            { type: "text", text: referenceCaptureText(shot.capture ?? referenceCaptureMetadata({
              data: shot.imageBase64, mime: shot.mimeType || "image/jpeg", url: shot.url, title: shot.title,
            })) },
          ],
        },
        // 캡처한 탭이 곧 현재 페이지. 호스트 재조회 없이 그대로 상태로 쓴다.
        shot.url ? { url: shot.url, title: shot.title } : await readCurrentPage(host),
      );
    },
  );

  const livePreviewStart = factory.tool(
    LIVE_PREVIEW_START_TOOL_DEF.name,
    LIVE_PREVIEW_START_TOOL_DEF.description,
    {},
    async () => runLivePreviewStart(host),
  );

  const pagePdfSave = factory.tool(
    PAGE_PDF_SAVE_TOOL_DEF.name,
    PAGE_PDF_SAVE_TOOL_DEF.description,
    { path: z.string() },
    async (input: { path?: unknown }) => runPagePdfSave(host, input),
  );

  // ── #457 검사 3종 ─────────────────────────────────────────────────────────
  // 전부 host.inspect 로 위임한다 — CDP 구현은 browserControl.ts 에 이미 있고
  // 여기서 다시 구현하면 프록시 경로와 갈라진다(같은 동작이 두 벌이 되는 순간
  // 한쪽만 고쳐지는 버그가 생긴다).
  const inspectOrFail = async (
    name: string,
    input: Record<string, unknown>,
    absent: string,
  ): Promise<McpToolResult> => {
    if (!host.inspect) {
      return withPageState(
        { content: [{ type: "text", text: absent }], isError: true },
        await readCurrentPage(host),
      );
    }
    const r = await host.inspect(name, input);
    return withPageState(
      r ?? { content: [{ type: "text", text: absent }], isError: true },
      await readCurrentPage(host),
    );
  };

  /** cr-verify — delegated to the host's VerifySession, the one the proxy path runs (CR-03). */
  const verifyOrFail = async (name: string, input: Record<string, unknown>): Promise<McpToolResult> =>
    host.verify ? host.verify(name, input) : { content: [{ type: "text", text: HOST_LACKS("제품 테스트") }], isError: true };

  const browserRead = factory.tool(
    "browser_read",
    "지금 열려 있는 페이지의 접근성/DOM 스냅샷을 **텍스트로** 읽는다. 상호작용 요소마다 " +
      "[ref=eN] 라벨이 붙는다. browser_click / browser_type 전에 **반드시 먼저** 호출해 " +
      "최신 ref 를 얻어라 — 페이지가 이동하거나 클릭이 일어나면 이전 ref 는 무효가 된다. " +
      "스크린샷은 '어떻게 보이는가'를, 이 도구는 '무엇을 누를 수 있는가'를 알려준다.",
    {},
    async () => inspectOrFail("browser_read", {}, "열려 있는 브라우저 탭이 없어서 페이지를 읽지 못했어요."),
  );

  const browserClick = factory.tool(
    "browser_click",
    "페이지의 요소를 **실제로 클릭한다**(CDP 입력 이벤트 — 진짜 마우스 클릭과 같다). " +
      "ref 는 browser_read 가 붙여준 [ref=eN] 값이다. 버튼·링크가 정말 동작하는지 " +
      "확인하려면 눈으로 보는 것이 아니라 이 도구로 눌러봐야 한다.",
    { ref: z.string() },
    async (args: Record<string, unknown>) =>
      inspectOrFail(
        "browser_click",
        { ref: String(args["ref"] ?? "") },
        "클릭하지 못했어요. browser_read 로 ref 를 다시 받아보세요.",
      ),
  );

  const browserType = factory.tool(
    "browser_type",
    "입력 요소에 텍스트를 **실제로 타이핑한다**. submit=true 면 입력 후 Enter 까지 누른다. " +
      "폼이 동작하는지 확인할 때 쓴다. ref 는 browser_read 가 준 값이다.",
    {
      ref: z.string(),
      text: z.string(),
      // boolean 을 제공하지 않는 주입(테스트 fake)에서도 서버가 만들어져야 하므로
      // 없으면 이 필드를 생략한다 — submit 은 핸들러가 기본 false 로 처리한다.
      ...(typeof z.boolean === "function" ? { submit: z.boolean() } : {}),
    },
    async (args: Record<string, unknown>) =>
      inspectOrFail(
        "browser_type",
        {
          ref: String(args["ref"] ?? ""),
          text: String(args["text"] ?? ""),
          submit: args["submit"] === true,
        },
        "입력하지 못했어요. browser_read 로 ref 를 다시 받아보세요.",
      ),
  );

  // ── CR-04/CR-06 Experiment Browser tools, only behind the CR switch (CR-02) ──
  const crTools: unknown[] = [];
  if (opts.curriculumRuntime === true) {
    const absent = "실험 브라우저 도구를 쓸 수 없어요. browser_observe로 다시 읽어보세요.";
    crTools.push(
      factory.tool(
        "browser_observe",
        "지금 페이지를 관찰한다: URL·경로, [ref=eN] 스냅샷, 화면 캡쳐, 뷰포트, 문서 세대, 이 문서의 콘솔·오류·실패한 요청, 산출물 버전.",
        {},
        async () => inspectOrFail("browser_observe", {}, absent),
      ),
      factory.tool(
        "browser_select",
        "ref 선택 상자(select)의 값을 고른다. value는 option의 value 또는 보이는 글자. 결과에 조작 뒤의 관찰이 온다.",
        { ref: z.string(), value: z.string() },
        async (args: Record<string, unknown>) =>
          inspectOrFail("browser_select", { ref: String(args["ref"] ?? ""), value: String(args["value"] ?? "") }, absent),
      ),
      factory.tool(
        "browser_scroll",
        "ref 요소가 보이게 스크롤한다. ref 없이 dy(픽셀)만 주면 페이지를 스크롤한다. 결과에 조작 뒤의 관찰이 온다.",
        {
          // Either field alone is valid, so both are optional where zod offers it.
          ...(typeof z.number === "function" ? { dy: optionalSchema(z.number()) } : {}),
          ref: optionalSchema(z.string()),
        },
        async (args: Record<string, unknown>) =>
          inspectOrFail(
            "browser_scroll",
            { ...(args["ref"] ? { ref: String(args["ref"]) } : {}), ...(args["dy"] !== undefined ? { dy: Number(args["dy"]) } : {}) },
            absent,
          ),
      ),
      factory.tool(
        "browser_hover",
        "ref 요소 위에 마우스를 올린다. 결과에 조작 뒤의 관찰이 온다.",
        { ref: z.string() },
        async (args: Record<string, unknown>) => inspectOrFail("browser_hover", { ref: String(args["ref"] ?? "") }, absent),
      ),
      factory.tool(
        "browser_reload",
        "페이지를 새로 고친다. 새 문서가 되므로 이전 ref는 무효가 된다. 결과에 새로 고친 뒤의 관찰이 온다.",
        {},
        async () => inspectOrFail("browser_reload", {}, absent),
      ),
      // cr-verify — the runner, not the model, judges each criterion (CR-15).
      factory.tool(
        "verify_criterion",
        "학생이 시작한 제품 테스트에서 기대 조건 하나를 실행한다. criterion_id와 plan(JSON 문자열 {steps, expect})을 준다. 러너가 미리보기를 새로 열어 단계를 실행하고 관찰로 판정한다.",
        { criterion_id: z.string(), plan: z.string() },
        async (args: Record<string, unknown>) => verifyOrFail("verify_criterion", { criterion_id: String(args["criterion_id"] ?? ""), plan: String(args["plan"] ?? "") }),
      ),
      factory.tool(
        "verify_propose_criteria",
        "학생에게 관찰 가능한 기대 조건 1~5개를 제안한다(criteria: JSON 배열 문자열). 학생이 확인해야 테스트에 쓰인다.",
        { criteria: z.string() },
        async (args: Record<string, unknown>) => verifyOrFail("verify_propose_criteria", { criteria: String(args["criteria"] ?? "") }),
      ),
    );
  }

  const publishTools: unknown[] = [];
  if (opts.publishSite === true) {
    publishTools.push(
      factory.tool(
        PUBLISH_SITE_TOOL_NAME,
        PUBLISH_SITE_TOOL_DESCRIPTION,
        {
          repo_name: optionalSchema(z.string()),
          custom_domain: optionalSchema(z.string()),
          // `stage` is a string here and validated in the handler: the injected zod surface
          // (ZodLike) may lack enum (it is optional there), and an unknown stage must fall back to the safe default
          // rather than make the whole server fail to build.
          stage: optionalSchema(z.string()),
          ...(typeof z.boolean === "function" ? { check_only: optionalSchema(z.boolean()) } : {}),
        },
        async (args: Record<string, unknown>) => {
          if (!host.publishSite) return { content: [{ type: "text", text: HOST_LACKS("홈페이지 올리기") }], isError: true };
          return host.publishSite(publishInputFromArgs(args));
        },
      ),
    );
  }

  const browserTools = opts.browser === false ? [] : [browserOpen, browserScreenshot, livePreviewStart, browserRead, browserClick, browserType, pagePdfSave, ...crTools];
  return factory.createSdkMcpServer({
    name: HYPEPROOF_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [...browserTools, ...publishTools],
  });
}

/**
 * The model reads this description to decide when and how to call the tool. It restates the
 * Service skill's contract (publish-homepage.md) in one place so a coach without that skill
 * loaded still never claims an unverified address.
 */
export const PUBLISH_SITE_TOOL_DESCRIPTION =
  "작업 폴더의 홈페이지를 참가자의 GitHub에 올린다(사전 검사·로그인·저장소·커밋·Pages·확인까지 매번 같은 순서). " +
  "stage: \"save\" 는 저장만(Pages 끔, 예정 주소 planned_url), \"publish\"(기본)는 인터넷 주소까지 만든다. " +
  "check_only: true 는 아무것도 올리지 않고 지금 상태만 본다. 결과 JSON 의 verified 가 true 일 때만 url 을 주소로 말한다. " +
  "needs_user 가 있으면 그 코드를 참가자에게 보여 주고 참가자가 직접 입력하게 한다(대신 누르지 않는다). " +
  "error 가 있으면 message_ko 와 next_action_ko 를 그대로 전한다.";

/** Tool arguments → pipeline input. Unknown/invalid values become absent, never a guess. */
export function publishInputFromArgs(args: Record<string, unknown>): PublishSiteInput {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const stage = args["stage"] === "save" ? "save" : args["stage"] === "publish" ? "publish" : undefined;
  return {
    ...(str(args["repo_name"]) ? { repo_name: str(args["repo_name"]) } : {}),
    ...(str(args["custom_domain"]) ? { custom_domain: str(args["custom_domain"]) } : {}),
    ...(args["check_only"] === true ? { check_only: true } : {}),
    ...(stage ? { stage } : {}),
  };
}
