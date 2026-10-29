#!/usr/bin/env python3
"""Stamp Studio's macOS privacy usage descriptions into a built app's Info.plist (#3221).

macOS shows these sentences in its own "HypeProof Studio이(가) ... 폴더에 접근하려고 합니다" prompt.
The VSCodium base ships none of them, so the prompt explained nothing and a learner could deny
access without knowing why Studio asked. Korean, because the learners read it.

Run by stamp-mac-app.sh (full build and repack, before signing), so a release gets the strings
without a base rebuild. Idempotent: existing values are replaced. Exits non-zero on a missing or
unreadable Info.plist.

    python3 scripts/stamp-mac-usage.py path/to/App.app/Contents/Info.plist
    python3 scripts/stamp-mac-usage.py --check path/to/Info.plist   # verify only (verify-branding.sh)
"""
import plistlib
import sys

USAGE = {
    "NSDocumentsFolderUsageDescription":
        "HypeProof Studio는 내가 고른 작업 폴더나 파일이 '문서' 폴더에 있을 때, 그 파일을 열고 저장하려고 이 폴더에 접근해요.",
    "NSDownloadsFolderUsageDescription":
        "HypeProof Studio는 내가 고른 작업 폴더나 파일이 '다운로드' 폴더에 있을 때, 그 파일을 열고 저장하려고 이 폴더에 접근해요.",
    "NSDesktopFolderUsageDescription":
        "HypeProof Studio는 내가 고른 작업 폴더나 파일이 '데스크탑'에 있을 때, 그 파일을 열고 저장하려고 이 폴더에 접근해요.",
    "NSRemovableVolumesUsageDescription":
        "HypeProof Studio는 내가 고른 작업 폴더나 파일이 USB 같은 외장 저장 장치에 있을 때, 그 파일을 열고 저장하려고 접근해요.",
    "NSNetworkVolumesUsageDescription":
        "HypeProof Studio는 내가 고른 작업 폴더나 파일이 네트워크 드라이브에 있을 때, 그 파일을 열고 저장하려고 접근해요.",
}


def main(argv: list[str]) -> int:
    check = argv[:1] == ["--check"]
    paths = argv[1:] if check else argv
    if len(paths) != 1:
        print(__doc__.strip().splitlines()[-2].strip(), file=sys.stderr)
        return 2
    path = paths[0]
    try:
        with open(path, "rb") as f:
            plist = plistlib.load(f)
    except (OSError, plistlib.InvalidFileException, ValueError) as e:
        print(f"::error::cannot read Info.plist {path}: {e}", file=sys.stderr)
        return 1
    if check:
        missing = [k for k, v in USAGE.items() if plist.get(k) != v]
        if missing:
            print("missing or stale usage descriptions: " + ", ".join(missing))
            return 1
        print(f"usage descriptions: {len(USAGE)} present")
        return 0
    plist.update(USAGE)
    with open(path, "wb") as f:
        plistlib.dump(plist, f, fmt=plistlib.FMT_XML)
    print(f"Stamped {len(USAGE)} privacy usage descriptions (pre-sign)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
