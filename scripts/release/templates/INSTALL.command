#!/bin/bash
# HypeProof Studio @@VERSION@@ Test Kit installer (double-click). It runs the same
# install-mac.sh as the one-line curl install, in the side-by-side kit layout, and
# changes no security setting. If macOS refuses to open this file, do not work around
# it: use the one-line install from READ-ME.txt instead.
HERE="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$HERE/install-mac.sh" --layout kit --from-command --open
