/**
 * Groove from audio: where the hits of a recording land against the bar grid, measured per part
 * (kick, snare or clap, hats, percussion, bass, chords or keys, lead) and turned into a groove
 * (grooveFeels.ts): for each of the 16 steps of a bar, how early or late that part plays (a share
 * of a 16th note) and how hard. How it measures:
 *   - each part listens to its own band (the kick under 110 Hz, the hats over 8 kHz, ...), split
 *     out by zero-phase filters so no band is delayed against another;
 *   - a hit is a fast rise of the band's level; its time is where the rise crosses half way from
 *     the level before it to its peak, found to a fraction of a sample, so timing is far finer than
 *     a millisecond;
 *   - the grid is fitted to the kicks (or the loudest low hits) on the beats, so a recording a hair
 *     faster or slower than its stated tempo still lines up, and the kick's beats are the zero;
 *   - per step, only what is clear is kept: the median of every bar's hit there, kept only when
 *     enough bars have one and the median stands out of its own spread; anything else plays on the
 *     grid at an even velocity.
 * The same code measured the built-in grooves from reference recordings (numbers only). Pure maths
 * on sample arrays, so Node tests it and a Worker runs it in the app.
 */
import type { GrooveMap, GrooveRole } from '../store/grooveFeels';

/** A band of frequencies, in Hz (lo 0: no low cut; hi 0: no high cut). */
export interface Band {
  lo: number;
  hi: number;
}

/** One detected hit: its time (seconds) and its band's peak level just after (dB). */
export interface Onset {
  t: number;
  level: number;
}

/** Where each part listens, and how much quieter than its loudest hits a hit may be. */
export interface RoleBand extends Band {
  /** How much quieter than the band's loud hits a hit may be (dB) */
  range: number;
  /** The rise (dB within 12 ms) that makes a hit */
  rise: number;
  /** Hits closer than this are one (ms) */
  gap: number;
  /** Timed in this band instead (see detectOnsets) */
  timeIn?: Band;
}

export const ROLE_BANDS: Record<GrooveRole, RoleBand> = {
  kick: { lo: 30, hi: 110, range: 8, rise: 10, gap: 90, timeIn: { lo: 30, hi: 0 } },
  snare: { lo: 1200, hi: 5000, range: 9, rise: 8, gap: 90 },
  hats: { lo: 8000, hi: 16000, range: 15, rise: 6, gap: 45 },
  perc: { lo: 3000, hi: 7000, range: 12, rise: 6, gap: 45 },
  bass: { lo: 60, hi: 250, range: 15, rise: 6, gap: 45 },
  chords: { lo: 250, hi: 1000, range: 15, rise: 6, gap: 45 },
  lead: { lo: 1000, hi: 4000, range: 15, rise: 6, gap: 45 },
};
/** Where between the level before a hit and its peak the hit's time is taken (0.2: a fifth of the way up). */
export let CROSS = 0.2;
export const setCross = (c: number) => void (CROSS = c);
/** Overrides for trying settings (the measuring script). */
export function setRoleBand(role: GrooveRole, b: Partial<RoleBand>): void {
  Object.assign(ROLE_BANDS[role], b);
}

/** Parts that only count hits that aren't another part's (the bass's hits that aren't kicks, ...). */
const EXCLUDE: Partial<Record<GrooveRole, GrooveRole[]>> = {
  bass: ['kick'],
  chords: ['kick', 'snare'],
  lead: ['snare', 'hats'],
  perc: ['snare', 'hats'],
};

/** Butterworth low or high pass (RBJ biquad, Q 1/sqrt 2), run forward then backward: zero phase. */
function biquad(x: Float32Array, sr: number, f: number, type: 'lp' | 'hp'): Float32Array {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (type === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b1 = (type === 'lp' ? 1 - cos : -(1 + cos)) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  const run = (from: Float32Array, to: Float32Array, reverse: boolean) => {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const n = from.length;
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k;
      const v = from[i];
      const out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = out;
      to[i] = out;
    }
  };
  run(x, y, false);
  run(y, y, true);
  return y;
}

