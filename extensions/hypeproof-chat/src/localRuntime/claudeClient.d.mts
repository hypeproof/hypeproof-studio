export function claudeStatus(executable?: string): {
  provider: "claude";
  model: string;
  label: string;
};
export function runClaude(args: {
  executable?: string;
  cwd: string;
  model?: string;
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  timeout?: number;
  onDelta: (text: string) => void;
  onRefusal?: () => void;
  /** #3601: every parsed stream line (progress for the stall watch). */
  onProgress?: () => void;
  toolServer: { url: string; token: string };
}): Promise<{ model: string; usage: unknown }>;
