/**
 * The "Does it hit?" targets: for each style, the range each measurement of hitCheck.ts falls in
 * on finished songs of that style (eight were measured, two or three per style, the ranges
 * widened a little past them), and what to change, in plain words, when a mix is outside one.
 * judgeHits holds a report against a style; headlines picks the few results that matter most
 * (Pocket's "Check the drop"). Plain data and maths, so Node tests it.
 */
import type { HitReport } from './hitCheck';

export type HitStyleId = 'dubstep' | 'drumstep' | 'hardcore' | 'darksynth' | 'futurebass';

export interface HitStyle {
  id: HitStyleId;
  name: string;
  /** What it sounds like, a few words. */
  blurb: string;
}

export const HIT_STYLES: readonly HitStyle[] = [
  {
    id: 'dubstep',
    name: 'Bass music / dubstep',
    blurb: 'Heavy, talking basses over a half-time beat',
  },
  {
    id: 'drumstep',
    name: 'Drumstep',
    blurb: 'Half-time bass music at drum & bass speed',
  },
  {
    id: 'hardcore',
    name: 'J-core / hardcore',
    blurb: 'Fast four-to-the-floor, a kick that is the bass',
  },
  {
    id: 'darksynth',
    name: 'Darksynth / pumping',
    blurb: 'Loud, pumping synths ducking to every kick',
  },
  {
    id: 'futurebass',
    name: 'Future bass / artcore',
    blurb: 'Lush wide chords, drums as an accent',
  },
];

export const styleById = (id: string): HitStyle => HIT_STYLES.find((s) => s.id === id) ?? HIT_STYLES[0];

/** A metric: how to read it from a report, its unit, and what to do when it's under or over. */
interface HitMetric {
  id: string;
  label: string;
  group: 'Level' | 'Balance' | 'Width' | 'Between the hits' | 'Bass movement' | 'Pump' | 'Drums';
  unit: 'LUFS' | 'dB' | '%' | 'oct' | 'corr';
  get: (r: HitReport) => number | undefined;
  /** The meter's ends. */
  scale: [number, number];
  /** Target range per style, [lowest, highest]. */
  target: Record<HitStyleId, [number, number]>;
  /** What to change when it's under the range, and over it. */
  low: string;
  high: string;
  /** Whether it matters for this report (a sub too small to hear needn't be in the middle). Out of range is then fine. */
  matters?: (r: HitReport) => boolean;
}

const all = (lo: number, hi: number): Record<HitStyleId, [number, number]> => ({
  dubstep: [lo, hi],
  drumstep: [lo, hi],
  hardcore: [lo, hi],
  darksynth: [lo, hi],
  futurebass: [lo, hi],
});
const band = (r: HitReport, id: string) => r.bands.find((b) => b.id === id);

/**
 * The metrics and their targets. The ranges come from the reference drops as hitCheck measures
 * them (see the numbers in the comments: per style, the songs measured), with the general targets
 * (no gaps, a moving bass, a mono sub) where a style had too few songs to say more.
 */
