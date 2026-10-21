import type { AutomationLane, AutomationParam, AutomationPoint, Clip, StepLane, StepTarget, StepValue, Track } from './timelineTypes';
import { AUTOMATION_PARAMS, FX_AUTOMATION_KEYS, type BuiltinParam, type FxAutomationKey } from './timelineTypes';
import { laneValueAt, normalizePoints, specOf } from '../audio/automation';
import { tempoAt, type Tempo } from '../audio/tempoMap';
import { isLiveParam } from './freeze';
import { seeded } from './smartTools';
import { NAMED_PARAM, paramNamesOf, paramNamesVersion } from '../audio/plugins/paramNames';

/**
 * Step lanes: rows of steps under a clip's notes, each set step holding a value (0 to 1, in the
 * lane height automation uses) for one of the track's settings: a Fledge Synth macro or another
 * of the instrument plugin's parameters by name, the Filter's cutoff, an insert's setting... A
 * step not set holds the value before it. "Per note": the value changes at each note that starts
 * in a set step instead of at the step's start, so the timbre changes with the notes.
 *
 * How they play: over the song, a track's clips' step lanes become automation lanes of the track
 * (withStepLanes), played by the automation engine live and in exports alike, as the clips'
 * controller lanes are (ccLanes.ts). Within a clip a step lane wins over the track's own lane (or
 * a controller lane) for the same setting; outside it, the track's lane (or the track's own
 * setting) plays again. Every change glides over STEP_SMOOTH seconds and is there by the step's
 * (or note's) start, so it doesn't click. Plugin parameters go to the plugin as timed events on a
 * 16-sample grid (audio/controlEvents.ts); the track's own settings are native params, written to
 * the sample. Pure, so Node can unit-test it.
 */

/** Each change glides this long (seconds), ending on the step's (or the note's) start. */
export const STEP_SMOOTH = 0.003;

/** The step lengths a lane can have, in 96ths of a bar. */
export const STEP_GRIDS: ReadonlyArray<{ units: number; label: string }> = [
  { units: 6, label: '1/16' },
  { units: 3, label: '1/32' },
  { units: 4, label: '1/16T' },
  { units: 8, label: '1/8T' },
  { units: 12, label: '1/8' },
];
export const DEFAULT_STEP_GRID = 6;
/** How many lanes a clip can have. */
export const MAX_STEP_LANES = 8;

const EPS = 1e-6;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A step's length in bars. */
export const stepBars = (lane: Pick<StepLane, 'grid'>): number => lane.grid / 96;

/** How many steps a clip `length` bars long has on the lane's grid. */
export const stepCount = (lane: Pick<StepLane, 'grid'>, length: number): number => Math.max(1, Math.ceil(length / stepBars(lane) - EPS));

/** The step a position (bars into the clip) is in. */
const stepIndex = (lane: Pick<StepLane, 'grid'>, at: number) => Math.floor(at / stepBars(lane) + EPS);

// ---------- Targets ----------

/** The track instrument's parameter `name` as a step target. */
export const instTarget = (name: string): StepTarget => `inst:${name}`;

/** A target a step lane can have: a track setting (not a send) or an instrument parameter by name. */
export function isStepTarget(v: unknown): v is StepTarget {
  if (typeof v !== 'string') return false;
  if (v.startsWith('inst:')) return v.length > 5 && v.length <= 80;
  if (v.startsWith('fx:')) return FX_AUTOMATION_KEYS.includes(v.slice(3) as FxAutomationKey);
  return AUTOMATION_PARAMS.includes(v as BuiltinParam);
}

/** What `target` drives on `track`, as an automation lane's param (null: nothing, an instrument parameter on a track without a plugin). */
export function stepParam(track: Pick<Track, 'plugin'>, target: StepTarget): AutomationParam | null {
  if (target.startsWith('inst:')) return track.plugin ? `plugin:${track.plugin.id}:${NAMED_PARAM}${target.slice(5)}` : null;
  return target as AutomationParam;
}