/** `x` through a band: zero-phase, 4th order each side. */
export function bandPass(x: Float32Array, sr: number, band: Band): Float32Array {
  let y = x;
  if (band.lo > 0) y = biquad(y, sr, band.lo, 'hp');
  if (band.hi > 0 && band.hi < sr / 2) y = biquad(y, sr, band.hi, 'lp');
  return y === x ? Float32Array.from(x) : y;
}

/** The amplitude envelope: squared, smoothed both ways (tau `ms`), square-rooted. */
export function envelope(x: Float32Array, sr: number, ms = 0.7): Float32Array {
  const a = Math.exp(-1000 / (ms * sr));
  const e = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) e[i] = s = a * s + (1 - a) * x[i] * x[i];
  s = 0;
  for (let i = x.length - 1; i >= 0; i--) e[i] = s = a * s + (1 - a) * e[i];
  for (let i = 0; i < e.length; i++) e[i] = Math.sqrt(e[i]);
  return e;
}

const db = (v: number) => 20 * Math.log10(v + 1e-9);

function percentile(values: ArrayLike<number>, p: number): number {
  const s = Array.from(values).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Where `env` crosses `cross` of the way from its lowest point in [from, peak) up to its peak, going back from the peak (fractional sample). */
function crossing(env: Float32Array, from: number, peak: number, cross: number): number {
  let lowI = Math.max(0, from);
  let low = Infinity;
  for (let i = lowI; i < peak; i++) if (env[i] < low) [low, lowI] = [env[i], i];
  const level = low + cross * (env[peak] - low);
  let i = peak;
  while (i > lowI && env[i - 1] > level) i--;
  const frac = i > 0 && env[i] !== env[i - 1] ? (level - env[i - 1]) / (env[i] - env[i - 1]) : 0;
  return i - 1 + Math.max(0, Math.min(1, frac));
}

/** Per-millisecond peak levels (dB) of an envelope. */
function msLevels(env: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(env.length / hop);
  const lv = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let m = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) m = Math.max(m, env[i]);
    lv[f] = db(m);
  }
  return lv;
}

/**
 * The hits in one band. A hit is a rise of at least `rise` dB within 12 ms; hits closer than
 * `gapMs` are one. Each hit's time is where the envelope crosses `cross` of the way from the level
 * before the rise to the peak after it (linearly interpolated between samples). With `timeIn`, the
 * time is taken from that band instead, at its sharpest rise up to 45 ms before the band's own
 * (a kick: found by its low end, which swells late as its pitch falls, timed by its click).
 */
