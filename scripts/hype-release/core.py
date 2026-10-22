"""Shared release handoff contracts. Product acceptance stays in the product engine."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation


class Blocked(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def require(ok, reason):
    if not ok:
        raise Blocked(reason)


def utc(value):
    require(isinstance(value, str) and value.endswith("Z"), "UTC time ending in Z required")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Blocked("invalid UTC time") from None


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def money(value):
    try:
        result = Decimal(str(value))
        require(result.is_finite() and result >= 0, "invalid cost")
        return result
    except (InvalidOperation, TypeError):
        raise Blocked("invalid cost") from None


def repository(value):
    require(isinstance(value, str) and re.fullmatch(r"hypeproof/[A-Za-z0-9_.-]+", value),
            "use an explicitly permitted hypeproof/<repo> repository")
    return value


def policy_contract(policy):
    require(policy.get("schema") == "hype-release-policy/1", "unsupported policy")
    roster = policy.get("managers")
    require(isinstance(roster, list) and roster and all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9-]{1,39}", x) for x in roster), "manager roster must be a list of GitHub logins")
    require(len(set(roster)) == len(roster), "duplicate manager")
    require(isinstance(policy.get("repositories"), list) and policy["repositories"], "repository allowlist required")
    for repo in policy["repositories"]:
        repository(repo)
    require(money(policy.get("budgetLimitUsd")) < 1, "candidate budget must be below USD 1")
    require(type(policy.get("maxAttempts")) is int and 1 <= policy["maxAttempts"] <= 3, "bounded retry limit required")
    require(policy.get("modelExecution") == "disabled", "automatic model execution is disabled; use existing signed-in tools for bounded diagnosis")
    require(bool(policy.get("revision")), "policy revision required")
    return policy


def candidate_contract(candidate, policy):
    require(repository(candidate.get("repository")) in policy["repositories"], "repository outside policy")
    require(re.fullmatch(r"[a-f0-9]{40}", candidate.get("sourceSha", "")), "full candidate SHA required")
    require(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", candidate.get("version", "")), "final version required")
    require(re.fullmatch(re.escape(candidate["version"]) + r"-rc\.[1-9][0-9]*", candidate.get("tag", "")), "matching immutable RC tag required")
    prs = candidate.get("sourcePrs")
    require(isinstance(prs, list) and prs and all(type(n) is int and n > 0 for n in prs) and len(prs) == len(set(prs)), "explicit unique source PRs required")
    require(bool(candidate.get("changes")) and all(isinstance(x, dict) and x.get("before") and x.get("after") for x in candidate["changes"]), "Before/After changes required")
    require(bool(candidate.get("rollback")), "rollback instructions required")
    return candidate


def initial(candidate, policy, actor, timestamp=None):
    policy_contract(policy)
    candidate_contract(candidate, policy)
    require(actor in policy["managers"], "authenticated actor is not in manager roster")
    return {"schema": "hype-release-state/1", "candidate": copy.deepcopy(candidate), "candidateDigest": digest(candidate),
            "policyDigest": digest(policy), "owner": actor, "revision": 0, "createdAt": timestamp or now(),
            "operations": {}, "checks": {}, "artifacts": [], "handoffs": [], "costs": [], "tokenUsage": [],
            "stablePublished": False, "humanAcceptance": "PENDING"}


def authorize(state, policy, actor):
    policy_contract(policy)
    require(state.get("schema") == "hype-release-state/1", "unsupported release state")
    require(state["candidateDigest"] == digest(state["candidate"]), "candidate record changed")
    candidate_contract(state["candidate"], policy)
    require(state["policyDigest"] == digest(policy), "policy changed: reconcile explicitly with the release owner")
    require(actor == state["owner"] and actor in policy["managers"], "only the current authenticated release owner may mutate this candidate")


def handoff(state, policy, actor, recipient, note):
    authorize(state, policy, actor)
    require(recipient in policy["managers"] and recipient != actor and note.strip(), "another permitted manager and handoff note required")
    require(not any(o["status"] == "UNKNOWN" for o in state["operations"].values()), "reconcile uncertain external operations before handoff")
    result = copy.deepcopy(state)
    result["owner"] = recipient
    result["handoffs"].append({"from": actor, "to": recipient, "note": note, "at": now()})
    return result


def evidence_key(identity):
    """Keys describe a claim's boundary; comments alone never invalidate a verdict."""
    kind = identity.get("kind")
    fields = {"source": ["repository", "sourceSha", "testRevision", "acceptanceRevision"],
              "package": ["repository", "sourceSha", "artifactSha256", "testRevision", "acceptanceRevision"],
              "installed-app": ["repository", "sourceSha", "artifactSha256", "os", "arch", "environmentRevision", "serviceRevision", "testRevision", "acceptanceRevision"]}
    require(kind in fields, "unknown evidence scope")
    for name in fields[kind]:
        require(isinstance(identity.get(name), str) and bool(identity[name].strip()), f"evidence identity requires {name}")
    repository(identity["repository"])
    require(re.fullmatch(r"[a-f0-9]{40}", identity["sourceSha"]), "invalid evidence source SHA")
    if kind != "source":
        require(re.fullmatch(r"[a-f0-9]{64}", identity["artifactSha256"]), "invalid artifact digest")
    return digest({"kind": kind, **{k: identity[k] for k in fields[kind]}})


