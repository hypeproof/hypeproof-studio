#!/usr/bin/env python3
"""Default-off TestFlight push qualification. Never contacts APNs or uploads."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
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
from xml.parsers.expat import ExpatError
import zipfile

BUNDLE = "ai.hypeproof.studio.mobile"
MAX_EXPANDED = 2 * 1024**3


class QualificationError(ValueError):
    """Only fixed check/phase identifiers may cross the signing boundary."""
    def __init__(self, check: str, phase: str = "configuration"):
        super().__init__(check)
        self.check = check
        self.phase = phase


@contextmanager
def qualification_phase(name: str):
    try:
        yield
    except QualificationError as error:
        error.phase = name
        raise
    except OSError as error:
        raise QualificationError("io_failed", name) from error
    except (ValueError, KeyError, TypeError, ExpatError, plistlib.InvalidFileException, zipfile.BadZipFile) as error:
        raise QualificationError("invalid_data", name) from error


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise QualificationError(reason)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_plist(path: Path) -> dict:
    value = plistlib.loads(path.read_bytes())
    require(isinstance(value, dict), "plist_dictionary_required")
    return value


def validate_profile(profile: dict, team: str) -> None:
    require(bool(team) and profile.get("TeamIdentifier") == [team], "profile_team_mismatch")
    entitlements = profile.get("Entitlements", {})
    require(isinstance(entitlements, dict), "profile_entitlements_missing")
    require(entitlements.get("application-identifier") == f"{team}.{BUNDLE}", "profile_app_id_mismatch")
    require(entitlements.get("com.apple.developer.team-identifier") == team, "profile_entitlement_team_mismatch")
    require(entitlements.get("aps-environment") == "production", "profile_production_aps_required")
    require(entitlements.get("get-task-allow") is False, "profile_distribution_required")
    require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"), "profile_app_store_required")
    expiry = profile.get("ExpirationDate")
    require(isinstance(expiry, dt.datetime) and expiry.replace(tzinfo=dt.timezone.utc) > dt.datetime.now(dt.timezone.utc), "profile_expiry_invalid")
    require(isinstance(profile.get("UUID"), str) and bool(profile["UUID"]), "profile_uuid_missing")


def report(path: Path, **fields) -> None:
    path.write_text(json.dumps({"schema": "hps-ios-push-configuration/1", "provider_acceptance": "NOT_RUN", **fields}, indent=2) + "\n")


def prepare(args) -> None:
    require(args.enabled in ("true", "false"), "enabled_flag_invalid")
    if args.enabled == "false":
        report(args.output, enabled=False, stage="disabled")
        return
    require(args.platform == "ios", "platform_ios_required")
    with qualification_phase("source_profile"):
        validate_profile(read_plist(args.profile), args.team)
    with qualification_phase("entitlement_template"):
        require(read_plist(args.template) == {"aps-environment": "$(HPS_APNS_ENVIRONMENT)"}, "entitlement_template_mismatch")
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
        require(0 < len(entries) <= 50000, "ipa_entry_count_invalid")
        require(sum(x.file_size for x in entries) <= MAX_EXPANDED, "ipa_extraction_bound_exceeded")
        names = set()
        normalized_names = set()
        prefixes = {}
        apps = set()
        for item in entries:
            name = item.filename
            parts = PurePosixPath(name).parts
            require(parts and not name.startswith("/") and "\\" not in name and ".." not in parts,
                    "ipa_path_unsafe")
            require(name.rstrip("/") == PurePosixPath(name).as_posix(), "ipa_path_noncanonical")
            require(name not in names and not item.flag_bits & 1, "ipa_entry_duplicate_or_encrypted")
            normalized = unicodedata.normalize("NFD", name.rstrip("/")).casefold()
            require(normalized not in normalized_names, "ipa_path_alias")
            normalized_names.add(normalized)
            # Different leaves can still alias a parent directory on macOS.
            # Repeated same-spelling directory prefixes (including explicit ZIP
            # directory entries) are valid; file/directory conflicts are not.
            for index in range(1, len(parts) + 1):
                spelling = "/".join(parts[:index])
                key = unicodedata.normalize("NFD", spelling).casefold()
                kind = "directory" if index < len(parts) or item.is_dir() else "file"
                require(key not in prefixes or prefixes[key] == (spelling, kind),
                        "ipa_directory_alias")
                prefixes[key] = (spelling, kind)
            names.add(name)
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(mode in (0, stat.S_IFREG, stat.S_IFDIR), "ipa_entry_type_unsupported")
            if len(parts) >= 2 and parts[0] == "Payload":
                require(parts[1].endswith(".app"), "ipa_payload_entry_invalid")
                apps.add(parts[1])
        require(len(apps) == 1, "ipa_app_count_invalid")
        app = "Payload/" + apps.pop()
        require(app + "/Info.plist" in names and app + "/embedded.mobileprovision" in names,
                "ipa_metadata_missing")
        return app


def command(argv: list[str]) -> bytes:
    # No raw signing-tool output, profile contents or credential values in errors.
    try:
        result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise QualificationError("tool_unavailable_or_timed_out") from error
    require(result.returncode == 0, "tool_failed")
    return result.stdout


def verify(args) -> None:
    require(args.platform == "ios", "platform_ios_required")
    with qualification_phase("preflight"):
        prepared = json.loads(args.output.read_text())
        require(isinstance(prepared, dict), "preflight_dictionary_required")
        require(prepared.get("enabled") is True and prepared.get("stage") == "profile_verified"
                and prepared.get("profile_sha256") == digest(args.profile), "preflight_missing_or_changed")
    with qualification_phase("source_profile"):
        source_profile = read_plist(args.profile)
        validate_profile(source_profile, args.team)
    with qualification_phase("ipa_structure"):
        app_path = inspect_ipa(args.package)
    with tempfile.TemporaryDirectory(prefix="push-export-", dir=args.private_dir) as directory:
        with qualification_phase("ipa_extract"):
            command(["ditto", "-x", "-k", str(args.package), directory])
        app = Path(directory) / app_path
        with qualification_phase("signature"):
            command(["codesign", "--verify", "--deep", "--strict", str(app)])
        with qualification_phase("signed_entitlements"):
            signed = plistlib.loads(command(["codesign", "--display", "--entitlements", ":-", str(app)]))
            require(isinstance(signed, dict), "signed_entitlements_missing")
            require(signed.get("application-identifier") == f"{args.team}.{BUNDLE}", "signed_app_id_mismatch")
            require(signed.get("com.apple.developer.team-identifier") == args.team, "signed_team_mismatch")
            require(signed.get("aps-environment") == "production", "signed_production_aps_required")
            require(signed.get("get-task-allow") is False, "signed_debugging_not_disabled")
        with qualification_phase("bundle_metadata"):
            info = read_plist(app / "Info.plist")
            require(info.get("CFBundleIdentifier") == BUNDLE, "bundle_id_mismatch")
            # Match NativePushCenter.configured exactly (not arbitrary truthiness).
            configured = info.get("HPSPushConfigured")
            require(configured is True or configured == "YES", "push_setting_not_enabled")
        with qualification_phase("embedded_profile"):
            embedded = plistlib.loads(command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]))
            require(isinstance(embedded, dict), "plist_dictionary_required")
            validate_profile(embedded, args.team)
            require(embedded["UUID"] == source_profile["UUID"], "profile_uuid_changed")
    with qualification_phase("export_receipt"):
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
    except QualificationError as error:
        parser.exit(2, f"iOS push configuration verification failed [phase={error.phase} check={error.check}]\n")
    except (ValueError, OSError, KeyError, TypeError, ExpatError, plistlib.InvalidFileException, zipfile.BadZipFile):
        # Never interpolate exception text, tool output, paths or profile values.
        parser.exit(2, "iOS push configuration verification failed [phase=configuration check=invalid_data_or_io]\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
