# Turn the downloaded recordings (fetch.py) into the app's files, using their measured notes and
# tuning (measure.py):
#   python3 convert.py /path/to/bos-beat-box              every set
#   python3 convert.py /path/to/bos-beat-box harp flute   just these
# Writes public/bos-beat-box-samples/<set>/<note>_<layer>_<take>.mp3 and the list of what each set
# has, src/audio/hostedSets.ts (`convert.py <root> --index` rewrites just that).
#
# Each recording is folded to mono, tuned (unless the set keeps its tuning), started at the note,
# and, for held instruments, looped where it's steady so a note can be held up to the set's `cap`.
# A note far louder or quieter than its neighbours is brought in line with them, and a note's
# softer recordings are set a fixed step under its loudest (velocity sets the level, the recording
# the tone, so moving between them is smooth). Missing recordings are filled from the same note's
# nearest loudness or other take, so every note has every layer and take. One gain per set
# leaves its loudest peak just under full scale.
import os, sys, json, struct, subprocess, re
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, KINDS

SR = 44100
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
XFADE = 0.12  # seconds of crossfade at each loop seam


def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def wav_loop(p):
    """The loop (start, end) a WAV file's smpl chunk marks, in seconds, or None."""
    if not p.endswith('.wav'):
        return None
    b = open(p, 'rb').read()
    i, rate, loop = 12, None, None
    while i < len(b) - 8:
        cid, n = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
        if cid == b'fmt ':
            rate = struct.unpack('<I', b[i + 12:i + 16])[0]
        if cid == b'smpl' and struct.unpack('<I', b[i + 36:i + 40])[0] > 0:
            loop = struct.unpack('<II', b[i + 8 + 44:i + 8 + 52])
        i += 8 + n + (n & 1)
    return (loop[0] / rate, loop[1] / rate) if loop and rate else None


def retune(x, c):
    """Play `x` c cents lower (c > 0 means it was sharp)."""
    r = 2 ** (-c / 1200)
    n = int((len(x) - 2) / r)
    t = np.arange(n) * r
    k = t.astype(int)
    f = t - k
    return x[k] * (1 - f) + x[k + 1] * f


def pitch_track(x, midi, until=1.2, hop=0.025, win=0.1):
    """Cents off `midi` every `hop` seconds over the first `until` seconds (a harmonic sieve per frame)."""
    hz = 440 * 2 ** ((midi - 69) / 12)
    grid = np.arange(-200, 201, 5)
    n = 1 << 15
    f = np.fft.rfftfreq(n, 1 / SR)
    ks = np.arange(1, 6)
    out = []
    for i in range(int(until / hop)):
        a = int(i * hop * SR)
        seg = x[a: a + int(win * SR)]
        if len(seg) < int(win * SR):
            break
        mag = np.log1p(np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)) / (np.abs(seg).max() + 1e-12))
        cand = hz * 2 ** (grid / 1200)
        score = (np.interp(np.outer(cand, ks), f, mag) / np.sqrt(ks)).sum(axis=1)
        out.append(float(grid[int(np.argmax(score))]))
    return np.array(out)


