# Local LiveKit media evaluation

This is an opt-in development lab inside the existing native workspace, not an
account conversation service. It uses the official LiveKit RTC SDK 1.2.1 and
server 1.13.11, synthetic sine-wave PCM, one ephemeral room per case, and no
ASR/LLM/TTS providers. No Service entitlement, participant record or production
voice setting is changed.

Run installations and media execution inside the repository's `hype-resource`
allocation. Use a new private task directory and virtual environment. Install
`requirements.txt`; fetch the platform archive in `pins.json` from its exact
GitHub release URL and verify its SHA-256 before extracting only `livekit-server`.
Do not install a daemon or use system-wide package installation.

```sh
.venv/bin/python lab.py --server ./livekit-server --output ./evidence-run-1
```

The executable controls support Linux with `ss` and Darwin with `/usr/sbin/lsof`. Signalling
binds 127.0.0.1. RTC TCP is disabled (the pinned server's TCP mux otherwise binds
all interfaces); UDP is restricted to `lo` (Linux) or `lo0` (Darwin) and 127.0.0.1/32. Owned
listeners are checked before and after media. STUN is loopback-only, TURN is
absent. Credentials exist only in a private temporary file and in memory, expire
after 15 minutes, and are not printed. Only the owned child server is terminated.
No Docker socket, public ingress or ambient provider credential is used.

`events.json`, `result.json` and per-track WAV files record actual decoded remote
PCM, generation/queue/unpublication observations, and owned cleanup. They contain
synthetic audio only. A queue drain is not device playback, and received PCM is
not proof of acoustic output. Human speech, Korean recognition/naturalness,
echo cancellation, physical iPhone/Bluetooth behavior and release acceptance
remain **NOT RUN**.

Input interruption uses three consecutive received frames whose normalized RMS
is at least 0.08. This is a deterministic energy test, **not a speech detector**;
noise or echo can trigger it. Its threshold is provisional lab configuration.
There is no automatic next turn: a new explicit start is required. Synthetic
reply generation is bounded to 30 seconds; session generations to 32.

Protocol: reliable `hps.voice.eval.v1`; see the shared
`docs/dev/livekit-evaluation-protocol.md`. The evaluator binds the configured
client identity and participant SID to its first session, requires UUID turn
identity and increasing generations, and rejects unregistered, stale and duplicate
messages. Stop ends that connection's evaluation; interruption allows a later
explicit generation. Output tracks use `hps-eval.<lowercase-session-uuid>.<gen>`.
The receiver waits for matching `started` before subscribing and locally blocks
an interrupted/stopped generation before server acknowledgement.

Controls cover actual reply PCM, quiet input, energy onset over actual incoming
media, cleared source queue and removed output publication, duplicate/foreign
sender commands over the real channel, stale generation, late started, Stop,
disconnect and late producer capture rejection. Any failed control is retained;
there is no retry-to-pass loop.

Primary sources and exact archive digests are in `pins.json`. The cancellation
operation is LiveKit's native `AudioSource.clear_queue`, not a simulated boolean.

The evaluator advertises `hps.voice.eval.admitted_sid` only after observing the
configured client's current participant SID. The client must wait for that exact
attribute on `hps-voice-evaluator` to equal its current local SID before microphone
publication or the first start. Room.connect completion alone is insufficient:
a data packet can arrive before the remote participant registration. Unknown
senders remain refused; there is no blind first-start retry. The attribute is
connection admission for synthetic evaluation, not account authentication.

For a bounded **same-host** manual session, add `--serve-seconds 120`.
The private `connection.private.json` is removed on exit. A same-host iOS simulator must be validated through the actual native SDK. A
physical iPhone remains unreachable without separately authorized networking;
no public/LAN listener is created here.

Receiver PCM receipts are generation-bound. Interruption/Stop/unpublication closes
the corresponding SDK AudioStream; later generations cannot append to its file.
The bounded check distinguishes a closed observer from an unobserved RTP or
hardware tail. It does not claim that unsubscribe measures all in-flight audio.
Cleanup attempts receiver/source/evaluator release, every owned room disconnect
and the owned connection-file deletion independently. A body failure remains the
primary failure; otherwise the first cleanup error fails the run. Secondary
cleanup errors are recorded by stage/type, without credential values.

## Darwin host preparation

The official 1.13.11 release publishes Linux/Windows archives only. The optional
Darwin helper builds exact source commit `385aa40f9292fe1db8caad87301e4b285b7c198a`
with the checksum-pinned official Go 1.26.11 archive, `GOTOOLCHAIN=local`, and
`CGO_ENABLED=1` using the existing Apple clang and macOS SDK. The pinned
`go-osstat` Darwin CPU implementation requires Mach headers through Cgo; the
Linux/Windows release's Cgo-disabled setting does not build this Darwin source.
The receipt records clang/SDK identity and the resulting binary's linked libraries.
`go.mod`/`go.sum` remain unchanged, checksum verification stays enabled, generated
Wire source comes from the pinned commit, and all caches stay in the task folder.
Use an existing Python >=3.12; the helper installs only exact binary-wheel versions
from `host-requirements.txt` into its own venv. It never installs Homebrew packages
or changes the system. Its total preparation deadline defaults to 600 seconds;
missing dependencies or expiry fail without a fallback or retry.
SIGTERM/SIGINT unwind through the active stage and reap its owned process group
before writing a failed receipt. A caller must allow more than the helper's
10-second TERM/KILL cleanup bound before force-killing the helper itself.

```sh
python3 prepare-host.py --output /private/tmp/hps-eval-host-UNIQUE --python /absolute/python3.13
```

Run that command inside the shared resource allocation. Read `host.json` only when
`status` is `PASS`; it gives absolute `python` and `server` paths plus source/tool
hashes. Reuse those prepared paths for the two fresh native scenarios within the
same task instead of rebuilding. Do not reuse an unverified directory or private
connection config across sessions.

The native runner uses `--serve-seconds 75 --exit-after-client --source-sha <40-hex>`.
This mode finishes only after the same session sends `stopped`, the configured
client actually disconnects, and owned cleanup succeeds. The deadline is a failure,
not an implicit successful Stop. `connection.private.json` includes the ephemeral
`room` and `candidate_source_sha`; consume/delete it privately without putting its
token in argv, logs, test attachments or diagnostics. Host events and result bind
that room/source to the same session/turn/generation as the native receipt. A host
PASS alone does not establish native output or device acceptance.

Source build references: [LiveKit pinned build instructions](https://github.com/livekit/livekit/blob/v1.13.11/README.md#building-from-source),
[pinned release recipe](https://github.com/livekit/livekit/blob/v1.13.11/.goreleaser.yaml),
[official Go archive checksums](https://go.dev/dl/).
