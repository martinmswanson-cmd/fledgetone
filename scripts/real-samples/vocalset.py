# The choir, made from VocalSet (Wilkins, Seetharaman, Wahl and Pardo, 2018; CC BY 4.0;
# https://zenodo.org/records/1193957): 20 trained singers, 9 women and 11 men, each holding an
# "a" vowel softly (pp), without vibrato (straight) and loudly (forte) on three notes: the women
# on C4, C5 and F5, the men on C3, C4 and F4. Each choir note is every singer of its section
# whose held notes come within a fifth of it, moved onto it with the WORLD vocoder (the pitch
# moves, the voice's formants, the vowel, stay where they are, so nothing goes chipmunk or giant)
# with their own vibrato and wobble kept, and spread over the stage a few milliseconds apart, as
# a real section stands and starts. The soft layer is the soft and straight takes, the loud the
# forte ones. The "ooh" choir (choir-ooh) is the same, from their held "u" vowels. Writes
# dl/<set>/<note>_<layer>.wav and dl/<set>/plan.json for measure.py and convert.py. Needs Python 3
# with numpy and pyworld (pip install pyworld).
#   python3 vocalset.py              both choirs
#   python3 vocalset.py choir-ooh    just that one
# Fetches only the 60 files a choir uses (about 40 MB) out of the 2 GB zip, by HTTP range requests.
import os, sys, json, struct, zlib, wave, urllib.request
import numpy as np
import pyworld as pw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS

URL = 'https://zenodo.org/records/1193957/files/VocalSet.zip?download=1'
SR = 44100
FP = 5  # WORLD frame period, ms
TAKES = {0: ('pp', 'straight'), 1: ('forte',)}
# Each choir's vowel
VOWELS = {'choir': 'a', 'choir-ooh': 'u'}
# The choir's notes: every 3 semitones from F2 (the basses' lowest, a fifth under their C3) to
# B5; the men sing up to F4, the women from G3 (tenors and altos together in between)
NOTES = list(range(41, 84, 3))
MEN, WOMEN = (41, 65), (55, 84)
REACH = 7  # semitones a singer's note is moved, at most
LENGTH = 4.5  # seconds of each note (convert.py loops its steady part)


def _range(a, b):
    for _ in range(6):
        try:
            return urllib.request.urlopen(urllib.request.Request(URL, headers={'Range': f'bytes={a}-{b}'}), timeout=120).read()
        except Exception as e:  # retry: the connection drops now and then
            err = e
    raise err


def listing():
    """The zip's files: name, method, sizes and offset (its central directory, read by range)."""
    n = int(urllib.request.urlopen(urllib.request.Request(URL, method='HEAD')).headers['Content-Length'])
    tail = _range(n - 70000, n - 1)
    i = tail.rfind(b'PK\x05\x06')
    size, off = struct.unpack('<II', tail[i + 12:i + 20])
    loc = tail.rfind(b'PK\x06\x07')
    if loc >= 0:  # (zip64)
        rec_at = struct.unpack('<Q', tail[loc + 8:loc + 16])[0]
        size, off = struct.unpack('<QQ', _range(rec_at, rec_at + 55)[40:56])
    cd, p, out = _range(off, off + size - 1), 0, []
    while cd[p:p + 4] == b'PK\x01\x02':
        meth, = struct.unpack('<H', cd[p + 10:p + 12])
        csize, usize = struct.unpack('<II', cd[p + 20:p + 28])
        nl, el, cl = struct.unpack('<HHH', cd[p + 28:p + 34])
        at, = struct.unpack('<I', cd[p + 42:p + 46])
        extra, q = cd[p + 46 + nl:p + 46 + nl + el], 0
        while q < len(extra):
            hid, hl = struct.unpack('<HH', extra[q:q + 4])
            if hid == 1:
                vals, k = extra[q + 4:q + 4 + hl], 0
                for name in ('usize', 'csize', 'at'):
                    if {'usize': usize, 'csize': csize, 'at': at}[name] == 0xFFFFFFFF:
                        v, = struct.unpack('<Q', vals[k:k + 8]); k += 8
                        usize, csize, at = (v, csize, at) if name == 'usize' else (usize, v, at) if name == 'csize' else (usize, csize, v)
            q += 4 + hl
        out.append({'name': cd[p + 46:p + 46 + nl].decode('utf8', 'replace'), 'method': meth, 'csize': csize, 'at': at})
        p += 46 + nl + el + cl
    return out


def extract(e):
    nl, el = struct.unpack('<HH', _range(e['at'], e['at'] + 29)[26:30])
    start = e['at'] + 30 + nl + el
    data = _range(start, start + e['csize'] - 1)
    return data if e['method'] == 0 else zlib.decompress(data, -15)


def read(path):
    w = wave.open(path)
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64).reshape(-1, w.getnchannels()).mean(1) / 32768
    return x, w.getframerate()


