// Quest skills in the public store (Epic #3418 store slice 2, design v1 D4–D6). No `vscode` import.
//
// A finished email quest (#1604) is published as one store item: one step per quest node, keyed by the
// node id, with the quest graph in `depends_on`. The public layer is what a buyer sees (titles,
// descriptions, required connections and why); the private layer (the mail template, the prompts) is
// sealed by the Service and never comes back to any device. A buyer installs the item as a quest built
// from the public layer only, and adapts it through an overlay the Service keeps by step id.
import type { AutomationRecipe } from './automationProtocol';
import { validateQuestPlan, type AutomationQuestNode, type AutomationQuestSnapshot, type AutomationQuestStatus } from './automationQuest.ts';
import type { StoreLocalConnections, StoreOverlaySpec, StoreQuestDraft, StoreStepView } from './skillStoreProtocol';

const MAIL_PARAMS = { name: 'name', document: 'document', dueDate: 'due_date' } as const;
/** Which connections a quest node of the email quest needs, and why (F8: a fixed list, each with its reason). */
const NODE_CONNECTIONS: Record<string, { id: string; why: string }[]> = {
  connect: [{ id: 'google.gmail.send', why: '내 Google 계정으로 안내 메일을 보내요' }],
  sheet: [{ id: 'google.sheets.read', why: '내 명단 시트를 읽어요' }, { id: 'roster.read', why: '받는 사람은 내 명단에서만 골라요' }],
};

const stepId = (nodeId: string) => nodeId.replace(/_/g, '-');
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

/** The completion card's prefill: the skill's own name and description, and the steps a buyer will see. */
export function questDraft(recipe: AutomationRecipe, nodes: readonly AutomationQuestNode[]): StoreQuestDraft {
  return {
    title: clip(recipe.title.trim(), 60),
    summary: clip(recipe.description.trim(), 200),
    steps: nodes.map((n) => ({ title: n.label, description: n.description ?? '' })),
  };
}

/**
 * The store package of a finished email quest. Placeholders are renamed to store parameter names
 * (`{{dueDate}}` → `{{due_date}}`); the Service checks every text, seals the private layer and renders
 * the mail per roster row itself (D10).
 */
export function emailQuestPackage(recipe: AutomationRecipe, nodes: readonly AutomationQuestNode[], meta: { title: string; summary: string; price_krw: number }) {
  const plan = validateQuestPlan({ title: recipe.title, nodes: nodes.map(({ id, label, description, dependsOn }) => ({ id, label, ...(description ? { description } : {}), dependsOn: [...dependsOn] })) });
  if (!plan.nodes.some((n) => n.id === 'skill')) throw new Error('메일 스킬 단계가 없는 퀘스트는 스토어에 올릴 수 없어요.');
  const rename = (template: string) => template.replace(/\{\{(name|document|dueDate)\}\}/g, (_m, key: keyof typeof MAIL_PARAMS) => `{{${MAIL_PARAMS[key]}}}`);
  return {
    title: meta.title.trim(),
    summary: meta.summary.trim(),
    price_krw: meta.price_krw,
    tools: [] as string[],
    outputs: ['mail_draft'],
    steps: plan.nodes.map((n) => {
      const base = {
        step_id: stepId(n.id),
        title: clip(n.label, 60),
        description: clip(n.description ?? n.label, 300),
        connections: NODE_CONNECTIONS[n.id] ?? [],
        ...(n.dependsOn.length ? { depends_on: n.dependsOn.map(stepId) } : {}),
      };
      if (n.id === 'sheet') return { ...base, params: [{ name: 'email', label: clip(recipe.columns.email, 40) }], private: { prompt: n.description ?? n.label } };
      if (n.id !== 'skill') return { ...base, private: { prompt: n.description ?? n.label } };
      return {
        ...base,
        params: [
          { name: MAIL_PARAMS.name, label: clip(recipe.columns.name, 40) },
          { name: MAIL_PARAMS.document, label: clip(recipe.columns.document, 40) },
          { name: MAIL_PARAMS.dueDate, label: clip(recipe.columns.dueDate, 40) },
        ],
        private: { prompt: recipe.description, mail: { subject: rename(recipe.subjectTemplate), body: rename(recipe.bodyTemplate) } },
      };
    }),
  };
}