/** An instrument parameter's name (`inst:Macro 1` → "Macro 1"), else null. */
export const instParamName = (target: StepTarget): string | null => (target.startsWith('inst:') ? target.slice(5) : null);

/**
 * The track's own value (lane height, 0..1) for what `param` drives, where no lane says otherwise:
 * a setting's own value, or a built-in plugin's saved setting of the named parameter (null when the
 * plugin hasn't said its names yet).
 */
export function restValue(track: Track, param: AutomationParam): number | null {
  if (param.startsWith('plugin:')) {
    const at = param.indexOf(NAMED_PARAM, 7);
    const name = at < 0 ? null : param.slice(at + NAMED_PARAM.length);
    const names = paramNamesOf(track.plugin?.url);
    const values = (track.plugin?.state as { values?: unknown } | undefined)?.values;
    if (!name || !names || !Array.isArray(values)) return null;
    const v = values[names.indexOf(name)];
    return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : null;
  }
  const spec = specOf(param, track);
  const v = spec.toNorm(spec.trackValue(track));
  return Number.isFinite(v) ? clamp01(v) : null;
}

// ---------- Reading and editing ----------

/** A lane's values step by step over a clip `length` bars long (null: not set, it holds). */
export function stepValues(lane: StepLane, length: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: stepCount(lane, length) }, () => null);
  for (const s of lane.steps) {
    if (s.at < -EPS || s.at >= length - EPS) continue;
    const i = stepIndex(lane, s.at);
    if (i >= 0 && i < out.length) out[i] = s.value;
  }
  return out;
}

/**
 * The lane with its steps over the clip replaced by `values` (null: cleared). Steps outside the
 * clip (hidden by a trim) are kept, so trimming back brings them back.
 */
export function withStepValues(lane: StepLane, length: number, values: ReadonlyArray<number | null>): StepLane {
  const step = stepBars(lane);
  const hidden = lane.steps.filter((s) => s.at < -EPS || s.at >= length - EPS);
  const shown: StepValue[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v) || i * step >= length - EPS) return;
    shown.push({ at: i * step, value: Math.round(clamp01(v) * 1000) / 1000 });
  });
  return { ...lane, steps: [...hidden, ...shown].sort((a, b) => a.at - b.at) };
}

/** Set steps `from` to `to` (indexes, either order) to `value` (null: clear them). */
export function paintSteps(lane: StepLane, length: number, from: number, to: number, value: number | null): StepLane {
  const values = stepValues(lane, length);
  for (let i = Math.max(0, Math.min(from, to)); i <= Math.min(values.length - 1, Math.max(from, to)); i++) values[i] = value;
  return withStepValues(lane, length, values);
}

/**
 * Random values between `lo` and `hi` (0..1) on every step, the same for the same `seed`. With
 * `fill` below 1, only that share of the steps gets one (the rest hold), the first step always.
 */
export function randomiseSteps(lane: StepLane, length: number, seed: number, lo = 0, hi = 1, fill = 1): StepLane {
  const rand = seeded(seed);
  const [a, b] = lo <= hi ? [clamp01(lo), clamp01(hi)] : [clamp01(hi), clamp01(lo)];
  const values = stepValues(lane, length).map((_, i) => {
    const pick = rand();
    const v = a + (b - a) * rand();
    return i === 0 || pick < fill ? v : null;
  });
  return withStepValues(lane, length, values);
}

/** The first `n` steps repeated across the whole clip. */
export function repeatSteps(lane: StepLane, length: number, n: number): StepLane {
  const values = stepValues(lane, length);
  const count = Math.max(1, Math.min(values.length, Math.round(n)));
  return withStepValues(lane, length, values.map((_, i) => values[i % count]));
}

