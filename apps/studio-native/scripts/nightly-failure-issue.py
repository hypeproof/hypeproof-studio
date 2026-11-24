#!/usr/bin/env python3
"""Record a failed nightly iOS UI run on one open issue (#4432 stage 3).

The nightly workflow runs the cases that are not in the PR and main gate. When it fails, this
script adds a comment to the one open issue that carries MARKER, or opens that issue when none
is open. It never opens a second issue while one is open. It uses only the job's GITHUB_TOKEN.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import urllib.request

MARKER = '<!-- hps-native-nightly-failure:v1 -->'
TITLE = 'Studio native nightly: iOS UI nightly set failed'
BOT = 'github-actions[bot]'
API = 'https://api.github.com'
MAX_PAGES = 10


def api(token):
    def call(method, path, body=None):
        request = urllib.request.Request(API + path, method=method,
                                         data=None if body is None else json.dumps(body).encode(),
                                         headers={'Authorization': 'Bearer ' + token,
                                                  'Accept': 'application/vnd.github+json',
                                                  'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read() or b'null')
    return call


def find_open(call, repository):
    """The oldest open issue this workflow opened, or None. Pull requests are not issues here."""
    found = []
    for page in range(1, MAX_PAGES + 1):
        rows = call('GET', f'/repos/{repository}/issues?state=open&creator={BOT.replace("[", "%5B").replace("]", "%5D")}'
                           f'&per_page=100&page={page}')
        if not isinstance(rows, list):
            raise ValueError('Malformed issue list')
        found += [row for row in rows if isinstance(row, dict) and 'pull_request' not in row
                  and (row.get('user') or {}).get('login') == BOT and MARKER in (row.get('body') or '')]
        if len(rows) < 100:
            break
    return min(found, key=lambda row: row['number']) if found else None


def report(run_url, sha, results):
    lines = [f'- Run: {run_url}', f'- Source: `{sha}`', '- Jobs:']
    lines += [f'  - `{name}`: {result}' for name, result in sorted(results.items())]
    return '\n'.join(lines)


def record(call, repository, run_url, sha, results):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('A full source SHA is required')
    if not isinstance(results, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in results.items()):
        raise ValueError('Job results must map job names to results')
    text = report(run_url, sha, results)
    issue = find_open(call, repository)
    if issue is not None:
        call('POST', f'/repos/{repository}/issues/{issue["number"]}/comments', {'body': 'The nightly set failed again.\n\n' + text})
        return {'action': 'commented', 'number': issue['number']}
    body = (MARKER + '\n'
            'The nightly iOS UI set failed. These cases are not in the PR and main gate (ios-ui-sets.json, #4432).\n'
            'Every later failure is added here as a comment while this issue is open.\n\n' + text)
    created = call('POST', f'/repos/{repository}/issues', {'title': TITLE, 'body': body})
    return {'action': 'opened', 'number': created['number']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', required=True, help='JSON object: job name to result')
    args = parser.parse_args(argv)
    repository = os.environ['GITHUB_REPOSITORY']
    run_url = f'{os.environ["GITHUB_SERVER_URL"]}/{repository}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    outcome = record(api(os.environ['GITHUB_TOKEN']), repository, run_url, os.environ['GITHUB_SHA'], json.loads(args.results))
    print(f'Nightly failure {outcome["action"]} issue #{outcome["number"]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
