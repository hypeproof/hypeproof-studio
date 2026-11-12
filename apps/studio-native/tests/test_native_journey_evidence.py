"""Evidence parser controls, not a simulation of successful product journeys."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/collect-native-journeys.py'
SPEC = importlib.util.spec_from_file_location('journey_evidence', SCRIPT)
journey = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(journey)
SHA = 'a' * 40

def case(name, state='passed'):
    return f"Test Case '-[HPStudioUITests.StudioJourneyTests {name}]' started.\nTest Case '-[HPStudioUITests.StudioJourneyTests {name}]' {state} (1.000 seconds).\n"

class JourneyEvidence(unittest.TestCase):
    def run_fixture(self, log=None, build='** BUILD SUCCEEDED **\n', build_exit=0, test_exit=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); build_log = root / 'build.log'; simulator_log = root / 'simulator.log'
            build_log.write_text(build)
            simulator_log.write_text(log if log is not None else ''.join(case(name) for name in journey.REQUIRED.values()))
            return journey.collect(SHA, build_log, build_exit, simulator_log, test_exit)

    def test_seven_executed_journeys_allow_test_candidate_without_fabricating_physical_acceptance(self):
        result = self.run_fixture()
        self.assertEqual(result['test_candidate_eligibility'], 'PASS')
        self.assertEqual(result['physical_device'], {'status': 'NOT_RUN', 'blocks_test_candidate': False})
        self.assertEqual(result['live_authentication'], 'NOT_RUN'); self.assertEqual(result['live_asr'], 'NOT_RUN')
        self.assertTrue(all(item['status'] == 'PASS' for item in result['simulator_journeys']['cases']))
        self.assertEqual(len(result['simulator_journeys']['evidence']['sha256']), 64)

    def test_build_only_old_shell_tests_missing_or_skipped_case_cannot_pass(self):
        names = list(journey.REQUIRED.values())
        candidates = ['', "Test Case '-[HPStudioUITests.StudioShellTests testNativeCaptureConfirmAndRelaunch]' passed (1.000 seconds).\n"]
        for missing in names:
            candidates.append(''.join(case(name) for name in names if name != missing))
            candidates.append(''.join(case(name, 'skipped' if name == missing else 'passed') for name in names))
        for log in candidates:
            with self.subTest(log=log[:70]):
                result = self.run_fixture(log=log)
                self.assertEqual(result['build']['status'], 'PASS')
                self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')

    def test_failed_then_passed_or_nonzero_runner_cannot_hide_original_failure(self):
        names = list(journey.REQUIRED.values()); good = ''.join(case(name) for name in names)
        result = self.run_fixture(log=case(names[0], 'failed') + good)
        self.assertEqual(result['simulator_journeys']['cases'][0]['status'], 'FAIL')
        self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')
        self.assertEqual(self.run_fixture(test_exit=65)['simulator_journeys']['status'], 'FAIL')
        self.assertEqual(self.run_fixture(build_exit=65)['build']['status'], 'FAIL')

    def test_duplicate_pass_start_only_and_app_stdout_are_not_execution_proof(self):
        names = list(journey.REQUIRED.values()); good = ''.join(case(name) for name in names)
        for log in [good + case(names[0]), '\n'.join(name + ': PASS' for name in names), good.replace("' started.", "' fake-start.")]:
            self.assertEqual(self.run_fixture(log=log)['test_candidate_eligibility'], 'BLOCKED')
        self.assertEqual(self.run_fixture(build='compiler done\n')['build']['status'], 'NOT_RUN')

    def test_actual_cli_preserves_failure_receipt_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); build = root / 'build.log'; log = root / 'test.log'; output = root / 'receipt.json'
            build.write_text('** BUILD SUCCEEDED **\n'); log.write_text('no journey ran\n')
            command = [sys.executable, str(SCRIPT), '--source-sha', SHA, '--build-log', str(build), '--build-exit', '0', '--simulator-log', str(log), '--test-exit', '0', '--output', str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            before = output.read_bytes(); self.assertEqual(json.loads(before)['test_candidate_eligibility'], 'BLOCKED')
            log.write_text(''.join(case(name) for name in journey.REQUIRED.values()))
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), before)

    def test_missing_symlinked_or_invalid_source_evidence_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); real = root / 'real'; real.write_text('** BUILD SUCCEEDED **\n')
            link = root / 'linked'; link.symlink_to(real)
            result = journey.collect(SHA, link, 0, root / 'missing', 0)
            self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')
            self.assertIsNone(result['build']['evidence'])
            with self.assertRaises(ValueError): journey.collect('local', real, 0, real, 0)
            with self.assertRaises(ValueError): journey.collect(SHA, real, True, real, 0)

if __name__ == '__main__': unittest.main()
