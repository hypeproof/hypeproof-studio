#!/usr/bin/env python3
"""Explicit, resumable release operations. No background loop or model calls."""
from __future__ import annotations

import argparse
import copy
from contextlib import ExitStack
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from core import (Blocked, authorize, canonical, candidate_contract, committed_cost, digest, handoff, initial,
                  now, policy_contract, public_payload, record_check, record_cost,
                  record_tokens, require, reserve, resume_upload, settle)
from operations import (build_runs, collect, create_tag, create_ticket, engine_check,
                        observe_tag, observe_ticket, report, retry_failed_build,
                        source_prs, support_assets, tag_message, ticket_request,
                        verify_remote_packages)
from transport import GitHub, GitHubStore, LocalGitStore, NativeGitHub
import native_testflight
import routing
import publisher
import macos_signing


def read(path):
    return public_payload(json.loads(Path(path).read_text(encoding='utf-8')))


class Session:
    def __init__(self, store, policy, actor, candidate, github=None):
        self.store, self.policy, self.actor, self.candidate, self.github = store, policy, actor, candidate, github
        self.state, self.revision = store.read()
        if self.state:
            require(self.state["candidateDigest"] == digest(candidate), "candidate input changed; preserve the original or initialize a distinct candidate")

    def save(self, state):
        self.state, self.revision = self.store.write(state, self.revision)
        return self.state

    def own(self):
        require(self.state is not None, "initialize this candidate first")
        authorize(self.state, self.policy, self.actor)

    def operation(self, operation_id, kind, request, quote, action):
        self.own()
        state, existing, duplicate = reserve(self.state, self.policy, self.actor, operation_id, kind, request, quote)
        if duplicate:
            return {"duplicate": True, **existing["result"]}
        self.save(state)  # The atomic reservation MUST precede any external write.
        result = action()
        require(result is not None, "operation response uncertain; reconcile instead of replaying")
        self.save(settle(self.state, operation_id, "DONE", result))
        return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--candidate", required=True)
    p.add_argument("--policy", required=True)
    where = p.add_mutually_exclusive_group(required=True)
    where.add_argument("--state-repo", help="explicit allowlisted HypeProof repository for shared coordination")
    where.add_argument("--local-state", help="bare Git rehearsal store; external commands disabled")
    p.add_argument("--actor", help="offline rehearsal only; remote actor always comes from gh authentication")
    commands = p.add_subparsers(dest="command", required=True)
    for command in ["init", "status"]:
        commands.add_parser(command)
    h = commands.add_parser("handoff"); h.add_argument("--to", required=True); h.add_argument("--note", required=True)
    for command in ["check", "cost", "tokens"]:
        commands.add_parser(command).add_argument("--file", required=True)
    commands.add_parser("route")
    commands.add_parser("activate")
    commands.add_parser("publisher-input").add_argument('--operation')
    commands.add_parser("publication-capacity").add_argument('--file', required=True)
    for name in ('publication-plan', 'publication-begin'):
        command = commands.add_parser(name)
        command.add_argument('--product', required=True)
        command.add_argument('--workflow-head', required=True)
        if name.endswith('begin'):
            command.add_argument('--operation', required=True)
            command.add_argument('--quote', required=True)
    command = commands.add_parser('publication-upload')
    for name in ('operation', 'product', 'directory', 'packages', 'studio', 'studio-revision', 'harness'):
        command.add_argument('--' + name, required=True)
    for name in ('publication-dispatch', 'publication-observe'):
        command = commands.add_parser(name)
        command.add_argument('--operation', required=True)
        if name.endswith('observe'):
            command.add_argument('--phase', choices=['upload', 'dispatch', 'release'], required=True)
            command.add_argument('--harness')
    commands.add_parser("resolve-blocked").add_argument("--file", required=True)
    remediation_command = commands.add_parser('remediate')
    remediation_command.add_argument('--task', required=True)
    remediation_command.add_argument('--quote')
    remediation_command.add_argument('--plan', action='store_true')
    commands.add_parser("remediation-status").add_argument("--task", required=True)
    commands.add_parser("supersede").add_argument("--replacement", required=True)
    commands.add_parser("prepare").add_argument("--checkout", required=True)
    for command in ["build", "retry-build", "notes", "upload", "ticket", "testflight"]:
        c = commands.add_parser(command)
        c.add_argument("--operation", required=True)
        c.add_argument("--quote", required=True)
        c.add_argument("--plan", action="store_true", help="print exact request/digest; no writes or quote file read")
        if command in {"build", "testflight"}: c.add_argument("--checkout", required=True)
        if command == "retry-build":
            c.add_argument("--run", type=int, required=True); c.add_argument("--attempt", type=int, required=True)
        if command == "notes": c.add_argument("--file", required=True, help="JSON with name and body")
        if command == "upload": c.add_argument("--directory", required=True)
        if command == "ticket": c.add_argument("--check-id", required=True)
    commands.add_parser("reconcile").add_argument("--operation", required=True)
    resume = commands.add_parser("resume-upload")
    for key in ["operation", "quote", "directory"]: resume.add_argument("--" + key, required=True)
    resume.add_argument("--plan", action="store_true")
    commands.add_parser("collect").add_argument("--directory", required=True)
    commands.add_parser("report").add_argument("--directory", required=True)
    promotion = commands.add_parser("promote-check")
    for key in ["checkout", "engine-store", "engine-policy", "intent"]:
        promotion.add_argument("--" + key, required=True)
    return p


