# Re-render retro General MIDI instruments from their SoundFont with FluidSynth, as hosted sets
# (public/fledgetone-samples/<set>/), in place of the midi-js-soundfonts MP3s they played: those
# are 35 to 65 kbps, every note cut at 3.16 s, rendered at one loudness. Here each note is played
# at velocity 127 (where the SoundFont's default velocity-to-filter modulator takes nothing off),
# with FluidSynth's reverb and chorus off, held long enough to ring out by itself (a plucked or
# struck note) or long enough to loop a stretch of several seconds (a held one), every 3 semitones,
# tuned (pitch bend, so FluidSynth's own interpolation does it), and written as MP3 V0 with a
# 20 kHz lowpass. Then src/audio/hostedSets.ts is updated through convert.py's write_index.
#
#   python3 render.py /path/to/bos-beat-box /path/to/Musyng_Kite.sf2 retro-shakuhachi ...
#   python3 render.py /path/to/bos-beat-box /path/to/FluidR3_GM.sf2 retro-taiko
#   python3 render.py /path/to/bos-beat-box --index      (hostedSets.ts from renders.json alone)
#
# Each set's font is checked against its file's name (Musyng Kite or FluidR3), so a set can't be
# rendered from the wrong one. Needs fluidsynth, ffmpeg with libmp3lame, Python 3 with numpy.
# What each set came out as (notes, loops) is kept in renders.json next to this script, so the
# index can be rebuilt without the SoundFonts (after a merge of hostedSets.ts, say).
import os, sys, json, struct, subprocess, tempfile
# (one thread for numpy's sums: many threads fighting over a few short dot products made it 100x slower)
for _v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_v, '1')
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'real-samples'))
import convert  # noqa: E402  (write_index, held_span)
import measure  # noqa: E402  (pitch, sieve, cents)

SR = 44100
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
#: Seconds between one note and the next in a render (each rings out alone)
SLOT = 14.0
#: How long a plucked or struck note's key is held (it rings out by itself well before)
STRUCK_HOLD = 11.0
#: How long a held note is rendered: its loop is the longest steady stretch up to LOOP_MOST
HELD_HOLD = 6.6
LOOP_MOST = 4.5
LOOP_FADE = 0.3
#: A plucked or struck note ends where it has fallen this far under its peak
FLOOR_DB = -60
#: Longest a plucked or struck note is kept (it fades out over TAIL_FADE there if still sounding)
STRUCK_MOST = 10.0
TAIL_FADE = 1.5

# folder: (font, GM program (0-based), lowest note, highest, 'held' or 'struck', tune it?)
SETS = {
    'retro-fiddle': ('musyng', 110, 55, 93, 'held', True),
    'retro-shakuhachi': ('musyng', 77, 55, 88, 'held', True),
    'retro-bagpipe': ('musyng', 109, 58, 84, 'held', True),
    'retro-accordion': ('musyng', 21, 48, 89, 'held', True),
    'retro-rain': ('musyng', 96, 36, 96, 'held', True),
    'retro-dulcimer': ('musyng', 15, 48, 88, 'struck', True),
    'retro-shamisen': ('musyng', 106, 50, 84, 'struck', True),
    'retro-agogo': ('musyng', 113, 48, 84, 'struck', False),
    # (the crystal's shimmer goes on for as long as its key is held, as a pad's does)
    'retro-crystal': ('musyng', 98, 48, 96, 'held', False),
    'retro-taiko': ('fluid', 116, 36, 72, 'struck', False),
}
STEP = 3

RENDERS = os.path.join(HERE, 'renders.json')


def notes_of(lo, hi):
    """Every STEP semitones from `lo`, and `hi` (as the app's soundfont sets were sampled)."""
    ns = list(range(lo, hi + 1, STEP))
    return ns if ns[-1] == hi else ns + [hi]


def vlq(n):
    out = [n & 0x7f]
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7f))
        n >>= 7
    return bytes(out)


