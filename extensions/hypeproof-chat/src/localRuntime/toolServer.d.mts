export function startToolServer(
  tools: Array<{ name: string; description: string; inputSchema: unknown }>,
  call: (name: string, args: unknown) => Promise<string | { content: unknown[]; isError?: boolean }>,
  signal?: AbortSignal,
): Promise<{ url: string; token: string; close(): void }>;
