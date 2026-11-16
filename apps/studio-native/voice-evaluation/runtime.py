"""Local synthetic-media evaluator. No ASR, TTS provider, conversation or account store."""
from __future__ import annotations

import asyncio
import contextlib
import json
import math
import time
import uuid
from array import array
from dataclasses import dataclass

from livekit import rtc

TOPIC = "hps.voice.eval.v1"
ADMISSION_ATTRIBUTE = "hps.voice.eval.admitted_sid"
RATE = 48000
SAMPLES = 960  # 20 ms mono PCM
CLIENT_EVENTS = {"start", "interrupt", "stop"}
REASONS = {"energy_onset", "client_interrupt", "client_stop", "disconnect", "limit",
           "user_speech", "user_stop", "background", "disappear", "connection_error",
           "audio_interruption", "route_change", "timeout"}


def envelope(session: str, turn: str, generation: int, event: str, **fields) -> dict:
    return dict(version=1, session_id=session, turn_id=turn, generation=generation,
                event=event, **fields)


def decode(payload: bytes, events=CLIENT_EVENTS) -> dict:
    if len(payload) > 1024:
        raise ValueError("oversized")
    value = json.loads(payload)
    if not isinstance(value, dict) or set(value) - {
        "version", "session_id", "turn_id", "generation", "event", "audio_track", "reason"
    }:
        raise ValueError("schema")
    if type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError("version")
    generation = value.get("generation")
    if type(generation) is not int or not 0 < generation <= 0xFFFFFFFF:
        raise ValueError("generation")
    for key in ("session_id", "turn_id"):
        if not isinstance(value.get(key), str):
            raise ValueError("uuid")
        value[key] = str(uuid.UUID(value[key]))
    if value.get("event") not in events:
        raise ValueError("direction")
    if "audio_track" in value and value["event"] != "started":
        raise ValueError("track")
    if "reason" in value and value["reason"] not in REASONS:
        raise ValueError("reason")
    return value


def pcm(frequency: float, frame_index: int, amplitude: float = 0.2) -> rtc.AudioFrame:
    start = frame_index * SAMPLES
    samples = array("h", (int(32767 * amplitude * math.sin(2 * math.pi * frequency *
                      (start + i) / RATE)) for i in range(SAMPLES)))
    return rtc.AudioFrame(samples.tobytes(), RATE, 1, SAMPLES)


def rms(frame: rtc.AudioFrame) -> float:
    values = frame.data.cast("B").cast("h")
    return math.sqrt(sum(x * x for x in values) / max(1, len(values))) / 32768


@dataclass
class Turn:
    session: str
    turn: str
    generation: int
    source: rtc.AudioSource
    publication: object
    producer: asyncio.Task | None = None
    valid: bool = True