def midi_file(program, notes, hold, bends):
    """A one-track MIDI file: each note on its own SLOT, at velocity 127, bent by bends[i] cents."""
    tpq = 480  # ticks a quarter; 120 BPM, so a second is 960 ticks
    ev = []  # (tick, bytes)
    ev.append((0, bytes([0xC0, program])))
    # Pitch bend range: 2 semitones (the default, set anyway)
    ev += [(0, bytes([0xB0, 101, 0])), (0, bytes([0xB0, 100, 0])), (0, bytes([0xB0, 6, 2])), (0, bytes([0xB0, 38, 0]))]
    for i, (m, c) in enumerate(zip(notes, bends)):
        t = int(round(i * SLOT * 960))
        v = int(round(8192 + c / 200 * 8192))
        v = max(0, min(16383, v))
        # (the bend a little before the note, so it's in place when it starts)
        ev.append((max(0, t - 96), bytes([0xE0, v & 0x7f, v >> 7])))
        ev.append((t, bytes([0x90, m, 127])))
        ev.append((t + int(round(hold * 960)), bytes([0x80, m, 0])))
    ev.sort(key=lambda e: e[0])
    body, last = b'', 0
    body += vlq(0) + bytes([0xFF, 0x51, 3]) + (500000).to_bytes(3, 'big')
    for t, data in ev:
        body += vlq(t - last) + data
        last = t
    body += vlq(int(4 * 960)) + bytes([0xFF, 0x2F, 0])
    return b'MThd' + struct.pack('>IHHH', 6, 0, 1, tpq) + b'MTrk' + struct.pack('>I', len(body)) + body


