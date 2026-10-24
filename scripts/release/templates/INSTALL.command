#!/bin/bash
# HypeProof Studio @@VERSION@@ Test Kit installer (double-click). It runs the same
# install-mac.sh as the one-line curl install, in the side-by-side kit layout, and
# changes no security setting. If macOS refuses to open this file, stop and report
# the displayed message. Do not bypass the refusal or change security settings.
HERE="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$HERE/install-mac.sh" --layout kit --from-command --open
