"""Socket-boundary controls; native/device acceptance is a separate real SDK run."""
import subprocess
import unittest
from unittest.mock import patch

import lab


class HostBoundary(unittest.TestCase):
    def test_darwin_requires_every_owned_socket_to_be_loopback(self):
        for address, valid in [('127.0.0.1:9000', True),
                               ('127.0.0.1:9000->127.0.0.1:9001', True),
                               ('*:9000', False), ('192.168.1.2:9000', False),
                               ('127.0.0.1:9000->192.168.1.2:9001', False)]:
            with self.subTest(address=address), patch.object(lab.platform, 'system', return_value='Darwin'), \
                 patch.object(lab.subprocess, 'run', return_value=subprocess.CompletedProcess(
                     [], 0, stdout='p42\nf1\nPTCP\nn127.0.0.1:9002\nf2\nPUDP\nn'+address+'\n')) as run:
                if valid:
                    self.assertEqual(lab.socket_evidence(42)[-1], address)
                else:
                    with self.assertRaises(AssertionError):
                        lab.socket_evidence(42)
                self.assertEqual(run.call_args.args[0],
                                 ['/usr/sbin/lsof', '-nP', '-a', '-p', '42', '-i', '-FpnP'])

    def test_failed_or_empty_socket_observation_cannot_pass(self):
        with patch.object(lab.platform, 'system', return_value='Darwin'):
            with patch.object(lab.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['lsof'])):
                with self.assertRaises(subprocess.CalledProcessError):
                    lab.socket_evidence(42)
            with patch.object(lab.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='p42\n')):
                with self.assertRaises(AssertionError):
                    lab.socket_evidence(42)
