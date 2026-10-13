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
    pending: ["current", "running", "blocked"], current: ["running", "blocked"],
    running: ["succeeded", "failed", "blocked"], failed: ["current", "running", "blocked"],
    blocked: ["current", "running"], succeeded: [],
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
  const edges = nodes.flatMap((node, index) => node.dependsOn.map((id, edge) => {
    const source = nodes.findIndex((entry) => entry.id === id);
    const y1 = source * 152 + 34, y2 = index * 152 + 34, x = 8 + (edge % 3) * 8;
    return `<path class="edge ${nodes[source].status === "succeeded" ? "done" : ""}" d="M 48 ${y1} H ${x + 8} Q ${x} ${y1} ${x} ${y1 + 8} V ${y2 - 8} Q ${x} ${y2} ${x + 8} ${y2} H 34" marker-end="url(#arrow)"/>`;
  })).join("");
  const circles = nodes.map((node, index) => `<g class="${node.status}"><circle cx="48" cy="${index * 152 + 34}" r="14"/><text x="48" y="${index * 152 + 39}" text-anchor="middle">${node.status === "succeeded" ? "✓" : index + 1}</text></g>`).join("");
  const cards = nodes.map((node, index) => `<li class="node ${node.status}" data-node-id="${node.id}"${node.id === active?.id ? ' aria-current="step"' : ""}><div class="node-top"><span class="step">${String(index + 1).padStart(2, "0")}</span><span class="badge">${labels[node.status]}</span></div><h2>${escape(node.label)}</h2><p>${escape(node.description ?? (node.status === "succeeded" ? "확인된 결과를 바탕으로 다음 단계로 이어갑니다." : "왼쪽 대화에서 이 단계를 함께 진행합니다."))}</p><span class="dependency">${node.dependsOn.length ? `이전 단계: ${node.dependsOn.map((id) => escape(nodes.find((entry) => entry.id === id)!.label)).join(" · ")}` : "시작 단계"}</span></li>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; form-action 'none'"><title>${escape(snapshot.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#111822;color:#e7edf6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5}main{max-width:820px;margin:auto;padding:28px 24px 32px}.eyebrow{font-size:12px;color:#8bbbf9;letter-spacing:.08em}h1{font-size:23px;line-height:1.35;overflow-wrap:anywhere;margin:8px 0 16px}.progress-label{display:flex;justify-content:space-between;font-size:13px;color:#b8c7d9}.track{height:6px;background:#263448;border-radius:8px;margin:8px 0 18px;overflow:hidden}.fill{height:100%;background:#72c6a6}.focus{border:1px solid #39506c;background:#1a283a;padding:14px 16px;border-radius:12px;margin-bottom:22px}.focus strong{font-size:14px}.focus p{font-size:13px;color:#b8c7d9;margin:5px 0 0}.graph{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:start}.connections{width:72px;overflow:visible}.edge{fill:none;stroke:#43546b;stroke-width:2}.edge.done{stroke:#72c6a6}circle{fill:#233247;stroke:#485c77;stroke-width:1.5}svg text{fill:#d9e5f4;font-size:12px;font-weight:700}.succeeded circle{fill:#23463e;stroke:#72c6a6}.current circle,.running circle{fill:#244c7c;stroke:#8bbbf9}ol{list-style:none;margin:0;padding:0;min-width:0}.node{height:140px;margin-bottom:12px;padding:12px 14px;border:1px solid #304056;border-radius:12px;background:#192330;overflow:hidden}.node.current,.node.running{border-color:#679fdf;background:#1a2b40}.node.succeeded{border-color:#365c50}.node.failed,.node.blocked{border-color:#aa8150}.node-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.step{font-size:11px;color:#8c9db3}.badge{font-size:11px;color:#c1cfe0}.succeeded .badge{color:#8edab9}.current .badge,.running .badge{color:#a7d0ff}.failed .badge,.blocked .badge{color:#f3c489}h2{font-size:15px;line-height:1.3;margin:5px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.node p{font-size:12px;line-height:1.45;color:#b4c2d3;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.dependency{display:block;margin-top:6px;font-size:10px;color:#8799b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}footer{font-size:12px;color:#8d9eb5;margin:12px 0 0} @media(max-width:420px){main{padding:18px 10px}h1{font-size:20px}.graph{grid-template-columns:72px minmax(0,1fr)}.node{padding:10px}h2{font-size:14px}}
</style></head><body><main><div class="eyebrow">MY AUTOMATION · 나의 업무 흐름</div><h1>${escape(snapshot.title)}</h1><div class="progress-label"><span>단계별 진행</span><span>${complete} / ${nodes.length} 완료</span></div><div class="track" role="progressbar" aria-label="자동화 준비 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="fill" style="width:${percent}%"></div></div><section class="focus" aria-live="polite"><strong>${active ? `${labels[active.status]} · ${escape(active.label)}` : "모든 단계를 확인했어요"}</strong><p>${active ? "왼쪽 대화에서 질문에 답하고, 실행할 내용을 확인해 주세요." : "확인된 실행 결과를 대화에서 살펴보세요."}</p></section><div class="graph"><svg class="connections" height="${nodes.length * 152}" viewBox="0 0 72 ${nodes.length * 152}" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6f869f"/></marker></defs>${edges}${circles}</svg><ol aria-label="자동화 알고리즘 단계">${cards}</ol></div><footer>완료 표시는 Studio에서 확인된 결과에 따라 갱신됩니다.</footer></main></body></html>`;
}
