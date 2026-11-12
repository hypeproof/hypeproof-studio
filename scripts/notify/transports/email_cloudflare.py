"""Cloudflare Email Sending transport (hypeproof-harness#574).

POST /accounts/{account_id}/email/sending/send with a token that may send email. On the
Workers Free plan Cloudflare delivers only to destination addresses verified in the
account's Email Routing, so each recipient confirms their address once; arbitrary
recipients need Workers Paid. Plain text only. The token and the address are never logged.
"""
from __future__ import annotations

import httpx

API = "https://api.cloudflare.com/client/v4/accounts/{account}/email/sending/send"
USER_AGENT = "hypeproof-notify/0.1 (+https://github.com/hypeproof/hypeproof-harness)"


async def send(to: str, content: str, *, subject: str, account_id: str, token: str,
               sender: str = "notify@hypeproof-ai.xyz", **_: object) -> tuple[int, str]:
    payload = {"from": sender, "to": to, "subject": subject[:120] or "[HypeProof] 확인 요청", "text": content}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(API.format(account=account_id), headers=headers, json=payload)
    if 200 <= r.status_code < 300:
        return r.status_code, ""
    try:
        errors = r.json().get("errors") or []
        code = ",".join(str(e.get("code")) for e in errors)[:80]
    except ValueError:
        code = ""
    return r.status_code, code  # Cloudflare error codes only, never the body
