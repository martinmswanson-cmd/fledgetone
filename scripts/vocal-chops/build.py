#!/usr/bin/env python3
"""
The Vocal Chops instruments' recordings: public-domain (CC0) voices cut into one-shot syllables,
tuned, laid across the keyboard and converted to mono MP3 in
public/fledgetone-samples/chops-<kit>/<note>_0_<take>.mp3, hosted like the other recorded
instruments (src/audio/hostedSets.ts is updated through scripts/real-samples/convert.py's
write_index, so its fingerprints stay right). Credits: src/credits.ts and
public/fledgetone-samples/README.txt.

    python3 -I scripts/vocal-chops/build.py <cache dir> [airy soul shout]

Needs git, curl, unzip, ffmpeg (with libmp3lame) and Python 3 with numpy and pyworld. Each source
is downloaded into its own folder in the cache (dl-<source>/) and read from there, never run.

Every source is CC0 1.0, checked on its own page (OpenGameArt's "License(s)" field) or in its
LICENSE file; recordings offered under other licences (CC BY, CC BY-SA) or none were left out.

How a chop is made:
1. Cut: the file (or the stretch of it SOURCES gives), trimmed to where its level first and last
   comes within 40 dB of its peak, at most the kit's longest chop.
2. Cleaned lightly: rumble under 70 Hz (110 Hz for the women's voices) filtered off, and a
   gentle spectral gate (at most 10 dB down, only where a bin sits within 6 dB of the recording's
   own noise floor) when there is any noise to speak of.
3. Tuned: its pitch tracked (WORLD's harvest); the energy-weighted median is its sung note, and
   moved with the WORLD vocoder onto each key it plays: the pitch moves, the voice's formants (its
   vowel, who it is) stay put, nudged up only a little on notes far above it, so a chop played high
   doesn't go chipmunk. Spoken syllables ("hey", "go") have their slide flattened towards the note
   (`keep`: how much of the wobble around it is left), so they sing it. Breaths and whispers have
   no pitch and play as they are.
4. Levelled: every chop to the same loud-part level (its 90th percentile of 10 ms frames), then a
   kit-wide gain leaves the loudest peak at -1 dBFS; 3 ms in and 25 ms out.

How a kit is laid out: a recording every other semitone across its range (so the app stretches one
at most a semitone, keeping it natural), each played by the next syllable of the kit's order, so a
tune walking up the keys says a different syllable on each step, as a chopped hook does. A syllable
goes on keys near where it was spoken or sung (within a fifth where it can), each about as often, never the
same one twice within four keys.
"""
import json
import os
import subprocess
import sys

import numpy as np
import pyworld as pw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'fledgetone-samples')
SR = 44100
FP = 5.0  # WORLD frame period, ms
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']

OGA = 'https://opengameart.org/sites/default/files/'
# id: (download, kind: git / zip / file, who made it, its page, licence as stated there)
SOURCES = {
    'legato': ('https://github.com/sfzinstruments/legato_vocal_tutorial', 'git', 'Karoryfer Samples',
               'https://github.com/sfzinstruments/legato_vocal_tutorial', 'CC0 1.0 (its LICENSE file)'),
    'bright': (OGA + 'Free%20Voice%20Clips%20Pack%20-%20Bright%20Female_0.zip', 'zip', 'cicifyre',
               'https://opengameart.org/content/voice-clip-packs-for-visual-novels-and-rpgs', 'CC0'),
    'mature': (OGA + 'Free%20Voice%20Clips%20Pack%20-%20Mature%20Female.zip', 'zip', 'cicifyre',
               'https://opengameart.org/content/voice-clip-packs-for-visual-novels-and-rpgs', 'CC0'),
    'dialog': (OGA + 'vocal_samples.zip', 'zip', 'mirceakitsune', 'https://opengameart.org/content/dialog-vocal-samples', 'CC0'),
    'oooo': (OGA + 'oooooooooo.ogg', 'file', 'nocturnalvanguard (AuraVoice)', 'https://opengameart.org/content/oooooooooooooo', 'CC0'),
    'humming': (OGA + 'ghostly_humming.ogg', 'file', 'nocturnalvanguard (AuraVoice)', 'https://opengameart.org/content/ghostly-humming', 'CC0'),
    'cheers': (OGA + 'cheers_1.ogg', 'file', 'nocturnalvanguard (AuraVoice)', 'https://opengameart.org/content/cheers-0', 'CC0'),
    'ohalright': (OGA + 'oh_alright.ogg', 'file', 'nocturnalvanguard (AuraVoice)', 'https://opengameart.org/content/oh-alright', 'CC0'),
    'auyeah': (OGA + 'auye.zip', 'zip', 'ignasd', 'https://opengameart.org/content/au-yeah', 'CC0'),
    'greeting': (OGA + 'greetingsounds.zip', 'zip', 'emopreben', 'https://opengameart.org/content/greeting-sounds-by-emopreben', 'CC0'),
    'kenneyvo': (OGA + 'Voiceover%20Pack.zip', 'zip', 'Kenney', 'https://opengameart.org/content/voiceover-pack-40-lines', 'CC0 (and its License.txt)'),
}

