import type { VisitorPreview } from "./visitorPreview.ts";
import { activePublishLink, publishSharing } from "./publishSharing.ts";
import { memoryOutboundPath, privateOutboundPath, contentBytes, type OutboundConfirmation } from "./outboundConsent.ts";
/** REQ-KNOW-51 / DEC-KNOW-51: a stored version with a memory file gets no new link; the learner publishes again and confirms. */
export const MEMORY_VERSION_LINK = "AI 기억 파일이 들어 있는 버전이라 새 링크를 만들지 않아요. 다시 공개하면 보낼 파일을 확인한 뒤 링크를 받을 수 있어요.";
// "사용자 테스트용으로 공개" — the App side of Publish for User Test (cr-publish #1393;
// CR-11, CR-17–CR-22, CR-39, CR-64, CR-73, CR-81). Pure over its ports, vscode-free, so a
// smoke drives exactly what the provider runs.
//
// One action from the panel: build the R4 published set of the version in the preview (the
// publish scan refuses before anything is uploaded), upload it as a content-addressed test
// version of the student's Project, start the test (the Service stores the Experiment and,
// when the Project has none, the student's Hypothesis: CR-39), and issue a share link with
// the expiry the student chose (there is no default yet: CR-19) and an optional channel
// label (CR-73). The panel shows whether that version is verified, read from the record's
// events by `productVerification` for exactly this version (CR-81); nothing here sets it.
// The project's test origin joins the Experiment Browser's allowed origins (CR-11).

import { lessonFeatureOff } from "./denialSource.ts";
import type { SeatAudience } from "./seatVocabulary.ts";
import { productVerification } from "@hypeproof/measurement-core/verification";
import type { ObservationEvent } from "@hypeproof/measurement-core/legacy-observation";
import { buildPublishSet, publishSetRefusalText, type PublishSet } from "./publishSet.ts";
import { curriculumRequest, publishTestVersion, type CurriculumResult } from "./galleryPublish.ts";
import { SHARING_UNKNOWN, type PublishExperimentView, type PublishForm, type PublishLinkView, type PublishView } from "./publishView.ts";

export interface PublishPorts {
  // Required key (REQ-KNOW-63): a caller that forgets the wiring fails to compile, not closed at run time.
  previewVisitor: VisitorPreview;
  confirmOutbound?: OutboundConfirmation;
  scopeKey?(): string;
  privateDirectories?(): string[];
  switchOn(): boolean;
  /** Seat wording for the switch-off copy (REQ-STUDIO-DENIAL-SOURCE). Default classroom. */
  audience?(): SeatAudience;
  token(): Promise<string | null>;
  /** The Service's curriculum base (`curriculumBase(proxyUrl)`). */
  base(): string;
  fetchImpl?: typeof fetch;
  /** The live server's root and the entry page's URL path; null when no preview runs. */
  root(): string | null;
  entry(): string | null;
  /** The seat's observation events, for CR-81. */
  events(): Promise<readonly ObservationEvent[]>;
  projectId(): string | undefined;
  setProjectId(id: string | undefined): Promise<void>;
  /** The project's test origin as last read from the Service, kept with the project id (CR-11 after a restart). */
  rememberedOrigin?(): string | null;
  rememberOrigin?(origin: string | null): Promise<void>;
  /** The lesson's curriculum week, when the profile names one. */
  week(): number | null;
  defaultTitle(): string;
  now?(): number;
  /** The QR image of a share URL (testQr.ts `qrDataUrl` in the App), drawn on this machine. */
  qr(url: string): string;
}

/** CR-64: publishing a test version completes in under 10 s. */
export const PUBLISH_TARGET_MS = 10_000;

/** A timing against the target: a miss is recorded with its cause, never rounded away (CR-T20). */
export function publishTiming(startedAt: number, endedAt: number, phases: Record<string, number>, targetMs = PUBLISH_TARGET_MS): { ms: number; ok: boolean; cause: string | null } {
  const ms = endedAt - startedAt;
  if (ms < targetMs) return { ms, ok: true, cause: null };
  const slowest = Object.entries(phases).sort((a, b) => b[1] - a[1])[0];
  return { ms, ok: false, cause: slowest ? `${slowest[0]} ${slowest[1]}ms` : "unknown" };
}

