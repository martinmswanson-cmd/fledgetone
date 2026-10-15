# Turn the downloaded recordings (fetch.py) into the app's files, using their measured notes and
# tuning (measure.py):
#   python3 convert.py /path/to/bos-beat-box              every set
#   python3 convert.py /path/to/bos-beat-box harp flute   just these
# Writes public/fledgetone-samples/<set>/<note>_<layer>_<take>.mp3 and the list of what each set
# has, src/audio/hostedSets.ts (`convert.py <root> --index` rewrites just that).
#
# Each recording keeps its channels (stereo stays stereo: the width and room of a section or a
# piano), is tuned (unless the set keeps its tuning), started at the note,
# and, for held instruments, looped where it's steady so a note can be held up to the set's `cap`.
# A note far louder or quieter than its neighbours is brought in line with them, and a note's
# softer recordings are set to its loudest one's level (velocity sets the level, the recording
# the tone, so moving between them is smooth). Missing recordings are filled from the same note's
# nearest loudness or other take, so every note has every layer and take (or, in a `sparse` set,
# left to a nearby note's recording at that loudness). A ringing note cut off while it still
# sounds can be given the rest of its decay (`tail`). One gain per set leaves its loudest peak
# just under full scale.
import os, sys, json, struct, subprocess, re
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, KINDS

SR = 44100
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
XFADE = 0.12  # seconds of crossfade at each loop seam
STRETCH = 3  # semitones the app stretches a recording before it prefers another (songSamples.ts STRETCH_SEMITONES)


def channels_of(p):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.strip()
    return 2 if out and int(out) >= 2 else 1


def load(p, stereo=True):
    """The recording as a (channels, samples) array: two channels if it has two (and `stereo`), else one."""
    ch = 2 if stereo and channels_of(p) == 2 else 1
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).astype(np.float64)
    return x.reshape(-1, ch).T.copy()


def mono(x):
    """One channel of a (channels, samples) array, for measuring."""
    return x.mean(axis=0)