export function detectOnsets(x: Float32Array, sr: number, band: Band, opts: { rise?: number; gapMs?: number; range?: number; cross?: number; timeIn?: Band } = {}): Onset[] {
  const rise = opts.rise ?? 6;
  const cross = opts.cross ?? CROSS;
  const gap = ((opts.gapMs ?? 45) * sr) / 1000;
  const env = envelope(bandPass(x, sr, band), sr);
  const hop = Math.max(1, Math.round(sr / 1000));
  const lv = msLevels(env, hop);
  const frames = lv.length;
  const tEnv = opts.timeIn ? envelope(bandPass(x, sr, opts.timeIn), sr) : null;
  const tLv = tEnv ? msLevels(tEnv, hop) : null;
  const top = percentile(lv, 99);
  const floor = top - (opts.range ?? 15) - 12;
  const out: Onset[] = [];
  let lastAt = -Infinity;
  for (let f = 13; f < frames - 31; f++) {
    // The level 12 ms back, and the rise from it
    let before = Infinity;
    for (let k = f - 12; k < f; k++) before = Math.min(before, lv[k]);
    if (lv[f] - before < rise || lv[f] < floor) continue;
    // The rise's peak within 30 ms
    let peakF = f;
    for (let k = f; k < f + 30; k++) if (lv[k] > lv[peakF]) peakF = k;
    if (lv[peakF] < floor + 6) continue;
    let at: number;
    if (tEnv && tLv) {
      // The sharpest 5 ms rise of the timing band from 45 ms before to 3 ms after
      let best = -Infinity;
      let bestF = f;
      for (let k = Math.max(6, f - 45); k <= Math.min(tLv.length - 8, f + 3); k++) {
        const r = tLv[k] - Math.min(tLv[k - 5], tLv[k - 6]);
        if (r > best) [best, bestF] = [r, k];
      }
      let pk = bestF * hop;
      for (let i = (bestF - 1) * hop; i < (bestF + 6) * hop; i++) if (tEnv[i] > tEnv[pk]) pk = i;
      at = crossing(tEnv, (bestF - 8) * hop, pk, cross);
    } else {
      let peakI = peakF * hop;
      for (let i = (f - 2) * hop; i < (peakF + 1) * hop; i++) if (env[i] > env[peakI]) peakI = i;
      at = crossing(env, (f - 15) * hop, peakI, cross);
    }
    if (at - lastAt < gap) {
      // (The louder of two close hits wins)
      if (out.length && lv[peakF] > out[out.length - 1].level) out[out.length - 1] = { t: at / sr, level: lv[peakF] };
      f = peakF;
      continue;
    }
    out.push({ t: at / sr, level: lv[peakF] });
    lastAt = at;
    f = peakF;
  }
  // Only hits within `range` dB of the band's loud ones
  const loud = percentile(out.map((o) => o.level), 90);
  return out.filter((o) => o.level >= loud - (opts.range ?? 15));
}

/** A bar grid: the tempo and where a bar starts (seconds), 4 beats a bar. */
export interface Grid {
  bpm: number;
  barStart: number;
}

/**
 * The grid fitted to the drum hits: a least-squares line through (16th number, time) of the hits
 * within a fifth of a 16th of the guessed grid, three times, each time without the hits more than
 * 3 spreads off. Keeps the bar's phase (which 16th is one) from `guess`. Falls back to `guess`
 * with under 8 hits near the grid.
 */
export function fitGrid(times: readonly number[], guess: Grid): Grid {
  let { bpm, barStart } = guess;
  for (let pass = 0; pass < 3; pass++) {
    const six = 15 / bpm;
    const pts = times
      .map((t) => {
        const p = (t - barStart) / six;
        return { k: Math.round(p), t, r: p - Math.round(p) };
      })
      .filter((p) => Math.abs(p.r) < 0.2);
    if (pts.length < 8) return { bpm, barStart };
    const mr = median(pts.map((p) => p.r));
    const mad = median(pts.map((p) => Math.abs(p.r - mr))) * 1.4826 || 0.01;
    const keep = pass ? pts.filter((p) => Math.abs(p.r - mr) < Math.max(0.02, 3 * mad)) : pts;
    const n = keep.length;
    const mk = keep.reduce((s, p) => s + p.k, 0) / n;
    const mt = keep.reduce((s, p) => s + p.t, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of keep) {
      sxy += (p.k - mk) * (p.t - mt);
      sxx += (p.k - mk) ** 2;
    }
    if (sxx <= 0) return { bpm, barStart };
    const slope = sxy / sxx;
    bpm = 15 / slope;
    barStart = mt - slope * mk;
  }
  return { bpm, barStart };
}

/** What one step of the bar held over every bar measured. */
export interface StepStat {
  /** Bars with a hit on this step */
  n: number;
  /** Median offset, a share of a 16th (late +) */
  offset: number;
  /** Spread of the offsets (1.4826 x the median absolute deviation), a share of a 16th */
  spread: number;
  /** Median level of the hits here relative to the part's median hit (dB) */
  level: number;
}

