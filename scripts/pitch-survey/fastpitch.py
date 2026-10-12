import numpy as np, subprocess, json, sys, os
from concurrent.futures import ProcessPoolExecutor
NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
FL = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}
def midi(n):
    i = 2 if len(n) > 1 and n[1] in '#b' else 1
    return (int(n[i:]) + 1) * 12 + NAMES.index(FL.get(n[:i], n[:i]))
SR = 44100
def decode(path):
    raw = subprocess.run(['ffmpeg','-loglevel','error','-i',path,'-ac','1','-ar',str(SR),'-f','f32le','-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
def yin_frames(x, f0, t_end=1.2):
    lo = SR / (f0 * 2 ** (120/1200)); hi = SR / (f0 * 2 ** (-120/1200))
    W = int(max(1024, 2.5 * hi)); T = int(hi) + 3; hop = int(0.01 * SR); out = []
    n = 1 << int(np.ceil(np.log2(W + T)))
    for i in range(0, min(len(x), int(t_end * SR)) - W - T, hop):
        fr = x[i:i + W + T]; a = fr[:W]
        # difference function via FFT: d(t) = sum a^2 + sum b_t^2 - 2 r(t)
        A = np.fft.rfft(a, n); B = np.fft.rfft(fr, n)
        r = np.fft.irfft(np.conj(A) * B, n)[:T]
        c2 = np.concatenate([[0], np.cumsum(fr ** 2)])
        e_b = c2[np.arange(T) + W] - c2[np.arange(T)]
        d = np.sum(a ** 2) + e_b - 2 * r
        d[0] = 0
        cm = np.ones(T); cs = np.cumsum(d[1:]); cm[1:] = d[1:] * np.arange(1, T) / np.maximum(cs, 1e-20)
        s, e = int(lo), int(np.ceil(hi)); t = s + int(np.argmin(cm[s:e+1]))
        if t <= s or t >= e or cm[t] > 0.3: continue
        y0, y1, y2 = cm[t-1], cm[t], cm[t+1]; den = y0 - 2*y1 + y2
        tt = t + (0.5 * (y0 - y2) / den if den else 0)
        out.append((i / SR, 1200 * np.log2(SR / tt / f0), np.mean(a ** 2)))
    return out
def yin(x, f0):
    fr = yin_frames(x, f0)
    if len(fr) < 3: return None
    emax = max(e for *_, e in fr)
    loud = [(c, e) for t, c, e in fr if e >= emax * 10 ** -1.2 and t >= 0.02]
    if len(loud) < 3: return None
    c = np.array([a for a, _ in loud]); w = np.array([b for _, b in loud]); o = np.argsort(c); cw = np.cumsum(w[o]) / w.sum()
    q = lambda p: float(c[o][np.searchsorted(cw, p)])
    return q(0.5), q(0.75) - q(0.25)
def harmonic(x, f0, seconds=0.6):
    w = int(0.05 * SR); env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode='same')); pk = env.max(); start = int(0.02 * SR); end = start
    while end < min(len(x), int(seconds * SR)) and env[end] > pk * 10 ** (-15 / 20): end += 1
    seg = x[start:max(end, start + int(0.15 * SR))]
    N = 1 << 20; X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N)); f = np.fft.rfftfreq(N, 1 / SR)
    ests, mags = [], []
    for k in range(1, 7):
        lo, hi = k * f0 * 2 ** (-120 / 1200), k * f0 * 2 ** (120 / 1200)
        if hi > SR * 0.45: break
        m = (f >= lo) & (f <= hi); i = np.argmax(X[m]); ests.append(1200 * np.log2(f[m][i] / (k * f0))); mags.append(X[m][i])
    if not ests: return None
    mags, ests = np.array(mags), np.array(ests); keep = mags >= mags.max() * 0.1
    return float(np.average(ests[keep], weights=mags[keep]))
def one(args):
    path, note = args
    try:
        x = decode(path); f0 = 440 * 2 ** ((midi(note) - 69) / 12)
        y = yin(x, f0); h = harmonic(x, f0)
        return note, {'yin': None if y is None else round(y[0], 1), 'spread': None if y is None else round(y[1], 1), 'harm': None if h is None else round(h, 1)}
    except Exception as e:
        return note, {'error': str(e)}
if __name__ == '__main__':
    jobs = json.load(open(sys.argv[1]))  # {inst: [[path, note], ...]}
    out = {}
    with ProcessPoolExecutor() as ex:
        for inst, items in jobs.items():
            out[inst] = dict(ex.map(one, [tuple(i) for i in items]))
            print(inst, len(items), flush=True)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
