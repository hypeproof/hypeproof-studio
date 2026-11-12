"""Controls for the process / release-check gate (#3568). No GitHub or git calls.

    python3 scripts/release/test/test_release_check_gate.py
"""
import copy
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# The entry point's file name has a dash, so load it by path.
_spec = importlib.util.spec_from_file_location("release_check_gate", ROOT / "scripts" / "release" / "release-check-gate.py")
gate = importlib.util.module_from_spec(_spec)
sys.modules["release_check_gate"] = gate  # dataclasses looks the module up by name
_spec.loader.exec_module(gate)

ON = {"version": 1, "release_check": {"enforced": True, "manager_check": True,
                                      "smoke_check_prefix": "scripts/release/smoke/checks/"},
      "hotfix": {"base_prefix": "hotfix/", "label": "hotfix", "forward_label": "hotfix-forward"}}
OFF = copy.deepcopy(ON)
OFF["release_check"]["enforced"] = False

TEMPLATE = """## Release check

Release manager check: <yes|no> — <reason>
How to verify: <where> → <what to click or run> → <expected result>
Smoke: <yes|no> — <reason>
Smoke check: <scripts/release/smoke/checks/sN-*.mjs, or #follow-up-issue; only when the answer is yes>

<!-- Read the linked issue and your diff, then fill the lines above. -->

## Checklist
- [ ] x
"""

NO_MANAGER = """## Closes

Closes #3568

## Release check

Release manager check: no — CI gate and contract config only, no app change
Smoke: no — no dependency on another repository or server

## Checklist
- [ ] x
"""

YES_MANAGER = """## Release check

Release manager check: yes — a user sees the new banner in the rc App
How to verify: Open a task → click the banner → the banner text appears
Smoke: no — UI copy only

## Checklist
"""


def pr(body, *, login="jayleekr", user_type="User", head="feat/x", base="main", labels=()):
    return {"number": 1, "body": body, "labels": list(labels), "base": {"ref": base},
            "head": {"ref": head, "sha": "0" * 40}, "user": {"login": login, "type": user_type}}


def run(body, *, contract=ON, paths=(), issue_body=None, pull_base=None, issue_open=None, **kwargs):
    return gate.judge(pr(body, **kwargs), head_contract=contract, main_contract=contract,
                      path_exists=lambda path: path in paths, main_exists=lambda path: False,
                      issue_body=issue_body,
                      pull_base=pull_base or (lambda number: ""),
                      issue_open=issue_open or (lambda number: True))


class NormalLane(unittest.TestCase):
    def test_positive_controls_pass(self):
        self.assertEqual(run(NO_MANAGER).status, "pass")
        self.assertEqual(run(YES_MANAGER).status, "pass")

    def test_negative_controls_fail(self):
        # the untouched template: placeholders are not answers
        self.assertEqual(run(TEMPLATE).status, "fail")
        # no Release check section at all
        self.assertEqual(run("## What\nx\n\n## Checklist\n- [ ] x\n").status, "fail")
        # no Smoke line
        no_smoke = NO_MANAGER.replace("Smoke: no — no dependency on another repository or server\n", "")
        self.assertEqual(run(no_smoke).status, "fail")
        # manager check missing its answer
        no_answer = NO_MANAGER.replace("Release manager check: no — CI gate and contract config only, no app change\n", "")
        self.assertEqual(run(no_answer).status, "fail")

    def test_manager_yes_needs_three_verify_parts(self):
        short = YES_MANAGER.replace("Open a task → click the banner → the banner text appears", "Open a task")
        self.assertEqual(run(short).status, "fail")

    def test_smoke_yes_needs_an_existing_check_file_or_open_follow_up(self):
        def smoke_yes(check):
            # the Smoke check line belongs inside the Release check section, under the Smoke line
            return NO_MANAGER.replace("Smoke: no — no dependency on another repository or server\n",
                                      "Smoke: yes — calls the Service API for the plan\n" + f"Smoke check: {check}\n")

        missing = smoke_yes("scripts/release/smoke/checks/s9-none.mjs")
        self.assertEqual(run(missing).status, "fail")
        present = smoke_yes("scripts/release/smoke/checks/s1-service-health.mjs")
        self.assertEqual(run(present, paths={"scripts/release/smoke/checks/s1-service-health.mjs"}).status, "pass")
        # a file outside the smoke check prefix fails even when it exists
        outside = smoke_yes("scripts/other/thing.mjs")
        self.assertEqual(run(outside, paths={"scripts/other/thing.mjs"}).status, "fail")
        # a follow-up issue must be open in this repository; a closed one or a PR fails
        follow_up = smoke_yes("#2000")
        self.assertEqual(run(follow_up, issue_open=lambda n: True).status, "pass")
        self.assertEqual(run(follow_up, issue_open=lambda n: False).status, "fail")

    def test_linked_issue_says_smoke_yes_needs_a_difference_reason(self):
        issue = "## Smoke needed?\n\nyes\n"
        self.assertEqual(run(NO_MANAGER, issue_body=issue).status, "fail")
        differs = NO_MANAGER.replace("## Checklist", "Smoke differs from issue: the Service is untouched here\n\n## Checklist")
        self.assertEqual(run(differs, issue_body=issue).status, "pass")
        # the issue without an answer is not compared
        self.assertEqual(run(NO_MANAGER, issue_body="no section").status, "pass")

    def test_body_edit_is_judged_again(self):
        self.assertEqual(run(TEMPLATE).status, "fail")
        self.assertEqual(run(NO_MANAGER).status, "pass")

    def test_contract_not_enforced_passes_with_a_logged_reason(self):
        verdict = run(TEMPLATE, contract=OFF)
        self.assertEqual(verdict.status, "pass")
        self.assertIn("not enforced", verdict.lines[0])