LEGATO = 'repo/Samples/vowel_short/a/vowel_a_{}_short_rr{}.wav'
BF = 'x/Free Voice Clips Pack - Bright Female/'
MF = 'x/Free Voice Clips Pack - Mature Female/'


def S(source, path, label, start=None, end=None, keep=0.25, pitched=True):
    """A syllable: a file in a source's folder (a stretch of it, seconds), its name, and how much of its pitch wobble to keep."""
    return {'source': source, 'path': path, 'label': label, 'start': start, 'end': end, 'keep': keep, 'pitched': pitched}


# The Soul kit's notes: the library's own short sung "a", every semitone (its file names sit an
# octave over the sung note); two takes each
SOUL_FILES = ['c3', 'db3', 'd3', 'eb3', 'e3', 'f3', 'gb3', 'g3', 'ab3', 'a3', 'bb3', 'b3',
              'c4', 'db4', 'd4', 'eb4', 'e4', 'f4', 'gb4', 'g4', 'ab4', 'a4', 'bb4']

KITS = {
    # Breathy women's voices: soft "ah", "haa", "eh", hums, "ooh", light blips and whispers
    'airy': {
        'range': (53, 79), 'cap': 0.75, 'hp': 110, 'lift': 0.12,
        'order': [
            S('mature', MF + 'noises/anime_ah.wav', 'ah'),
            S('humming', 'ghostly_humming.ogg', 'mm', 0.80, 1.60, keep=0.5),
            S('dialog', 'x/female_light_2.ogg', 'la'),
            S('mature', MF + 'noises/anime_haa.wav', 'haa'),
            S('dialog', 'x/whisper_1.ogg', 'whisper', pitched=False),
            S('oooo', 'oooooooooo.ogg', 'ooh', 0.0, 0.70, keep=0.4),
            S('mature', MF + 'noises/anime_eh.wav', 'eh'),
            S('dialog', 'x/female_standard_1.ogg', 'da'),
            S('humming', 'ghostly_humming.ogg', 'mm', 37.74, 38.60, keep=0.5),
            S('mature', MF + 'noises/sigh1.wav', 'sigh'),
            S('dialog', 'x/female_light_3.ogg', 'na'),
            S('dialog', 'x/female_standard_3.ogg', 'ba'),
            S('dialog', 'x/whisper_3.ogg', 'whisper', pitched=False),
        ],
    },
    # A low man's voice singing a short "ah" (the recordings are sung on their notes)
    'soul': {
        'range': (36, 66), 'cap': 0.6, 'hp': 70, 'lift': 0.18, 'takes': 2,
        'order': [S('legato', LEGATO.format(f, rr), 'ah', keep=1.0) for f in SOUL_FILES for rr in (1, 2)],
    },
    # Shouted and called words: "hey", "go", "yeah", cheers
    'shout': {
        'range': (48, 74), 'cap': 0.7, 'hp': 110, 'lift': 0.1,
        'order': [
            S('bright', BF + '01-hey.wav', 'hey', keep=0.15),
            S('kenneyvo', 'x/Male/go.ogg', 'go', keep=0.15),
            S('auyeah', 'x/auye/Auye1.ogg', 'yeah', keep=0.2),
            S('mature', MF + 'noises/anime_wah.wav', 'wah', keep=0.2),
            S('greeting', 'x/GreetingSounds/Greeting05.wav', 'hey', keep=0.15),
            S('bright', BF + '02-hey.wav', 'hey', keep=0.15),
            S('kenneyvo', 'x/Female/go.ogg', 'go', keep=0.15),
            S('cheers', 'cheers_1.ogg', 'yay', 0.0, 0.75, keep=0.2),
            S('greeting', 'x/GreetingSounds/Greeting06.wav', 'hey', keep=0.15),
            S('ohalright', 'oh_alright.ogg', 'oh', 0.0, 0.45, keep=0.2),
            S('bright', BF + '03-hey.wav', 'hey', keep=0.15),
            S('greeting', 'x/GreetingSounds/Greeting07.wav', 'hey', keep=0.15),
        ],
    },
}


# ---------- fetching ----------

