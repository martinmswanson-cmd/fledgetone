# Each recording's level and the set's tuning, measured from the hosted files, into
# src/audio/samplers/setLevels.ts: for the sets whose notes were recorded at uneven levels (the
# grand piano's neighbouring notes differed by up to 9 dB) or a few cents sharp, which the app
# evens out and retunes as they load (see evenLevels in setLevels.ts and instrumentCatalog.ts).
#
#   python3 scripts/real-samples/levels.py
#
# A recording's level: its power over both channels for the first second from its onset, dB. The
# set's tuning: the median, over the notes from C3 to C6 (where the fundamental is strong and the
# strings barely stretched), of how many cents the fundamental sits from equal temperament.
import os, re, json, subprocess
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SAMPLES = os.path.join(ROOT, 'public', 'fledgetone-samples')
OUT = os.path.join(ROOT, 'src', 'audio', 'samplers', 'setLevels.ts')
SETS = ['grand-piano']
SR = 48000
NOTES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', p, '-ar', str(SR), '-ac', '2', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, 2)


def onset(x):
    a = np.abs(x).max(axis=1)
    return int(np.argmax(a > a.max() * 0.01))


def level(x):
    s = onset(x)
    seg = x[s: s + SR]
    return 10 * np.log10(np.mean(seg ** 2) + 1e-20)


def cents(x, midi):
    """How far the fundamental sits from equal temperament (cents), from 0.1 s after the onset."""
    m = x.mean(axis=1)
    s = onset(x) + int(0.1 * SR)
    seg = m[s: s + int(1.5 * SR)]
    if len(seg) < SR // 2:
        return None
    seg = seg * np.hanning(len(seg))
    f = 440 * 2 ** ((midi - 69) / 12)
    t = np.arange(len(seg)) / SR
    grid = np.arange(-30, 30.01, 0.25)
    power = [abs(np.sum(seg * np.exp(-2j * np.pi * f * 2 ** (c / 1200) * t))) for c in grid]
    return float(grid[int(np.argmax(power))])


def midi_of(name):
    m = re.match(r'^([A-G])(s?)(-?\d)$', name)
    return 12 * (int(m.group(3)) + 1) + NOTES[m.group(1)] + (1 if m.group(2) else 0)


def main():
    out = {}
    for folder in SETS:
        levels, tunings = {}, []
        for f in sorted(os.listdir(os.path.join(SAMPLES, folder))):
            m = re.match(r'^(.+)_(\d+)_(\d+)\.mp3$', f)
            if not m:
                continue
            x = load(os.path.join(SAMPLES, folder, f))
            midi = midi_of(m.group(1))
            levels[f'{midi}_{m.group(2)}_{m.group(3)}'] = round(level(x), 2)
            if 48 <= midi <= 84:
                c = cents(x, midi)
                if c is not None:
                    tunings.append(c)
        out[folder] = {'cents': round(float(np.median(tunings)), 2), 'levels': levels}
        print(folder, len(levels), 'recordings, tuning', out[folder]['cents'], 'cents')
    body = ',\n'.join(f"  '{k}': {{ cents: {v['cents']}, levels: {json.dumps(v['levels'], separators=(',', ':'))} }}" for k, v in out.items())
    with open(OUT, 'w') as fh:
        fh.write(HEAD + 'export const SET_LEVELS: Record<string, SetLevels> = {\n' + body + ',\n};\n' + TAIL)


HEAD = '''/**
 * Recordings made at uneven levels, or a few cents sharp, evened out and retuned as they load: each
 * recording's level ("<midi>_<layer>_<take>": its power over the first second, dB) and the set's
 * tuning (cents off equal temperament) as scripts/real-samples/levels.py measured them, and
 * evenLevels, the gains that bring each loudness's notes onto a smooth curve across the keyboard.
 * The levels are generated (don't edit them by hand); evenLevels is pure, so Node can test it.
 */

/** A set's measured levels and tuning. */
export interface SetLevels {
  cents: number;
  levels: Record<string, number>;
}

'''

TAIL = '''
/** How far either side (semitones) the notes a recording's level is smoothed against reach. */
export const EVEN_REACH = 7;
/** The most a recording is raised or lowered by (dB): an odd one is evened out, never made over. */
export const EVEN_MOST_DB = 9;

/**
 * The gain (dB) for each of a set's recordings ("<midi>_<layer>_<take>") that brings it onto its
 * loudness's smooth curve across the keyboard: each loudness and take's levels smoothed with a
 * triangle EVEN_REACH semitones either side (twice, so one odd note barely moves its neighbours'
 * curve), less its own level. The curve keeps the keyboard's shape (a piano is quieter at the
 * top) and each loudness's own level; only the note-to-note jumps go.
 */
export function evenLevels(levels: Record<string, number>, reach = EVEN_REACH, most = EVEN_MOST_DB): Record<string, number> {
  const rows = new Map<string, Array<[number, number]>>();
  for (const [key, db] of Object.entries(levels)) {
    const [midi, layer, take] = key.split('_').map(Number);
    const row = `${layer}_${take}`;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push([midi, db]);
  }
  const smooth = (points: Array<[number, number]>): Array<[number, number]> =>
    points.map(([m]) => {
      let sum = 0;
      let weights = 0;
      for (const [n, db] of points) {
        const w = Math.max(0, reach + 1 - Math.abs(n - m));
        sum += w * db;
        weights += w;
      }
      return [m, sum / weights];
    });
  const out: Record<string, number> = {};
  for (const [row, points] of rows) {
    const curve = new Map(smooth(smooth(points)));
    for (const [m, db] of points) out[`${m}_${row}`] = Math.max(-most, Math.min(most, curve.get(m)! - db));
  }
  return out;
}
'''

if __name__ == '__main__':
    main()
