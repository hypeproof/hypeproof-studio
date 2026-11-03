import { createHash } from "node:crypto";

export interface ReferenceCapture {
  schema: "hps-reference-capture/1";
  url: string | null;
  title: string | null;
  capturedAt: string;
  mime: string;
  sha256: string;
  bytes: number;
  viewport: { width: number; height: number; deviceScaleFactor: number | null } | null;
  state: string;
  readiness: { document: string; fonts: string; pendingImages: number } | null;
}

export function referenceCaptureMetadata(args: {
  data: string; mime: string; url?: string | null; title?: string | null;
  viewport?: ReferenceCapture["viewport"]; readiness?: ReferenceCapture["readiness"];
  state?: string; capturedAt?: string;
}): ReferenceCapture {
  const bytes = Buffer.from(args.data, "base64");
  if (!bytes.length) throw new Error("빈 캡처는 참고 화면의 근거로 쓸 수 없어요.");
  return {
    schema: "hps-reference-capture/1", url: args.url ?? null, title: args.title ?? null,
    capturedAt: args.capturedAt ?? new Date().toISOString(), mime: args.mime,
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    viewport: args.viewport ?? null, state: args.state ?? "current",
    readiness: args.readiness ?? null,
  };
}

export function referenceCaptureText(capture: ReferenceCapture): string {
  return `<reference-capture>\n${JSON.stringify(capture)}\n</reference-capture>`;
}

interface CaptureCdp { send(method: string, params: Record<string, unknown>): Promise<any> }
const PAGE_STATE = `JSON.stringify({url:location.href,title:document.title,timeOrigin:performance.timeOrigin,viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio},readiness:{document:document.readyState,fonts:document.fonts?.status??'unknown',pendingImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length}})`;

/** Bounded content readiness, then a same-document capture. No network-idle dependency. */
export async function captureReferenceScreenshot(cdp: CaptureCdp): Promise<{ data: string; metadata: ReferenceCapture }> {
  await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{await Promise.race([Promise.all([document.fonts?.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,3000))]);return true})()`,
    awaitPromise: true, returnByValue: true,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = async () => {
      const r = await cdp.send("Runtime.evaluate", { expression: PAGE_STATE, returnByValue: true });
      if (r?.exceptionDetails) throw new Error("화면 상태를 읽지 못했어요.");
      const page = JSON.parse(String(r?.result?.value ?? "{}"));
      if (typeof page.url !== "string" || !page.url || typeof page.timeOrigin !== "number"
        || !(page.viewport?.width > 0) || !(page.viewport?.height > 0)) throw new Error("화면의 URL·크기를 확인하지 못했어요.");
      return page;
    };
    const before = await read();
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    const capturedAt = new Date().toISOString();
    const after = await read();
    if (before.url !== after.url || before.timeOrigin !== after.timeOrigin
      || JSON.stringify(before.viewport) !== JSON.stringify(after.viewport)) continue;
    const data = String(shot?.data ?? "");
    return { data, metadata: referenceCaptureMetadata({ data, mime: "image/jpeg", url: before.url,
      title: before.title, viewport: before.viewport, readiness: before.readiness, capturedAt }) };
  }
  throw new Error("캡처 중 페이지가 바뀌어 참고 근거를 만들지 못했어요. 화면이 안정된 뒤 다시 시도해 주세요.");
}

export type BriefProvenance = "observed" | "user_requested" | "inferred" | "unknown";
export const DESIGN_BRIEF_FIELDS = ["goal", "subject", "layout", "depth", "style", "motion", "responsive", "functionality", "exclusions"] as const;
export interface DesignBriefField {
  value: string | null; provenance: BriefProvenance;
  evidence: Array<{ captureSha256: string; region: string }>;
}
export interface ReferenceDesignBrief {
  schema: "hps-reference-design/1";
  captures: ReferenceCapture[];
  fields: Record<typeof DESIGN_BRIEF_FIELDS[number], DesignBriefField>;
}

/** Artifact validator used by the fixture/report path; it does not award visual acceptance. */
export function referenceDesignBriefProblems(value: unknown): string[] {
  const b = value as Partial<ReferenceDesignBrief> | null;
  if (!b || b.schema !== "hps-reference-design/1") return ["schema"];
  const errors: string[] = [];
  const captures = Array.isArray(b.captures) ? b.captures : [];
  if (!Array.isArray(b.captures)) errors.push("captures");
  for (const c of captures) {
    if (!c || c.schema !== "hps-reference-capture/1" || !/^[a-f0-9]{64}$/.test(c.sha256)
      || !(c.bytes > 0) || !Number.isFinite(Date.parse(c.capturedAt))
      || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(c.mime)) errors.push("captures.metadata");
  }
  const hashes = new Set(captures.filter((c) => c && /^[a-f0-9]{64}$/.test(c.sha256)).map((c) => c.sha256));
  for (const name of DESIGN_BRIEF_FIELDS) {
    const field = b.fields?.[name];
    if (!field || !["observed", "user_requested", "inferred", "unknown"].includes(field.provenance)) { errors.push(`${name}.provenance`); continue; }
    if (field.provenance !== "unknown" && !(typeof field.value === "string" && field.value.trim())) errors.push(`${name}.value`);
    if (field.provenance === "unknown" && field.value !== null) errors.push(`${name}.unknown`);
    if (!Array.isArray(field.evidence)) { errors.push(`${name}.evidence`); continue; }
    if (field.provenance === "observed" && field.evidence.length === 0) errors.push(`${name}.evidence`);
    for (const e of field.evidence) if (!hashes.has(e.captureSha256) || !e.region?.trim()) errors.push(`${name}.evidence`);
  }
  return [...new Set(errors)];
}

export function referenceDesignBriefMarkdown(brief: ReferenceDesignBrief): string {
  const problems = referenceDesignBriefProblems(brief);
  if (problems.length) throw new Error(`Invalid reference brief: ${problems.join(", ")}`);
  return ["# 참고 디자인 브리프", "", ...DESIGN_BRIEF_FIELDS.map((name) => {
    const f = brief.fields[name];
    return `- **${name}** (${f.provenance}): ${f.value ?? "확인하지 못함"}${f.evidence.length ? ` — ${f.evidence.map((e) => `${e.captureSha256} (${e.region})`).join(", ")}` : ""}`;
  }), "", "이 브리프는 관찰·요구·추정을 구분한 작업 기준이다. 렌더링·동작·사람 인수는 별도 검증한다.", ""].join("\n");
}
