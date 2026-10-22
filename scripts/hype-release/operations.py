"""Product adapters: explicit PRs, managed candidate tags, receipts and reports."""
from __future__ import annotations

import html
import json
import re
import subprocess
import tempfile
from pathlib import Path

from core import Blocked, canonical, committed_cost, digest, public_payload, require
from transport import ApiError, file_hash, safe_name


def product_checkout(path, candidate):
    path = Path(path).resolve()
    def git(*args):
        return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()
    require(git("rev-parse", "HEAD") == candidate["sourceSha"], "product checkout must be at exact candidate SHA")
    require(not git("status", "--porcelain", "--untracked-files=no"), "product checkout has tracked changes")
    remote = git("remote", "get-url", "origin")
    repo = candidate["repository"]
    require(remote in {f"https://github.com/{repo}", f"https://github.com/{repo}.git", f"git@github.com:{repo}.git"}, "product origin differs from candidate repository")
    return path


def source_prs(github, candidate, checkout):
    checkout = product_checkout(checkout, candidate)
    result = []
    for number in candidate["sourcePrs"]:
        pr = github.api(f"repos/{candidate['repository']}/pulls/{number}")
        require(pr["base"]["repo"]["full_name"] == candidate["repository"], "PR belongs to another repository")
        commits = [pr["head"]["sha"]]
        if pr.get("merged") and pr.get("merge_commit_sha"):
            commits.append(pr["merge_commit_sha"])
        included = [sha for sha in commits if subprocess.run(["git", "-C", str(checkout), "merge-base", "--is-ancestor", sha, candidate["sourceSha"]], capture_output=True).returncode == 0]
        require(included, f"PR #{number} is not included in the exact candidate; never infer a PR from an issue-like commit subject")
        result.append({"number": number, "includedCommit": included[0], "url": pr["html_url"]})
    return result


def tag_message(candidate, checkout):
    checkout = product_checkout(checkout, candidate)
    module = checkout / "scripts/release/build-contract.mjs"
    require(module.is_file(), "candidate lacks the existing managed build contract")
    plan = {"candidate": candidate["sourceSha"], "version": candidate["version"], "rcTag": candidate["tag"]}
    js = "import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[1])); const p=JSON.parse(process.argv[2]); m.assertManagedCandidateSupport(p.candidate); console.log(m.buildTagMessage(p,{managedDraft:true}));"
    p = subprocess.run(["node", "--input-type=module", "-e", js, str(module), canonical(plan)], cwd=checkout, text=True, capture_output=True)
    require(p.returncode == 0, "candidate build contract refused managed draft support")
    message = p.stdout.strip()
    require(message.startswith("hps-managed-draft/1\n"), "unexpected product build contract")
    return message


def observe_tag(github, candidate, expected_message):
    repo, tag = candidate["repository"], candidate["tag"]
    try:
        ref = github.api(f"repos/{repo}/git/ref/tags/{tag}")
    except ApiError as error:
        if error.missing:
            github.api(f"repos/{repo}")
            return None
        raise
    require(ref["object"]["type"] == "tag", "managed candidate tag is not annotated")
    annotation = github.api(f"repos/{repo}/git/tags/{ref['object']['sha']}")
    require(annotation["object"]["sha"] == candidate["sourceSha"] and annotation["object"]["type"] == "commit", "candidate tag moved")
    require(annotation["message"].strip() == expected_message.strip(), "candidate tag annotation changed")
    return {"tagObject": ref["object"]["sha"], "sourceSha": candidate["sourceSha"], "trigger": "tag-push-only"}


def create_tag(github, candidate, message):
    existing = observe_tag(github, candidate, message)
    if existing:
        return existing
    repo = candidate["repository"]
    tag = github.api(f"repos/{repo}/git/tags", "POST", {"tag": candidate["tag"], "message": message,
                         "object": candidate["sourceSha"], "type": "commit"})
    # Ref creation is exclusive. An ambiguous response is reconciled with observe_tag,
    # never followed by a second dispatch. Annotation creation alone cannot run builds.
    github.api(f"repos/{repo}/git/refs", "POST", {"ref": "refs/tags/" + candidate["tag"], "sha": tag["sha"]})
    return observe_tag(github, candidate, message)


