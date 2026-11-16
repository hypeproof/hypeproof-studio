# LiveKit interruption evaluation (#4300)

This is a development route in the existing native iOS app, not a second app or
a production voice provider. It implements a bounded part of [Voice V1](../requirements/voice-conversation.md)
under #898. The product reason is **Human judgment stays visible** and **Minimum
necessary intervention**: a person must be able to correct a speaking assistant
without waiting for its whole answer. It does not measure human growth.

## Authority and wire contract

The RTC room carries disposable evaluation audio. It never becomes a second
account, conversation store, coach, approval mechanism or provider-key store.
The normal Service remains the authority for account/revision/request IDs and
question policy. No production account audio is connected in this evaluation.

Reliable data topic: `hps.voice.eval.v1`. JSON fields:

Before opening the microphone or sending the first `start`, wait for the exact
evaluator's participant attribute `hps.voice.eval.admitted_sid` to match the
client's current LiveKit participant SID. The evaluator advertises it only after
its SDK has observed that configured participant. `Room.connect` alone does not
establish this: the real transport evaluation observed a first reliable packet
with no resolved participant, correctly rejected by the identity check. Do not
infer its sender from JSON or retry `start` blindly. A stale SID or another
participant's attribute never admits the new connection. This is disposable
room readiness, not HypeProof account authorization.

| Field | Contract |
| --- | --- |
| `version` | Integer `1`; unknown versions are rejected. |
| `session_id` | A new UUID for every connection. UUID comparisons normalize case. |
| `turn_id` | A new UUID for every explicit evaluation turn. |
| `generation` | Positive UInt32, strictly increasing within a session. |
| `event` | Client: `start`, `interrupt`, `stop`. Evaluator: `started`, `interrupted`, `stopped`. |
| `audio_track` | `started` only: `hps-eval.<lowercase-session-uuid>.<generation>`. |
| `reason` | Optional fixed diagnostic code, never conversation text. |

Only the authenticated room participant with identity `hps-voice-evaluator` can
authorize output. The developer's room token supplies that limited identity;
the JSON does not prove identity. A `started` event alone is not proof that audio
has played. Auto-subscribe is disabled; the client subscribes only to the exact
authorized participant/track and current session, turn and generation.

An interruption first closes the client's output gate, then sends cancellation.
The evaluator cancels the producer, clears the actual SDK audio queue and
unpublishes its generation track before acknowledging. Late `started`, duplicate
events and old-generation packets cannot restore authorization. `stop` is
terminal, including after an interruption or before the first start. Background,
screen dismissal and failed connection must release the microphone and room.
An asynchronous connect completion cannot reopen a stopped session.

## Observation and limits

Report generated, queued, received and drained audio separately. None proves
what a person heard through a speaker. Played/heard range is **unknown** until
device render/acoustic evidence exists; never truncate the original assistant
record based on a transport acknowledgement. The core guard is an authorization
check, not proof that the adapter actually silences audio.

The lab uses deterministic PCM energy onset to exercise real transport and queue
cancellation. This is not a Korean semantic turn detector or proof of echo
cancellation. Synthetic checks contribute to VO-T03/06/07/09; they do not close
the physical VO-T06/07/08/09/39 acceptance gates. iPhone speaker, AirPods,
Bluetooth, interruptions and Korean naturalness remain separate checks.

The development screen is compiled and selected explicitly in Debug. Release
has no evaluation entry. The initial runtime accepts loopback connections only;
an iPhone's loopback address is the iPhone itself, so this setup alone does not
enable physical-phone testing against a Mac. Public ingress, persistent server
installation, paid STT/LLM/TTS, production account transport and any new recording
policy require the next integration slice. No provider cost occurs in this lab;
owned compute and any separately reserved CI remain costs.

## Before a user-facing release

Preserve the existing reflection idempotency and coach module/version. Add scoped
short-lived room authorization and continuous audio reservation/settlement in
Service before external voice activation. Compare Korean voices with the same
script, including names, numbers, short acknowledgements and interruption.
Measure user-end to first audible response and speech-onset to audible stop on
the installed app; do not substitute SDK timestamps for acoustic observations.
Keep desktop and mobile history continuous without requiring a computer to be on.
