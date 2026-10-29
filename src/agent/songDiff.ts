/**
 * What changed between two versions of a song, in plain words: tracks, clips, notes, markers,
 * tempo and master matched by id, each change a sentence ("Turns "Bass" up by 3 dB (-6 to -3
 * dB).") with the tracks, clips and bars it touches. Also the bars worth listening to: the touched
 * bars and one before them, so a suggestion is heard coming in. Plain logic, used by applyOps, the
 * command line's diff and the studio's suggestion cards.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationLane, Clip, MasterSettings, NoteEvent, Track } from '../store/timelineTypes';
import { durationToBars } from '../store/timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { formatPan, specOf } from '../audio/automation';
import { stableJson } from './fingerprint';

/** One change, in plain words, with what it touches. */
export interface SongChange {
  text: string;
  trackId?: string;
  clipId?: string;
  markerId?: string;
  /** The song bars it touches (end not included), when it sits somewhere in particular. */
  fromBar?: number;
  toBar?: number;
}

/** A range of song bars, end not included. */
export interface BarRange {
  fromBar: number;
  toBar: number;
}

export interface SongDiff {
  changes: SongChange[];
  /** Tracks changed, added or removed (ids from either version). */
  touchedTracks: string[];
  /** Clips changed, added or removed, linked copies that followed included. */
  touchedClips: string[];
  touchedMarkers: string[];
  tempoChanged: boolean;
  masterChanged: boolean;
  /** The bars the located changes span, or null when nothing sits anywhere in particular (a mix change). */
  bars: BarRange | null;
  /** What to listen to: the touched bars and one before, at most AUDITION_MAX_BARS. */
  audition: BarRange;
}

/** The longest stretch a before-and-after plays. */
export const AUDITION_MAX_BARS = 16;