class Evaluator:
    """One configured synthetic client, one connection/session and one live generation."""

    def __init__(self, room: rtc.Room, client_identity: str, record):
        self.room, self.client_identity, self.record = room, client_identity, record
        self.sid: str | None = None
        self.admitted_sid: str | None = None
        self.session: str | None = None
        self.generation = 0
        self.last_turn: str | None = None
        self.used_turns: set[str] = set()
        self.active: Turn | None = None
        self.ended = False
        self.pending_cancel: tuple | None = None
        self.failure: str | None = None
        self.lock = asyncio.Lock()
        self.commands: asyncio.Queue = asyncio.Queue(maxsize=32)
        self.tasks: set[asyncio.Task] = set()
        self.cleanup_scheduled = False
        self.worker = asyncio.create_task(self.consume())
        self.input_tasks: dict[str, asyncio.Task] = {}
        self.input_publication: str | None = None

        @room.on("data_received")
        def received(packet):
            participant = packet.participant
            if packet.topic != TOPIC:
                return
            if (participant is None or participant.identity != client_identity or
                    packet.kind != rtc.DataPacketKind.KIND_RELIABLE):
                self.record("rejected", reason="sender_or_reliability",
                            participant_present=participant is not None,
                            sender_matches=participant is not None and participant.identity == client_identity,
                            kind=int(packet.kind), expected_kind=int(rtc.DataPacketKind.KIND_RELIABLE))
                return
            if participant.sid != self.admitted_sid:
                self.record("rejected", reason="not_admitted")
                return
            try:
                message = decode(packet.data)
                current = (participant.sid, message["session_id"], message["turn_id"], message["generation"])
                if message["event"] in {"interrupt", "stop"} and current == (
                        self.sid, self.session, self.last_turn, self.generation):
                    self.pending_cancel = current
                    if self.active:
                        self.active.valid = False
                self.commands.put_nowait((participant.sid, message))
            except asyncio.QueueFull:
                self.ended = True
                if self.active:
                    self.active.valid = False
                self.record("rejected", reason="capacity_session_closed")
                if not self.cleanup_scheduled:  # one cleanup, never one task per hostile packet
                    self.cleanup_scheduled = True
                    task = asyncio.create_task(self.disconnected())
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
            except (ValueError, TypeError, KeyError):
                self.record("rejected", reason="schema")

        @room.on("participant_connected")
        def joined(participant):
            if participant.identity == client_identity and not self.ended:
                task = asyncio.create_task(self.admit(participant.sid))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

        @room.on("track_published")
        def published(publication, participant):
            if participant.identity == client_identity and publication.kind == rtc.TrackKind.KIND_AUDIO:
                if (self.input_publication is None and not self.ended
                        and participant.sid == self.admitted_sid):
                    self.input_publication = publication.sid
                    publication.set_subscribed(True)
                else:
                    self.record("rejected", reason="input_track_limit")

        @room.on("track_subscribed")
        def subscribed(track, publication, participant):
            if (participant.identity == client_identity and track.kind == rtc.TrackKind.KIND_AUDIO
                    and publication.sid == self.input_publication and not self.ended):
                task = asyncio.create_task(self.detect(track, participant.sid))
                self.input_tasks[publication.sid] = task
            else:
                publication.set_subscribed(False)

        @room.on("track_unpublished")
        def unpublished(publication, participant):
            if participant.identity == client_identity and publication.sid == self.input_publication:
                self.input_publication = None
                task = self.input_tasks.pop(publication.sid, None)
                if task:
                    task.cancel()
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)

        @room.on("participant_disconnected")
        def disconnected(participant):
            if participant.identity == client_identity:
                if self.admitted_sid == participant.sid:
                    self.admitted_sid = None
                # Immediate fence before the async cleanup can yield.
                self.ended = True
                if self.active:
                    self.active.valid = False
                if not self.cleanup_scheduled:
                    self.cleanup_scheduled = True
                    task = asyncio.create_task(self.disconnected())
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)

    async def admit(self, sid):
        participant = self.room.remote_participants.get(self.client_identity)
        if self.ended or participant is None or participant.sid != sid:
            return
        # Admission is established locally before announcing it to the client.
        self.admitted_sid = sid
        try:
            await self.room.local_participant.set_attributes({ADMISSION_ATTRIBUTE: sid})
            self.record("client_admitted", current=not self.ended and self.admitted_sid == sid)
        except Exception as error:
            self.failure = type(error).__name__
            self.ended = True
            self.admitted_sid = None
            self.record("worker_failed", error_type=self.failure)
            await self.disconnected()

    async def send(self, message):
        await self.room.local_participant.publish_data(
            json.dumps(message, separators=(",", ":")).encode(), reliable=True,
            destination_identities=[self.client_identity], topic=TOPIC)
        self.record("sent", **message)

    async def consume(self):
        while True:
            sid, message = await self.commands.get()
            try:
                async with self.lock:
                    await self.command(sid, message)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.failure = type(error).__name__
                self.ended = True
                self.record("worker_failed", error_type=self.failure)
                async with self.lock:
                    with contextlib.suppress(Exception):
                        await self.cancel("disconnect")
                return
            finally:
                self.commands.task_done()

    async def command(self, sid, message):
        session, turn, gen, event = (message[k] for k in
            ("session_id", "turn_id", "generation", "event"))
        if self.ended or (self.sid is not None and (sid != self.sid or session != self.session)):
            self.record("rejected", reason="session_or_terminal", generation=gen)
            return
        if event == "start":
            if self.active is not None or gen <= self.generation or turn in self.used_turns or len(self.used_turns) >= 32:
                self.record("rejected", reason="duplicate_or_stale", generation=gen)
                return
            self.sid, self.session, self.generation, self.last_turn = sid, session, gen, turn
            self.used_turns.add(turn)
            self.pending_cancel = None
            name = f"hps-eval.{session}.{gen}"
            source = rtc.AudioSource(RATE, 1, queue_size_ms=200)
            track = rtc.LocalAudioTrack.create_audio_track(name, source)
            try:
                publication = await self.room.local_participant.publish_track(
                    track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
                active = Turn(session, turn, gen, source, publication)
                self.active = active
                if self.ended:  # disconnect can run while publication awaits
                    await self.cancel("disconnect")
                    return
                if self.pending_cancel is not None:
                    active.valid = False
                    return  # queued matching interrupt/stop owns cleanup and its ack
                await self.send(envelope(session, turn, gen, "started", audio_track=name))
                if self.ended:
                    await self.cancel("disconnect")
                    return
                if self.pending_cancel is not None or self.active is not active or not active.valid:
                    return
                active.producer = asyncio.create_task(self.produce(active))
            except BaseException:
                if self.active:
                    await self.cancel("disconnect")
                else:
                    await source.aclose()
                raise
        elif (sid != self.sid or session != self.session or gen != self.generation or
                turn != self.last_turn):
            self.record("rejected", reason="tuple", generation=gen)
        elif event == "interrupt":
            if self.active is None:
                self.record("rejected", reason="duplicate_interrupt", generation=gen)
                return
            await self.cancel("client_interrupt")
            await self.send(envelope(session, turn, gen, "interrupted", reason="client_interrupt"))
        else:
            self.ended = True
            await self.cancel("client_stop")
            await self.send(envelope(session, turn, gen, "stopped", reason="client_stop"))

    async def capture(self, turn: Turn, frame: rtc.AudioFrame) -> bool:
        if self.active is not turn or not turn.valid or self.ended:
            self.record("late_producer_rejected", generation=turn.generation)
            return False
        await turn.source.capture_frame(frame)
        return True

    async def produce(self, turn: Turn):
        try:
            # Finite synthetic reply. Queue provides actual native backpressure.
            for index in range(1500):  # hard 30s output limit
                if not await self.capture(turn, pcm(440 + 110 * turn.generation, index)):
                    return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.failure = type(error).__name__
            self.ended = True
            self.record("worker_failed", error_type=self.failure)
            async with self.lock:
                await self.cancel("disconnect", from_producer=True)
            return
        finally:
            self.record("producer_finished", generation=turn.generation)
        async with self.lock:
            if self.active is turn:
                await self.cancel("limit", from_producer=True)
                await self.send(envelope(turn.session, turn.turn, turn.generation,
                                         "interrupted", reason="limit"))

    async def cancel(self, reason: str, from_producer=False):
        turn, self.active = self.active, None
        if turn is None:
            return
        turn.valid = False
        before = turn.source.queued_duration
        if turn.producer is not None and not from_producer:
            turn.producer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await turn.producer
        turn.source.clear_queue()
        after = turn.source.queued_duration
        try:
            await self.room.local_participant.unpublish_track(turn.publication.sid)
        finally:
            await turn.source.aclose()
        self.record("cancelled", generation=turn.generation, reason=reason,
                    queued_before_seconds=before, queued_after_seconds=after,
                    publication_removed=True)

    async def detect(self, track, participant_sid):
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        consecutive = 0
        try:
            async for event in stream:
                # This is an energy detector, NOT speech recognition/VAD/AEC.
                energy = rms(event.frame)
                consecutive = consecutive + 1 if energy >= 0.08 else 0
                if consecutive < 3:
                    continue
                consecutive = 0
                async with self.lock:
                    turn = self.active
                    if turn is None or participant_sid != self.sid or self.ended:
                        continue
                    self.record("energy_onset", generation=turn.generation, rms=round(energy, 5))
                    await self.cancel("energy_onset")
                    await self.send(envelope(turn.session, turn.turn, turn.generation,
                                             "interrupted", reason="energy_onset"))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.failure = type(error).__name__
            self.ended = True
            self.record("worker_failed", error_type=self.failure)
            async with self.lock:
                await self.cancel("disconnect")
        finally:
            await stream.aclose()

    async def disconnected(self):
        async with self.lock:
            await self.cancel("disconnect")
            self.record("client_disconnected")
        try:
            await self.room.local_participant.set_attributes({ADMISSION_ATTRIBUTE: ""})
        except Exception as error:
            self.record("attribute_cleanup_failed", error_type=type(error).__name__)

    async def close(self):
        self.ended = True
        self.cleanup_scheduled = True
        self.admitted_sid = None
        self.worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.worker
        for task in self.input_tasks.values():
            task.cancel()
        await asyncio.gather(*self.input_tasks.values(), return_exceptions=True)
        async with self.lock:
            await self.cancel("disconnect")
        for task in tuple(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