def main(argv=None, github=None, actions=None, identity=None):
    # Only clients constructed by this invocation own grants to revoke. Injected
    # transports remain the caller's responsibility, including on failure.
    with ExitStack() as cleanup:
        return _main(argv, github, actions, identity, cleanup)


def _main(argv, github, actions, identity, cleanup):
    a = parser().parse_args(argv)
    candidate, policy = read(a.candidate), policy_contract(read(a.policy))
    native = candidate.get("kind") == native_testflight.KIND
    require(native or a.command != "testflight", "testflight requires a native candidate")
    if native:
        # Reject malformed workflow/source identity before even reading account
        # attribution, loading the broker or contacting the coordination store.
        candidate_contract(candidate, policy)
        require(a.command in {"init", "status", "handoff", "check", "cost", "tokens", "prepare", "testflight", "reconcile"},
                "desktop RC command is not available for a native candidate")
    if a.local_state:
        require(a.actor, "rehearsal actor required")
        require(a.command in {"init", "status", "handoff", "check", "cost", "tokens", "route", "resolve-blocked", "supersede", "activate", "publisher-input", "publication-capacity"}, "offline rehearsal cannot execute external commands")
        store, actor = LocalGitStore(a.local_state, candidate), a.actor
    else:
        require(a.actor is None, "remote actor cannot be overridden")
        require(a.state_repo in policy["repositories"], "state repository outside policy")
        if native:
            actor = (identity or GitHub()).actor()  # Human credential: GET /user only.
            if github is None:
                github = NativeGitHub(policy["repositories"])
                cleanup.callback(github.close)
            if actions is None:
                actions = NativeGitHub([candidate["repository"]], actions=True)
                cleanup.callback(actions.close)
        else:
            github = github or GitHub()
            actor = github.actor()
        store = GitHubStore(github, a.state_repo, candidate)
    session = Session(store, policy, actor, candidate, github)
    if a.command == "init":
        if session.state:
            session.own()
            return {"status": "EXISTS", "revision": session.revision}
        return session.save(initial(candidate, policy, actor))
    require(session.state is not None, "initialize this candidate first")
    if a.command == "status":
        return {"state": session.state, "revision": session.revision, "committedUsd": str(committed_cost(session.state)), "automaticModelCalls": 0}
    if a.command in {"route", "resolve-blocked", "remediate", "remediation-status", "supersede", "activate", "publisher-input"} or a.command.startswith('publication-') and a.command != 'publication-capacity':
        # Resolvers do not gain release-owner authority. Their real authenticated
        # account is checked separately against the trusted resolver roster.
        if a.command == "resolve-blocked":
            authorize(session.state, policy, session.state['owner'])
        else:
            session.own()
        key = routing.registry_candidate(candidate)
        registry_store = LocalGitStore(a.local_state, key) if a.local_state else GitHubStore(github, a.state_repo, key)
        registry = routing.Registry(registry_store)
        if a.command.startswith('publication-'):
            require(a.state_repo == candidate['repository'], 'publisher CAS belongs to the product repository')
            import publication_service as pub
            if a.command == 'publication-plan':
                request = pub.execution_request(session.state, policy, registry, read(a.product), a.workflow_head)
                return {'kind': 'publish-pass', 'candidateDigest': session.state['candidateDigest'], 'request': request,
                        'requestDigest': digest({'kind': 'publish-pass', 'request': request})}
            if a.command == 'publication-begin':
                return pub.begin(session, registry, read(a.product), a.workflow_head, a.operation, read(a.quote))
            if a.command == 'publication-upload':
                require(next((key for key, op in session.state['operations'].items() if op['kind'] == 'publish-pass'
                              and op['status'] == 'UNKNOWN'), None) == a.operation, 'exact reserved publication operation required')
                verified = pub.studio_call(a.studio, a.studio_revision, 'verify',
                                          {'product': read(a.product), 'directory': a.directory, 'packages': a.packages})
                return pub.prepare_upload(session, registry, a.directory, verified['bundleDigest'], pub.PrivateGitHub(a.harness))
            if a.command == 'publication-dispatch': return pub.dispatch(session, registry, a.operation, github)
            if a.phase == 'upload':
                require(a.harness, 'canonical private App wrapper path required')
                return pub.observe_upload(session, a.operation, pub.PrivateGitHub(a.harness))
            if a.phase == 'dispatch': return pub.observe_dispatch(session, a.operation, github)
            return pub.observe_publication(session, a.operation, github)
        if a.command == 'activate':
            session.own()
            return registry.activate(session.state, policy)
        if a.command == 'publisher-input':
            return publisher.producer_input(session.state, policy, registry, a.operation)
        if a.command == 'supersede':
            return registry.supersede(session.state, candidate_contract(read(a.replacement), policy))
        if a.command == 'remediate':
            require(a.state_repo == candidate['repository'],
                    'initial live bridge coordinates sanitized state and fix issues in the same product repository; use one scoped App token and keep raw evidence private')
            from routing_service import remediate, execution_request, execution_allowance
            request = execution_request(session.state, policy, registry, a.task)
            kind, operation_id = 'release-remediation', 'remediate-' + a.task
            request_digest = digest({'kind': kind, 'request': request})
            if a.plan:
                return {'kind': kind, 'candidateDigest': session.state['candidateDigest'],
                        'request': request, 'requestDigest': request_digest,
                        'upperBoundUsd': execution_allowance(policy, registry.task(a.task))['upperBoundUsd']}
            operation = session.state['operations'].get(operation_id)
            if operation:
                require(operation['requestDigest'] == request_digest, 'remediation request changed; reconcile the original')
                if operation['status'] == 'DONE':
                    return {'duplicate': True, **operation['result']}
                require(operation['status'] == 'UNKNOWN', 'remediation operation requires reconciliation')
                result = remediate(session.state, policy, registry, github, a.task)
                session.save(settle(session.state, operation_id, 'DONE', result))
                return result
            require(a.quote, 'confirmed quote binding the exact remediation request required')
            return session.operation(operation_id, kind, request, read(a.quote),
                                     lambda: remediate(session.state, policy, registry, github, a.task))
        if a.command == 'remediation-status':
            from routing_service import reconcile_remediation
            return reconcile_remediation(session.state, policy, registry, a.task)
        transition = None
        if a.command == "resolve-blocked":
            answer = read(a.file)
            transition = lambda state: routing.resolve(state, policy, actor, answer)
        return registry.update(session.state, policy, transition)
    session.own()
    s = session.state
    if a.command == 'publication-capacity':
        capacity = read(a.file)
        require(set(capacity) == {'schema', 'events'} and capacity['schema'] == 'hps-release-capacity/1'
                and isinstance(capacity['events'], list) and 0 < len(capacity['events']) <= 100,
                'bounded existing-engine capacity events required')
        identifiers = set()
        from datetime import datetime
        for event in capacity['events']:
            require(isinstance(event, dict) and set(event) == {'id', 'type', 'data', 'at'}
                    and isinstance(event['id'], str) and event['id'] and event['id'] not in identifiers
                    and event['type'] in {'quota.observed', 'work.reserved', 'work.settled'}
                    and isinstance(event['data'], dict) and isinstance(event['at'], str)
                    and event['at'].endswith('Z'), 'attributed capacity event shape differs')
            require(datetime.fromisoformat(event['at'].replace('Z', '+00:00')).timestamp() > 0,
                    'capacity observation time required')
            identifiers.add(event['id'])
        require(not any(op['status'] == 'UNKNOWN' for op in s['operations'].values()),
                'reconcile the pending operation before changing publication capacity')
        return session.save({**s, 'publicationCapacity': copy.deepcopy(capacity)})
    if a.command == "handoff": return session.save(handoff(s, policy, actor, a.to, a.note))
    if a.command in {"check", "cost", "tokens"}:
        fn = {"check": record_check, "cost": record_cost, "tokens": record_tokens}[a.command]
        return session.save(fn(s, read(a.file)))
    if a.command == "prepare":
        if native:
            require(not any(op["status"] == "UNKNOWN" for op in s["operations"].values()), "reconcile unknown native operation before preparing again")
            result = native_testflight.prepare(github, actions, candidate, a.checkout)
            return session.save({**s, "preparation": {**result, "preparedAt": now()}})
        prs = source_prs(github, candidate, a.checkout)
        message = tag_message(candidate, a.checkout)
        return session.save({**s, "preparation": {"sourcePrs": prs, "tagMessage": message, "preparedAt": now()}})
    if a.command == "collect":
        require(s.get("preparation"), "prepare the candidate first")
        tag = observe_tag(github, candidate, s["preparation"]["tagMessage"])
        require(tag, "candidate tag not observed")
        result = collect(github, candidate, a.directory, tag["tagObject"])
        if s["artifacts"]:
            require(s["artifacts"] == result["artifacts"], "candidate packages changed; cut a new RC")
        if s.get('macSigning'):
            require(s['macSigning'] == result['macSigning'], 'Mac signing evidence changed; cut a new RC')
        return session.save({**s, **result})
    if a.command == "report":
        release = verify_remote_packages(github, s)
        return {"files": report(s, release, a.directory), "releaseUrl": release["html_url"], "publication": "NOT_RUN"}
    if a.command == "promote-check":
        remote = verify_remote_packages(github, s)
        macos_signing.verify_remote(github, s, remote)
        return engine_check(a.checkout, a.engine_store, a.engine_policy, a.intent, candidate, s["artifacts"])
    if a.command == "resume-upload":
        operation = s["operations"].get(a.operation)
        require(operation and operation["kind"] == "upload", "unknown support upload")
        if operation["status"] == "DONE": return operation["result"]
        request = operation["request"]
        # Verify local immutable bytes and remote packages before reserving recovery.
        from transport import file_hash
        for name, sha in request["files"].items():
            path = Path(a.directory) / name
            require(path.is_file() and not path.is_symlink() and file_hash(path) == sha, "original report bytes required for resume")
        verify_remote_packages(github, s)
        if a.plan:
            return {"kind": "upload", "candidateDigest": s["candidateDigest"], "request": request, "requestDigest": operation["requestDigest"], "resume": a.operation}
        session.save(resume_upload(s, policy, actor, a.operation, read(a.quote)))
        result = support_assets(github, session.state, request, a.directory)
        require(result is not None, "upload observation is incomplete; preserve UNKNOWN and reconcile when all assets are visible")
        return session.save(settle(session.state, a.operation, "DONE", result))
    if a.command == "reconcile":
        operation = s["operations"].get(a.operation)
        require(operation, "unknown operation")
        if operation["status"] == "DONE": return operation["result"]
        require(operation["status"] == "UNKNOWN", "only uncertain operations can be reconciled")
        kind, request = operation["kind"], operation["request"]
        result = None
        if native:
            require(kind == native_testflight.KIND, "unexpected native operation kind")
            result = native_testflight.observe(actions, request, operation["requestDigest"])
        elif kind == "build": result = observe_tag(github, candidate, request["message"])
        elif kind == "retry-build":
            run = github.api(f"repos/{candidate['repository']}/actions/runs/{request['runId']}")
            require(run["head_sha"] == candidate["sourceSha"] and run["head_branch"] == candidate["tag"], "run identity changed")
            if run["run_attempt"] > request["previousAttempt"]:
                result = {"runId": run["id"], "attempt": run["run_attempt"], "status": run["status"]}
        elif kind == "notes":
            release = verify_remote_packages(github, s)
            if all(release[k] == request[k] for k in ["name", "body"]):
                result = {"releaseId": release["id"], "releaseUrl": release["html_url"]}
        elif kind == "upload": result = support_assets(github, s, request)
        elif kind == "ticket": result = observe_ticket(github, candidate, request)
        require(result is not None, "UNKNOWN: no conclusive matching result; do not replay or hand off. Inspect provider records with the current owner")
        if native:
            return session.save(native_testflight.settle_upload(s, a.operation, result))
        return session.save(settle(s, a.operation, "DONE", result))
    if a.command == "testflight":
        require(s.get("preparation", {}).get("nativeGate"), "prepare exact native CI and source PRs first")
        request = native_testflight.request(candidate, a.operation, s["preparation"])
        fingerprint = digest({"kind": native_testflight.KIND, "request": request})
        if a.plan:
            return {"kind": native_testflight.KIND, "candidateDigest": s["candidateDigest"],
                    "request": request, "requestDigest": fingerprint}
        if a.operation not in s["operations"]:
            fresh = native_testflight.prepare(github, actions, candidate, a.checkout)
            require(native_testflight.request(candidate, a.operation, fresh) == request, "native CI changed; prepare and quote the new request")
        return session.operation(a.operation, native_testflight.KIND, request, read(a.quote),
                                 lambda: native_testflight.dispatch(github, actions, candidate, request, fingerprint))
    if a.command == "build":
        require(s.get("preparation"), "prepare explicit source PRs first")
        message = tag_message(candidate, a.checkout)
        require(message == s["preparation"]["tagMessage"], "prepared build contract changed")
        request = {"sourceSha": candidate["sourceSha"], "tag": candidate["tag"], "message": message,
                   "adapter": "github-tag-push", "workflows": ["build-mac.yml", "build-windows.yml"]}
        action = lambda: create_tag(github, candidate, message)
    elif a.command == "retry-build":
        require(s.get("preparation"), "prepare and verify managed build support before retrying")
        request = {"runId": a.run, "previousAttempt": a.attempt, "adapter": "github-rerun-failed-jobs"}
        def action():
            retry_failed_build(github, candidate, a.run, a.attempt, s["preparation"]["tagMessage"])
            # Provider accepted a retry, but the new attempt may not yet be observable.
            # Leave UNKNOWN until read-only reconciliation sees that attempt.
            raise Blocked("retry requested; reconcile this operation when run_attempt advances")
    elif a.command == "notes":
        metadata = read(a.file)
        require(set(metadata) == {"name", "body"} and all(isinstance(v, str) for v in metadata.values()), "notes file requires only name and body")
        release = verify_remote_packages(github, s)
        request = {**metadata, "releaseId": release["id"]}
        def action():
            verify_remote_packages(github, s)
            github.api(f"repos/{candidate['repository']}/releases/{release['id']}", "PATCH", metadata)
            refreshed = verify_remote_packages(github, s)
            require(all(refreshed[k] == request[k] for k in ["name", "body"]), "metadata differs from requested edit; reconcile before reporting completion")
            return {"releaseId": refreshed["id"], "releaseUrl": refreshed["html_url"]}
    elif a.command == "upload":
        release = verify_remote_packages(github, s)
        # Explicit report generation precedes this command. Never silently overwrite files.
        from transport import file_hash
        directory = Path(a.directory)
        manifest = json.loads((directory / "release-manifest.json").read_text())
        require(manifest["candidateDigest"] == s["candidateDigest"] and manifest["releaseUrl"] == release["html_url"] and manifest["revision"] == s["revision"], "report is stale; regenerate after metadata/state changes")
        names = ["RC-REPORT.html", "release-manifest.json", "SHA256SUMS.txt"]
        with tempfile.TemporaryDirectory(prefix="hype-report-verify-") as generated:
            expected_files = report(s, release, generated)
        require(all((directory / n).is_file() and not (directory / n).is_symlink() and file_hash(directory / n) == expected_files[n] for n in names), "support files do not match the current generated report")
        request = {"releaseId": release["id"], "releaseUrl": release["html_url"], "files": expected_files}
        action = lambda: support_assets(github, s, request, directory)
    elif a.command == "ticket":
        request = ticket_request(s, a.check_id)
        action = lambda: create_ticket(github, candidate, request)
    else: raise Blocked("unsupported command")
    if a.plan:
        return {"candidateDigest": s["candidateDigest"], "kind": a.command, "request": request,
                "requestDigest": digest({"kind": a.command, "request": request}), "quoteRequired": "confirmed incremental upper bound covering this whole request; never assume free quota"}
    return session.operation(a.operation, a.command, request, read(a.quote), action)


if __name__ == "__main__":
    try:
        print(json.dumps(main(), ensure_ascii=False, indent=2))
    except (Blocked, OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, Blocked) else "invalid input or unavailable dependency; inspect locally, preserve UNKNOWN operations"
        print(json.dumps({"status": "BLOCKED", "reason": message}), file=sys.stderr)
        raise SystemExit(2)
