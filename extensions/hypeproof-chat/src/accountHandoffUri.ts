/**
 * Web-to-app sign-in handoff link the Lab invite done page emits ("Studio 열기"):
 *
 *   <uriScheme>://hypeproof.hypeproof-chat/account-handoff?ticket=<64 lowercase hex>
 *
 * Pure (no `vscode`): the URI handler in extension.ts passes the parts of `vscode.Uri` and its own
 * scheme. The ticket is a single-use, 120-second credential minted by the Service for the web
 * session; anything that is not exactly this shape returns undefined and is ignored silently.
 */
export const ACCOUNT_HANDOFF_AUTHORITY = "hypeproof.hypeproof-chat";
export const ACCOUNT_HANDOFF_PATH = "/account-handoff";
const TICKET = /^[a-f0-9]{64}$/;
/** `ticket=` + 64. A longer query is refused before it is parsed. */
const QUERY_MAX = 71;

export interface AccountHandoffUri { scheme: string; authority: string; path: string; query: string; fragment: string }

export function accountHandoffTicket(uri: AccountHandoffUri, scheme: string): string | undefined {
  if (!scheme || uri.scheme !== scheme || uri.authority !== ACCOUNT_HANDOFF_AUTHORITY || uri.path !== ACCOUNT_HANDOFF_PATH || uri.fragment) return undefined;
  if (uri.query.length > QUERY_MAX) return undefined;
  let query: URLSearchParams;
  try { query = new URLSearchParams(uri.query); } catch { return undefined; }
  const keys = [...query.keys()];
  if (keys.length !== 1 || keys[0] !== "ticket") return undefined;
  const ticket = query.get("ticket");
  // Rebuilt and compared: the query must be exactly `ticket=<hex>`, nothing reordered or decorated.
  if (!ticket || !TICKET.test(ticket) || uri.query !== `ticket=${ticket}`) return undefined;
  return ticket;
}