type Client = { base: string; token: string; fetchImpl?: typeof fetch };

type ProjectState = {
  project: { id: string; title: string; members?: string[] };
  test_origin: string | null;
  versions: Array<{ id: string; entry_html?: string; files?: Array<{ path: string; sha256: string; bytes: number }> }>;
  hypotheses: Array<{ id: string; statement: string }>;
  experiments: Array<{ id: string; week: number; question: string; method: string; success_criteria: string[]; hypothesis_id: string; product_version_id: string; status: string }>;
  links: Array<{ id: string; experiment_id: string; channel?: string; expires_at: number; state: "live" | "revoked" | "expired"; share_url: string | null }>;
  /** Sessions opened per channel for each experiment with any (one grouped read on the Service). */
  sessions_opened?: Record<string, PublishExperimentView["sessions"]>;
};

/** Said while a solo Project with live links holds the student back from the team's (CR-19). */
export const TEAM_WAITS_FOR_LINKS = "팀 프로젝트가 준비됐어요. 이 프로젝트에 아직 열려 있는 링크가 있어서, 링크를 모두 끄거나 기간이 끝나면 팀 프로젝트로 옮겨 가요.";

const DAY = 24 * 3600_000;
/** One refused file as the student reads it; a hit without a known line names the file only. */
const hitLine = (h: { file: string; line: number; rule: string }) => (h.line > 0 ? `${h.file} ${h.line}번째 줄 (${h.rule})` : `${h.file} (${h.rule})`);
/** The sign-in code, in the App's own words for it (startPage.ts "수업 참여 코드"). */
const SIGN_IN = "참여 코드를 먼저 입력해 주세요.";