class Exemptions(unittest.TestCase):
    def test_dependabot_is_skipped_with_a_reason(self):
        verdict = run(TEMPLATE, login="dependabot[bot]", user_type="Bot", head="dependabot/npm/x")
        self.assertEqual(verdict.status, "skip")
        self.assertIn("dependabot", verdict.reason)

    def test_release_bot_branch_is_skipped(self):
        verdict = run(TEMPLATE, login="hypeproof-org-lab-bot[bot]", user_type="Bot", head="release/v2026.1103.0")
        self.assertEqual(verdict.status, "skip")

    def test_release_branch_opened_by_a_person_is_still_judged(self):
        # negative control: the exemption needs the bot account, not only the branch name
        self.assertEqual(run(TEMPLATE, head="release/v2026.1103.0").status, "fail")

    def test_harness_sync_by_the_agent_bot_is_skipped(self):
        verdict = run(TEMPLATE, login="hypeproof-agent[bot]", user_type="Bot", head="chore/harness-sync")
        self.assertEqual(verdict.status, "skip")

    def test_harness_sync_by_a_person_is_still_judged(self):
        self.assertEqual(run(TEMPLATE, head="chore/harness-sync").status, "fail")


class HotfixLane(unittest.TestCase):
    HOTFIX_BODY = "## Release check\n\nSmoke: no — the fix only changes a guard, no new dependency\n\n## Checklist\n"

    def test_hotfix_skips_manager_and_verify_but_keeps_smoke(self):
        verdict = run(self.HOTFIX_BODY, base="hotfix/v2026.1029.0", labels=["hotfix"])
        self.assertEqual(verdict.status, "pass")
        self.assertIn("hotfix", verdict.lines[0])

    def test_hotfix_still_needs_the_smoke_answer(self):
        no_smoke = self.HOTFIX_BODY.replace("Smoke: no — the fix only changes a guard, no new dependency\n", "")
        self.assertEqual(run(no_smoke, base="hotfix/v2026.1029.0", labels=["hotfix"]).status, "fail")

    def test_hotfix_base_needs_the_hotfix_label(self):
        self.assertEqual(run(self.HOTFIX_BODY, base="hotfix/v2026.1029.0").status, "fail")

    def test_hotfix_label_on_a_pr_into_main_fails(self):
        self.assertEqual(run(NO_MANAGER, labels=["hotfix"]).status, "fail")

    def test_forward_port_names_a_hotfix_pr(self):
        forward = NO_MANAGER.replace("## Checklist", "Forward-port of #3500\n\n## Checklist")
        ok = run(forward, labels=["hotfix-forward"], pull_base=lambda n: "hotfix/v2026.1029.0")
        self.assertEqual(ok.status, "pass")
        # negative controls: the named PR does not target a hotfix branch, or the line is missing
        self.assertEqual(run(forward, labels=["hotfix-forward"], pull_base=lambda n: "main").status, "fail")
        self.assertEqual(run(NO_MANAGER, labels=["hotfix-forward"], pull_base=lambda n: "hotfix/v1").status, "fail")

    def test_forward_label_on_a_hotfix_branch_fails(self):
        self.assertEqual(run(self.HOTFIX_BODY, base="hotfix/v2026.1029.0", labels=["hotfix", "hotfix-forward"]).status, "fail")


class LinkedIssue(unittest.TestCase):
    def test_closing_reference_is_found(self):
        self.assertEqual(gate.linked_issue("Closes #3568\n"), 3568)
        self.assertEqual(gate.linked_issue("Fixes: #12"), 12)
        self.assertIsNone(gate.linked_issue("no link here"))


class WorkflowWiring(unittest.TestCase):
    def test_the_job_is_named_and_runs_the_gate(self):
        text = (ROOT / ".github" / "workflows" / "process-gates.yml").read_text(encoding="utf-8")
        self.assertIn("name: process / release-check", text)
        self.assertIn("scripts/release/release-check-gate.py", text)


if __name__ == "__main__":
    unittest.main()
