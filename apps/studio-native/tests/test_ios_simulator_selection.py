import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('selection', Path(__file__).parents[1] / 'scripts/select-ios-simulator.py')
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)
PREFIX = 'com.apple.CoreSimulator.SimDeviceType.'


def runtime(name, version, phones, available=True):
    return {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-' + name,
            'version': version, 'isAvailable': available,
            'supportedDeviceTypes': [{'identifier': PREFIX + p} for p in phones]}


class SimulatorSelection(unittest.TestCase):
    def test_selects_supported_phone_without_assuming_old_hardware(self):
        normal = runtime('27-2', '27.2', ['iPhone-17', 'iPhone-18-Pro'])
        special = runtime('27-2-Duo', '27.2', ['iPhone-Duo'])
        expected = (PREFIX + 'iPhone-18-Pro', normal['identifier'])
        self.assertEqual(selection.select({'runtimes': [special, normal]}, '27.2'), expected)
        self.assertEqual(selection.select({'runtimes': [normal, special]}, '27.2'), expected)

    def test_missing_matching_available_phone_fails(self):
        values = [runtime('26-2', '26.2', ['iPhone-16-Pro']),
                  runtime('27-2', '27.2', ['iPhone-18-Pro'], False),
                  runtime('27-2-tablet', '27.2', ['iPad-Pro'])]
        with self.assertRaisesRegex(ValueError, 'No available'):
            selection.select({'runtimes': values}, '27.2')