/**
 * Each onset's bar, step (0-15) and offset from the step (a share of a 16th), dropping the ones
 * between steps; of two in the same bar and step, the louder.
 */
export function stepsOf(onsets: readonly Onset[], grid: Grid, maxOff = 0.42): Array<{ step: number; bar: number; offset: number; level: number }> {
  const six = 15 / grid.bpm;
  const at = new Map<number, { step: number; bar: number; offset: number; level: number }>();
  for (const o of onsets) {
    const pos = (o.t - grid.barStart) / six;
    const k = Math.round(pos);
    const off = pos - k;
    if (Math.abs(off) > maxOff) continue;
    const prev = at.get(k);
    if (!prev || o.level > prev.level) at.set(k, { step: ((k % 16) + 16) % 16, bar: Math.floor(k / 16), offset: off, level: o.level });
  }
  return [...at.values()];
}

type StepHit = ReturnType<typeof stepsOf>[number];

/** The statistics of some hits, levels against `all` (dB). */
function statOf(here: readonly StepHit[], all: number): StepStat {
  if (!here.length) return { n: 0, offset: 0, spread: 0, level: 0 };
  const offs = here.map((h) => h.offset);
  const m = median(offs);
  return { n: here.length, offset: m, spread: 1.4826 * median(offs.map((o) => Math.abs(o - m))), level: median(here.map((h) => h.level)) - all };
}

/** The 16 steps' statistics of one part's hits. */
export function stepStats(onsets: readonly Onset[], grid: Grid): StepStat[] {
  const hits = stepsOf(onsets, grid);
  const all = median(hits.map((h) => h.level));
  return Array.from({ length: 16 }, (_, s) => statOf(hits.filter((h) => h.step === s), all));
}

/** A step's hits are one clear cluster: spread under this share of a 16th. */
export const CLEAR_SPREAD = 0.08;
/** Further off than this (a share of a 16th), a step's hits belong to another grid: not a push or a drag of this one. */
export const MAX_FEEL_OFFSET = 0.36;
/** Melodic parts: their hits are read where their level rises, which a duck under the kick moves late. */
const MELODIC = new Set<GrooveRole>(['bass', 'chords', 'lead']);

/** An offset that's clear in `s` (0: clearly on the grid), or undefined (not clear). */
function clearOffset(s: StepStat, minN: number, max = MAX_FEEL_OFFSET): number | undefined {
  if (s.n < minN || s.spread > CLEAR_SPREAD) return undefined;
  const se = (1.2533 * Math.max(s.spread, 0.005)) / Math.sqrt(s.n);
  if (Math.abs(s.offset) < Math.max(2 * se, 0.015)) return 0;
  return Math.abs(s.offset) > max ? undefined : s.offset;
}
/** A melodic part's hits are softer-edged: past a quarter of a 16th they're as near the next line as this one. */
const MAX_MELODIC_OFFSET = 0.25;

/**
 * Only what's clear. A step's offset is kept when at least `minN` bars hit it, its hits cluster
 * (spread under CLEAR_SPREAD), it stands out of that spread (over twice the median's standard
 * error, and over 1.5% of a 16th) and it isn't on another grid (MAX_FEEL_OFFSET). A step that
 * isn't clear alone (but is played on, in at least two bars) takes the same position of the beat
 * pooled over the bar's four beats (every "e" of a swung beat swings), if that's clear (a melodic part: within a quarter of a 16th). A step's velocity: its hits' median level against
 * the part's, when over 1 dB (pooled the same way), 0.7 to 1.15. The kick's timing is the grid
 * (the zero everything is measured from), its velocities count. A melodic part's late hit on a
 * kick's step is left out (the duck under the kick letting go, not the note). Everything else
 * plays on the grid at velocity 1; undefined when nothing is kept.
 */
