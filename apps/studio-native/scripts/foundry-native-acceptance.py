#!/usr/bin/env python3
"""Trusted native verification recipe; not a Foundry runner or publisher (#3693)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time


NATIVE = Path("apps/studio-native")
CHANGE_ROOTS = tuple((NATIVE / relative).as_posix() + "/" for relative in (
    "ios/App", "ios/Sources", "ios/Tests", "ios/UITests", "android/app/src"))
# Shared by identity's post-build allowance and the pre-execution freshness gate.
GENERATED_BUILD_ROOTS = (
    "ios/.build", "ios/DerivedData", "ios/DerivedData-device", "ios/DerivedData-macos",
    "android/.gradle", "android/build", "android/app/build")
PRIVATE_SUFFIXES = {".p8", ".p12", ".pem", ".key", ".mobileprovision", ".keystore", ".jks"}
PLATFORMS = {
    "ios": {
        "script": "ios-verify.sh",
        "required": ["evidence/device-build.log", "evidence/simulator-test.log",
                     "evidence/native-iphone.png", "evidence/identity.txt",
                     "ios/DerivedData-device/Build/Products/Release-iphoneos/HPStudio.app"],
        "roots": ["evidence", "ios/DerivedData-device/Build/Products/Release-iphoneos/HPStudio.app"],
        "environment": "ios-simulator-and-unsigned-device-build",
    },
    "android": {
        "script": "android-verify.sh",
        "required": ["evidence/android/build.log", "evidence/android/identity.txt",
                     "evidence/android/install.log", "evidence/android/native-ui.log",
                     "evidence/android/screenshots", "android/app/build/outputs/apk/debug/app-debug.apk"],
        "roots": ["evidence/android", "android/app/build/outputs/apk/debug/app-debug.apk"],
        "environment": "android-disposable-emulator",
    },
    "macos": {
        "script": "macos-verify.sh",
        "required": ["evidence/macos/build.log", "evidence/macos/bundle-id.txt",
                     "evidence/macos/HP-Studio-macOS-unsigned.zip"],
        "roots": ["evidence/macos"],
        "environment": "unsigned-mac-catalyst-build-only",
    },
}


class Refused(ValueError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(root: Path, path: Path, *, missing: bool = False) -> Path:
    """Reject traversal, symlink aliases and special files before opening anything."""
    path = Path(os.path.abspath(path))
    try:
        parts = path.relative_to(root).parts
    except ValueError as exc:
        raise Refused("Path leaves the candidate workspace") from exc
    current = root
    for part in parts:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if missing:
                continue
            raise Refused("Required artifact is missing: " + str(path.relative_to(root)))
        if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise Refused("Symlink or special file refused: " + str(current.relative_to(root)))
    return path


def file_record(root: Path, path: Path) -> dict:
    path = safe_path(root, path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise Refused("Artifact must be a regular, unshared file")
        digest = hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        after = os.fstat(fd)
        current = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after) or identity(after) != identity(current):
            raise Refused("Artifact changed while hashing")
        return {"path": path.relative_to(root).as_posix(), "size": after.st_size,
                "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def git(workspace: Path, *args: str) -> bytes:
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_OPTIONAL_LOCKS="0")
    # Do not let a caller's alternate repository/index replace candidate identity.
    for key in list(env):
        if key in {"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
                   "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"} or key.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_")):
            del env[key]
    p = subprocess.run(["git", "-c", "core.hooksPath=" + os.devnull,
                        "-c", "core.fsmonitor=false", "-C", str(workspace), *args],
                       env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return p.stdout


def verify_native_index(workspace: Path) -> None:
    """Check actual native inputs, independent of Git's worktree/cache shortcuts."""
    flags = git(workspace, "ls-files", "-v", "-z").split(b"\0")
    if any(entry and (entry[:1].islower() or entry[:1] == b"S") for entry in flags):
        raise Refused("Candidate has assume-unchanged or skip-worktree index flags")
    # These are generated outputs, never trusted source. Acceptance separately
    # refuses stale platform outputs before running and inventories outputs after.
    generated = tuple(str(NATIVE / relative) + "/" for relative in (
        "evidence", "scripts/__pycache__", "tests/__pycache__", *GENERATED_BUILD_ROOTS))
    # Omit --exclude-standard deliberately: ignored files are still real inputs.
    for entry in git(workspace, "ls-files", "--others", "-z", "--", str(NATIVE)).split(b"\0"):
        if entry:
            name = os.fsdecode(entry)
            if not name.startswith(generated):
                raise Refused("Untracked or ignored native input: " + name)
    for entry in git(workspace, "ls-files", "--stage", "-z", "--", str(NATIVE)).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        mode, object_id, stage = metadata.split()
        name = os.fsdecode(raw_name)
        if stage != b"0" or mode not in (b"100644", b"100755"):
            raise Refused("Native input must be a resolved regular indexed file: " + name)
        path = safe_path(workspace, workspace / name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            actual_mode = b"100755" if before.st_mode & stat.S_IXUSR else b"100644"
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or mode != actual_mode:
                raise Refused("Native input mode differs from index: " + name)
            digest = hashlib.sha1(b"blob " + str(before.st_size).encode() + b"\0")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            after = os.fstat(fd)
            current = path.lstat()
            identity = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
            if identity(before) != identity(after) or identity(after) != identity(current):
                raise Refused("Native input changed while hashing: " + name)
            if digest.hexdigest().encode() != object_id:
                raise Refused("Native input bytes differ from index: " + name)
        finally:
            os.close(fd)


def source_identity(workspace: Path) -> dict:
    top = Path(git(workspace, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if top != workspace:
        raise Refused("Workspace must be the repository root")
    head = git(workspace, "rev-parse", "HEAD").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        raise Refused("Expected a full source commit")
    untracked = git(workspace, "ls-files", "--others", "--exclude-standard", "-z")
    unstaged = git(workspace, "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z")
    if untracked or unstaged:
        raise Refused("Candidate must have no untracked or unstaged source; stage the reviewed patch first")
    patch = git(workspace, "diff", "--cached", "--full-index", "--binary",
                "--no-ext-diff", "--no-textconv", "HEAD", "--")
    changed = [x.decode() for x in git(workspace, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD").split(b"\0") if x]
    for name in changed:
        if (not name.startswith(CHANGE_ROOTS) or Path(name).suffix.lower() in PRIVATE_SUFFIXES
                or Path(name).name.startswith(".env")):
            raise Refused("Reviewed patch exceeds native app/test scope or contains credential material")
        safe_path(workspace, workspace / name, missing=True)
    verify_native_index(workspace)
    return {"head": head, "candidate_tree": git(workspace, "write-tree").decode().strip(),
            "verified_worktree_scope": str(NATIVE),
            "patch_sha256": sha(patch), "patch_format": "git diff --cached --full-index --binary HEAD",
            "dirty": bool(changed), "changed_paths": changed}


def adb_environment() -> dict[str, str]:
    """Preserve explicit local runner routing; never silently replace it with 5037.

    Address validation does not prove server ownership; the caller owns that gate.
    Unsupported address/socket forms fail closed before any subprocess starts.
    """
    if "ANDROID_ADB_SERVER_ADDRESS" in os.environ:
        raise Refused("Unsupported ANDROID_ADB_SERVER_ADDRESS; use a loopback ADB_SERVER_SOCKET")
    result = {}
    socket_port = None
    if "ADB_SERVER_SOCKET" in os.environ:
        value = os.environ["ADB_SERVER_SOCKET"]
        match = re.fullmatch(r"tcp:(127\.0\.0\.1|localhost):([0-9]{1,5})", value)
        if not match or not 1 <= int(match[2]) <= 65535:
            raise Refused("ADB_SERVER_SOCKET must be tcp:127.0.0.1:PORT or tcp:localhost:PORT")
        socket_port = int(match[2])
        result["ADB_SERVER_SOCKET"] = value
    if "ANDROID_ADB_SERVER_PORT" in os.environ:
        value = os.environ["ANDROID_ADB_SERVER_PORT"]
        if not re.fullmatch(r"[0-9]{1,5}", value) or not 1 <= int(value) <= 65535:
            raise Refused("ANDROID_ADB_SERVER_PORT must be a port from 1 through 65535")
        if socket_port is not None and socket_port != int(value):
            raise Refused("Conflicting ADB server socket and port")
        result["ANDROID_ADB_SERVER_PORT"] = value
    return result


def invoke(argv: list[str], workspace: Path, log: Path, timeout: int) -> dict:
    """No resource wrapper here: Foundry already holds local_heavy for this command."""
    env = {k: v for k, v in os.environ.items() if k in {
        "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "JAVA_HOME", "ANDROID_HOME",
        "ANDROID_SDK_ROOT", "ANDROID_SERIAL", "GRADLE_USER_HOME", "DEVELOPER_DIR"}}
    env.update(adb_environment())
    start = time.monotonic()
    with log.open("xb") as stream:
        process = subprocess.Popen(argv, cwd=workspace, env=env, stdout=stream,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        interrupted = []
        def stop(signum, _frame):
            interrupted.append(signum)
            raise KeyboardInterrupt
        old_handlers = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            code = process.wait(timeout=timeout)
            return {"exit_code": code, "timed_out": False,
                    "elapsed_seconds": round(time.monotonic() - start, 3)}
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            # Signal only the group created by this invocation, never peers.
            for sig in old_handlers:
                signal.signal(sig, signal.SIG_IGN)
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            # The shell can exit before a compiler child. Reap its owned group too.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            return {"exit_code": 128 + interrupted[0] if interrupted else 124,
                    "timed_out": not interrupted,
                    "elapsed_seconds": round(time.monotonic() - start, 3)}
        finally:
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)


def collect(workspace: Path, roots: list[str]) -> list[dict]:
    files = []
    for relative in roots:
        root = workspace / NATIVE / relative
        if not root.exists() and not root.is_symlink():
            continue
        safe_path(workspace, root)
        paths = [root] if root.is_file() else sorted(root.rglob("*"))
        for path in paths:
            safe_path(workspace, path)
            if path.is_file():
                files.append(file_record(workspace, path))
                if len(files) > 10000:
                    raise Refused("Artifact inventory exceeds 10000 files")
    return files


def accept(workspace: Path, platform: str, expected_source: str | None = None,
           expected_patch: str | None = None, expected_script: str | None = None,
           timeout: int = 1800) -> tuple[int, dict]:
    workspace = Path(os.path.abspath(workspace))
    if workspace.resolve() != workspace:
        raise Refused("Workspace aliases are not accepted")
    spec = PLATFORMS[platform]
    output = safe_path(workspace, workspace / NATIVE / "evidence" / "foundry" / platform, missing=True)
    output.mkdir(parents=True, exist_ok=False)  # never overwrite or silently rerun
    receipt = {"schema": "hps-native-acceptance/1", "platform": platform,
               "verdict": "BLOCKED", "environment": spec["environment"],
               "actual_foundry_execution": "NOT_RUN", "foundry_binding": {
                   "status": "AWAITING_RUNNER_RECEIPT", "versions": None,
                   "rule": "Bind this file's bytes through the runner manifest and final receipt; do not infer pins here"},
               "deployment": "NOT_RUN", "upload": "NOT_RUN", "tester_availability": "NOT_RUN",
               "physical_device": "NOT_RUN", "human_acceptance": "NOT_RUN",
               "cost": {"status": "UNKNOWN"}, "artifacts": [], "command": None}
    code = 2
    try:
        before = source_identity(workspace)
        receipt["source"] = before
        if expected_source is not None and (not re.fullmatch(r"[0-9a-f]{40}", expected_source) or before["head"] != expected_source):
            raise Refused("Source SHA mismatch")
        if expected_patch is not None and (not re.fullmatch(r"[0-9a-f]{64}", expected_patch) or before["patch_sha256"] != expected_patch):
            raise Refused("Full-index patch SHA256 mismatch")
        if before["dirty"] and expected_patch is None:
            raise Refused("A staged candidate requires its reviewed patch SHA256")
        script = workspace / NATIVE / "scripts" / spec["script"]
        receipt["recipe"] = file_record(workspace, script)
        if expected_script is not None and receipt["recipe"]["sha256"] != expected_script:
            raise Refused("Platform recipe SHA256 mismatch")
        # Refuse stale outputs, including symlinks, without deleting owner data.
        # Every identity-exempt build root must be absent, including its ancestors
        # being symlinks. No cached build tree is trusted merely because ignored.
        stale_roots = list(GENERATED_BUILD_ROOTS) + (spec["roots"] if platform != "ios" else [])
        for relative in stale_roots:
            path = safe_path(workspace, workspace / NATIVE / relative, missing=True)
            if path.exists() or path.is_symlink():
                raise Refused("Use a fresh candidate: existing output " + relative)
        if platform == "ios":
            entries = list((workspace / NATIVE / "evidence").iterdir())
            if any(p.name != "foundry" for p in entries):
                raise Refused("Use a fresh candidate: existing iOS evidence")
        if platform == "android" and not re.fullmatch(r"emulator-[0-9]+", os.environ.get("ANDROID_SERIAL", "")):
            raise Refused("ANDROID_SERIAL must select a disposable emulator")
        argv = ["/bin/bash", str(script)]
        log = output / "command.log"
        receipt["command"] = {"id": "native-preview-" + platform,
                              "argv": ["/bin/bash", str(NATIVE / "scripts" / spec["script"])],
                              "exit_code": None, "status": "STARTING"}
        receipt["command"].update(invoke(argv, workspace, log, timeout), status="COMPLETED")
        receipt["command"]["log"] = file_record(workspace, log)
        code = receipt["command"]["exit_code"]
        receipt["verdict"] = "FAIL"
        # Exclude our own pending output from the iOS evidence inventory.
        roots = spec["roots"] if platform != "ios" else [
            str(p.relative_to(workspace / NATIVE)) for p in (workspace / NATIVE / "evidence").iterdir() if p.name != "foundry"
        ] + [spec["required"][-1]]
        receipt["artifacts"] = collect(workspace, roots)
        after = source_identity(workspace)
        if after != before or file_record(workspace, script) != receipt["recipe"]:
            raise Refused("Source or recipe changed during verification")
        if code == 0:
            for relative in spec["required"]:
                path = safe_path(workspace, workspace / NATIVE / relative)
                if (path.is_file() and path.stat().st_size == 0) or (path.is_dir() and not any(x.is_file() for x in path.rglob("*"))):
                    raise Refused("Required artifact is empty: " + relative)
            receipt["verdict"] = "PASS"
    except (Refused, OSError, subprocess.SubprocessError) as exc:
        receipt["reason"] = str(exc)
        code = code if code else 2
        if receipt["command"] is not None:
            receipt["verdict"] = "FAIL"
            if "log" not in receipt["command"]:
                try:
                    receipt["command"]["log"] = file_record(workspace, output / "command.log")
                except (Refused, OSError):
                    receipt["command"]["log_status"] = "UNAVAILABLE_OR_UNSAFE"
    finally:
        # The receipt is an immutable artifact, not an approval or deployment.
        safe_path(workspace, output)
        with (output / "foundry-native-acceptance.json").open("x") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    return code, receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--expected-patch-sha256")
    parser.add_argument("--expected-script-sha256")
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800:
        parser.error("timeout must be 1..1800 seconds")
    try:
        code, receipt = accept(args.workspace, args.platform, args.expected_source_sha,
                               args.expected_patch_sha256, args.expected_script_sha256, args.timeout)
    except (Refused, OSError) as exc:
        parser.exit(2, str(exc) + "\n")
    print(json.dumps({"schema": receipt["schema"], "verdict": receipt["verdict"],
                      "actual_foundry_execution": "NOT_RUN"}))
    return code if 0 <= code <= 255 else 1


if __name__ == "__main__":
    raise SystemExit(main())
