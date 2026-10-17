# The real pitch of every downloaded recording (fetch.py), into measure.json: which MIDI note it is
# and how many cents off it plays. A library's note names can sit an octave or two from standard
# names, and some name their files by number, so the note comes from the sound: YIN finds the
# pitch, the name says which note was meant (or, for numbered files, the pitch alone does).
import os, sys, json, subprocess
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, KINDS

SR = 44100


def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def onset(x):
    a = np.abs(x)
    return int(np.argmax(a > a.max() * 0.01))


def yin(frame, lo=24.0, hi=5000.0, threshold=0.15):
    """The frame's fundamental (Hz) by YIN, or None."""
    tmin, tmax = int(SR / hi), int(SR / lo)
    w = len(frame) - tmax
    if w < 256:
        return None
    x = frame
    # Difference function d(tau) = sum (x_j - x_{j+tau})^2 over j < w, by FFT
    n = 1 << int(np.ceil(np.log2(len(x) + w)))
    fx = np.fft.rfft(x, n)
    fw = np.fft.rfft(x[:w][::-1], n)
    corr = np.fft.irfft(fx * fw, n)[w - 1: w - 1 + tmax + 1]
    sq = np.cumsum(np.concatenate([[0], x ** 2]))
    energy_tau = sq[np.arange(tmax + 1) + w] - sq[np.arange(tmax + 1)]
    d = sq[w] + energy_tau - 2 * corr
    d[0] = 0
    cmnd = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
    cmnd = np.concatenate([[1], cmnd])
    below = np.where(cmnd[tmin:] < threshold)[0]
    if len(below) == 0:
        tau = tmin + int(np.argmin(cmnd[tmin:]))
    else:
        tau = tmin + below[0]
        while tau + 1 <= tmax and cmnd[tau + 1] < cmnd[tau]:
            tau += 1
    if 0 < tau < tmax:
        a, b, c = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
        den = a - 2 * b + c
        tau = tau + (0.5 * (a - c) / den if den else 0)
    return SR / tau


def pitch(x, window):
    """Median YIN pitch (as a fractional MIDI note) over the steady part of the note."""
    s = onset(x)
    a, b = window
    seg = x[s + int(a * SR): s + int(b * SR)]
    if len(seg) < 4096:
        seg = x[s: s + max(8192, int(b * SR))]
    hz = []
    for i in range(0, max(1, len(seg) - 4096), 2048):
        f = yin(seg[i: i + 4096 + int(SR / 24)])
        # (a frame of silence at a plucked note's end reads as no pitch, or a negative one)
        if f and np.isfinite(f) and f > 0:
            hz.append(f)
    if not hz:
        return None
    return 69 + 12 * np.log2(np.median(hz) / 440)


def sieve(x, window):
    """A function scoring how well a fundamental (Hz) explains the steady part's spectrum."""
    s = onset(x)
    a, b = window
    seg = x[s + int(a * SR): s + int(b * SR)]
    if len(seg) < 2048:
        seg = x[s: s + 8192]
    n = 1 << int(np.ceil(np.log2(len(seg) * 8)))
    mag = np.log1p(np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)) / (np.abs(seg).max() + 1e-12))
    hz_per_bin = SR / n

    def score(f0):
        ks = np.arange(1, 9)
        ks = ks[ks * f0 < 16000]
        bins = ks * f0 / hz_per_bin
        return float(np.sum(np.interp(bins, np.arange(len(mag)), mag) / np.sqrt(ks)))
    return score


def cents(score, midi):
    """Cents the note plays off `midi`, + sharp: the best-scoring pitch within 60 cents."""
    hz = 440 * 2 ** ((midi - 69) / 12)
    grid = np.arange(-60, 61)
    v = np.array([score(hz * 2 ** (c / 1200)) for c in grid])
    k = int(np.argmax(v))
    off = 0.0
    if 0 < k < len(v) - 1:
        y0, y1, y2 = v[k - 1], v[k], v[k + 1]
        den = y0 - 2 * y1 + y2
        off = (y0 - y2) / (2 * den) if den else 0.0
    return float(grid[k] + off), float(v[k])


def main(only):
    out = json.load(open('measure.json')) if os.path.exists('measure.json') else {}
    for st in SETS:
        d = os.path.join('dl', st['folder'])
        if (only and st['folder'] not in only) or not os.path.exists(os.path.join(d, 'plan.json')):
            continue
        plan = json.load(open(os.path.join(d, 'plan.json')))['files']
        if not st['pitched']:
            # Drums: each file is the note its name or source gives it, as recorded
            out[st['folder']] = {f['file']: {'midi': f['nominal'], 'cents': 0, 'yin': None} for f in plan}
            print(f"{st['folder']:20s} unpitched: {len(plan)} files at their given notes")
            json.dump(out, open('measure.json', 'w'), indent=1)
            continue
        win = KINDS[st['kind']]['tune']
        rows = []
        for f in plan:
            x = load(os.path.join(d, f['file']))
            rows.append((f, x, pitch(x, win)))
        # The library's octave: the shift that best fits its names (one for the whole set)
        shifts = [round((p - f['nominal']) / 12) for f, _, p in rows if p is not None and f['nominal'] is not None]
        shift = max(set(shifts), key=shifts.count) if shifts else 0
        res, odd = {}, []
        for f, x, p in rows:
            score = sieve(x, win)
            if f['nominal'] is None:
                if p is None:
                    # A numbered file with no pitch found (silent or unpitched): nothing to name it by
                    print('    no pitch:', f['file'])
                    continue
                midi = int(round(p))
            else:
                midi = f['nominal'] + 12 * shift
            c, best = cents(score, midi)
            # A file named a semitone or two off its real note (it happens): the sound decides,
            # every offset measured from the named note (not from one picked on the way)
            named, pick = midi, 0
            for off in (-2, -1, 1, 2):
                c2, s2 = cents(score, named + off)
                if s2 > best * 1.15 and abs(c2) < 40:
                    pick, c, best = off, c2, s2
            if pick:
                odd.append((f['file'], named, named + pick))
                midi = named + pick
            res[f['file']] = {'midi': midi, 'cents': round(c, 1), 'yin': None if p is None else round(float(p), 2)}
        out[st['folder']] = res
        cs = [r['cents'] for r in res.values()] or [0.0]
        print(f"{st['folder']:20s} octave shift {shift:+d}, cents median {np.median(cs):+6.1f} range {min(cs):+6.1f}..{max(cs):+6.1f}, {len(odd)} renamed")
        for o in odd[:8]:
            print('    renamed:', *o)
        json.dump(out, open('measure.json', 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
