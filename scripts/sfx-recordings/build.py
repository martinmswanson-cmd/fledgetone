#!/usr/bin/env python3
"""
The recordings the sound effects maker layers under its modern sounds: public-domain (CC0) foley
fetched from where it's published, cut into groups of takes, trimmed, levelled and converted to
mono MP3 in public/fledgetone-sfx/<group>/<n>.mp3, with src/audio/sfx/sfxRecordingSets.ts
describing them (generated: don't edit by hand) and public/fledgetone-sfx/README.txt crediting them.

    python3 scripts/sfx-recordings/build.py <cache dir>

Needs curl, unzip and ffmpeg (with libmp3lame). Every source is CC0 1.0 (public domain); the
README names who made each, as thanks (it isn't required).
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'fledgetone-sfx')
TS = os.path.join(ROOT, 'src', 'audio', 'sfx', 'sfxRecordingSets.ts')

# Where each source comes from: (name, url, kind: zip or file, who made it, its page)
SOURCES = [
    ('impact', 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', 'zip', 'Kenney', 'https://kenney.nl/assets/impact-sounds'),
    ('rpg', 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip', 'zip', 'Kenney', 'https://kenney.nl/assets/rpg-audio'),
    ('ui', 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', 'zip', 'Kenney', 'https://kenney.nl/assets/interface-sounds'),
    ('scifi', 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip', 'zip', 'Kenney', 'https://kenney.nl/assets/sci-fi-sounds'),
    ('casino', 'https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip', 'zip', 'Kenney', 'https://kenney.nl/assets/casino-audio'),
    ('water', 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip', 'zip', 'rubberduck', 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx'),
    ('loops', 'https://opengameart.org/sites/default/files/sfx_loops.zip', 'zip', 'rubberduck', 'https://opengameart.org/content/30-cc0-sfx-loops'),
    ('rain', 'https://opengameart.org/sites/default/files/Rain%20OGG.zip', 'zip', 'Ylmir', 'https://opengameart.org/content/rain-loopable'),
    ('swish', 'https://opengameart.org/sites/default/files/swishes.zip', 'zip', 'artisticdude', 'https://opengameart.org/content/swishes-sound-pack'),
    ('fire', 'https://opengameart.org/sites/default/files/fire-1.wav', 'file', 'AntumDeluge', 'https://opengameart.org/content/fire-crackling'),
    ('whoosh', 'https://opengameart.org/sites/default/files/whoosh2_0.wav', 'file', 'pyranostudios', 'https://opengameart.org/content/air-whoosh'),
]

# The groups: id, label, the files (source, glob), whether it's a loop (kept whole, not trimmed)
GROUPS = [
    ('step-stone', 'Footstep: stone', [('impact', '**/footstep_concrete_*.ogg')], False),
    ('step-grass', 'Footstep: grass', [('impact', '**/footstep_grass_*.ogg')], False),
    ('step-snow', 'Footstep: snow', [('impact', '**/footstep_snow_*.ogg')], False),
    ('step-wood', 'Footstep: wood', [('impact', '**/footstep_wood_*.ogg')], False),
    ('step-carpet', 'Footstep: carpet', [('impact', '**/footstep_carpet_*.ogg')], False),
    ('step-dirt', 'Footstep: dirt', [('rpg', '**/footstep0*.ogg')], False),
    ('wood-light', 'Wood knock', [('impact', '**/impactWood_light_*.ogg')], False),
    ('wood-heavy', 'Wood hit', [('impact', '**/impactWood_heavy_*.ogg'), ('impact', '**/impactPlank_medium_*.ogg')], False),
    ('metal-light', 'Metal tap', [('impact', '**/impactMetal_light_*.ogg')], False),
    ('metal-heavy', 'Metal hit', [('impact', '**/impactMetal_heavy_*.ogg'), ('impact', '**/impactPlate_heavy_*.ogg')], False),
    ('glass', 'Glass', [('impact', '**/impactGlass_light_*.ogg'), ('impact', '**/impactGlass_medium_*.ogg')], False),
    ('glass-heavy', 'Glass smash', [('impact', '**/impactGlass_heavy_*.ogg')], False),
    ('punch', 'Punch', [('impact', '**/impactPunch_medium_*.ogg'), ('impact', '**/impactPunch_heavy_*.ogg')], False),
    ('soft', 'Soft thud', [('impact', '**/impactSoft_medium_*.ogg'), ('impact', '**/impactSoft_heavy_*.ogg')], False),
    ('stone-hit', 'Stone hit', [('impact', '**/impactMining_*.ogg')], False),
    ('bell', 'Bell strike', [('impact', '**/impactBell_heavy_*.ogg')], False),
    ('tin', 'Tin', [('impact', '**/impactTin_medium_*.ogg')], False),
    ('cloth', 'Cloth', [('rpg', '**/cloth*.ogg'), ('rpg', '**/clothBelt*.ogg')], False),
    ('blade-draw', 'Blade drawn', [('rpg', '**/drawKnife*.ogg')], False),
    ('blade-slice', 'Blade slice', [('rpg', '**/knifeSlice*.ogg'), ('rpg', '**/chop.ogg')], False),
    ('latch', 'Metal latch', [('rpg', '**/metalClick.ogg'), ('rpg', '**/metalLatch.ogg'), ('rpg', '**/beltHandle*.ogg')], False),
    ('coins', 'Coins', [('rpg', '**/handleCoins*.ogg'), ('casino', '**/chips-collide-*.ogg')], False),
    ('door-open', 'Door opening', [('rpg', '**/doorOpen_*.ogg'), ('rpg', '**/creak*.ogg')], False),
    ('door-close', 'Door closing', [('rpg', '**/doorClose_*.ogg')], False),
    ('page', 'Page turn', [('rpg', '**/bookFlip*.ogg')], False),
    ('book', 'Book', [('rpg', '**/bookOpen.ogg'), ('rpg', '**/bookClose.ogg'), ('rpg', '**/bookPlace*.ogg')], False),
    ('card', 'Card', [('casino', '**/card-slide-*.ogg'), ('casino', '**/card-place-*.ogg')], False),
    ('dice', 'Dice', [('casino', '**/dice-throw-*.ogg'), ('casino', '**/die-throw-*.ogg')], False),
    ('ui-click', 'Click', [('ui', '**/click_*.ogg'), ('ui', '**/tick_*.ogg')], False),
    ('ui-select', 'Select', [('ui', '**/select_*.ogg')], False),
    ('ui-switch', 'Switch', [('ui', '**/switch_*.ogg'), ('ui', '**/toggle_*.ogg')], False),
    ('ui-glass', 'Glass tap', [('ui', '**/glass_*.ogg')], False),
    ('ui-drop', 'Drop', [('ui', '**/drop_*.ogg')], False),
    ('explosion', 'Explosion', [('scifi', '**/explosionCrunch_*.ogg')], False),
    ('explosion-low', 'Explosion (low)', [('scifi', '**/lowFrequency_explosion_*.ogg')], False),
    ('laser', 'Laser', [('scifi', '**/laserSmall_*.ogg'), ('scifi', '**/laserLarge_*.ogg')], False),
    ('scifi-hit', 'Sci-fi impact', [('scifi', '**/impactMetal_*.ogg')], False),
    ('scifi-door', 'Sci-fi door', [('scifi', '**/doorOpen_*.ogg'), ('scifi', '**/doorClose_*.ogg')], False),
    ('computer', 'Computer', [('scifi', '**/computerNoise_*.ogg')], False),
    ('splash', 'Splash', [('water', '**/splash_*.ogg')], False),
    ('bubble', 'Bubble', [('water', '**/bubble_*.ogg')], False),
    ('slime', 'Slime', [('water', '**/slime_0[1-8].ogg')], False),
    ('swish', 'Swish', [('swish', '**/swish-[0-9]*.wav')], False),
    ('whoosh', 'Whoosh', [('whoosh', '*.wav')], False),
    ('rain', 'Rain (loop)', [('rain', '**/[0-9].ogg'), ('water', '**/loop_rain.ogg'), ('loops', '**/rain.ogg')], True),
    ('water', 'Water (loop)', [('water', '**/loop_water_*.ogg'), ('loops', '**/water_flowing.ogg')], True),
    ('bubbles', 'Bubbling (loop)', [('water', '**/loop_bubbles_*.ogg'), ('loops', '**/water_boiling.ogg')], True),
    ('fire', 'Fire (loop)', [('fire', '*.wav')], True),
    ('engine', 'Engine (loop)', [('scifi', '**/spaceEngineLow_*.ogg'), ('scifi', '**/engineCircular_*.ogg')], True),
    ('spaceship', 'Spaceship (loop)', [('scifi', '**/spaceEngineLarge_*.ogg'), ('scifi', '**/spaceEngine_*.ogg')], True),
    ('thruster', 'Thruster (loop)', [('scifi', '**/thrusterFire_*.ogg')], True),
    ('force-field', 'Force field (loop)', [('scifi', '**/forceField_*.ogg')], True),
    ('machine', 'Machine (loop)', [('loops', '**/machine_0[1-6].ogg')], True),
]

MAX_TAKES = 8
MAX_SECONDS = {False: 3.0, True: 10.0}


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fetch(cache):
    dirs = {}
    for name, url, kind, _, _ in SOURCES:
        d = os.path.join(cache, name)
        dirs[name] = d
        if os.path.isdir(d) and os.listdir(d):
            continue
        os.makedirs(d, exist_ok=True)
        target = os.path.join(cache, f'{name}.{"zip" if kind == "zip" else url.rsplit(".", 1)[1]}')
        run('curl', '-sSL', '-m', '300', '-o', target, url)
        if kind == 'zip':
            run('unzip', '-q', '-o', target, '-d', d)
        else:
            os.replace(target, os.path.join(d, os.path.basename(target)))
    return dirs


def peak_db(path):
    out = subprocess.run(['ffmpeg', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = re.search(r'max_volume: (-?[\d.]+) dB', out)
    return float(m.group(1)) if m else 0.0


def convert(src, dst, loop):
    # Mono, 48 kHz; a one-shot starts at its first sound and ends at its last (then a short fade);
    # a loop is kept whole (its join is made by the synth's crossfade); peaks levelled to -1 dBFS
    tmp = dst + '.wav'
    filters = ['aformat=channel_layouts=mono', 'aresample=48000']
    if not loop:
        filters += ['silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.002', 'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB', 'areverse', 'afade=t=in:st=0:d=0.001', 'areverse', 'afade=t=in:st=0:d=0.004', 'areverse']
    filters.append(f'atrim=0:{MAX_SECONDS[loop]}')
    run('ffmpeg', '-y', '-i', src, '-af', ','.join(filters), tmp)
    gain = -1.0 - peak_db(tmp)
    run('ffmpeg', '-y', '-i', tmp, '-af', f'volume={gain:.2f}dB', '-c:a', 'libmp3lame', '-q:a', '3', dst)
    os.remove(tmp)
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout
    return float(out.strip())


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    dirs = fetch(sys.argv[1])
    os.makedirs(OUT, exist_ok=True)
    sets = {}
    for gid, label, patterns, loop in GROUPS:
        files = []
        for source, pattern in patterns:
            files += sorted(f for f in glob.glob(os.path.join(dirs[source], pattern), recursive=True) if not os.path.basename(f).startswith('._'))
        files = files[:MAX_TAKES]
        if not files:
            sys.exit(f'no files for {gid}')
        folder = os.path.join(OUT, gid)
        os.makedirs(folder, exist_ok=True)
        for old in glob.glob(os.path.join(folder, '*.mp3')):
            os.remove(old)
        seconds = []
        digest = hashlib.sha256()
        size = 0
        for i, f in enumerate(files):
            dst = os.path.join(folder, f'{i}.mp3')
            seconds.append(round(convert(f, dst, loop), 3))
            with open(dst, 'rb') as fh:
                data = fh.read()
            digest.update(data)
            size += len(data)
        sources = sorted({p[0] for p in patterns})
        sets[gid] = {'label': label, 'takes': len(files), 'seconds': seconds, 'loop': loop, 'bytes': size, 'hash': digest.hexdigest()[:10], 'from': sources}
        print(f'{gid}: {len(files)} takes, {size // 1024} KB')

    by = {name: (who, page) for name, _, _, who, page in SOURCES}
    lines = [
        '/**',
        ' * The recordings the sound effects maker layers under its modern sounds (public/fledgetone-sfx/',
        ' * <group>/<take>.mp3), group by group: its label, how many takes, each take\'s length (seconds),',
        ' * whether it\'s a loop, its size and a fingerprint of its files. Public-domain (CC0) foley; who made',
        ' * it: public/fledgetone-sfx/README.txt. Generated by scripts/sfx-recordings/build.py; don\'t edit by hand.',
        ' */',
        '',
        'export interface SfxRecordingSet {',
        '  label: string;',
        '  takes: number;',
        '  seconds: number[];',
        '  loop: boolean;',
        '  bytes: number;',
        '  hash: string;',
        '}',
        '',
        'export const SFX_RECORDING_SETS: Record<string, SfxRecordingSet> = {',
    ]
    for gid, s in sets.items():
        lines.append(f"  '{gid}': {{ label: {json.dumps(s['label'])}, takes: {s['takes']}, seconds: {json.dumps(s['seconds'])}, loop: {'true' if s['loop'] else 'false'}, bytes: {s['bytes']}, hash: '{s['hash']}' }},")
    lines.append('};')
    with open(TS, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')

    credit = [
        'Recordings the Fledgetone sound effects maker layers under its sounds, converted to mono MP3.',
        'How they were made: scripts/sfx-recordings/build.py in the Fledgetone source.',
        'Every one is CC0 1.0 (public domain): free to use for anything, with no credit needed.',
        'With thanks to the people who made them:',
        '',
    ]
    for name, _, _, who, page in SOURCES:
        groups = [gid for gid, s in sets.items() if name in s['from']]
        credit.append(f'  {who}: {page}')
        credit.append(f'    {", ".join(groups)}')
    with open(os.path.join(OUT, 'README.txt'), 'w') as fh:
        fh.write('\n'.join(credit) + '\n')
    total = sum(s['bytes'] for s in sets.values())
    print(f'{len(sets)} groups, {sum(s["takes"] for s in sets.values())} files, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
