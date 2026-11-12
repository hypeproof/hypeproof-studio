"""GitHub transport and compare-and-swap release state; no new service required."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import inspect
import re
import json
import os
import subprocess
import tempfile
import urllib.parse
import uuid
from pathlib import Path

from core import Blocked, canonical, candidate_state_key, digest, public_payload, repository, require


class ApiError(Blocked):
    def __init__(self, message, missing=False):
        super().__init__(message)
        self.missing = missing


class GitHub:
    def api(self, path, method="GET", data=None):
        args = ["gh", "api", "--method", method, path]
        if data is not None:
            args += ["--input", "-"]
        p = subprocess.run(args, input=None if data is None else canonical(data), text=True, encoding="utf-8", capture_output=True, timeout=90)
        if p.returncode:
            # Never echo credentials, payloads or raw remote error bodies.
            raise ApiError(f"GitHub {method} failed for {path.split('?')[0]}; reconcile before retrying a write", "HTTP 404" in p.stderr)
        return json.loads(p.stdout) if p.stdout.strip() else None

    def actor(self):
        if os.environ.get('HYPEPROOF_AGENT_WRITE_TOKEN_ACTIVE') == '1':
            # Installation tokens cannot GET /user. Read the existing member
            # login for attribution only; every mutation keeps this client's App
            # token. No personal credential is used for a write or exported.
            env = {k: v for k, v in os.environ.items() if k not in {'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'}}
            proc = subprocess.run(['gh', 'api', '--method', 'GET', 'user'], env=env,
                                  capture_output=True, text=True, encoding='utf-8', timeout=90)
            require(proc.returncode == 0, 'authenticated member attribution unavailable; preserve App-only writes and restore member read access')
            actor = json.loads(proc.stdout).get('login')
            require(isinstance(actor, str) and actor, 'authenticated member login unavailable')
            return actor
        return self.api("user")["login"]

    def upload(self, repo, release_id, path):
        path = Path(path)
        endpoint = f"https://uploads.github.com/repos/{repository(repo)}/releases/{int(release_id)}/assets?name={urllib.parse.quote(safe_name(path.name))}"
        p = subprocess.run(["gh", "api", "--method", "POST", endpoint, "-H", "Content-Type: application/octet-stream", "--input", str(path)], capture_output=True, text=True, encoding="utf-8", timeout=90)
        require(p.returncode == 0, "upload response uncertain: reconcile by filename and digest before retrying")
        return json.loads(p.stdout)

    def pages(self, path):
        page = 1
        while True:
            data = self.api(path + ("&" if "?" in path else "?") + f"per_page=100&page={page}")
            yield data
            if len(data) < 100:
                return
            page += 1

    def release(self, repo, tag):
        for page in self.pages(f"repos/{repository(repo)}/releases"):
            for item in page:
                if item["tag_name"] == tag:
                    return item
        raise ApiError("candidate release not found", True)

    def download(self, repo, asset, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        require(type(asset["id"]) is int, "numeric REST asset ID required")
        if destination.exists():
            verify_download(destination, asset)
            return
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as out:
                temp = Path(out.name)
                p = subprocess.run(["gh", "api", f"repos/{repository(repo)}/releases/assets/{asset['id']}",
                                    "-H", "Accept: application/octet-stream"], stdout=out, stderr=subprocess.PIPE, timeout=600)
                require(p.returncode == 0, "asset download failed; original destination preserved")
                out.flush()
            # Windows refuses unlinking an open temporary file. Close before
            # verification/linking while preserving exclusive destination creation.
            verify_download(temp, asset)
            os.link(temp, destination)
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)

    def artifact_zip(self, repo, artifact_id, destination):
        require(type(artifact_id) is int and artifact_id > 0, 'numeric Actions artifact ID required')
        with Path(destination).open('xb') as output:
            result = subprocess.run(['gh', 'api', f'repos/{repository(repo)}/actions/artifacts/{artifact_id}/zip'],
                                    stdout=output, stderr=subprocess.PIPE, timeout=600)
        require(result.returncode == 0, 'Actions artifact download failed; no release evidence accepted')


def load_native_broker():
    # Authentication code belongs to this same trusted Harness checkout. Neither
    # a candidate nor a CLI option can select another executable module. Installed
    # skill callers invoke the canonical release.py instead of mixing runtimes.
    module_path = Path(__file__).resolve().parents[1] / "agent-identity/agent-auth.py"
    require(module_path.is_file() and not module_path.is_symlink(),
            "native operations require the canonical Harness scripts/hype-release/release.py")
    spec = importlib.util.spec_from_file_location("hype_release_canonical_agent_auth", module_path)
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    return broker


class NativeGitHub(GitHub):
    """Native-only broker transport. Human identity is read separately, never written.

    Keep the legacy RC transport untouched. These instances have exactly one
    grant profile and refuse the other profile's endpoints before obtaining a token.
    """
    def __init__(self, repositories, *, actions=False):
        self.repositories = {repository(repo) for repo in repositories}
        self.actions = actions
        self.broker = load_native_broker()
        require("actions" in inspect.signature(self.broker.broker_token).parameters,
                "canonical agent-auth lacks Actions profile; adopt Harness #553, never fall back")

    def _environment(self, path, method):
        match = re.fullmatch(r"repos/(hypeproof/[A-Za-z0-9_.-]+)(/[^#]*)?", path)
        require(match and match[1] in self.repositories, "native request outside configured repositories")
        repo, suffix = match[1], (match[2] or "")
        if self.actions:
            allowed = (method == "GET" and suffix.startswith("/actions/")) or (
                method == "POST" and suffix == "/actions/workflows/studio-apple-testflight.yml/dispatches")
        else:
            allowed = (method == "GET" and (not suffix or suffix.startswith(("/git/", "/contents/", "/pulls/")))) or (
                method in {"POST", "PATCH"} and suffix.startswith("/git/"))
        require(allowed, "native endpoint does not match credential profile")
        try:
            token = self.broker.broker_token(repo, actions=True) if self.actions else self.broker.broker_token(repo)
        except Exception:
            raise Blocked("native broker authentication failed; no ambient credential fallback") from None
        env = {k: v for k, v in os.environ.items() if k not in {"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST", "GH_DEBUG"}}
        env.update(GH_TOKEN=token, GH_HOST="github.com", GH_PROMPT_DISABLED="1")
        return env

    def api(self, path, method="GET", data=None, *, binary=False):
        env = self._environment(path, method)
        args = ["gh", "api", "--method", method, path]
        if data is not None:
            args += ["--input", "-"]
        result = subprocess.run(args, input=None if data is None else canonical(data).encode(),
                                capture_output=True, env=env, timeout=90)
        if result.returncode:
            raise ApiError("native GitHub request failed; reconcile uncertain writes", b"HTTP 404" in result.stderr)
        require(len(result.stdout) <= 16 * 1024 * 1024, "native API response exceeds bound")
        return result.stdout if binary else (json.loads(result.stdout) if result.stdout.strip() else None)

    def artifact_zip(self, repo, artifact_id, destination):
        require(self.actions and type(artifact_id) is int and artifact_id > 0, "Actions artifact identity required")
        path = f"repos/{repository(repo)}/actions/artifacts/{artifact_id}/zip"
        env = self._environment(path, "GET")
        with Path(destination).open("xb") as output:
            result = subprocess.run(["gh", "api", path], stdout=output, stderr=subprocess.PIPE,
                                    env=env, timeout=180)
        require(result.returncode == 0 and 0 < Path(destination).stat().st_size <= 1024 ** 3,
                "native artifact download failed or exceeds bound")

    def actor(self):
        raise Blocked("human identity must be read separately from bot grant profiles")

    def upload(self, *args):
        raise Blocked("native profile cannot upload release assets")

    def download(self, *args):
        raise Blocked("native profile uses Actions artifacts only")


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_name(value):
    require(isinstance(value, str) and value not in {"", ".", ".."} and
            "/" not in value and "\\" not in value and not any(ord(c) < 32 for c in value), "unsafe asset filename")
    return value


def verify_download(path, asset):
    require(Path(path).is_file() and not Path(path).is_symlink(), "regular downloaded file required")
    require(Path(path).stat().st_size == asset["size"] and asset.get("digest") == "sha256:" + file_hash(path),
            "download differs from GitHub asset size/digest")


class GitHubStore:
    """One orphan branch per candidate, containing only sanitized state.json.

    Competing commits have the same parent. A non-forced ref update accepts only
    one; the other is not a fast-forward. No source branch or workflow is changed.
    This is coordination among authorized collaborators, not an ACL against repo admins.
    """
    def __init__(self, github, repo, candidate):
        self.github = github
        self.repo = repository(repo)
        self.branch = "ops/release-state/" + candidate_state_key(candidate)

    def read(self):
        try:
            ref = self.github.api(f"repos/{self.repo}/git/ref/heads/{self.branch}")
        except ApiError as error:
            if not error.missing:
                raise
            # A missing/unauthorized repository is not an empty state store.
            self.github.api(f"repos/{self.repo}")
            return None, None
        revision = ref["object"]["sha"]
        item = self.github.api(f"repos/{self.repo}/contents/state.json?ref={revision}")
        state = json.loads(base64.b64decode(item["content"]))
        return state, revision

    def write(self, state, expected):
        public_payload(state)
        current, revision = self.read()
        require(revision == expected, "STATE_CONFLICT: reload before acting")
        result = json.loads(canonical(state))
        result["revision"] = (current["revision"] + 1) if current else 1
        blob = self.github.api(f"repos/{self.repo}/git/blobs", "POST", {"content": canonical(result), "encoding": "utf-8"})
        tree = self.github.api(f"repos/{self.repo}/git/trees", "POST", {"tree": [{"path": "state.json", "mode": "100644", "type": "blob", "sha": blob["sha"]}]})
        # Even identical concurrent state writes must produce distinct sibling commits.
        commit = self.github.api(f"repos/{self.repo}/git/commits", "POST", {"message": "release: record candidate handoff state " + uuid.uuid4().hex, "tree": tree["sha"], "parents": [expected] if expected else []})
        if expected:
            self.github.api(f"repos/{self.repo}/git/refs/heads/{self.branch}", "PATCH", {"sha": commit["sha"], "force": False})
        else:
            self.github.api(f"repos/{self.repo}/git/refs", "POST", {"ref": "refs/heads/" + self.branch, "sha": commit["sha"]})
        return result, commit["sha"]


class LocalGitStore:
    """Offline rehearsal using a shared bare Git repo and real atomic update-ref."""
    def __init__(self, directory, candidate):
        self.directory = Path(directory).resolve()
        self.ref = "refs/heads/ops/release-state/" + candidate_state_key(candidate)
        if not self.directory.exists():
            subprocess.run(["git", "init", "--bare", "--quiet", str(self.directory)], check=True)
        require(self.git("rev-parse", "--is-bare-repository").strip() == "true", "rehearsal store must be a bare repository")

    def git(self, *args, data=None, check=True):
        env = {**os.environ, "GIT_AUTHOR_NAME": "Release rehearsal", "GIT_AUTHOR_EMAIL": "rehearsal@example.invalid",
               "GIT_COMMITTER_NAME": "Release rehearsal", "GIT_COMMITTER_EMAIL": "rehearsal@example.invalid"}
        # Git's mktree protocol needs literal LF; Windows text-mode pipes would
        # turn state.json\n into a filename ending in CR. Send UTF-8 bytes.
        p = subprocess.run(["git", "--git-dir", str(self.directory), *args],
                           input=None if data is None else data.encode("utf-8"), capture_output=True, env=env)
        if check and p.returncode:
            raise Blocked("STATE_CONFLICT or invalid local Git store")
        return p.stdout.decode("utf-8")

    def read(self):
        revision = self.git("rev-parse", "--verify", self.ref, check=False).strip()
        return (json.loads(self.git("show", revision + ":state.json")), revision) if revision else (None, None)

    def write(self, state, expected):
        public_payload(state)
        current, revision = self.read()
        require(revision == expected, "STATE_CONFLICT: reload before acting")
        result = json.loads(canonical(state))
        result["revision"] = (current["revision"] + 1) if current else 1
        blob = self.git("hash-object", "-w", "--stdin", data=canonical(result)).strip()
        tree = self.git("mktree", data=f"100644 blob {blob}\tstate.json\n").strip()
        parents = ["-p", expected] if expected else []
        commit = self.git("commit-tree", tree, *parents, data="release rehearsal\n").strip()
        self.git("update-ref", self.ref, commit, expected or "0" * 40)
        return result, commit
