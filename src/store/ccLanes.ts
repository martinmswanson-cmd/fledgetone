import type { AutomationLane, AutomationParam, Clip, ExprPoint, Track } from './timelineTypes';
import { exprValueAt, laneCc, lanesOf } from './expression';
import { normalizePoints, specOf } from '../audio/automation';
import { isLiveParam } from './freeze';

/**
 * A note clip's controller lanes (CC 0 to 119) move its track's settings, as a MIDI controller's
 * knob would: the controller's number picks the setting, by the track's MIDI learn mappings, else
 * the usual meaning of the common controllers (7 volume, 10 pan, 74 cutoff...). Over the song the
 * clips' lanes become automation lanes of their tracks, played by the automation engine live and
 * in exports. A track's own automation lane for the same setting wins. (Plugins also get the
 * controller itself, as MIDI: see the scheduler.) As the MIDI does (ccHold.ts), the setting is the
 * track's own until the first clip's lane, each clip's lane starts at its first point's value from
 * the clip's start (read through points a trim hides), and the value a clip leaves holds until the
 * next clip's lane starts there: a step, never a glide across the gap between clips. Expression
 * (CC 11) scales volume (CC 7) where a track has both.
 */

/** What the common controllers move when the track hasn't mapped them. */
export const DEFAULT_CC_PARAMS: Readonly<Record<number, AutomationParam>> = {
  7: 'volume',
  10: 'pan',
  // Expression: a string or wind player's swell within a phrase, as volume (CC 7 sets the level)
  11: 'volume',
  71: 'filterResonance',
  74: 'filterCutoff',
  91: 'reverbSend',
  93: 'delaySend',
};

/** The setting controller `cc` moves on `track` (undefined: none). */
export function ccTarget(track: Pick<Track, 'midiMap'>, cc: number): AutomationParam | undefined {
  return track.midiMap?.find((m) => m.cc === cc)?.param ?? DEFAULT_CC_PARAMS[cc];
}

type LanePoint = { bar: number; value: number };
const EPS = 1e-9;

/**
 * A clip lane's points as the MIDI plays them (clipCcEvents in ccHold.ts reads the lane at every
 * place in the clip): the ones inside the clip, and where a trim hides some, the lane's value at
 * the clip's start and end read through them.
 */
function visiblePoints(points: readonly ExprPoint[], length: number): ExprPoint[] {
  if (!points.length) return [];
  const valueAt = (at: number) => (at <= points[0].at ? points[0].value : exprValueAt(points, at));
  const inside = points.filter((p) => p.at >= -EPS && p.at <= length + EPS);
  const out = [...inside];
  if (points[0].at < -EPS && !(inside.length && inside[0].at <= EPS)) out.unshift({ at: 0, value: valueAt(0) });
  if (points[points.length - 1].at > length + EPS && !(inside.length && inside[inside.length - 1].at >= length - EPS)) out.push({ at: length, value: valueAt(length) });
  return out;
}

/**
 * A lane's points ready for reading at any bar: `low[i]` is the lowest bar from point i on, which
 * only rises with i, so the last point at or before a bar is found by halving (the points of
 * overlapping clips needn't be in order: the last such point in the list is the one that counts).
 */
interface Indexed {
  list: readonly LanePoint[];
  low: number[];
}
function indexed(list: readonly LanePoint[]): Indexed {
  const low: number[] = new Array(list.length);
  let m = Infinity;
  for (let i = list.length - 1; i >= 0; i--) low[i] = m = Math.min(m, list[i].bar);
  return { list, low };
}
/** The last index whose bar passes `ok` (bar => true there and before it, as `low` rises), else 0. */
function lastIndex({ low }: Indexed, ok: (bar: number) => boolean): number {
  let lo = 0;
  let hi = low.length - 1;
  if (!ok(low[0])) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ok(low[mid])) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
/** A lane's value just after `bar` (its last point there wins), or undefined before it starts. */
function valueAfter(lane: Indexed, bar: number): number | undefined {
  const list = lane.list;
  if (!list.length || bar < list[0].bar - EPS) return undefined;
  const i = lastIndex(lane, (b) => b <= bar + EPS);
  const next = list[i + 1];
  if (!next) return list[i].value;
  return list[i].value + ((next.value - list[i].value) * (bar - list[i].bar)) / Math.max(EPS, next.bar - list[i].bar);
}
/** A lane's value just before `bar` (arriving there), or undefined where it hasn't started before it. */
function valueBefore(lane: Indexed, bar: number): number | undefined {
  const list = lane.list;
  if (!list.length || bar <= list[0].bar + EPS) return undefined;
  const j = lastIndex(lane, (b) => b < bar - EPS);
  const next = list[j + 1];
  if (!next) return list[j].value;
  if (next.bar <= bar + EPS) return next.value;
  return list[j].value + ((next.value - list[j].value) * (bar - list[j].bar)) / Math.max(EPS, next.bar - list[j].bar);
}