export class PublishSession {
  private outboundBusy = false;
  private origin: string | null = null;
  private cached: ProjectState | null = null;
  private timing: PublishView["timing"] = null;
  private manifest: string[] = [];
  /** REQ-KNOW-51: the activity (scope + root) the manifest was typed in. A selection never carries over to another one. */
  private manifestFor: string | null = null;
  private readonly ports: PublishPorts;
  constructor(ports: PublishPorts) {
    this.ports = ports;
  }

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }

  /** CR-11: the published test origin of the student's own Project (none until known). */
  publishedOrigins(): string[] {
    const origin = this.origin ?? this.ports.rememberedOrigin?.() ?? null;
    return this.ports.switchOn() && this.ports.projectId() && origin ? [origin] : [];
  }

  private async client(): Promise<Client | null> {
    const token = await this.ports.token();
    return token ? { base: this.ports.base(), token, ...(this.ports.fetchImpl ? { fetchImpl: this.ports.fetchImpl } : {}) } : null;
  }

  private scanContext(projectId: string | undefined) {
    return { projectId: projectId ?? "", testOrigin: this.origin };
  }

  private async currentSet(projectId: string | undefined, manifest: string[]): Promise<{ ok: true; set: PublishSet } | { ok: false; message: string; lines: string[] } | null> {
    const root = this.ports.root();
    const entry = this.ports.entry();
    if (!root || !entry) return null;
    const built = await buildPublishSet(root, entry, manifest, this.scanContext(projectId), this.ports.privateDirectories?.());
    if (built.ok) return built;
    return {
      ok: false,
      message: publishSetRefusalText(built.refusal),
      lines: (built.refusal.hits ?? []).map(hitLine),
    };
  }

  private async state(client: Client, projectId: string): Promise<CurriculumResult<ProjectState>> {
    const r = await curriculumRequest<ProjectState>(client, "GET", `/projects/${encodeURIComponent(projectId)}`);
    if (!r.ok) return r;
    // A 200 that is not a Project (an HTML error page, `{}`) is a failed read, never a state to draw.
    const b = r.body as Partial<ProjectState> | null;
    if (!b || typeof b !== "object" || !b.project || typeof b.project.id !== "string" || !Array.isArray(b.experiments) || !Array.isArray(b.links) || !Array.isArray(b.hypotheses)) {
      return { ok: false, status: r.status, code: "malformed", message: `${SHARING_UNKNOWN} (${r.status})` } as CurriculumResult<ProjectState>;
    }
    this.origin = r.body.test_origin;
    this.cached = r.body;
    await this.ports.rememberOrigin?.(this.origin);
    return r;
  }

  /**
   * The student's Project on the Service. The remembered one when it answers; otherwise one
   * the student is a member of (`GET /projects`: a team Project the director set up, or their
   * own after a lost id), the newest first; otherwise none (`state: null`), and only then may
   * a publish create one. Any answer that is not definite (a network failure, a 5xx, or a
   * 404 from the list, which is also what every route answers while the switch is off) is an
   * error the student reads, and the remembered id is kept: nothing is forked or orphaned.
   * A solo Project that still has a live link is not left for the team's: its links would drop
   * out of the panel while they keep serving, and the student could no longer turn them off
   * (CR-19). The panel says so, and the move happens once those links are off or expired.
   */
  private async resolveProject(client: Client): Promise<{ ok: true; state: ProjectState | null; notice?: string } | { ok: false; message: string }> {
    const remembered = this.ports.projectId();
    if (remembered) {
      const r = await this.state(client, remembered);
      if (r.ok) {
        // A solo Project made before the director set up the team gives way to the team's
        // (decision 7), so the team's experiments and evidence stay in one Project. Only a
        // definite list can move it; any failure keeps the remembered one.
        if ((r.body.project.members?.length ?? 1) > 1) return { ok: true, state: r.body };
        const list = await curriculumRequest<{ projects: Array<{ id: string; members?: string[] }> }>(client, "GET", "/projects");
        const team = list.ok && Array.isArray(list.body.projects) ? [...list.body.projects].reverse().find((p) => p.id !== remembered && (p.members?.length ?? 0) > 1) : undefined;
        if (!team) return { ok: true, state: r.body };
        if (r.body.links.some((l) => l.state === "live")) return { ok: true, state: r.body, notice: TEAM_WAITS_FOR_LINKS };
        const t = await this.state(client, team.id);
        if (!t.ok) return { ok: true, state: r.body };
        await this.ports.setProjectId(team.id);
        return { ok: true, state: t.body };
      }
      if (r.status !== 404) return { ok: false, message: r.message };
    }
    const list = await curriculumRequest<{ projects: Array<{ id: string; created_at?: number; members?: string[] }> }>(client, "GET", "/projects");
    if (!list.ok) return { ok: false, message: list.message };
    const projects = Array.isArray(list.body.projects) ? list.body.projects : [];
    const pick = projects.find((p) => p.id === remembered) ?? projects[projects.length - 1];
    if (!pick) {
      // The Service answered the list and the remembered Project is not in it: it is no longer this student's.
      if (remembered) {
        await this.ports.setProjectId(undefined);
        this.origin = null;
        await this.ports.rememberOrigin?.(null);
      }
      return { ok: true, state: null };
    }
    const r = await this.state(client, pick.id);
    if (!r.ok) return { ok: false, message: r.message };
    if (pick.id !== remembered) await this.ports.setProjectId(pick.id);
    return { ok: true, state: r.body };
  }

  /**
   * CR-10 on a published page: the version a link serves is the one its experiment pins, so a
   * browser result taken there names that version (never the local files). null when the URL
   * is not a link of this Project as last read from the Service.
   */
  publishedArtifactVersion(url: string): { id: string; entry: string; files: Array<{ path: string; sha256: string; bytes: number }> } | null {
    const st = this.cached;
    if (!st?.test_origin) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.origin !== st.test_origin) return null;
    const m = /^\/l\/([A-Za-z0-9_-]{22})(?:\/(.*))?$/.exec(u.pathname);
    const link = m ? st.links.find((l) => l.id === m[1]) : undefined;
    const exp = link ? st.experiments.find((e) => e.id === link.experiment_id) : undefined;
    const version = exp ? st.versions.find((v) => v.id === exp.product_version_id) : undefined;
    if (!version?.files) return null;
    return { id: version.id, entry: version.entry_html ?? "", files: version.files };
  }

  /** What the panel draws, computed every time from the files, the record and the Service. Never throws: an unreadable answer is `read_failed`. */
  async view(notice: string | null = null): Promise<PublishView> {
    try {
      return await this.readView(notice);
    } catch {
      return { ...this.emptyView(notice), reason: SHARING_UNKNOWN + ".", read_failed: true };
    }
  }

  /** Same scope the host keys its last good read by: another account or folder never sees this one's rows. */
  readScope(): string {
    return this.activityKey();
  }

  private emptyView(notice: string | null): PublishView {
    return {
      available: false,
      reason: null,
      project: null,
      version: { id: null, files: [], manifest_added: [], refusal: null, refusal_lines: [] },
      verification: { state: "not_verified", open: [] },
      hypotheses: [],
      experiments: [],
      timing: this.timing,
      notice,
    };
  }

  private async readView(notice: string | null): Promise<PublishView> {
    const empty = this.emptyView(notice);
    if (!this.ports.switchOn()) return { ...empty, reason: lessonFeatureOff("사용자 테스트 공개", this.ports.audience?.()) };
    const client = await this.client();
    if (!client) return { ...empty, reason: SIGN_IN };
    const resolved = await this.resolveProject(client);
    const state = resolved.ok ? resolved.state : null;
    if (!resolved.ok) notice ??= resolved.message;
    else if (resolved.notice) notice ??= resolved.notice;
    if (!resolved.ok) return { ...empty, reason: resolved.message.replace(/^공개하지 못했어요/, SHARING_UNKNOWN), read_failed: true };
    const selection = this.selection();
    const built = await this.currentSet(state?.project.id, selection);
    const version: PublishView["version"] = !built
      ? { id: null, files: [], manifest_added: [], refusal: "미리보기를 먼저 켜 주세요. 미리보기에 보이는 페이지를 공개해요.", refusal_lines: [] }
      : built.ok
        ? { id: built.set.id, files: built.set.files.map((f) => ({ path: f.path, bytes: f.bytes })), manifest_added: [...built.set.manifest_added, ...built.set.memory.filter((m) => !built.set.manifest_added.includes(m))], refusal: null, refusal_lines: [] }
        : { id: null, files: [], manifest_added: selection, refusal: built.message, refusal_lines: built.lines };
    const verification = productVerification(await this.ports.events(), version.id);
    const experiments: PublishExperimentView[] = [];
    // The per-channel counts come with the Project read (one grouped query), not one call per experiment.
    const counts = state?.sessions_opened;
    for (const e of state?.experiments ?? []) {
      experiments.push({
        id: e.id,
        week: e.week,
        question: e.question,
        method: e.method,
        success_criteria: e.success_criteria,
        hypothesis: state?.hypotheses.find((h) => h.id === e.hypothesis_id)?.statement ?? null,
        product_version_id: e.product_version_id,
        current_version: e.product_version_id === version.id,
        status: e.status,
        links: (state?.links ?? []).filter((l) => l.experiment_id === e.id).map((l) => this.linkView(l)),
        sessions: counts ? (counts[e.id] ?? { channels: {}, unlabelled: 0, unknown: 0 }) : null,
      });
    }
    return {
      ...empty,
      available: true,
      project: state ? { id: state.project.id, title: state.project.title } : null,
      version,
      verification,
      hypotheses: state?.hypotheses.map((h) => ({ id: h.id, statement: h.statement })) ?? [],
      experiments: experiments.reverse(),
      notice,
    };
  }

  private linkView(l: ProjectState["links"][number]): PublishLinkView {
    const state = l.state === "live" && (!Number.isFinite(l.expires_at) || l.expires_at <= this.now()) ? "expired" : l.state;
    const live = activePublishLink({ ...l, state, channel: l.channel ?? null, qr: null }, this.now());
    return { id: l.id, channel: l.channel ?? null, share_url: live ? l.share_url : null, qr: live ? this.ports.qr(l.share_url!) : null, expires_at: l.expires_at, state };
  }

  /** Re-read before copying: another window may have revoked the link. No URL from the webview is trusted. */
  async copyLink(versionId: string, write: (url: string) => PromiseLike<void>): Promise<string | null> {
    const scope = this.activityKey(), base = this.ports.base(), token = await this.ports.token();
    if (!this.ports.switchOn() || !token) return "공유 상태를 확인할 수 없어요.";
    const view = await this.view();
    if (!view.available || this.activityKey() !== scope || this.ports.base() !== base || await this.ports.token() !== token || !this.ports.switchOn()) return "공유 상태를 다시 확인해 주세요.";
    const sharing = publishSharing(versionId, view.experiments, this.now());
    if (!sharing.url) return sharing.reason;
    await write(sharing.url);
    return null;
  }

  /** Add or remove files beyond static reach (the R4 manifest); the panel lists the set again. */
  setManifest(paths: unknown): void {
    this.manifest = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 300).slice(0, 50) : [];
    this.manifestFor = this.activityKey();
  }

  private activityKey(): string {
    return JSON.stringify([this.ports.scopeKey?.() ?? null, this.ports.root() ?? null]);
  }

  /** The manifest, or nothing when the activity changed since it was typed (a memory file chosen elsewhere is not chosen here). */
  private selection(): string[] {
    if (this.manifestFor !== this.activityKey()) { this.manifest = []; this.manifestFor = null; }
    return [...this.manifest];
  }

  /**
   * The one publish action: version → test → link. Every refusal is the student's to read,
   * and nothing is uploaded when the set is refused (the scan runs before any request).
   */
  async submit(form: PublishForm) {
    if (this.outboundBusy) return { ok: false as const, message: "이미 보내기를 확인하고 있어요." };
    this.outboundBusy = true;
    try { return await this.submitOnce(form); } finally { this.outboundBusy = false; }
  }

  private async submitOnce(form: PublishForm): Promise<{ ok: true; share_url: string } | { ok: false; message: string; lines?: string[] }> {
    form = structuredClone(form);
    if (!this.ports.switchOn()) return { ok: false, message: lessonFeatureOff("사용자 테스트 공개", this.ports.audience?.()) };
    const days = form.expires_in_days;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days > 90) return { ok: false, message: "링크를 언제까지 열어 둘지 골라 주세요." };
    const scope = this.ports.scopeKey?.(), root = this.ports.root(), entry = this.ports.entry();
    const client = await this.client();
    if (!client) return { ok: false, message: SIGN_IN };
    const expiresAt = this.now() + days * DAY;
    const current = async () => { const token = await this.ports.token(); return token === client.token && this.ports.switchOn() && this.ports.scopeKey?.() === scope && this.ports.root() === root && this.ports.entry() === entry && this.ports.base() === client.base; };
    const originalFetch = client.fetchImpl ?? fetch;
    client.fetchImpl = async (url, init) => {
      if (init?.method && init.method !== "GET" && !await current()) return new Response(JSON.stringify({ error: { message: "연결이 변경되어 보내지 않았어요." } }), { status: 403 });
      return originalFetch(url, init);
    };
    const started = this.now();
    const phases: Record<string, number> = {};
    const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const t = this.now();
      try {
        return await fn();
      } finally {
        phases[name] = this.now() - t;
      }
    };
    form.title = form.title?.trim() || this.ports.defaultTitle();
    form.week = form.week ?? this.ports.week() ?? 1;
    if (form.manifest) this.setManifest(form.manifest);
    const selection = this.selection();
    // The set is built and scanned before any request, so a refused set sends nothing and
    // leaves nothing behind on the Service.
    const pre = await phase("scan", () => this.currentSet(this.ports.projectId(), selection));
    if (!pre) return { ok: false, message: "미리보기를 먼저 켜 주세요. 미리보기에 보이는 페이지를 공개해요." };
    if (!pre.ok) return { ok: false, message: pre.message, lines: pre.lines };
    const resolved = await phase("resolve", () => this.resolveProject(client));
    if (!resolved.ok) return { ok: false, message: resolved.message };
    const devices = form.devices?.filter((d) => d === "camera" || d === "microphone");
    const labels = [...new Set((form.labels ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 30);
    const declarations = { ...(form.repeated_use ? { repeated_use: true } : {}), ...(devices?.length ? { devices } : {}), ...(labels.length ? { labels } : {}) };
    const experimentMetadata = {
      week: form.week,
      question: form.question, method: form.method, success_criteria: form.success_criteria,
      ...(form.hypothesis_id ? { hypothesis_id: form.hypothesis_id } : { hypothesis: form.hypothesis }),
      ...(Object.keys(declarations).length ? { declarations } : {}),
    };
    const linkSettings = { expires_at: expiresAt, ...(form.channel?.trim() ? { channel: form.channel.trim() } : {}) };
    const verification = productVerification(await this.ports.events(), pre.set.id);
    if (!await current()) return { ok: false, message: "활동이 바뀌어서 보내지 않았어요." };
    const recipient = `사용자 테스트 · ${new URL(client.base).host} · 프로젝트 구성원 ${(resolved.state?.project.members ?? []).join(", ") || "나"} · 링크를 받은 사람 (다시 공유 가능)`;
    if (!await this.ports.previewVisitor?.({ entry: pre.set.entry, audience: recipient, files: pre.set.files }) || !await current()) return { ok: false, message: "미리보기를 확인하지 않아 보내지 않았어요." };
    if (!await this.ports.confirmOutbound?.({ recipient, public: true, items: [...pre.set.files.map(f => ({ name: f.path, bytes: f.bytes, ...(pre.set.memory.includes(f.path) ? { memory: true as const } : {}) })), { name: "프로젝트 제목", bytes: contentBytes(form.title!) }, { name: "테스트 설명", bytes: contentBytes(JSON.stringify(experimentMetadata)) }, { name: "링크 설정", bytes: contentBytes(JSON.stringify(linkSettings)) }, ...(verification.state === "verified" ? [{ name: "검증 기록 참조", bytes: contentBytes(verification.run_id!) }] : [])] }) || !await current()) return { ok: false, message: "보내지 않았어요." };
    let projectId = resolved.state?.project.id;
    if (!projectId) {
      const made = await phase("project", () => curriculumRequest<{ project: { id: string } }>(client, "POST", "/projects", { title: form.title?.trim() || this.ports.defaultTitle() }));
      if (!made.ok) return { ok: false, message: made.message };
      projectId = made.body.project.id;
      await this.ports.setProjectId(projectId);
      await this.state(client, projectId);
    }
    // Rebuilt against the project and its origin (the token rule names both), and read again.
    const built = await phase("files", () => this.currentSet(projectId, selection));
    if (!built || !built.ok) return { ok: false, message: built ? built.message : "미리보기를 먼저 켜 주세요.", ...(built && !built.ok ? { lines: built.lines } : {}) };
    if (built.set.id !== pre.set.id || built.set.entry !== pre.set.entry) return { ok: false, message: "파일이 바뀌었어요. 내용을 다시 확인해 주세요." };
    const up = await phase("upload", () => publishTestVersion(client, projectId!, built.set, verification.state === "verified" ? verification.run_id : undefined));
    if (!up.ok) return this.refusal(up);
    const exp = await phase("experiment", () =>
      curriculumRequest<{ experiment: { id: string } }>(client, "POST", "/experiments", {
        project_id: projectId,
        product_version_id: built.set.id,
        ...experimentMetadata,
      }),
    );
    if (!exp.ok) return this.refusal(exp);
    const link = await phase("link", () => this.issue(client, exp.body.experiment.id, form.channel, days, expiresAt));
    this.timing = publishTiming(started, this.now(), phases);
    if (!link.ok) return this.refusal(link);
    return { ok: true, share_url: link.body.share_url };
  }

  private issue(client: Client, experimentId: string, channel: string | undefined, days: number, expiresAt = this.now() + days * DAY) {
    return curriculumRequest<{ share_url: string; test_origin: string }>(client, "POST", `/experiments/${encodeURIComponent(experimentId)}/links`, {
      expires_at: expiresAt,
      ...(channel?.trim() ? { channel: channel.trim() } : {}),
    });
  }

  private refusal(r: Extract<CurriculumResult<unknown>, { ok: false }>): { ok: false; message: string; lines?: string[] } {
    const hits = Array.isArray(r.detail?.hits) ? (r.detail!.hits as Array<{ file: string; line: number; rule: string }>) : [];
    return { ok: false, message: r.message, ...(hits.length ? { lines: hits.map(hitLine) } : {}) };
  }

  /** Another channel's link for a running experiment (CR-73). */
  async link(experimentId: string, form: { channel?: string; expires_in_days?: number }) {
    if (this.outboundBusy) return { ok: false as const, message: "이미 보내기를 확인하고 있어요." };
    this.outboundBusy = true;
    try { return await this.linkOnce(experimentId, form); } finally { this.outboundBusy = false; }
  }

  private async linkOnce(experimentId: string, form: { channel?: string; expires_in_days?: number }): Promise<{ ok: true; share_url: string } | { ok: false; message: string }> {
    form = structuredClone(form);
    if (!this.ports.switchOn()) return { ok: false, message: lessonFeatureOff("사용자 테스트 공개", this.ports.audience?.()) };
    const days = form.expires_in_days;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days > 90) return { ok: false, message: "링크를 언제까지 열어 둘지 골라 주세요." };
    const scope = this.ports.scopeKey?.(), root = this.ports.root(), entry = this.ports.entry();
    const client = await this.client();
    if (!client) return { ok: false, message: SIGN_IN };
    const expiresAt = this.now() + days * DAY;
    const current = async () => { const token = await this.ports.token(); return token === client.token && this.ports.switchOn() && this.ports.scopeKey?.() === scope && this.ports.root() === root && this.ports.entry() === entry && this.ports.base() === client.base; };
    const originalFetch = client.fetchImpl ?? fetch;
    client.fetchImpl = async (url, init) => {
      if (init?.method && init.method !== "GET" && !await current()) return new Response(JSON.stringify({ error: { message: "연결이 변경되어 보내지 않았어요." } }), { status: 403 });
      return originalFetch(url, init);
    };
    const resolved = await this.resolveProject(client);
    if (!resolved.ok) return { ok: false, message: resolved.message };
    const experiment = resolved.state?.experiments.find(e => e.id === experimentId);
    const version = resolved.state?.versions.find(v => v.id === experiment?.product_version_id);
    if (version?.files?.some(f => memoryOutboundPath(f.path, this.ports.privateDirectories?.() ?? []))) return { ok: false, message: MEMORY_VERSION_LINK };
    if (!version?.files?.length || version.files.some(f => privateOutboundPath(f.path) || this.ports.privateDirectories?.().some(dir => privateOutboundPath(f.path, dir)))) return { ok: false, message: "공유할 파일 목록을 확인하지 못했어요." };
    if (!await current()) return { ok: false, message: "활동이 바뀌어서 보내지 않았어요." };
    if (!await this.ports.confirmOutbound?.({ recipient: `사용자 테스트 · ${new URL(client.base).host} · 프로젝트 구성원 ${(resolved.state?.project.members ?? []).join(", ") || "나"} · 링크를 받은 사람`, public: true, items: [...version.files.map(f => ({ name: f.path, bytes: f.bytes })), { name: "링크 설정", bytes: contentBytes(JSON.stringify({ expires_at: expiresAt, ...(form.channel?.trim() ? { channel: form.channel.trim() } : {}) })) }] }) || !await current()) return { ok: false, message: "보내지 않았어요." };
    const r = await this.issue(client, experimentId, form.channel, days, expiresAt);
    return r.ok ? { ok: true, share_url: r.body.share_url } : this.refusal(r);
  }

  /** Turn a link off for good (CR-19). Other links of the experiment keep serving (CR-73). */
  async revoke(linkId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.ports.switchOn()) return { ok: false, message: lessonFeatureOff("사용자 테스트 공개", this.ports.audience?.()) };
    const client = await this.client();
    if (!client) return { ok: false, message: SIGN_IN };
    const r = await curriculumRequest(client, "POST", `/links/${encodeURIComponent(linkId)}/revoke`, {});
    return r.ok ? { ok: true } : this.refusal(r);
  }
}
