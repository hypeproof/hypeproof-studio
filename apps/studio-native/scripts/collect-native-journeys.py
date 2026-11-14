#!/usr/bin/env python3
"""Collect actual Xcode journey execution; never infer user acceptance from a build."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

REQUIRED = {
    'MFR-T01': 'testFirstInstallSignInToFirstAnswerWithoutDesktop',
    'MFR-T02': 'testDictationEditsDraftThenSendGetsReplyWithoutDesktop',
    'MFR-T03': 'testHandsFreeReplyStartsNextTurnAndStopPreventsSecondSend',
    'MFR-T03-playback': 'testRealKoreanPlaybackCompletionReachesNextCaptureBoundary',
    'MFR-T03-delegate': 'testPlaybackDelegateResumesCaptureOnceAndLateCompletionCannotUndoStop',
    'MFR-T03-draft': 'testPlaybackEndPreservesTypedDraftAndExplainsWhyListeningStopped',
    'MFR-T03-stop-denial': 'testStopRacingAdmissionFailurePreservesTypedReasonAfterRelaunch',
    'MFR-T03-response-stop': 'testStopPendingVoiceResponseKeepsWordsAndDoesNotRestartAfterRelaunch',
    'MFR-T03-queued': 'testVoiceFinishingDuringHistorySyncSendsOnceAndResumesListening',
    'MFR-T03-empty': 'testEmptyRecognitionPreservesWordsRecoversWithinBudgetAndStopCancelsRetry',
    'MFR-T04': 'testBackgroundStopsCaptureAndPreservesUnsentDraftAcrossRelaunch',
    'MFR-T05': 'testFailedSendRetainsOutboxAndRetriesSameRequestAfterRelaunch',
    'MFR-T05-recorded': 'testRecordedFailureRestoresDraftAcrossRelaunchAndExplicitlySendsNewID',
    'MFR-T05-collision': 'testRecordedFailureCannotReplaceExistingDraft',
    'MPER-T03-history': 'testLongHistoryRestoresLatestAcrossRelaunchConversationAndAccountSwitch',
    'MPER-T03-logout': 'testLogoutDuringHistorySyncWaitsOnceAndNeverSendsQueuedWords',
    'MPER-T03-following': 'testEightyMessageWindowFollowsNewTailWithoutInterruptingReading',
    'MFR-T01-admission': 'testAIAdmissionDenialRemainsVisibleAfterHistoryRefreshAndRelaunch',
    'MFR-T01-failure': 'testExpiredSignInLeavesActionableFailureInsteadOfInfiniteChecking',
    'MFR-T01-network': 'testSignInNetworkTimeoutIsNotPresentedAsExpiredLogin',
    'MFR-T02-readiness': 'testPersonalQuestionReadyAndSendWhileDesktopListIsHeld',
    'MFR-T02-timeout': 'testHistoryTimeoutWaitsForExplicitRetryAndPreservesDraft',
    'MFR-T02-cancel': 'testCancelledHistoryStillAllowsTheNextOrdinaryPoll',
    'MPER-T01-cancel': 'testCancelLoginKeepsFirstThoughtWithoutExchangeOrSend',
    'MPER-T03-collision': 'testLoginPreservesBothDraftsAndRestoresOnlyOnExplicitChoice',
    'MPER-T01-layout': 'testFirstUseLargeTextDarkAndKeyboardKeepComposerReachable',
}
# This is Xcode 26's XCTest output, not app stdout or a test-name substring.
CASE = re.compile(r"^Test Case '-\[[A-Za-z0-9_.]*StudioJourneyTests (test[A-Za-z0-9_]+)\]' (started\.|(passed|failed|skipped)(?: \([0-9.]+ seconds\))?\.)$")

def evidence(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        return None, ''
    data = path.read_bytes()
    return {'path': str(path.resolve()), 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}, data.decode('utf-8', errors='replace')

def collect(source: str, build_log: Path, build_exit: int, simulator_log: Path, test_exit: int):
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('A full source SHA is required')
    if any(type(code) is not int or code < 0 or code > 255 for code in (build_exit, test_exit)):
        raise ValueError('Actual process exit codes are required')
    build_evidence, build = evidence(build_log)
    simulator_evidence, simulator = evidence(simulator_log)
    events = {name: [] for name in REQUIRED.values()}
    for line in simulator.splitlines():
        match = CASE.fullmatch(line.strip())
        if match and match[1] in events:
            events[match[1]].append('started' if match[2] == 'started.' else match[3])
    cases = []
    for requirement, name in REQUIRED.items():
        seen = events[name]
        # Failed/skipped attempts are retained even if a later retry passes.
        status = ('FAIL' if 'failed' in seen else 'SKIPPED' if 'skipped' in seen else
                  'PASS' if seen == ['started', 'passed'] else 'NOT_RUN' if not seen else 'INCOMPLETE')
        cases.append({'requirement': requirement, 'test': 'StudioJourneyTests.' + name, 'status': status, 'events': seen})
    build_status = 'PASS' if build_evidence and build_exit == 0 and '** BUILD SUCCEEDED **' in build.splitlines() else 'FAIL' if build_exit else 'NOT_RUN'
    journey_status = 'PASS' if simulator_evidence and test_exit == 0 and all(case['status'] == 'PASS' for case in cases) else 'FAIL' if test_exit or any(case['status'] == 'FAIL' for case in cases) else 'NOT_RUN'
    return {'schema': 'hps-native-journey-evidence/1', 'source_sha': source,
            'build': {'status': build_status, 'exit_code': build_exit, 'evidence': build_evidence},
            'simulator_journeys': {'status': journey_status, 'exit_code': test_exit, 'evidence': simulator_evidence, 'cases': cases,
                                   'external_transports': 'SYNTHETIC', 'app_state_and_persistence': 'REAL'},
            'physical_device': {'status': 'NOT_RUN', 'blocks_test_candidate': False},
            'live_authentication': 'NOT_RUN', 'live_asr': 'NOT_RUN', 'apple_upload': 'NOT_RUN_BY_THIS_CHECK',
            'os_speech_playback': {'status': next(case['status'] for case in cases if case['requirement'] == 'MFR-T03-playback'),
                                   'scope': 'Korean AVSpeechSynthesizer through didFinish; Service and next microphone capture remain synthetic'},
            'test_candidate_eligibility': 'PASS' if build_status == journey_status == 'PASS' else 'BLOCKED'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--build-log', required=True, type=Path)
    parser.add_argument('--build-exit', required=True, type=int)
    parser.add_argument('--simulator-log', required=True, type=Path)
    parser.add_argument('--test-exit', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = collect(args.source_sha, args.build_log, args.build_exit, args.simulator_log, args.test_exit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as target:
        target.write(json.dumps(result, indent=2) + '\n')
    print('Simulator journeys: ' + result['simulator_journeys']['status'] + '; physical device: NOT_RUN')
    return 0 if result['test_candidate_eligibility'] == 'PASS' else 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc))
