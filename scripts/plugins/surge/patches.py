#!/usr/bin/env python3
"""Copy Surge XT's factory patches for the app: patches.py <surge checkout> <out folder>

Every factory patch but the templates and tutorials, one .fxp per patch, by category. A few are
renamed: the app names no artists, songs, people or products, and drops a few crude jokes (the
patch inside is unchanged; the app shows the file's name).
"""
import os, shutil, sys
SRC = os.path.join(sys.argv[1], 'resources/data/patches_factory')
OUT = sys.argv[2]
SKIP_CATEGORIES = {'Templates', 'Tutorials'}
DROP = {'Leads/Clean Shit', 'Leads/Condom', 'Pads/Alias Pornography', 'Plucks/Pol Pot'}
RENAME = {
    'Brass/JX-10 Double Brass': 'Double Brass', 'Brass/OB-8 Jump': 'Jump Brass', 'Brass/Toto Brass': 'Eighties Brass',
    'FX/Fry\'s Holophoner': 'Holophoner', 'FX/XG Stardust': 'Stardust', 'Keys/DX EP': 'FM EP',
    'Leads/Moogy Saw': 'Ladder Saw', 'Pads/MKS-70 Warm Pad': 'Warm Pad 70', 'Pads/Xbox 1': 'Console 1', 'Pads/Xbox 2': 'Console 2',
    'Pads/Chowning': 'Classic FM Pad', 'Plucks/Hasselhoff': 'Big Hair', 'Plucks/Reverend B': 'Reverend', 'Plucks/Mr. Sparkle': 'Sparkle',
    'Polysynths/Juno-60 Strings': 'Vintage Poly Strings', 'Polysynths/Jupiter-8': 'Poly Eight', 'Polysynths/Korg Triton': 'Workstation',
    'Polysynths/Oberheim Dreams': 'Analog Dreams', 'Polysynths/PPG Choir': 'Wave Choir', 'Polysynths/PPG Dreams': 'Wave Dreams',
    'Polysynths/Polymoog': 'Vintage Polysynth', 'Polysynths/Prophet VS': 'Vector Poly', 'Polysynths/Super Jupiter': 'Super Poly',
    'Polysynths/Xpander 1': 'Expander 1', 'Polysynths/Xpander 2': 'Expander 2', 'Polysynths/Separate Ways': 'Arena Synth',
    'Sequences/I Want To Get Well': 'Get Well',
}
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
n = 0
for cat in sorted(os.listdir(SRC)):
    if cat in SKIP_CATEGORIES or not os.path.isdir(os.path.join(SRC, cat)):
        continue
    for f in sorted(os.listdir(os.path.join(SRC, cat))):
        if not f.endswith('.fxp'):
            continue
        key = f'{cat}/{f[:-4]}'
        if key in DROP:
            continue
        os.makedirs(os.path.join(OUT, cat), exist_ok=True)
        shutil.copy(os.path.join(SRC, cat, f), os.path.join(OUT, cat, RENAME.get(key, f[:-4]) + '.fxp'))
        n += 1
print(n, 'patches')