/**
 * Volume (CC 7) and expression (CC 11) lanes on one track, as one volume lane: expression scales
 * volume (their values multiply, as MIDI has it); where only one has started, it alone. Read at
 * every point of either and every 64th where both move (the MIDI's own grid).
 */
export function combineVolumeLanes(volumePoints: readonly LanePoint[], expressionPoints: readonly LanePoint[]): LanePoint[] {
  const volume = indexed(volumePoints);
  const expression = indexed(expressionPoints);
  const both = (v: number | undefined, x: number | undefined) => (v === undefined ? x : x === undefined ? v : v * x);
  const bars = [...new Set([...volumePoints, ...expressionPoints].map((p) => p.bar))].sort((a, b) => a - b);
  const out: LanePoint[] = [];
  const moving = (list: Indexed, from: number, to: number) => {
    const a = valueAfter(list, from);
    const b = valueBefore(list, to);
    return a !== undefined && b !== undefined && Math.abs(a - b) > EPS;
  };
  for (let k = 0; k < bars.length; k++) {
    const bar = bars[k];
    const before = both(valueBefore(volume, bar), valueBefore(expression, bar));
    const after = both(valueAfter(volume, bar), valueAfter(expression, bar));
    if (before !== undefined && after !== undefined && Math.abs(before - after) > EPS) out.push({ bar, value: before });
    if (after !== undefined) out.push({ bar, value: after });
    const next = bars[k + 1];
    if (next === undefined || !moving(volume, bar, next) || !moving(expression, bar, next)) continue;
    for (let at = bar + 1 / 64; at < next - EPS; at += 1 / 64) {
      const v = both(valueAfter(volume, at), valueAfter(expression, at));
      if (v !== undefined) out.push({ bar: at, value: v });
    }
  }
  return out;
}

/** Each setting's lane from the clips, before the track's own setting is put in front (see controllerLanes). */
type LaneBodies = Array<[AutomationParam, LanePoint[]]>;

/** What laneBodies reads of the track itself (beside its clips' lanes). */
const bodyDeps = (track: Track) =>
  JSON.stringify([
    (track.automation ?? []).filter((l) => l.points.length).map((l) => l.param),
    track.midiMap ?? null,
    !!(track as { frozenFrom?: string }).frozenFrom,
    !!track.freezing,
  ]);

function laneBodies(track: Track, clips: readonly Clip[]): LaneBodies {
  const own = new Set((track.automation ?? []).filter((l) => l.points.length).map((l) => l.param));
  // Each setting's points from the clips (and expression's own, where volume has a lane too)
  const byParam = new Map<AutomationParam, { main: LanePoint[]; expression: LanePoint[] }>();
  const mine = clips.filter((c) => c.trackId === track.id && c.expression && !c.audio).sort((a, b) => a.startBar - b.startBar);
  for (const clip of mine) {
    for (const lane of lanesOf(clip.expression)) {
      const cc = laneCc(lane);
      if (cc === null) continue;
      const param = ccTarget(track, cc);
      if (!param || own.has(param)) continue;
      // A frozen track: its live settings play live and the rest are in its sound (and the reverse while rendering it)
      if ((track as { frozenFrom?: string }).frozenFrom && !isLiveParam(param)) continue;
      if (track.freezing && isLiveParam(param)) continue;
      const points = visiblePoints(clip.expression![lane] ?? [], clip.lengthBars);
      if (!points.length) continue;
      let lists = byParam.get(param);
      if (!lists) byParam.set(param, (lists = { main: [], expression: [] }));
      const list = param === 'volume' && cc === 11 ? lists.expression : lists.main;
      // Held (what the clip before left) until this clip starts
      const last = list[list.length - 1];
      if (last && last.bar < clip.startBar) list.push({ bar: clip.startBar, value: last.value });
      // From the clip's start, its first point's value (where there's no point at its start)
      if (points[0].at > 1e-9) list.push({ bar: clip.startBar, value: points[0].value });
      for (const p of points) list.push({ bar: clip.startBar + p.at, value: p.value });
    }
  }
  return [...byParam].map(([param, { main, expression }]) => [param, !main.length ? expression : !expression.length ? main : combineVolumeLanes(main, expression)]);
}

