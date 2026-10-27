#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
classes="$(mktemp -d)"
trap 'rm -rf "$classes"' EXIT
javac -d "$classes" "$root/app/src/main/java/ai/hypeproof/companion/NativeDeviceSignIn.java" "$root/test/NativeDeviceSignInTest.java" "$root/app/src/main/java/ai/hypeproof/companion/NativeHttpDeadline.java" "$root/test/NativeHttpDeadlineTest.java"
java -cp "$classes" ai.hypeproof.companion.NativeDeviceSignInTest
java -cp "$classes" ai.hypeproof.companion.NativeHttpDeadlineTest
