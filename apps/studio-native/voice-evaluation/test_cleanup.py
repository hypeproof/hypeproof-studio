"""Failure controls invoke real serve/scenario cleanup with synthetic resource faults."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import lab


class CleanupControls(unittest.IsolatedAsyncioTestCase):
    def resources(self, *, worker_failure=None, receiver_error=None, room_error=None):
        calls = []
        close_error = OSError('injected evaluator close')

        class Room:
            def __init__(self):
                self.index = sum(c[0] == 'created' for c in calls)
                calls.append(('created', self.index))

            def on(self, event):
                return lambda callback: callback

            async def disconnect(self):
                calls.append(('disconnect', self.index))
                if room_error is not None:
                    raise room_error

        class Evaluator:
            failure = worker_failure
            session, last_turn, generation = None, None, 0
            def __init__(self, *args):
                pass

            async def admit(self, sid):
                pass

            async def close(self):
                calls.append(('evaluator_close', None))
                raise close_error

        class Receiver:
            def __init__(self, *args):
                pass

            async def close(self):
                calls.append(('receiver_close', None))
                if receiver_error is not None:
                    raise receiver_error

        return calls, close_error, Room, Evaluator, Receiver

    async def test_serve_close_failure_disconnects_and_removes_real_private_file(self):
        calls, failure, room, evaluator, _ = self.resources()
        async def connect(*args):
            pass
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(lab.rtc, 'Room', room), patch.object(lab, 'Evaluator', evaluator), \
                 patch.object(lab, 'connect', connect):
                with self.assertRaises(OSError) as caught:
                    await lab.serve('ws://127.0.0.1:1', 'synthetic', 'synthetic', output,
                                    lambda *args, **kwargs: None, 0)
            self.assertIs(caught.exception, failure)
            self.assertIn(('disconnect', 0), calls)
            self.assertFalse((output / 'connection.private.json').exists())

    async def test_body_failure_survives_close_and_disconnect_failure(self):
        calls, _, room, evaluator, _ = self.resources(worker_failure='injected_worker',
                                                     room_error=ConnectionError('injected disconnect'))
        async def connect(*args):
            pass
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(lab.rtc, 'Room', room), patch.object(lab, 'Evaluator', evaluator), \
                 patch.object(lab, 'connect', connect):
                with self.assertRaisesRegex(RuntimeError, '^evaluator worker failed: injected_worker$'):
                    await lab.serve('ws://127.0.0.1:1', 'synthetic', 'synthetic', output,
                                    lambda *args, **kwargs: None, 0)
            self.assertIn(('disconnect', 0), calls)
            self.assertFalse((output / 'connection.private.json').exists())

    async def test_scenario_preserves_original_failure_and_attempts_all_three_rooms(self):
        primary = AssertionError('injected original scenario failure')
        calls, _, room, evaluator, receiver = self.resources(
            receiver_error=OSError('injected receiver close'), room_error=OSError('injected disconnect'))
        async def connect(*args):
            raise primary
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(lab.rtc, 'Room', room), patch.object(lab, 'Evaluator', evaluator), \
                 patch.object(lab, 'Receiver', receiver), patch.object(lab, 'connect', connect):
                with self.assertRaises(AssertionError) as caught:
                    await lab.scenario('ws://127.0.0.1:1', 'synthetic', 'synthetic', Path(directory),
                                       lambda *args, **kwargs: None)
        self.assertIs(caught.exception, primary)
        self.assertEqual([item for item in calls if item[0] == 'disconnect'],
                         [('disconnect', 2), ('disconnect', 1), ('disconnect', 0)])
        self.assertIn(('evaluator_close', None), calls)

    async def test_worker_failure_does_not_skip_source_or_room_release(self):
        calls, _, room, evaluator, _ = self.resources(worker_failure='controlled_failure')
        class Source:
            def clear_queue(self):
                calls.append(('clear_queue', None))
                raise OSError('injected clear failure')
            async def aclose(self):
                calls.append(('source_close', None))
        with self.assertRaisesRegex(AssertionError, '^evaluator worker failed: controlled_failure$'):
            await lab.cleanup_owned(lambda *args, **kwargs: None, evaluator=evaluator(),
                                    source=Source(), rooms=(room(),), check_worker=True)
        self.assertIn(('source_close', None), calls)
        self.assertIn(('evaluator_close', None), calls)
        self.assertIn(('disconnect', 0), calls)


if __name__ == '__main__':
    unittest.main()
