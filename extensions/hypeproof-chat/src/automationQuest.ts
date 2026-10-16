/** A descriptive AI plan is separate from host-observed execution progress. */
export type AutomationQuestStatus = "pending" | "current" | "running" | "succeeded" | "failed" | "blocked";
export interface AutomationQuestNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly dependsOn: readonly string[];
}
export interface AutomationQuestPlan {
  readonly title: string;
  readonly nodes: readonly AutomationQuestNode[];
}
export interface AutomationQuestSnapshot {
  readonly title: string;
  readonly revision: number;
  readonly nodes: readonly (AutomationQuestNode & { readonly status: AutomationQuestStatus })[];
}

const states: readonly AutomationQuestStatus[] = ["pending", "current", "running", "succeeded", "failed", "blocked"];
const labels: Record<AutomationQuestStatus, string> = {
  pending: "대기", current: "지금 할 단계", running: "실행 중", succeeded: "완료", failed: "확인 필요", blocked: "설정 필요",
};
const invalid = (): never => { throw new Error("자동화 흐름을 확인해 주세요. 개인정보·코드 없이 연결된 단계를 입력해 주세요."); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  // Graphs contain generic workflow descriptions, never source code, account
  // identifiers, document links or credentials. Do not echo rejected input.
  if (/[<>`{}\u0000-\u001f\u007f]|(?:https?:|www\.|mailto:)|[\w.+-]+@[\w.-]+|\d{7,}|[A-Za-z0-9_-]{40,}/i.test(value)) return invalid();
  return value.trim();
}

/** Validate and topologically order a connected DAG of at most twelve steps. */
export function validateQuestPlan(input: unknown): AutomationQuestPlan {
  const plan = object(input, ["title", "nodes"]);
  const title = text(plan.title, 80);
  if (!Array.isArray(plan.nodes) || plan.nodes.length < 1 || plan.nodes.length > 12) return invalid();
  const nodes = plan.nodes.map((value): AutomationQuestNode => {
    const node = object(value, ["id", "label", "description", "dependsOn"]);
    if (typeof node.id !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(node.id)) return invalid();
    if (!Array.isArray(node.dependsOn) || node.dependsOn.length > 11 || node.dependsOn.some((id) => typeof id !== "string")) return invalid();
    if (new Set(node.dependsOn).size !== node.dependsOn.length) return invalid();
    return { id: node.id, label: text(node.label, 48), ...(node.description === undefined ? {} : { description: text(node.description, 160) }), dependsOn: [...node.dependsOn] };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length || nodes.some((node) => node.dependsOn.some((id) => !byId.has(id) || id === node.id))) return invalid();
  const ordered: AutomationQuestNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(node: AutomationQuestNode): void {
    if (visiting.has(node.id)) return invalid();
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    node.dependsOn.forEach((id) => visit(byId.get(id)!));
    visiting.delete(node.id);
    visited.add(node.id);
    ordered.push(node);
  }
  nodes.forEach(visit);
  const connected = new Set([nodes[0].id]);
  for (let i = 0; i < nodes.length; i++) {
    for (const node of nodes) {
      for (const dependency of node.dependsOn) {
        if (connected.has(node.id) || connected.has(dependency)) {
          connected.add(node.id); connected.add(dependency);
        }
      }
    }
  }
  if (connected.size !== nodes.length) return invalid();
  return { title, nodes: ordered };
}

export function createQuest(input: unknown): AutomationQuestSnapshot {
  const plan = validateQuestPlan(input);
  return { title: plan.title, revision: 1, nodes: plan.nodes.map((node) => ({ ...node, status: node.dependsOn.length ? "pending" : "current" })) };
}

/** Only call from the host after a question/operation outcome, never AI input. */
export function transitionQuest(snapshot: AutomationQuestSnapshot, nodeId: string, status: AutomationQuestStatus): AutomationQuestSnapshot {
  const node = snapshot.nodes.find((entry) => entry.id === nodeId);
  if (!node || !states.includes(status)) return invalid();
  if (node.status === status) return snapshot;
  const allowed: Record<AutomationQuestStatus, readonly AutomationQuestStatus[]> = {
    pending: ["current", "running", "blocked", "failed"], current: ["running", "blocked", "failed"],
    running: ["succeeded", "failed", "blocked"], failed: ["current", "running", "blocked"],
    blocked: ["current", "running", "failed"], succeeded: [],
  };
  if (!allowed[node.status].includes(status)) return invalid();
  if (["current", "running", "succeeded"].includes(status) && node.dependsOn.some((id) => snapshot.nodes.find((entry) => entry.id === id)?.status !== "succeeded")) return invalid();
  const nodes = snapshot.nodes.map((entry) => ({ ...entry, dependsOn: [...entry.dependsOn], status: entry.id === nodeId ? status : entry.status }));
  // Successful prerequisites make their dependants ready, never completed.
  for (const entry of nodes) {
    if (entry.status === "pending" && entry.dependsOn.every((id) => nodes.find((candidate) => candidate.id === id)?.status === "succeeded")) entry.status = "current";
  }
  return { title: snapshot.title, revision: snapshot.revision + 1, nodes };
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Static HTML for PreviewProvider.show(): no scripts, network or actions. */
export function renderQuestHtml(snapshot: AutomationQuestSnapshot): string {
  const plan = validateQuestPlan({ title: snapshot.title, nodes: snapshot.nodes.map(({ status: _status, ...node }) => node) });
  if (snapshot.nodes.some((node) => !states.includes(node.status))) return invalid();
  const nodes = plan.nodes.map((node) => ({ ...node, status: snapshot.nodes.find((entry) => entry.id === node.id)!.status }));
  const complete = nodes.filter((node) => node.status === "succeeded").length;
  const active = nodes.find((node) => node.status === "running") ?? nodes.find((node) => node.status === "failed" || node.status === "blocked") ?? nodes.find((node) => node.status === "current");
  const percent = Math.round(complete / nodes.length * 100);
  const finished = complete === nodes.length;
  const phase = finished ? "전체 단계 확인 완료" : complete === 0 && !nodes.some(node => ["running", "failed", "blocked"].includes(node.status)) ? "설계한 흐름 · 실행 전" : "실제 진행 상황";
  const focusCopy: Record<AutomationQuestStatus, string> = {
    pending: "앞 단계의 결과를 확인한 뒤 이어갑니다.",
    current: "대화에서 질문에 답하고 다음 단계를 진행해 주세요.",
    running: "처리 결과가 확인되면 이 흐름에 반영됩니다.",
    succeeded: "Studio에서 이 단계의 결과를 확인했습니다.",
    failed: "대화에서 원인을 확인하고 이 단계부터 다시 진행해 주세요.",
    blocked: "대화에 표시된 연결 또는 설정을 마치면 이어갈 수 있습니다.",
  };
  // Each edge spans the actual CSS grid rows, so wrapping or text zoom cannot
  // disconnect a path from its node. Allocate separate lanes for overlapping paths.
  const lanes: number[] = [];
  const connections = nodes.flatMap((node, target) => node.dependsOn.map((id) => {
    const source = nodes.findIndex((entry) => entry.id === id);
    let lane = lanes.findIndex(end => end < source);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = target;
    return { source, target, lane };
  }));
  const edges = connections.map(({ source, target, lane }) => `<span class="edge ${nodes[source].status === "succeeded" ? "done" : ""}" data-from="${nodes[source].id}" data-to="${nodes[target].id}" style="grid-row:${source + 1}/${target + 1};--lane:${(lane + 1) / (lanes.length + 1)}" aria-hidden="true"></span>`).join("");
  const cards = nodes.map((node, index) => {
    const dependencies = node.dependsOn.map(id => nodes.find(entry => entry.id === id)!);
    const ready = dependencies.filter(entry => entry.status === "succeeded").length;
    return `<li class="node ${node.status}" data-node-id="${node.id}" style="grid-row:${index + 1}"${node.id === active?.id ? ' aria-current="step"' : ""}>
<span class="node-marker" aria-hidden="true">${node.status === "succeeded" ? "✓" : String(index + 1).padStart(2, "0")}</span>
<div class="node-top"><h2>${escape(node.label)}</h2><span class="badge">${labels[node.status]}</span></div>
<p>${escape(node.description ?? focusCopy[node.status])}</p>
${dependencies.length ? `<div class="dependency"><span class="dependency-label">${dependencies.length > 1 ? `앞선 ${dependencies.length}단계 모두 필요 · ${ready}/${dependencies.length} 확인` : "앞선 단계"}</span><span class="dependency-items">${dependencies.map(entry => `<span class="dependency-item${entry.status === "succeeded" ? " confirmed" : ""}"><span aria-hidden="true">${entry.status === "succeeded" ? "✓" : "↳"}</span> ${escape(entry.label)}</span>`).join("")}</span></div>` : '<div class="dependency"><span class="dependency-label">여기서 시작합니다</span></div>'}
</li>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; form-action 'none'"><title>${escape(snapshot.title)}</title><style>
:root{color-scheme:dark;--bg:#151d19;--panel:#1c2820;--line:#3e5142;--text:#f2f4e8;--muted:#acb9a5;--accent:#d5f279;--rail:64px;--gap:18px;--anchor:32px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.55}main{max-width:920px;margin:auto;padding:32px clamp(12px,4vw,40px) 36px}.eyebrow{font-size:11px;color:var(--accent);letter-spacing:.12em;font-weight:700}h1{font-size:clamp(21px,3vw,28px);line-height:1.4;overflow-wrap:anywhere;margin:8px 0}.intro{color:var(--muted);font-size:13px;margin:0 0 24px}.progress-label{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}.progress-count{color:var(--text);font-variant-numeric:tabular-nums}.track{height:4px;background:#334132;border-radius:4px;margin:10px 0 20px;overflow:hidden}.fill{height:100%;background:var(--accent)}.focus{border:1px solid #52643c;border-left:3px solid var(--accent);background:#253222;padding:14px 16px;border-radius:4px 12px 12px 4px;margin-bottom:26px;overflow-wrap:anywhere}.focus-title{font-size:11px;font-weight:600;color:var(--accent);margin-bottom:4px}.focus strong{font-size:15px;font-weight:600}.focus p{font-size:12px;color:#c0cbb6;margin:5px 0 0}.focus.failed,.focus.blocked{border-color:#a5814d;background:#302b20}.focus.failed .focus-title,.focus.blocked .focus-title{color:#e6bc7c}.graph{display:grid;grid-template-columns:var(--rail) minmax(0,1fr);row-gap:var(--gap);position:relative;isolation:isolate}ol{display:contents;list-style:none;margin:0;padding:0}.edge{grid-column:1;position:relative;align-self:stretch;margin-left:calc(8px + (var(--rail) - 28px)*var(--lane));margin-right:0;border:1px solid var(--line);border-right:0;border-radius:6px 0 0 6px;height:calc(100% + var(--gap));transform:translateY(var(--anchor));pointer-events:none;z-index:-1}.edge::after{content:"";position:absolute;right:0;bottom:-3px;width:5px;height:5px;border-right:1px solid var(--line);border-top:1px solid var(--line);transform:rotate(45deg)}.edge.done{border-color:#829953}.edge.done::after{border-color:#829953}.node{grid-column:2;position:relative;min-width:0;padding:16px 18px;border:1px solid #35483a;border-radius:12px;background:var(--panel)}.node-marker{position:absolute;left:-15px;top:17px;width:29px;height:29px;border:1px solid #526349;border-radius:50%;background:#263228;display:grid;place-items:center;font-size:10px;font-weight:700;color:#c1ccb5;font-variant-numeric:tabular-nums}.node.current,.node.running{border-color:#8ca35a;background:#263322}.node.current .node-marker,.node.running .node-marker{background:var(--accent);border-color:var(--accent);color:#24321a}.node.succeeded .node-marker{background:#35472c;color:var(--accent);border-color:#829953;font-size:14px}.node.failed,.node.blocked{border-color:#8c7048}.node.failed .node-marker,.node.blocked .node-marker{border-color:#a5814d;color:#e6bc7c}.node-top{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:7px 12px}h2{flex:1 1 140px;min-width:0;font-size:15px;font-weight:600;line-height:1.5;overflow-wrap:anywhere;margin:0}.badge{flex:none;font-size:10px;border:1px solid #42513b;color:#b8c5ad;border-radius:5px;padding:2px 7px;white-space:nowrap}.succeeded .badge{color:#d5e7b1;border-color:#52643c}.current .badge,.running .badge{color:#e0f7a1;border-color:#7e924f}.failed .badge,.blocked .badge{color:#e6bc7c;border-color:#806642}.node p{font-size:13px;line-height:1.6;color:var(--muted);margin:8px 0 0;overflow-wrap:anywhere}.dependency{margin-top:14px;border-top:1px solid #34422e;padding-top:9px;font-size:11px;color:#a5b298}.dependency-label{display:block}.dependency-items{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px}.dependency-item{overflow-wrap:anywhere;min-width:0}.dependency-item.confirmed{color:#c6d7a6}footer{font-size:11px;color:var(--muted);border-top:1px solid #35432f;padding-top:16px;margin-top:24px}
@media(max-width:440px){:root{--rail:30px;--gap:16px}main{padding:20px 12px 28px}.intro{margin-bottom:18px}.focus{padding:12px}.node{padding:14px 12px 14px 20px}.node-top{gap:6px}h2{flex-basis:100%;font-size:14px}.node p{font-size:12px}.edge{margin-left:calc(2px + 13px*var(--lane))}.node-marker{width:25px;height:25px;left:-13px;top:19px;font-size:9px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media(forced-colors:active){.node,.focus,.node-marker,.badge,.edge{border-color:CanvasText}.edge::after{border-color:CanvasText}.node[aria-current="step"]{outline:2px solid Highlight}.fill{background:Highlight}}
</style></head><body><main><header><div class="eyebrow">AUTOMATION WORKFLOW</div><h1>${escape(snapshot.title)}</h1><p class="intro">대화로 설계하고, 확인된 단계부터 완성합니다.</p></header><div class="progress-label"><span>${phase}</span><span class="progress-count">${complete} / ${nodes.length} 완료</span></div><div class="track" role="progressbar" aria-label="확인된 자동화 단계" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="fill" style="width:${percent}%"></div></div><section class="focus ${active?.status ?? ""}" aria-live="polite"><div class="focus-title">${active ? labels[active.status] : finished ? "흐름 완료" : "다음 단계 대기"}</div><strong>${active ? escape(active.label) : finished ? "모든 단계의 결과를 확인했습니다" : "앞선 결과를 확인하고 있습니다"}</strong><p>${active ? focusCopy[active.status] : finished ? "실행 결과와 다음 작업을 대화에서 확인해 주세요." : "아직 완료되지 않은 단계가 있습니다. 대화에서 진행 상황을 확인해 주세요."}</p></section><div class="graph">${edges}<ol aria-label="자동화 알고리즘 단계">${cards}</ol></div><footer>연결선은 단계의 순서를 나타냅니다. 완료 표시는 Studio에서 확인된 결과에만 적용됩니다.</footer></main></body></html>`;
}
