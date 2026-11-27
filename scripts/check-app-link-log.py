#!/usr/bin/env python3
"""Read the app's console from the in-app link check (.github/workflows/app-link-check.yml) and judge it.

The page, opened with ?probe=layout, logs "[fg-layout] {json}" lines (vite-app/src/utils/layout-probe.js): where every
piece of the replay sits against the safe area the iPhone's window gives. This passes only when a report arrived,
the page is the replay, the window's insets were known, and in the last report no piece reaches under the clock,
the home bar or off the screen's sides.

    python3 scripts/check-app-link-log.py <log> <label> [summary.md]
"""
import json
import sys

MARK = '[fg-layout] '


def reports(text):
    out = []
    for line in text.splitlines():
        i = line.find(MARK)
        if i < 0:
            continue
        body = line[i + len(MARK):].strip()
        try:
            out.append(json.loads(body))
        except ValueError:
            # A long line can arrive cut; the next report says the same.
            continue
    return out


def judge(reps):
    """(ok, why) for the reports of one launch."""
    if not reps:
        return False, 'no report: the page never logged (did the link open?)'
    last = reps[-1]
    if last.get('error'):
        return False, 'the probe failed: ' + last['error']
    if last.get('view') != 'replay':
        return False, 'the link did not open the replay (view: %s)' % last.get('view')
    if not last.get('native'):
        return False, 'the window gave no insets (the SafeArea plugin did not answer)'
    if last.get('pieces', 0) == 0:
        return False, 'nothing measured'
    if last.get('bad'):
        b = last['bad'][0]
        return False, '%d piece(s) in the safe area or off the screen, e.g. %s at %s..%s (band %s top, %s bottom of %s)' % (
            len(last['bad']), b['sel'], b['top'], b['bottom'], last['band']['top'], last['band']['bottom'], last['H'])
    return True, 'ok: %d pieces inside %s..%s of %s (window insets %s / %s, env() %s / %s, page %s / %s)' % (
        last['pieces'], last['band']['top'], last['H'] - last['band']['bottom'], last['H'],
        last['native'].get('top'), last['native'].get('bottom'), last['env']['top'], last['env']['bottom'],
        last['sa']['top'], last['sa']['bottom'])


def main():
    path, label = sys.argv[1], sys.argv[2]
    summary = sys.argv[3] if len(sys.argv) > 3 else None
    with open(path, encoding='utf-8', errors='replace') as f:
        reps = reports(f.read())
    ok, why = judge(reps)
    line = '%s %s: %s' % ('PASS' if ok else 'FAIL', label, why)
    print(line)
    for r in reps:
        print('  at %ss %s env %s sa %s native %s bad %d' % (r.get('at'), r.get('path'), r.get('env'), r.get('sa'), r.get('native'), len(r.get('bad') or [])))
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write('- ' + line + '\n')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
