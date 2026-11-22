#!/usr/bin/env python3
"""Real Xcode metadata controls; unsigned tiny C builds, never signs or uploads."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import tempfile
from xml.parsers.expat import ExpatError

NATIVE = Path(__file__).resolve().parents[1]
BUNDLE = "ai.hypeproof.studio.mobile"

PBX = '''// !$*UTF8*$!
{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
000000000000000000000001 = { isa = PBXProject; buildConfigurationList = 000000000000000000000010; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; mainGroup = 000000000000000000000002; productRefGroup = 000000000000000000000003; projectDirPath = ""; projectRoot = ""; targets = (000000000000000000000007,); };
000000000000000000000002 = { isa = PBXGroup; children = (000000000000000000000004,000000000000000000000003,); sourceTree = "<group>"; };
000000000000000000000003 = { isa = PBXGroup; children = (000000000000000000000005,); sourceTree = "<group>"; };
000000000000000000000004 = { isa = PBXFileReference; lastKnownFileType = sourcecode.c.c; path = main.c; sourceTree = "<group>"; };
000000000000000000000005 = { isa = PBXFileReference; explicitFileType = wrapper.application; path = PushPlistProbe.app; sourceTree = BUILT_PRODUCTS_DIR; };
000000000000000000000006 = { isa = PBXBuildFile; fileRef = 000000000000000000000004; };
000000000000000000000007 = { isa = PBXNativeTarget; buildConfigurationList = 000000000000000000000011; buildPhases = (000000000000000000000008,000000000000000000000009,); buildRules = (); dependencies = (); name = PushPlistProbe; productName = PushPlistProbe; productReference = 000000000000000000000005; productType = "com.apple.product-type.application"; };
000000000000000000000008 = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (000000000000000000000006,); runOnlyForDeploymentPostprocessing = 0; };
000000000000000000000009 = { isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
000000000000000000000010 = { isa = XCConfigurationList; buildConfigurations = (000000000000000000000012,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
000000000000000000000011 = { isa = XCConfigurationList; buildConfigurations = (000000000000000000000013,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
000000000000000000000012 = { isa = XCBuildConfiguration; buildSettings = { IPHONEOS_DEPLOYMENT_TARGET = 17.0; SDKROOT = iphoneos; }; name = Release; };
000000000000000000000013 = { isa = XCBuildConfiguration; buildSettings = { GENERATE_INFOPLIST_FILE = YES; CODE_SIGNING_ALLOWED = NO; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 0.2.0; TARGETED_DEVICE_FAMILY = "1,2"; PRODUCT_NAME = "$(TARGET_NAME)"; PRODUCT_BUNDLE_IDENTIFIER = invalid.local.PushPlistProbe; INFOPLIST_KEY_CFBundleDisplayName = "Push Plist Probe"; INFOPLIST_KEY_HPSPushConfigured = NO; INFOPLIST_KEY_NSMicrophoneUsageDescription = "Local diagnosis only"; INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO; INFOPLIST_KEY_UILaunchScreen_Generation = YES; }; name = Release; };
}; rootObject = 000000000000000000000001; }
'''


class MetadataError(ValueError):
    """A fixed identifier, never a parsed value or compiler error."""


def require(condition: bool, check: str) -> None:
    if not condition:
        raise MetadataError(check)


def read_info(path: Path) -> dict:
    info = plistlib.loads(path.read_bytes())
    require(isinstance(info, dict), "plist_dictionary_required")
    return info


def run(command: list[str], log: Path) -> int:
    # Each control has a three-minute bound, including its own child process group.
    with log.open("w") as stream:
        child = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return child.wait(timeout=180)
        except subprocess.TimeoutExpired:
            # A group that has already exited gives ESRCH, or EPERM on macOS when only the
            # unreaped leader is left (run 44990830847); the leader is then killed directly.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                try:
                    child.kill()
                except (ProcessLookupError, PermissionError):
                    pass
            child.wait()
            raise MetadataError("xcode_control_timed_out") from None


def check(app_info: Path, evidence: Path, report: dict) -> None:
    actual = read_info(app_info)
    require(actual.get("CFBundleIdentifier") == BUNDLE, "app_bundle_id_mismatch")
    require(actual.get("HPSPushConfigured") is False or actual.get("HPSPushConfigured") == "NO",
            "app_push_default_not_disabled")
    require(actual.get("CFBundleDisplayName") == "HP Studio", "app_display_name_missing")
    require(all(isinstance(actual.get(key), str) and actual[key] for key in
                ("NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription")),
            "app_generated_usage_strings_missing")
    report.update(app_info_sha256=hashlib.sha256(app_info.read_bytes()).hexdigest(),
                  app_default_disabled=True,
                  app_push_setting=actual["HPSPushConfigured"],
                  app_push_setting_type="boolean" if isinstance(actual["HPSPushConfigured"], bool) else "string",
                  source_sha=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=NATIVE, text=True, timeout=10).strip(),
                  probe_project_sha256=hashlib.sha256(PBX.encode()).hexdigest())
    template = NATIVE / "ios/App/Info.plist"
    report["input_plist_sha256"] = hashlib.sha256(template.read_bytes()).hexdigest()
    evidence.write_text(json.dumps(report, indent=2) + "\n")
    with tempfile.TemporaryDirectory(prefix="hps-push-plist-") as temporary:
        root = Path(temporary)
        project = root / "PushPlistProbe.xcodeproj"
        project.mkdir()
        (project / "project.pbxproj").write_text(PBX)
        (root / "main.c").write_text("int main(void) { return 0; }\n")
        # Exercise the actual app's input bytes, never an invented enabled plist.
        (root / "Explicit.plist").write_bytes(template.read_bytes())
        variants = [("generated_enabled", ["INFOPLIST_KEY_HPSPushConfigured=YES"], None),
                    ("explicit_enabled", ["INFOPLIST_FILE=" + str(root / "Explicit.plist"),
                                          "INFOPLIST_KEY_HPSPushConfigured=YES"], "YES"),
                    ("explicit_disabled", ["INFOPLIST_FILE=" + str(root / "Explicit.plist")], "NO")]
        for name, settings, expected in variants:
            report["phase"] = name
            evidence.write_text(json.dumps(report, indent=2) + "\n")
            derived = root / name
            command = ["xcodebuild", "-project", str(project), "-scheme", "PushPlistProbe",
                       "-configuration", "Release", "-destination", "generic/platform=iOS",
                       "-derivedDataPath", str(derived), "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO",
                       *settings, "build"]
            result = run(command, evidence.with_name("push-metadata-" + name + ".log"))
            require(result == 0, "xcode_control_build_failed")
            output = derived / "Build/Products/Release-iphoneos/PushPlistProbe.app/Info.plist"
            # These unsigned probe plists contain only this tracked fixture's
            # metadata; retain the bytes so the reported control is inspectable.
            retained = evidence.with_name("push-metadata-" + name + ".plist")
            retained.write_bytes(output.read_bytes())
            info = read_info(output)
            require(info.get("CFBundleIdentifier") == "invalid.local.PushPlistProbe"
                    and info.get("CFBundleDisplayName") == "Push Plist Probe",
                    "control_generated_metadata_missing")
            if expected is None:
                require("HPSPushConfigured" not in info, "custom_setting_negative_control_failed")
            else:
                require(info.get("HPSPushConfigured") == expected, "explicit_input_control_failed")
            report["controls"].append({"name": name, "verdict": "PASS", "xcode_exit": result,
                                       "push_setting": info.get("HPSPushConfigured"),
                                       "push_setting_type": "missing" if expected is None else "string",
                                       "info_file": retained.name,
                                       "info_sha256": hashlib.sha256(output.read_bytes()).hexdigest()})
            evidence.write_text(json.dumps(report, indent=2) + "\n")
    report["verdict"] = "PASS"
    report["phase"] = "complete"
    evidence.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-info", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    report = {"schema": "hps-ios-push-metadata/1", "verdict": "RUNNING", "phase": "actual_app",
              "controls": [], "signing": "NOT_RUN", "provider_acceptance": "NOT_RUN"}
    try:
        check(args.app_info, args.evidence, report)
    except (OSError, ValueError, ExpatError, plistlib.InvalidFileException, subprocess.SubprocessError) as error:
        report["verdict"] = "BLOCKED" if isinstance(error, (OSError, subprocess.SubprocessError)) else "FAIL"
        report["check"] = str(error) if isinstance(error, MetadataError) else "invalid_data_or_io"
        try:
            args.evidence.write_text(json.dumps(report, indent=2) + "\n")
        except OSError:
            pass
        # Only internal fixed labels cross this boundary; compiler diagnostics
        # remain in the unsigned-probe logs and plist values are never printed.
        parser.exit(2, f"iOS push metadata qualification failed [phase={report['phase']} check={report['check']}]\n")
    print("Actual app push default and three real Xcode metadata controls passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