const INSERT_LABELS: Record<string, string> = {
  distortion: 'Distortion',
  compressor: 'Compressor',
  chorus: 'Chorus',
  filter: 'Filter',
  pump: 'Pump',
  lofi: 'Lo-fi',
  gate: 'Gate',
  echo: 'Delay',
  reverb: 'Reverb',
  human: 'Human',
  peq: 'Parametric EQ',
  mbc: 'Multiband compressor',
  saturate: 'Saturation',
  monoLow: 'Mono bass',
  bassDrive: 'Bass Drive',
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const db = (v: number) => `${v > 0 ? '+' : ''}${r1(v)} dB`;
const bars = (from: number, to: number) => {
  const a = Math.floor(from + 1e-9);
  const b = Math.max(a, Math.ceil(to - 1e-9) - 1);
  return a === b ? `bar ${a}` : `bars ${a}-${b}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const same = (a: unknown, b: unknown) => a === b || stableJson(a) === stableJson(b);
const noteEnd = (n: NoteEvent) => n.startOffset + durationToBars(n.duration);

/** The changes from `before` to `after`. */
export function diffSongs(before: ProjectSnapshot, after: ProjectSnapshot): SongDiff {
  const changes: SongChange[] = [];
  const touchedTracks = new Set<string>();
  const touchedClips = new Set<string>();
  const touchedMarkers = new Set<string>();
  const add = (c: SongChange) => {
    changes.push(c);
    if (c.trackId) touchedTracks.add(c.trackId);
    if (c.clipId) touchedClips.add(c.clipId);
    if (c.markerId) touchedMarkers.add(c.markerId);
  };
  const trackName = (id: string) => `"${(after.tracks.find((t) => t.id === id) ?? before.tracks.find((t) => t.id === id))?.name ?? 'a track'}"`;

  // ---------- Tempo ----------
  let tempoChanged = false;
  if (before.bpm !== after.bpm) {
    tempoChanged = true;
    add({ text: `Changes the tempo from ${r1(before.bpm)} to ${r1(after.bpm)} BPM.` });
  }
  const bPoints = before.tempoPoints ?? [];
  const aPoints = after.tempoPoints ?? [];
  for (const p of aPoints) {
    const old = bPoints.find((o) => o.id === p.id);
    if (!old) add({ text: `Adds a tempo change to ${r1(p.bpm)} BPM at bar ${r1(p.bar)}${p.ramp ? ', ramping into it' : ''}.`, fromBar: p.bar, toBar: p.bar + 1 });
    else if (!same(old, p)) add({ text: `Changes the tempo change at bar ${r1(old.bar)} to ${r1(p.bpm)} BPM at bar ${r1(p.bar)}.`, fromBar: Math.min(old.bar, p.bar), toBar: Math.max(old.bar, p.bar) + 1 });
  }
  for (const p of bPoints) if (!aPoints.some((o) => o.id === p.id)) add({ text: `Removes the tempo change at bar ${r1(p.bar)} (${r1(p.bpm)} BPM).`, fromBar: p.bar, toBar: p.bar + 1 });
  tempoChanged ||= !same(bPoints, aPoints);

  // ---------- Master ----------
  const masterBefore = changes.length;
  diffMaster(before.master, after.master, add);
  const masterChanged = changes.length > masterBefore;

  // ---------- Tracks ----------
  for (const t of after.tracks) {
    const old = before.tracks.find((o) => o.id === t.id);
    if (!old) {
      add({ text: `Adds a track: "${t.name}" (${INSTRUMENTS[t.instrumentKey]?.name ?? t.instrumentKey}).`, trackId: t.id });
      continue;
    }
    if (old !== t && !same(old, t)) diffTrack(old, t, after.tracks, add);
  }
  for (const t of before.tracks) if (!after.tracks.some((o) => o.id === t.id)) add({ text: `Removes the track "${t.name}" and its clips.`, trackId: t.id });

  // ---------- Clips ----------
  for (const c of after.clips) {
    const old = before.clips.find((o) => o.id === c.id);
    if (!old) {
      add({ text: `Adds the clip "${c.name}" on ${trackName(c.trackId)} at ${bars(c.startBar, c.startBar + c.lengthBars)}${c.notes.length ? `, ${plural(c.notes.length, 'note')}` : ''}${c.pattern && before.clips.some((o) => o.pattern === c.pattern) ? ', linked to the clips it was copied from' : ''}.`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: c.startBar + c.lengthBars });
      continue;
    }
    if (old !== c) diffClip(old, c, trackName, add);
  }
  for (const c of before.clips) {
    if (!after.clips.some((o) => o.id === c.id) && after.tracks.some((t) => t.id === c.trackId))
      add({ text: `Removes the clip "${c.name}" from ${trackName(c.trackId)} (${bars(c.startBar, c.startBar + c.lengthBars)}).`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: c.startBar + c.lengthBars });
  }

  // ---------- Markers ----------
  const bm = before.markers ?? [];
  const am = after.markers ?? [];
  for (const m of am) {
    const old = bm.find((o) => o.id === m.id);
    if (!old) add({ text: `Adds the marker "${m.name}" at bar ${r1(m.bar)}.`, markerId: m.id, fromBar: m.bar, toBar: m.bar + 1 });
    else {
      if (old.name !== m.name) add({ text: `Renames the marker "${old.name}" to "${m.name}".`, markerId: m.id });
      if (Math.abs(old.bar - m.bar) > 1e-6 && !tempoChanged) add({ text: `Moves the marker "${m.name}" from bar ${r1(old.bar)} to bar ${r1(m.bar)}.`, markerId: m.id, fromBar: Math.min(old.bar, m.bar), toBar: Math.max(old.bar, m.bar) + 1 });
    }
  }
  for (const m of bm) if (!am.some((o) => o.id === m.id)) add({ text: `Removes the marker "${m.name}" (bar ${r1(m.bar)}).`, markerId: m.id });

  // ---------- Where ----------
  const located = changes.filter((c) => c.fromBar !== undefined && c.toBar !== undefined);
  const range = located.length ? { fromBar: Math.min(...located.map((c) => c.fromBar!)), toBar: Math.max(...located.map((c) => c.toBar!)) } : null;
  return {
    changes,
    touchedTracks: [...touchedTracks],
    touchedClips: [...touchedClips],
    touchedMarkers: [...touchedMarkers],
    tempoChanged,
    masterChanged,
    bars: range,
    audition: auditionRange(range, after, [...touchedTracks]),
  };
}

/**
 * The bars to hear a change in: from one bar before the touched bars, at most AUDITION_MAX_BARS.
 * A change that sits nowhere in particular (a track's level) plays where that track first plays;
 * a tempo or master change, the start of the song.
 */
export function auditionRange(range: BarRange | null, song: Pick<ProjectSnapshot, 'clips'>, tracks: readonly string[] = []): BarRange {
  const fit = (from: number, to: number): BarRange => {
    const a = Math.max(1, Math.floor(from + 1e-9));
    const b = Math.max(a + 1, Math.ceil(to - 1e-9));
    return { fromBar: a, toBar: Math.min(b, a + AUDITION_MAX_BARS) };
  };
  if (range) return fit(range.fromBar - 1, range.toBar);
  const clips = song.clips.filter((c) => tracks.includes(c.trackId));
  if (clips.length) {
    const start = Math.min(...clips.map((c) => c.startBar));
    return fit(start, start + 8);
  }
  const end = song.clips.reduce((e, c) => Math.max(e, c.startBar + c.lengthBars), 1);
  return fit(1, Math.min(end, 9));
}

function diffMaster(a: MasterSettings | undefined, b: MasterSettings | undefined, add: (c: SongChange) => void) {
  if (!a || !b || same(a, b)) return;
  if (a.level !== b.level) add({ text: `Turns the master Level ${b.level > a.level ? 'up' : 'down'} by ${r1(Math.abs(b.level - a.level))} dB (${db(a.level)} to ${db(b.level)}).` });
  if (a.glue !== b.glue) add({ text: `Sets the master compressor to ${b.glue}.` });
  const part = (label: string, x: unknown, y: unknown) => {
    const on = (v: unknown) => !!(v as { on?: boolean } | undefined)?.on;
    if (same(x, y)) return;
    if (on(x) !== on(y)) add({ text: `Turns ${on(y) ? 'on' : 'off'} the master ${label}.` });
    else if (on(y)) add({ text: `Changes the master ${label} (${settingChanges(x, y)}).` });
  };
  part('OTT', a.ott, b.ott);
  part('stereo width', a.width, b.width);
  part('Loud', a.loud, b.loud);
  part('clipper', a.clipper, b.clipper);
  if (!!a.monoLow !== !!b.monoLow) add({ text: `${b.monoLow ? 'Keeps' : 'Stops keeping'} the master's low end in the middle.` });
}

/** "cutoff 1000 to 800, mix 0.3 to 0.5": the settings of an object that differ. */
function settingChanges(x: unknown, y: unknown): string {
  const a = (x ?? {}) as Record<string, unknown>;
  const b = (y ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'on' || same(a[k], b[k])) continue;
    const show = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v === undefined ? 'none' : typeof v === 'object' ? 'changed' : String(v));
    out.push(typeof b[k] === 'object' ? `${k} changed` : `${k} ${show(a[k])} to ${show(b[k])}`);
  }
  return out.slice(0, 4).join(', ') + (out.length > 4 ? `, and ${out.length - 4} more` : '');
}