/** Whether this device already has a connection a step names (D6): only presence, never the account or sheet. */
export function connectedHere(connectionId: string, local: StoreLocalConnections | undefined): boolean {
  if (!local) return false;
  if (connectionId.startsWith('google.')) return local.google;
  if (connectionId === 'roster.read') return local.roster;
  return false;
}

/**
 * The buyer's quest for an installed skill (scene 3), from the public layer only. A step whose
 * connections this device already has starts completed and says so; the rest follow the quest rules.
 * Returns null when the public text cannot form a quest, so the caller shows the list instead.
 */
export function storeQuestSnapshot(title: string, steps: readonly StoreStepView[], local: StoreLocalConnections | undefined): AutomationQuestSnapshot | null {
  if (!steps.length || steps.length > 12) return null;
  const id = (s: string) => (/^[a-z]/.test(s) ? s : `s${s}`).slice(0, 32);
  const ready = (st: StoreStepView) => st.connections.length > 0 && st.connections.every((c) => connectedHere(c.id, local));
  let plan;
  try {
    plan = validateQuestPlan({
      title: clip(title, 80),
      nodes: steps.map((st, i) => ({
        id: id(st.step_id),
        label: clip(st.title, 48),
        description: clip(`${ready(st) ? '이미 연결됨 · ' : ''}${st.description}`, 160),
        dependsOn: (st.depends_on ?? (i ? [steps[i - 1]!.step_id] : [])).map(id),
      })),
    });
  } catch {
    return null;
  }
  const done = new Set(steps.filter(ready).map((st) => id(st.step_id)));
  const nodes = plan.nodes.map((n) => {
    const status: AutomationQuestStatus = done.has(n.id) ? 'succeeded' : n.dependsOn.every((d) => done.has(d)) ? 'current' : 'pending';
    return { ...n, status };
  });
  return { title: plan.title, revision: 1, nodes };
}

const TONES: [RegExp, NonNullable<StoreOverlaySpec['tone']>][] = [
  [/짧게|간단히|간결|줄로|요약/, '짧게'],
  [/친근|부드럽|편하게/, '친근하게'],
  [/격식|정중|공손/, '격식 있게'],
];

/**
 * A conversational adaptation (scene 4) as an overlay change, decided by plain rules and no model call:
 * the request becomes the "additional instruction" of the last enabled seller step, and a tone word in it
 * sets that step's tone. The input is the buyer's sentence and the public steps only, never a private
 * layer (F6). Returns the whole new overlay and what changed, in the buyer's words.
 */
export function adaptOverlay(text: string, steps: readonly StoreStepView[], overlay: Record<string, StoreOverlaySpec>): { overlay: Record<string, StoreOverlaySpec>; changes: string[] } {
  const request = text.trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!request) throw new Error('어떻게 바꿀지 한 문장으로 알려 주세요.');
  const target = [...steps].reverse().find((st) => overlay[st.step_id]?.enabled !== false);
  if (!target) throw new Error('켜져 있는 단계가 없어요. 단계를 하나 이상 켠 뒤 다시 알려 주세요.');
  const tone = TONES.find(([re]) => re.test(request))?.[1];
  const next = { ...overlay, [target.step_id]: { ...overlay[target.step_id], extra: request, ...(tone ? { tone } : {}) } };
  return { overlay: next, changes: [`「${target.title}」 단계에 추가 요청: ${request}`, ...(tone ? [`「${target.title}」 단계 말투: ${tone}`] : [])] };
}
