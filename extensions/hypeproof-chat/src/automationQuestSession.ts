import { createQuest, transitionQuest, renderQuestHtml, type AutomationQuestSnapshot } from './automationQuest';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';

const steps = ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'] as const;
type Step = typeof steps[number];
/** Display progress comes only from host tool results, never from the proposed plan. */
export function createAutomationQuestSession(show: (html: string) => Promise<void>) {
  let state: AutomationQuestSnapshot | undefined;
  let generation = 0;
  const completed = new Set<Step>();
  const draw = async () => { if (state) await show(renderQuestHtml(state)); };
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
  return {
    clear() { generation++; state = undefined; completed.clear(); },
    async plan(input: unknown) {
      const next = createQuest(input);
      if (next.nodes.some(node => !(steps as readonly string[]).includes(node.id))) throw new Error('Unknown workflow step');
      generation++; completed.clear(); state = next; await draw();
      return { displayed: true, steps: next.nodes.map(node => node.id), completion: 'host-evidence-only' };
    },
    invalidate(ids: Step[]) {
      generation++;
      ids.forEach(id => completed.delete(id));
      if (state) {
        state = createQuest({ title: state.title, nodes: state.nodes.map(({ id, label, description, dependsOn }) => ({ id, label, ...(description ? { description } : {}), dependsOn })) });
        reconcile();
      }
    },
    async track<T>(step: Step, work: () => Promise<T>, succeeded: (value: T) => boolean = () => true): Promise<T> {
      const epoch = generation;
      const node = state?.nodes.find(n => n.id === step);
      if (state && node && node.status !== 'succeeded' && node.dependsOn.every(id => state!.nodes.find(n => n.id === id)?.status === 'succeeded')) {
        state = transitionQuest(state, step, 'running'); await draw();
      }
      try {
        const value = await work();
        if (epoch !== generation) return value;
        if (succeeded(value)) { completed.add(step); reconcile(); }
        else if (state?.nodes.some(n => n.id === step && n.status === 'running')) state = transitionQuest(state, step, 'blocked');
        await draw(); return value;
      } catch (error) {
        if (epoch === generation && state?.nodes.some(n => n.id === step && n.status === 'running')) { state = transitionQuest(state, step, 'failed'); await draw(); }
        throw error;
      }
    },
    snapshot: () => state,
  };
}

/** Tracks only observable outcomes; cancelled and prerequisite-only results are not success. */
export function withAutomationQuest(host: GoogleAutomationMcpHost, quest: ReturnType<typeof createAutomationQuestSession>): GoogleAutomationMcpHost {
  const ok = (value: unknown) => !!value && typeof value === 'object' && !(value as { cancelled?: boolean }).cancelled;
  const flag = (key: string) => (value: unknown) => ok(value) && (value as Record<string, unknown>)[key] === true;
  return { ...host,
    workflowPlan: plan => quest.plan(plan),
    askUser: host.askUser ? args => quest.track('goal', () => host.askUser!(args), ok) : undefined,
    saveSkill: host.saveSkill ? recipe => { quest.invalidate(['skill','prepare','upload','deploy','preview','send','publish']); return quest.track('skill', () => host.saveSkill!(recipe), flag('saved')); } : undefined,
    connectGoogle: host.connectGoogle ? mode => quest.track('connect', () => host.connectGoogle!(mode), flag('connected')) : undefined,
    configureSheet: host.configureSheet ? mode => { quest.invalidate(['sheet','preview','send']); return quest.track('sheet', () => host.configureSheet!(mode), value => ok(value) && typeof (value as { rowCount?: unknown }).rowCount === 'number'); } : undefined,
    publishSkill: host.publishSkill ? () => quest.track('publish', () => host.publishSkill!(), flag('published')) : undefined,
    appsScriptPrepare: host.appsScriptPrepare ? () => quest.track('prepare', () => host.appsScriptPrepare!(), flag('prepared')) : undefined,
    appsScriptUpload: host.appsScriptUpload ? () => quest.track('upload', () => host.appsScriptUpload!(), flag('uploaded')) : undefined,
    appsScriptDeploy: host.appsScriptDeploy ? () => quest.track('deploy', () => host.appsScriptDeploy!(), flag('deployed')) : undefined,
    appsScriptRun: host.appsScriptRun ? mode => quest.track(mode, () => host.appsScriptRun!(mode), flag(mode === 'preview' ? 'previewed' : 'sent')) : undefined,
  };
}
