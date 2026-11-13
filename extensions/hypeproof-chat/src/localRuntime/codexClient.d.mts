export class CodexLocalClient {
  constructor(options?: { executable?: string });
  connect(): Promise<{
    auth: string;
    models: Array<{ id: string; label: string; isDefault: boolean }>;
    external_tools: number;
  }>;
  /** #3939: maps "default" to the catalog's isDefault entry (else the first). Other ids pass through. */
  resolveModel(requested: string): string;
  complete(args: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
    /** #3601: every protocol message from Codex (progress for the stall watch). */
    onProgress?: () => void;
    maxOutputBytes?: number;
    tools?: Array<{ name: string; description: string; inputSchema: unknown }>;
    onToolCall?: (name: string, args: unknown) => Promise<string>;
  }): Promise<{ text: string; model: string; usage: unknown; auth: string }>;
  close(): void;
}
