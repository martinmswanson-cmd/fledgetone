/**
 * What changed between two versions of a song, in plain words: tracks, clips, notes, markers,
 * tempo, time signature and master matched by id, each change a sentence ("Turns "Bass" up by 3 dB
 * (-6 to -3 dB).") with the tracks, clips and bars it touches. The names in a sentence are the
 * song's, which an agent may have written: each is kept apart (names.ts), shown as a chip of its
 * own on a card (`marked`) and in plain quotes, its own quotes and brackets taken out, everywhere
 * else (`text`). Also where each change is heard (`heard`, and all of them together in `regions`),
 * by rules that are never fewer bars than the truth: notes or a clip, its bars and its notes' tail
 * (the release, the track's effects and those of everything it plays into, as long as they ring:
 * trackTails; a tail not known here, a plugin's, leaves them not `sure`); one of a track's sound (its level, pan, instrument,
 * inserts, sends, routing...) or of its automation (a lane holds before and after its points), and
 * any change of a clip with controller or step lanes (what they hold carries into the track's
 * later clips), the bars where that track sounds (its clips with their tails, and the clips of
 * every track playing into it, when it's a bus or a return); a tempo or time signature change at
 * bar N, bar N to the end (from the change before it, when a glide starts there); one for the
 * whole song (the tempo, the time signature, the master, a solo) or anything not known here, the
 * whole song; a name, a marker or a link, nowhere (nothing to hear). The studio adds the bars it
 * finds by sound (whereHeard.ts). Plain logic, used by applyOps, the command line's diff and the
 * studio's suggestion cards.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationLane, Clip, MasterSettings, NoteEvent, Track } from '../store/timelineTypes';
import { DEFAULT_MASTER_FX, durationToBars } from '../store/timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { formatPan, specOf } from '../audio/automation';
import { barToSeconds, FOUR_FOUR, isPlainMeter, secondsToBar, toMeasureBeat, type MeterMap, type TempoPoint } from '../audio/tempoMap';
import { RELEASE_ALLOWANCE_SECONDS, releaseSeconds } from '../audio/auditionMath';
import { insertTailSeconds, masterDelaySeconds, masterReverbSeconds } from '../audio/effectTails';
import { busOf, liveSends } from '../store/buses';
import { stableJson } from './fingerprint';
import { plainToken } from './agentText';
import { nm, plainNames } from './names';

/**
 * Where a change is heard: 'here' (its own bars, fromBar to toBar, and, for a change on a track,
 * past toBar by that track's tail: its notes' release and its effects), 'track' (wherever its
 * track sounds), 'from' (from its fromBar to the end of the song), 'song' (the whole song),
 * 'silent' (nowhere: a name, a marker, a link). Unsaid: 'song' (what isn't known to sit somewhere
 * is taken to be heard everywhere: never less than the truth).
 */
export type HearWhere = 'here' | 'track' | 'from' | 'song' | 'silent';

/** One change, in plain words, with what it touches. */
export interface SongChange {
  /** In plain words, each name in plain quotes (names.ts plainNames). */
  text: string;
  /** The same with each name marked (names.ts nm), for showing the names apart. */
  marked?: string;
  trackId?: string;
  clipId?: string;
  markerId?: string;
  /** The song bars it touches (end not included), when it sits somewhere in particular. */
  fromBar?: number;
  toBar?: number;
  /** How its `heard` was found (see HearWhere). */
  hear?: HearWhere;
  /** The whole bars it's heard in, in order (none: nothing to hear). */
  heard?: BarRange[];
  /** False: `heard` counts a tail not known here (a plugin's, an instrument's release: see TrackTail), so it may be fewer bars than the truth. */
  sure?: false;
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
  /**
   * Where the changes are heard, all of them: whole bars, in order, overlapping and touching
   * ones joined (empty: nothing to hear, only names, markers or links changed). What a
   * before-and-after has to play for it to count as heard (see hearingPlan in suggestionsStore.ts).
   */
  regions: BarRange[];
  /**
   * Whether `regions` are sure to hold every bar a change is heard in: false when a change's tail
   * isn't known here (a plugin's, an instrument's release: see TrackTail). Then only the studio's
   * check by sound (whereHeard.ts) makes them sure.
   */
  sure: boolean;
  /** A stretch to listen to first: the first region from one bar before, at most AUDITION_MAX_BARS (for a file's suggestion). */
  audition: BarRange;
}

/** The longest stretch `audition` names. */
export const AUDITION_MAX_BARS = 16;

