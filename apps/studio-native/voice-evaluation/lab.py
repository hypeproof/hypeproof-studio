#!/usr/bin/env python3
"""Ephemeral loopback-only LiveKit lab; run inside the shared resource allocation."""
from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import hashlib
import hmac
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import secrets
import signal
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
import wave

from livekit import rtc
from runtime import Evaluator, TOPIC, ADMISSION_ATTRIBUTE, RATE, decode, envelope, pcm, rms

EVALUATOR_ID = "hps-voice-evaluator"
CLIENT_ID = "hps-voice-client"


def jwt(key, secret, room, identity):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
    now = int(time.time())
    body = b".".join((encode({"alg": "HS256", "typ": "JWT"}), encode({
        "iss": key, "sub": identity, "nbf": now - 5, "exp": now + 900,
        "video": {"roomJoin": True, "room": room, "canPublish": True,
                  "canSubscribe": True, "canPublishData": True,
                  "canUpdateOwnMetadata": identity == EVALUATOR_ID}})))
    return (body + b"." + base64.urlsafe_b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).rstrip(b"=")).decode()


def free_port(kind):
    with socket.socket(socket.AF_INET, kind) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def private_json(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump(value, file, indent=2)
        file.write("\n")


async def until(predicate, timeout=8, label="condition"):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"timeout: {label}")


