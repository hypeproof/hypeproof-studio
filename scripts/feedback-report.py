#!/usr/bin/env python3
"""Render a portable, evidence-bound feedback report without network dependencies."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import shutil
from pathlib import Path

STATUSES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "STALE", "HUMAN_PENDING"}


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def artifact(root: Path, reference: dict) -> Path:
    name = reference.get("path", "")
    if not isinstance(name, str) or not name or ":" in name or "\\" in name:
        raise ValueError("Invalid evidence path")
    path = root / name
    if Path(name).is_absolute() or ".." in Path(name).parts or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Evidence escapes report directory")
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Missing evidence: {name}")
    if hashlib.sha256(path.read_bytes()).hexdigest() != reference.get("sha256"):
        raise ValueError(f"Evidence hash mismatch: {name}")
    return path


def validate(root: Path, acceptance: dict, evidence: dict) -> list[dict]:
    canonical = {key: value for key, value in acceptance.items() if key != "revision"}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if acceptance["revision"] != digest:
        raise ValueError("Acceptance content hash mismatch")
    if acceptance["revision"] != evidence.get("acceptance_revision"):
        raise ValueError("Acceptance revision mismatch")
    expected = {row["test_id"]: row for row in acceptance["tests"]}
    actual = {}
    for row in evidence["tests"]:
        test_id = row["test_id"]
        if test_id not in expected or test_id in actual:
            raise ValueError(f"Unknown or duplicate test: {test_id}")
        if row["status"] not in STATUSES:
            raise ValueError(f"Invalid status: {test_id}")
        for key in ("requirement_wp", "scenario", "acceptance"):
            if key in row and row[key] != expected[test_id].get(key):
                raise ValueError(f"Evidence cannot redefine frozen criteria: {test_id}")
        refs = row.get("evidence_refs", [])
        for ref in refs:
            artifact(root, ref)
        if row["status"] == "PASS":
            if not refs or not row.get("observations") or not row.get("finished_at"):
                raise ValueError(f"PASS lacks observed evidence: {test_id}")
            bound = row.get("implementation", {})
            if not bound or any(len(str(sha)) != 40 or any(c not in "0123456789abcdef" for c in sha) for sha in bound.values()):
                raise ValueError(f"PASS lacks implementation binding: {test_id}")
            current = evidence.get("implementation", {})
            if any(current.get(repo) != sha for repo, sha in bound.items()):
                row = {**row, "status": "STALE", "limitations": [*row.get("limitations", []), "구현 SHA가 바뀌어 재검증이 필요합니다."]}
            if row.get("scope") == "human" and row.get("evaluator", {}).get("kind") != "human":
                raise ValueError(f"Human acceptance requires human evidence: {test_id}")
        actual[test_id] = {**expected[test_id], **row}
    return [actual.get(key, {**criteria, "status": "NOT_RUN", "scope": "unobserved", "limitations": ["실행 근거 없음"]}) for key, criteria in expected.items()]


CSS = """
:root{font-family:system-ui,sans-serif;color:#17233b;background:#f3f6fb;line-height:1.65}
body{max-width:1120px;margin:auto;padding:24px}h1{line-height:1.25}a{color:#174daa}
header,article,aside{background:white;border:1px solid #ccd5e4;border-radius:12px;padding:20px;margin:16px 0}
.meta,small{color:#526078}.status{font-weight:750;padding:3px 8px;border-radius:5px;background:#edf0f4}
.PASS{background:#d9f3e3;color:#11572b}.FAIL,.STALE{background:#ffe1e1;color:#8c1919}.BLOCKED{background:#fff0cc;color:#715000}
input,select{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}nav{display:flex;gap:16px;flex-wrap:wrap}
code{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:110px 1fr;gap:8px}dd{margin:0;overflow-wrap:anywhere}
@media(max-width:600px){body{padding:12px}article{padding:14px}dl{display:block}dt{font-weight:700}dd{margin-bottom:10px}}
@media print{body{background:white;max-width:none}.filters{display:none}article{break-inside:avoid}a{color:inherit}article[hidden]{display:block}}
"""


def page(title: str, body: str, script: str = "") -> str:
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title><style>{CSS}</style></head><body>{body}{script}</body></html>'


def render(root: Path) -> Path:
    acceptance = json.loads((root / "acceptance.json").read_text())
    evidence = json.loads((root / "evidence.json").read_text())
    rows = validate(root, acceptance, evidence)
    manual = Path(__file__).resolve().parents[1] / "docs/manual/studio-feedback-20261016"
    if manual.is_dir():
        shutil.copytree(manual, root / "manual", dirs_exist_ok=True)
    counts = {status: sum(row["status"] == status for row in rows) for status in sorted(STATUSES)}
    summary = " · ".join(f"{status} {count}" for status, count in counts.items() if count)
    body = f'''<header><p class="meta">Studio 피드백 · Owner 사용량/비용</p><h1>구현 및 검증 결과</h1>
<p>{escape(summary)}</p><p>운영 반영: <strong>{escape(evidence.get('release_status', 'NOT_RUN'))}</strong> · 사람 인수: <strong>{escape(evidence.get('human_acceptance', 'HUMAN_PENDING'))}</strong></p>
<p class="meta">갱신: {escape(evidence.get('generated_at', '미확인'))}<br>기준 revision: <code>{escape(acceptance['revision'])}</code></p>
<nav><a href="evidence.json">실행 근거 JSON</a><a href="acceptance.json">고정 수용 기준</a><a href="baseline.json">시작 버전</a><a href="manual/index.html">사용 매뉴얼</a></nav></header>
<aside>로컬·합성 검사, 후보 앱, 출하 설치본, 운영 확인과 사람 인수는 별개입니다. 원본 비교 자료와 제공자 청구 자료가 없으면 해당 검증은 완료로 표시하지 않습니다. 개인 키 직접 호출·서버로 전송되지 않은 기록·과거 유실분은 수집 범위 밖입니다. 토큰 사용량은 학습 성과가 아닙니다.</aside>
<div class="filters"><label>검색 <input id="search" type="search" placeholder="요구사항 또는 검사 이름"></label> <label>상태 <select id="status"><option value="">전체</option>{''.join(f'<option>{s}</option>' for s in sorted(STATUSES))}</select></label><p id="visible" aria-live="polite"></p></div>'''
    for row in rows:
        refs = " ".join(f'<a href="{escape(ref["path"])}">{escape(ref["path"])}</a>' for ref in row.get("evidence_refs", [])) or "없음"
        observations = "<br>".join(escape(x) for x in row.get("observations", [])) or "아직 관측하지 않았습니다."
        limitations = "<br>".join(escape(x) for x in row.get("limitations", [])) or "기록 없음"
        sha = "<br>".join(f'{escape(repo)}: <code>{escape(value)}</code>' for repo, value in row.get("implementation", {}).items()) or "미실행"
        body += f'''<article data-status="{row['status']}"><h2>{escape(row['test_id'])} · {escape(row['scenario'])}</h2><span class="status {row['status']}">{row['status']}</span><dl>
<dt>요구사항</dt><dd>{escape(row['requirement_wp'])}</dd><dt>수용 기준</dt><dd>{escape(row['acceptance'])}</dd>
<dt>검증 범위</dt><dd>{escape(row.get('scope', 'unobserved'))}</dd><dt>관측 결과</dt><dd>{observations}</dd>
<dt>근거</dt><dd>{refs}</dd><dt>구현</dt><dd>{sha}</dd><dt>남은 확인</dt><dd>{limitations}</dd></dl></article>'''
    script = '''<script>const cards=[...document.querySelectorAll('article')];function filter(){let n=0;const q=document.querySelector('#search').value.toLowerCase(),s=document.querySelector('#status').value;for(const card of cards){card.hidden=!!((s&&card.dataset.status!==s)||!card.textContent.toLowerCase().includes(q));if(!card.hidden)n++;}document.querySelector('#visible').textContent=n+'개 검사 표시';}document.querySelector('#search').addEventListener('input',filter);document.querySelector('#status').addEventListener('change',filter);filter();</script>'''
    output = root / "report.html"
    output.write_text(page("Studio 구현 및 검증 결과", body, script))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(render(parser.parse_args().directory))