def fetch(cache, wanted):
    for sid in wanted:
        url, kind, *_ = SOURCES[sid]
        folder = os.path.join(cache, f'dl-{sid}')
        if os.path.isdir(folder) and os.listdir(folder):
            continue
        os.makedirs(folder, exist_ok=True)
        if kind == 'git':
            repo = os.path.join(folder, 'repo')
            subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', url, repo], check=True)
            subprocess.run(['git', '-C', repo, 'sparse-checkout', 'set', '--no-cone', 'Samples/vowel_short/*', 'LICENSE'], check=True)
            subprocess.run(['git', '-C', repo, 'checkout', '-q', 'HEAD'], check=True)
            continue
        target = os.path.join(folder, os.path.basename(url).replace('%20', '_'))
        subprocess.run(['curl', '-sSL', '-f', '-m', '300', '-o', target, url], check=True)
        if kind == 'zip':
            subprocess.run(['unzip', '-q', '-o', target, '-d', os.path.join(folder, 'x')], check=True)
            os.remove(target)


def sources_of(kits):
    return sorted({s['source'] for k in kits for s in KITS[k]['order']})


# ---------- one chop ----------

def load(path, start=None, end=None):
    args = ['ffmpeg', '-v', 'error']
    if start is not None:
        args += ['-ss', str(start)]
    if end is not None:
        args += ['-t', str(end - (start or 0))]
    args += ['-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f64le', '-']
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float64).copy()


def frames_db(x, hop=441):
    n = max(1, len(x) // hop)
    return 20 * np.log10(np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9)


def trim(x, cap):
    """Trimmed to where the level comes within 40 dB of the peak (a little before), at most `cap` seconds."""
    env = np.abs(x)
    smooth = np.convolve(env, np.ones(220) / 220, mode='same')
    on = np.nonzero(smooth > smooth.max() * 10 ** (-40 / 20))[0]
    a = max(0, on[0] - int(0.005 * SR))
    b = min(len(x), on[-1] + int(0.01 * SR))
    return x[a:min(b, a + int(cap * SR))]


def highpass(x, hz):
    """A 2nd-order high-pass, run forward and back (no phase shift)."""
    from scipy.signal import butter, sosfiltfilt
    return sosfiltfilt(butter(2, hz / (SR / 2), 'highpass', output='sos'), x)


def gate(x):
    """A light spectral gate: bins near the noise floor down by up to 10 dB. Nothing when the recording is clean."""
    n, hop = 1024, 256
    if len(x) < n * 2:
        return x
    win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), x, np.zeros(n)])
    frames = np.array([pad[i:i + n] * win for i in range(0, len(pad) - n, hop)])
    spec = np.fft.rfft(frames, axis=1)
    mag = np.abs(spec)
    energy = mag.sum(axis=1)
    quiet = mag[energy <= np.percentile(energy, 10)]
    noise = np.median(quiet, axis=0) + 1e-12
    if 20 * np.log10(np.sqrt(np.mean(noise ** 2)) / n + 1e-12) < -95:
        return x  # clean already
    over = mag / (noise * 2.0)  # 6 dB over the floor
    g = np.clip(over, 10 ** (-10 / 20), 1.0)
    out = np.fft.irfft(spec * g, n=n, axis=1) * win
    y = np.zeros(len(pad))
    norm = np.zeros(len(pad))
    for k, i in enumerate(range(0, len(pad) - n, hop)):
        y[i:i + n] += out[k]
        norm[i:i + n] += win ** 2
    return (y / np.maximum(norm, 1e-6))[n:n + len(x)]


def analyse(x):
    """WORLD's analysis, and the sung note: the energy-weighted median of the voiced frames (MIDI, fractional), or None."""
    x = np.ascontiguousarray(x, dtype=np.float64)
    f0, t = pw.harvest(x, SR, f0_floor=65, f0_ceil=1000, frame_period=FP)
    sp = pw.cheaptrick(x, f0, t, SR)
    ap = pw.d4c(x, f0, t, SR)
    voiced = f0 > 0
    if voiced.sum() < 8:
        return f0, sp, ap, None
    e = sp[voiced].sum(axis=1)
    m = 69 + 12 * np.log2(f0[voiced] / 440)
    order = np.argsort(m)
    c = np.cumsum(e[order])
    return f0, sp, ap, float(m[order][np.searchsorted(c, c[-1] / 2)])


def warp_envelope(sp, alpha):
    """The spectral envelope stretched up by `alpha` (formants alpha times higher)."""
    if abs(alpha - 1) < 1e-3:
        return sp
    bins = np.arange(sp.shape[1])
    return np.array([np.interp(bins / alpha, bins, row) for row in sp])


