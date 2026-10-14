#!/usr/bin/env python3
"""Positive and negative controls for scripts/check-customer-names.py.

Uses a synthetic denylist so the controls never need a real customer name.
"""
import hashlib
import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location(
    "check_customer_names", pathlib.Path(__file__).with_name("check-customer-names.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

term = "zqxw치과"
deny = {(len(term), hashlib.sha256(term.encode()).hexdigest())}

# Positive: inside an ID, with a Korean particle, and in another case.
assert mod.offending_terms("cohort zqxw치과-2026-a", deny)
assert mod.offending_terms("오늘 ZQXW치과의 수업", deny)
# Negative: near misses and unrelated text.
assert not mod.offending_terms("zqx치과 zqxw 치과", deny)
assert not mod.offending_terms("dental-pilot-2026-a 예시치과", deny)
# The shipped denylist stores digests only.
assert all(len(d) == 64 and int(d, 16) >= 0 for _, d in mod.DENYLIST)
print("check-customer-names: positive and negative controls pass")
