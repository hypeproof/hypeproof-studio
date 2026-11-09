const ORIGIN = "https://api.hypeproof-ai.xyz";
export const routes = { claim: "/v1/free/claim", chat: "/v1/messages" };
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export function validate(action, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (action === "claim")
    return (
      Object.keys(body).sort().join(",") === "age_ok,app_version,install_id" &&
      body.age_ok === true &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        body.install_id,
      ) &&
      body.app_version === "2026.1109.0"
    );
  return (
    action === "chat" &&
    uuid(body.turn_id) &&
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    body.messages.length <= 24 &&
    body.messages.at(-1)?.role === "user" &&
    body.messages.every(
      (m) =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string" &&
        m.content.trim().length > 0 &&
        m.content.length <= 12000,
    )
  );
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: { code: "method_not_allowed" } });
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host)
        return res.status(403).json({ error: { code: "origin_refused" } });
    } catch {
      return res.status(403).json({ error: { code: "origin_refused" } });
    }
  }
  const action = req.query.action;
  if (!Object.hasOwn(routes, action))
    return res.status(404).json({ error: { code: "not_found" } });
  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: { code: "invalid_body" } });
  }
  if (JSON.stringify(body ?? {}).length > 64000 || !validate(action, body))
    return res.status(400).json({ error: { code: "invalid_body" } });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "HypeProof-Studio-Mobile/2026.1109.0",
  };
  if (action === "chat") {
    if (!/^Bearer [^\s]{16,8192}$/.test(req.headers.authorization ?? ""))
      return res.status(401).json({ error: { code: "session_required" } });
    headers.Authorization = req.headers.authorization;
    headers["anthropic-version"] = "2023-06-01";
    headers["x-hps-turn-id"] = body.turn_id;
    headers["x-hps-trial-request-id"] = crypto.randomUUID();
    // Anthropic-compatible text transport, not a claimed Agent SDK execution.
    // Service still owns model routing, policy, allowance and cost settlement.
    body = {
      model: "hypeproof-fast",
      messages: body.messages,
      stream: false,
      max_tokens: 700,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on?.("close", disconnect);
  try {
    // No provider key, privileged issuer, token logging, or admission override.
    const response = await fetch(ORIGIN + routes[action], {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return res.status(502).json({ error: { code: "service_unavailable" } });
    const data = await response.json();
    if (response.ok && action === "chat") {
      const content = Array.isArray(data.content)
        ? data.content
            .filter(
              (block) =>
                block.type === "text" && typeof block.text === "string",
            )
            .map((block) => block.text)
            .join("\n")
        : "";
      if (!content.trim())
        return res.status(502).json({ error: { code: "empty_response" } });
      return res
        .status(200)
        .json({ content, truncated: data.stop_reason === "max_tokens" });
    }
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: { code: "service_unavailable" } });
  } finally {
    clearTimeout(timeout);
    res.off?.("close", disconnect);
  }
}