def sing(x, analysis, target, keep, lift):
    """The syllable moved onto MIDI note `target`: its wobble around its note scaled by `keep`, formants nudged by `lift` of the move."""
    f0, sp, ap, note = analysis
    m = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1) / 440), 0)
    new = np.where(f0 > 0, 440 * 2 ** ((target + keep * (m - note) - 69) / 12), 0)
    shift = target - note
    alpha = 2 ** (lift * shift / 12)
    y = pw.synthesize(new, warp_envelope(sp, alpha), ap, SR, frame_period=FP)
    return y[:len(x)]


def finish(x):
    """3 ms in, 25 ms out."""
    a, b = int(0.003 * SR), int(0.025 * SR)
    x = x.copy()
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def level(x):
    """The loud part's level (90th percentile of 10 ms frames), dB."""
    return float(np.percentile(frames_db(x), 90))


# ---------- a kit ----------

def build(cache, kit):
    spec = KITS[kit]
    lo, hi = spec['range']
    takes = spec.get('takes', 1)
    syllables = []
    for s in spec['order']:
        x = load(os.path.join(cache, f"dl-{s['source']}", s['path']), s['start'], s['end'])
        x = trim(highpass(x, spec['hp']), spec['cap'])
        x = gate(x)
        a = analyse(x) if s['pitched'] else None
        note = a[3] if a else None
        syllables.append({**s, 'x': x, 'a': a, 'note': note})
        print(f"  {s['label']:8s} {s['path'][-34:]:34s} {len(x) / SR:4.2f}s  " + (f"sung {note:6.2f}" if note is not None else 'unpitched'))
    out = {}
    roots = list(range(lo, hi + 1, 2))
    if kit == 'soul':
        # The recordings' own notes (each take a recording of its own), every other semitone, those
        # above their top moved there with WORLD from the top ones
        by_note = {}
        for s in syllables:
            if s['note'] is not None:
                by_note.setdefault(int(round(s['note'])), []).append(s)
        for r in roots:
            near = min(by_note, key=lambda n: (abs(n - r), -n))
            for t in range(takes):
                s = by_note[near][t % len(by_note[near])]
                out[(r, t)] = finish(sing(s['x'], s['a'], r, 1.0, spec['lift']))
    else:
        uses = [0] * len(syllables)
        last = {}
        for i, r in enumerate(roots):
            # The syllable that fits this key best: least used so far, not one of the last three keys'
            # (nor the same word), near where it was said (a fifth costs nothing, further a little
            # more each semitone), a breath now and then, and the kit's order breaking ties
            def cost(j):
                s = syllables[j]
                c = uses[j] * 10 + j * 0.01
                c += 100 if i - last.get(j, -99) <= 3 else 0
                c += 30 if any(syllables[last_j]['label'] == s['label'] and i - li <= 1 for last_j, li in last.items()) else 0
                c += 25 if s['note'] is None else max(0, abs(s['note'] - r) - 7) * 6
                return c
            pick = min(range(len(syllables)), key=cost)
            uses[pick] += 1
            last[pick] = i
            s = syllables[pick]
            y = s['x'] if s['note'] is None else sing(s['x'], s['a'], r, s['keep'], spec['lift'])
            out[(r, 0)] = finish(y)
            print(f"    {NAMES[r % 12]}{r // 12 - 1:<2d} {s['label']}")
    # Level: each chop to the same loud-part level, then the kit's loudest peak at -1 dBFS
    target = -16.0
    for key in out:
        out[key] = out[key] * 10 ** ((target - level(out[key])) / 20)
    gain = 10 ** (-1 / 20) / max(np.abs(v).max() for v in out.values())
    folder = os.path.join(OUT, f'chops-{kit}')
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        if f.endswith('.mp3'):
            os.remove(os.path.join(folder, f))
    size = 0
    for (r, t), y in sorted(out.items()):
        path = os.path.join(folder, f'{NAMES[r % 12]}{r // 12 - 1}_0_{t}.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-q:a', '4', path],
                       input=(y * gain).astype(np.float64).tobytes(), check=True)
        size += os.path.getsize(path)
    print(f"chops-{kit}: {len(roots)} notes x {takes} takes, gain {20 * np.log10(gain):+.1f} dB, {size / 1e3:.0f} kB")
    return {'notes': roots, 'layers': 1, 'takes': takes, 'loops': {}}


def main(args):
    cache, kits = args[0], (args[1:] or list(KITS))
    fetch(cache, sources_of(kits))
    done = {f'chops-{k}': build(cache, k) for k in kits}
    sys.path.insert(0, os.path.join(ROOT, 'scripts', 'real-samples'))
    from convert import write_index
    write_index(ROOT, done)
    json.dump({sid: {'url': v[0], 'by': v[2], 'page': v[3], 'licence': v[4]} for sid, v in SOURCES.items() if sid in sources_of(kits)},
              sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main(sys.argv[1:])
