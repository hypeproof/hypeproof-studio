import { createQuest, transitionQuest, renderQuestHtml, type AutomationQuestSnapshot, validateQuestPlan } from './automationQuest';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';

const steps = ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'] as const;
type Step = typeof steps[number];

/** Older coaches can describe personal-script stages. Shared execution has no
 * learner upload or deployment, so remove those stages instead of inventing
 * evidence for them. Validate before normalizing to reject unsafe plan content. */
function sharedRunnerPlan(input: unknown) {
  const plan = validateQuestPlan(input);
  const legacy = new Set(['upload', 'deploy']);
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  const prerequisites = (id: string): string[] => legacy.has(id)
    ? byId.get(id)!.dependsOn.flatMap(prerequisites) : [id];
  const nodes = plan.nodes.filter(node => !legacy.has(node.id)).map(node => ({
    ...node,
    ...(node.id === 'prepare' ? { label: 'Google 실행 준비', description: '내 계정으로 공통 실행기를 사용할 준비를 확인해요.' } : {}),
    dependsOn: [...new Set(node.dependsOn.flatMap(prerequisites))],
  }));
  for (const node of nodes) {
    if (node.id === 'prepare' && byId.has('connect')) node.dependsOn = [...new Set([...node.dependsOn, 'connect'])];
    if (node.id === 'preview') node.dependsOn = ['prepare', 'sheet'].filter(id => byId.has(id));
    // Sharing a recipe never requires sending an email.
    if (node.id === 'publish' && byId.has('preview')) node.dependsOn = ['preview'];
  }
  return { title: plan.title, nodes };
}
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
  const invalidate = (ids: readonly Step[]) => {
    generation++;
    dependentSteps(ids).forEach(id => completed.delete(id as Step));
    if (state) {
      state = createQuest({ title: state.title, nodes: state.nodes.map(({ id, label, description, dependsOn }) => ({ id, label, ...(description ? { description } : {}), dependsOn })) });
      reconcile();
    }
    notify();
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
    invalidate,
    async invalidateAfter<T>(work: () => Promise<T>, succeeded: (value: T) => boolean, ids: readonly Step[]): Promise<T> {
      const epoch = generation;
      const value = await work();
      if (epoch === generation && succeeded(value)) { invalidate(ids); await draw(); }
      return value;
    },
    /** A declined/failed replacement leaves the existing saved skill intact.
     * Only its successful receipt can revoke old execution evidence. */
    async replace<T>(step: Step, work: () => Promise<T>, succeeded: (value: T) => boolean, invalidates: readonly Step[], establishes: readonly Step[] = []): Promise<T> {
      const epoch = generation;
      const value = await work();
      if (epoch !== generation || !succeeded(value)) return value;
      invalidate(invalidates);
      completed.add(step); establishes.forEach(id => completed.add(id)); reconcile();
      await draw();
      return value;
    },
    async track<T>(step: Step, work: () => Promise<T>, succeeded: (value: T) => boolean = () => true, establishes: readonly Step[] | ((value: T) => readonly Step[]) = []): Promise<T> {
      const epoch = generation;
      const node = state?.nodes.find(n => n.id === step);
      if (state && node && node.status !== 'succeeded' && node.dependsOn.every(id => state!.nodes.find(n => n.id === id)?.status === 'succeeded')) {
        state = transitionQuest(state, step, 'running'); await draw();
      }
      try {
        const value = await work();
        if (epoch !== generation) return value;
        if (succeeded(value)) { completed.add(step); (typeof establishes === 'function' ? establishes(value) : establishes).forEach(id => completed.add(id)); reconcile(); }
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
    workflowPlan: plan => quest.plan(host.isSharedRunner?.() ? sharedRunnerPlan(plan) : plan),
    askUser: host.askUser ? async args => {
      // Follow-up design questions reopen the recipe and execution evidence,
      // not independently verified Google/Sheet connections. Cancelling a
      // clarification must not erase those receipts either.
      const establishedGoal = quest.snapshot()?.nodes.some(node => node.id === 'goal' && node.status === 'succeeded');
      quest.invalidate(['skill', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish']);
      if (!establishedGoal) return quest.track('goal', () => host.askUser!(args), ok);
      await quest.redraw();
      return host.askUser!(args);
    } : undefined,
    // A validated recipe is host evidence for a concrete goal. Apply related
    // evidence inside track's generation guard so a late result cannot mark a new plan.
    saveSkill: host.saveSkill ? recipe => { quest.invalidate(['skill','prepare','upload','deploy','preview','send','publish']); return quest.track('skill', () => host.saveSkill!(recipe), flag('saved'), ['goal']); } : undefined,
    installSkill: host.installSkill ? id => quest.replace('skill', () => host.installSkill!(id), flag('installed'), ['skill','prepare','upload','deploy','preview','send','publish'], ['goal']) : undefined,
    connectGoogle: host.connectGoogle ? mode => {
      const callerBound: readonly Step[] = ['connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'];
      if (mode === 'change') quest.invalidate(callerBound);
      return quest.track('connect', () => quest.replace('connect', () => host.connectGoogle!(mode),
        value => flag('connected')(value) && (value as { reused?: unknown }).reused !== true, callerBound), flag('connected'));
    } : undefined,
    // Reading a private sheet succeeds only after the host verifies the current
    // Google connection. Reuse can therefore restore connection evidence too.
    configureSheet: host.configureSheet ? mode => { quest.invalidate(['sheet','preview','send']); return quest.track('sheet', () => host.configureSheet!(mode), value => ok(value) && typeof (value as { rowCount?: unknown }).rowCount === 'number', ['connect']); } : undefined,
    publishSkill: host.publishSkill ? () => quest.track('publish', () => host.publishSkill!(), flag('published')) : undefined,
    unpublishSkill: host.unpublishSkill ? id => quest.invalidateAfter(() => host.unpublishSkill!(id), flag('unpublished'), ['publish']) : undefined,
    // Preparation validates the persisted recipe, including reuse without skill_save.
    appsScriptPrepare: host.appsScriptPrepare ? () => quest.track('prepare', () => host.appsScriptPrepare!(), flag('prepared'), ['goal', 'skill']) : undefined,
    appsScriptUpload: host.appsScriptUpload ? () => quest.track('upload', () => host.appsScriptUpload!(), flag('uploaded')) : undefined,
    appsScriptDeploy: host.appsScriptDeploy ? () => quest.track('deploy', () => host.appsScriptDeploy!(), flag('deployed')) : undefined,
    // A shared preview proves caller-bound execution, never a learner upload or
    // deployment. Retain those receipts only for the legacy personal runtime.
    appsScriptRun: host.appsScriptRun ? mode => quest.track(mode, () => host.appsScriptRun!(mode), flag(mode === 'preview' ? 'previewed' : 'sent'),
      value => mode === 'preview'
        ? (host.isSharedRunner?.() || (value as { sharedRunner?: boolean })?.sharedRunner
          ? ['goal', 'skill', 'connect', 'sheet', 'prepare']
          : ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy'])
        : []) : undefined,
  };
}
