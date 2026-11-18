"""Real filesystem publication controls; no network, SDK media, or tokens."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch

import lab


class PublicationControls(unittest.TestCase):
    def test_partial_bytes_are_never_visible_at_the_ready_path(self):
        reached, release = threading.Event(), threading.Event()
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as worker:
            target = Path(directory) / "connection.private.json"
            value = {"synthetic": True, "generation": 1}
            def held_dump(value, stream, **kwargs):
                encoded = json.dumps(value, **kwargs)
                middle = len(encoded) // 2
                stream.write(encoded[:middle]); stream.flush(); reached.set()
                if not release.wait(3):
                    raise TimeoutError("test-owned writer was not released")
                stream.write(encoded[middle:])
            with patch.object(lab.json, "dump", side_effect=held_dump):
                pending = worker.submit(lab.private_json, target, value)
                try:
                    self.assertTrue(reached.wait(3), "writer must actually reach partial bytes")
                    self.assertFalse(target.exists(), "ready path exposed partial JSON")
                finally:
                    release.set(); pending.result(timeout=3)
            self.assertEqual(json.loads(target.read_text()), value)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_existing_destination_and_write_failure_preserve_original_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "receipt.json"
            original = b'{"original":true}\n'
            target.write_bytes(original)
            with self.assertRaises(FileExistsError):
                lab.private_json(target, {"replacement": True})
            self.assertEqual(target.read_bytes(), original)
            missing = Path(directory) / "not-ready.json"
            failure = OSError("synthetic write failure")
            def broken_dump(_value, stream, **_kwargs):
                stream.write('{"incomplete":'); stream.flush(); raise failure
            with patch.object(lab.json, "dump", side_effect=broken_dump):
                with self.assertRaises(OSError) as caught:
                    lab.private_json(missing, {"synthetic": True})
            self.assertIs(caught.exception, failure)
            self.assertFalse(missing.exists(), "failed publication left a ready path")
            self.assertEqual(list(Path(directory).iterdir()), [target])


if __name__ == "__main__":
    unittest.main()