/** How long a track's inserts other than its Delay and Reverb (a compressor's release, a chorus) are allowed to ring on, seconds (see TrackTail). */
export const EFFECT_TAIL_SECONDS = 1.5;

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
/**
 * The song's time signatures while diffSongs words its sentences, when they aren't plain 4/4
 * throughout (null: they are, and a bar is a measure): its bars are then named as the ruler numbers
 * them, by measure (wordMeter).
 */
let sentenceMeter: MeterMap | null = null;
/** The meters of `song`, for words: null when it's plain 4/4 throughout (a bar is a measure). */
export const wordMeter = (song: Pick<ProjectSnapshot, 'meter' | 'meterPoints'>): MeterMap | null => {
  const map: MeterMap = { base: song.meter ?? FOUR_FOUR, points: song.meterPoints ?? [] };
  return isPlainMeter(map) ? null : map;
};
const bars = (from: number, to: number) => barWords({ fromBar: from, toBar: to }, sentenceMeter);
/** "bar 7.5", or in a song not in 4/4, the measure (and beat) the ruler shows there: "bar 9", "bar 9 beat 2". */
const barAt = (bar: number): string => {
  if (!sentenceMeter) return `bar ${r1(bar)}`;
  const m = toMeasureBeat(bar, sentenceMeter);
  return m.beat === 1 && m.hundredths === 0 ? `bar ${m.measure}` : `bar ${m.measure} beat ${r1(m.beat + m.hundredths / 100)}`;
};
/** A clip's length: "4 bars", or in a song not in 4/4 (where a bar isn't a measure) in quarter notes. */
const lengthWords = (lengthBars: number): string => (sentenceMeter ? `${r1(lengthBars * 4)} quarter notes` : `${r1(lengthBars)} bars`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const same = (a: unknown, b: unknown) => a === b || stableJson(a) === stableJson(b);
const noteEnd = (n: NoteEvent) => n.startOffset + durationToBars(n.duration);

/** The changes from `before` to `after` (their bars named in words as `before`'s ruler numbers them: see wordMeter). */
export function diffSongs(before: ProjectSnapshot, after: ProjectSnapshot): SongDiff {
  const was = sentenceMeter;
  sentenceMeter = wordMeter(before);
  try {
    return diffWith(before, after);
  } finally {
    sentenceMeter = was;
  }
}

function diffWith(before: ProjectSnapshot, after: ProjectSnapshot): SongDiff {
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
  const trackName = (id: string) => {
    const t = after.tracks.find((x) => x.id === id) ?? before.tracks.find((x) => x.id === id);
    return t ? nm(t.name) : 'a track';
  };

  // ---------- Tempo ----------
  let tempoChanged = false;
  if (before.bpm !== after.bpm) {
    tempoChanged = true;
    add({ text: `Changes the tempo from ${r1(before.bpm)} to ${r1(after.bpm)} BPM.`, hear: 'song' });
  }
  const bPoints = before.tempoPoints ?? [];
  const aPoints = after.tempoPoints ?? [];
  const tempoFrom = tempoChangeStart(bPoints, aPoints);
  for (const p of aPoints) {
    const old = bPoints.find((o) => o.id === p.id);
    if (!old) add({ text: `Adds a tempo change to ${r1(p.bpm)} BPM at ${barAt(p.bar)}${p.ramp ? ', ramping into it' : ''}.`, fromBar: tempoFrom(p.id, p.bar), toBar: p.bar + 1, hear: 'from' });
    else if (!same(old, p)) add({ text: `Changes the tempo change at ${barAt(old.bar)} to ${r1(p.bpm)} BPM at ${barAt(p.bar)}.`, fromBar: tempoFrom(p.id, Math.min(old.bar, p.bar)), toBar: Math.max(old.bar, p.bar) + 1, hear: 'from' });
  }
  for (const p of bPoints) if (!aPoints.some((o) => o.id === p.id)) add({ text: `Removes the tempo change at ${barAt(p.bar)} (${r1(p.bpm)} BPM).`, fromBar: tempoFrom(p.id, p.bar), toBar: p.bar + 1, hear: 'from' });
  tempoChanged ||= !same(bPoints, aPoints);

  // ---------- Time signature ----------
  const meter = (m: { num: number; den: number } | undefined) => (m ? `${m.num}/${m.den}` : '4/4');
  if (meter(before.meter) !== meter(after.meter)) add({ text: `Changes the time signature from ${meter(before.meter)} to ${meter(after.meter)}.`, hear: 'song' });
  const bMeters = before.meterPoints ?? [];
  const aMeters = after.meterPoints ?? [];
  for (const p of aMeters) {
    const old = bMeters.find((o) => o.id === p.id);
    if (!old) add({ text: `Adds a change of time signature to ${meter(p)} at ${barAt(p.bar)}.`, fromBar: p.bar, toBar: p.bar + 1, hear: 'from' });
    else if (!same(old, p)) add({ text: `Changes the time signature change at ${barAt(old.bar)} to ${meter(p)} at ${barAt(p.bar)}.`, fromBar: Math.min(old.bar, p.bar), toBar: Math.max(old.bar, p.bar) + 1, hear: 'from' });
  }
  for (const p of bMeters) if (!aMeters.some((o) => o.id === p.id)) add({ text: `Removes the change of time signature at ${barAt(p.bar)} (${meter(p)}).`, fromBar: p.bar, toBar: p.bar + 1, hear: 'from' });

  // ---------- Master ----------
  const masterBefore = changes.length;
  diffMaster(before.master, after.master, add);
  const masterChanged = changes.length > masterBefore;

  // ---------- Tracks ----------
  for (const t of after.tracks) {
    const old = before.tracks.find((o) => o.id === t.id);
    if (!old) {
      add({ text: `Adds a track: ${nm(t.name)} (${INSTRUMENTS[t.instrumentKey]?.name ?? t.instrumentKey}).`, trackId: t.id, hear: 'track' });
      continue;
    }
    if (old !== t && !same(old, t)) diffTrack(old, t, after.tracks, add);
  }
  for (const t of before.tracks) if (!after.tracks.some((o) => o.id === t.id)) add({ text: `Removes the track ${nm(t.name)} and its clips.`, trackId: t.id, hear: 'track' });

  // ---------- Clips ----------
  for (const c of after.clips) {
    const old = before.clips.find((o) => o.id === c.id);
    if (!old) {
      add({ text: `Adds the clip ${nm(c.name)} on ${trackName(c.trackId)} at ${bars(c.startBar, c.startBar + c.lengthBars)}${c.notes.length ? `, ${plural(c.notes.length, 'note')}` : ''}${c.pattern && before.clips.some((o) => o.pattern === c.pattern) ? ', linked to the clips it was copied from' : ''}.`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: c.startBar + c.lengthBars, hear: hasLanes(c) ? 'track' : 'here' });
      continue;
    }
    if (old !== c) diffClip(old, c, trackName, add);
  }
  for (const c of before.clips) {
    if (!after.clips.some((o) => o.id === c.id) && after.tracks.some((t) => t.id === c.trackId))
      add({ text: `Removes the clip ${nm(c.name)} from ${trackName(c.trackId)} (${bars(c.startBar, c.startBar + c.lengthBars)}).`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: c.startBar + c.lengthBars, hear: hasLanes(c) ? 'track' : 'here' });
  }

  // ---------- Markers ----------
  const bm = before.markers ?? [];
  const am = after.markers ?? [];
  for (const m of am) {
    const old = bm.find((o) => o.id === m.id);
    if (!old) add({ text: `Adds the marker ${nm(m.name)} at ${barAt(m.bar)}.`, markerId: m.id, fromBar: m.bar, toBar: m.bar + 1, hear: 'silent' });
    else {
      if (old.name !== m.name) add({ text: `Renames the marker ${nm(old.name)} to ${nm(m.name)}.`, markerId: m.id, hear: 'silent' });
      // A tempo change moves a marker held to its time by itself: only a move beyond that is the suggestion's
      const retimed = old.anchor === 'time' ? secondsToBar(old.seconds, { bpm: after.bpm, points: after.tempoPoints ?? [] }) : old.bar;
      if (Math.abs(old.bar - m.bar) > 1e-6 && Math.abs(retimed - m.bar) > 1e-6) add({ text: `Moves the marker ${nm(m.name)} from ${barAt(old.bar)} to ${barAt(m.bar)}.`, markerId: m.id, fromBar: Math.min(old.bar, m.bar), toBar: Math.max(old.bar, m.bar) + 1, hear: 'silent' });
    }
  }
  for (const m of bm) if (!am.some((o) => o.id === m.id)) add({ text: `Removes the marker ${nm(m.name)} (${barAt(m.bar)}).`, markerId: m.id, hear: 'silent' });

  // ---------- Where ----------
  for (const c of changes) {
    c.marked = c.text;
    c.text = plainNames(c.text);
  }
  const located = changes.filter((c) => c.fromBar !== undefined && c.toBar !== undefined && c.hear !== 'silent');
  const range = located.length ? { fromBar: Math.min(...located.map((c) => c.fromBar!)), toBar: Math.max(...located.map((c) => c.toBar!)) } : null;
  const where = hearing(before, after);
  let sure = true;
  for (const c of changes) {
    const w = where(c);
    c.heard = w.heard;
    if (w.heard.length && !w.sure) {
      c.sure = false;
      sure = false;
    }
  }
  const regions = joinRanges(changes.flatMap((c) => c.heard ?? []));
  return {
    changes,
    touchedTracks: [...touchedTracks],
    touchedClips: [...touchedClips],
    touchedMarkers: [...touchedMarkers],
    tempoChanged,
    masterChanged,
    bars: range,
    regions,
    sure,
    audition: auditionRange(regions[0] ?? null, after, [...touchedTracks]),
  };
}

/**
 * "bar 5" or "bars 5-8" for a range of whole song bars (end not included): in a song not in 4/4
 * (`meter`, see wordMeter), the measures the ruler numbers there, every one the range touches.
 */
export const barWords = (r: BarRange, meter: MeterMap | null = null): string => {
  let a = Math.floor(r.fromBar + 1e-9);
  let b = Math.max(a, Math.ceil(r.toBar - 1e-9) - 1);
  if (meter) {
    a = toMeasureBeat(Math.max(1, r.fromBar), meter).measure;
    b = Math.max(a, toMeasureBeat(Math.max(r.fromBar, r.toBar - 1e-6), meter).measure);
  }
  return a === b ? `bar ${a}` : `bars ${a}-${b}`;
};

/** "bar 2, bars 5-8 and bar 70" for ranges of whole song bars (by measure in a song not in 4/4: `meter`); "no bars" for none. */
export function rangesWords(list: readonly BarRange[], meter: MeterMap | null = null): string {
  const words = list.map((r) => barWords(r, meter));
  if (!words.length) return 'no bars';
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The whole bars a range of song bars sits in (at least one, from bar 1). */
export function wholeBars(r: BarRange): BarRange {
  const fromBar = Math.max(1, Math.floor(r.fromBar + 1e-9));
  return { fromBar, toBar: Math.max(fromBar + 1, Math.ceil(r.toBar - 1e-9)) };
}

/** Ranges as whole bars, in order, overlapping and touching ones joined. */
export function joinRanges(ranges: readonly BarRange[]): BarRange[] {
  const out: BarRange[] = [];
  for (const r of ranges.map(wholeBars).sort((x, y) => x.fromBar - y.fromBar || x.toBar - y.toBar)) {
    const last = out.at(-1);
    if (last && r.fromBar <= last.toBar) last.toBar = Math.max(last.toBar, r.toBar);
    else out.push({ ...r });
  }
  return out;
}

/**
 * How long a note of `track` (in `song`) can keep sounding after it ends, seconds, through
 * everything it passes on its way out, and whether all of that is known here (`sure`): its
 * instrument's release (a recorded instrument's ring or its recordings' release, a designed
 * synth's amp release, an 808's decay, the release sounds a recorded instrument plays as a key is
 * let go; else RELEASE_ALLOWANCE_SECONDS, not sure), its own Delay and Reverb (effectTails.ts: an
 * echo until its repeats have fallen 60 dB at the song's slowest tempo, a reverb its whole room;
 * a setting a lane moves at its longest), EFFECT_TAIL_SECONDS more for every other insert, and
 * then the longest way on of the bus it plays into and the returns it sends to (each with its own
 * Delay and Reverb, and on), and the master reverb and delay when it feeds them. A plugin
 * instrument's or a plugin effect's own tail isn't known here (not sure).
 */
export interface TrackTail {
  seconds: number;
  sure: boolean;
}

/** The lanes' settings of a track's inserts ("echo.feedback") that move, over its automation and its clips' step lanes, in `song`. */
function movingFx(song: Pick<ProjectSnapshot, 'clips'>, track: Track): Set<string> {
  const out = new Set<string>();
  for (const l of track.automation ?? []) if (l.param.startsWith('fx:')) out.add(l.param.slice(3));
  for (const c of song.clips) if (c.trackId === track.id) for (const l of c.stepLanes ?? []) if (l.target.startsWith('fx:')) out.add(l.target.slice(3));
  return out;
}

/** The slowest tempo `songs` play at, BPM (an echo's repeats are furthest apart there). */
const slowestBpm = (songs: ReadonlyArray<Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>>): number =>
  Math.max(1, Math.min(...songs.flatMap((s) => [s.bpm, ...(s.tempoPoints ?? []).map((p) => p.bpm)]).filter((b) => Number.isFinite(b) && b > 0)));

/** How long a note of `track` rings on as its instrument plays it (see TrackTail). */
function noteTail(track: Track): TrackTail {
  const samples = INSTRUMENTS[track.instrumentKey]?.samples;
  const known = (track.ring !== undefined && !!samples) || typeof samples?.release === 'number' || !!track.synth || !!track.bass808;
  const seconds = Math.max(releaseSeconds(track), track.synth?.amp?.release ?? 0, track.bass808?.decay ?? 0, samples?.releases?.decay ?? 0);
  return { seconds, sure: known && !track.plugin };
}

/** Every track's tail in `songs` (the longest of its versions, sure only if every one is): see TrackTail. */
export function trackTails(songs: readonly ProjectSnapshot[]): (id: string) => TrackTail {
  const bpm = slowestBpm(songs);
  const memo = new Map<string, TrackTail>();
  /** What follows a track's own sound in `song`: the longest way on (see TrackTail). */
  const onward = (song: ProjectSnapshot, t: Track, seen: Set<string>): TrackTail => {
    let seconds = 0;
    let sure = true;
    const ways = [busOf(t, song.tracks), ...liveSends(t, song.tracks).map((x) => song.tracks.find((o) => o.id === x.to))];
    for (const d of ways) {
      if (!d || seen.has(d.id)) continue;
      const own = fxTail(song, d);
      const next = onward(song, d, new Set([...seen, d.id]));
      seconds = Math.max(seconds, own.seconds + next.seconds);
      sure &&= own.sure && next.sure;
    }
    // (the master reverb and delay, when it feeds them: the delay's echoes then ring in the reverb too)
    const fx = song.masterFx ?? DEFAULT_MASTER_FX;
    const lane = (p: string) => !!t.automation?.some((l) => l.param === p);
    const room = t.reverbSend > 0 || (t.distance ?? 0) > 0 || lane('reverbSend') ? masterReverbSeconds(fx) : 0;
    const echoes = t.delaySend > 0 || lane('delaySend') ? masterDelaySeconds(fx, bpm, Infinity) : 0;
    return { seconds: Math.max(seconds, room + echoes), sure };
  };
  /** A track's own inserts' tail in `song`. */
  const fxTail = (song: ProjectSnapshot, t: Track): TrackTail => ({
    seconds: insertTailSeconds(t.fx ?? {}, bpm, Infinity, movingFx(song, t)) + EFFECT_TAIL_SECONDS,
    sure: !t.pluginFx?.some((p) => !p.bypass),
  });
  return (id) => {
    const known = memo.get(id);
    if (known) return known;
    let seconds = 0;
    let sure = true;
    let any = false;
    for (const song of songs) {
      const t = song.tracks.find((x) => x.id === id);
      if (!t) continue;
      any = true;
      const parts = [noteTail(t), fxTail(song, t), onward(song, t, new Set([id]))];
      seconds = Math.max(seconds, parts.reduce((n, p) => n + p.seconds, 0));
      sure &&= parts.every((p) => p.sure);
    }
    const out = any ? { seconds, sure } : { seconds: RELEASE_ALLOWANCE_SECONDS + EFFECT_TAIL_SECONDS, sure: false };
    memo.set(id, out);
    return out;
  };
}

/**
 * Where each change of `before` to `after` is heard (see HearWhere): a track's sound, over its
 * clips in either version, each with its tail (trackTails: its notes' release, its effects, and
 * those of everything it plays into), and over those of every track playing into it (a bus) or
 * sending to it (a return), in either version; the end of the song, the last of those tails. With
 * each, whether the tails it's counted with are all known here (`sure`: see TrackTail).
 */
function hearing(before: ProjectSnapshot, after: ProjectSnapshot): (c: SongChange) => { heard: BarRange[]; sure: boolean } {
  const songs = [before, after];
  const tempos = songs.map((s) => ({ bpm: s.bpm, points: s.tempoPoints ?? [] }));
  const tailOf = trackTails(songs);
  /** Bar `to` and past it by `seconds`, in the slower of the two versions. */
  const past = (to: number, seconds: number): number => {
    const until = Math.max(...tempos.map((t) => secondsToBar(barToSeconds(to, t) + seconds, t)));
    return Number.isFinite(until) ? Math.max(to, until) : to;
  };
  /** Where a clip of `track` sounds: from its start to past its end by its tail. */
  const clipRange = (c: Clip): BarRange => ({ fromBar: c.startBar, toBar: past(c.startBar + c.lengthBars, tailOf(c.trackId).seconds) });
  const ranges = new Map<string, BarRange[]>();
  for (const s of songs)
    for (const c of s.clips) {
      const list = ranges.get(c.trackId) ?? [];
      list.push(clipRange(c));
      ranges.set(c.trackId, list);
    }
  /** The tracks that play into `id` (it's their bus) or send to it (it's their return), in either version. */
  const feeders = (id: string): string[] => {
    const out = new Set<string>();
    for (const s of songs) for (const t of s.tracks) if (t.id !== id && (t.output === id || liveSends(t, s.tracks).some((x) => x.to === id))) out.add(t.id);
    return [...out];
  };
  const memo = new Map<string, BarRange[]>();
  const sounds = (id: string, seen = new Set<string>()): BarRange[] => {
    const known = memo.get(id);
    if (known) return known;
    if (seen.has(id)) return [];
    seen.add(id);
    const out = joinRanges([...(ranges.get(id) ?? []), ...feeders(id).flatMap((f) => sounds(f, seen))]);
    memo.set(id, out);
    return out;
  };
  /** Whether the tails of `id` and of every track playing into it are all known. */
  const sureOf = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    return tailOf(id).sure && feeders(id).every((f) => sureOf(f, seen));
  };
  const allSure = songs.every((s) => s.tracks.every((t) => tailOf(t.id).sure));
  const end = Math.max(2, ...[...ranges.values()].flat().map((r) => Math.ceil(r.toBar - 1e-9)));
  const song: BarRange = { fromBar: 1, toBar: end };
  return (c) => {
    // (what isn't known to sit somewhere is heard everywhere)
    const how: HearWhere = c.hear ?? 'song';
    if (how === 'silent') return { heard: [], sure: true };
    if (how === 'song') return { heard: [song], sure: allSure };
    if (how === 'from' && c.fromBar !== undefined) return { heard: c.fromBar < end ? joinRanges([{ fromBar: c.fromBar, toBar: end }]) : joinRanges([{ fromBar: c.fromBar, toBar: c.fromBar + 1 }]), sure: allSure };
    const tracks = c.trackId ? [c.trackId, ...(alsoTracks.get(c) ?? [])] : [];
    if (how === 'track' && tracks.length) return { heard: joinRanges(tracks.flatMap((id) => sounds(id))), sure: tracks.every((id) => sureOf(id)) };
    // (a change on a track rings on past its bars: its notes' release, the track's effects, and those it plays into)
    if (how === 'here' && c.fromBar !== undefined && c.toBar !== undefined)
      return { heard: joinRanges([{ fromBar: c.fromBar, toBar: tracks.length ? Math.max(...tracks.map((id) => past(c.toBar!, tailOf(id).seconds))) : c.toBar }]), sure: tracks.every((id) => tailOf(id).sure) };
    return { heard: [song], sure: allSure };
  };
}

/**
 * The bars to hear a change in, for a file's suggestion (`audition`): from one bar before `range`
 * (the first region), at most AUDITION_MAX_BARS. Nothing to hear: where the touched tracks first
 * play, else the start of the song.
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
    // (only the app's own words and numbers: a text an agent could have written is "changed", never shown)
    const show = (v: unknown) => (v === undefined ? 'none' : plainToken(v));
    const name = plainToken(k, 40);
    if (!name) continue;
    const from = show(a[k]);
    const to = show(b[k]);
    out.push(typeof b[k] === 'object' || from === null || to === null ? `${name} changed` : `${name} ${from} to ${to}`);
  }
  return out.slice(0, 4).join(', ') + (out.length > 4 ? `, and ${out.length - 4} more` : '');
}

function diffTrack(a: Track, b: Track, tracks: readonly Track[], add: (c: SongChange) => void) {
  const n = nm(b.name);
  const at = { trackId: b.id, hear: 'track' as HearWhere };
  if (a.name !== b.name) add({ text: `Renames the track ${nm(a.name)} to ${nm(b.name)}.`, trackId: b.id, hear: 'silent' });
  if (a.instrumentKey !== b.instrumentKey) add({ text: `${n} plays ${INSTRUMENTS[b.instrumentKey]?.name ?? b.instrumentKey} instead of ${INSTRUMENTS[a.instrumentKey]?.name ?? a.instrumentKey}.`, ...at });
  if (a.volume !== b.volume) add({ text: `Turns ${n} ${b.volume > a.volume ? 'up' : 'down'} by ${r1(Math.abs(b.volume - a.volume))} dB (${db(a.volume)} to ${db(b.volume)}).`, ...at });
  if (a.pan !== b.pan) add({ text: `Pans ${n} to ${formatPan(b.pan)} (was ${formatPan(a.pan)}).`, ...at });
  if (a.isMuted !== b.isMuted) add({ text: `${b.isMuted ? 'Mutes' : 'Unmutes'} ${n}.`, ...at });
  if (a.isSoloed !== b.isSoloed) add({ text: `${b.isSoloed ? 'Solos' : 'Unsolos'} ${n}.`, trackId: b.id, hear: 'song' });
  if (a.reverbSend !== b.reverbSend) add({ text: `Changes the reverb send of ${n} from ${r1(a.reverbSend * 100)}% to ${r1(b.reverbSend * 100)}%.`, ...at });
  if (a.delaySend !== b.delaySend) add({ text: `Changes the delay send of ${n} from ${r1(a.delaySend * 100)}% to ${r1(b.delaySend * 100)}%.`, ...at });
  if ((a.distance ?? 0) !== (b.distance ?? 0)) add({ text: `Moves ${n} ${(b.distance ?? 0) > (a.distance ?? 0) ? 'further back' : 'closer'} on the stage (distance ${r1(a.distance ?? 0)} to ${r1(b.distance ?? 0)}).`, ...at });
  if ((a.output ?? null) !== (b.output ?? null)) add({ text: `${n} plays into ${b.output ? (tracks.find((t) => t.id === b.output) ? nm(tracks.find((t) => t.id === b.output)!.name) : 'a bus') : 'the master'}.`, ...at });
  if (!same(a.eq, b.eq)) {
    const parts = (['low', 'mid', 'high'] as const).filter((k) => a.eq[k] !== b.eq[k]).map((k) => `${k} ${db(b.eq[k])}`);
    add({ text: `Sets the EQ of ${n}: ${parts.join(', ')}.`, ...at });
  }
  if (!same(a.fx, b.fx)) {
    for (const k of new Set([...Object.keys(a.fx), ...Object.keys(b.fx)])) {
      const x = (a.fx as unknown as Record<string, unknown>)[k];
      const y = (b.fx as unknown as Record<string, unknown>)[k];
      if (same(x, y)) continue;
      const label = INSERT_LABELS[k] ?? k;
      const on = (v: unknown) => !!(v as { on?: boolean } | undefined)?.on;
      if (on(x) !== on(y)) add({ text: `Turns ${on(y) ? 'on' : 'off'} the ${label} on ${n}${on(y) ? ` (${settingChanges(x, y) || 'as it was set'})` : ''}.`, ...at });
      else add({ text: `Changes the ${label} on ${n}${on(y) ? '' : ' (switched off)'}: ${settingChanges(x, y)}.`, ...at });
    }
  }
  if (!same(a.synth, b.synth) && a.instrumentKey === b.instrumentKey) add({ text: `Gives ${n} a new synth sound.`, ...at });
  if (!same(a.automation, b.automation)) diffLanes(a, b, tracks, add);
  if (!same(a.sends, b.sends)) add({ text: `Changes the sends of ${n} to the returns.`, ...at });
  const known = new Set(['name', 'instrumentKey', 'color', 'volume', 'pan', 'isMuted', 'isSoloed', 'reverbSend', 'delaySend', 'distance', 'output', 'eq', 'fx', 'synth', 'automation', 'sends', 'drumDesign']);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  // (settings not known here: heard anywhere, for all that's known)
  if (other.length) add({ text: `Changes other settings of ${n} (${other.join(', ')}).`, trackId: b.id, hear: 'song' });
}

/**
 * A lane's changes. Each is heard wherever the track sounds (hear 'track'), not only at its points:
 * a lane holds its first value before its first point and its last after its last, and moves
 * every bar between, so a point changed at bar 9 changes everything from the point before it to
 * the point after it, and a lane drawn or taken away changes the track everywhere it plays (a
 * send's lane, an instrument's or an insert's the same: where the track and what it feeds sound).
 * fromBar and toBar stay the points' bars, for showing where the lane was drawn.
 */
function diffLanes(a: Track, b: Track, tracks: readonly Track[], add: (c: SongChange) => void) {
  const n = nm(b.name);
  const label = (l: AutomationLane) => specOf(l.param, b, tracks).label;
  const span = (lanes: AutomationLane[]) => {
    const all = lanes.flatMap((l) => l.points.map((p) => p.bar));
    return all.length ? { fromBar: Math.min(...all), toBar: Math.max(...all) + 1 } : {};
  };
  const before = a.automation ?? [];
  const after = b.automation ?? [];
  for (const l of after) {
    const old = before.find((o) => o.param === l.param);
    if (!old) add({ text: `Draws ${label(l)} automation on ${n} (${plural(l.points.length, 'point')}).`, trackId: b.id, hear: 'track', ...span([l]) });
    else if (!same(old, l)) add({ text: `Redraws the ${label(l)} automation of ${n} (${plural(l.points.length, 'point')}, was ${old.points.length}).`, trackId: b.id, hear: 'track', ...changedSpan(old, l) });
  }
  for (const l of before) if (!after.some((o) => o.param === l.param)) add({ text: `Removes the ${label(l)} automation of ${n}.`, trackId: b.id, hear: 'track', ...span([l]) });
}

/** The bars over which two versions of a lane differ. */
function changedSpan(a: AutomationLane, b: AutomationLane): Partial<BarRange> {
  const key = (p: { bar: number; value: number; curve?: number }) => `${p.bar}:${p.value}:${p.curve ?? 0}`;
  const inA = new Set(a.points.map(key));
  const inB = new Set(b.points.map(key));
  const bars = [...a.points.filter((p) => !inB.has(key(p))), ...b.points.filter((p) => !inA.has(key(p)))].map((p) => p.bar);
  return bars.length ? { fromBar: Math.min(...bars), toBar: Math.max(...bars) + 1 } : {};
}

/** Whether a clip has lanes of its own (controllers: bend, mod, sustain, CCs; step lanes): what they set holds on past the clip, into the track's later clips. */
const hasLanes = (c: Clip): boolean => !!c.stepLanes?.length || (!!c.expression && Object.values(c.expression).some((v) => !!v?.length));

/** The other tracks a change is heard on too (a clip moved from one track to another: both). */
const alsoTracks = new WeakMap<SongChange, string[]>();

function diffClip(a: Clip, b: Clip, trackName: (id: string) => string, add: (c: SongChange) => void) {
  const n = nm(b.name);
  // (a clip with lanes, in either version: what they hold carries into the track's later clips, so
  // a change of it is heard wherever the track plays; else in its bars, with the notes' tail)
  const hear: HearWhere = hasLanes(a) || hasLanes(b) ? 'track' : 'here';
  const at = { trackId: b.trackId, clipId: b.id, hear };
  if (a.trackId !== b.trackId) {
    const moved: SongChange = { text: `Moves the clip ${n} from ${trackName(a.trackId)} to ${trackName(b.trackId)}.`, ...at, fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(a.startBar + a.lengthBars, b.startBar + b.lengthBars) };
    alsoTracks.set(moved, [a.trackId]);
    add(moved);
  }
  if (Math.abs(a.startBar - b.startBar) > 1e-9)
    add({ text: `Moves the clip ${n} from ${barAt(a.startBar)} to ${barAt(b.startBar)}.`, ...at, fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(a.startBar + a.lengthBars, b.startBar + b.lengthBars) });
  if (Math.abs(a.lengthBars - b.lengthBars) > 1e-9)
    add({ text: `Makes the clip ${n} ${lengthWords(b.lengthBars)} long (was ${lengthWords(a.lengthBars)}).`, ...at, fromBar: Math.min(a.startBar, b.startBar) + Math.min(a.lengthBars, b.lengthBars), toBar: Math.max(a.startBar + a.lengthBars, b.startBar + b.lengthBars) });
  if (a.name !== b.name) add({ text: `Renames the clip ${nm(a.name)} to ${n}.`, ...at, hear: 'silent' });
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
    // (heard in their bars and as they ring out after: the release and the track's effects, see hearing)
    add({ text: `In ${n} on ${trackName(b.trackId)}: ${parts.join(', ')}${where}.`, ...at, fromBar: from, toBar: Math.max(to, from + 1 / 16) });
  }
  if ((a.pattern ?? null) !== (b.pattern ?? null)) add({ text: b.pattern ? `Links the clip ${n} to its copies.` : `Unlinks the clip ${n} from its copies.`, ...at, hear: 'silent' });
  for (const k of ['expression', 'groove', 'wobble', 'stepLanes'] as const) if (!same(a[k], b[k])) add({ text: `Changes the ${k === 'stepLanes' ? 'step lanes' : k} of the clip ${n}.`, ...at, fromBar: b.startBar, toBar: b.startBar + b.lengthBars });
  // (anything else about a clip, not known here: heard anywhere, for all that's known)
  const known = new Set(['id', 'trackId', 'startBar', 'lengthBars', 'name', 'notes', 'pattern', 'expression', 'groove', 'wobble', 'stepLanes', 'isSelected']);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  if (other.length) add({ text: `Changes other settings of the clip ${n} (${other.join(', ')}).`, trackId: b.trackId, clipId: b.id, hear: 'song' });
}

/**
 * Where a tempo point's change starts to be heard, for the point with id `id` (at `bar` or later):
 * at its bar, or, when it or the point after it glides (ramp, in either version), at the point
 * before it (or bar 1): a glide changes every bar from where it starts.
 */
function tempoChangeStart(before: readonly TempoPoint[], after: readonly TempoPoint[]): (id: string, bar: number) => number {
  const lists = [before, after].map((l) => [...l].sort((x, y) => x.bar - y.bar));
  return (id, bar) => {
    let from = bar;
    for (const list of lists) {
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) continue;
      if (list[i].ramp || list[i + 1]?.ramp) from = Math.min(from, list[i - 1]?.bar ?? 1);
    }
    return Math.max(1, from);
  };
}