/** The steps moved `by` steps later (earlier when negative), wrapping round the clip. */
export function rotateSteps(lane: StepLane, length: number, by: number): StepLane {
  const values = stepValues(lane, length);
  const n = values.length;
  const k = ((Math.round(by) % n) + n) % n;
  return withStepValues(lane, length, values.map((_, i) => values[(i - k + n) % n]));
}

/** The lane on another grid: each new step takes the value set in the old step it starts in, if any. */
export function regridSteps(lane: StepLane, length: number, grid: number): StepLane {
  const next = { ...lane, grid };
  const old = stepValues(lane, length);
  const values = Array.from({ length: stepCount(next, length) }, (_, i) => {
    const at = i * stepBars(next);
    const j = stepIndex(lane, at);
    // (Only where an old step starts here, or the new step is the first in it)
    return j < old.length && (Math.abs(j * stepBars(lane) - at) < EPS || stepIndex(lane, (i - 1) * stepBars(next)) !== j) ? old[j] : null;
  });
  return withStepValues(next, length, values);
}

// ---------- Clip edits ----------

/** The lanes with every step `shift` bars later (a clip's start trimmed by -shift keeps them where they sounded). */
export function moveStepLanes(lanes: StepLane[] | undefined, shift: number): StepLane[] | undefined {
  if (!lanes?.length) return lanes;
  return lanes.map((l) => ({ ...l, steps: l.steps.map((s) => ({ ...s, at: s.at + shift })) }));
}

/** The halves of a clip's lanes cut `rel` bars in: the steps before and the steps from there (moved to the right half's start). */
export function splitStepLanes(lanes: StepLane[] | undefined, rel: number): [StepLane[] | undefined, StepLane[] | undefined] {
  if (!lanes?.length) return [lanes, lanes];
  const left = lanes.map((l) => ({ ...l, steps: l.steps.filter((s) => s.at < rel - EPS) }));
  const right = lanes.map((l) => ({ ...l, steps: l.steps.filter((s) => s.at >= rel - EPS).map((s) => ({ ...s, at: s.at - rel })) }));
  return [left, right];
}

// ---------- Project files ----------

/** A clip's step lanes from a file: valid ones only (known targets and grids, numbers in range), or undefined. */
export function normalizeStepLanes(raw: unknown): StepLane[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StepLane[] = [];
  for (const v of raw.slice(0, MAX_STEP_LANES)) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (!isStepTarget(o.target)) continue;
    const grid = STEP_GRIDS.some((g) => g.units === o.grid) ? (o.grid as number) : DEFAULT_STEP_GRID;
    const steps = (Array.isArray(o.steps) ? o.steps : [])
      .filter((s): s is StepValue => typeof s === 'object' && s !== null && Number.isFinite((s as StepValue).at) && Number.isFinite((s as StepValue).value))
      .slice(0, 4096)
      .map((s) => ({ at: Math.max(-400, Math.min(400, s.at)), value: clamp01(s.value) }))
      .sort((a, b) => a.at - b.at);
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `steps${out.length + 1}`,
      target: o.target,
      grid,
      steps,
      ...(o.perNote === true ? { perNote: true } : {}),
    });
  }
  return out.length ? out : undefined;
}

// ---------- Playing them ----------

/** Where a lane's value changes, bars into the clip, and to what: at its set steps, or (per note) at the notes starting in them. */
export function stepChanges(clip: Pick<Clip, 'lengthBars' | 'notes'>, lane: StepLane): Array<{ at: number; value: number }> {
  const values = stepValues(lane, clip.lengthBars);
  const out: Array<{ at: number; value: number }> = [];
  const push = (at: number, value: number) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at - at) < EPS) last.value = value;
    else out.push({ at, value });
  };
  if (lane.perNote) {
    const starts = [...new Set(clip.notes.filter((n) => n.startOffset >= -EPS && n.startOffset < clip.lengthBars - EPS).map((n) => Math.max(0, n.startOffset)))].sort((a, b) => a - b);
    for (const at of starts) {
      const v = values[stepIndex(lane, at)];
      if (v !== null && v !== undefined) push(at, v);
    }
  } else {
    values.forEach((v, i) => v !== null && push(i * stepBars(lane), v));
  }
  return out;
}

