// Smoke tests for #358 friendly transport-error mapping. Pure — no vscode, no
// fetch. When the region-pinned Anthropic proxy rejects an oversized pasted
// image with 413, the webview should show a specific "image too large" message
// instead of the generic error card.
// Run: node --experimental-strip-types test/proxy-transport-friendly.smoke.mjs

import assert from "node:assert/strict";

const { friendlyTransportMessage, IMAGE_TOO_LARGE_FRIENDLY } = await import(
  "../src/proxyClientHelpers.ts"
);

// ─── 413 → specific, kid-friendly image-size message ─────────────────────────
{
  assert.equal(friendlyTransportMessage(413), IMAGE_TOO_LARGE_FRIENDLY);
  assert.match(IMAGE_TOO_LARGE_FRIENDLY, /이미지가 너무 커요/, "names the actual problem");
  // Never leak raw status/JSON/English error jargon at a 9-10 year old.
  assert.doesNotMatch(IMAGE_TOO_LARGE_FRIENDLY, /413|error|status|json/i, "no raw diagnostics");
}

// ─── Everything else → null → caller falls back to the generic card ──────────
{
  for (const s of [400, 422, 500, 502, 529, 200]) {
    assert.equal(friendlyTransportMessage(s), null, `status ${s} has no special copy`);
  }
}



// Rate-limit guidance uses only a validated delay, never raw headers or bodies.
{
  const now = Date.UTC(2026, 9, 20, 0, 0, 0);
  const generic = friendlyTransportMessage(429);
  assert.match(generic, /요청이 잠시 제한/);
  assert.match(generic, /잠시 후 다시 시도/);
  assert.match(friendlyTransportMessage(429, "2", now), /약 2초 후/);
  assert.match(friendlyTransportMessage(429, "61", now), /약 2분 후/);
  assert.match(friendlyTransportMessage(429, new Date(now + 2000).toUTCString(), now), /약 2초 후/);
  for (const header of [null, "", "-2", "1.5", "Infinity", "999999999999999999999", "604801", "2 seconds", "secret-token", new Date(now - 1000).toUTCString()]) {
    assert.equal(friendlyTransportMessage(429, header, now), generic, `invalid/stale header ${header}`);
  }
  assert.equal(friendlyTransportMessage(429, "0", now), generic);
  assert.equal(friendlyTransportMessage(413, "2", now), IMAGE_TOO_LARGE_FRIENDLY);
  assert.equal(friendlyTransportMessage(500, "2", now), null);
}

console.log("proxy-transport-friendly.smoke.mjs — all assertions passed");