def build_runs(github, candidate):
    result = {}
    for platform, workflow in [("darwin-arm64", "build-mac.yml"), ("win32-x64", "build-windows.yml")]:
        query = f"repos/{candidate['repository']}/actions/workflows/{workflow}/runs?head_sha={candidate['sourceSha']}&per_page=100"
        runs = github.api(query)["workflow_runs"]
        matches = [r for r in runs if r["head_sha"] == candidate["sourceSha"] and r.get("head_branch") == candidate["tag"] and r.get("event") in {"push", "workflow_dispatch"}]
        require(len(matches) <= 1, f"multiple {platform} build runs: reconcile explicitly; do not choose the latest blindly")
        if matches:
            row = matches[0]
            result[platform] = {k: row[k] for k in ["id", "status", "conclusion", "html_url", "run_attempt"]}
        else:
            result[platform] = {"status": "NOT_OBSERVED", "conclusion": None}
    return result


def retry_failed_build(github, candidate, run_id, expected_attempt, expected_message):
    require(observe_tag(github, candidate, expected_message), "managed candidate tag is missing")
    run = github.api(f"repos/{candidate['repository']}/actions/runs/{run_id}")
    require(run["head_sha"] == candidate["sourceSha"] and run["head_branch"] == candidate["tag"], "run belongs to another candidate")
    require(run["path"] in {".github/workflows/build-mac.yml", ".github/workflows/build-windows.yml"}, "not a permitted product build")
    require(run["run_attempt"] == expected_attempt and run["status"] == "completed" and run["conclusion"] in {"failure", "cancelled", "timed_out"}, "only the observed failed build attempt may be retried")
    github.api(f"repos/{candidate['repository']}/actions/runs/{run_id}/rerun-failed-jobs", "POST")
    return {"runId": run_id, "previousAttempt": expected_attempt, "status": "REQUESTED"}


def collect(github, candidate, directory, tag_object):
    directory = Path(directory).resolve()
    runs = build_runs(github, candidate)
    require(all(r.get("conclusion") == "success" and r["status"] == "completed" for r in runs.values()), "both exact candidate builds must complete successfully")
    release = github.release(candidate["repository"], candidate["tag"])
    require(release["draft"] and release["prerelease"], "only a draft prerelease may be collected")
    assets = release["assets"]
    require(len({a["name"] for a in assets}) == len(assets), "ambiguous release filenames")
    result = []
    for platform, roles in [("darwin-arm64", {"mac-zip"}), ("win32-x64", {"win-portable", "win-user", "win-system"})]:
        receipt_name = f"draft-build-{platform}.json"
        receipts = [a for a in assets if a["name"] == receipt_name]
        require(len(receipts) == 1, "missing candidate build receipt")
        github.download(candidate["repository"], receipts[0], directory / receipt_name)
        receipt = json.loads((directory / receipt_name).read_text())
        require(receipt.get("schema") == "hps-draft-build/1" and receipt.get("platform") == platform, "wrong receipt schema/platform")
        require(receipt.get("sourceSha") == candidate["sourceSha"] and receipt.get("publicationTag") == candidate["tag"] and receipt.get("publicationTagObject") == tag_object, "receipt candidate identity mismatch")
        version = candidate["version"][1:]
        require(receipt.get("managedDraft") is True and receipt.get("autoAcceptance") is False and receipt.get("releaseVersion") == version, "receipt does not describe a managed draft")
        require(receipt.get("app") == {"version": version, "sha": candidate["sourceSha"], "name": "HypeProof Studio", "extensionVersion": version}, "bundled app identity mismatch")
        require({a["id"] for a in receipt["assets"]} == roles and len(receipt["assets"]) == len(roles), "incomplete platform package set")
        for built in receipt["assets"]:
            safe_name(built["name"])
            require(re.fullmatch(r"[a-f0-9]{64}", built.get("sha256", "")) and type(built.get("size")) is int and built["size"] > 0, "invalid package identity")
            matches = [a for a in assets if a.get("digest") == "sha256:" + built["sha256"] and a["size"] == built["size"]]
            require(len(matches) == 1, "missing/ambiguous uploaded bytes for package role")
            asset = matches[0]
            name = safe_name(asset["name"])
            require(name.endswith((".zip", ".exe")), "package role matched a non-package upload")
            github.download(candidate["repository"], asset, directory / name)
            result.append({**built, "name": name, "buildName": built["name"], "assetId": asset["id"], "platform": platform})
    require(len({a["assetId"] for a in result}) == 4, "package roles must bind distinct uploaded assets")
    return {"artifacts": result, "builds": runs, "releaseId": release["id"], "releaseUrl": release["html_url"]}


