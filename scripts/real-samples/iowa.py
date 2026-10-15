# Fetch a set recorded by the University of Iowa Electronic Music Studios (Musical Instrument
# Samples, sets.py IOWA) into dl/<set>/, as fetch.py does for the other libraries:
#   python3 iowa.py violin nylon-guitar ...
# Each set is one zip of the studios' recordings (16-bit 44.1 kHz mono: the strings' 2012 centre
# microphone, the guitar's 2011 recordings), whose files are chromatic scales played note by note
# on one string at one loudness ("Violin.arco.mf.sulA.C5B5.mono.aif": C5 to B5 on the A string).
# Each scale is split at the silences between its notes (a plucked one at its plucks: see
# plucks), each note's pitch is checked against the scale's (a note that isn't
# where the scale says is left out), and one string is chosen for each note and loudness: the one
# where it lies in the lowest positions, a semitone to a fifth over the open string (a note a
# string's open pitch plays stopped on the string below, as players usually do), so neighbouring
# notes keep one tone (a held note that is too short, or an accent that dies away, is left out
# for the note's other loudnesses to stand in). Writes the notes as WAVs and dl/<set>/plan.json, then deletes the zip
# (KEEP_ZIP=1 keeps it, to split it again).
import os, re, sys, json, subprocess, zipfile, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, note_midi

SR = 44100
BASE = 'https://theremin.music.uiowa.edu/sound%20files/MIS/'
#: Each string's open note (MIDI) by instrument
OPEN = {
    'Violin': {'G': 55, 'D': 62, 'A': 69, 'E': 76},
    'Viola': {'C': 48, 'G': 55, 'D': 62, 'A': 69},
    'Cello': {'C': 36, 'G': 43, 'D': 50, 'A': 57},
    # (the bass's low C extension, recorded for a few notes, is below its E string)
    'Bass': {'C': 24, 'E': 28, 'A': 33, 'D': 38, 'G': 43},
    # (the guitar's files name the high E string "sul_E", its low one "sulE")
    'Guitar': {'E': 40, 'A': 45, 'D': 50, 'G': 55, 'B': 59, '_E': 64},
}


#: Zips whose files are marked 44.1 kHz but hold sound recorded at another rate (they play 13.4
#: semitones low and 2.18 times as long as they should): the rate they really are
TRUE_RATE = {'Strings/viola2012/Viola.arco.mono.1644.1.zip': 96000, 'Strings/viola2012/Viola.pizz.mono.1644.1.zip': 96000}


def load(p, rate=None):
    """A file as mono at SR; `rate`: the rate its samples really are, whatever its header says."""
    if rate is None:
        raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    else:
        samples = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ac', '1', '-f', 'f32le', '-'], capture_output=True).stdout
        raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', '-', '-ar', str(SR), '-f', 'f32le', '-'], input=samples, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def scale_of(name):
    """(instrument, loudness, string, [MIDI notes]) a scale file's name says, or None."""
    toks = name.split('.')
    inst = toks[0]
    loud = next((t for t in toks if t in ('pp', 'mf', 'ff')), None)
    string = next((t[3:] for t in toks if t.startswith('sul')), None)
    rng = next((t.strip() for t in toks[1:] if re.fullmatch(r'\s*([A-G]b?\d)([A-G]b?\d)?\s*', t)), None)
    if not (loud and string and rng):
        return None
    a, b = re.fullmatch(r'([A-G]b?\d)([A-G]b?\d)?', rng).groups()
    lo, hi = note_midi(a), note_midi(b or a)
    return inst, loud, string, list(range(lo, hi + 1))


def stretches(env, thr, shortest):
    """(start, end) frames where `env` is over `thr`, gaps under 0.2 s closed, at least `shortest` frames."""
    on = env > thr
    out, i, n = [], 0, len(env)
    while i < n:
        if not on[i]:
            i += 1
            continue
        j, gap = i, 0
        while j < n and gap < 20:
            gap = 0 if on[j] else gap + 1
            j += 1
        end = j - gap
        if end - i >= shortest:
            out.append((i, end))
        i = j
    return out