export function grooveMapOf(onsets: readonly Onset[], grid: Grid, minN: number, role: GrooveRole, kickSteps: ReadonlySet<number> = new Set()): GrooveMap | undefined {
  const hits = stepsOf(onsets, grid);
  const all = median(hits.map((h) => h.level));
  const own = Array.from({ length: 16 }, (_, s) => statOf(hits.filter((h) => h.step === s), all));
  const pooled = Array.from({ length: 4 }, (_, p) => statOf(hits.filter((h) => h.step % 4 === p), all));
  let kept = 0;
  const t = own.map((st, s) => {
    if (role === 'kick') return 0;
    const max = MELODIC.has(role) ? MAX_MELODIC_OFFSET : MAX_FEEL_OFFSET;
    let o = clearOffset(st, minN, max);
    // (Only for a step the part does play on: a step it never hits isn't given a feel it never had)
    if (o === undefined) o = st.n >= 2 ? (clearOffset(pooled[s % 4], minN * 4, max) ?? 0) : 0;
    if (MELODIC.has(role) && kickSteps.has(s) && o > 0) o = 0;
    if (o) kept++;
    return Math.round(o * 1000) / 1000;
  });
  const v = own.map((st, s) => {
    const use = st.n >= minN ? st : st.n >= 2 && pooled[s % 4].n >= minN * 4 ? pooled[s % 4] : undefined;
    if (!use || Math.abs(use.level) < 1) return 1;
    kept++;
    return Math.round(Math.max(0.7, Math.min(1.15, 10 ** (use.level / 20))) * 100) / 100;
  });
  return kept ? { t, v } : undefined;
}

/**
 * Hits of `a` that aren't another part's: no hit of `others` from `before` ms before to `after` ms
 * after it (a kick read by its click can come up to 45 ms after its low end starts to rise).
 */
function without(a: readonly Onset[], others: ReadonlyArray<readonly Onset[]>, before = 15, after = 15): Onset[] {
  const ts = others.flat().map((o) => o.t).sort((x, y) => x - y);
  return a.filter((o) => {
    let lo = 0;
    let hi = ts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ts[m] < o.t - before / 1000) lo = m + 1;
      else hi = m;
    }
    return !(lo < ts.length && ts[lo] <= o.t + after / 1000);
  });
}

/** What extractGroove measured: the grid it fitted, each part's hits and step statistics, and the groove. */
export interface GrooveMeasure {
  grid: Grid;
  bars: number;
  /** Where the grid's zero was put: the tight drum hits' median, a share of a 16th from the fitted line */
  anchor: number;
  /** How many 16ths the bar's start was moved from the guess (see barPhase) */
  phase: number;
  onsets: Partial<Record<GrooveRole, Onset[]>>;
  stats: Partial<Record<GrooveRole, StepStat[]>>;
  roles: Partial<Record<GrooveRole, GrooveMap>>;
}

const DRUMS: GrooveRole[] = ['kick', 'snare', 'hats'];

/**
 * Which 16th of `grid` is really the bar's first (0-15): the shift that puts the most kicks on the
 * beats, snares and claps on beats two and four, and hats on the 8ths. A recording cut a 16th
 * late, or a guess that took a pickup for the downbeat, still lines up.
 */
