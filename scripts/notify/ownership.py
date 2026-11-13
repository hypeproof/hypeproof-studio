"""Canonical criterion ownership; independent of PR approval/merge eligibility.

Jay's 2026-11-13 decision (#635): Sediment's existing `core` means every
current HypeProof member. Membership is supplied from policy/members.yaml,
never from a consumer manifest or the GitHub account named `core`.
"""
import re

CORE_REPOSITORY = 'hypeproof/sediment'


def resolve(owner, repo, members):
    if owner is None or owner == '':
        return []
    if owner == 'core':
        if repo != CORE_REPOSITORY:
            raise ValueError('core ownership is only declared for hypeproof/sediment')
        if not members or not all(isinstance(m, str) and re.fullmatch(r'[A-Za-z0-9-]+', m) for m in members):
            raise ValueError('core needs a non-empty canonical human membership list')
        return sorted(set(members))
    if not isinstance(owner, str) or owner not in members:
        raise ValueError('unknown criterion owner')
    return [owner]