def regions(x, shortest, count):
    """
    The notes of a scale: (start, end) in samples of each. Some scales were cut with silence
    between their notes, others keep the room's noise and the odd sound between them, and a soft
    note's level wavers, so no one threshold finds them all: the level (in 10 ms steps, smoothed
    over 50 ms) is cut 10 dB over its noise, and when that doesn't find `count` stretches of sound
    (the scale's notes), at every threshold from 6 dB under its loudest down to 6 dB over its
    noise: the lowest that finds them all wins, or failing that the one that comes closest. Each stretch then reaches out to where it falls into the
    noise, short of its neighbours.
    """
    h = int(0.01 * SR)
    n = len(x) // h
    env = 10 * np.log10(np.mean(x[: n * h].reshape(n, h) ** 2, axis=1) + 1e-20)
    env = 10 * np.log10(np.convolve(10 ** (env / 10), np.ones(5) / 5, mode='same') + 1e-20)
    floor = max(np.percentile(env, 5), env.max() - 90)
    # First 10 dB over the noise; if that doesn't find the scale's notes, every threshold
    best = stretches(env, floor + 10, shortest / 0.01)
    best_err = abs(len(best) - count) or None
    for thr in np.arange(env.max() - 6, floor + 6, -1.0) if best_err else []:
        found = stretches(env, thr, shortest / 0.01)
        err = abs(len(found) - count)
        if best_err is None or err <= best_err:
            best, best_err = found, err
    # out to where each falls into the noise
    edge = floor + 6
    out = []
    for k, (i, j) in enumerate(best):
        lo = out[-1][1] // h if out else 0
        hi = best[k + 1][0] if k + 1 < len(best) else n
        while i > lo and env[i - 1] > edge:
            i -= 1
        while j < hi and env[j] > edge:
            j += 1
        out.append((i * h, j * h))
    return out


