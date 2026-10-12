"""Fail if any shipped font has vertical metrics that differ between platforms.

Why (2026-10-11): Univers shipped with hhea ascent/descent 724/276 but OS/2 win ascent/descent
~969/250. Apple (Safari, iOS, the Mac app) lays text out with hhea; WebKit on Windows, where the
layout guards run, uses the win values. So every label centred by its line box was centred in the
guards and ~14% of its font size too high on the owner's devices: the guards could never see it.
With hhea == typo == win (and no line gap), every engine builds the same line box, so what the
guards measure is what an iPhone draws.

    python scripts/check-font-metrics.py          (npm run check:fonts)
"""
import glob
import os
import sys

from fontTools.ttLib import TTFont

FONTS = os.path.join(os.path.dirname(__file__), '..', 'vite-app', 'public', 'fonts')

bad = []
files = sorted(glob.glob(os.path.join(FONTS, '*.woff2')) + glob.glob(os.path.join(FONTS, '*.otf')) + glob.glob(os.path.join(FONTS, '*.ttf')))
for path in files:
    t = TTFont(path)
    h, o = t['hhea'], t['OS/2']
    use_typo = o.version >= 4 and bool(o.fsSelection & (1 << 7))
    # What each engine uses: Apple = hhea (+ lineGap); Windows = win, or typo when USE_TYPO_METRICS.
    apple = (h.ascent, -h.descent, h.lineGap)
    win = (o.sTypoAscender, -o.sTypoDescender, o.sTypoLineGap) if use_typo else (o.usWinAscent, o.usWinDescent, 0)
    if apple != win:
        bad.append(f'{os.path.basename(path)}: Apple (hhea) {apple} vs Windows {win}')

if bad:
    print('Font vertical metrics differ between Apple and Windows (labels will sit at different heights):')
    print('\n'.join('  ' + b for b in bad))
    print('Fix: set hhea ascent/descent and OS/2 typo ascender/descender to the win values, line gaps 0.')
    sys.exit(1)
print(f'font metrics consistent across platforms ({len(files)} files)')
