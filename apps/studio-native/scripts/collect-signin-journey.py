#!/usr/bin/env python3
"""Record the signed-in journey result for one source SHA, hop by hop; never infer a pass."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re

SCHEMA = 'hps-native-signin-journey/1'
REPOSITORY = 'hypeproof/hypeproof-studio'
TEST = 'testSystemBrowserOpensLiveSignInPageAndCancelReturnsToApp'
# Hops in journey order. PASS overall requires every one of them to PASS.
BROWSER_HOPS = ('service_start_returns_lab_url', 'system_browser_session_loads_sign_in_page', 'cancel_returns_to_app')
AUTHENTICATED_HOPS = ('browser_form_post_through_lab_proxy', 'callback_returns_to_app_from_lab', 'token_exchange_and_account_load')
REQUIRED_HOPS = BROWSER_HOPS + AUTHENTICATED_HOPS
# Why the authenticated hops cannot run today. A hosted runner has no Google identity; adding one
# is an owner decision (a dedicated test account and a Lab test-login path), not wired in here.
AUTHENTICATED_REASON = 'requires an owner-provided test account; no credential is read by this check'
CASE = re.compile(r"^Test Case '-\[[A-Za-z0-9_.]*StudioSignInBoundaryTests (test[A-Za-z0-9_]+)\]' (started\.|(passed|failed|skipped)(?: \([0-9.]+ seconds\))?\.)$")

def overall(hops):
    """Recompute the verdict from hop statuses. The gate calls this too, never trusting a stored verdict."""
    states = [hops.get(name, {}).get('status', 'NOT_RUN') for name in REQUIRED_HOPS]
    if 'FAIL' in states:
        return 'FAIL'
    if all(state == 'PASS' for state in states):
        return 'PASS'
    return 'PARTIAL' if 'PASS' in states else 'NOT_RUN'

def browser_status(log_text, test_exit):
    events = []
    for line in log_text.splitlines():
        match = CASE.fullmatch(line.strip())
        if match and match[1] == TEST:
            events.append('started' if match[2] == 'started.' else match[3])
    if 'failed' in events:
        return 'FAIL'
    if events == ['started', 'passed'] and test_exit == 0:
        return 'PASS'
    # A crashed or interrupted run has no pass event; a nonzero exit with nothing recorded is a failure to run.
    return 'FAIL' if test_exit and events else 'NOT_RUN'

def collect(source, run_id, attempt, log_text, test_exit):
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('A full source SHA is required')
    if run_id < 1 or attempt < 1 or type(test_exit) is not int or not 0 <= test_exit <= 255:
        raise ValueError('Actual run identity and exit code are required')
    status = browser_status(log_text, test_exit)
    hops = {name: {'status': status} for name in BROWSER_HOPS}
    hops.update({name: {'status': 'NOT_RUN', 'reason': AUTHENTICATED_REASON} for name in AUTHENTICATED_HOPS})
    verdict = overall(hops)
    return {'schema': SCHEMA, 'repository': REPOSITORY, 'source_head_sha': source, 'run_id': run_id, 'run_attempt': attempt,
            'status': verdict, 'hops': hops,
            'unverified': [name for name in REQUIRED_HOPS if hops[name]['status'] != 'PASS'],
            'scope': 'Real Service start and real system browser session against the live sign-in URL; no account is used.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--run-attempt', required=True, type=int)
    parser.add_argument('--simulator-log', required=True, type=Path)
    parser.add_argument('--test-exit', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    log = args.simulator_log
    text = log.read_text(errors='replace') if log.is_file() and not log.is_symlink() else ''
    result = collect(args.source_sha, args.run_id, args.run_attempt, text, args.test_exit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as target:
        target.write(json.dumps(result, indent=2) + '\n')
    print('Signed-in journey: ' + result['status'] + '; unverified hops: ' + ', '.join(result['unverified']))
    if result['status'] != 'PASS':
        # Visible, not fatal: the TestFlight gate decides what each audience may receive.
        print('::warning::Signed-in journey is ' + result['status'] + '; external TestFlight distribution stays blocked.')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc))
