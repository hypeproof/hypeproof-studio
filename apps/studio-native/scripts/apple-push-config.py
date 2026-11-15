#!/usr/bin/env python3
"""Default-off TestFlight push qualification. Never contacts APNs or uploads."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import stat
import subprocess
import tempfile
import unicodedata
import zipfile

BUNDLE = "ai.hypeproof.studio.mobile"
MAX_EXPANDED = 2 * 1024**3


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_plist(path: Path) -> dict:
    value = plistlib.loads(path.read_bytes())
    require(isinstance(value, dict), "expected a plist dictionary")
    return value


def validate_profile(profile: dict, team: str) -> None:
    require(bool(team) and profile.get("TeamIdentifier") == [team], "profile team mismatch")
    entitlements = profile.get("Entitlements", {})
    require(entitlements.get("application-identifier") == f"{team}.{BUNDLE}", "profile app ID mismatch")
    require(entitlements.get("com.apple.developer.team-identifier") == team, "profile entitlement team mismatch")
    require(entitlements.get("aps-environment") == "production", "profile requires production APNs")
    require(entitlements.get("get-task-allow") is False, "profile must be a distribution profile")
    require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"), "profile must permit App Store distribution")
    expiry = profile.get("ExpirationDate")
    require(isinstance(expiry, dt.datetime) and expiry.replace(tzinfo=dt.timezone.utc) > dt.datetime.now(dt.timezone.utc), "profile expired or missing expiry")
    require(isinstance(profile.get("UUID"), str) and bool(profile["UUID"]), "profile UUID missing")


def report(path: Path, **fields) -> None:
    path.write_text(json.dumps({"schema": "hps-ios-push-configuration/1", "provider_acceptance": "NOT_RUN", **fields}, indent=2) + "\n")


def prepare(args) -> None:
    require(args.enabled in ("true", "false"), "HPS_IOS_PUSH_ENABLED must be true or false")
    if args.enabled == "false":
        report(args.output, enabled=False, stage="disabled")
        return
    require(args.platform == "ios", "push release configuration supports iOS only")
    validate_profile(read_plist(args.profile), args.team)
    require(read_plist(args.template) == {"aps-environment": "$(HPS_APNS_ENVIRONMENT)"}, "unexpected push entitlement template")
    # A fixed entitlement, not an operator-selected path or arbitrary Xcode flags.
    with args.entitlements.open("xb") as target:
        os.chmod(args.entitlements, 0o600)
        plistlib.dump({"aps-environment": "production"}, target)
    report(args.output, enabled=True, stage="profile_verified", bundle_id=BUNDLE,
           aps_environment="production", profile_sha256=digest(args.profile),
           template_sha256=digest(args.template), entitlements_sha256=digest(args.entitlements))


def inspect_ipa(path: Path) -> str:
    # ditto preserves signed bundle attributes; reject unsafe/ambiguous archives
    # before extracting into a fresh private directory. This iOS app has no links.
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= 50000, "unexpected IPA entry count")
        require(sum(x.file_size for x in entries) <= MAX_EXPANDED, "IPA exceeds extraction bound")
        names = set()
        normalized_names = set()
        prefixes = {}
        apps = set()
        for item in entries:
            name = item.filename
            parts = PurePosixPath(name).parts
            require(parts and not name.startswith("/") and "\\" not in name and ".." not in parts,
                    "unsafe IPA path")
            require(name.rstrip("/") == PurePosixPath(name).as_posix(), "noncanonical IPA path")
            require(name not in names and not item.flag_bits & 1, "duplicate or encrypted IPA entry")
            normalized = unicodedata.normalize("NFD", name.rstrip("/")).casefold()
            require(normalized not in normalized_names, "IPA paths alias on macOS")
            normalized_names.add(normalized)
            # Different leaves can still alias a parent directory on macOS.
            # Repeated same-spelling directory prefixes (including explicit ZIP
            # directory entries) are valid; file/directory conflicts are not.
            for index in range(1, len(parts) + 1):
                spelling = "/".join(parts[:index])
                key = unicodedata.normalize("NFD", spelling).casefold()
                kind = "directory" if index < len(parts) or item.is_dir() else "file"
                require(key not in prefixes or prefixes[key] == (spelling, kind),
                        "IPA directory paths alias on macOS")
                prefixes[key] = (spelling, kind)
            names.add(name)
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(mode in (0, stat.S_IFREG, stat.S_IFDIR), "unsupported IPA link or special entry")
            if len(parts) >= 2 and parts[0] == "Payload":
                require(parts[1].endswith(".app"), "unexpected Payload entry")
                apps.add(parts[1])
        require(len(apps) == 1, "IPA must contain exactly one Payload app")
        app = "Payload/" + apps.pop()
        require(app + "/Info.plist" in names and app + "/embedded.mobileprovision" in names,
                "IPA app metadata missing")
        return app


def command(argv: list[str]) -> bytes:
    # No raw signing-tool output, profile contents or credential values in errors.
    try:
        result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("push verification tool unavailable or timed out") from error
    require(result.returncode == 0, "push verification tool failed")
    return result.stdout


def verify(args) -> None:
    require(args.platform == "ios", "push release configuration supports iOS only")
    prepared = json.loads(args.output.read_text())
    require(prepared.get("enabled") is True and prepared.get("stage") == "profile_verified"
            and prepared.get("profile_sha256") == digest(args.profile), "push preflight missing or changed")
    source_profile = read_plist(args.profile)
    validate_profile(source_profile, args.team)
    app_path = inspect_ipa(args.package)
    with tempfile.TemporaryDirectory(prefix="push-export-", dir=args.private_dir) as directory:
        command(["ditto", "-x", "-k", str(args.package), directory])
        app = Path(directory) / app_path
        command(["codesign", "--verify", "--deep", "--strict", str(app)])
        signed = plistlib.loads(command(["codesign", "--display", "--entitlements", ":-", str(app)]))
        require(isinstance(signed, dict), "signed entitlements missing")
        require(signed.get("application-identifier") == f"{args.team}.{BUNDLE}", "signed app ID mismatch")
        require(signed.get("com.apple.developer.team-identifier") == args.team, "signed team mismatch")
        require(signed.get("aps-environment") == "production", "signed production APNs entitlement missing")
        require(signed.get("get-task-allow") is False, "signed app permits debugging")
        info = read_plist(app / "Info.plist")
        require(info.get("CFBundleIdentifier") == BUNDLE, "exported bundle ID mismatch")
        # Match NativePushCenter.configured exactly (not arbitrary truthiness).
        configured = info.get("HPSPushConfigured")
        require(configured is True or configured == "YES", "exported app push setting is disabled")
        embedded = plistlib.loads(command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]))
        validate_profile(embedded, args.team)
        require(embedded["UUID"] == source_profile["UUID"], "exported profile changed")
    report(args.output, **{k: v for k, v in prepared.items() if k not in ("schema", "provider_acceptance", "stage")},
           stage="export_verified", package_sha256=digest(args.package), signature_verified=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    for name in ("prepare", "verify"):
        item = sub.add_parser(name)
        item.add_argument("--platform", required=True)
        item.add_argument("--profile", type=Path, required=True)
        item.add_argument("--team", required=True)
        item.add_argument("--output", type=Path, required=True)
        if name == "prepare":
            item.add_argument("--enabled", required=True)
            item.add_argument("--template", type=Path, required=True)
            item.add_argument("--entitlements", type=Path, required=True)
        else:
            item.add_argument("--package", type=Path, required=True)
            item.add_argument("--private-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        (prepare if args.operation == "prepare" else verify)(args)
    except (ValueError, OSError, KeyError, TypeError, plistlib.InvalidFileException, zipfile.BadZipFile):
        # The concrete phase is visible in the workflow; never echo tool/profile data.
        parser.exit(2, "iOS push configuration verification failed; check qualified profile and signed app configuration\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