def record_check(state, check):
    require(check.get("verdict") in {"PASS", "FAIL", "BLOCKED", "NOT_RUN"}, "invalid verdict")
    require(check.get("id") and check.get("expected") and check.get("observed") and check.get("evidence"), "complete claim and evidence locator required")
    identity = check.get("identity", {})
    require(identity.get("repository") == state["candidate"]["repository"] and identity.get("sourceSha") == state["candidate"]["sourceSha"], "evidence belongs to another candidate")
    key = evidence_key(identity)
    if identity["kind"] != "source":
        require(identity["artifactSha256"] in {a["sha256"] for a in state["artifacts"]}, "evidence is not for a collected candidate package")
    result = copy.deepcopy(state)
    result["checks"][check["id"]] = {**copy.deepcopy(check), "identityKey": key, "authority": "observation-only; product engine verifies signed acceptance"}
    return result


def committed_cost(state):
    # Never let one operation's underspend hide another operation's overrun.
    total = Decimal(0)
    for key, operation in state["operations"].items():
        observations = [money(c["amountUsd"]) for c in state["costs"]
                        if c["scope"] == "operation" and c["operationId"] == key]
        total += max([money(operation["reservedUsd"]), *observations])
    return total


def reserve(state, policy, actor, operation_id, kind, request, quote, timestamp=None):
    authorize(state, policy, actor)
    require(re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", operation_id), "safe operation ID required")
    fingerprint = digest({"kind": kind, "request": request})
    existing = state["operations"].get(operation_id)
    if existing:
        require(existing["requestDigest"] == fingerprint, "operation ID reused with different input")
        require(existing["status"] == "DONE", "uncertain or failed operation: reconcile before any retry")
        return state, existing, True
    require(not any(o["status"] == "UNKNOWN" for o in state["operations"].values()), "reconcile outstanding operation first")
    require(quote.get("status") == "CONFIRMED" and quote.get("evidence") and quote.get("paidFallback") is False, "confirmed bounded cost quote without paid fallback required")
    require(quote.get("kind") == kind and quote.get("candidateDigest") == state["candidateDigest"], "quote is for another candidate or operation")
    require(quote.get("requestDigest") == fingerprint, "quote does not bind this exact execution request")
    instant = utc(timestamp or now())
    require(utc(quote["observedAt"]) <= instant < utc(quote["expiresAt"]), "stale or future cost quote")
    estimate = money(quote.get("upperBoundUsd"))
    # Reserve conservatively for every attempt, including failed/uncertain work.
    require(committed_cost(state) + estimate <= money(policy["budgetLimitUsd"]), "candidate budget exhausted")
    attempts = sum(o["kind"] == kind for o in state["operations"].values())
    require(attempts < policy["maxAttempts"], "retry limit exhausted")
    result = copy.deepcopy(state)
    operation = {"kind": kind, "request": copy.deepcopy(request), "requestDigest": fingerprint, "status": "UNKNOWN",
                 "reservedUsd": str(estimate), "quote": copy.deepcopy(quote), "actor": actor, "startedAt": timestamp or now()}
    result["operations"][operation_id] = operation
    return result, operation, False


def resume_upload(state, policy, actor, operation_id, quote, timestamp=None):
    """Only exclusive-name, digest-bound support uploads admit safe partial replay."""
    authorize(state, policy, actor)
    operation = state["operations"].get(operation_id)
    require(operation and operation["kind"] == "upload" and operation["status"] == "UNKNOWN", "only an uncertain support upload can resume")
    require(quote.get("status") == "CONFIRMED" and quote.get("evidence") and quote.get("paidFallback") is False, "confirmed resume quote required")
    require(quote.get("kind") == "upload" and quote.get("candidateDigest") == state["candidateDigest"] and quote.get("requestDigest") == operation["requestDigest"], "resume quote must bind the original upload")
    instant = utc(timestamp or now())
    require(utc(quote["observedAt"]) <= instant < utc(quote["expiresAt"]), "resume quote expired")
    require(len(operation.get("resumes", [])) + 1 < policy["maxAttempts"], "upload resume limit exhausted")
    estimate = money(quote.get("upperBoundUsd"))
    require(committed_cost(state) + estimate <= money(policy["budgetLimitUsd"]), "resume budget exhausted")
    result = copy.deepcopy(state)
    op = result["operations"][operation_id]
    observed = [money(c["amountUsd"]) for c in state["costs"] if c["scope"] == "operation" and c["operationId"] == operation_id]
    op["reservedUsd"] = str(max([money(op["reservedUsd"]), *observed]) + estimate)
    op.setdefault("resumes", []).append({"at": timestamp or now(), "actor": actor, "quote": copy.deepcopy(quote)})
    return result


def settle(state, operation_id, status, result):
    require(status in {"DONE", "FAILED"}, "invalid operation outcome")
    updated = copy.deepcopy(state)
    operation = updated["operations"][operation_id]
    require(operation["status"] == "UNKNOWN", "operation already settled")
    operation.update(status=status, result=copy.deepcopy(result), finishedAt=now())
    return updated


def record_cost(state, observation):
    require(observation.get("kind") in {"reported", "final"} and observation.get("scope") in {"repository-day", "operation"}, "separate reported/final and repository/operation accounting")
    require(observation.get("id") and observation.get("evidence") and observation.get("observedAt"), "cost provenance required")
    utc(observation["observedAt"])
    money(observation.get("amountUsd"))
    if observation["scope"] == "operation":
        require(observation.get("operationId") in state["operations"], "unknown cost operation")
    result = copy.deepcopy(state)
    same = [c for c in result["costs"] if c["id"] == observation["id"]]
    require(not same or same[0] == observation, "cost observation ID conflict")
    if not same:
        result["costs"].append(copy.deepcopy(observation))
    return result


def record_tokens(state, observation):
    """Record external diagnosis usage; this tool never runs or bills a model."""
    require(observation.get("id") and observation.get("evidence"), "token usage provenance required")
    require(observation.get("billingMode") in {"subscription", "api", "unknown"}, "explicit billing mode required")
    require(observation.get("scope") in {"diagnosis", "account-window"}, "token usage scope required")
    for key in ["inputTokens", "outputTokens"]:
        value = observation.get(key)
        require(value is None or type(value) is int and value >= 0, "unknown token count must be null")
    utc(observation.get("observedAt"))
    result = copy.deepcopy(state)
    same = [x for x in result["tokenUsage"] if x["id"] == observation["id"]]
    require(not same or same[0] == observation, "token observation conflict")
    if not same:
        result["tokenUsage"].append(copy.deepcopy(observation))
    return result


def public_payload(value):
    """Catch common credential mistakes; callers still supply sanitized summaries."""
    text = canonical(value)
    require(len(text.encode()) < 600000, "state too large: store sanitized evidence locators")
    require(not re.search(r"(?i)-----BEGIN .*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]+|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}", text), "credential-like content must not enter release state")
    if isinstance(value, dict):
        for key, child in value.items():
            require(re.sub(r"[^a-z]", "", key.lower()) not in {"token", "issuertoken", "adminpassword", "secret", "signingsecret", "accesstoken", "refreshtoken", "apikey", "authorization", "privatekey", "password", "cookie"}, "credential field must not enter release state")
            public_payload(child)
    elif isinstance(value, list):
        for child in value:
            public_payload(child)
    return value