def each(x, f):
    """`f` applied to every channel of a (channels, samples) array, trimmed to the shortest result."""
    ys = [f(c) for c in x]
    n = min(len(y) for y in ys)
    return np.stack([y[:n] for y in ys])


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
    stereo = x
    x = mono(stereo)
    c = pitch_track(x, midi, hop=hop)
    if len(c) < 8:
        return stereo, 0.0
    env, h = envelope(x[: int((len(c) * hop + 0.1) * SR)], hop)
    loud = np.zeros(len(c), bool)
    loud[: min(len(c), len(env))] = env[: len(c)] > np.max(env) - 25
    k = int(0.25 / hop)
    smooth = np.convolve(np.pad(np.where(loud, c, 0.0), (k // 2, k - k // 2 - 1), mode='edge'), np.ones(k) / k, mode='valid')
    smooth = np.where(loud, smooth, 0.0)
    head = slice(0, int(0.8 / hop))
    if np.max(np.abs(smooth[head])) <= 20:
        return stereo, 0.0
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
        return stereo, 0.0
    return np.stack([ch[k0] * (1 - fr) + ch[k0 + 1] * fr for ch in stereo]), float(np.max(np.abs(smooth[head])))


def fine_track(x, midi, hop=0.02, win=0.08):
    """Cents off `midi` every `hop` seconds over the whole of `x` (a harmonic sieve per frame, to a
    cent: the coarse grid, then a parabola through the best and its neighbours)."""
    hz = 440 * 2 ** ((midi - 69) / 12)
    grid = np.arange(-80, 81, 2)
    n = 1 << 14
    f = np.fft.rfftfreq(n, 1 / SR)
    ks = np.arange(1, 7)
    w = int(win * SR)
    out = []
    for a in range(0, len(x) - w, int(hop * SR)):
        seg = x[a: a + w]
        mag = np.log1p(np.abs(np.fft.rfft(seg * np.hanning(w), n)) / (np.abs(seg).max() + 1e-12))
        score = (np.interp(np.outer(hz * 2 ** (grid / 1200), ks), f, mag) / np.sqrt(ks)).sum(axis=1)
        k = int(np.argmax(score))
        d = 0.0
        if 0 < k < len(grid) - 1:
            y0, y1, y2 = score[k - 1], score[k], score[k + 1]
            den = y0 - 2 * y1 + y2
            d = 0.5 * (y0 - y2) / den if den else 0.0
        out.append(float(grid[k] + 2 * d))
    return np.array(out)


def flatten_drift(stereo, midi, hop=0.02):
    """
    Hold a note played without vibrato on its pitch all the way through (sets.py `steady`): a bow
    drifts a few cents over a long note, which the app's own vibrato (added on top) would otherwise
    ride on. The pitch is followed every 20 ms, smoothed over a fifth of a second, and read faster
    where it's flat and slower where it's sharp, only where the note is within 30 dB of its peak
    (the release keeps its own). Returns it and the largest correction in cents.
    """
    x = mono(stereo)
    c = fine_track(x, midi, hop)
    if len(c) < 10:
        return stereo, 0.0
    env, _ = envelope(x, hop)
    env = env[: len(c)]
    loud = env > env.max() - 30
    k = int(0.2 / hop)
    # Each frame's smoothed pitch, from its loud neighbours only (a frame wildly off is misread)
    ok = loud & (np.abs(c - np.median(c[loud])) < 40)
    num = np.convolve(np.where(ok, c, 0.0), np.ones(k), mode='same')
    den = np.convolve(ok.astype(float), np.ones(k), mode='same')
    smooth = np.where(den > 0, num / np.maximum(den, 1e-9), 0.0)
    # (more than 30 cents is a misreading, not a drift)
    smooth = np.where(loud, np.clip(smooth, -30, 30), 0.0)
    t = np.arange(len(smooth)) * hop + 0.04  # each frame's centre
    n = x.shape[0]
    rate = 2 ** (-np.interp(np.arange(n) / SR, t, smooth, left=smooth[0], right=0.0) / 1200)
    pos = np.concatenate([[0], np.cumsum(rate[:-1])])
    pos = pos[pos < n - 2]
    k0 = pos.astype(int)
    fr = pos - k0
    return np.stack([ch[k0] * (1 - fr) + ch[k0 + 1] * fr for ch in stereo]), float(np.max(np.abs(smooth)))


#: A held note's loop inside its own steady part (sets.py `xloop`): at most this long (seconds),
#: its end crossfaded over XLOOP_FADE into what comes before its start
XLOOP_MOST = 3.0
XLOOP_FADE = 0.25


def held_span(m):
    """
    (start, end) in samples of a held note's sustain, for its loop (inner_loop): from a quarter
    second after it first comes within 6 dB of its loudest (past the bow's attack) to 0.15 s before
    it last is within 15 dB of it (before the release); if that's under half a second (a short
    note, or one that swells to its end), from 0.1 s after it first comes within 6 dB (0.3 s at
    the latest) to 0.1 s before its end; None if even that's under 0.3 s.
    """
    env, h = envelope(m, 0.01)
    if len(env) < 20:
        return None
    top = np.max(env)
    first = int(np.argmax(env > top - 6))
    last = len(env) - 1 - int(np.argmax(env[::-1] > top - 15))
    a, b = (first + 25) * h, (last - 15) * h
    if b - a < int(0.5 * SR):
        a, b = min((first + 10) * h, int(0.3 * SR)), len(m) - int(0.1 * SR)
    return (a, b) if b - a >= int(0.3 * SR) else None


def inner_loop(x, midi, cap):
    """
    A held note looped inside its own recording (sets.py `xloop`): the longest stretch of its
    sustain (held_span) up to XLOOP_MOST seconds, ending 0.4 s before the cap at the latest. Its
    start is moved by up to two periods of the note to where the sound before it best matches the
    sound before its end, and its last XLOOP_FADE seconds (less in a short loop) are crossfaded into
    that, so the jump from its end back to its start is seamless. Its level is held steady from
    just before the loop on (a bow's slow swell or fade, repeated, would pump): the level over each
    0.15 s brought to the loop's middle level, by at most 6 dB, easing in over the 0.2 s before.
    The file goes on past the loop's end with what follows its start (as a looping note would),
    0.3 s of it. Returns the note and the loop's (start, end) in seconds, or the note unchanged
    and None when its sustain is too short.
    """
    m = mono(x)
    span = held_span(m)
    if not span:
        return x, None
    b = min(span[1], cap - int(0.4 * SR))
    a = max(span[0], b - int(XLOOP_MOST * SR))
    f = min(int(XLOOP_FADE * SR), (b - a) // 3, a - int(0.01 * SR))
    if b - a < int(0.3 * SR) or f < int(0.05 * SR):
        return x, None
    period = SR / (440 * 2 ** ((midi - 69) / 12))
    ref = m[b - f: b]
    best, best_a = -2.0, a
    for d in range(-int(2 * period), int(2 * period) + 1):
        s = m[a + d - f: a + d]
        if len(s) != f or a + d - f < 0:
            continue
        r = float(np.dot(s, ref) / (np.linalg.norm(s) * np.linalg.norm(ref) + 1e-12))
        if r > best:
            best, best_a = r, a + d
    a = best_a
    # The level held steady from just before the loop
    h = int(0.01 * SR)
    n = len(m) // h
    rms = np.sqrt(np.convolve(np.mean(m[: n * h].reshape(n, h) ** 2, axis=1), np.ones(15) / 15, mode='same')) + 1e-9
    want = float(np.median(rms[a // h: b // h]))
    g = np.clip(want / rms, 0.5, 2.0)
    t0 = max(0, (a - f) // h - 20)
    g[: t0] = 1.0
    ramp = np.linspace(0, 1, (a - f) // h - t0 + 1)
    g[t0: (a - f) // h + 1] = 1 + (g[t0: (a - f) // h + 1] - 1) * ramp
    gain = np.interp(np.arange(x.shape[1]), np.arange(n) * h + h / 2, g)
    x = x * gain
    fade_in = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
    tail = int(0.3 * SR)

    def build(ch):
        y = ch[: b].copy()
        y[b - f: b] = ch[b - f: b] * (1 - fade_in) + ch[a - f: a] * fade_in
        return np.concatenate([y, ch[a: a + tail]])
    return each(x, build), (a / SR, b / SR)


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


def loop_points(loop, period):
    """The part of a held note extend() repeats: (a, b), b - a a whole number of the note's periods."""
    a, b = loop
    if period:
        k = max(1, round((b - a) / period))
        a = int(round(b - k * period))
    return a, b


def seamless_loop(loop, period, length):
    """
    (start, end) in seconds of a stretch of an extended note (extend()) that repeats seamlessly, so
    the app can hold the note for as long as the key is down. From the first repeat (each repeat is
    b - a long, so any whole number of them loops) to a little before the fade at the file's end.
    """
    a, b = loop_points(loop, period)
    f = min(int(XFADE * SR), (b - a) // 2, a)
    first = b + f
    end = length - int(0.35 * SR)
    count = (end - first) // (b - a)
    if count < 1:
        return None
    return ((end - count * (b - a)) / SR, end / SR)


def extend(x, loop, period, length):
    """`x` held to `length` samples by repeating x[a:b], crossfaded, b - a a whole number of periods."""
    a, b = loop_points(loop, period)
    f = min(int(XFADE * SR), (b - a) // 2, a)
    y = x[:b].copy()
    fade_in = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
    fade_out = 1 - fade_in
    seg = x[a - f: b]
    while len(y) < length:
        y = np.concatenate([y[:-f], y[-f:] * fade_out + seg[:f] * fade_in, seg[f:]])
    return y[:length]


# ---- ringing on: the rest of a decay a recording was cut off before (sets with `tail`) ----

#: Seconds of the recording repeated (whole periods of the note) to ring on from its end
RING_LOOP = 0.3
#: How a tail that reaches the set's cap fades away (seconds)
TAIL_FADE = 1.5


def decay_rate(x):
    """
    How fast a ringing note is dying away at the end of its recording, in dB a second (negative):
    a straight line through its level over the later part (from 45% of the way in, after its
    peak, to 50 ms before the end), or None when there's too little of it to tell.
    """
    env, h = envelope(x)
    hop = h / SR
    a = max(int(np.argmax(env)) + int(0.2 / hop), int(len(env) * 0.45))
    b = len(env) - int(0.05 / hop)
    if b - a < int(0.3 / hop):
        return None
    return float(np.polyfit(np.arange(a, b) * hop, env[a:b], 1)[0])


def unfade(x):
    """
    `x` (channels, samples) up to where its library faded it out (sets.py `tail='faded'`): the
    guitars' softer notes were faded from 40 dB down over their last second or so, which the
    straight line of a ringing note's decay doesn't do. Its level over the body of the note (from
    0.2 s after its peak to half way) is a straight line in dB; it's cut where it first falls 6 dB
    under that line, carried on, in the later half, and the decay rate is that line's (dB a
    second, or None when there's too little to tell). Unfaded, it's returned whole with the rate
    of its later part (decay_rate).
    """
    m = mono(x)
    env, h = envelope(m)
    hop = h / SR
    a = int(np.argmax(env)) + int(0.2 / hop)
    b = max(a + int(0.3 / hop), len(env) // 2)
    if b >= len(env) or b - a < int(0.3 / hop):
        return x, decay_rate(m)
    slope, icept = np.polyfit(np.arange(a, b) * hop, env[a:b], 1)
    line = icept + slope * np.arange(len(env)) * hop
    under = np.nonzero(env[b:] < line[b:] - 6)[0]
    if not len(under) or slope >= 0:
        return x, decay_rate(m)
    cut = (b + int(under[0])) * h
    return x[:, :cut], float(slope)


def natural_tail(x, midi, rate, length):
    """
    `x` (channels, samples), cut off while still ringing, given the rest of its decay: its last
    RING_LOOP seconds (a whole number of the note's periods) repeated, each repeat `rate` dB a
    second quieter than the one before so the level carries straight on down, crossfaded at each
    join, until 60 dB under its peak or `length` samples (fading out over TAIL_FADE there). The
    highs die half again as fast as the rest, as a real string's or tine's overtones do, so a
    long tail darkens instead of freezing its tone.
    """
    m = mono(x)
    n = x.shape[1]
    env, h = envelope(m)
    tail_db = float(np.mean(env[-int(0.15 * SR / h): -max(1, int(0.03 * SR / h))]))
    to_go = 60 - (float(env.max()) - tail_db)
    total = min(length, n + int(max(0.0, to_go / -rate) * SR))
    if total < n + int(0.1 * SR):
        return x
    hz = 440 * 2 ** ((midi - 69) / 12)
    period = SR / hz
    b = n - int(0.03 * SR)
    span = min(RING_LOOP * SR, b - 0.15 * SR)
    k = int(span // period)
    if k < 1:
        return x
    L = int(round(k * period))
    a = b - L
    f = min(int(0.04 * SR), L // 2, a)
    g = 10 ** (rate * L / SR / 20)
    fade_in = np.sin(np.linspace(0, np.pi / 2, f)) ** 2
    fade_out = 1 - fade_in

    def ring(ch):
        y = ch[:b].copy()
        seg = ch[a - f: b]
        rep_ = 1
        while len(y) < total:
            s_ = seg * g ** rep_
            y = np.concatenate([y[:-f], y[-f:] * fade_out + s_[:f] * fade_in, s_[f:]])
            rep_ += 1
        y = y[:total]
        # The highs (over three times the note's pitch) die half again as fast from the join on
        lp = np.empty_like(y)
        c = 1 - np.exp(-2 * np.pi * min(3 * hz, 0.4 * SR) / SR)
        acc = 0.0
        for i, v in enumerate(y):
            acc += c * (v - acc)
            lp[i] = acc
        t = np.maximum(0, np.arange(total) - b) / SR
        return lp + (y - lp) * 10 ** (0.5 * rate * t / 20)

    y = each(x, ring)
    if y.shape[1] >= length:
        fade = min(int(TAIL_FADE * SR), y.shape[1] - b)
        y[:, -fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    return y


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


#: Where a recording's loudness is measured for matching a note's loudnesses (seconds): its
#: energy over each of these (and the kind's own window), and its peak over the first. The first
#: 0.1 s is a short note's whole sound, and a loud staccato note can speak later than a soft one.
MATCH_WINDOWS = [(0.0, 0.1), (0.0, 0.25), (0.0, 0.5)]
MATCH_PEAK = (0.0, 0.3)


#: A held note played without vibrato (sets.py `steady`) is matched over its first half second and
#: its body, not its first tenths or its peak: a loud bowed note can start slower than a soft one,
#: and matched over its first tenth too, its soft recordings came out up to 20 dB under it.
STEADY_WINDOWS = [(0.05, 0.5), (0.3, 1.5)]


def raw_levels(x, window, steady=False):
    """
    How loud a recording measures, unweighted (dB): its energy over each of MATCH_WINDOWS and
    `window` (the kind's), then its peak over MATCH_PEAK, for matching a note's loudnesses (see
    match_layers).
    """
    out = []
    for a, b in [*(STEADY_WINDOWS if steady else MATCH_WINDOWS), window]:
        seg = x[int(a * SR): int(b * SR)]
        out.append(10 * np.log10(np.mean(seg ** 2) + 1e-20) if len(seg) >= 256 else -200.0)
    if steady:
        return np.array(out)
    seg = x[int(MATCH_PEAK[0] * SR): int(MATCH_PEAK[1] * SR)]
    out.append(20 * np.log10(np.max(np.abs(seg)) + 1e-12) if len(seg) else -200.0)
    return np.array(out)


#: How much of a note's start lines its recordings up with each other (seconds)
ALIGN_WINDOW = 0.3
#: The furthest a recording is moved to line up (seconds)
ALIGN_MOST = 0.012


def align(x, ref, period):
    """
    `x` (channels, samples) moved later by up to one period of its note (at most ALIGN_MOST; a
    drum, `period` None, up to ALIGN_MOST), and turned over if need be, so that its start is in
    step with `ref`'s: the app blends a note's two recordings either side of a loudness boundary,
    and two recordings of a ringing note out of step cancel (a vibraphone's soft and hard strokes
    came out up to 6 dB quieter blended than either alone). Only later, so no attack is cut; a
    few milliseconds, or the sign, is inaudible on a recording heard alone. Returns it and the
    move in samples.
    """
    a, b = mono(x), mono(ref)
    n = min(len(a), len(b), int(ALIGN_WINDOW * SR))
    if n < 256:
        return x, 0
    most = int(min(ALIGN_MOST * SR, period or ALIGN_MOST * SR))
    a_, b_ = a[:n], b[:n]
    best, lag = 0.0, 0
    for k in range(0, most + 1):
        # x moved later by k samples: compare x[i - k] with ref[i]
        c = float(np.dot(a_[: n - k], b_[k:n]))
        if abs(c) > abs(best):
            best, lag = c, k
    sign = -1.0 if best < 0 else 1.0
    y = np.concatenate([np.zeros((x.shape[0], lag)), x], axis=1)[:, : x.shape[1]] if lag else x
    return y * sign, lag


def align_layers(out, notes, nlayers, ntakes, pitched):
    """
    Every recording of each note lined up with its loudest one's first take (see align). Returns
    how far each was moved (samples, later), by key, for its loop points.
    """
    lags = {}
    for midi in notes:
        have = [k for k in out if k[0] == midi]
        if len(have) < 2:
            continue
        top = max(l for _, l, _ in have)
        ref = out[(midi, top, 0)]
        period = SR / (440 * 2 ** ((midi - 69) / 12)) if pitched else None
        for k in have:
            if k != (midi, top, 0):
                out[k], lags[k] = align(out[k], ref, period)
    return lags


def match_layers(out, notes, nlayers, ntakes, window, steady=False):
    """
    Every softer recording set to the loudest loudness's level at its note, by unweighted energy
    (over the start and over the kind's window) and peak: the lowest of those gains, so a softer
    recording never measures louder than a harder one any of those ways. (Matched by A-weighted
    loudness, which hardly hears the lows, a low note's or a drum's soft recording, its energy in
    the lows, came out several dB louder than its loud one, and turning up the velocity across a
    loudness made it quieter.) The loudest loudness's level at a note it wasn't recorded on (a
    sparse set's) is its recordings' on the notes either side, in between.
    """
    top = nlayers - 1
    tops = sorted(m for m in notes if (m, top, 0) in out)
    if not tops:
        return

    def lv(m, layer):
        return np.mean([raw_levels(mono(out[(m, layer, t)]), window, steady) for t in range(ntakes) if (m, layer, t) in out], axis=0)

    ref = np.array([lv(m, top) for m in tops])
    for (midi, layer, t) in list(out):
        if layer == top or t:
            continue
        want = np.array([np.interp(midi, tops, ref[:, i]) for i in range(ref.shape[1])])
        gain = 10 ** (float(np.min(want - lv(midi, layer))) / 20)
        for tt in range(ntakes):
            if (midi, layer, tt) in out:
                out[(midi, layer, tt)] = out[(midi, layer, tt)] * gain


def offsets(n):
    """
    Each loudness layer's level against the note's loudest recording (dB): the same. The app's
    velocity curve already makes soft notes quieter, so the recordings only change the tone; set
    lower here as well, soft notes would come out quieter twice over.
    """
    return [0.0] * n


def unsteady(x):
    """
    Why a held note played without vibrato (sets.py `steady`) isn't one steady note, or None: a
    stretch of it (0.1 s) 12 dB or more over its middle level (another, louder sound caught with
    it), or its start much quieter than its middle (a soft sound before the note itself).
    """
    env, h = envelope(x, 0.1)
    if len(env) < 8:
        return None
    body = env[3: -3]
    mid = float(np.median(body))
    if body.max() - mid >= 12:
        return f'a sound {body.max() - mid:.0f} dB over the note'
    if np.median(env[2:6]) < mid - 12:
        return 'a quiet start before the note'
    return None


def convert(st, root, measured):
    d = os.path.join('dl', st['folder'])
    plan = json.load(open(os.path.join(d, 'plan.json')))['files']
    kind = KINDS[st['kind']]
    cap = int(st['cap'] * SR)
    # One recording per note, layer and take: the first source's when two map to one note
    recs = {}
    for f in sorted(plan, key=lambda f: f.get('src', 0)):
        m = measured[f['file']]
        why = unsteady(mono(load(os.path.join(d, f['file']), False))) if st['steady'] else None
        if why:
            print(f"   left out {f['file']}: {why}")
            continue
        takes = recs.setdefault((m['midi'], f['layer']), [])
        # (a set of one take per note whose file turned out to be a neighbour's note keeps its first)
        if len(takes) < 2 and all(g.get('src', 0) == f.get('src', 0) and not (st['iowa'] and g['take'] == f['take']) for g, _ in takes):
            takes.append((f, m))
    nlayers = len(st['layers'])
    ntakes = max(len(v) for v in recs.values())
    notes = sorted({k[0] for k in recs})
    sounds = {}
    loops = {}
    scooped = []
    for (midi, layer), takes in recs.items():
        for t, (f, m) in enumerate(takes):
            path = os.path.join(d, f['file'])
            x = load(path, st.get('stereo', True))
            c = m['cents']
            # Over 55 cents off looks mismeasured, unless YIN (in any octave) heard the same pitch:
            # a whole library can be tuned a quarter tone off (the banjo), a singer drift flat
            yin_agrees = m.get('yin') is not None and abs((m['yin'] - midi - c / 100 + 6) % 12 - 6) < 0.25
            tunable = abs(c) < 55 or (abs(c) < 59.5 and yin_agrees)
            if st['retune'] and not tunable:
                print(f"   not retuning {f['file']} ({c:+.0f} cents looks mismeasured)")
            r = 2 ** (-c / 1200) if st['retune'] and 2 < abs(c) and tunable else 1.0
            if r != 1.0:
                x = each(x, lambda ch: retune(ch, c))
            s = start_of(mono(x))
            x = x[:, s:]
            if st['kind'] == 'sustain' and st['retune'] and st['bend']:
                x, scoop = flatten_scoop(x, midi)
                if scoop:
                    scooped.append(f"{NAMES[midi % 12]}{midi // 12 - 1}:{scoop:.0f}")
            if st['steady']:
                x, drift = flatten_drift(x, midi)
                if drift > 8:
                    scooped.append(f"{NAMES[midi % 12]}{midi // 12 - 1}~{drift:.0f}")
            if st['kind'] == 'sustain' and st['xloop']:
                x, seam = inner_loop(x[:, :cap], midi, cap)
                if seam:
                    loops[(midi, layer, t)] = seam
                else:
                    print(f"   no steady part to loop in {f['file']}")
            elif st['kind'] == 'sustain':
                # Every held note gets a seamless loop (so it can be held as long as the key is):
                # a recording shorter than the cap is extended from its steady part, a longer one
                # from a steady stretch ending 3 s before the cap (what came after is replaced by
                # repeats of it, close to what was there)
                hz = 440 * 2 ** ((midi - 69) / 12)
                lp = wav_loop(path)
                if lp:
                    loop = (int(lp[0] * SR / r) - s, int(lp[1] * SR / r) - s)
                else:
                    loop = steady(mono(x))
                if loop:
                    # (at most 1.5 s long, so the loop fits a few times in the note's last seconds)
                    end = min(loop[1], cap - int(3 * SR))
                    loop = (max(loop[0], end - int(1.5 * SR)), end)
                if loop and loop[0] > int(XFADE * SR) and loop[1] - loop[0] >= int(0.6 * SR):
                    x = each(x[:, : loop[1] + int(XFADE * SR)], lambda ch: extend(ch, loop, SR / hz, cap))
                    seam = seamless_loop(loop, SR / hz, cap)
                    if seam:
                        loops[(midi, layer, t)] = seam
                elif x.shape[1] < cap + int(0.5 * SR):
                    print(f"   no steady part to loop in {f['file']}")
            sounds[(midi, layer, t)] = x[:, :cap]
    if st['tail']:
        if st['tail'] == 'faded':
            rates = {}
            for k, v in sounds.items():
                sounds[k], rates[k] = unfade(v)
        else:
            rates = {k: decay_rate(mono(v)) for k, v in sounds.items()}
        known = [(k[0], r) for k, r in rates.items() if r is not None and r < 0 and sounds[k].shape[1] > 0.8 * SR]
        fit = np.polyfit([m for m, _ in known], [r for _, r in known], 1) if len(known) >= 3 else None
        for k, v in sounds.items():
            r = rates[k] if rates[k] is not None and rates[k] < 0 and v.shape[1] > 0.8 * SR else (float(np.polyval(fit, k[0])) if fit is not None else -10.0)
            sounds[k] = natural_tail(v, k[0], float(np.clip(r, -60, -1)), cap)
        if os.environ.get('SHOW_TAIL'):
            print('   ', ' '.join(f"{NAMES[k[0] % 12]}{k[0] // 12 - 1}_{k[1]}:{(rates[k] or 0):.0f}dB/s" for k in sorted(rates)))
    # How loud each note is at full velocity: its loudest recording, or, when a note has only
    # softer ones, those raised by the gap between the loudnesses on the set's other notes (a
    # library's softest takes can be 30 dB under its loudest)
    lvl = {(midi, layer): float(np.mean([level(mono(sounds[(midi, layer, t)]), kind['level']) for t in range(len(takes))]))
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
    # Even out notes far louder or quieter than their neighbours (not a drum kit's pieces: a kick
    # and a hi-hat keep the levels they were recorded at)
    if st['even'] and len(notes) >= 4:
        fit = np.polyval(np.polyfit(notes, [lv[m] for m in notes], 2), notes)
        trim = {m: float(np.clip(fv - lv[m], -9, 9)) for m, fv in zip(notes, fit)}
        if os.environ.get('SHOW_TRIM'):
            print('   ', ' '.join(f'{NAMES[m % 12]}{m // 12 - 1}:{lv[m]:.0f}{trim[m]:+.1f}' for m in notes))
    else:
        trim = {m: 0.0 for m in notes}
    # Fill the grid: every note at every layer and take, each layer at its step under the loudest.
    # A sparse set leaves out a loudness a nearby note has (the app stretches that one), and plays
    # the same note's nearest loudness's file for one nobody near has, rather than copying it
    out = {}
    out_loops = {}
    shared = {}
    for midi in notes:
        for layer in range(nlayers):
            have = [l for (m, l) in recs if m == midi]
            src = min(have, key=lambda l: (abs(l - layer), -l))
            if st['sparse'] and src != layer:
                if any((m, layer) in recs and abs(m - midi) <= STRETCH for m in notes):
                    for t in range(ntakes):
                        shared[f'{midi}_{layer}_{t}'] = None
                else:
                    for t in range(ntakes):
                        shared[f'{midi}_{layer}_{t}'] = f'{midi}_{src}_{t}'
                continue
            for t in range(ntakes):
                x = sounds[(midi, src, t % len(recs[(midi, src)]))]
                if (midi, src, t % len(recs[(midi, src)])) in loops:
                    out_loops[f'{midi}_{layer}_{t}'] = [round(v, 5) for v in loops[(midi, src, t % len(recs[(midi, src)]))]]
                target = lv[midi] + trim[midi] + offsets(nlayers)[layer]
                out[(midi, layer, t)] = x * 10 ** ((target - level(mono(x), kind['level'])) / 20)
    if nlayers > 1:
        # (a recording moved to line up takes its loop with it)
        for (midi, layer, t), lag in align_layers(out, notes, nlayers, ntakes, st['pitched']).items():
            key = f'{midi}_{layer}_{t}'
            if lag and key in out_loops:
                out_loops[key] = [round(v + lag / SR, 5) for v in out_loops[key]]
        match_layers(out, notes, nlayers, ntakes, kind['level'], st['steady'])
    gain = 0.89 / max(np.abs(x).max() for x in out.values())
    folder = os.path.join(root, 'public', 'fledgetone-samples', st['folder'])
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith('.mp3'):
            os.remove(os.path.join(folder, old))
    for (midi, layer, t), x in out.items():
        y = x * gain
        fade = int(0.25 * SR) if y.shape[1] >= cap - 1 else int(0.03 * SR)
        y[:, -fade:] *= np.linspace(1, 0, fade) ** 2
        y[:, : int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        name = f'{NAMES[midi % 12]}{midi // 12 - 1}_{layer}_{t}.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', str(y.shape[0]), '-i', '-', '-codec:a', 'libmp3lame', '-q:a', '4',
                        os.path.join(folder, name)], input=y.T.astype('<f8').tobytes(), check=True)
    size = sum(os.path.getsize(os.path.join(folder, n)) for n in os.listdir(folder))
    if scooped:
        print(f"   bent onto pitch at the start (cents): {' '.join(sorted(set(scooped)))}")
    print(f"{st['folder']:20s} {len(notes):3d} notes x {nlayers} layers x {ntakes} takes, "
          f"evened {max(abs(v) for v in trim.values()):.1f} dB at most, gain {20 * np.log10(gain):+.1f} dB, {size / 1e6:.1f} MB")
    return {'notes': notes, 'layers': nlayers, 'takes': ntakes, 'loops': out_loops, **({'shared': shared} if shared else {})}


def write_index(root, done):
    """src/audio/hostedSets.ts: each hosted set's notes, loudness layers, takes, size and fingerprint."""
    import hashlib
    path = os.path.join(root, 'src', 'audio', 'hostedSets.ts')
    sets = {}
    if os.path.exists(path):
        for m in re.finditer(r"'([a-z0-9-]+)': \{ notes: \[([0-9, ]+)\], layers: (\d+), takes: (\d+)", open(path).read()):
            sets[m.group(1)] = {'notes': [int(n) for n in m.group(2).split(',')], 'layers': int(m.group(3)), 'takes': int(m.group(4))}
        for line in open(path).read().splitlines():
            m = re.match(r"  '([a-z0-9-]+)': .* loops: (\{.*?\})(?:, shared: .*)? \},$", line)
            if m and m.group(1) in sets:
                sets[m.group(1)]['loops'] = json.loads(re.sub(r"'", '"', m.group(2)))
            m = re.match(r"  '([a-z0-9-]+)': .* shared: (\{.*\}) \},$", line)
            if m and m.group(1) in sets:
                sets[m.group(1)]['shared'] = json.loads(re.sub(r"'", '"', m.group(2)))
    sets.update(done)
    # Size and a fingerprint of the files as they are now (the app keeps downloaded recordings, and
    # a changed fingerprint makes it download a re-made set again)
    for k, v in sets.items():
        folder = os.path.join(root, 'public', 'fledgetone-samples', k)
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
        ' * The recordings hosted with the app, set by set (public/fledgetone-samples/<set>/): the MIDI',
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
        '  /**',
        '   * Held notes: the stretch of each file ("<midi>_<layer>_<take>") that repeats seamlessly, in',
        '   * seconds, so a note can be held for as long as its key is',
        '   */',
        '  loops?: Record<string, [number, number]>;',
        '  /**',
        '   * Recordings ("<midi>_<layer>_<take>") with no file of their own: another\'s file it plays,',
        '   * or null for none (a nearby note\'s recording at that loudness is stretched instead)',
        '   */',
        '  shared?: Record<string, string | null>;',
        '}',
        '',
        'export const HOSTED_SETS: Record<string, HostedSet> = {',
    ]
    for k in sorted(sets):
        v = sets[k]
        loops = v.get('loops') or {}
        tail = (', loops: {' + ', '.join(f"'{n}': [{a}, {b}]" for n, (a, b) in sorted(loops.items())) + '}') if loops else ''
        shared = v.get('shared') or {}
        if shared:
            tail += ', shared: {' + ', '.join(f"'{n}': " + (f"'{to}'" if to else 'null') for n, to in sorted(shared.items())) + '}'
        lines.append(f"  '{k}': {{ notes: [{', '.join(map(str, v['notes']))}], layers: {v['layers']}, takes: {v['takes']}, bytes: {v['bytes']}, hash: '{v['hash']}'{tail} }},")
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
