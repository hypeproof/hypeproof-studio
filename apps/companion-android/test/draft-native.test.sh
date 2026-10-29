#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${COMPANION_TEST_GSON:?Supply existing cached Gson jar for the JVM-only JSON port}"
classes="$(mktemp -d)"
trap 'rm -rf "$classes"' EXIT
javac -cp "$COMPANION_TEST_GSON" -d "$classes" "$root/test/fixtures/java/org/json/JSONObject.java" "$root/app/src/main/java/ai/hypeproof/companion/NativeDraftRecord.java" "$root/app/src/main/java/ai/hypeproof/companion/NativeDraftStore.java" "$root/app/src/main/java/ai/hypeproof/companion/NativeDraftBroker.java" "$root/test/NativeDraftStoreTest.java"
java -cp "$classes:$COMPANION_TEST_GSON" ai.hypeproof.companion.NativeDraftStoreTest
