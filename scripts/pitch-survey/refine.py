import json, sys, numpy as np
from concurrent.futures import ProcessPoolExecutor
import fastpitch as fp
SH = fp.NAMES
VOICES = {'choir', 'voiceOohs', 'synthChoir', 'choirPad'}
def midi(n): return fp.midi(n)
def keyest(args):
    key, m, seg, voice = args
    f0 = 440 * 2 ** ((m - 69) / 12)
    y = fp.yin(seg, f0)
    if voice: return m, (y[0] if y and y[1] <= 25 else None)
    h = fp.harmonic(seg, f0)
    if y is None: return m, None
    if f0 < 150 or h is None: return m, y[0] if y[1] <= 25 else None
    if abs(y[0] - h) > 12: return m, (y[0] if y[1] <= 12 else None)
    return m, (y[0] + h) / 2
def analyse(key, meta, D):
    x = fp.decode(f'{D}/{key}.wav'); lo, hi = meta['lo'], meta['hi']
    jobs = [(key, m, x[int((m - lo) * fp.SR):int((m - lo + 1) * fp.SR)], key in VOICES) for m in range(lo, hi + 1)]
    return dict(map(keyest, jobs))
if __name__ == '__main__':
    D = sys.argv[1]; meta = json.load(open(f'{D}/meta.json')); T = json.load(open('tuning.json'))
    keys = [k for k in meta if not meta[k].get('error')]
    with ProcessPoolExecutor() as ex:
        results = dict(zip(keys, ex.map(analyse, keys, [meta[k] for k in keys], [D] * len(keys))))
    json.dump({k: {str(m): e for m, e in v.items()} for k, v in results.items()}, open(f'{D}/keys.json', 'w'))
    summary = []
    for k in keys:
        recs = sorted(midi(n) for n in meta[k]['samples'])
        def nearest(m):
            best = None
            for r in recs:
                d = abs(r - m)
                if best is None or d < best[0] or (d == best[0] and r > best[1]): best = (d, r)
            return best[1]
        per = {}
        for m, e in results[k].items():
            if e is not None: per.setdefault(nearest(m), []).append(e)
        vals = [e for e in results[k].values() if e is not None]
        steps = [abs(results[k][m] - results[k][m - 1]) for m in results[k] if m - 1 in results[k] and results[k][m] is not None and results[k][m - 1] is not None]
        summary.append((k, max(map(abs, vals)) if vals else 0, max(steps) if steps else 0))
        cents = dict(T.get(k, {}).get('cents', {}))
        for r, es in per.items():
            if len(es) < 2: continue
            med = float(np.median(es)); nm = f"{SH[r % 12]}{r // 12 - 1}"
            if abs(med) >= 4: cents[nm] = cents.get(nm, 0) - round(med)
        T.setdefault(k, {'notes': None, 'cents': {}})['cents'] = {n: c for n, c in cents.items() if c}
    json.dump(T, open('tuning.json', 'w'), indent=1)
    for k, worst, step in sorted(summary, key=lambda s: -s[2]):
        if worst >= 10 or step >= 12: print(f"{k:16} worst key {worst:5.1f}  largest neighbour step {step:5.1f}")