def verify_remote_packages(github, state):
    c = state["candidate"]
    release = github.api(f"repos/{c['repository']}/releases/{state['releaseId']}")
    require(release["tag_name"] == c["tag"] and release["draft"] and release["prerelease"], "candidate draft state changed")
    for artifact in state["artifacts"]:
        matches = [a for a in release["assets"] if a["id"] == artifact["assetId"]]
        require(len(matches) == 1 and matches[0]["name"] == artifact["name"] and matches[0].get("digest") == "sha256:" + artifact["sha256"] and matches[0]["size"] == artifact["size"], "candidate package replaced or missing")
    return release


def report(state, release, directory):
    """Generate all public documents from the same sanitized state snapshot."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    c = state["candidate"]
    require(release["html_url"].startswith(f"https://github.com/{c['repository']}/releases/"), "unexpected release URL")
    manifest = {k: state[k] for k in ["candidate", "candidateDigest", "owner", "revision", "artifacts", "checks", "costs", "stablePublished", "humanAcceptance"]}
    manifest.update(schema="hype-release-report/1", releaseId=release["id"], releaseUrl=release["html_url"],
                    reservedOrObservedUsd=str(committed_cost(state)), tokenUsage=state.get("tokenUsage", []), automaticModelCalls=0,
                    builds=state.get("builds", {}), reportScope="RC test delivery; not stable publication or human acceptance")
    manifest_text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    (directory / "release-manifest.json").write_text(manifest_text)
    escape = lambda x: html.escape(str(x))
    changes = "".join(f"<tr><td>{escape(x['before'])}</td><td>{escape(x['after'])}</td></tr>" for x in c["changes"])
    checks = "".join(f"<tr><td>{escape(k)}</td><td>{escape(v['verdict'])}</td><td>{escape(v['observed'])}</td></tr>" for k, v in state["checks"].items()) or '<tr><td colspan="3">NOT_RUN — no package/user-flow verdict supplied.</td></tr>'
    packages = "".join(f"<tr><td>{escape(a['name'])}</td><td>{a['size']}</td><td><code>{a['sha256']}</code></td></tr>" for a in state["artifacts"])
    content = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{escape(c['tag'])} · RC 보고서</title><style>body{{font:16px/1.7 system-ui;margin:40px auto;padding:0 24px;max-width:1000px;color:#202b2b}}h1,h2{{line-height:1.3}}table{{width:100%;border-collapse:collapse;margin:20px 0}}td,th{{padding:12px;text-align:left;border-bottom:1px solid #ddd;overflow-wrap:anywhere}}code{{font-size:12px}}.note{{padding:18px;background:#eef5f1}}a{{color:#155d4f}}@media(max-width:600px){{body{{padding:0 12px}}td,th{{padding:6px}}}}</style><main><p>HYPEPROOF · RC TEST DELIVERY</p><h1>{escape(c['tag'])}</h1><p class="note">테스트용 초안입니다. 빌드 성공은 실제 기기·사용자 수락을 의미하지 않습니다. 정식 공개: {escape(state['stablePublished'])}, 사용자 수락: {escape(state['humanAcceptance'])}</p><p><a href="{escape(release['html_url'])}">RC 다운로드</a> · 담당자 {escape(state['owner'])}</p><h2>Before → After</h2><table><tr><th>Before</th><th>After</th></tr>{changes}</table><h2>검증 결과</h2><table><tr><th>검사</th><th>판정</th><th>관측 결과</th></tr>{checks}</table><h2>복구·테스트</h2><p>{escape(c['rollback'])}</p><p>기존 설치와 분리한 프로필에서 입력·전송·중지·재시도·출처 복귀·작업 전환·재시작을 확인하세요. 지원되는 실계정 환경에서만 검색·모델 호출을 시험하세요.</p><h2>파일 식별</h2><p>소스 {escape(c['sourceSha'])} · 앱 버전 {escape(c['version'])}</p><table><tr><th>파일</th><th>바이트</th><th>SHA-256</th></tr>{packages}</table><h2>비용</h2><p>예상 예약액, 보고된 금액, 최종 정산은 별도 기록입니다. 저장소 당일 청구액을 이 실행의 최종 비용으로 간주하지 않습니다.</p><pre style="white-space:pre-wrap">{escape(json.dumps(state['costs'],ensure_ascii=False,indent=2))}</pre></main></html>'''
    (directory / "RC-REPORT.html").write_text(content)
    sums = [(a["name"], a["sha256"]) for a in state["artifacts"]]
    sums += [(name, file_hash(directory / name)) for name in ["RC-REPORT.html", "release-manifest.json"]]
    (directory / "SHA256SUMS.txt").write_text("".join(f"{sha}  {name}\n" for name, sha in sorted(sums)))
    return {name: file_hash(directory / name) for name in ["RC-REPORT.html", "release-manifest.json", "SHA256SUMS.txt"]}


def engine_check(checkout, store, policy, intent, candidate, artifacts):
    """Invoke existing signed approval/readiness checks. Never manufacture approval."""
    checkout = product_checkout(checkout, candidate)
    module = checkout / "scripts/release/engine/cli.mjs"
    require(module.is_file(), "existing product release engine is unavailable")
    document = json.loads(Path(intent).read_text())
    require(document.get("candidate") == candidate["sourceSha"] and document.get("rcTag") == candidate["tag"], "intent is for another candidate")
    identities = lambda rows: sorted((a["id"], a["sha256"], a["size"]) for a in rows)
    require(artifacts and identities(document["manifest"]["artifacts"]) == identities(artifacts), "intent packages differ from collected release bytes")
    command = ["node", str(module), "check-intent", "--store", str(Path(store).resolve()), "--policy", str(Path(policy).resolve()),
               "--intent", str(Path(intent).resolve()), "--tag", candidate["version"], "--sha", candidate["sourceSha"]]
    p = subprocess.run(command, text=True, capture_output=True, cwd=checkout)
    require(p.returncode == 0, "product engine refuses current signed promotion intent; see its local diagnostics")
    value = json.loads(p.stdout)
    require(value.get("status") == "READY_FOR_PUBLISHER" and value.get("candidate") == candidate["sourceSha"] and value.get("tag") == candidate["version"], "product engine did not validate this candidate")
    return {"engineStatus": value, "intentDigest": file_hash(intent), "publication": "NOT_RUN",
            "next": "Use the repository-authorized publisher; it must rerun check-intent immediately before publication. This report is not publication authority."}


def support_assets(github, state, request, directory=None):
    release = verify_remote_packages(github, state)
    require(release["html_url"] == request["releaseUrl"], "draft URL changed: regenerate the report before upload")
    expected = request["files"]
    require(set(expected) == {"RC-REPORT.html", "release-manifest.json", "SHA256SUMS.txt"}, "only generated support documents may be uploaded")
    for name, sha in expected.items():
        matches = [a for a in release["assets"] if a["name"] == name]
        require(len(matches) <= 1, "ambiguous support filename")
        if matches:
            require(matches[0].get("digest") == "sha256:" + sha, "support asset differs; preserve existing files and use a fresh candidate")
        elif directory is not None:
            path = Path(directory) / name
            require(path.is_file() and not path.is_symlink() and file_hash(path) == sha, "report changed since reservation")
            github.upload(state["candidate"]["repository"], release["id"], path)
        else:
            return None
    if directory is not None:
        return support_assets(github, state, request)
    return {"releaseId": release["id"], "releaseUrl": release["html_url"], "files": expected}


def ticket_request(state, check_id):
    check = state["checks"].get(check_id)
    require(check and check["verdict"] in {"FAIL", "BLOCKED"}, "a recorded failure or blocker is required")
    classification = "bug" if check["verdict"] == "FAIL" else "environment-or-access"
    marker = "<!-- hype-release-failure:" + digest({"candidate": state["candidateDigest"], "check": check_id, "identity": check["identityKey"]}) + " -->"
    return public_payload({"title": f"release({classification}): {check_id} {state['candidate']['tag']}",
            "body": f"{marker}\n\nCandidate: {state['candidate']['sourceSha']}\nCheck: {check_id}\nVerdict: {check['verdict']}\nExpected: {check['expected']}\nObserved: {check['observed']}\nEvidence: {check['evidence']}\n\nClassification: {classification}. Preserve the acceptance criteria; this ticket is not permission to waive a failed test.", "marker": marker})


def observe_ticket(github, candidate, request):
    matches = []
    for page in github.pages(f"repos/{candidate['repository']}/issues?state=all"):
        matches += [i for i in page if "pull_request" not in i and request["marker"] in (i.get("body") or "")]
    require(len(matches) <= 1, "multiple failure tickets need explicit reconciliation")
    return {"number": matches[0]["number"], "url": matches[0]["html_url"]} if matches else None


def create_ticket(github, candidate, request):
    existing = observe_ticket(github, candidate, request)
    if existing:
        return existing
    issue = github.api(f"repos/{candidate['repository']}/issues", "POST", {"title": request["title"], "body": request["body"]})
    return {"number": issue["number"], "url": issue["html_url"]}