def bowed_bounds(x, a, b):
    """
    Where a bowed note found between `a` and `b` really starts and ends. It starts 20 ms before it
    first comes within 20 dB of its middle's level (not with the breath or the bow's touch before
    it). It ends, once at full level, where it first stays 20 dB under that level for 50 ms (0.1 s
    on, for its release) or 10 dB over it (another, louder sound with too little silence between
    them: a soft note's stretch can hold the next one's start).
    """
    h = int(0.01 * SR)
    seg = x[a:b]
    n = len(seg) // h
    env = 10 * np.log10(np.mean(seg[: n * h].reshape(n, h) ** 2, axis=1) + 1e-20)
    mid = np.median(env[n // 5: max(n // 5 + 1, n // 2)])
    start = max(0, int(np.argmax(env > mid - 20)) - 2)
    first = int(np.argmax(env > mid - 6))
    low, high = env < mid - 20, env > mid + 10
    end = b
    for k in range(first, n - 5):
        if low[k: k + 5].all():
            end = min(b, a + (k + 10) * h)
            break
        if high[k: k + 5].all():
            end = a + max(first + 1, k - 5) * h
            break
    return a + start * h, end


#: A held note shorter than this (seconds) is too short to loop
SHORTEST_HELD = 1.6
#: The most a held note's first half second may stand over the next second (dB): more is an
#: accent that dies away (some notes were played so), not a held note
MOST_ACCENT = 6


def held_flaw(x):
    """Why a bowed recording isn't a usable held note, or None."""
    length = len(x) / SR
    if length < SHORTEST_HELD:
        return f'{length:.1f} s long'
    lv = lambda a, b: 10 * np.log10(np.mean(x[int(a * SR): int(b * SR)] ** 2) + 1e-20)
    accent = lv(0.1, 0.6) - lv(1.0, min(2.0, length - 0.3))
    return f'an accent {accent:.0f} dB over the rest' if accent > MOST_ACCENT else None


def highpass(x, hz):
    """`x` with what's under `hz` taken out (one FFT, padded so the end doesn't wrap onto the start; a smooth half-octave edge up to `hz`)."""
    n = len(x)
    m = 1 << int(np.ceil(np.log2(n + SR)))
    f = np.fft.rfftfreq(m, 1 / SR)
    edge = np.clip(np.log2(f / hz + 1e-12) / 0.5 + 1, 0, 1)
    return np.fft.irfft(np.fft.rfft(x, m) * np.sin(edge * np.pi / 2) ** 2, m)[:n]


def plucks(x, notes):
    """
    The notes of a plucked scale (the guitar): [(MIDI, (start, end) in samples)]. A plucked string
    rings on until the next is played, often with no silence between them, a soft pluck rises only
    a few dB over the string before it, and a player sometimes plucks a note twice, so the notes are
    found by their onsets and named by their pitch, not counted off in order: an onset is a frame
    (10 ms) at least 6 dB over the lowest of the 60 ms before it, within 35 dB of the scale's
    loudest, at least 0.3 s after the last, moved on to the pluck itself where the finger's touch
    came first; each runs to 50 ms before the next. Each of the scale's
    notes takes the loudest onset that sounds as it and rings for at least 0.8 s (else its longest).
    The onsets are read over 300 Hz (a pluck's snap; the room's rumble, which swells and fades
    under 100 Hz, set off false ones) and the pitch over 0.7 of the scale's lowest note.
    """
    h = int(0.01 * SR)
    n = len(x) // h
    snap = highpass(x, 300)
    env = 10 * np.log10(np.mean(snap[: n * h].reshape(n, h) ** 2, axis=1) + 1e-20)
    x = highpass(x, 0.7 * 440 * 2 ** ((notes[0] - 69) / 12))
    found = []
    for i in range(1, n):
        if env[i] - env[max(0, i - 6): i].min() < 6:
            continue
        peak = float(env[i: i + 5].max())
        if found and i - found[-1][0] < 30:
            continue
        found.append((i, peak))
    if not found:
        return []
    top = max(p for _, p in found)
    found = [(i, p) for i, p in found if p > top - 35]
    # A soft pluck can follow the finger's touch on the string by 50 ms (a click 10 to 15 dB
    # under it): each onset starts at the pluck, the first frame within 6 dB of the loudest of the
    # next 150 ms
    found = [(i + int(np.argmax(env[i: i + 15] > env[i: i + 15].max() - 6)), p) for i, p in found]
    # (10 ms before it: the touch is 50 ms before)
    starts = [max(0, (i - 1) * h) for i, _ in found]
    spans = [(a, (starts[k + 1] - int(0.05 * SR)) if k + 1 < len(starts) else len(x)) for k, a in enumerate(starts)]
    near = range(notes[0] - 2, notes[-1] + 3)
    pitch = [note_of(x[a:b], near, True) if b - a > int(0.3 * SR) else None for a, b in spans]
    out = []
    for m in notes:
        mine = [k for k, p in enumerate(pitch) if p == m]
        if not mine:
            continue
        long = [k for k in mine if spans[k][1] - spans[k][0] >= int(0.8 * SR)]
        k = max(long, key=lambda k: found[k][1]) if long else max(mine, key=lambda k: spans[k][1] - spans[k][0])
        out.append((m, spans[k]))
    return out


def note_of(x, candidates, plucked=False):
    """
    Which of `candidates` (MIDI) the note is, from a second of its middle (a plucked note: from just
    after its attack to 0.8 s, before its harmonics have died away): the one whose harmonics
    (the first six, in dB over the spectrum's floor) stand highest over the points halfway between
    them. Halfway points are where a pitch an octave under the note would have harmonics the note
    hasn't, and an octave over it has the note's odd harmonics, so octaves don't fool it.
    """
    a = int(0.06 * SR) if plucked else int(len(x) * 0.25)
    seg = x[a: a + int((0.74 if plucked else 1.0) * SR)] if len(x) - a > int(0.3 * SR) else x
    n = 1 << 17
    mag = 20 * np.log10(np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)) + 1e-12)
    mag = np.maximum(mag - (mag.max() - 70), 0)
    hz_per_bin = SR / n

    def at(f):
        k = f / hz_per_bin
        lo, hi = int(k * 0.985), int(k * 1.015) + 1  # within a quarter tone
        return float(mag[lo:hi].max()) if hi < len(mag) else 0.0

    def score(m):
        f0 = 440 * 2 ** ((m - 69) / 12)
        return sum(at(k * f0) - at((k - 0.5) * f0) for k in range(1, 7) if k * f0 < SR / 2)
    return max(candidates, key=score)


