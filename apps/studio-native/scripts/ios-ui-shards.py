#!/usr/bin/env python3
"""Split the iOS UI suite into shards and merge their results without losing a case.

`plan` reads the XCTest declarations in ios/UITests and assigns every case to one shard.
Shards 1..N-1 run only their own cases; the last shard skips the cases of the others, so a
case this parser misses still runs there instead of disappearing. A `--dedicated` case runs in
none of them: it gets its own row, index N+1, which its own job runs (#4432: the real Korean
voice case runs after the simulator settles, apart from the other cases).

With `--set gate` or `--set nightly` (ios-ui-sets.json), the plan holds only that set (#4432 stage 3):
`gate` is the listed cases, `nightly` every other declared case. The other set's cases are recorded as
`excluded`; the catch-all shard skips them too, and `merge` fails if one of them starts. A dedicated case
outside the selected set is excluded with the rest of its set. `--set all` (the default) plans every case.

With `--durations` (ios-ui-durations.json), the regular shards are balanced by measured time instead:
the longest known case goes to the shard with the least time so far. Cases the table does not know are
then placed by count, on the shard with the fewest cases (#4432 F21: by count, shard test time ranged
from 13 to 19 min in run 45351306160 and one shard reached its 35 min job limit).

The warm-up case (WARM_UP, #4432) is not a planned case. Every `-only-testing` row, including the dedicated
rows, starts with it; the catch-all row never skips it. xcodebuild runs test classes in name order, so it
runs first in every job. It never counts toward a set, a shard's cases or `merge`'s accounting.

`merge` joins the shard logs and attachment exports into the single evidence layout the
journey collectors and the release evidence reader already accept, and fails unless every
shard ran, every shard exited 0, and every planned case started in exactly its own shard.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import sys

# /2: rows after `catch_all` hold the dedicated cases.
SCHEMA_PLAN = 'hps-ios-ui-shard-plan/2'
SCHEMA_MERGE = 'hps-ios-ui-shard-merge/1'
SCHEMA_DURATIONS = 'hps-ios-ui-durations/1'
SCHEMA_SETS = 'hps-ios-ui-sets/1'
SETS = ('all', 'gate', 'nightly')
TARGET = 'HPStudioUITests'
CLASS = re.compile(r'^\s*(?:final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*XCTestCase\b')
# Attributes and modifiers such as `@MainActor` may precede the declaration.
TEST = re.compile(r'^\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s+)*'
                  r'(?:(?:override|public|internal|open|final|nonisolated)\s+)*'
                  r'func\s+(test[A-Za-z0-9_]*)\s*\(\s*\)')
# Settings-only keyboard and accessibility warm-up before each job's first product case (#4432).
WARM_UP_CLASS = 'ShardWarmUpUITests'
WARM_UP = f'{TARGET}/{WARM_UP_CLASS}/testWarmUpSystemKeyboardAndAccessibility'
CASE = re.compile(r"^Test Case '-\[(?:[A-Za-z0-9_]+\.)*([A-Za-z0-9_]+) (test[A-Za-z0-9_]+)\]' started\.$")


def discover(ui_tests: Path):
    """Return {class: [test, ...]} in declaration order for every XCTestCase in the folder."""
    classes: dict[str, list[str]] = {}
    for source in sorted(ui_tests.glob('*.swift')):
        current = None
        for line in source.read_text(encoding='utf-8').splitlines():
            declared = CLASS.match(line)
            if declared:
                current = declared[1]
                if current in classes:
                    raise ValueError(f'XCTestCase {current} is declared twice')
                classes[current] = []
                continue
            test = TEST.match(line)
            if test and current is not None:
                if test[1] in classes[current]:
                    raise ValueError(f'{current}.{test[1]} is declared twice')
                classes[current].append(test[1])
    if not any(classes.values()):
        raise ValueError(f'No XCTest cases found under {ui_tests}')
    return classes


def load_durations(path: Path):
    """{case: seconds} from an ios-ui-durations.json; every value must be a positive number."""
    document = json.loads(path.read_text())
    if document.get('schema') != SCHEMA_DURATIONS:
        raise ValueError('Unexpected UI durations schema')
    cases = document.get('cases')
    if not isinstance(cases, dict) or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0
                                              for v in cases.values()):
        raise ValueError('UI durations must map each case to a positive number of seconds')
    return {str(case): float(seconds) for case, seconds in cases.items()}


def load_sets(path: Path):
    """The gate case list from an ios-ui-sets.json: unique `HPStudioUITests/<class>/<test>` strings."""
    document = json.loads(path.read_text())
    if document.get('schema') != SCHEMA_SETS:
        raise ValueError('Unexpected UI sets schema')
    gate = document.get('gate')
    if (not isinstance(gate, list) or not gate or not all(isinstance(case, str) for case in gate)
            or len(gate) != len(set(gate))):
        raise ValueError('UI sets must list each gate case once')
    return gate


def select(classes, selection: str, gate=None):
    """Cases outside the selected set, in declaration order. Every gate case must be declared."""
    if selection not in SETS:
        raise ValueError(f'Unknown UI set {selection}')
    declared = [f'{TARGET}/{name}/{test}' for name in sorted(classes) for test in classes[name]]
    if gate is None and selection != 'all':
        raise ValueError(f'The {selection} set needs the UI sets file')
    missing = [case for case in gate or () if case not in declared]
    if missing:
        raise ValueError(f'Gate case(s) not declared: {", ".join(missing)}')
    if selection == 'all':
        return []
    if selection == 'gate':
        return [case for case in declared if case not in gate]
    return [case for case in declared if case in gate]


def balance(cases, shards: int, durations):
    """Regular cases by measured time (longest first, onto the shard with the least time; ties by case name,
    then lowest shard), then unmeasured cases by count (fewest cases, then lowest shard)."""
    assigned = [[] for _ in range(shards)]
    seconds = [0.0] * shards
    known = sorted((case for case in cases if case in durations), key=lambda case: (-durations[case], case))
    for case in known:
        index = min(range(shards), key=lambda k: (seconds[k], k))
        assigned[index].append(case)
        seconds[index] += durations[case]
    for case in [case for case in cases if case not in durations]:
        index = min(range(shards), key=lambda k: (len(assigned[k]), k))
        assigned[index].append(case)
    return assigned, seconds


def plan(classes, shards: int, dedicated=(), durations=None, selection='all', gate=None):
    if not 2 <= shards <= 8:
        raise ValueError('Shard count must be between 2 and 8')
    warm_up = None
    if WARM_UP_CLASS in classes:
        if [f'{TARGET}/{WARM_UP_CLASS}/{test}' for test in classes[WARM_UP_CLASS]] != [WARM_UP]:
            raise ValueError(f'{WARM_UP_CLASS} must declare exactly {WARM_UP}')
        warm_up = WARM_UP
        classes = {name: tests for name, tests in classes.items() if name != WARM_UP_CLASS}
    first = [f'-only-testing:{warm_up}'] if warm_up else []
    dedicated = list(dict.fromkeys(dedicated))
    declared = {f'{TARGET}/{name}/{test}' for name, tests in classes.items() for test in tests}
    missing = [case for case in dedicated if case not in declared]
    if missing:
        raise ValueError(f'Dedicated case(s) not declared: {", ".join(missing)}')
    excluded = select(classes, selection, gate)
    dedicated = [case for case in dedicated if case not in excluded]
    assigned = [[] for _ in range(shards)]
    seconds = None
    if durations is None:
        offset = 0
        # Round-robin inside each class keeps every shard a similar mix of short and long classes.
        # The start offset rotates so one shard does not collect every class remainder.
        for name in sorted(classes):
            tests = [test for test in classes[name]
                     if f'{TARGET}/{name}/{test}' not in dedicated and f'{TARGET}/{name}/{test}' not in excluded]
            for position, test in enumerate(tests):
                assigned[(offset + position) % shards].append(f'{TARGET}/{name}/{test}')
            offset = (offset + len(tests)) % shards
    else:
        regular = [f'{TARGET}/{name}/{test}' for name in sorted(classes) for test in classes[name]
                   if f'{TARGET}/{name}/{test}' not in dedicated and f'{TARGET}/{name}/{test}' not in excluded]
        assigned, seconds = balance(regular, shards, durations)
    if any(not cases for cases in assigned):
        raise ValueError('Every shard needs at least one case; lower the shard count')
    rows = []
    for index, cases in enumerate(assigned, start=1):
        if index < shards:
            arguments = first + [f'-only-testing:{case}' for case in cases]
        else:
            # The catch-all shard also skips the dedicated cases (their own row runs them) and the
            # other set's cases (the other workflow runs them).
            arguments = [f'-skip-testing:{case}' for other in assigned[:-1] + [dedicated, excluded] for case in other]
        row = {'index': index, 'cases': cases, 'dedicated': False, 'xcodebuild_arguments': arguments}
        if seconds is not None:
            row['estimated_seconds'] = round(seconds[index - 1], 1)
            row['unmeasured_cases'] = sum(1 for case in cases if case not in durations)
        rows.append(row)
    if dedicated:
        rows.append({'index': shards + 1, 'cases': dedicated, 'dedicated': True,
                     'xcodebuild_arguments': first + [f'-only-testing:{case}' for case in dedicated]})
    document = {'schema': SCHEMA_PLAN, 'target': TARGET, 'shard_count': len(rows), 'catch_all': shards,
                'case_count': sum(len(row['cases']) for row in rows), 'shards': rows,
                'balance': 'count' if durations is None else 'durations', 'set': selection, 'excluded': excluded,
                'warm_up': warm_up}
    if durations is not None:
        document['stale_durations'] = sorted(case for case in durations if case not in declared)
    return document


def read_plan(path: Path):
    document = json.loads(path.read_text())
    if document.get('schema') != SCHEMA_PLAN:
        raise ValueError('Unexpected shard plan schema')
    shards = document['shards']
    if [row['index'] for row in shards] != list(range(1, document['shard_count'] + 1)):
        raise ValueError('Shard plan indexes are not 1..N')
    every = [case for row in shards for case in row['cases']]
    if len(every) != len(set(every)) or len(every) != document['case_count']:
        raise ValueError('Shard plan assigns a case twice or miscounts')
    catch_all = document['catch_all']
    if [row['dedicated'] for row in shards] != [index > catch_all for index in range(1, len(shards) + 1)]:
        raise ValueError('Shard plan dedicated rows must follow the catch-all shard')
    if document.get('set', 'all') not in SETS or set(document.get('excluded', [])) & set(every):
        raise ValueError('Shard plan excludes a planned case or names an unknown set')
    return document


def started_cases(log_text: str):
    found = []
    for line in log_text.splitlines():
        match = CASE.fullmatch(line.strip())
        if match:
            found.append(f'{TARGET}/{match[1]}/{match[2]}')
    return found


def shard_exit(directory: Path):
    """The shard's own exit record. A shard that never wrote one did not finish."""
    path = directory / 'shard-result.json'
    if not path.is_file() or path.is_symlink():
        return None
    value = json.loads(path.read_text())
    code = value.get('test_exit')
    if type(code) is not int or not 0 <= code <= 255:
        raise ValueError(f'Malformed shard result in {path}')
    attachments = value.get('attachment_exit')
    if type(attachments) is not int or not 0 <= attachments <= 255:
        raise ValueError(f'Malformed attachment exit in {path}')
    return value


