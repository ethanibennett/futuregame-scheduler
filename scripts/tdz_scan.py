# -*- coding: utf-8 -*-
"""Find temporal-dead-zone hazards the build cannot see.

A useMemo/useCallback DEPENDENCY ARRAY is evaluated on every render, and a
useMemo BODY runs during render too — so either one naming a const that is
declared further down the component puts the render itself in that const's
temporal dead zone. React throws, the error boundary catches it, and
`npm run build` says nothing at all, because it is a runtime error.

This has now bitten three times in this feature, so it is a script.
"""
import io, re, sys

PATH = 'D:/projects/scheduler/vite-app/src/components/HandReplayerView.jsx'
COMPONENT = 'function HandReplayerReplayView('

s = io.open(PATH, encoding='utf8').read()
body = s[s.index(COMPONENT):]

# Top-level const statements, in source order — object AND array destructuring,
# not just plain names. The first thing this scan missed was
# `const [rewinding, setRewinding] = useState(false)`, which is how every piece
# of component state in this file is declared.
decls = []
for m in re.finditer(r'\n  const (?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))\s*=', body):
    if m.group(1) is not None:
        names = [n.strip().split(':')[-1].strip() for n in m.group(1).split(',') if n.strip()]
    elif m.group(2) is not None:
        names = [n.strip() for n in m.group(2).split(',') if n.strip()]
    else:
        names = [m.group(3)]
    names = [n for n in names if re.fullmatch(r'[A-Za-z_$][\w$]*', n)]
    decls.append((names, m.start()))

first_pos = {}
for names, start in decls:
    for n in names:
        first_pos.setdefault(n, start)

# An initializer runs from its own declaration to the next top-level one.
spans = []
for i, (names, start) in enumerate(decls):
    end = decls[i + 1][1] if i + 1 < len(decls) else len(body)
    spans.append((names[0], start, end))

# Strings and comments are not references.
STRIP = re.compile(
    r"'(?:[^'\\]|\\.)*'"
    r'|"(?:[^"\\]|\\.)*"'
    r'|`(?:[^`\\]|\\.)*`'
    r'|//[^\n]*'
    r'|/\*(?:.|\n)*?\*/'
)

bad = []
for owner, start, end in spans:
    init = STRIP.sub(' ', body[start:end])
    for name, dpos in first_pos.items():
        if dpos <= start or len(name) < 3 or name == owner:
            continue
        if re.search(r'(?<![.\w$])' + re.escape(name) + r'(?![\w$])', init):
            bad.append((body[:start].count('\n') + 1, owner, name))

if bad:
    print('TDZ hazards — an initializer naming a const declared later:')
    for line, owner, ref in sorted(set(bad)):
        print('  line %-6d %-22s -> %s' % (line, owner, ref))
    sys.exit(1)
print('TDZ scan clean (%d top-level consts checked)' % len(spans))