function diffTrack(a: Track, b: Track, tracks: readonly Track[], add: (c: SongChange) => void) {
  const n = `"${b.name}"`;
  const at = { trackId: b.id };
  if (a.name !== b.name) add({ text: `Renames the track "${a.name}" to "${b.name}".`, ...at });
  if (a.instrumentKey !== b.instrumentKey) add({ text: `${n} plays ${INSTRUMENTS[b.instrumentKey]?.name ?? b.instrumentKey} instead of ${INSTRUMENTS[a.instrumentKey]?.name ?? a.instrumentKey}.`, ...at });
  if (a.volume !== b.volume) add({ text: `Turns ${n} ${b.volume > a.volume ? 'up' : 'down'} by ${r1(Math.abs(b.volume - a.volume))} dB (${db(a.volume)} to ${db(b.volume)}).`, ...at });
  if (a.pan !== b.pan) add({ text: `Pans ${n} to ${formatPan(b.pan)} (was ${formatPan(a.pan)}).`, ...at });
  if (a.isMuted !== b.isMuted) add({ text: `${b.isMuted ? 'Mutes' : 'Unmutes'} ${n}.`, ...at });
  if (a.isSoloed !== b.isSoloed) add({ text: `${b.isSoloed ? 'Solos' : 'Unsolos'} ${n}.`, ...at });
  if (a.reverbSend !== b.reverbSend) add({ text: `Changes ${n}'s reverb send from ${r1(a.reverbSend * 100)}% to ${r1(b.reverbSend * 100)}%.`, ...at });
  if (a.delaySend !== b.delaySend) add({ text: `Changes ${n}'s delay send from ${r1(a.delaySend * 100)}% to ${r1(b.delaySend * 100)}%.`, ...at });
  if ((a.distance ?? 0) !== (b.distance ?? 0)) add({ text: `Moves ${n} ${(b.distance ?? 0) > (a.distance ?? 0) ? 'further back' : 'closer'} on the stage (distance ${r1(a.distance ?? 0)} to ${r1(b.distance ?? 0)}).`, ...at });
  if ((a.output ?? null) !== (b.output ?? null)) add({ text: `${n} plays into ${b.output ? `"${tracks.find((t) => t.id === b.output)?.name ?? 'a bus'}"` : 'the master'}.`, ...at });
  if (!same(a.eq, b.eq)) {
    const parts = (['low', 'mid', 'high'] as const).filter((k) => a.eq[k] !== b.eq[k]).map((k) => `${k} ${db(b.eq[k])}`);
    add({ text: `Sets ${n}'s EQ: ${parts.join(', ')}.`, ...at });
  }
  if (!same(a.fx, b.fx)) {
    for (const k of new Set([...Object.keys(a.fx), ...Object.keys(b.fx)])) {
      const x = (a.fx as unknown as Record<string, unknown>)[k];
      const y = (b.fx as unknown as Record<string, unknown>)[k];
      if (same(x, y)) continue;
      const label = INSERT_LABELS[k] ?? k;
      const on = (v: unknown) => !!(v as { on?: boolean } | undefined)?.on;
      if (on(x) !== on(y)) add({ text: `Turns ${on(y) ? 'on' : 'off'} ${n}'s ${label}${on(y) ? ` (${settingChanges(x, y) || 'as it was set'})` : ''}.`, ...at });
      else add({ text: `Changes ${n}'s ${label}${on(y) ? '' : ' (switched off)'}: ${settingChanges(x, y)}.`, ...at });
    }
  }
  if (!same(a.synth, b.synth) && a.instrumentKey === b.instrumentKey) add({ text: `Gives ${n} a new synth sound.`, ...at });
  if (!same(a.automation, b.automation)) diffLanes(a, b, tracks, add);
  if (!same(a.sends, b.sends)) add({ text: `Changes ${n}'s sends to the returns.`, ...at });
  const known = new Set(['name', 'instrumentKey', 'color', 'volume', 'pan', 'isMuted', 'isSoloed', 'reverbSend', 'delaySend', 'distance', 'output', 'eq', 'fx', 'synth', 'automation', 'sends', 'drumDesign']);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  if (other.length) add({ text: `Changes ${n}'s other settings (${other.join(', ')}).`, ...at });
}

