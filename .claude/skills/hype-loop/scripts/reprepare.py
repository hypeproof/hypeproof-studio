#!/usr/bin/env python3
"""reprepare.py - re-bind an open PR's hype-pr preparation to its new head (hypeproof-harness#398).

    reprepare.py --checkout WT --repo hypeproof/<r> --pr N --assessment OLD.json [--retries 2] [--wrapper SH]

A rebase or a fix commit moves a loop PR's head, and its `<!-- hype-pr-prepared:v1 -->`
footnote then names a head that no longer exists. This re-runs `pr.py inspect` in the
checkout, carries the agent's judgments over from OLD.json, runs `pr.py prepare` and
replaces only the footnote in the PR body. Everything above the footnote is kept.

The judgments are carried only when the affected nodes and unmapped paths are exactly
the ones OLD.json judged. Otherwise nothing is prepared or edited and the script exits 3
with the added and dropped ids, because a judgment is never applied to a node it was not
written for. A stale fingerprint (a source repository moved between inspect and prepare)
is retried from inspect, at most --retries more times.

GitHub reads and the body edit run through --wrapper (default: this Harness's
scripts/agent-identity/with-agent-identity.sh), so they use the bot's token, not the
person's. Prints one JSON object; exit 0 done, 3 reassess, 2 error.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[3]
MARK = re.compile(r"^<!-- hype-pr-prepared:v1 -->", re.M)  # at a line start, so a quoted mention above is kept
CARRIED = ("summary", "reviews", "path_links", "validation")


class Refused(Exception):
    pass


def run(cmd: list[str], cwd: Path | None = None) -> str:
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, "HYPEPROOF_HARNESS": str(HARNESS)})
    if out.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}: {(out.stderr or out.stdout).strip()[-800:]}")
    return out.stdout


def summary(report: dict) -> str:
    spec = importlib.util.spec_from_file_location("hp_preparation", HARNESS / "scripts/hype-pr/preparation.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(HARNESS / "scripts/hype-pr"))
    spec.loader.exec_module(module)
    return module.summary(report)


def carry(old: dict, new: dict) -> dict:
    """The new template with the old judgments, when they judge exactly the same ids."""
    for key in ("reviews", "path_links"):
        added, dropped = sorted(set(new[key]) - set(old[key])), sorted(set(old[key]) - set(new[key]))
        if added or dropped:
            raise Refused(f"{key} changed: added {added}, dropped {dropped}; write a new assessment")
    return {**new, **{key: old[key] for key in CARRIED}}


def prepare(checkout: Path, repo: str, old: dict, work: Path, retries: int) -> tuple[dict, int]:
    for attempt in range(1, retries + 2):
        inspect, template, carried = work / "inspect.json", work / "template.json", work / "assessment.json"
        run([sys.executable, "scripts/hype-pr/pr.py", "inspect", "--repo", repo, "--output", str(inspect),
             "--assessment-template", str(template)], cwd=checkout)
        carried.write_text(json.dumps(carry(old, json.loads(template.read_text())), ensure_ascii=False, indent=2))
        try:
            out = run([sys.executable, "scripts/hype-pr/pr.py", "prepare", "--repo", repo, "--assessment", str(carried)], cwd=checkout)
        except RuntimeError as exc:
            if "assessment is stale" in str(exc) and attempt <= retries:
                continue  # a source repository moved between inspect and prepare
            raise
        return json.loads(out.strip().splitlines()[-1]), attempt
    raise RuntimeError("unreachable")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--checkout", required=True, type=Path)
    p.add_argument("--repo", required=True)
    p.add_argument("--pr", required=True, type=int)
    p.add_argument("--assessment", required=True, type=Path)
    p.add_argument("--retries", type=int, default=2)
    p.add_argument("--wrapper", default=str(HARNESS / "scripts/agent-identity/with-agent-identity.sh"))
    args = p.parse_args(argv)
    try:
        if not args.repo.startswith("hypeproof/"):
            raise ValueError(f"repo must be addressed as hypeproof/<repo>, got {args.repo!r}")
        old = json.loads(args.assessment.read_text())
        with tempfile.TemporaryDirectory(prefix="hp-reprepare-") as tmp:
            prepared, attempts = prepare(args.checkout.resolve(), args.repo, old, Path(tmp), args.retries)
            report = json.loads(Path(prepared["receipt"]).read_text())["report"]
            gh = ["bash", args.wrapper, "gh"]
            view = json.loads(run([*gh, "pr", "view", str(args.pr), "--repo", args.repo, "--json", "body,headRefOid"]))
            if view["headRefOid"] != prepared["head"]:
                raise RuntimeError(f"PR #{args.pr}'s head is {view['headRefOid']} but the checkout prepared {prepared['head']}; "
                                   "push the checkout first (nothing edited)")
            body = view["body"].replace("\r\n", "\n")  # a body edited on github.com comes back with CRLF
            new_body = Path(tmp) / "body.md"
            new_body.write_text(MARK.split(body, 1)[0].rstrip() + summary(report))
            run([*gh, "pr", "edit", str(args.pr), "--repo", args.repo, "--body-file", str(new_body)])
    except Refused as exc:
        print(json.dumps({"status": "reassess", "pr": args.pr, "detail": str(exc)}))
        return 3
    except (RuntimeError, ValueError, OSError, KeyError) as exc:
        print(json.dumps({"status": "error", "pr": args.pr, "error": str(exc)}))
        return 2
    print(json.dumps({"status": "refreshed", "pr": args.pr, "head": prepared["head"], "attempts": attempts,
                      "receipt": prepared["receipt"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