/** One clip's stretch of a lane: from `from` to `to` (song bars), the changes (song bars) in it. */
interface Region {
  from: number;
  to: number;
  changes: Array<{ bar: number; value: number }>;
}

/**
 * A lane with `regions` played over `base` (the track's own lane's points, or none: `rest` then,
 * the track's own value; null when unknown: the first change's value). Each change glides over
 * `smooth(bar)` bars and arrives at its bar; at a region's end the base comes back the same way,
 * unless the next region starts there (a step not set holds the value before, across clips too).
 */
export function spliceRegions(base: readonly AutomationPoint[] | null, rest: number | null, regions: Region[], smooth: (bar: number) => number): AutomationPoint[] {
  const sorted = regions.filter((r) => r.to > r.from + EPS).sort((a, b) => a.from - b.from);
  if (!sorted.length) return base ? [...base] : [];
  const fallback = rest ?? sorted.find((r) => r.changes.length)?.changes[0].value ?? 0;
  const pts = base ?? [];
  const has = pts.length > 0;
  const at = (bar: number) => (has ? laneValueAt(pts, bar)! : fallback);
  const out: AutomationPoint[] = [];
  const lastBar = () => (out.length ? out[out.length - 1].bar : -Infinity);
  /** The base's own points strictly between `a` and `b`; a bend cut by either end is sampled (a bend can't be cut in two). */
  const baseBetween = (a: number, b: number) => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const next = pts[i + 1];
      const inside = p.bar > a + EPS && p.bar < b - EPS;
      const cut = !!p.curve && !!next && (p.bar <= a + EPS || next.bar >= b - EPS);
      if (inside) out.push(cut ? { bar: p.bar, value: p.value } : p);
      if (!cut) continue;
      const lo = Math.max(p.bar, a);
      const hi = Math.min(next.bar, b);
      for (let x = lo + 1 / 64; x < hi - EPS; x += 1 / 64) out.push({ bar: x, value: laneValueAt(pts, x)! });
    }
  };
  let prevTo = -Infinity;
  /** The value carried on from the region before, when it ran straight into this one */
  let carry: number | null = null;
  sorted.forEach((r, k) => {
    // (Overlapping clips: the later one takes over where it starts)
    const nextFrom = sorted[k + 1]?.from ?? Infinity;
    const to = Math.min(r.to, nextFrom);
    const changes = r.changes.filter((c) => c.bar >= r.from - EPS && c.bar < to - EPS);
    // Into the clip: the glide into a first step at its very start begins just before it
    const enter = changes.length && Math.abs(changes[0].bar - r.from) < EPS ? r.from - smooth(r.from) : r.from;
    let cur: number;
    if (carry !== null) cur = carry;
    else {
      if (has) baseBetween(prevTo, enter);
      cur = at(enter);
      out.push({ bar: Math.max(enter, lastBar()), value: cur });
    }
    for (const c of changes) {
      if (Math.abs(c.value - cur) < 1e-9) continue;
      const s = Math.max(lastBar(), c.bar - smooth(c.bar));
      out.push({ bar: s, value: cur }, { bar: Math.max(s, c.bar), value: c.value });
      cur = c.value;
    }
    // Straight into the next clip: its steps take over from here
    if (Math.abs(nextFrom - to) < EPS) {
      carry = cur;
      prevTo = to;
      return;
    }
    carry = null;
    // Back to the base at the end
    const back = at(to);
    if (Math.abs(back - cur) > 1e-9) {
      const s = Math.max(lastBar(), to - smooth(to));
      out.push({ bar: s, value: cur }, { bar: Math.max(s, to), value: back });
    } else out.push({ bar: Math.max(lastBar(), to), value: cur });
    prevTo = to;
  });
  // After the last clip: the base from there
  if (has) baseBetween(prevTo, Infinity);
  return normalizePoints(out);
}