def fluid(font, mid):
    """The MIDI file rendered by FluidSynth (reverb and chorus off), as (2, samples) floats."""
    with tempfile.TemporaryDirectory() as d:
        mp, out = os.path.join(d, 'n.mid'), os.path.join(d, 'out.raw')
        open(mp, 'wb').write(mid)
        subprocess.run(['fluidsynth', '-n', '-i', '-q', '-R', '0', '-C', '0', '-r', str(SR), '-g', '0.5', '-O', 'float', '-T', 'raw',
                        '-o', 'synth.dynamic-sample-loading=1', '-o', 'synth.polyphony=256', '-F', out, font, mp], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        x = np.fromfile(out, '<f4').astype(np.float64)
    return x.reshape(-1, 2).T.copy()


def slots(x, n):
    """Each note's slot of the render."""
    k = int(SLOT * SR)
    return [x[:, i * k: (i + 1) * k] for i in range(n)]


def cents_off(note, midi):
    """How many cents `note` plays off `midi` (+ sharp), by its harmonics, YIN choosing nothing."""
    m = note.mean(axis=0)
    score = measure.sieve(m, (0.3, 1.2))
    c, _ = measure.cents(score, midi)
    return c


def mono_if_same(x):
    """One channel when the two are the same sound."""
    l, r = x
    d = np.sum((l - r) ** 2)
    s = np.sum((l + r) ** 2) + 1e-20
    return x[:1] if d < s * 1e-4 else x


def struck(x):
    """A plucked or struck note up to where it has died away (FLOOR_DB under its peak, at most STRUCK_MOST)."""
    m = np.abs(x).max(axis=0)
    h = int(0.01 * SR)
    n = len(m) // h
    env = 20 * np.log10(m[: n * h].reshape(n, h).max(axis=1) + 1e-12)
    top = env.max()
    above = np.nonzero(env > top + FLOOR_DB)[0]
    end = min((int(above[-1]) + 2) * h, int(STRUCK_MOST * SR))
    y = x[:, :end].copy()
    if end >= int(STRUCK_MOST * SR):
        # Still sounding at the cap: it fades away over the last TAIL_FADE seconds
        f = int(TAIL_FADE * SR)
        y[:, -f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    else:
        f = int(0.02 * SR)
        y[:, -f:] *= np.linspace(1, 0, f)
    return y, None


def held(x, midi):
    """
    A held note with a seamless loop inside its steady part: the longest stretch of it (from after
    the attack to before the key was let go) up to LOOP_MOST seconds, its start moved by up to two
    periods of the note to where it best matches the sound before the loop's end, its last
    LOOP_FADE seconds crossfaded into what comes before its start (keeping its level however
    alike the two are). The file runs on 0.3 s past the
    loop with what follows its start, as a looping note does. Returns the note and (start, end) s.
    """
    m = x.mean(axis=0)
    span = convert.held_span(m[: int(HELD_HOLD * SR)])
    if not span:
        raise ValueError('no steady part')
    b = min(span[1], int((HELD_HOLD - 0.15) * SR))
    f = int(LOOP_FADE * SR)
    # (from 0.6 s at the earliest: past any attack, with room for the crossfade before it)
    a = max(span[0], int(0.6 * SR), b - int(LOOP_MOST * SR))
    f = min(f, (b - a) // 3)
    period = SR / (440 * 2 ** ((midi - 69) / 12))
    ref = m[b - f: b]
    best, best_a = -2.0, a
    for d in range(-int(2 * period), int(2 * period) + 1):
        s = m[a + d - f: a + d]
        if a + d - f < 0 or len(s) != f:
            continue
        r = float(np.dot(s, ref) / (np.linalg.norm(s) * np.linalg.norm(ref) + 1e-12))
        if r > best:
            best, best_a = r, a + d
    a = best_a
    # (a crossfade that keeps the level as much as the two sides are alike: a breathy note's
    # noise doesn't line up, and a plain crossfade of it would dip)
    w = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
    r = min(1.0, max(0.0, best))
    norm = 1 / np.sqrt((1 - w) ** 2 + w ** 2 + 2 * r * (1 - w) * w)
    tail = int(0.3 * SR)
    ys = []
    for ch in x:
        y = ch[:b].copy()
        y[b - f: b] = (ch[b - f: b] * (1 - w) + ch[a - f: a] * w) * norm
        ys.append(np.concatenate([y, ch[a: a + tail]]))
    return np.stack(ys), (round(a / SR, 5), round(b / SR, 5)), best


def encode(y, path):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', str(y.shape[0]), '-i', '-',
                    '-codec:a', 'libmp3lame', '-q:a', '0', '-cutoff', '20000', path], input=y.T.astype('<f8').tobytes(), check=True)


def render(root, font, folder):
    kind_font, program, lo, hi, kind, tune = SETS[folder]
    name = os.path.basename(font).lower().replace(' ', '')
    if ('musyng' in name) != (kind_font == 'musyng') or ('fluid' in name) != (kind_font == 'fluid'):
        raise SystemExit(f'{folder} is rendered from the {kind_font} SoundFont, not {font}')
    notes = notes_of(lo, hi)
    hold = HELD_HOLD if kind == 'held' else STRUCK_HOLD
    bends = [0.0] * len(notes)
    raw = slots(fluid(font, midi_file(program, notes, hold, bends)), len(notes))
    if tune:
        offs = [cents_off(s, m) for s, m in zip(raw, notes)]
        bends = [-c if abs(c) >= 3 else 0.0 for c in offs]
        if any(bends):
            raw = slots(fluid(font, midi_file(program, notes, hold, bends)), len(notes))
        after = [cents_off(s, m) for s, m in zip(raw, notes)]
        print(f'   tuning: {" ".join(f"{c:+.0f}" for c in offs)} -> {" ".join(f"{c:+.0f}" for c in after)}')
    out, loops, matches = {}, {}, []
    for m, x in zip(notes, raw):
        x = mono_if_same(x)
        if kind == 'held':
            y, loop, r = held(x, m)
            loops[f'{m}_0_0'] = list(loop)
            matches.append(r)
        else:
            y, _ = struck(x)
        out[m] = y
    gain = 0.89 / max(np.abs(y).max() for y in out.values())
    dest = os.path.join(root, 'public', 'fledgetone-samples', folder)
    os.makedirs(dest, exist_ok=True)
    for old in os.listdir(dest):
        if old.endswith('.mp3'):
            os.remove(os.path.join(dest, old))
    for m, y in out.items():
        y = y * gain
        y[:, : int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        encode(y, os.path.join(dest, f'{NAMES[m % 12]}{m // 12 - 1}_0_0.mp3'))
    size = sum(os.path.getsize(os.path.join(dest, n)) for n in os.listdir(dest))
    chans = sorted({y.shape[0] for y in out.values()})
    lens = [y.shape[1] / SR for y in out.values()]
    print(f'{folder:18s} {len(notes)} notes, {"/".join(map(str, chans))} ch, {min(lens):.1f}-{max(lens):.1f} s, gain {20 * np.log10(gain):+.1f} dB, '
          f'{size / 1e6:.2f} MB' + (f', loops match {min(matches):.3f} at worst' if matches else ''))
    return {'notes': notes, 'layers': 1, 'takes': 1, **({'loops': loops} if loops else {})}


def main(args):
    root = args[0]
    renders = json.load(open(RENDERS)) if os.path.exists(RENDERS) else {}
    if args[1:] != ['--index']:
        font, folders = args[1], args[2:] or list(SETS)
        for folder in folders:
            renders[folder] = render(root, font, folder)
        json.dump(renders, open(RENDERS, 'w'), indent=1, sort_keys=True)
    convert.write_index(root, {k: v for k, v in renders.items() if os.path.isdir(os.path.join(root, 'public', 'fledgetone-samples', k))})


if __name__ == '__main__':
    main(sys.argv[1:])