class Receiver:
    """Records decoded remote PCM, not device/acoustic playout."""
    def __init__(self, room, output, record):
        self.room, self.output, self.record = room, output, record
        self.events, self.frames, self.unpublished, self.tasks = [], {}, set(), []
        self.authorized, self.blocked = set(), set()
        self.received_pcm = {}
        self.publications = {}
        self.active = None
        self.ended = False

        @room.on("data_received")
        def data(packet):
            if (packet.topic != TOPIC or packet.participant is None or
                    packet.participant.identity != EVALUATOR_ID or
                    packet.kind != rtc.DataPacketKind.KIND_RELIABLE):
                return
            try:
                message = decode(packet.data, {"started", "interrupted", "stopped"})
            except (ValueError, TypeError):
                return
            self.events.append(message)
            self.record("receiver_event", **message)
            key = tuple(message[k] for k in ("session_id", "turn_id", "generation"))
            if key != self.active or self.ended:
                self.record("receiver_rejected", reason="tuple_or_terminal")
                return
            if message["event"] == "started":
                name = f"hps-eval.{key[0]}.{key[2]}"
                if key in self.blocked or message.get("audio_track") != name:
                    self.record("receiver_rejected", reason="canceled_or_track")
                    return
                self.authorized.add(name)
                publication = self.publications.get(name)
                if publication:
                    publication.set_subscribed(True)
            else:
                self.block()
                if message["event"] == "stopped":
                    self.ended = True

        @room.on("track_published")
        def published(publication, participant):
            if participant.identity != EVALUATOR_ID:
                return
            self.publications[publication.name] = publication
            if publication.name in self.authorized:
                publication.set_subscribed(True)

        @room.on("track_unpublished")
        def unpublished(publication, participant):
            if participant.identity == EVALUATOR_ID:
                self.unpublished.add(publication.name)
                self.record("receiver_unpublished", audio_track=publication.name)

        @room.on("track_subscribed")
        def subscribed(track, publication, participant):
            if participant.identity == EVALUATOR_ID and publication.name in self.authorized:
                task = asyncio.create_task(self.read(track, publication.name))
                self.tasks.append(task)

    def block(self):
        if self.active:
            self.blocked.add(self.active)
            name = f"hps-eval.{self.active[0]}.{self.active[2]}"
            self.authorized.discard(name)
            publication = self.publications.get(name)
            if publication:
                publication.set_subscribed(False)

    async def read(self, track, name):
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        self.frames.setdefault(name, [])
        self.received_pcm.setdefault(name, bytearray())
        try:
            async for event in stream:
                self.frames[name].append({"at": time.monotonic(), "rms": rms(event.frame),
                                          "samples": event.frame.samples_per_channel})
                self.received_pcm[name].extend(event.frame.data.cast("B"))
                if len(self.received_pcm[name]) > RATE * 2 * 35:
                    raise AssertionError("receiver PCM bound exceeded")
        finally:
            await stream.aclose()

    async def close(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for name, data in self.received_pcm.items():
            path = self.output / f"{name}.wav"
            with wave.open(str(path), "wb") as file:
                file.setnchannels(1); file.setsampwidth(2); file.setframerate(RATE)
                file.writeframes(data)
            os.chmod(path, 0o600)
            private_json(self.output / f"{name}.frames.json", {
                "kind": "decoded_remote_pcm_not_acoustic_playout", "sample_rate": RATE,
                "frames": self.frames[name], "pcm_sha256": hashlib.sha256(data).hexdigest()})


async def connect(room, url, token):
    # A local-only ICE server entry avoids the SDK's SFU default STUN fallback.
    # No TURN/cloud host is configured. The unused loopback port is intentional.
    options = rtc.RoomOptions(auto_subscribe=False, connect_timeout=5,
        rtc_config=rtc.RtcConfiguration(ice_servers=[rtc.IceServer(urls=["stun:127.0.0.1:9"])]))
    await asyncio.wait_for(room.connect(url, token, options=options), 12)


def admitted(room):
    participant = room.remote_participants.get(EVALUATOR_ID)
    return (participant is not None and bool(room.local_participant.sid) and
            participant.attributes.get(ADMISSION_ATTRIBUTE) == room.local_participant.sid)


async def scenario(url, key, secret, output, record, disconnect_only=False):
    room_name = "hps-eval-" + str(uuid.uuid4())
    agent_room, client, stranger = rtc.Room(), rtc.Room(), rtc.Room()
    observed = []
    def observe(observation, **fields):
        observed.append(dict(observation=observation, **fields))
        record(observation, **fields)
    evaluator = Evaluator(agent_room, CLIENT_ID, observe)
    admission_gate = asyncio.Event()
    real_admit = evaluator.admit
    async def held_admit(sid):
        await admission_gate.wait()
        await real_admit(sid)
    evaluator.admit = held_admit
    receiver = Receiver(client, output, record)
    source = None
    try:
        await connect(agent_room, url, jwt(key, secret, room_name, EVALUATOR_ID))
        await connect(client, url, jwt(key, secret, room_name, CLIENT_ID))
        if not disconnect_only:
            await client.local_participant.publish_data(json.dumps(envelope(
                str(uuid.uuid4()), str(uuid.uuid4()), 1, "start")), reliable=True,
                destination_identities=[EVALUATOR_ID], topic=TOPIC)
            await until(lambda: any(e["observation"] == "rejected" for e in observed),
                        label="pre-admission actual channel refusal")
            assert evaluator.active is None and evaluator.session is None
            record("control_pass", control="real_pre_admission_start_rejected")
        admission_gate.set()
        await until(lambda: admitted(client), label="exact evaluator/current client SID admission")
        session, turn = str(uuid.uuid4()), str(uuid.uuid4())
        receiver.active = (session, turn, 1)
        async def send(event, generation=1, turn_id=turn, sender=client):
            await sender.local_participant.publish_data(json.dumps(envelope(
                session, turn_id, generation, event)), reliable=True,
                destination_identities=[EVALUATOR_ID], topic=TOPIC)
        record("before_start_registration", evaluator_sees_client=CLIENT_ID in agent_room.remote_participants,
               client_sees_evaluator=EVALUATOR_ID in client.remote_participants)
        await send("start")
        name = f"hps-eval.{session}.1"
        await until(lambda: sum(f["rms"] > .02 for f in receiver.frames.get(name, [])) >= 10,
                    label="actual decoded reply PCM")
        old = evaluator.active
        assert old is not None
        if disconnect_only:
            await client.disconnect()
            await until(lambda: evaluator.ended and evaluator.active is None, label="disconnect cancels source")
            assert not await evaluator.capture(old, pcm(1200, 0))
            record("control_pass", control="disconnect_fences_late_producer")
            return

        before = len(receiver.events)
        await send("start")
        await connect(stranger, url, jwt(key, secret, room_name, "stranger"))
        await send("stop", sender=stranger)
        await asyncio.sleep(.15)
        assert evaluator.active is old and len(receiver.events) == before
        record("control_pass", control="real_channel_duplicate_and_stranger_rejected")

        source = rtc.AudioSource(RATE, 1, queue_size_ms=100)
        input_track = rtc.LocalAudioTrack.create_audio_track("synthetic-input", source)
        await client.local_participant.publish_track(input_track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        for i in range(20):
            await source.capture_frame(pcm(220, i, .01))
        await source.wait_for_playout()
        assert evaluator.active is old, "quiet PCM must not trigger energy interrupt"
        for i in range(20):
            await source.capture_frame(pcm(220, i, .4))
        await until(lambda: any(e["event"] == "interrupted" and e.get("reason") == "energy_onset"
                               for e in receiver.events), label="actual incoming PCM onset interruption")
        await until(lambda: name in receiver.unpublished, label="old track unpublished")
        assert evaluator.active is None and old.source.queued_duration == 0
        assert not await evaluator.capture(old, pcm(1200, 0))
        await asyncio.sleep(.2)  # explicitly measured decoded-packet tail, not acoustic guarantee
        count = len(receiver.frames[name])
        await asyncio.sleep(.3)
        assert len(receiver.frames[name]) == count, "old generation kept delivering decoded frames"
        record("control_pass", control="energy_interrupt_queue_discard_pcm_ceased",
               decoded_frames=count, acoustic_played_range="unknown")

        source.clear_queue()
        await client.local_participant.unpublish_track(next(iter(client.local_participant.track_publications)))
        await asyncio.sleep(.15)  # drain preceding input packets before explicit next generation
        second = str(uuid.uuid4())
        receiver.active = (session, second, 2)
        await send("start", generation=2, turn_id=second)
        name2 = f"hps-eval.{session}.2"
        await until(lambda: len(receiver.frames.get(name2, [])) >= 10, label="generation 2 PCM")
        await send("interrupt")  # old tuple cannot cancel generation 2
        await asyncio.sleep(.1)
        assert evaluator.active is not None and evaluator.active.generation == 2
        current = evaluator.active
        receiver.block()  # immediate client block BEFORE transport/ack
        await send("stop", generation=2, turn_id=second)
        await until(lambda: any(e["event"] == "stopped" for e in receiver.events), label="stop ack")
        assert evaluator.ended and evaluator.active is None
        assert not await evaluator.capture(current, pcm(1200, 0))
        terminal_count = len(receiver.events)
        await send("stop", generation=2, turn_id=second)
        await send("start", generation=3, turn_id=str(uuid.uuid4()))
        # Deliver a genuinely late server event over the data channel.
        await evaluator.send(envelope(session, second, 2, "started", audio_track=name2))
        await asyncio.sleep(.2)
        assert evaluator.active is None and receiver.ended and not receiver.authorized
        assert len(receiver.events) == terminal_count + 1
        record("control_pass", control="stop_duplicate_stale_and_late_started_fenced")
    finally:
        await receiver.close()
        if source:
            source.clear_queue(); await source.aclose()
        assert evaluator.failure is None, f"evaluator worker failed: {evaluator.failure}"
        await evaluator.close()
        for room in (stranger, client, agent_room):
            await room.disconnect()



async def capacity_scenario(url, key, secret, record):
    room_name = "hps-eval-" + str(uuid.uuid4())
    room, client = rtc.Room(), rtc.Room()
    evaluator = Evaluator(room, CLIENT_ID, record)
    session, turn = str(uuid.uuid4()), str(uuid.uuid4())
    payload = json.dumps(envelope(session, turn, 1, "start"))
    async def send():
        await client.local_participant.publish_data(payload, reliable=True,
            destination_identities=[EVALUATOR_ID], topic=TOPIC)
    try:
        await connect(room, url, jwt(key, secret, room_name, EVALUATOR_ID))
        await connect(client, url, jwt(key, secret, room_name, CLIENT_ID))
        await until(lambda: admitted(client), label="capacity case admission")
        await send()
        await until(lambda: evaluator.active is not None and evaluator.active.producer is not None,
                    label="capacity control actual publication")
        async with evaluator.lock:  # controlled handler hold, still real incoming data packets
            for _ in range(36):
                await send()
            await until(lambda: evaluator.ended, label="queue overflow terminal fence")
            assert evaluator.active is not None and not evaluator.active.valid
        await until(lambda: evaluator.active is None, label="queue overflow owned cleanup")
        assert not room.local_participant.track_publications
        record("control_pass", control="bounded_real_channel_overflow_fail_closed")
    finally:
        await evaluator.close()
        await client.disconnect()
        await room.disconnect()


async def failed_ack_scenario(url, key, secret, record):
    """Actual publication, then an injected data-send failure; no silent worker death."""
    room_name = "hps-eval-" + str(uuid.uuid4())
    room, client = rtc.Room(), rtc.Room()
    evaluator = Evaluator(room, CLIENT_ID, record)
    async def reject_ack(message):
        raise ConnectionError("injected acknowledgement transport failure")
    evaluator.send = reject_ack
    try:
        await connect(room, url, jwt(key, secret, room_name, EVALUATOR_ID))
        await connect(client, url, jwt(key, secret, room_name, CLIENT_ID))
        await until(lambda: admitted(client), label="failure case admission")
        await client.local_participant.publish_data(json.dumps(envelope(
            str(uuid.uuid4()), str(uuid.uuid4()), 1, "start")), reliable=True,
            destination_identities=[EVALUATOR_ID], topic=TOPIC)
        await until(lambda: evaluator.failure is not None and evaluator.worker.done(),
                    label="injected failed ack fail-closed")
        assert evaluator.ended and evaluator.active is None
        assert not room.local_participant.track_publications
        record("control_pass", control="actual_publication_injected_ack_failure_cleanup")
    finally:
        await evaluator.close()
        await client.disconnect()
        await room.disconnect()


async def serve(url, key, secret, output, record, seconds):
    room_name = "hps-eval-" + str(uuid.uuid4())
    room = rtc.Room()
    evaluator = Evaluator(room, CLIENT_ID, record)
    try:
        await connect(room, url, jwt(key, secret, room_name, EVALUATOR_ID))
        private_json(output / "connection.private.json", {
            "url": url, "token": jwt(key, secret, room_name, CLIENT_ID),
            "evaluator_identity": EVALUATOR_ID, "client_identity": CLIENT_ID,
            "expires_at": int(time.time()) + min(seconds, 900)})
        await asyncio.sleep(seconds)
        if evaluator.failure:
            raise RuntimeError("evaluator worker failed: " + evaluator.failure)
    finally:
        await evaluator.close()
        await room.disconnect()
        (output / "connection.private.json").unlink(missing_ok=True)


def socket_evidence(pid):
    if platform.system() != "Linux":
        raise RuntimeError("automated socket proof currently requires Linux ss; native simulator remains separate")
    result = subprocess.run(["ss", "-lnptu"], check=True, capture_output=True, text=True)
    owned = [line for line in result.stdout.splitlines() if f"pid={pid}," in line]
    if not owned or any(not line.split()[4].startswith("127.0.0.1:") for line in owned):
        raise AssertionError("server has missing or non-loopback listeners")
    return owned


async def main(args):
    os.umask(0o077)
    loop, owner = asyncio.get_running_loop(), asyncio.current_task()
    for sig in (signal.SIGTERM, signal.SIGHUP):
        loop.add_signal_handler(sig, owner.cancel)
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    events, started = [], time.monotonic()
    def record(observation, **fields):
        events.append(dict(at_ms=round((time.monotonic() - started) * 1000, 3), observation=observation, **fields))
    binary = Path(args.server).resolve()
    version = subprocess.run([str(binary), "--version"], check=True, capture_output=True, text=True).stdout.strip()
    pins = json.loads(Path(__file__).with_name("pins.json").read_text())
    if pins["server_version"] not in version or importlib.metadata.version("livekit") != pins["rtc_version"]:
        raise RuntimeError("pinned dependency mismatch")
    key, secret = "eval" + secrets.token_hex(8), secrets.token_hex(32)
    signal_port, media = free_port(socket.SOCK_STREAM), free_port(socket.SOCK_DGRAM)
    config = {"port": signal_port, "bind_addresses": ["127.0.0.1"], "development": True,
              "keys": {key: secret}, "rtc": {"tcp_port": 0, "udp_port": media,
              "use_external_ip": False, "node_ip": "127.0.0.1", "stun_servers": [],
              "enable_loopback_candidate": True, "interfaces": {"includes": ["lo"]},
              "ips": {"includes": ["127.0.0.1/32"]}}, "logging": {"level": "warn"}}
    result = {"status": "FAIL", "kind": "synthetic_loopback_media", "hostname": socket.gethostname(),
              "sdk": importlib.metadata.version("livekit"), "server": version,
              "server_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
              "physical_audio": "NOT_RUN", "speech_recognition": "NOT_RUN", "aec": "NOT_RUN"}
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix="hps-livekit-") as private:
            config_path = Path(private) / "server.json"
            private_json(config_path, config)  # JSON is valid YAML; credentials never printed.
            with (output / "server.log").open("xb") as log:
                process = subprocess.Popen([str(binary), "--config", str(config_path)], stdout=log, stderr=log)
                url = f"ws://127.0.0.1:{signal_port}"
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("server exited before readiness")
                    try:
                        with socket.create_connection(("127.0.0.1", signal_port), timeout=.05):
                            break
                    except OSError:
                        await asyncio.sleep(.05)
                else:
                    raise RuntimeError("server readiness timed out")
                result["listeners"] = socket_evidence(process.pid)
                if args.serve_seconds:
                    if not 1 <= args.serve_seconds <= 600:
                        raise ValueError("serve duration must be 1..600 seconds")
                    result["kind"] = "bounded_manual_media_server"
                    await serve(url, key, secret, output, record, args.serve_seconds)
                else:
                    await asyncio.wait_for(scenario(url, key, secret, output, record), 35)
                    await asyncio.wait_for(scenario(url, key, secret, output, record, disconnect_only=True), 20)
                    await asyncio.wait_for(failed_ack_scenario(url, key, secret, record), 20)
                    await asyncio.wait_for(capacity_scenario(url, key, secret, record), 20)
                result["listeners_after"] = socket_evidence(process.pid)
                result["status"] = "PASS"
    except BaseException as error:
        result["error_type"] = type(error).__name__
        result["error"] = str(error)[:500]
        raise
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
            result["owned_server_reaped"] = process.returncode is not None
        result["duration_seconds"] = round(time.monotonic() - started, 3)
        private_json(output / "events.json", events)
        private_json(output / "result.json", result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--serve-seconds", type=int, default=0)
    asyncio.run(main(parser.parse_args()))
