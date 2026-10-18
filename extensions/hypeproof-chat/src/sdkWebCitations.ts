import type { Citation } from './protocol';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function citation(url: unknown, title?: unknown): Citation | null {
  if (!shortString(url, 8192)) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    // No Service tier classification accompanies SDK results; 4 is the unclassified/other tier.
    return { url: parsed.href, title: shortString(title) ? title : parsed.hostname, domain: parsed.hostname, tier: 4 };
  } catch { return null; }
}

/**
 * CLI-owned result shapes from installed SDK 0.3.299 sdk-tools.d.ts:
 * WebSearchOutput / WebFetchOutput. The stream's tool_use_result is unknown,
 * so shape validation and a matching successful tool call are mandatory.
 */
export class SdkWebCitations {
  private readonly calls = new Map<string, { name: string; query?: string }>();
  private readonly denied = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly permittedTools: readonly string[];
  constructor(permittedTools: readonly string[]) { this.permittedTools = permittedTools; }
  deny(id: string): void { this.denied.add(id); }

  observe(event: unknown): Citation[] {
    if (!record(event) || !record(event.message) || !Array.isArray(event.message.content)) return [];
    const blocks = event.message.content.filter(record);
    if (event.type === 'assistant') {
      for (const block of blocks) {
        if (block.type !== 'tool_use' || !shortString(block.id, 256) || typeof block.name !== 'string' ||
            !['WebSearch', 'WebFetch'].includes(block.name) || !this.permittedTools.includes(block.name)) continue;
        this.calls.set(block.id, { name: block.name, ...(record(block.input) && shortString(block.input.query) ? { query: block.input.query } : {}) });
      }
      return [];
    }
    if (event.type !== 'user' || !record(event.tool_use_result)) return [];
    const results = blocks.filter(block => block.type === 'tool_result');
    // The envelope carries one unkeyed typed output. Multiple result blocks are ambiguous.
    if (results.length !== 1) return [];
    const result = results[0], id = result.tool_use_id;
    if (!shortString(id, 256)) return [];
    const call = this.calls.get(id);
    if (!call) return [];
    this.calls.delete(id);
    if (result.is_error !== undefined && typeof result.is_error !== 'boolean' || result.is_error === true || this.denied.has(id)) return [];
    const value = event.tool_use_result;
    const found: Citation[] = [];
    if (call.name === 'WebSearch') {
      if (!shortString(value.query) || call.query !== undefined && value.query !== call.query || !Array.isArray(value.results) || value.results.length > 100) return [];
      for (const group of value.results) {
        if (typeof group === 'string') continue;
        if (!record(group) || !shortString(group.tool_use_id, 256) || !Array.isArray(group.content) || group.content.length > 200) return [];
        for (const hit of group.content) {
          if (!record(hit) || !shortString(hit.title) || !shortString(hit.url, 8192)) return [];
          const source = citation(hit.url, hit.title);
          if (source) found.push(source);
        }
      }
    } else {
      if (typeof value.code !== 'number' || !Number.isInteger(value.code) || value.code < 200 || value.code >= 300 ||
          typeof value.bytes !== 'number' || !Number.isFinite(value.bytes) || value.bytes < 0 ||
          typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0 ||
          typeof value.codeText !== 'string' || typeof value.result !== 'string') return [];
      const source = citation(value.url);
      if (source) found.push(source);
    }
    return found.filter(source => {
      if (this.seen.has(source.url) || this.seen.size >= 100) return false;
      this.seen.add(source.url); return true;
    });
  }
}
