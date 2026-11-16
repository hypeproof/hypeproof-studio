import json
from pathlib import Path
import unittest

from runtime import decode, TOPIC, ADMISSION_ATTRIBUTE
from lab import EVALUATOR_ID, CLIENT_ID


class WireContract(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(Path(__file__).with_name('wire-fixture.json').read_text())

    def test_shared_native_wire_fixture(self):
        self.assertEqual(self.fixture['topic'], TOPIC)
        self.assertEqual(self.fixture['admission_attribute'], ADMISSION_ATTRIBUTE)
        self.assertEqual(self.fixture['evaluator_identity'], EVALUATOR_ID)
        self.assertEqual(self.fixture['client_identity'], CLIENT_ID)
        for value in self.fixture['events']:
            self.assertEqual(decode(json.dumps(value).encode(), {'start', 'started', 'interrupt',
                'interrupted', 'stop', 'stopped'}), value)

    def test_untrusted_schema_never_becomes_command(self):
        original = self.fixture['events'][0]
        changes = [dict(generation=True), dict(generation=0), dict(generation=2**32),
                   dict(version=True), dict(session_id='not-a-uuid'), dict(token='secret'),
                   dict(reason='arbitrary text'), dict(event='started')]
        for delta in changes:
            with self.subTest(delta=delta):
                with self.assertRaises(ValueError):
                    decode(json.dumps(dict(original, **delta)).encode())
        with self.assertRaises(ValueError):
            decode(b' ' * 1025)

    def test_uuid_case_is_normalized_but_identity_not_weakened(self):
        value = dict(self.fixture['events'][0], session_id='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')
        self.assertEqual(decode(json.dumps(value).encode())['session_id'], value['session_id'].lower())
        self.assertNotEqual(EVALUATOR_ID, 'evaluator')


if __name__ == '__main__':
    unittest.main()