export const HIT_METRICS: readonly HitMetric[] = [
  {
    id: 'loudness',
    label: 'Loudness',
    group: 'Level',
    unit: 'LUFS',
    get: (r) => r.loudness.integrated,
    scale: [-20, 0],
    // dubstep -7.1 -4.7 -4.2 | drumstep -4.7 | hardcore -6.6 -4.2 -2.6 | darksynth -3.7 -2.6 | future -10.6 -9.8
    target: {
      dubstep: [-8, -4],
      drumstep: [-7, -4],
      hardcore: [-8, -2.5],
      darksynth: [-5, -2.5],
      futurebass: [-12, -8],
    },
    low: 'Quieter than this style: turn on the Loud master (Loud in the Pocket mixer) aimed at Club or Loud.',
    high: 'Louder than this style needs: ease the master level so the hits keep their punch.',
  },
  {
    id: 'crest',
    label: 'Peaks over the body',
    group: 'Level',
    unit: 'dB',
    get: (r) => r.loudness.crest,
    scale: [3, 18],
    // dubstep 9.4 6.6 6.9 | hardcore 8.6 6.9 6.0 | darksynth 5.9 6.0 | future 12.8 12.5
    target: {
      dubstep: [6, 10],
      drumstep: [5.5, 8.5],
      hardcore: [5.5, 9.5],
      darksynth: [5, 7.5],
      futurebass: [10, 14],
    },
    low: 'Squashed: the peaks are flattened. Ease the clipper or the master level so the hits have room.',
    high: 'The hits stick out over a thin body: fill between them (held chords, a pad, a longer bass) and turn on the Loud master to catch the peaks.',
  },
  {
    id: 'sub',
    label: 'Sub (under 60 Hz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'sub')?.db,
    scale: [-30, 0],
    // dubstep -7.3 -3.9 -4.8 | hardcore -5.8 -4.8 -15.6 | darksynth -5.1 -15.6 | future -7.7 -22.9
    target: {
      dubstep: [-8.5, -3],
      drumstep: [-6.5, -3],
      hardcore: [-16.5, -4],
      darksynth: [-16.5, -4],
      futurebass: [-24, -6.5],
    },
    low: 'Little sub: give the bass a sub layer (a Sub-Bass playing its root an octave down).',
    high: 'Sub too big: lower the sub or high-pass the other parts. A big sub eats the loudness.',
  },
  {
    id: 'low',
    label: 'Low end (60-250 Hz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'low')?.db,
    scale: [-20, 0],
    // all songs -6.0 to -3.3
    target: all(-7, -2.5),
    low: "Thin low end: the bass's body and the kick need more 60-250 Hz.",
    high: 'Boomy: too much 60-250 Hz. Turn down the bass a little, or cut the low end of pads and chords.',
  },
  {
    id: 'lowMid',
    label: 'Low mids (250 Hz-1 kHz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'lowMid')?.db,
    scale: [-25, 0],
    // dubstep -10.2 -12.2 -11.5 | hardcore -10.1 -11.5 -8.0 | darksynth -12.1 -8.0 | future -8.9 -3.4
    target: {
      dubstep: [-13.5, -9],
      drumstep: [-13.5, -9.5],
      hardcore: [-13, -7],
      darksynth: [-13.5, -7],
      futurebass: [-10.5, -2.5],
    },
    low: "Hollow: the chords and the bass's middle are missing. Bring up the chords, or the growl's body.",
    high: 'Crowded low mids: thin out pads and chords around 300-800 Hz, or turn them down.',
  },
  {
    id: 'mid',
    label: 'Mids (1-4 kHz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'mid')?.db,
    scale: [-25, 0],
    // all songs -11.8 to -7.9
    target: all(-13, -7),
    low: 'Distant: little 1-4 kHz. Bring up the leads, the growl or the snare.',
    high: 'Shouty: too much 1-4 kHz. Turn down the lead or the bass growl a little.',
  },
  {
    id: 'presence',
    label: 'Presence (4-8 kHz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'presence')?.db,
    scale: [-30, -5],
    // dubstep -14.0 -13.9 -12.2 | hardcore -15.2 -12.2 -11.9 | darksynth -12.3 -11.9 | future -17.6 -18.9
    target: {
      dubstep: [-15.5, -11],
      drumstep: [-15.5, -11.5],
      hardcore: [-16.5, -10.5],
      darksynth: [-14, -10.5],
      futurebass: [-20, -15.5],
    },
    low: 'Dull: brighten the hats, the snare and the leads (4-8 kHz).',
    high: 'Harsh or hissy: tame 4-8 kHz (hats, noise, distortion).',
  },
  {
    id: 'air',
    label: 'Air (over 8 kHz)',
    group: 'Balance',
    unit: 'dB',
    get: (r) => band(r, 'air')?.db,
    scale: [-35, -5],
    // dubstep -15.7 -15.7 -15.6 | hardcore -22.2 -15.6 -14.6 | darksynth -17.3 -14.6 | future -16.8 -23.7
    target: {
      dubstep: [-19, -13.5],
      drumstep: [-19, -13.5],
      hardcore: [-23.5, -13],
      darksynth: [-19, -13],
      futurebass: [-25, -15],
    },
    low: 'No air: add cymbals or open hats, or some brightness to the pads.',
    high: 'Fizzy: too much over 8 kHz. Turn down the hats or the noise.',
  },
  {
    id: 'subMono',
    label: 'Sub in the middle',
    group: 'Width',
    unit: 'corr',
    get: (r) => band(r, 'sub')?.corr,
    matters: (r) => (band(r, 'sub')?.db ?? -99) > -14,
    scale: [0, 1],
    // 0.92-1.00 (one song at 0.78); the general rule: mono under 60 Hz
    target: all(0.95, 1),
    low: "The sub isn't in the middle: make the bass's lowest part mono (a narrower bass, or a mono sub layer).",
    high: '',
  },
  {
    id: 'lowMono',
    label: 'Low end in the middle',
    group: 'Width',
    unit: 'corr',
    get: (r) => band(r, 'low')?.corr,
    matters: (r) => (band(r, 'low')?.db ?? -99) > -14,
    scale: [0, 1],
    // 0.77-1.00
    target: all(0.75, 1),
    low: 'The low end is wide: keep the bass and kick narrow under 250 Hz.',
    high: '',
  },
  {
    id: 'width',
    label: 'Width of the mids',
    group: 'Width',
    unit: 'dB',
    get: (r) => {
      const a = band(r, 'lowMid')?.sideToMid;
      const b = band(r, 'mid')?.sideToMid;
      return a === undefined || b === undefined ? undefined : (a + b) / 2;
    },
    scale: [-20, 3],
    // sides against middle, 250 Hz-4 kHz: dubstep -6.2 -3.7 -3.1 | hardcore -4.6 -3.1 -3.7 | darksynth -4.6 -3.7 | future -0.4 0.3
    target: {
      dubstep: [-7.5, -1.5],
      drumstep: [-7, -1.5],
      hardcore: [-6.5, -1.5],
      darksynth: [-6.5, -1.5],
      futurebass: [-3, 1],
    },
    low: 'Narrow: spread the chords and pads (a wider pad, chorus, or parts panned apart).',
    high: 'Very wide: some parts may thin out or vanish in mono. Narrow the widest pad a little.',
  },
  {
    id: 'gaps',
    label: 'Gaps between hits',
    group: 'Between the hits',
    unit: '%',
    get: (r) => r.sustain.below12,
    scale: [0, 20],
    // 0.0-1.0% of 10 ms moments more than 12 dB under the average
    target: all(0, 1.5),
    low: '',
    high: 'Gaps between hits: the sound drops out after each drum. Hold chords longer, add a pad, or let the bass ring to the next note.',
  },
  {
    id: 'swing16',
    label: 'Level jumps within a 16th',
    group: 'Between the hits',
    unit: 'dB',
    get: (r) => r.sustain.swing16,
    scale: [0, 15],
    // 3.5-6.6
    target: {
      dubstep: [3.5, 7],
      drumstep: [3.5, 7],
      hardcore: [3.5, 7],
      darksynth: [3.5, 7],
      futurebass: [3, 6],
    },
    low: 'Flat: nothing punches through. Give the drums more snap, or let the sidechain breathe.',
    high: 'Choppy: the level jumps within every 16th. Let notes ring (longer release, some reverb) or add a held layer under them.',
  },
  {
    id: 'floor',
    label: 'Quietest part of each beat',
    group: 'Between the hits',
    unit: 'dB',
    get: (r) => r.sustain.quietFloor,
    scale: [-12, 0],
    // -3.3 to -1.8 under the beat's average
    target: all(-3.8, -1.2),
    low: 'The quiet part of each beat is too quiet: fill it with a pad, reverb or a held bass.',
    high: 'Very even: the beat hardly breathes. A little Duck to kick gives it a pulse.',
  },
  {
    id: 'bassJumps',
    label: 'Bass tone changes per 16th',
    group: 'Bass movement',
    unit: '%',
    get: (r) => r.movement.over025,
    scale: [0, 100],
    // share of 16ths whose tone moves over a quarter octave: dubstep 47 62 56 | hardcore 72 56 72 | darksynth 57 72 | future 52 29
    target: {
      dubstep: [45, 85],
      drumstep: [50, 85],
      hardcore: [50, 85],
      darksynth: [45, 85],
      futurebass: [25, 65],
    },
    low: 'The bass sits on one tone: change its sound every 16th or two (filter steps, other notes, different hits).',
    high: 'The bass changes on nearly every 16th: busy. Hold a tone for two now and then so the groove reads.',
  },
  {
    id: 'oneRate',
    label: 'Wobble at one steady rate',
    group: 'Bass movement',
    unit: '%',
    get: (r) => r.movement.topRateShare,
    scale: [0, 80],
    // share of the bass's tone movement at its single strongest rate: 8-39%; a plain 1/8 wobble is about 60%
    target: {
      dubstep: [0, 30],
      drumstep: [0, 30],
      hardcore: [0, 42],
      darksynth: [0, 30],
      futurebass: [0, 30],
    },
    low: '',
    high: "The bass's tone moves at one steady rate (a plain wobble or pulse: the 2000s sound). Vary it from note to note: other rates, filter steps, different notes or hits.",
  },
  {
    id: 'repeat',
    label: 'Bass pattern repeats by the bar',
    group: 'Bass movement',
    unit: 'corr',
    get: (r) => r.movement.acBar,
    scale: [-0.2, 1],
    // dubstep 0.61 0.60 0.35 | hardcore 0.75 0.35 0.73 | darksynth 0.74 0.73 | future 0.76 0.31
    target: {
      dubstep: [0.3, 0.88],
      drumstep: [0.45, 0.88],
      hardcore: [0.3, 0.88],
      darksynth: [0.5, 0.88],
      futurebass: [0.25, 0.88],
    },
    low: "The bass doesn't come back each bar: a pattern that repeats every bar or two locks the groove.",
    high: 'The bass is exactly the same every bar: change the second bar a little.',
  },
  {
    id: 'pump',
    label: 'Pump (mids dip with the beat)',
    group: 'Pump',
    unit: 'dB',
    get: (r) => r.pump.dip,
    scale: [-12, 0],
    // how far the mids dip under where they come back to: dubstep -2.6 -5.4 -3.6 | drumstep -5.4 | hardcore -2.8 -3.6 -6.8 | darksynth -5.7 -6.8 | future -2.4 -0.9
    target: {
      dubstep: [-6.5, -2],
      drumstep: [-7, -3.5],
      hardcore: [-7.5, -1.5],
      darksynth: [-8.5, -4.5],
      futurebass: [-3.5, -0.5],
    },
    low: 'Pumping harder than this style: ease the Pump depth on the chords and pads, or let them come back sooner.',
    high: "Not pumping: the chords and pads should dip after the kick. Use Duck to kick (Pump in Pocket's mixer).",
  },
  {
    id: 'kick',
    label: 'Kick over the mix',
    group: 'Drums',
    unit: 'dB',
    get: (r) => r.drums?.kickOverMix,
    scale: [-6, 12],
    // dubstep 4.0 2.2 2.3 | hardcore 2.7 2.3 2.7 | darksynth 2.6 2.7 | future 5.1 1.3
    target: {
      dubstep: [1.5, 5.5],
      drumstep: [1.5, 5],
      hardcore: [1.5, 4.5],
      darksynth: [1.5, 4.5],
      futurebass: [0.5, 6.5],
    },
    low: 'The kick is buried: turn it up, or duck the bass and chords under it.',
    high: 'The kick sticks out of the mix: turn it down a little, or fill the mix around it.',
  },
  {
    id: 'snare',
    label: 'Snare over the mix',
    group: 'Drums',
    unit: 'dB',
    get: (r) => r.drums?.snareOverMix,
    scale: [-6, 12],
    // dubstep 2.7 3.9 2.2 | hardcore 3.5 2.2 3.5 | darksynth 4.0 3.5 | future 6.6 1.4
    target: {
      dubstep: [1.5, 5.5],
      drumstep: [2.5, 5.5],
      hardcore: [1.5, 5],
      darksynth: [2.5, 5.5],
      futurebass: [0.5, 7.5],
    },
    low: 'The snare is buried: turn it up, or layer a clap on it.',
    high: 'The snare sticks out of the mix: turn it down a little.',
  },
  {
    id: 'subDuck',
    label: 'Sub ducks under the snare',
    group: 'Drums',
    unit: 'dB',
    get: (r) => r.drums?.subDuck,
    scale: [-30, 10],
    // dubstep -6.4 -11.5 -23.0 | hardcore -15.4 -23.0 -3.3 | darksynth -5.0 -3.3 | future 0.3 1.3
    target: {
      dubstep: [-28, -5],
      drumstep: [-28, -8],
      hardcore: [-28, -2.5],
      darksynth: [-10, -1.5],
      futurebass: [-5, 5],
    },
    low: "The sub is gone under the snare for longer than this style: a shorter duck keeps the bass's weight.",
    high: 'The sub keeps playing under the snare: duck the sub on the snare too, or end the bass note at the snare.',
  },
];

