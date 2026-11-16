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

The initial executable controls run on Linux with `ss` available. Signalling
binds 127.0.0.1. RTC TCP is disabled (the pinned server's TCP mux otherwise binds
all interfaces); UDP is restricted to interface `lo` and 127.0.0.1/32. Owned
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

For a bounded **same Linux host** manual session, add `--serve-seconds 120`.
The private `connection.private.json` is removed on exit. It does not make a Mac
simulator or physical iPhone reachable. Those require a separately validated
same-host server or a tunnel carrying the actual ICE media ports as well as
signalling; no public/LAN listener is created here.
