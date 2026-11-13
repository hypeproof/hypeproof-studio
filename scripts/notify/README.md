# hp-notify

> Cross-product notification dispatcher. Self-contained Python (httpx + jinja2 + pyyaml). Vendored from `hypeproof-harness` into every consumer repo via `sync.sh`. One module, one CLI, many products.

## Why

Sediment, hypeproof-studio, hypeprooflab-page all need to send Discord/Slack/email notifications on the same kinds of events (deploy success, recall regression, daily digest, new decision, …). Writing this three times = three drift-prone forks. Shipping it via the existing harness vendoring model = one canonical source, three rsync targets, zero coupling.

## How

```
notify.py send <event_type> --routes config/notify_routes.yaml \
                              --data sha=abc1234 --data branch=main \
                              [--tenant <slug>] [--dry-run]
```

What happens:
1. Load `routes.yaml`, validate schema (`version: 1`, channels dict, routes dict)
2. Look up the route for `(tenant or "*", event_type)`
3. Render `templates/<event_type>.md.j2` with the payload + tenant + severity
4. For each channel in the route: load `transports/<name>.py`, resolve target via `secret_env`/`url`/`to`, call `await transport.send(target, body)`
5. Print per-channel result; exit 0 (all sent), 2 (partial), 3 (all failed), 1 (config error)

Python API:
```python
from notify import notify
result = await notify(
    event_type="deploy.success",
    routes_path="config/notify_routes.yaml",
    payload={"sha": "abc1234", "branch": "main", "url": "..."},
    tenant_slug="example-tenant",
)
```

## What it doesn't do (v1)

- Circuit breaker — placeholder file; logic comes in v1.1 once we have failure data
- Cooldown / dedup — same; needs `notification_log` table per design `07-notifications.md`
- Per-tenant template overrides from DB — v3 (UI-driven)

## Adding a new event type

1. Add `templates/<event_type_with_underscores>.md.j2` here
2. Add the event_type to each consumer's `routes.yaml` (or in `routes."*"` for default)
3. Add a caller that does `notify(event_type=..., payload=..., ...)`

That's it. No code change in `notify.py`.

## Adding a new transport

1. Add `transports/<name>.py` exposing `async def send(url, content) -> (status, err)`
2. Use it in `routes.yaml` as `transport: <name>`

## Routes schema (compact)

```yaml
version: 1

channels:
  sediment: { transport: discord_webhook, secret_env: DISCORD_WEBHOOK_SEDIMENT }
  email_jay: { transport: email_smtp, to: jay@example.invalid }

routes:
  "*":                                      # applies unless tenant override
    deploy.success: { channels: [sediment], template: deploy_success }
  example-tenant:                           # per-tenant override
    new_decision:
      channels: [sediment, meeting-notes]
      template: new_decision
      severity: info
```

## Vendoring

Canonical source: `hypeproof-harness/scripts/notify/`
Vendored to: `<consumer>/scripts/notify/` (rsync via `sync.sh`)

Per-consumer files (NOT vendored):
- `config/notify_routes.yaml` — each product's own routing
- Secrets — fly secrets / GH org secrets / Vercel env per channel

Drift detection: `sync.sh --check` exits 1 if any consumer's vendored copy diverges from canonical.

## Local development

```bash
cd hypeproof-harness/scripts/notify
DISCORD_WEBHOOK_SEDIMENT="https://discord.com/api/webhooks/..." \
  python notify.py send deploy.success \
    --routes ../../../sediment/config/notify_routes.yaml \
    --data sha=abc1234 --data branch=main --data product=sediment
```

## Tested with

- Python 3.11+
- httpx 0.28+
- jinja2 3.1+
- pyyaml 6.0+

All of these are already in sediment's `pyproject.toml`. New consumers add them if not present.

The pinned ranges are in `requirements.txt` next to this file. It is vendored with
the module, so a consumer's CI can run `pip install -r scripts/notify/requirements.txt`.

### Discord display name

For `discord_webhook`, the configured channel `bot_name` takes precedence over
`HP_NOTIFY_BOT_NAME`. If neither is non-empty, the payload omits `username` and
Discord uses the webhook's configured name; the old hardcoded `Sediment` default
is not sent. Other transports retain their existing call contract and do not
receive the Discord-only display-name option. The regression test mocks HTTP and
sends no real notification (`tests/notify/test_bot_name.py`).

## Stakeholder decision cards (`stakeholders.py`, #574)

When a PR waits on a person, `stakeholders.py` tells exactly the people it concerns, in at
most five plain lines shaped like an AskUserQuestion prompt:

```
[HypeProof] hypeproof-harness #570 — JeHyeong님께
바뀌는 점: <one line on what changes for users, authored in the card>
받는 이유: <why this person, and what is blocked on them>
질문: <one question>  ① <recommended> (추천)  ② …  ③ …
https://github.com/hypeproof/hypeproof-harness/pull/570
```

