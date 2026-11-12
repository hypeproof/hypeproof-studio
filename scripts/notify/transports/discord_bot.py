"""Discord bot transport: channel post and direct message as the existing bot (hypeproof-harness#574).

Reuses the bot identity the other Discord tools already use (Mother); no webhook and no new
credential. Every message carries allowed_mentions, so only the named users can be pinged:
roles, @everyone and any other mention in the text stay inert. Standard library only, so a
light runner needs no extra package.

    POST /channels/{channel_id}/messages     channel post
    POST /users/@me/channels {recipient_id}  open the DM channel, then post to it
"""
from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"
MAX_BODY = 1900
USER_AGENT = "DiscordBot (https://github.com/hypeproof/hypeproof-harness, 0.3) hypeproof-notify"


def _open(request: urllib.request.Request) -> tuple[int, dict, dict]:
    """(status, headers, json body); replaced in tests."""
    try:
        with urllib.request.urlopen(request, timeout=15) as r:
            raw = r.read(65536)
            return r.status, dict(r.headers), json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read(65536) or b"{}")
        except ValueError:
            body = {}
        return e.code, dict(e.headers or {}), body if isinstance(body, dict) else {}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0, {}, {}


def _call(path: str, token: str, payload: dict) -> tuple[int, dict]:
    for _ in range(3):
        request = urllib.request.Request(API + path, data=json.dumps(payload).encode(), method="POST", headers={
            "Authorization": f"Bot {token}", "Content-Type": "application/json", "User-Agent": USER_AGENT})
        status, headers, body = _open(request)
        if status == 429:
            time.sleep(min(float(headers.get("Retry-After", "1")) + 0.1, 10.0))
            continue
        return status, body if isinstance(body, dict) else {}
    return 429, {}


def _result(status: int, body: dict) -> str:
    # The message id on success (for the ledger), Discord's own error code otherwise; never the
    # request, the content or the token.
    if 200 <= status < 300:
        return f"id:{body.get('id', '')}"
    return f"discord error {body.get('code', 'unknown')}"


def _post(channel_id: str, content: str, token: str, mention_user_ids) -> tuple[int, str]:
    if len(content) > MAX_BODY:
        content = content[: MAX_BODY - 20] + "\n…(truncated)"
    payload = {"content": content, "allowed_mentions": {"parse": [], "users": [str(u) for u in mention_user_ids][:5]}}
    status, body = _call(f"/channels/{channel_id}/messages", token, payload)
    return status, _result(status, body)


def _dm(user_id: str, content: str, token: str) -> tuple[int, str]:
    status, body = _call("/users/@me/channels", token, {"recipient_id": str(user_id)})
    if not 200 <= status < 300 or not body.get("id"):
        return status, "no DM channel" if 200 <= status < 300 else _result(status, body)
    status, body = _call(f"/channels/{body['id']}/messages", token,
                         {"content": content[:MAX_BODY], "allowed_mentions": {"parse": []}})
    return status, _result(status, body)


async def post(channel_id: str, content: str, *, token: str, mention_user_ids=()) -> tuple[int, str]:
    return await asyncio.to_thread(_post, channel_id, content, token, mention_user_ids)


async def dm(user_id: str, content: str, *, token: str) -> tuple[int, str]:
    return await asyncio.to_thread(_dm, user_id, content, token)
