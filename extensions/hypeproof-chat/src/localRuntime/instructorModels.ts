// chalk#25 — the model an instructor picks in Chalk runs on the local runner.
// Plan A (Studio constant): a per-provider allowlist. A value outside it never changes the executed
// model; the turn runs on the default and Chalk is told so (requestedModel !== executorModel).
// The allowlist is sent only through activateInstructor.models. The legacy panel (localModelSelection) is unchanged.

export type InstructorProvider = "claude" | "codex";

/** Models an instructor may pick. claude: CLI --model aliases. codex: the CLI default only (-m takes free text, so no other value). */
export const INSTRUCTOR_MODEL_ALLOWLIST: Readonly<Record<InstructorProvider, readonly string[]>> = {
  claude: ["sonnet", "opus"],
  codex: ["default"],
};

export interface InstructorModelChoice {
  alias: string;
  id: string;
  label: string;
}

export interface InstructorModels {
  default: string;
  choices: InstructorModelChoice[];
}

/** The minimum a runner config needs here. LocalRuntimeConfig satisfies it. */
export interface InstructorRunnerConfig {
  provider: InstructorProvider;
  model: string;
  label: string;
}

const PROVIDER_LABEL: Record<InstructorProvider, string> = { claude: "Claude Code", codex: "Codex" };

function allowedIds(config: { provider: InstructorProvider; model: string }): string[] {
  // The default is always selectable, even when it is not in the allowlist (a development model from the environment).
  return [...new Set([config.model, ...INSTRUCTOR_MODEL_ALLOWLIST[config.provider]])];
}

/** The choices Studio sends in activateInstructor.models. alias and id are the same CLI value. */
export function instructorModelChoices(config: { provider: InstructorProvider; model: string }): InstructorModels {
  return {
    default: config.model,
    choices: allowedIds(config).map((id) => ({
      alias: id,
      id,
      label: `${PROVIDER_LABEL[config.provider]} · 로컬 구독 · ${id}`,
    })),
  };
}

/**
 * The model a turn actually runs on. A requested value inside the allowlist wins; anything else
 * (absent, outside the list) runs on the default. Never throws.
 */
export function executorModelFor(config: { provider: InstructorProvider; model: string }, requested?: string): string {
  if (typeof requested === "string" && requested.length > 0 && allowedIds(config).includes(requested)) return requested;
  return config.model;
}

/** A copy of the config for one turn: the executed model and its label. Outside the allowlist the copy equals the original. */
export function withTurnModel<T extends InstructorRunnerConfig>(config: T, requested?: string): T {
  const model = executorModelFor(config, requested);
  if (model === config.model) return config;
  return { ...config, model, label: `${PROVIDER_LABEL[config.provider]} · 로컬 구독 · ${model}` };
}