function diffLanes(a: Track, b: Track, tracks: readonly Track[], add: (c: SongChange) => void) {
  const n = `"${b.name}"`;
  const label = (l: AutomationLane) => specOf(l.param, b, tracks).label;
  const span = (lanes: AutomationLane[]) => {
    const all = lanes.flatMap((l) => l.points.map((p) => p.bar));
    return all.length ? { fromBar: Math.min(...all), toBar: Math.max(...all) + 1 } : {};
  };
  const before = a.automation ?? [];
  const after = b.automation ?? [];
  for (const l of after) {
    const old = before.find((o) => o.param === l.param);
    if (!old) add({ text: `Draws ${label(l)} automation on ${n} (${plural(l.points.length, 'point')}).`, trackId: b.id, ...span([l]) });
    else if (!same(old, l)) add({ text: `Redraws ${n}'s ${label(l)} automation (${plural(l.points.length, 'point')}, was ${old.points.length}).`, trackId: b.id, ...changedSpan(old, l) });
  }
  for (const l of before) if (!after.some((o) => o.param === l.param)) add({ text: `Removes ${n}'s ${label(l)} automation.`, trackId: b.id, ...span([l]) });
}

/** The bars over which two versions of a lane differ. */
function changedSpan(a: AutomationLane, b: AutomationLane): Partial<BarRange> {
  const key = (p: { bar: number; value: number; curve?: number }) => `${p.bar}:${p.value}:${p.curve ?? 0}`;
  const inA = new Set(a.points.map(key));
  const inB = new Set(b.points.map(key));
  const bars = [...a.points.filter((p) => !inB.has(key(p))), ...b.points.filter((p) => !inA.has(key(p)))].map((p) => p.bar);
  return bars.length ? { fromBar: Math.min(...bars), toBar: Math.max(...bars) + 1 } : {};
}

