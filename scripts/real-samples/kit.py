# Mix a drum kit's recordings (sets.py, KITS) into dl/<set>/ with dl/<set>/plan.json, as fetch.py
# leaves a set's downloads, ready for measure.py and convert.py. Run from the same working folder:
#   python3 kit.py studio-kit
#
# A multi-microphone kit library records every hit at once on several microphones: the drum's own
# close microphone(s) and a stereo pair of overheads over the whole kit. Each hit (piece, velocity
# layer, round robin) becomes one stereo file: its close microphones, placed in the stereo picture
# where the overheads hear that piece, summed with the overheads. A second close microphone facing
# the other way (a snare's bottom head) is flipped if it is out of polarity with the first.
#
# The overheads are the reference: they hear the whole kit at one gain, so how loud each piece is
# against the others comes from them. Each close microphone is set (on the piece's loudest hits)
# to KITS' dB against the overheads' level of the same hits, and that gain is kept for all of the
# piece's hits, so its dynamics stay as played; convert.py (even=False) leaves the pieces' levels
# alone after that. A piece's optional trim (dB) moves its whole mix, for a library whose
# overheads hear one piece far quieter than a player would want it against the rest (a kick
# heard from above, a cymbal swept with brushes).
#
# Of a piece's velocity layers, four spread over the louder two thirds (the softest are whispers);
# of its round robins, the first two. A piece is given as its files' path with {mic}, {layer} and
# {take} in it, so any library's layout reads the same; a kit's `stereo` microphones (its
# overheads, and a room pair) are added as recorded rather than panned, and overheads recorded as
# two mono files (ohl, ohr) are read as one pair.
import os, re, sys, json, math, subprocess, urllib.request, urllib.parse, concurrent.futures as cf
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, REPOS, KITS
from fetch import listing, RAW, get

SR = 44100
SPREAD = (0.3, 0.5, 0.8, 1.0)  # where the kept layers sit among a piece's layers, softest to loudest


def load(p):
    """(channels, samples) at SR."""
    ch = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', p],
                            capture_output=True, text=True, check=True).stdout.strip())
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, ch).T.copy()


def pattern_of(template):
    """A piece's file template ({mic}, {Mic} capitalised, {layer} and {take} numbers) as a regex."""
    rx = re.escape(template)
    for k, v in (('mic', r'(?P<mic>[^/]+?)'), ('Mic', r'(?P<Mic>[^/]+?)'), ('layer', r'(?P<layer>\d+(?:_\d+)?)'), ('take', r'(?P<take>\d+)')):
        rx = rx.replace(re.escape('{' + k + '}'), v, 1).replace(re.escape('{' + k + '}'), f'(?P={k})')
    return re.compile(rx)


def path_of(template, mic, layer, take):
    return template.format(mic=mic, Mic=mic.capitalize(), layer=layer, take=take)


def num(token):
    return int(token.split('_')[0])


