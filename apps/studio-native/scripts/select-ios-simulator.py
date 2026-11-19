#!/usr/bin/env python3
"""Choose a phone supported by an available runtime matching the selected SDK."""
import json
import sys


def select(document, sdk):
    version = sdk.split('.')[:2]
    preferred = ['iPhone-18-Pro', 'iPhone-17', 'iPhone-16-Pro']
    prefix = 'com.apple.CoreSimulator.SimDeviceType.'
    candidates = []
    for runtime in document.get('runtimes', []):
        if runtime.get('isAvailable') is not True or '.iOS-' not in runtime.get('identifier', '') or runtime.get('version', '').split('.')[:2] != version:
            continue
        for device in runtime.get('supportedDeviceTypes', []):
            identifier = device.get('identifier', '')
            if not identifier.startswith(prefix + 'iPhone-'):
                continue
            name = identifier[len(prefix):]
            rank = preferred.index(name) if name in preferred else len(preferred)
            candidates.append((rank, identifier, runtime['identifier']))
    if not candidates:
        raise ValueError(f'No available iOS {sdk} runtime supports an iPhone')
    _, device, runtime = min(candidates)
    return device, runtime


if __name__ == '__main__':
    try:
        print(*select(json.load(sys.stdin), sys.argv[1]))
    except (ValueError, KeyError, IndexError, TypeError) as error:
        sys.exit(str(error))