function diffClip(a: Clip, b: Clip, trackName: (id: string) => string, add: (c: SongChange) => void) {
  const n = `"${b.name}"`;
  const at = { trackId: b.trackId, clipId: b.id };
  if (a.trackId !== b.trackId) add({ text: `Moves the clip ${n} from ${trackName(a.trackId)} to ${trackName(b.trackId)}.`, ...at, fromBar: b.startBar, toBar: b.startBar + b.lengthBars });
  if (Math.abs(a.startBar - b.startBar) > 1e-9)
    add({ text: `Moves the clip ${n} from bar ${r1(a.startBar)} to bar ${r1(b.startBar)}.`, ...at, fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(a.startBar + a.lengthBars, b.startBar + b.lengthBars) });
  if (Math.abs(a.lengthBars - b.lengthBars) > 1e-9)
    add({ text: `Makes the clip ${n} ${r1(b.lengthBars)} bars long (was ${r1(a.lengthBars)}).`, ...at, fromBar: b.startBar + Math.min(a.lengthBars, b.lengthBars), toBar: b.startBar + Math.max(a.lengthBars, b.lengthBars) });
  if (a.name !== b.name) add({ text: `Renames the clip "${a.name}" to ${n}.`, ...at });
  if (a.notes !== b.notes && !same(a.notes, b.notes)) {
    const before = new Map(a.notes.map((x) => [x.id, x]));
    const after = new Map(b.notes.map((x) => [x.id, x]));
    const added = b.notes.filter((x) => !before.has(x.id));
    const removed = a.notes.filter((x) => !after.has(x.id));
    const changed = b.notes.filter((x) => before.has(x.id) && !same(before.get(x.id), x));
    const touched = [...added, ...removed, ...changed, ...changed.map((x) => before.get(x.id)!)];
    const parts = [added.length && `adds ${plural(added.length, 'note')}`, changed.length && `changes ${plural(changed.length, 'note')}`, removed.length && `removes ${plural(removed.length, 'note')}`].filter(Boolean);
    const from = b.startBar + Math.max(0, Math.min(...touched.map((x) => x.startOffset)));
    const to = b.startBar + Math.min(b.lengthBars, Math.max(...touched.map(noteEnd)));
    const where = to > from ? ` in ${bars(from, to)}` : '';
    add({ text: `In ${n} on ${trackName(b.trackId)}: ${parts.join(', ')}${where}.`, ...at, fromBar: from, toBar: Math.max(to, from + 1 / 16) });
  }
  if ((a.pattern ?? null) !== (b.pattern ?? null)) add({ text: b.pattern ? `Links the clip ${n} to its copies.` : `Unlinks the clip ${n} from its copies.`, ...at });
  for (const k of ['expression', 'groove', 'wobble', 'stepLanes'] as const) if (!same(a[k], b[k])) add({ text: `Changes the clip ${n}'s ${k === 'stepLanes' ? 'step lanes' : k}.`, ...at, fromBar: b.startBar, toBar: b.startBar + b.lengthBars });
}