def flatten_scoop(x, midi, hop=0.025):
    """
    Bend a note that starts off pitch (a horn scooping up into a low note, a bow settling) onto its
    note over its first second. The track is smoothed over a quarter second first, so vibrato is
    left as it is, and only the note's loud frames count; nothing changes unless the start is more
    than 20 cents off, the correction fades out by 1.2 s, and it's kept only if it clearly brings
    the start closer to the note (a misread track is left alone).
    """
    c = pitch_track(x, midi, hop=hop)
    if len(c) < 8:
        return x, 0.0
    env, h = envelope(x[: int((len(c) * hop + 0.1) * SR)], hop)
    loud = np.zeros(len(c), bool)
    loud[: min(len(c), len(env))] = env[: len(c)] > np.max(env) - 25
    k = int(0.25 / hop)
    smooth = np.convolve(np.pad(np.where(loud, c, 0.0), (k // 2, k - k // 2 - 1), mode='edge'), np.ones(k) / k, mode='valid')
    smooth = np.where(loud, smooth, 0.0)
    head = slice(0, int(0.8 / hop))
    if np.max(np.abs(smooth[head])) <= 20:
        return x, 0.0
    t = (np.arange(len(smooth)) * hop) + 0.05  # each frame's centre
    fade = np.clip((1.2 - t) / 0.6, 0, 1)
    fix = np.where(np.abs(smooth) > 10, smooth, 0) * fade
    # Read faster where it's flat, slower where it's sharp
    n = len(x)
    ts = np.arange(n) / SR
    rate = 2 ** (-np.interp(ts, t, fix, left=fix[0], right=0) / 1200)
    pos = np.concatenate([[0], np.cumsum(rate[:-1])])
    pos = pos[pos < n - 2]
    k0 = pos.astype(int)
    fr = pos - k0
    y = x[k0] * (1 - fr) + x[k0 + 1] * fr
    after = pitch_track(y, midi, until=0.8, hop=hop)
    m = min(len(after), int(0.8 / hop))
    before_err = np.mean(np.abs(c[:m][loud[:m]])) if loud[:m].any() else 0
    after_err = np.mean(np.abs(after[:m][loud[:m]])) if loud[:m].any() else 0
    if after_err > 0.7 * before_err:
        return x, 0.0
    return y, float(np.max(np.abs(smooth[head])))


def start_of(x):
    """Where the note starts: 4 ms before it first comes within 40 dB of its peak."""
    a = np.abs(x)
    return max(0, int(np.argmax(a > a.max() * 10 ** (-40 / 20))) - int(0.004 * SR))


def envelope(x, hop=0.02):
    h = int(hop * SR)
    n = len(x) // h
    return 10 * np.log10(np.mean(x[: n * h].reshape(n, h) ** 2, axis=1) + 1e-20), h


def steady(x):
    """(start, end) in samples of the note's steady part: after the attack, before it fades."""
    env, h = envelope(x)
    if len(env) < 10:
        return None
    top = np.max(env)
    first = int(np.argmax(env > top - 6))
    body = env[first:]
    ref = np.median(body[: max(1, int(len(body) * 0.6))])
    loud = np.where(body > ref - 4)[0]
    last = first + (loud[-1] if len(loud) else 0)
    a, b = (first + int(0.35 / 0.02)) * h, last * h - int(0.1 * SR)
    return (a, b) if b - a > int(0.6 * SR) else None


def extend(x, loop, period, length):
    """`x` held to `length` samples by repeating x[a:b], crossfaded, b - a a whole number of periods."""
    a, b = loop
    if period:
        k = max(1, round((b - a) / period))
        a = int(round(b - k * period))
    f = min(int(XFADE * SR), (b - a) // 2, a)
    y = x[:b].copy()
    fade_in = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
    fade_out = 1 - fade_in
    seg = x[a - f: b]
    while len(y) < length:
        y = np.concatenate([y[:-f], y[-f:] * fade_out + seg[:f] * fade_in, seg[f:]])
    return y[:length]


def a_weight(f):
    """The A-weighting curve (how loud the ear hears each frequency at moderate levels), ~1 at 1 kHz."""
    f2 = f * f
    ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
    return ra / 0.7943


def level(x, window):
    """How loud `window` (seconds) of the note sounds, in dB: A-weighted, so a soft recording's darker
    tone counts as the ear hears it rather than by its raw energy."""
    a, b = window
    seg = x[int(a * SR): int(b * SR)]
    if len(seg) < 256:
        return -200.0
    spec = np.abs(np.fft.rfft(seg)) ** 2
    w = a_weight(np.maximum(np.fft.rfftfreq(len(seg), 1 / SR), 1.0)) ** 2
    return 10 * np.log10(np.sum(spec * w) / len(seg) ** 2 * 2 + 1e-20)


def offsets(n):
    """
    Each loudness layer's level against the note's loudest recording (dB): the same. The app's
    velocity curve already makes soft notes quieter, so the recordings only change the tone; set
    lower here as well, soft notes would come out quieter twice over.
    """
    return [0.0] * n


def convert(st, root, measured):
    d = os.path.join('dl', st['folder'])
    plan = json.load(open(os.path.join(d, 'plan.json')))['files']
    kind = KINDS[st['kind']]
    cap = int(st['cap'] * SR)
    # One recording per note, layer and take: the first source's when two map to one note
    recs = {}
    for f in sorted(plan, key=lambda f: f.get('src', 0)):
        m = measured[f['file']]
        takes = recs.setdefault((m['midi'], f['layer']), [])
        if len(takes) < 2 and all(g.get('src', 0) == f.get('src', 0) for g, _ in takes):
            takes.append((f, m))
    nlayers = len(st['layers'])
    ntakes = max(len(v) for v in recs.values())
    notes = sorted({k[0] for k in recs})
    sounds = {}
    scooped = []
    for (midi, layer), takes in recs.items():
        for t, (f, m) in enumerate(takes):
            path = os.path.join(d, f['file'])
            x = load(path)
            c = m['cents']
            if st['retune'] and abs(c) >= 55:
                print(f"   not retuning {f['file']} ({c:+.0f} cents looks mismeasured)")
            r = 2 ** (-c / 1200) if st['retune'] and 2 < abs(c) < 55 else 1.0
            if r != 1.0:
                x = retune(x, c)
            s = start_of(x)
            x = x[s:]
            if st['kind'] == 'sustain' and st['retune'] and st['bend']:
                x, scoop = flatten_scoop(x, midi)
                if scoop:
                    scooped.append(f"{NAMES[midi % 12]}{midi // 12 - 1}:{scoop:.0f}")
            if st['kind'] == 'sustain' and len(x) < cap + int(0.5 * SR):
                hz = 440 * 2 ** ((midi - 69) / 12)
                lp = wav_loop(path)
                if lp:
                    loop = (int(lp[0] * SR / r) - s, int(lp[1] * SR / r) - s)
                else:
                    loop = steady(x)
                if loop and loop[0] > int(XFADE * SR):
                    x = extend(x, loop, SR / hz, cap)
                else:
                    print(f"   no steady part to loop in {f['file']}")
            sounds[(midi, layer, t)] = x[:cap]
    # How loud each note is at full velocity: its loudest recording, or, when a note has only
    # softer ones, those raised by the gap between the loudnesses on the set's other notes (a
    # library's softest takes can be 30 dB under its loudest)
    lvl = {(midi, layer): float(np.mean([level(sounds[(midi, layer, t)], kind['level']) for t in range(len(takes))]))
           for (midi, layer), takes in recs.items()}
    top = nlayers - 1
    gap = {}
    for layer in range(nlayers):
        diffs = [lvl[(m, top)] - lvl[(m, layer)] for m in notes if (m, top) in lvl and (m, layer) in lvl]
        # (no note has both: guess a few dB a step)
        gap[layer] = float(np.median(diffs)) if diffs else 3.0 * (top - layer)
    lv = {}
    for midi in notes:
        loudest = max(l for (m, l) in recs if m == midi)
        lv[midi] = lvl[(midi, loudest)] + gap[loudest]
    # Even out notes far louder or quieter than their neighbours
    if len(notes) >= 4:
        fit = np.polyval(np.polyfit(notes, [lv[m] for m in notes], 2), notes)
        trim = {m: float(np.clip(fv - lv[m], -9, 9)) for m, fv in zip(notes, fit)}
        if os.environ.get('SHOW_TRIM'):
            print('   ', ' '.join(f'{NAMES[m % 12]}{m // 12 - 1}:{lv[m]:.0f}{trim[m]:+.1f}' for m in notes))
    else:
        trim = {m: 0.0 for m in notes}
    # Fill the grid: every note at every layer and take, each layer at its step under the loudest
    out = {}
    for midi in notes:
        for layer in range(nlayers):
            have = [l for (m, l) in recs if m == midi]
            src = min(have, key=lambda l: (abs(l - layer), -l))
            for t in range(ntakes):
                x = sounds[(midi, src, t % len(recs[(midi, src)]))]
                target = lv[midi] + trim[midi] + offsets(nlayers)[layer]
                out[(midi, layer, t)] = x * 10 ** ((target - level(x, kind['level'])) / 20)
    gain = 0.89 / max(np.abs(x).max() for x in out.values())
    folder = os.path.join(root, 'public', 'bos-beat-box-samples', st['folder'])
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith('.mp3'):
            os.remove(os.path.join(folder, old))
    for (midi, layer, t), x in out.items():
        y = x * gain
        fade = int(0.25 * SR) if len(y) >= cap - 1 else int(0.03 * SR)
        y[-fade:] *= np.linspace(1, 0, fade) ** 2
        y[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        name = f'{NAMES[midi % 12]}{midi // 12 - 1}_{layer}_{t}.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-q:a', '4',
                        os.path.join(folder, name)], input=y.astype('<f8').tobytes(), check=True)
    size = sum(os.path.getsize(os.path.join(folder, n)) for n in os.listdir(folder))
    if scooped:
        print(f"   bent onto pitch at the start (cents): {' '.join(sorted(set(scooped)))}")
    print(f"{st['folder']:20s} {len(notes):3d} notes x {nlayers} layers x {ntakes} takes, "
          f"evened {max(abs(v) for v in trim.values()):.1f} dB at most, gain {20 * np.log10(gain):+.1f} dB, {size / 1e6:.1f} MB")
    return {'notes': notes, 'layers': nlayers, 'takes': ntakes}


def write_index(root, done):
    """src/audio/hostedSets.ts: each hosted set's notes, loudness layers, takes, size and fingerprint."""
    import hashlib
    path = os.path.join(root, 'src', 'audio', 'hostedSets.ts')
    sets = {}
    if os.path.exists(path):
        for m in re.finditer(r"'([a-z0-9-]+)': \{ notes: \[([0-9, ]+)\], layers: (\d+), takes: (\d+)", open(path).read()):
            sets[m.group(1)] = {'notes': [int(n) for n in m.group(2).split(',')], 'layers': int(m.group(3)), 'takes': int(m.group(4))}
    sets.update(done)
    # Size and a fingerprint of the files as they are now (the app keeps downloaded recordings, and
    # a changed fingerprint makes it download a re-made set again)
    for k, v in sets.items():
        folder = os.path.join(root, 'public', 'bos-beat-box-samples', k)
        h = hashlib.sha1()
        size = 0
        for name in sorted(os.listdir(folder)):
            if name.endswith('.mp3'):
                data = open(os.path.join(folder, name), 'rb').read()
                h.update(name.encode())
                h.update(data)
                size += len(data)
        v['hash'] = h.hexdigest()[:10]
        v['bytes'] = size
    lines = [
        '/**',
        ' * The recordings hosted with the app, set by set (public/bos-beat-box-samples/<set>/): the MIDI',
        ' * notes each set has, how many loudness layers and takes every note has, the set\'s size in bytes',
        ' * and a fingerprint of its files. Generated by scripts/real-samples/convert.py; don\'t edit by hand.',
        ' */',
        '',
        'export interface HostedSet {',
        '  notes: number[];',
        '  layers: number;',
        '  takes: number;',
        '  bytes: number;',
        '  /** Changes when the set\'s files do (see recordingStore.ts) */',
        '  hash: string;',
        '}',
        '',
        'export const HOSTED_SETS: Record<string, HostedSet> = {',
    ]
    for k in sorted(sets):
        v = sets[k]
        lines.append(f"  '{k}': {{ notes: [{', '.join(map(str, v['notes']))}], layers: {v['layers']}, takes: {v['takes']}, bytes: {v['bytes']}, hash: '{v['hash']}' }},")
    lines += ['};', '']
    open(path, 'w').write('\n'.join(lines))


def main(args):
    root, only = args[0], args[1:]
    if only == ['--index']:
        return write_index(root, {})
    measured = json.load(open('measure.json'))
    done = {}
    for st in SETS:
        if only and st['folder'] not in only:
            continue
        done[st['folder']] = convert(st, root, measured[st['folder']])
    write_index(root, done)


if __name__ == '__main__':
    main(sys.argv[1:])
