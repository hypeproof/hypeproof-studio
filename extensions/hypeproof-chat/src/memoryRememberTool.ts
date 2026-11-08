// REQ-STUDIO-MEMORY-REMEMBER-TOOL (CGP-KNOW-R-027 / REQ-KNOW-45, CGP-KNOW-D-027 / DES-KNOW-45) — the coach-facing
// `remember` tool: the coach saves one short note to the activity's personal memory store. vscode-free, so a smoke
// drives exactly what the host runs.
//
// One tool, two transports: an in-process MCP tool for the Agent SDK runtime (`mcp__hypeproof_memory__remember`) and a
// JSON-schema tool for the local CLI runtime (`remember`). Both end in `MemoryRememberHost.write`, which the host
// implements with `recordTurnMemoryWrite`: the file, the timeline line and its 되돌리기 are one call, so a note cannot
// be saved without the learner seeing it. The tool never names a path: the store location comes from the host binding
// (personal and trial activities only; a class or team activity has none), and a file name the coach supplies must pass
// `memoryFileName` before the store sees it.

import { memoryFileName, memoryText, MEMORY_LIMITS } from "./activityMemory.ts";
import type { McpToolResult, SdkMcpFactory, ZodLike } from "./browserMcp.ts";

export const MEMORY_MCP_SERVER = "hypeproof_memory";
export const MCP_MEMORY_REMEMBER = "mcp__hypeproof_memory__remember";
/** The local-runtime tool name (the CLI transports expose no server prefix). */
export const LOCAL_MEMORY_REMEMBER = "remember";
/** A note is one short sentence or two; the store's own cap (MEMORY_LIMITS.chars) is far above this. */
export const MEMORY_NOTE_MAX = 300;
/** Writes one turn may make: every one keeps a receipt (and so an undo) and a flood cannot fill the store. */
export const MEMORY_REMEMBER_TURN_CAP = 5;

export type RememberRefusal = "unavailable" | "invalid" | "full" | "limit" | "failed";
export type RememberOutcome = { ok: true; item: string } | { ok: false; reason: RememberRefusal };
export interface MemoryRememberHost {
  /** Saves one note (and, with `item`, replaces that existing item). Never throws. */
  write(note: string, item?: string): Promise<RememberOutcome>;
}

// Model-facing guidance. The Service-owned system prompt is not changed by Studio; this description is the Studio-side
// place where the coach is told what to remember and what the learner can do about it.
export const REMEMBER_DESCRIPTION =
  "Save one short note to the learner's personal memory for this activity, so a later conversation can use it. " +
  "Remember only stable preferences or facts the learner has stated themselves (their goal, how they like to work, a name they want used). " +
  "Never save sensitive personal data (health, finances, passwords, ID numbers, contact details, other people's details) and never save guesses. " +
  `Plain text, at most ${MEMORY_NOTE_MAX} characters. The learner sees a line under your answer showing the note and can undo it, so mention it briefly instead of hiding it. ` +
  "It works only in a personal activity; if it is refused, carry on without it and do not retry.";

/** What the coach is told after each outcome: calm, no internal names. */
export const REMEMBER_REPLIES = {
  saved: "Saved. The learner can see the note and undo it.",
  unavailable: "Memory is not available in this activity, so nothing was saved. Carry on without it.",
  tooLong: `The note is too long. Nothing was saved. Shorten it to ${MEMORY_NOTE_MAX} characters or fewer and only keep the one fact.`,
  empty: "The note was empty. Nothing was saved.",
  invalidItem: "That item name is not one of the learner's memory items. Nothing was saved.",
  full: "The memory is full. Nothing was saved. Tell the learner they can clear old items in the memory list.",
  limit: "Enough notes were saved this turn. Nothing more was saved. Carry on and do not retry.",
  failed: "The note could not be saved. Nothing was changed. Do not retry.",
} as const;

const result = (text: string, isError: boolean): McpToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/**
 * Validates the coach's input and writes through the host. A refusal is a normal tool result (isError), never a throw,
 * and never touches the store: the note is checked here, the file name by `memoryFileName`, the path by the store.
 */
export async function runRemember(host: MemoryRememberHost | undefined, input: unknown): Promise<McpToolResult> {
  if (!host) return result(REMEMBER_REPLIES.unavailable, true);
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!record || typeof record.note !== "string") return result(REMEMBER_REPLIES.empty, true);
  // One run of plain text: line breaks and control characters out, as the store would drop them anyway.
  const note = memoryText(record.note).replace(/\s+/gu, " ").trim();
  if (!note) return result(REMEMBER_REPLIES.empty, true);
  if ([...note].length > Math.min(MEMORY_NOTE_MAX, MEMORY_LIMITS.chars)) return result(REMEMBER_REPLIES.tooLong, true);
  let item: string | undefined;
  if (record.item !== undefined && record.item !== null && record.item !== "") {
    if (typeof record.item !== "string" || !memoryFileName(record.item)) return result(REMEMBER_REPLIES.invalidItem, true);
    item = record.item;
  }
  let outcome: RememberOutcome;
  try { outcome = await host.write(note, item); } catch { outcome = { ok: false, reason: "failed" }; }
  if (outcome.ok) return result(REMEMBER_REPLIES.saved, false);
  return result(outcome.reason === "unavailable" ? REMEMBER_REPLIES.unavailable : outcome.reason === "invalid" ? REMEMBER_REPLIES.invalidItem : outcome.reason === "full" ? REMEMBER_REPLIES.full : outcome.reason === "limit" ? REMEMBER_REPLIES.limit : REMEMBER_REPLIES.failed, true);
}

/** The Agent SDK transport: an in-process MCP server with the one tool. */
export function buildMemoryMcpServer(factory: SdkMcpFactory, z: ZodLike, host: MemoryRememberHost): unknown {
  const optional = (schema: unknown) => (typeof (schema as { optional?: () => unknown }).optional === "function" ? (schema as { optional: () => unknown }).optional() : schema);
  const tool = factory.tool("remember", REMEMBER_DESCRIPTION, { note: z.string(), item: optional(z.string()) }, async (input) => runRemember(host, input));
  return factory.createSdkMcpServer({ name: MEMORY_MCP_SERVER, version: "1.0.0", tools: [tool] });
}

/** The local CLI transport: the same tool as a JSON-schema definition and a call function. */
export function localRememberTools(host: MemoryRememberHost | undefined, approve: (name: string, input: unknown) => Promise<boolean>) {
  if (!host) return { definitions: [] as Array<{ name: string; description: string; inputSchema: unknown }>, call: async (_name: string, _input: unknown): Promise<string> => { throw new Error(REMEMBER_REPLIES.unavailable); } };
  return {
    definitions: [{
      name: LOCAL_MEMORY_REMEMBER,
      description: REMEMBER_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: { note: { type: "string" }, item: { type: "string" } },
        required: ["note"],
        additionalProperties: false,
      },
    }],
    async call(name: string, input: unknown): Promise<string> {
      if (name !== LOCAL_MEMORY_REMEMBER) throw new Error(REMEMBER_REPLIES.unavailable);
      // The same gate a work-folder write goes through (approval preset), before anything is written.
      if (!(await approve(MCP_MEMORY_REMEMBER, input))) throw new Error("The learner did not allow this.");
      const reply = await runRemember(host, input);
      const text = reply.content.map(block => (block.type === "text" ? block.text : "")).join("\n");
      if (reply.isError) throw new Error(text);
      return text;
    },
  };
}