- **Recipients are data, not guesses.**
  - The human approvers a gate still needs: hype-merge `policy_required_non_author_approvals:k/n` and the control-plane gate's eligible reviewers, through the approval inbox's `GitHubProvider.snapshot`.
  - Owners of the criteria nodes whose sources the PR changes (`config/traceability.json` at the head).
  - The closing issue's author and assignees.
  - Bots and the PR author are never asked. Names come from hypeprooflab `data/members.json`.
  - **Jay last** (Jay, 2026-11-12): when another eligible approver exists, Jay's card is scheduled 4 hours later. If another approver answers first, Jay's card is dropped. When Jay is the only eligible approver, he is asked directly.
- **The card is authored** by the agent that asks (`--card card.json`: `change_ko`, optional `question_ko`, optional `options` mapping answer ids to labels). Nothing is generated or guessed here. Gate approvers always get the answers ① 승인하기 (추천) ② 질문 남기기 ③ 이번엔 보류 (ids `approve`, `ask`, `hold`). Those are the same buttons a later Studio inbox shows (Studio epic #3767).
- **Escalation**, per (PR, head SHA, person, step), only for people a gate waits on:
  1. a `#team` post by the existing Discord bot (Mother) that may ping only that person, plus an English GitHub mention as the durable record. GitHub then emails the person through their own notification settings, so email needs no credential of ours.
  2. a Discord DM from the same bot after 4 hours without a response;
  3. one last `#team` reminder after 24 hours.

  A review or comment by the person, a resolved gate, a new head or a closed PR stops it. Stakeholders who block nothing get one `#team` note. Nothing is sent 22:00–09:00 KST.
- **Private registry** (0600, outside every repository, refused otherwise). It reuses existing credentials only:

  ```json
  {"contacts": {"<github login>": {"discord_id": "<snowflake>", "email": "<address>"}},
   "discord": {"bot_token": "<the existing bot token>", "team_channel_id": "<#team, from Lab CLAUDE.md>"}}
  ```

  An optional `"email": {"enabled": true, "account_id": …, "token": …, "from": …}` adds Cloudflare Email Sending to step 2. It is off by default.

  `plan` prints whether each channel exists, never the contact. GitHub writes go through `with-agent-identity.sh` as `hypeproof-agent[bot]`.
- **Email** is covered by GitHub's own notification of the mention. `transports/email_cloudflare.py` (Cloudflare Email Sending) stays available but off. On Workers Free it reaches only verified addresses.

```bash
python3 scripts/notify/stakeholders.py plan --repo hypeproof/hypeproof-harness --pr 570 --card card.json
python3 scripts/notify/stakeholders.py request --repo … --pr … --card card.json --registry ~/.config/hypeproof/notify/registry.json --state ~/.local/state/hypeproof/notify/ledger.db [--only LOGIN] --apply
python3 scripts/notify/stakeholders.py tick --registry … --state … --discord-env ~/.claude/channels/discord/.env --team-channel <#team id> --apply   # the escalation runner
```

Without `--apply`, nothing is sent. Tests: `tests/notify/test_stakeholders.py`.

### One card, every channel (`hps-decision-card/1`)

`plan` emits one channel-agnostic card per person:

- `id`: `DC-` plus 16 hex digits, stable per (repo, PR, head, person); a new head is a new card.
- `to`, `role`, `blocking`, `change_ko`, `why_ko`, `question_ko`.
- `options`: each has an `id`, `label_ko`, `recommended` and `github_action`.
- `answer`: `{card_id, by: "recipient_own_github_authorization", studio_url}`.

Discord and email render the five text lines (`render_text`). GitHub renders an English record that carries the card id (`render_github`). The ledger stores the card as JSON. Approving is offered only to people a gate waits on (`review:APPROVE`). Stakeholders get comment or none.

### Studio inbox v2 (not built)

A member-only inbox in HP Studio can show the same cards and take answers in AskUserQuestion style. It would need:

1. **Source**: the approval inbox (#551). A card becomes an inbox request, the inbox state replaces the local ledger, and the inbox's `list`/`get` by member serve the cards. Cards are never read from GitHub.
2. **Stable answer address**: `answer.studio_url` set to a member-only route keyed by `card.id`, for example `/studio/inbox/<card id>`. The card id is bound to (repo, PR, head, person), so an answer to an old head is refused as stale.
3. **The person's own GitHub authorization**: choosing `approve` or `question` becomes that member's own GitHub review on the exact head. Use the inbox's exact-head review path with a credential the member granted (GitHub OAuth for their account). The bot never approves for a human, and a Studio session alone is not a GitHub identity.
4. **Signed decisions**: Studio is a registered inbox adapter. Its answer is the signed decision envelope from `docs/AGENT-APPROVAL-INBOX.ko.md`, carrying an actor, a nonce, an expiry and a one-time receipt. `hold` is recorded and changes nothing on GitHub.
5. **Escalation stops**: an inbox answer counts as a response, and `stakeholders.py tick` closes the request the same way a GitHub review does.