export type HitStatus = 'ok' | 'low' | 'high' | 'na';

export interface HitJudgement {
  id: string;
  label: string;
  group: HitMetric['group'];
  value: number;
  /** The value as text ("-6.2 LUFS"). */
  shown: string;
  target: [number, number];
  targetShown: string;
  scale: [number, number];
  status: HitStatus;
  /** What to change (empty when it's in range). */
  advice: string;
}

export function formatHit(v: number, unit: HitMetric['unit']): string {
  if (!Number.isFinite(v)) return '-';
  switch (unit) {
    case 'LUFS':
      return `${v.toFixed(1)} LUFS`;
    case 'dB':
      return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case '%':
      return `${Math.round(v)}%`;
    case 'oct':
      return `${v.toFixed(2)} oct`;
    default:
      return v.toFixed(2);
  }
}

/** Every metric of `report` against `styleId`'s targets. Drum metrics need the report's drums (status 'na' without). */
export function judgeHits(report: HitReport, styleId: string): HitJudgement[] {
  const style = styleById(styleId).id;
  return HIT_METRICS.map((m) => {
    const v = m.get(report);
    const target = m.target[style];
    const value = v ?? NaN;
    const out = value < target[0] ? 'low' : value > target[1] ? 'high' : 'ok';
    const status: HitStatus = !Number.isFinite(value) ? 'na' : m.matters && !m.matters(report) ? 'ok' : out;
    const unit = m.unit === 'corr' ? 'corr' : m.unit;
    return {
      id: m.id,
      label: m.label,
      group: m.group,
      value,
      shown: formatHit(value, unit),
      target,
      targetShown: `${formatHit(target[0], unit)} to ${formatHit(target[1], unit)}`,
      scale: m.scale,
      status,
      advice: status === 'low' ? m.low : status === 'high' ? m.high : '',
    };
  });
}