def merge_attachments(shard_dirs, destination: Path):
    """One manifest and one flat folder, as a single xcresult export would have produced."""
    destination.mkdir(parents=True, exist_ok=False)
    manifest = []
    owners: dict[str, int] = {}
    for index, directory in shard_dirs:
        source = directory / 'journey-attachments'
        listing = source / 'manifest.json'
        if not listing.is_file():
            continue
        rows = json.loads(listing.read_text())
        if not isinstance(rows, list):
            raise ValueError(f'Shard {index} attachment manifest is not a list')
        for row in rows:
            for item in row.get('attachments', []):
                name = item.get('exportedFileName')
                if not isinstance(name, str) or Path(name).name != name or name in ('', '.', '..'):
                    raise ValueError(f'Shard {index} has a non-flat attachment name')
                if name in owners:
                    raise ValueError(f'Attachment {name} exported by shards {owners[name]} and {index}')
                owners[name] = index
                file = source / name
                if file.is_file() and not file.is_symlink():
                    shutil.copyfile(file, destination / name)
            manifest.append(row)
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return len(manifest)


def merge(plan_doc, shard_root: Path, evidence: Path):
    shard_dirs = [(row['index'], shard_root / f'shard-{row["index"]}') for row in plan_doc['shards']]
    count = plan_doc['shard_count']
    catch_all = plan_doc['catch_all']
    combined, results, problems = [], {}, []
    seen: dict[str, list[int]] = {}
    warm_up_started: list[int] = []
    for (index, directory), row in zip(shard_dirs, plan_doc['shards']):
        result = shard_exit(directory) if directory.is_dir() else None
        log = directory / 'simulator-test.log'
        text = log.read_text(errors='replace') if log.is_file() and not log.is_symlink() else ''
        combined.append(f'native verification: UI shard {index}/{count}\n{text}')
        for case in set(started_cases(text)):
            if case == plan_doc.get('warm_up'):
                warm_up_started.append(index)
                continue
            seen.setdefault(case, []).append(index)
        if result is None:
            problems.append(f'shard {index} has no result; it did not finish')
            results[index] = {'test_exit': None, 'attachment_exit': None}
            continue
        results[index] = {'test_exit': result['test_exit'], 'attachment_exit': result['attachment_exit']}
        if result['test_exit']:
            problems.append(f'shard {index} test exit {result["test_exit"]}')
        if result['attachment_exit']:
            problems.append(f'shard {index} attachment export exit {result["attachment_exit"]}')
    owner = {case: row['index'] for row in plan_doc['shards'] for case in row['cases']}
    not_run = sorted(case for case in owner if case not in seen)
    misplaced = sorted(case for case in owner if case in seen and seen[case] != [owner[case]])
    excluded = set(plan_doc.get('excluded', []))
    excluded_started = sorted(case for case in seen if case in excluded)
    unplanned = sorted(case for case in seen if case not in owner and case not in excluded)
    unplanned_outside_last = [case for case in unplanned if seen[case] != [catch_all]]
    if not_run:
        problems.append(f'{len(not_run)} planned case(s) never started')
    if misplaced:
        problems.append(f'{len(misplaced)} case(s) started outside their own shard or in two shards')
    if excluded_started:
        problems.append(f'{len(excluded_started)} case(s) of the other UI set started; the {plan_doc.get("set")} set excludes them')
    if unplanned_outside_last:
        problems.append(f'{len(unplanned_outside_last)} unplanned case(s) started outside the catch-all shard {catch_all}')
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'simulator-test.log').write_text(''.join(combined))
    manifest_rows = merge_attachments(shard_dirs, evidence / 'journey-attachments')
    exits = [value['test_exit'] for value in results.values()]
    # The journey collectors take one exit code: the first nonzero one, or 125 for a missing shard.
    test_exit = next((code for code in exits if code), 0) if None not in exits else next((code for code in exits if code), 125)
    attachment_exit = next((value['attachment_exit'] for value in results.values() if value['attachment_exit']), 0)
    if None in [value['attachment_exit'] for value in results.values()]:
        attachment_exit = attachment_exit or 125
    document = {'schema': SCHEMA_MERGE, 'verdict': 'FAIL' if problems else 'PASS', 'shard_count': count,
                'planned_cases': len(owner), 'started_cases': len(seen), 'shards': results,
                'test_exit': test_exit, 'attachment_exit': attachment_exit,
                'attachment_manifest_rows': manifest_rows, 'not_run': not_run, 'misplaced': misplaced,
                'unplanned_in_last_shard': [case for case in unplanned if seen[case] == [catch_all]],
                'unplanned_outside_last_shard': unplanned_outside_last, 'set': plan_doc.get('set', 'all'),
                'excluded_started': excluded_started, 'warm_up_started_in': warm_up_started, 'problems': problems}
    (evidence / 'ios-ui-shards.json').write_text(json.dumps(document, indent=2) + '\n')
    return document


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    planner = commands.add_parser('plan')
    planner.add_argument('--ui-tests', type=Path, required=True)
    planner.add_argument('--shards', type=int, required=True)
    planner.add_argument('--output', type=Path, required=True)
    planner.add_argument('--dedicated', action='append', default=[], help='a case that runs only in its own row')
    planner.add_argument('--durations', type=Path, default=None, help='ios-ui-durations.json: balance by measured time')
    planner.add_argument('--set', choices=SETS, default='all', help='plan only the gate or the nightly cases')
    planner.add_argument('--sets', type=Path, default=None, help='ios-ui-sets.json: the gate case list')
    arguments = commands.add_parser('arguments')
    arguments.add_argument('--plan', type=Path, required=True)
    arguments.add_argument('--index', type=int, required=True)
    role = commands.add_parser('dedicated', help='print yes when the row holds dedicated cases, else no')
    role.add_argument('--plan', type=Path, required=True)
    role.add_argument('--index', type=int, required=True)
    merger = commands.add_parser('merge')
    merger.add_argument('--plan', type=Path, required=True)
    merger.add_argument('--shard-root', type=Path, required=True)
    merger.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == 'plan':
        durations = load_durations(args.durations) if args.durations else None
        gate = load_sets(args.sets) if args.sets else None
        document = plan(discover(args.ui_tests), args.shards, args.dedicated, durations, args.set, gate)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(document, indent=2) + '\n')
        sizes = ', '.join(str(len(row['cases'])) for row in document['shards'])
        print(f'UI shard plan: {document["case_count"]} cases in {document["shard_count"]} shards ({sizes}), by {document["balance"]}; '
              f'set {document["set"]}, {len(document["excluded"])} excluded')
        if durations is not None:
            estimates = ', '.join(f'{row["estimated_seconds"] / 60:.1f}' for row in document['shards'] if 'estimated_seconds' in row)
            print(f'UI shard estimated minutes: {estimates}; stale durations: {len(document["stale_durations"])}')
        return 0
    if args.command in ('arguments', 'dedicated'):
        document = read_plan(args.plan)
        rows = [row for row in document['shards'] if row['index'] == args.index]
        if len(rows) != 1:
            raise ValueError(f'Shard {args.index} is not in the plan')
        if args.command == 'dedicated':
            print('yes' if rows[0]['dedicated'] else 'no')
        else:
            print('\n'.join(rows[0]['xcodebuild_arguments']))
        return 0
    document = merge(read_plan(args.plan), args.shard_root, args.evidence)
    print(f'UI shards: {document["verdict"]}; {document["started_cases"]}/{document["planned_cases"]} planned cases started')
    for problem in document['problems']:
        print(f'::error::UI shards: {problem}')
    return 0 if document['verdict'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(str(error))