export function barPhase(onsets: Partial<Record<GrooveRole, readonly Onset[]>>, grid: Grid): number {
  const steps = (r: GrooveRole) => stepsOf(onsets[r] ?? [], grid, 0.2).map((h) => h.step);
  const kick = steps('kick');
  const snare = steps('snare');
  const hats = steps('hats');
  let best = 0;
  let bestScore = -1;
  for (let s = 0; s < 16; s++) {
    const at = (step: number) => (step - s + 16) % 16;
    const score =
      kick.filter((k) => at(k) % 4 === 0).length * 2 +
      snare.filter((k) => at(k) === 4 || at(k) === 12).length * 2 -
      snare.filter((k) => at(k) === 0 || at(k) === 8).length +
      hats.filter((k) => at(k) % 2 === 0).length;
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

/**
 * Measure the groove of a mono recording `x` (sample rate `sr`), playing at about `guess.bpm`
 * with a bar starting at `guess.barStart` seconds. The grid's zero is where the drums' tight hits
 * sit (the median of the kick, snare and hat steps that cluster within 3% of a 16th): what a
 * drum machine plays on the grid is on the grid, and every part's push or drag is against that.
 * `progress` hears 0 to 1 as each part is done.
 */
export function extractGroove(x: Float32Array, sr: number, guess: Grid, opts: { roles?: GrooveRole[]; progress?: (f: number) => void; findPhase?: boolean } = {}): GrooveMeasure {
  const roles = opts.roles ?? (Object.keys(ROLE_BANDS) as GrooveRole[]);
  const raw: Partial<Record<GrooveRole, Onset[]>> = {};
  const need = new Set<GrooveRole>([...roles, ...DRUMS]);
  for (const r of roles) for (const o of EXCLUDE[r] ?? []) need.add(o);
  let done = 0;
  for (const r of need) {
    const b = ROLE_BANDS[r];
    raw[r] = detectOnsets(x, sr, b, { range: b.range, rise: b.rise, gapMs: b.gap, timeIn: b.timeIn });
    opts.progress?.(++done / (need.size + 1));
  }
  const onsets: Partial<Record<GrooveRole, Onset[]>> = {};
  for (const r of need) {
    let hits = raw[r]!;
    // (Where the kick hits, the low end is the kick's)
    for (const o of EXCLUDE[r] ?? []) hits = o === 'kick' && r === 'bass' ? without(hits, [raw.kick!], 25, 45) : without(hits, [raw[o]!]);
    onsets[r] = hits;
  }
  const fitted = fitGrid(DRUMS.flatMap((r) => raw[r]!.map((o) => o.t)).sort((a, b) => a - b), guess);
  const grid = !opts.findPhase ? fitted : { ...fitted, barStart: fitted.barStart + (barPhase(onsets, fitted) * 15) / fitted.bpm };
  const dur = x.length / sr;
  const bars = Math.max(1, Math.floor((dur - Math.max(0, grid.barStart)) / (240 / grid.bpm)));
  const minN = Math.max(3, Math.round(bars * 0.3));
  // The zero: the drums' tight steps
  const tight = DRUMS.flatMap((r) => stepStats(onsets[r]!, grid).filter((s) => s.n >= minN && s.spread < 0.03).map((s) => s.offset));
  const anchor = tight.length ? median(tight) : 0;
  const zeroed: Grid = { bpm: grid.bpm, barStart: grid.barStart + (anchor * 15) / grid.bpm };
  const stats: Partial<Record<GrooveRole, StepStat[]>> = {};
  const out: Partial<Record<GrooveRole, GrooveMap>> = {};
  const kickStats = stepStats(onsets.kick!, zeroed);
  const kickSteps = new Set(kickStats.flatMap((k, i) => (k.n >= minN ? [i] : [])));
  for (const r of roles) {
    stats[r] = stepStats(onsets[r]!, zeroed);
    const map = grooveMapOf(onsets[r]!, zeroed, minN, r, kickSteps);
    if (map) out[r] = map;
  }
  opts.progress?.(1);
  return { grid: zeroed, bars, anchor, phase: opts.findPhase ? barPhase(onsets, fitted) : 0, onsets, stats, roles: out };
}

/**
 * extractGroove on this thread after a pause (`ms`) for the page to paint (where a Worker can't
 * run it): the measure, or a rejection with what went wrong, so a caller waiting on it always hears back.
 */
export function extractLater(x: Float32Array, sr: number, guess: Grid, progress?: (f: number) => void, ms = 30): Promise<GrooveMeasure> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(extractGroove(x, sr, guess, { progress }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, ms)
  );
}