/** Bars that `seconds` last at `bar` of the song. */
const barsOf = (seconds: number, tempo: Tempo) => (bar: number) => (seconds * tempoAt(bar, tempo)) / 240;

/**
 * The automation lanes a track's clips' step lanes make: one per setting they drive, the track's
 * own lane for it (if it has one) playing between the clips.
 */
export function stepAutomation(track: Track, clips: readonly Clip[], tempo: Tempo): AutomationLane[] {
  const byParam = new Map<AutomationParam, Region[]>();
  const mine = clips.filter((c) => c.trackId === track.id && c.stepLanes?.length && !c.audio);
  for (const clip of mine) {
    for (const lane of clip.stepLanes!) {
      const param = stepParam(track, lane.target);
      if (!param) continue;
      // A frozen track: its live settings play live and the rest are in its sound (and the reverse while rendering it)
      if ((track as { frozenFrom?: string }).frozenFrom && !isLiveParam(param)) continue;
      if (track.freezing && isLiveParam(param)) continue;
      const changes = stepChanges(clip, lane).map((c) => ({ bar: clip.startBar + c.at, value: c.value }));
      if (!changes.length) continue;
      const list = byParam.get(param) ?? [];
      list.push({ from: clip.startBar, to: clip.startBar + clip.lengthBars, changes });
      byParam.set(param, list);
    }
  }
  const smooth = barsOf(STEP_SMOOTH, tempo);
  return [...byParam].map(([param, regions]) => {
    const own = track.automation?.find((l) => l.param === param && l.points.length);
    return { param, points: spliceRegions(own?.points ?? null, own ? null : restValue(track, param), regions, smooth) };
  });
}

/** What a track's step lanes depend on in its clips, as a key. */
const laneKey = (clips: readonly Clip[], trackId: string) =>
  clips
    .filter((c) => c.trackId === trackId && c.stepLanes?.length && !c.audio)
    .map((c) => `${c.startBar}|${c.lengthBars}|${JSON.stringify(c.stepLanes)}${c.stepLanes!.some((l) => l.perNote) ? `|${c.notes.map((n) => n.startOffset).join(',')}` : ''}`)
    .join(';');

export interface StepMemo {
  byTrack: Map<string, { track: Track; key: string; tempo: Tempo; names: number; out: Track }>;
  output: Track[] | null;
}
export const stepMemo = (): StepMemo => ({ byTrack: new Map(), output: null });

/**
 * The tracks with their clips' step lanes played as their automation (in place of the track's own
 * lane for the same setting, which plays on between the clips). The same track objects (and,
 * with `memo`, the same array) while nothing that matters changes, so the engine leaves them be.
 */
export function withStepLanes(tracks: Track[], clips: readonly Clip[], tempo: Tempo, memo?: StepMemo): Track[] {
  if (!clips.some((c) => c.stepLanes?.length)) {
    if (memo) {
      memo.byTrack.clear();
      memo.output = tracks;
    }
    return tracks;
  }
  const names = paramNamesVersion();
  const out = tracks.map((t) => {
    const key = laneKey(clips, t.id);
    if (!key) return t;
    const hit = memo?.byTrack.get(t.id);
    if (hit && hit.track === t && hit.key === key && hit.tempo === tempo && hit.names === names) return hit.out;
    const lanes = stepAutomation(t, clips, tempo);
    const taken = new Set(lanes.map((l) => l.param));
    const next = lanes.length ? { ...t, automation: [...(t.automation ?? []).filter((l) => !taken.has(l.param)), ...lanes] } : t;
    memo?.byTrack.set(t.id, { track: t, key, tempo, names, out: next });
    return next;
  });
  if (memo) {
    if (memo.output && memo.output.length === out.length && out.every((t, i) => t === memo.output![i])) return memo.output;
    memo.output = out;
  }
  return out;
}
