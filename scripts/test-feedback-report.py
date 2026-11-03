#!/usr/bin/env python3
"""T26: forged PASS, modified evidence, stale SHA and HTML injection controls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("report", Path(__file__).with_name("feedback-report.py"))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.acceptance = {"tests": [{"test_id": "T01", "scenario": '<img src=x onerror="alert(1)">', "acceptance": "Preserve files", "requirement_wp": "FB-01"}]}
        self.acceptance["revision"] = hashlib.sha256(json.dumps(self.acceptance, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        self.evidence = {"acceptance_revision": self.acceptance["revision"], "implementation": {"studio": "a" * 40}, "tests": []}

    def valid_pass(self):
        (self.root / "proof.txt").write_text("observed")
        return {"test_id": "T01", "status": "PASS", "finished_at": "2026-10-16T00:00:00Z", "implementation": {"studio": "a" * 40}, "observations": ["real result"], "evidence_refs": [{"path": "proof.txt", "sha256": hashlib.sha256(b"observed").hexdigest()}]}

    def test_unrun_and_injection(self):
        for name, obj in [("acceptance", self.acceptance), ("evidence", self.evidence)]:
            (self.root / f"{name}.json").write_text(json.dumps(obj))
        text = report.render(self.root).read_text()
        self.assertIn("NOT_RUN", text)
        self.assertNotIn("<img", text)
        self.assertNotIn("fetch(", text)

    def test_verified_evidence_and_tamper(self):
        self.evidence["tests"] = [self.valid_pass()]
        self.assertEqual(report.validate(self.root, self.acceptance, self.evidence)[0]["status"], "PASS")
        (self.root / "proof.txt").write_text("changed")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            report.validate(self.root, self.acceptance, self.evidence)

    def test_forged_pass_and_human(self):
        self.evidence["tests"] = [{"test_id": "T01", "status": "PASS"}]
        with self.assertRaises(ValueError):
            report.validate(self.root, self.acceptance, self.evidence)
        self.evidence["tests"] = [{**self.valid_pass(), "scope": "human", "evaluator": {"kind": "model"}}]
        with self.assertRaisesRegex(ValueError, "Human"):
            report.validate(self.root, self.acceptance, self.evidence)

    def test_revision_and_staleness(self):
        self.evidence["tests"] = [self.valid_pass()]
        self.evidence["implementation"] = {"studio": "b" * 40}
        self.assertEqual(report.validate(self.root, self.acceptance, self.evidence)[0]["status"], "STALE")
        self.evidence["acceptance_revision"] = "changed"
        with self.assertRaises(ValueError):
            report.validate(self.root, self.acceptance, self.evidence)
        self.evidence["acceptance_revision"] = self.acceptance["revision"]
        self.acceptance["tests"][0]["acceptance"] = "Relaxed after failure"
        with self.assertRaisesRegex(ValueError, "content hash"):
            report.validate(self.root, self.acceptance, self.evidence)

    def test_escape_and_unknown(self):
        for path in ["../proof.txt", "/tmp/proof.txt", "https://example.com", "a\\proof.txt"]:
            with self.assertRaises(ValueError):
                report.artifact(self.root, {"path": path})
        self.evidence["tests"] = [{"test_id": "T02", "status": "PASS"}]
        with self.assertRaises(ValueError):
            report.validate(self.root, self.acceptance, self.evidence)

    def test_evidence_cannot_rewrite_criteria(self):
        self.evidence["tests"] = [{**self.valid_pass(), "acceptance": "Weaker criterion"}]
        with self.assertRaisesRegex(ValueError, "frozen criteria"):
            report.validate(self.root, self.acceptance, self.evidence)


if __name__ == "__main__":
    unittest.main()