def hits_of(files, template, mic, n, takes):
    """
    The (layer, take) recordings to mix of a piece, as n loudnesses of `takes` takes each, softest
    first: the loudnesses spread over the louder two thirds of the piece's (all of them when it has
    at most n, the loudest repeated when it has fewer); its first takes, or, when it was recorded
    once a loudness, the next softer loudness as the second take.
    """
    rx = pattern_of(template)
    found = {}
    for p in files:
        m = rx.fullmatch(p)
        if m and m.groupdict().get('mic', mic) == mic:
            # (a piece played at one loudness has no {layer})
            found.setdefault(m.groupdict().get('layer', '1'), set()).add(m.groupdict().get('take'))
    vls = sorted(found, key=num)
    if not vls:
        return []
    if len(vls) > n:
        keep = []
        for q in SPREAD:
            v = vls[max(0, math.ceil(len(vls) * q) - 1)]
            if v not in keep:
                keep.append(v)
    else:
        keep = [vls[min(len(vls) - 1, i * len(vls) // n)] for i in range(n)]
    out = []
    for layer, vl in enumerate(keep):
        own = sorted((t for t in found[vl] if t is not None), key=int)
        if len(own) >= takes:
            out += [(layer, vl, t) for t in own[:takes]]
        else:
            i = vls.index(vl)
            near = [vls[j] for j in (i, i - 1, i + 1, i - 2) if 0 <= j < len(vls)][:takes]
            near += [vl] * (takes - len(near))
            out += [(layer, v, (sorted(found[v] - {None}, key=int) or [None])[0]) for v in near]
    return out


def place(oh):
    """Where the overheads hear a piece, -1 (right) .. 1 (left), from their two channels' energy."""
    e = (oh[:, : int(0.1 * SR)] ** 2).sum(axis=1)
    return float((e[0] - e[1]) / (e[0] + e[1] + 1e-20))


def power_db(x):
    """A recording's level over its first half second, dB (channels averaged)."""
    return 10 * math.log10(float(np.mean(x[:, : int(0.5 * SR)] ** 2)) + 1e-20)


def calibrate(loaded, gains):
    """Each microphone's linear gain: close ones at gains[m] dB against the overheads, on the loudest hits."""
    top = max(h[0] for h in loaded)
    loud = [h[-1] for h in loaded if h[0] == top]
    if 'oh' not in gains:
        return {m: 10 ** (gains[m] / 20) for m in gains}
    oh = np.mean([power_db(x['oh']) for x in loud])
    return {m: 1.0 if m == 'oh' else 10 ** ((oh + gains[m] - np.mean([power_db(x[m]) for x in loud])) / 20) for m in gains}


def mix(hits, gains, pan, stereo=('oh',)):
    """One hit's microphones (name -> (channels, samples)) as one stereo recording; gains are linear."""
    n = max(x.shape[1] for x in hits.values())
    out = np.zeros((2, n))
    closes = [m for m in gains if m not in stereo]
    first = None
    for m in closes:
        x = hits[m].mean(axis=0)
        if first is None:
            first = x
        else:
            # Facing the other way, a second close microphone can be out of polarity with the first
            a = int(0.05 * SR)
            k = min(len(first), len(x), a)
            if np.sum((first[:k] + x[:k]) ** 2) < np.sum((first[:k] - x[:k]) ** 2):
                x = -x
        # Constant-power panning, toward the piece's place but never fully to one side
        theta = (1 - 0.7 * pan) * math.pi / 4
        g = gains[m]
        out[0, : len(x)] += x * g * math.cos(theta)
        out[1, : len(x)] += x * g * math.sin(theta)
    for m in gains:
        if m not in stereo:
            continue
        x = hits[m]
        if x.shape[0] == 1:
            x = np.vstack([x, x])
        out[:, : x.shape[1]] += x * gains[m]
    return out


def main(names):
    for st in SETS:
        if not st['kit'] or (names and st['folder'] not in names):
            continue
        kit = KITS[st['kit']]
        head, files = listing(kit['repo'])
        d = os.path.join('dl', st['folder'])
        raw = os.path.join('dl', st['folder'] + '.raw')
        os.makedirs(d, exist_ok=True)
        os.makedirs(raw, exist_ok=True)
        keep_len = int((st['cap'] + 0.5) * SR)
        plan = []
        stereo = kit.get('stereo', ('oh',))
        for midi, template, gains, *trim in kit['pieces']:
            first_mic = next((m for m in gains if m != 'oh'), 'oh')
            jobs, hits = [], []
            for layer, vl, rr in hits_of(files, template, first_mic, kit['layers'], kit['takes']):
                paths = {}
                for m in gains:
                    p = path_of(template, m, vl, rr)
                    # Overheads recorded as two mono files, left and right
                    paths[m] = p if p in files or m != 'oh' else (path_of(template, 'ohl', vl, rr), path_of(template, 'ohr', vl, rr))
                flat = [q for p in paths.values() for q in (p if isinstance(p, tuple) else (p,))]
                if not all(q in files for q in flat):
                    print('  missing', [q for q in flat if q not in files][:2])
                    continue
                for q in flat:
                    jobs.append((RAW + REPOS[kit['repo']] + '/' + head + '/' + urllib.parse.quote(q), os.path.join(raw, q.replace('/', '__'))))
                name = f"{midi}_{vl}_{rr or 0}"
                hits.append((layer, vl, rr, name, paths))
            with cf.ThreadPoolExecutor(12) as ex:
                errs = [e for e in ex.map(get, jobs) if e]
            if errs:
                print('  errors:', *errs[:10], sep='\n   ')

            def take(p):
                if isinstance(p, tuple):
                    l, r = (load(os.path.join(raw, q.replace('/', '__'))).mean(axis=0) for q in p)
                    k = min(len(l), len(r))
                    return np.vstack([l[:k], r[:k]])[:, :keep_len]
                return load(os.path.join(raw, p.replace('/', '__')))[:, :keep_len]
            loaded = [(layer, vl, rr, name, paths, {m: take(p) for m, p in paths.items()}) for layer, vl, rr, name, paths in hits]
            pan = float(np.mean([place(x['oh']) for *_, x in loaded])) if 'oh' in gains else 0.0
            lin = calibrate(loaded, gains)
            for layer, vl, rr, name, paths, x in loaded:
                y = mix(x, lin, pan, stereo) * 10 ** ((trim[0] if trim else 0) / 20)
                file = f'{name}.wav'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f64le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'pcm_f32le', os.path.join(d, file)],
                               input=y.T.astype('<f8').tobytes(), check=True)
                plan.append({'path': template.replace('{mic}', '{' + ','.join(gains) + '}'), 'nominal': midi, 'layer': layer,
                             'take': f'{vl}/{rr}', 'src': 0, 'file': file})
            print(f"{st['folder']:12s} {midi:3d} {template[-48:]:48s} {len(loaded)} hits (layers {', '.join(sorted({h[1] for h in hits}, key=num))}), placed {pan:+.2f}, "
                  f"mics {' '.join(f'{m} {20 * math.log10(g):+.1f} dB' for m, g in lin.items() if m != 'oh')}")
        json.dump({'repo': REPOS[kit['repo']], 'commit': head, 'files': plan}, open(os.path.join(d, 'plan.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
