#!/usr/bin/env python3
"""One owned CI emulator, no MENU input or retry of failed native journeys."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time

NATIVE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("android_environment", NATIVE / "scripts/android-environment.py")
ENVIRONMENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENVIRONMENT)


class Stopped(Exception):
    def __init__(self, reason, code=2):
        self.reason, self.code = reason, code


def stop_owned(process):
    """Only process groups created by this invocation; never adb emu kill/pkill."""
    if process is None:
        return
    def signal_group(sig):
        try:
            os.killpg(process.pid, sig)
            return True
        except ProcessLookupError:
            return False
    # A shell/launcher can exit while its children remain in the owned group.
    # Waiting for only the leader would leave those children running indefinitely.
    signal_group(signal.SIGTERM)
    deadline = time.monotonic() + 5
    while signal_group(0) and time.monotonic() < deadline:
        process.poll()
        time.sleep(.05)
    signal_group(signal.SIGKILL)
    process.wait(timeout=5)


def adb_listener(pid, port):
    """Linux runner proof: the exact foreground PID owns the only loopback listener.

    A successful TCP connection alone could belong to a peer that won the bind
    race. Fail closed when procfs ownership evidence is unavailable.
    """
    sockets = set()
    for path in Path(f"/proc/{pid}/fd").iterdir():
        try:
            sockets.add(path.readlink().as_posix())
        except FileNotFoundError:
            pass  # The owned server can close an unrelated FD while inspected.
    listeners = []
    for family in ("tcp", "tcp6"):
        for line in Path("/proc/net", family).read_text().splitlines()[1:]:
            fields = line.split()
            address, local_port = fields[1].split(":")
            if fields[3] == "0A" and int(local_port, 16) == port:
                listeners.append((family, address, fields[9]))
    if not listeners:
        return None
    if len(listeners) != 1 or listeners[0][:2] != ("tcp", "0100007F") or f"socket:[{listeners[0][2]}]" not in sockets:
        raise Stopped("adb_listener_not_owned_loopback")
    return {"address": "127.0.0.1", "port": port, "pid": pid, "socket_inode": listeners[0][2]}


class Bootstrap:
    def __init__(self, args):
        self.args = args
        self.sdk = args.sdk_root.resolve()
        self.evidence = NATIVE / "evidence/android/bootstrap"
        # Refuse reuse rather than overwrite a failed invocation's diagnostics.
        self.evidence.mkdir(parents=True, exist_ok=False)
        args.work_dir.mkdir(parents=True, exist_ok=True)
        self.work = Path(tempfile.mkdtemp(prefix="studio-android-", dir=args.work_dir))
        self.name = self.work.name
        self.serial = "emulator-" + str(args.port)
        self.env = dict(os.environ, ANDROID_AVD_HOME=str(self.work / "avd"),
                        ANDROID_EMULATOR_HOME=str(self.work / "emulator"), ANDROID_SERIAL=self.serial,
                        ANDROID_USER_HOME=str(self.work / "android-user"),
                        ANDROID_HOME=str(self.sdk), ANDROID_SDK_ROOT=str(self.sdk),
                        PATH=str(self.sdk / "platform-tools") + os.pathsep + os.environ.get("PATH", ""))
        Path(self.env["ANDROID_AVD_HOME"]).mkdir()
        Path(self.env["ANDROID_EMULATOR_HOME"]).mkdir()
        Path(self.env["ANDROID_USER_HOME"]).mkdir()
        self.emulator = None
        self.adb_server = None
        self.verifier = None
        self.owned_device = False
        self.receipt = {"schema": "hps-android-bootstrap/1", "state": "starting", "serial": self.serial,
                        "avd": self.name, "work_dir": str(self.work), "verification_started": False,
                        "phases": {key: "NOT_RUN" for key in ("adb", "bootstrap", "verification", "cleanup")},
                        "source_sha": os.environ.get("GITHUB_SHA"), "commands": [],
                        "recipe": {"api": 35, "target": "google_apis", "arch": "x86_64", "profile": "pixel_6"}}
        self.receipt["recipe_inputs"] = {name: hashlib.sha256((NATIVE / "scripts" / name).read_bytes()).hexdigest()
                                        for name in ("android-emulator.py", "android-verify.sh", "android-environment.py")}

    def command(self, argv, timeout=10, data=None):
        self.receipt["commands"].append([str(v) for v in argv])
        process = subprocess.Popen(argv, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            output, _ = process.communicate(data, timeout=timeout)
            return process.returncode, output
        except subprocess.TimeoutExpired as error:
            (self.evidence / f"command-timeout-{len(self.receipt['commands'])}.log").write_bytes(error.output or b"")
            raise Stopped("command_timeout: " + str(argv[0]), 124)
        finally:
            stop_owned(process)

    def alive(self):
        if self.adb_server is None or self.adb_server.poll() is not None:
            raise Stopped("adb_server_exited")
        if self.emulator is not None and self.emulator.poll() is not None:
            raise Stopped("emulator_exited: " + str(self.emulator.returncode))

    def start_adb(self):
        port = self.args.adb_port
        # Refuse conflicting routing rather than silently dropping a caller's
        # route. Numeric loopback clients do not auto-start a missing server.
        if "ANDROID_ADB_SERVER_ADDRESS" in self.env:
            raise Stopped("unsupported_adb_server_address")
        socket_value = self.env.get("ADB_SERVER_SOCKET")
        if socket_value is not None and socket_value != f"tcp:127.0.0.1:{port}":
            raise Stopped("conflicting_adb_server_socket")
        port_value = self.env.get("ANDROID_ADB_SERVER_PORT")
        if port_value is not None and port_value != str(port):
            raise Stopped("conflicting_adb_server_port")
        self.env.update(ADB_SERVER_SOCKET=f"tcp:127.0.0.1:{port}", ANDROID_ADB_SERVER_PORT=str(port))
        self.receipt["adb_environment"] = {key: self.env[key] for key in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_PORT")}
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", port))
        tools = {}
        for name, relative, flag in (("adb", "platform-tools/adb", "version"), ("emulator", "emulator/emulator", "-version")):
            path = self.sdk / relative
            code, output = self.command([str(path), flag])
            (self.evidence / (name + "-version.txt")).write_bytes(output)
            if code:
                raise Stopped(name + "_version_failed")
            tools[name] = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        self.receipt["tools"] = tools
        argv = [str(self.sdk / "platform-tools/adb"), "-L", f"tcp:{port}", "nodaemon", "server"]
        self.receipt["commands"].append(argv)
        with (self.evidence / "adb-server.log").open("wb") as log:
            self.adb_server = subprocess.Popen(argv, env=self.env, stdout=log, stderr=subprocess.STDOUT,
                                               start_new_session=True)
        self.receipt["adb_server_pid"] = self.adb_server.pid
        deadline = time.monotonic() + 10
        while True:
            self.alive()
            listener = adb_listener(self.adb_server.pid, port)
            if listener:
                self.receipt["adb_listener"] = listener
                return
            if time.monotonic() >= deadline:
                raise Stopped("adb_listener_timeout", 124)
            time.sleep(.05)

    def adb(self, *argv, timeout=5):
        self.alive()
        result = self.command([str(self.sdk / "platform-tools/adb"), "-s", self.serial, *argv], timeout)
        self.alive()
        return result

    def remaining(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Stopped("boot_or_focus_timeout", 124)
        return min(5, remaining)

    def observe(self, number, deadline):
        inputs = {}
        for kind in ("window", "power"):
            code, output = self.adb("shell", "dumpsys", kind, timeout=self.remaining(deadline))
            (self.evidence / f"readiness-{number}-{kind}.txt").write_bytes(output)
            if code:
                raise Stopped("readiness_command_failed: " + kind)
            inputs[kind] = output
        result = ENVIRONMENT.inspect(inputs["window"].decode(), inputs["power"].decode())
        result["inputs"] = {key + "_sha256": hashlib.sha256(value).hexdigest() for key, value in inputs.items()}
        (self.evidence / f"readiness-{number}.json").write_text(json.dumps(result, indent=2) + "\n")
        if result["reason"] in ("foreign_anr", "studio_anr", "foreground_error_dialog"):
            raise Stopped(result["reason"])
        return result

    def start(self):
        avdmanager = self.sdk / "cmdline-tools/latest/bin/avdmanager"
        code, output = self.command([str(avdmanager), "create", "avd", "--name", self.name,
                                     "--package", "system-images;android-35;google_apis;x86_64",
                                     "--device", "pixel_6"], timeout=60, data=b"no\n")
        (self.evidence / "avd-create.log").write_bytes(output)
        if code:
            raise Stopped("avd_creation_failed")
        config = Path(self.env["ANDROID_AVD_HOME"]) / (self.name + ".avd/config.ini")
        with config.open("a") as stream:
            stream.write("\nhw.cpu.ncore=2\nhw.ramSize=2560\n")
        (self.evidence / "avd-config.ini").write_bytes(config.read_bytes())
        # Fail if either port is occupied. AVD-name verification also fences the
        # small race between releasing these reservations and emulator binding.
        sockets = []
        try:
            for port in (self.args.port, self.args.port + 1):
                sock = socket.socket(); sockets.append(sock)
                sock.bind(("127.0.0.1", port))
        finally:
            for sock in sockets:
                sock.close()
        argv = [str(self.sdk / "emulator/emulator"), "-avd", self.name, "-port", str(self.args.port),
                "-no-window", "-gpu", "swiftshader_indirect", "-no-snapshot", "-noaudio", "-no-boot-anim"]
        self.receipt["commands"].append(argv)
        with (self.evidence / "emulator.log").open("wb") as log:
            self.emulator = subprocess.Popen(argv, env=self.env, stdout=log, stderr=subprocess.STDOUT,
                                             start_new_session=True)
        self.receipt["emulator_pid"] = self.emulator.pid
        deadline = time.monotonic() + self.args.boot_timeout
        while True:
            code, name = self.adb("emu", "avd", "name", timeout=self.remaining(deadline))
            if code == 0 and name.decode().splitlines()[:1] == [self.name]:
                code, qemu = self.adb("shell", "getprop", "ro.kernel.qemu", timeout=self.remaining(deadline))
                if code == 0 and qemu.strip() == b"1":
                    self.owned_device = True
                    break
            elif code == 0 and name.strip():
                raise Stopped("serial_owned_by_another_avd")
            time.sleep(min(self.args.poll_interval, self.remaining(deadline)))
        while True:
            code, boot = self.adb("shell", "getprop", "sys.boot_completed", timeout=self.remaining(deadline))
            if code == 0 and boot.strip() == b"1":
                break
            time.sleep(min(self.args.poll_interval, self.remaining(deadline)))
        code, properties = self.adb("shell", "getprop", timeout=self.remaining(deadline))
        (self.evidence / "device-properties.txt").write_bytes(properties)
        if code:
            raise Stopped("device_properties_unavailable")
        # Read before preparation as well: never conceal an existing error dialog.
        self.observe(0, deadline)
        for command in [("shell", "input", "keyevent", "KEYCODE_WAKEUP"),
                        ("shell", "wm", "dismiss-keyguard"),
                        ("shell", "settings", "put", "global", "window_animation_scale", "0.0"),
                        ("shell", "settings", "put", "global", "transition_animation_scale", "0.0"),
                        ("shell", "settings", "put", "global", "animator_duration_scale", "0.0")]:
            code, _ = self.adb(*command, timeout=self.remaining(deadline))
            if code:
                raise Stopped("device_preparation_failed")
        stable, previous, number = 0, None, 0
        while stable < 3:
            number += 1
            result = self.observe(number, deadline)
            focus = result["focus"] if result["status"] == "ready" else None
            stable = stable + 1 if focus and focus == previous else (1 if focus else 0)
            previous = focus
            if stable < 3:
                time.sleep(min(self.args.poll_interval, self.remaining(deadline)))
        self.receipt["stable_focus_observations"] = stable

    def verify(self):
        self.alive()
        self.receipt["verification_started"] = True
        with (self.evidence / "verification.log").open("wb") as log:
            self.verifier = subprocess.Popen(["bash", str(NATIVE / "scripts/android-verify.sh")], env=self.env,
                                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + self.args.test_timeout
            while self.verifier.poll() is None:
                self.alive()
                if time.monotonic() >= deadline:
                    raise Stopped("native_verification_timeout", 124)
                time.sleep(0.1)
            self.receipt["verification_exit_code"] = self.verifier.returncode
            self.alive()
            # Main owns cleanup independently; a cleanup exception must not
            # overwrite the native command's already observed exit status.
            return self.verifier.returncode

    def capture_failure(self):
        if not self.owned_device or self.emulator.poll() is not None or self.adb_server.poll() is not None:
            return
        # Recheck ownership before diagnostics; never interact with a replacement.
        deadline = time.monotonic() + 5
        code, name = self.adb("emu", "avd", "name", timeout=self.remaining(deadline))
        if code or name.decode().splitlines()[:1] != [self.name]:
            return
        for label, command in [("window", ["shell", "dumpsys", "window"]),
                               ("activity", ["shell", "dumpsys", "activity", "lastanr"]),
                               ("input", ["shell", "dumpsys", "input"]),
                               ("logcat", ["logcat", "-d", "-b", "main", "-b", "system", "-b", "crash", "-t", "1000"]),
                               ("screen.png", ["exec-out", "screencap", "-p"])]:
            try:
                code, output = self.adb(*command, timeout=self.remaining(deadline))
                (self.evidence / ("failure-" + label)).write_bytes(output)
            except (Stopped, OSError) as error:
                self.receipt.setdefault("diagnostic_errors", []).append(str(error))
                break


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=5554)
    parser.add_argument("--adb-port", type=int, default=5047)
    parser.add_argument("--boot-timeout", type=float, default=180)
    parser.add_argument("--test-timeout", type=float, default=600)
    parser.add_argument("--poll-interval", type=float, default=1)
    args = parser.parse_args()
    if not (1024 <= args.port <= 5682 and args.port % 2 == 0
            and 1024 <= args.adb_port <= 65535 and args.adb_port not in (5037, args.port, args.port + 1)
            and 0 < args.boot_timeout <= 600
            and 0 < args.test_timeout <= 900 and 0 < args.poll_interval <= 5):
        parser.error("invalid bounded emulator settings")
    bootstrap = Bootstrap(args)
    def interrupted(signum, _frame):
        raise Stopped("signal_" + str(signum), 128 + signum)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    code = 2
    phase = "adb"
    try:
        bootstrap.receipt["phases"][phase] = "RUNNING"
        bootstrap.start_adb()
        bootstrap.receipt["phases"][phase] = "PASS"
        phase = "bootstrap"
        bootstrap.receipt["phases"][phase] = "RUNNING"
        bootstrap.start()
        bootstrap.receipt["phases"][phase] = "PASS"
        phase = "verification"
        bootstrap.receipt["phases"][phase] = "RUNNING"
        code = bootstrap.verify()
        bootstrap.receipt["phases"][phase] = "PASS" if code == 0 else "FAIL"
        bootstrap.receipt["verification_exit_code"] = code
        if code < 0:
            code = 128 - code
        bootstrap.receipt["state"] = "verified" if code == 0 else "native_verification_failed"
    except Exception as error:
        native_code = bootstrap.receipt.get("verification_exit_code")
        code = native_code if native_code else (error.code if isinstance(error, Stopped) else 2)
        if code < 0:
            code = 128 - code
        bootstrap.receipt["phases"][phase] = "FAIL"
        bootstrap.receipt.update(state="failed", reason=error.reason if isinstance(error, Stopped) else str(error))
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, signal.SIG_IGN)
        bootstrap.receipt["phases"]["cleanup"] = "PASS"
        def cleanup(name, process):
            nonlocal code
            try:
                stop_owned(process)
            except Exception as error:
                code = code or 2
                bootstrap.receipt["phases"]["cleanup"] = "FAIL"
                bootstrap.receipt.setdefault("cleanup_errors", {})[name] = str(error)
                bootstrap.receipt["state"] = "cleanup_failed"
            bootstrap.receipt[name + "_reaped"] = process is None or process.poll() is not None
        cleanup("verifier", bootstrap.verifier)
        try:
            # Cancellation spends its budget reaping owned groups, not issuing
            # new ADB diagnostics. Normal failure capture has one five-second
            # deadline (plus at most ten seconds to reap its last command).
            if code and code not in (124, 130, 143):
                bootstrap.capture_failure()
        except Exception as error:
            bootstrap.receipt["capture_error"] = str(error)
        finally:
            for name, process in (("emulator", bootstrap.emulator), ("adb_server", bootstrap.adb_server)):
                cleanup(name, process)
            if code == 0:
                bootstrap.receipt["state"] = "passed"
            bootstrap.receipt["exit_code"] = code
            (bootstrap.evidence / "receipt.json").write_text(json.dumps(bootstrap.receipt, indent=2) + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
