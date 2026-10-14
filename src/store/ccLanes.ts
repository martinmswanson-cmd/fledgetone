import type { AutomationLane, AutomationParam, Clip, Track } from './timelineTypes';
import { laneCc, lanesOf } from './expression';
import { normalizePoints } from '../audio/automation';
import { isLiveParam } from './freeze';

/**
 * A note clip's controller lanes (CC 0 to 119) move its track's settings, as a MIDI controller's
 * knob would: the controller's number picks the setting, by the track's MIDI learn mappings, else
 * the usual meaning of the common controllers (7 volume, 10 pan, 74 cutoff...). Over the song the
 * clips' lanes become automation lanes of their tracks, played by the automation engine live and
 * in exports. A track's own automation lane for the same setting wins. (Plugins also get the
 * controller itself, as MIDI: see the scheduler.)
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

/** The automation lanes a track's clips' controller lanes make (none when they have none). */
export function controllerLanes(track: Track, clips: readonly Clip[]): AutomationLane[] {
  const own = new Set((track.automation ?? []).filter((l) => l.points.length).map((l) => l.param));
  const byParam = new Map<AutomationParam, Array<{ bar: number; value: number }>>();
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
      const points = (clip.expression![lane] ?? []).filter((p) => p.at >= -1e-9 && p.at <= clip.lengthBars + 1e-9);
      if (!points.length) continue;
      const list = byParam.get(param) ?? [];
      for (const p of points) list.push({ bar: clip.startBar + p.at, value: p.value });
      byParam.set(param, list);
    }
  }
  return [...byParam].map(([param, points]) => ({ param, points: normalizePoints(points) }));
}

/** A clip's controller lanes, as a key (what controllerLanes depends on). */
const laneKey = (clips: readonly Clip[], trackId: string) =>
  clips
    .filter((c) => c.trackId === trackId && c.expression && lanesOf(c.expression).some((l) => laneCc(l) !== null))
    .map((c) => `${c.startBar}|${c.lengthBars}|${JSON.stringify(lanesOf(c.expression).filter((l) => laneCc(l) !== null).map((l) => [l, c.expression![l]]))}`)
    .join(';');

export interface ControllerMemo {
  byTrack: Map<string, { track: Track; key: string; out: Track }>;
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
    const lanes = controllerLanes(t, clips);
    const next = lanes.length ? { ...t, automation: [...(t.automation ?? []), ...lanes] } : t;
    memo?.byTrack.set(t.id, { track: t, key, out: next });
    return next;
  });
  if (memo) {
    if (memo.output && memo.output.length === out.length && out.every((t, i) => t === memo.output![i])) return memo.output;
    memo.input = tracks;
    memo.output = out;
  }
  return out;
}
