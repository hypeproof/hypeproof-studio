#!/usr/bin/env python3
"""Split the iOS UI suite into shards and merge their results without losing a case.

`plan` reads the XCTest declarations in ios/UITests and assigns every case to one shard.
Shards 1..N-1 run only their own cases; the last shard skips the cases of the others, so a
case this parser misses still runs there instead of disappearing. A `--dedicated` case runs in
none of them: it gets its own row, index N+1, which its own job runs (#4432: the real Korean
voice case runs after the simulator settles, apart from the other cases).

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
TARGET = 'HPStudioUITests'
CLASS = re.compile(r'^\s*(?:final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*XCTestCase\b')
# Attributes and modifiers such as `@MainActor` may precede the declaration.
TEST = re.compile(r'^\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s+)*'
                  r'(?:(?:override|public|internal|open|final|nonisolated)\s+)*'
                  r'func\s+(test[A-Za-z0-9_]*)\s*\(\s*\)')
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


def plan(classes, shards: int, dedicated=()):
    if not 2 <= shards <= 8:
        raise ValueError('Shard count must be between 2 and 8')
    dedicated = list(dict.fromkeys(dedicated))
    declared = {f'{TARGET}/{name}/{test}' for name, tests in classes.items() for test in tests}
    missing = [case for case in dedicated if case not in declared]
    if missing:
        raise ValueError(f'Dedicated case(s) not declared: {", ".join(missing)}')
    assigned = [[] for _ in range(shards)]
    offset = 0
    # Round-robin inside each class keeps every shard a similar mix of short and long classes.
    # The start offset rotates so one shard does not collect every class remainder.
    for name in sorted(classes):
        tests = [test for test in classes[name] if f'{TARGET}/{name}/{test}' not in dedicated]
        for position, test in enumerate(tests):
            assigned[(offset + position) % shards].append(f'{TARGET}/{name}/{test}')
        offset = (offset + len(tests)) % shards
    if any(not cases for cases in assigned):
        raise ValueError('Every shard needs at least one case; lower the shard count')
    rows = []
    for index, cases in enumerate(assigned, start=1):
        if index < shards:
            arguments = [f'-only-testing:{case}' for case in cases]
        else:
            # The catch-all shard also skips the dedicated cases; their own row runs them.
            arguments = [f'-skip-testing:{case}' for other in assigned[:-1] + [dedicated] for case in other]
        rows.append({'index': index, 'cases': cases, 'dedicated': False, 'xcodebuild_arguments': arguments})
    if dedicated:
        rows.append({'index': shards + 1, 'cases': dedicated, 'dedicated': True,
                     'xcodebuild_arguments': [f'-only-testing:{case}' for case in dedicated]})
    return {'schema': SCHEMA_PLAN, 'target': TARGET, 'shard_count': len(rows), 'catch_all': shards,
            'case_count': sum(len(row['cases']) for row in rows), 'shards': rows}


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
    for (index, directory), row in zip(shard_dirs, plan_doc['shards']):
        result = shard_exit(directory) if directory.is_dir() else None
        log = directory / 'simulator-test.log'
        text = log.read_text(errors='replace') if log.is_file() and not log.is_symlink() else ''
        combined.append(f'native verification: UI shard {index}/{count}\n{text}')
        for case in set(started_cases(text)):
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
    unplanned = sorted(case for case in seen if case not in owner)
    unplanned_outside_last = [case for case in unplanned if seen[case] != [catch_all]]
    if not_run:
        problems.append(f'{len(not_run)} planned case(s) never started')
    if misplaced:
        problems.append(f'{len(misplaced)} case(s) started outside their own shard or in two shards')
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
                'unplanned_outside_last_shard': unplanned_outside_last, 'problems': problems}
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
        document = plan(discover(args.ui_tests), args.shards, args.dedicated)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(document, indent=2) + '\n')
        sizes = ', '.join(str(len(row['cases'])) for row in document['shards'])
        print(f'UI shard plan: {document["case_count"]} cases in {document["shard_count"]} shards ({sizes})')
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