def fetch(st):
    d = os.path.join('dl', st['folder'])
    os.makedirs(d, exist_ok=True)
    if os.path.exists(os.path.join(d, 'plan.json')):
        print(f"{st['folder']:20s} already split")
        return
    zp = os.path.join(d, 'source.zip')
    if not os.path.exists(zp):
        urllib.request.urlretrieve(BASE + st['iowa'], zp)
    found = {}  # (midi, layer) -> [(string, file)]
    levels = {}  # (midi, layer, string) -> a plucked note's level over its first half second (dB)
    plucked = st['kind'] in ('plucked', 'short')
    with zipfile.ZipFile(zp) as z:
        for info in z.infolist():
            name = os.path.basename(info.filename)
            if info.filename.startswith('__MACOSX') or not name.lower().endswith(('.aif', '.aiff')):
                continue
            sc = scale_of(name)
            if not sc or sc[1] not in st['layers']:
                continue
            inst, loud, string, notes = sc
            tmp = os.path.join(d, 'scale.aif')
            with open(tmp, 'wb') as f:
                f.write(z.read(info))
            x = load(tmp, TRUE_RATE.get(st['iowa']))
            os.remove(tmp)
            # (a plucked scale's notes are found by their onsets and named by their pitch)
            pairs = plucks(x, notes) if plucked else []
            regs = [r for _, r in pairs] if plucked else regions(x, 0.3, len(notes))
            # The scale's notes in order; a scale with more or fewer stretches than notes is
            # matched by pitch instead
            if plucked and len(pairs) < len(notes):
                print(f'   {name}: no pluck sounds as {sorted(set(notes) - {m for m, _ in pairs})}')
            if not plucked:
                pairs = list(zip(notes, regs)) if len(regs) == len(notes) else []
            if not pairs and not plucked:
                near = list(range(notes[0] - 2, notes[-1] + 3))
                ps = [note_of(x[a:b], near, plucked) for a, b in regs]
                for m in notes:
                    k = [i for i, p in enumerate(ps) if p == m]
                    if k:  # (played twice: the longer)
                        pairs.append((m, max((regs[i] for i in k), key=lambda r: r[1] - r[0])))
                print(f'   {name}: {len(regs)} stretches for {len(notes)} notes, {len(pairs)} placed by pitch')
            for m, (a, b) in pairs:
                # the note with what rings on after it (up to 0.4 s of the silence); a bowed note
                # up to its own end
                after = min([r[0] for r in regs if r[0] > a] + [len(x)])
                if not plucked:
                    a, b = bowed_bounds(x, a, b)
                    after = min(after, b + int(0.1 * SR))
                # (a plucked note ends where the next starts)
                seg = x[a if plucked else max(0, a - int(0.01 * SR)): b if plucked else min(after, b + int(0.4 * SR))]
                if plucked:
                    # (without the room's rumble under the note: it swells and fades under 100 Hz)
                    seg = highpass(seg, 0.7 * 440 * 2 ** ((m - 69) / 12))
                p = note_of(seg, range(m - 2, m + 3), plucked)
                if p != m:
                    print(f'   {name}: the note for {m} sounds as {p}, left out')
                    continue
                out = f'{inst}_{loud}_sul{string}_{m}.wav'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', os.path.join(d, out)],
                               input=seg.astype('<f8').tobytes(), check=True)
                found.setdefault((m, st['layers'].index(loud)), []).append((string, out, inst, held_flaw(seg) if not plucked else None))
                if plucked:
                    on = int(np.argmax(np.abs(seg) > 0.1 * np.abs(seg).max()))
                    levels[(m, st['layers'].index(loud), string)] = 10 * np.log10(np.mean(seg[on: on + int(0.5 * SR)] ** 2) + 1e-20)
    files = []
    for (m, layer), options in sorted(found.items()):
        if st['lo'] is not None and m < st['lo'] or st['hi'] is not None and m > st['hi']:
            continue

        def rises(string):
            """A plucked note's loudnesses on `string` each at least 1 dB over the softer one (some
            scales were played unevenly: the guitar's C3 on the A string is quieter ff than pp)."""
            lv = [levels[(m, k, string)] for k in range(len(st['layers'])) if (m, k, string) in levels]
            return all(b > a + 1 for a, b in zip(lv, lv[1:]))

        def rank(o):
            # Lowest positions: a semitone to a fifth over the open string; then the nearest above
            # (a plucked note: first a string it was played on evenly, soft to loud)
            above = m - OPEN[o[2]][o[0]]
            return (0 if not plucked or rises(o[0]) else 1, 0 if 1 <= above <= 7 else 1 if above == 0 else 2, abs(above))
        # A bowed note too short to hold, or that dies away after an accent, isn't used: the
        # note's nearest other loudness stands in for it (convert.py)
        usable = [o for o in options if not o[3]]
        if not usable:
            print(f'   {m} {st["layers"][layer]}: left out ({options[0][3]})')
            continue
        best = min(usable, key=rank)
        files.append({'path': best[1], 'file': best[1], 'nominal': m, 'layer': layer, 'take': '', 'src': 0})
    for name in os.listdir(d):
        if name.endswith('.wav') and name not in {f['file'] for f in files}:
            os.remove(os.path.join(d, name))
    json.dump({'source': BASE + st['iowa'], 'files': files}, open(os.path.join(d, 'plan.json'), 'w'), indent=1)
    if not os.environ.get('KEEP_ZIP'):
        os.remove(zp)
    print(f"{st['folder']:20s} {len(files)} recordings, {len({f['nominal'] for f in files})} notes")


if __name__ == '__main__':
    for st in SETS:
        if st.get('iowa') and (not sys.argv[1:] or st['folder'] in sys.argv[1:]):
            fetch(st)
