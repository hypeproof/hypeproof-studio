"""Admission coverage, not an attestation of real installation or feature behavior."""
from core import require

SCHEMA = 'hps-delivery-coverage/1'
PLATFORMS = {'darwin-arm64', 'win32-x64'}


def validate(plan, candidate, matrix, identities=None):
    """Fail closed before native effects and again before active routing/publication.

    The reviewed plan owns applicability. Native observations own setup identity;
    never synthesize an observed setup from this plan.
    """
    require(isinstance(plan, dict) and plan.get('schema') == SCHEMA,
            'delivery coverage missing: require source PRs and clean-install/upgrade on both platforms')
    require(plan.get('sourceSha') == candidate.get('sourceSha'), 'delivery coverage source changed')
    prs = candidate.get('sourcePrs')
    require(isinstance(prs, list) and prs and all(type(p) is int and p > 0 for p in prs)
            and len(set(prs)) == len(prs), 'delivery coverage needs explicit candidate source PRs')
    changes = plan.get('changes')
    require(isinstance(changes, list) and all(isinstance(c, dict) and type(c.get('pr')) is int for c in changes)
            and len(changes) == len(prs) and {c['pr'] for c in changes} == set(prs),
            'delivery coverage must account for every source PR exactly once')
    for change in changes:
        require(isinstance(change.get('reason'), str) and len(change['reason'].strip()) >= 20,
                'source PR coverage needs a concrete impact rationale')
        cases = change.get('cases')
        require(isinstance(cases, list) and all(isinstance(c, str) for c in cases)
                and len(set(cases)) == len(cases), 'invalid source PR coverage cases')
        if change.get('disposition') == 'non-runtime':
            require(not cases, 'non-runtime classification must not claim runtime coverage')
        else:
            require(change.get('disposition') == 'runtime' and cases,
                    'runtime source PR requires native feature cases')
            require(all((case, target) in matrix for case in cases for target in PLATFORMS),
                    'runtime feature coverage missing on a required platform')
    journeys = plan.get('journeys')
    require(isinstance(journeys, dict) and set(journeys) == {'clean-install', 'upgrade'},
            'both clean-install and upgrade journeys required')
    used = set()
    for scenario, targets in journeys.items():
        require(isinstance(targets, dict) and set(targets) == PLATFORMS,
                'delivery journey missing a required platform')
        for target, case in targets.items():
            require(isinstance(case, str) and (case, target) in matrix and (case, target) not in used,
                    'delivery journey requires a distinct selected case/platform')
            used.add((case, target))
            if identities is not None:
                identity = identities[(case, target)]
                setup = identity.get('installation')
                require(isinstance(setup, dict) and setup.get('scenario') == scenario,
                        'native setup identity does not prove the required installation scenario')
                require(setup.get('dependencyProvisioning') in {'installer', 'user-flow'},
                        'preseeded or unknown dependencies cannot prove installation delivery')
                if scenario == 'upgrade':
                    require(setup.get('previousArtifactSha256') != identity.get('artifactSha256'),
                            'upgrade must start from a different identified package')
    return plan