/** The track's own setting for each lane (what controllerLanes puts in front of it), as a key. */
const frontKey = (track: Track, bodies: LaneBodies) =>
  bodies.map(([param]) => (param.startsWith('plugin:') ? '' : String(specOf(param, track).trackValue(track)))).join('|');

/** The automation lanes a track's clips' controller lanes make (none when they have none). */
export function controllerLanes(track: Track, clips: readonly Clip[], bodies: LaneBodies = laneBodies(track, clips)): AutomationLane[] {
  return bodies.map(([param, lane]) => {
    const points: LanePoint[] = [];
    // Before it, the track's own setting (a plugin's parameter: as before, the lane's first value)
    if (!param.startsWith('plugin:')) {
      const spec = specOf(param, track);
      const value = spec.toNorm(spec.trackValue(track));
      points.push({ bar: Math.min(1, lane[0].bar), value });
      if (Math.min(1, lane[0].bar) < lane[0].bar) points.push({ bar: lane[0].bar, value });
    }
    return { param, points: normalizePoints([...points, ...lane]) };
  });
}

/** A clip's controller lanes as text, once per lanes object (they're replaced, never changed in place, when edited). */
const lanesText = new WeakMap<object, string>();
const clipLanesText = (expression: NonNullable<Clip['expression']>) => {
  let text = lanesText.get(expression);
  if (text === undefined) {
    text = JSON.stringify(lanesOf(expression).filter((l) => laneCc(l) !== null).map((l) => [l, expression[l]]));
    lanesText.set(expression, text);
  }
  return text;
};
/** A track's clips' controller lanes, as a key (what controllerLanes depends on). */
const laneKey = (clips: readonly Clip[], trackId: string) =>
  clips
    .filter((c) => c.trackId === trackId && c.expression && !c.audio && lanesOf(c.expression).some((l) => laneCc(l) !== null))
    .map((c) => `${c.startBar}|${c.lengthBars}|${clipLanesText(c.expression!)}`)
    .join(';');

export interface ControllerMemo {
  byTrack: Map<string, { track: Track; key: string; deps: string; bodies: LaneBodies; front: string; lanes: AutomationLane[]; out: Track }>;
  input: readonly Track[] | null;
  output: Track[] | null;
}
export const controllerMemo = (): ControllerMemo => ({ byTrack: new Map(), input: null, output: null });

/**
 * The tracks with their clips' controller lanes added to their automation. The same track objects
 * (and, with `memo`, the same array) while nothing that matters changes, so the engine leaves
 * their strips alone.
 */
export function withControllerLanes(tracks: Track[], clips: readonly Clip[], memo?: ControllerMemo): Track[] {
  if (!clips.some((c) => c.expression && lanesOf(c.expression).some((l) => laneCc(l) !== null))) {
    if (memo) {
      memo.byTrack.clear();
      memo.input = tracks;
      memo.output = tracks;
    }
    return tracks;
  }
  const out = tracks.map((t) => {
    const key = laneKey(clips, t.id);
    if (!key) return t;
    const hit = memo?.byTrack.get(t.id);
    if (hit && hit.track === t && hit.key === key) return hit.out;
    // The track changed (its pan, fader, name...) but not what its lanes are made from: the same
    // lanes, with its own setting in front of them again
    const deps = bodyDeps(t);
    const same = !!hit && hit.key === key && hit.deps === deps;
    const bodies = same ? hit.bodies : laneBodies(t, clips);
    // (And the very same lanes where its own setting for them hasn't changed: a pan change leaves a volume lane be)
    const front = frontKey(t, bodies);
    const lanes = same && hit.front === front ? hit.lanes : controllerLanes(t, clips, bodies);
    const next = lanes.length ? { ...t, automation: [...(t.automation ?? []), ...lanes] } : t;
    memo?.byTrack.set(t.id, { track: t, key, deps, bodies, front, lanes, out: next });
    return next;
  });
  if (memo) {
    if (memo.output && memo.output.length === out.length && out.every((t, i) => t === memo.output![i])) return memo.output;
    memo.input = tracks;
    memo.output = out;
  }
  return out;
}