def steady_notes(x, sr, min_len=1.5):
    """
    The held notes in a recording: stretches whose pitch (median over 0.4 s, so vibrato averages
    out) stays within 0.9 semitone; [(start s, end s, midi)].
    """
    f0, _ = pw.harvest(x, sr, f0_floor=70, f0_ceil=1100, frame_period=FP)
    m = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1) / 440), np.nan)
    w = int(400 / FP)
    sm = np.full(len(m), np.nan)
    for i in range(len(m)):
        win = m[max(0, i - w // 2): i + w // 2 + 1]
        if np.isfinite(win).sum() > w // 3:
            sm[i] = np.nanmedian(win)
    out, i = [], 0
    while i < len(sm):
        if not np.isfinite(sm[i]):
            i += 1
            continue
        j, ref = i, sm[i]
        while j < len(sm) and np.isfinite(sm[j]) and abs(sm[j] - ref) < 0.9:
            ref = np.median(sm[i:j + 1])
            j += 1
        if (j - i) * FP / 1000 >= min_len:
            out.append((i * FP / 1000, j * FP / 1000, float(np.median(sm[i:j]))))
        i = max(j, i + 1)
    return out


class Take:
    """One singer's held note, analysed by WORLD."""

    def __init__(self, singer, x, sr, start, end, midi):
        self.singer, self.midi = singer, midi
        seg = x[int(max(0, start - 0.08) * sr): int(end * sr)]
        f0, t = pw.harvest(seg, sr, f0_floor=70, f0_ceil=1100, frame_period=FP)
        self.sp, self.ap, self.sr = pw.cheaptrick(seg, f0, t, sr), pw.d4c(seg, f0, t, sr), sr
        # The tracker slips an octave on some breathy voices: every frame is held to the octave
        # the note was sung in
        voiced = f0 > 0
        sung = 440 * 2 ** ((midi - 69) / 12)
        f0[voiced] *= 2.0 ** np.round(np.log2(sung / f0[voiced]))
        self.f0 = f0
        mid = f0[len(f0) // 4: 3 * len(f0) // 4]
        self.centre = float(np.median(mid[mid > 0]))

    def sung_at(self, target, seconds):
        """The note moved onto `target` (MIDI), lengthened to `seconds` by going back and forth over its steady middle."""
        n = int(seconds * 1000 / FP)
        idx = np.arange(len(self.f0))
        if len(idx) < n:
            a, b = len(idx) // 3, len(idx) - 10  # (from a third in: past the attack)
            back_forth = np.concatenate([np.arange(b - 1, a, -1), np.arange(a + 1, b)])
            idx = np.concatenate([idx, np.resize(back_forth, n - len(idx))])
        idx = idx[:n]
        ratio = 440 * 2 ** ((target - 69) / 12) / self.centre
        f0 = np.where(self.f0[idx] > 0, self.f0[idx] * ratio, 0)
        return pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(self.sp[idx]), np.ascontiguousarray(self.ap[idx]), self.sr, FP)


def choir_note(target, layer, takes):
    """Every singer of the note's sections within reach, moved onto it and spread over the stage: stereo."""
    rng = np.random.default_rng(target * 7 + layer)
    voices = []
    for singer in sorted({t.singer for t in takes}):
        lo, hi = MEN if singer.startswith('m') else WOMEN
        if not lo <= target <= hi:
            continue
        mine = [t for t in takes if t.singer == singer and abs(t.midi - target) <= REACH]
        if not mine:
            continue
        take = min(mine, key=lambda t: abs(t.midi - target))
        y = take.sung_at(target, LENGTH)
        # (a take that came out mostly unvoiced is left out)
        f0c, _ = pw.harvest(y[: SR * 2], SR, f0_floor=70, f0_ceil=1100, frame_period=20)
        if (f0c > 0).mean() < 0.6:
            continue
        voices.append(y / (np.sqrt(np.mean(y[len(y) // 4: 3 * len(y) // 4] ** 2)) + 1e-9))
    out = np.zeros((int(SR * (LENGTH + 0.06)), 2))
    # Spread evenly over the stage, in a shuffled order, each a few milliseconds late
    pans = np.linspace(-0.8, 0.8, len(voices)) if len(voices) > 1 else [0.0]
    for y, pan in zip(voices, rng.permutation(pans)):
        d = int(SR * rng.uniform(0, 0.04))
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        m = min(len(y), len(out) - d)
        out[d:d + m, 0] += gl * y[:m]
        out[d:d + m, 1] += gr * y[:m]
    return out / max(np.abs(out).max(), 1e-9) * 0.7, len(voices)


def write(path, y):
    w = wave.open(path, 'wb')
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
    w.close()


def build(folder, entries):
    st = next(s for s in SETS if s['folder'] == folder)
    vowel = VOWELS[folder]
    d = os.path.join('dl', folder)
    src = os.path.join(d, 'source')
    os.makedirs(src, exist_ok=True)
    wanted = [e for e in entries if e['name'].startswith('FULL/') and '/long_tones/' in e['name']
              and any(e['name'].endswith(f'_long_{k}_{vowel}.wav') for ks in TAKES.values() for k in ks)]
    takes = {0: [], 1: []}
    for e in wanted:
        path = os.path.join(src, os.path.basename(e['name']))
        if not os.path.exists(path):
            open(path, 'wb').write(extract(e))
        singer, kind = os.path.basename(path).split('_')[0], os.path.basename(path).split('_')[2]
        layer = next(k for k, v in TAKES.items() if kind in v)
        x, sr = read(path)
        for a, b, midi in steady_notes(x, sr):
            takes[layer].append(Take(singer, x, sr, a, b, midi))
    files = []
    for target in NOTES:
        for layer in TAKES:
            y, n = choir_note(target, layer, takes[layer])
            name = f'{target}_{layer}.wav'
            write(os.path.join(d, name), y)
            files.append({'path': name, 'file': name, 'nominal': target, 'layer': layer, 'take': '', 'src': 0})
            print(f'   {target} {st["layers"][layer]}: {n} singers')
    json.dump({'source': URL, 'files': files}, open(os.path.join(d, 'plan.json'), 'w'), indent=1)
    print(f"{folder:20s} {len(files)} notes")


if __name__ == '__main__':
    entries = listing()
    for folder in sys.argv[1:] or list(VOWELS):
        build(folder, entries)