/** One plain-words result for the short check. */
export interface HitHeadline {
  id: 'gaps' | 'bass' | 'sub' | 'loud';
  ok: boolean;
  /** A few words ("Sub too big"). */
  title: string;
  /** What to change (or, when it's fine, why). */
  text: string;
}

/**
 * The few results that matter most, in plain words (Pocket's "Check the drop"): gaps between the
 * hits, whether the bass moves (and isn't a one-rate wobble), the sub (its size and whether it's in
 * the middle), and the loudness.
 */
export function headlines(report: HitReport, styleId: string): HitHeadline[] {
  const j = new Map(judgeHits(report, styleId).map((x) => [x.id, x]));
  const advice = (id: string, way: 'low' | 'high') => HIT_METRICS.find((m) => m.id === id)![way];
  const out: HitHeadline[] = [];
  const gaps = j.get('gaps')!;
  const choppy = j.get('swing16')!;
  if (gaps.status === 'high') out.push({ id: 'gaps', ok: false, title: 'Gaps between hits', text: gaps.advice });
  else if (choppy.status === 'high') out.push({ id: 'gaps', ok: false, title: 'Choppy between hits', text: choppy.advice });
  else out.push({ id: 'gaps', ok: true, title: 'No gaps between hits', text: 'The sound holds up between the drums.' });
  const kind = report.movement.kind;
  const rate = j.get('oneRate')!;
  const jumps = j.get('bassJumps')!;
  if (kind === 'wobble' || rate.status === 'high') out.push({ id: 'bass', ok: false, title: 'The bass wobbles at one steady rate', text: advice('oneRate', 'high') });
  else if (jumps.status === 'low' || kind === 'still') out.push({ id: 'bass', ok: false, title: 'The bass sits on one tone', text: advice('bassJumps', 'low') });
  else out.push({ id: 'bass', ok: true, title: 'The bass moves', text: 'Its tone changes from 16th to 16th.' });
  const sub = j.get('sub')!;
  const mono = j.get('subMono')!;
  if (mono.status === 'low') out.push({ id: 'sub', ok: false, title: "The sub isn't in the middle", text: mono.advice });
  else if (sub.status === 'high') out.push({ id: 'sub', ok: false, title: 'Sub too big', text: sub.advice });
  else if (sub.status === 'low') out.push({ id: 'sub', ok: false, title: 'Little sub', text: sub.advice });
  else out.push({ id: 'sub', ok: true, title: 'The sub is right', text: 'The right size for this style, and in the middle.' });
  const loud = j.get('loudness')!;
  if (loud.status === 'low') out.push({ id: 'loud', ok: false, title: `Too quiet (${loud.shown})`, text: loud.advice });
  else if (loud.status === 'high') out.push({ id: 'loud', ok: false, title: `Too loud (${loud.shown})`, text: loud.advice });
  else out.push({ id: 'loud', ok: true, title: `Loud enough (${loud.shown})`, text: 'As loud as this style.' });
  return out;
}
