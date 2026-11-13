#!/usr/bin/env python3
"""Fail-closed Developer ID release signing for the existing full/repack app.

Only Apple tools perform signing/assessment. No ad-hoc or self-signed fallback.
Evidence files are exclusive-create checkpoints, not mutable success flags.
See docs/dev/macos-developer-id.md for credentials and interrupted submissions.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
ENTITLEMENTS = ROOT / "scripts/release/macos-entitlements"
ASSET = "HypeProof-Studio-darwin-arm64.zip"
RECEIPT = "HypeProof-Studio-darwin-arm64.signing.json"
SCHEMA = "hps-macos-release-signing/v1"


class SigningError(RuntimeError):
    pass


def run(*args, timeout=180):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                            timeout=timeout, check=False)
    if result.returncode:
        raise SigningError(f"{args[0]} {args[1]} failed ({result.returncode}): "
                           f"{result.stderr.strip() or result.stdout.strip()}")
    return result.stdout + result.stderr


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_once(path, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    # Never overwrite accepted/submitted bytes or a previous receipt.
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def tree_hash(app):
    digest = hashlib.sha256()
    for path in sorted(app.rglob("*")):
        if path.is_symlink():
            value = [str(path.relative_to(app)), "symlink", os.readlink(path)]
        elif path.is_file():
            value = [str(path.relative_to(app)), "file", path.stat().st_mode & 0o777, sha256(path)]
        else:
            continue
        digest.update(json.dumps(value, separators=(",", ":")).encode() + b"\n")
    return digest.hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def requirement(team):
    # Apple TN3127: Developer ID Application leaf, not Installer/App Store.
    return ('anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists '
            'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists '
            f'and certificate leaf[subject.OU] = "{team}"')


@contextmanager
def signing_keychain(args):
    # --keychain selects the identity, but codesign resolves its certificate
    # chain through the user search list (codesign(1), --keychain).
    keychain = str(Path(args.keychain).resolve())
    def search_list():
        return shlex.split(run("security", "list-keychains", "-d", "user"))
    original = search_list()
    if keychain in original:
        yield
        return
    def interrupted(number, _frame):
        raise SystemExit(128 + number)
    handlers = {s: signal.signal(s, interrupted) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        run("security", "list-keychains", "-d", "user", "-s", keychain, *original)
        if search_list() != [keychain, *original]:
            raise SigningError("signing keychain search-list update could not be verified")
        yield
    finally:
        try:
            # Never replay a stale snapshot over a concurrent writer's changes.
            # With no concurrent changes this restores the exact original list.
            current = search_list()
            if keychain in current:
                remaining = [p for p in current if p != keychain]
                run("security", "list-keychains", "-d", "user", "-s", *remaining)
                if search_list() != remaining:
                    raise SigningError("signing keychain search-list cleanup could not be verified")
        finally:
            for number, handler in handlers.items():
                signal.signal(number, handler)


def sign_code(path, args, policy=None):
    command = ["codesign", "--force", "--sign", args.identity, "--keychain", args.keychain,
               "--options", "runtime", "--timestamp"]
    if policy:
        command += ["--entitlements", policy]
    run(*command, path)


def validate_signing_inputs(args):
    if sys.platform != "darwin":
        raise SigningError("Developer ID signing requires macOS")
    if not re.fullmatch(r"[A-Fa-f0-9]{40}", args.identity or ""):
        raise SigningError("explicit Developer ID Application SHA-1 required; no ad-hoc fallback")
    if not re.fullmatch(r"[A-Z0-9]{10}", args.team_id or ""):
        raise SigningError("explicit ten-character Apple Team ID required")
    if not args.keychain or not Path(args.keychain).is_file() or not args.notary_profile:
        raise SigningError("an existing isolated keychain and notary profile are required")


def notary_preflight(args):
    # Resume needs only the existing signatures and notary credentials. It must
    # not exercise a private signing key or change the keychain search list.
    validate_signing_inputs(args)
    for tool in ("notarytool", "stapler"):
        run("xcrun", "--find", tool)
    run("xcrun", "notarytool", "history", *notary_auth(args), "--output-format", "json")


def preflight(args):
    validate_signing_inputs(args)
    with signing_keychain(args):
        identities = run("security", "find-identity", "-v", "-p", "codesigning", args.keychain)
        pattern = (r'\b' + re.escape(args.identity.upper())
                   + r'\s+"Developer ID Application: [^"\n]+ \('
                   + re.escape(args.team_id) + r'\)"')
        if not re.search(pattern, identities):
            raise SigningError("selected valid Developer ID Application identity/Team ID not found")
        # Identity enumeration alone passed before the real #3909 CI failure.
        # Exercise this exact private key and chain before an expensive build.
        with tempfile.TemporaryDirectory(prefix="hps-signing-preflight-") as scratch:
            source, probe = Path(scratch)/"probe.c", Path(scratch)/"probe"
            source.write_text("int main(void) { return 0; }\n")
            run("xcrun", "clang", source, "-o", probe)
            sign_code(probe, args)
            verify_code(probe, [probe], args)
    # Validates credentials before an expensive build without submitting code.
    notary_preflight(args)


def notary_auth(args):
    return ["--keychain-profile", args.notary_profile, "--keychain", args.keychain]


def mach_o(path):
    with path.open("rb") as stream:
        magic = stream.read(4)
    if magic not in {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
                     b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
                     b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}:
        return False
    # CAFEBABE is also Java bytecode. Do not sign arbitrary resources as code.
    return "Mach-O" in run("file", "-b", path)


def code_objects(app):
    objects = {app}
    for path in app.rglob("*"):
        if path.is_symlink():
            if os.path.isabs(os.readlink(path)) or not path.resolve().is_relative_to(app):
                raise SigningError(f"bundle symlink escapes app: {path.relative_to(app)}")
            continue
        if path.is_file() and mach_o(path):
            objects.add(path)
        elif path.is_dir() and path.suffix in {".app", ".framework", ".xpc", ".appex", ".bundle"}:
            # Resource-only .bundle directories do not contain code to sign.
            if any(p.is_file() and not p.is_symlink() and mach_o(p) for p in path.rglob("*")):
                objects.add(path)
    return sorted(objects, key=lambda p: (-len(p.parts), str(p)))


def entitlements(path, app):
    relative = str(path.relative_to(app))
    if path == app:
        return ENTITLEMENTS / "app.plist"
    if path.suffix in {".dylib", ".node", ".framework"}:
        return None
    if "/Frameworks/" in "/" + relative and path.suffix != ".app" and "/MacOS/" not in relative:
        return None
    if " Helper (Plugin).app" in relative:
        return ENTITLEMENTS / "plugin.plist"
    # Electron helper, node and vendored CLI runtimes can use JIT. No global
    # disable-library-validation or unsigned-executable-memory exception.
    return ENTITLEMENTS / "jit.plist"


def verify_code(app, objects, args):
    for path in objects:
        run("codesign", "--verify", "--strict", "--all-architectures",
            "-R=" + requirement(args.team_id), path)
        details = run("codesign", "--display", "--verbose=4", path)
        if (f"TeamIdentifier={args.team_id}" not in details
                or "Authority=Developer ID Application:" not in details
                or not re.search(r"flags=.*\bruntime\b", details)
                or not re.search(r"^Timestamp=.+", details, re.M)):
            raise SigningError(f"missing Team ID, Developer ID, runtime or secure timestamp: {path}")
    run("codesign", "--verify", "--deep", "--strict", "--all-architectures", app)


def sign_app(app, objects, args):
    with signing_keychain(args):
        for path in objects:
            # Never --deep when signing: vendor CLIs/native modules are explicit.
            sign_code(path, args, entitlements(path, app))
        verify_code(app, objects, args)


def archive(app, output):
    if output.exists():
        raise SigningError(f"refusing to overwrite archive: {output}")
    run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, output, timeout=600)


def provenance():
    run_id, attempt = os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")
    ci = os.environ.get("GITHUB_ACTIONS") == "true"
    if ci and (os.environ.get("GITHUB_REPOSITORY") != "hypeproof/hypeproof-studio"
               or not os.environ.get("GITHUB_WORKFLOW_REF", "").startswith(
                   "hypeproof/hypeproof-studio/.github/workflows/build-mac.yml@")
               or not re.fullmatch(r"[1-9][0-9]*", run_id)
               or not re.fullmatch(r"[1-9][0-9]*", attempt)):
        raise SigningError("official CI receipt requires the Studio repository and actual run identity")
    return {"workflow": ".github/workflows/build-mac.yml", "run_id": int(run_id) if ci else None,
            "run_attempt": int(attempt) if ci else None, "kind": "github-actions" if ci else "local"}


def checkpoint_origin(value):
    if not isinstance(value, dict) or value.get("workflow") != ".github/workflows/build-mac.yml":
        raise SigningError("invalid signed checkpoint provenance")
    if value.get("kind") == "github-actions":
        valid = all(type(value.get(k)) is int and value[k] > 0 for k in ("run_id", "run_attempt"))
    else:
        valid = value.get("kind") == "local" and value.get("run_id") is None and value.get("run_attempt") is None
    if not valid or set(value) != {"workflow", "kind", "run_id", "run_attempt"}:
        raise SigningError("invalid signed checkpoint provenance")
    return value


def release(args, local_resume=False):
    validate_signing_inputs(args)
    if local_resume and os.environ.get("GITHUB_ACTIONS") == "true":
        raise SigningError("resume-local cannot manufacture an official Actions receipt")
    if local_resume and getattr(args, "stop_after_submit", False):
        raise SigningError("resume-local requires an existing submission, not a submit checkpoint")
    app, output, evidence = Path(args.app).resolve(), Path(args.output).resolve(), Path(args.evidence).resolve()
    if app.suffix != ".app" or not app.is_dir() or Path(args.app).is_symlink():
        raise SigningError("an explicit existing .app directory is required")
    if output.is_relative_to(app) or evidence.is_relative_to(app) or output == evidence:
        raise SigningError("output and evidence must be distinct directories outside the app")
    if not re.fullmatch(r"[a-f0-9]{40}", args.source_sha or ""):
        raise SigningError("full source SHA required")
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    product = read_json(app / "Contents/Resources/app/product.json")
    if info.get("CFBundleIdentifier") != "ai.hypeproof.studio" or product.get("commit") != args.source_sha:
        raise SigningError("existing Studio bundle ID/source stamp mismatch")
    version = info.get("CFBundleShortVersionString")
    if not isinstance(version, str) or not version:
        raise SigningError("product version stamp required before signing")
    origin = provenance()
    output.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    receipt_path = output / RECEIPT
    if receipt_path.exists():
        raise SigningError("immutable signing receipt already exists; use it, do not re-sign")
    if (output / ASSET).exists():
        raise SigningError("final archive already exists without receipt; preserve and diagnose it before a new attempt")
    identity = {"source_sha": args.source_sha, "team_id": args.team_id,
                "certificate_sha1": args.identity.upper(), "bundle_id": info["CFBundleIdentifier"],
                "bundle_version": version, "provenance": origin}
    signed_file = evidence / "signed.json"
    submission_zip = evidence / "submitted.zip"
    submission_file = evidence / "submission.json"
    if local_resume:
        if not all(p.is_file() for p in (signed_file, submission_zip, submission_file)):
            raise SigningError("resume-local requires the original signed checkpoint, submitted.zip and submission ID")
        submission = read_json(submission_file)
        expected_id = getattr(args, "submission_id", None)
        expected_hash = getattr(args, "submitted_sha256", None)
        if (not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", expected_id or "")
                or not re.fullmatch(r"[a-f0-9]{64}", expected_hash or "")
                or submission.get("id") != expected_id
                or submission.get("sha256") != expected_hash or sha256(submission_zip) != expected_hash):
            raise SigningError("resume-local submission ID/archive digest does not match the retained checkpoint")
    objects = code_objects(app)
    resuming = signed_file.exists()
    if signed_file.exists():
        signed = read_json(signed_file)
        previous = signed["identity"]
        checkpoint_origin(previous.get("provenance"))
        # The original checkpoint is immutable. A local finish has local
        # provenance and remains ineligible; it does not inherit CI authority.
        compared = {**previous, "provenance": origin} if local_resume else previous
        if compared != identity:
            raise SigningError("resume identity/source/run differs from signed checkpoint")
        checkpoint = evidence / "stapled.json"
        expected = read_json(checkpoint)["app_tree_sha256"] if checkpoint.exists() else signed["app_tree_sha256"]
        if tree_hash(app) != expected:
            raise SigningError("app changed since checkpoint; refusing resume or re-submission")
        verify_code(app, objects, args)
    else:
        if any(evidence.iterdir()):
            raise SigningError("nonempty evidence without signed checkpoint; use a new evidence directory")
        preflight(args)
        sign_app(app, objects, args)
        signed = {"identity": identity, "app_tree_sha256": tree_hash(app),
                  "objects": [str(p.relative_to(app)) or "." for p in objects],
                  "entitlements_sha256": {p.name: sha256(p) for p in sorted(ENTITLEMENTS.glob("*.plist"))}}
        write_once(signed_file, signed)
    if not submission_zip.exists():
        if submission_file.exists() or (evidence / "submission-started.json").exists():
            raise SigningError("submitted archive missing; do not recreate or resubmit it")
        archive(app, submission_zip)
    submitted_hash = sha256(submission_zip)
    if submission_file.exists():
        submission = read_json(submission_file)
        if submission["sha256"] != submitted_hash:
            raise SigningError("submitted archive digest changed")
    else:
        # Submission timeout can be ambiguous. A started marker intentionally
        # prevents automatic duplicate upload if no submission ID was received.
        started = evidence / "submission-started.json"
        if started.exists():
            raise SigningError("ambiguous prior submission; preserve evidence and reconcile Apple history before retrying")
        write_once(started, {"sha256": submitted_hash, "bytes": submission_zip.stat().st_size})
        try:
            response = json.loads(run("xcrun", "notarytool", "submit", submission_zip,
                                      *notary_auth(args), "--output-format", "json", timeout=900))
        except (SigningError, subprocess.TimeoutExpired) as error:
            write_once(evidence / "submission-error.json", {"error": str(error)})
            raise
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", response.get("id", "")):
            raise SigningError("notarytool did not return a submission UUID")
        submission = {"id": response["id"], "sha256": submitted_hash,
                      "bytes": submission_zip.stat().st_size, "response": response}
        write_once(submission_file, submission)
    if getattr(args, "stop_after_submit", False):
        print(json.dumps({"phase": "submitted", "submission_id": submission["id"],
                          "submitted_archive_sha256": submitted_hash,
                          "submitted_archive_bytes": submission_zip.stat().st_size,
                          "release_eligible": False}))
        return
    if resuming:
        notary_preflight(args)
    accepted = evidence / "accepted.json"
    if not accepted.exists():
        # Persisted submission ID makes a wait timeout resumable without upload.
        status_file = evidence / f"notary-status-{uuid.uuid4()}.json"
        try:
            response = json.loads(run("xcrun", "notarytool", "wait", submission["id"],
                                      *notary_auth(args), "--timeout", args.notary_timeout,
                                      "--output-format", "json", timeout=1900))
        except (SigningError, subprocess.TimeoutExpired) as error:
            write_once(status_file, {"submission_id": submission["id"], "error": str(error)})
            raise
        write_once(status_file, response)
        if response.get("id") != submission["id"] or response.get("status") != "Accepted":
            raise SigningError(f"notarization not Accepted: {response}")
        write_once(accepted, response)
    else:
        response = read_json(accepted)
        if response.get("id") != submission["id"] or response.get("status") != "Accepted":
            raise SigningError("invalid accepted checkpoint")
    if not (evidence / "stapled.json").exists():
        run("xcrun", "stapler", "staple", app)
        write_once(evidence / "stapled.json", {"app_tree_sha256": tree_hash(app)})
    run("xcrun", "stapler", "validate", app)
    verify_code(app, objects, args)
    gatekeeper = run("spctl", "--assess", "--type", "execute", "--verbose=4", app)
    if "source=Notarized Developer ID" not in gatekeeper:
        raise SigningError("Gatekeeper did not report Notarized Developer ID")
    artifact = output / ASSET
    archive(app, artifact)
    # Assess the exact archive consumers download, not just its input app.
    with tempfile.TemporaryDirectory(prefix="hps-notary-verify-", dir=evidence) as temporary:
        run("ditto", "-x", "-k", artifact, temporary, timeout=600)
        extracted = Path(temporary) / app.name
        if tree_hash(extracted) != tree_hash(app):
            raise SigningError("final ZIP round-trip changed signed app bytes/modes/symlinks")
        run("xcrun", "stapler", "validate", extracted)
        run("codesign", "--verify", "--deep", "--strict", "--all-architectures", extracted)
        if "source=Notarized Developer ID" not in run("spctl", "--assess", "--type", "execute", "--verbose=4", extracted):
            raise SigningError("final ZIP Gatekeeper assessment failed")
    receipt = {"schema": SCHEMA, "repository": "hypeproof/hypeproof-studio", "platform": "darwin-arm64",
               **identity, "release_eligible": origin["kind"] == "github-actions",
               "signing": {"type": "Developer ID Application", "hardened_runtime": True, "secure_timestamp": True},
               "notarization": {"submission_id": submission["id"], "status": "Accepted",
                                "submitted_archive_sha256": submitted_hash},
               "verification": {"codesign": True, "stapler": True, "gatekeeper": True},
               "artifact": {"name": artifact.name, "sha256": sha256(artifact), "bytes": artifact.stat().st_size}}
    write_once(receipt_path, receipt)
    print(json.dumps({"receipt": str(receipt_path), "artifact": receipt["artifact"],
                      "release_eligible": receipt["release_eligible"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["preflight", "release", "resume-local"])
    parser.add_argument("--identity", default=os.environ.get("HPS_DEVELOPER_ID_SHA1"))
    parser.add_argument("--team-id", default=os.environ.get("HPS_APPLE_TEAM_ID"))
    parser.add_argument("--keychain", default=os.environ.get("HPS_SIGNING_KEYCHAIN"))
    parser.add_argument("--notary-profile", default=os.environ.get("HPS_NOTARY_PROFILE"))
    parser.add_argument("--app")
    parser.add_argument("--output", default="dist")
    parser.add_argument("--evidence")
    parser.add_argument("--source-sha", default=os.environ.get("BUILD_SOURCEVERSION"))
    parser.add_argument("--notary-timeout", default="20m")
    parser.add_argument("--stop-after-submit", action="store_true",
                        help="persist a submission checkpoint for durable upload before waiting")
    parser.add_argument("--submission-id", help="resume-local: exact retained Apple submission ID")
    parser.add_argument("--submitted-sha256", help="resume-local: exact retained submitted.zip digest")
    args = parser.parse_args()
    try:
        if args.command in {"release", "resume-local"}:
            if not args.app or not args.evidence:
                raise SigningError("release requires --app and --evidence")
            if args.command == "release" and (args.submission_id or args.submitted_sha256):
                raise SigningError("submission anchors are only accepted by resume-local")
            release(args, local_resume=args.command == "resume-local")
        else:
            preflight(args)
            print("Developer ID probe signing and notary credential preflight passed; no app signed or submitted")
    except (SigningError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"macos-sign: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
