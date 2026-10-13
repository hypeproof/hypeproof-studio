import { createQuest, transitionQuest, renderQuestHtml, type AutomationQuestSnapshot } from './automationQuest';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';

const steps = ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'] as const;
type Step = typeof steps[number];
/** Display progress comes only from host tool results, never from the proposed plan. */
export function createAutomationQuestSession(show: (html: string) => Promise<void>, observed?: () => void) {
  let state: AutomationQuestSnapshot | undefined;
  let generation = 0;
  const completed = new Set<Step>();
  const notify = () => { try { observed?.(); } catch { /* Observation must never interrupt learner work. */ } };
  const draw = async () => { notify(); if (state) await show(renderQuestHtml(state)); };
  const dependentSteps = (ids: readonly string[]) => {
    const invalid = new Set(ids);
    // A changed prerequisite invalidates the evidence for every descendant.
    for (let pass = 0; state && pass < state.nodes.length; pass++)
      for (const node of state.nodes) if (node.dependsOn.some(id => invalid.has(id))) invalid.add(node.id);
    return invalid;
  };
  const reconcile = () => {
    if (!state) return;
    for (let pass = 0; pass < steps.length; pass++) {
      for (const node of state.nodes) {
        if (node.status === 'succeeded' || !completed.has(node.id as Step) || !node.dependsOn.every(id => state!.nodes.find(n => n.id === id)?.status === 'succeeded')) continue;
        state = transitionQuest(state, node.id, 'running');
        state = transitionQuest(state, node.id, 'succeeded');
      }
    }
  };
  const recordUnsuccessful = (step: Step, status: 'blocked' | 'failed') => {
    if (!state?.nodes.some(node => node.id === step)) return;
    // A tool can inspect a reused deployment before this session has observed its
    // prerequisites. Its actual missing-setup/error outcome still belongs to that
    // node. Revoke only it and its dependants, preserving confirmed prerequisites.
    const affected = dependentSteps([step]);
    affected.forEach(id => completed.delete(id as Step));
    state = { ...state, nodes: state.nodes.map(node => affected.has(node.id) ? { ...node, status: 'pending' as const } : node) };
    state = transitionQuest(state, step, status);
  };
  return {
    clear() { generation++; state = undefined; completed.clear(); notify(); },
    async plan(input: unknown) {
      const next = createQuest(input);
      if (next.nodes.some(node => !(steps as readonly string[]).includes(node.id))) throw new Error('Unknown workflow step');
      const changed = next.nodes.filter(node => {
        const previous = state?.nodes.find(n => n.id === node.id);
        return previous && JSON.stringify([...previous.dependsOn].sort()) !== JSON.stringify([...node.dependsOn].sort());
      }).map(node => node.id);
      const sameStructure = state && !changed.length && state.nodes.length === next.nodes.length && next.nodes.every(node => state!.nodes.some(n => n.id === node.id));
      if (sameStructure) {
        // Copy edits and repeat plans must not erase progress or orphan an in-flight result.
        state = { ...next, nodes: next.nodes.map(node => ({ ...node, status: state!.nodes.find(n => n.id === node.id)!.status })) };
      } else {
        generation++;
        state = next;
        const invalid = dependentSteps(changed);
        for (const step of completed) if (invalid.has(step) || !next.nodes.some(node => node.id === step)) completed.delete(step);
        reconcile();
      }
      await draw();
      return { displayed: true, steps: next.nodes.map(node => node.id), completion: 'host-evidence-only' };
    },
    invalidate(ids: Step[]) {
      generation++;
      dependentSteps(ids).forEach(id => completed.delete(id as Step));
      if (state) {
        state = createQuest({ title: state.title, nodes: state.nodes.map(({ id, label, description, dependsOn }) => ({ id, label, ...(description ? { description } : {}), dependsOn })) });
        reconcile();
      }
      notify();
    },
    async track<T>(step: Step, work: () => Promise<T>, succeeded: (value: T) => boolean = () => true, establishes: readonly Step[] = []): Promise<T> {
      const epoch = generation;
      const node = state?.nodes.find(n => n.id === step);
      if (state && node && node.status !== 'succeeded' && node.dependsOn.every(id => state!.nodes.find(n => n.id === id)?.status === 'succeeded')) {
        state = transitionQuest(state, step, 'running'); await draw();
      }
      try {
        const value = await work();
        if (epoch !== generation) return value;
        if (succeeded(value)) { completed.add(step); establishes.forEach(id => completed.add(id)); reconcile(); }
        else recordUnsuccessful(step, 'blocked');
        await draw(); return value;
      } catch (error) {
        if (epoch === generation) { recordUnsuccessful(step, 'failed'); await draw(); }
        throw error;
      }
    },
    snapshot: () => state,
    redraw: draw,
  };
}

/** Tracks only observable outcomes; cancelled and prerequisite-only results are not success. */
export function withAutomationQuest(host: GoogleAutomationMcpHost, quest: ReturnType<typeof createAutomationQuestSession>): GoogleAutomationMcpHost {
  const ok = (value: unknown) => !!value && typeof value === 'object' && !(value as { cancelled?: boolean }).cancelled;
  const flag = (key: string) => (value: unknown) => ok(value) && (value as Record<string, unknown>)[key] === true;
  return { ...host,
    workflowPlan: plan => quest.plan(plan),
    askUser: host.askUser ? args => quest.track('goal', () => host.askUser!(args), ok) : undefined,
    // A validated recipe is host evidence for a concrete goal. Apply related
    // evidence inside track's generation guard so a late result cannot mark a new plan.
    saveSkill: host.saveSkill ? recipe => { quest.invalidate(['skill','prepare','upload','deploy','preview','send','publish']); return quest.track('skill', () => host.saveSkill!(recipe), flag('saved'), ['goal']); } : undefined,
    connectGoogle: host.connectGoogle ? mode => quest.track('connect', () => host.connectGoogle!(mode), flag('connected')) : undefined,
    configureSheet: host.configureSheet ? mode => { quest.invalidate(['sheet','preview','send']); return quest.track('sheet', () => host.configureSheet!(mode), value => ok(value) && typeof (value as { rowCount?: unknown }).rowCount === 'number'); } : undefined,
    publishSkill: host.publishSkill ? () => quest.track('publish', () => host.publishSkill!(), flag('published')) : undefined,
    // Preparation validates the persisted recipe, including reuse without skill_save.
    appsScriptPrepare: host.appsScriptPrepare ? () => quest.track('prepare', () => host.appsScriptPrepare!(), flag('prepared'), ['goal', 'skill']) : undefined,
    appsScriptUpload: host.appsScriptUpload ? () => quest.track('upload', () => host.appsScriptUpload!(), flag('uploaded')) : undefined,
    appsScriptDeploy: host.appsScriptDeploy ? () => quest.track('deploy', () => host.appsScriptDeploy!(), flag('deployed')) : undefined,
    // A successful preview verifies the recipe, account, sheet, immutable code digest
    // and deployment on Google. Existing receipts can satisfy these stages after
    // restart without creating/uploading/deploying a duplicate project.
    appsScriptRun: host.appsScriptRun ? mode => quest.track(mode, () => host.appsScriptRun!(mode), flag(mode === 'preview' ? 'previewed' : 'sent'),
      mode === 'preview' ? ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy'] : []) : undefined,
  };
}
