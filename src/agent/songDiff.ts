/**
 * What changed between two versions of a song, in plain words: tracks, clips, notes, markers,
 * tempo, time signature and master matched by id, each change a sentence ("Turns "Bass" up by 3 dB
 * (-6 to -3 dB).") with the tracks, clips and bars it touches. The names in a sentence are the
 * song's, which an agent may have written: each is kept apart (names.ts), shown as a chip of its
 * own on a card (`marked`) and in plain quotes, its own quotes and brackets taken out, everywhere
 * else (`text`). Also where each change is heard (`heard`, and all of them together in `regions`),
 * by rules that are never fewer bars than the truth: notes or a clip, its bars and its notes' tail
 * (the release, the track's effects and those of everything it plays into, as long as they ring:
 * trackTails, every lane that moves them counted; a tail not known here, a plugin's, leaves them
 * not `sure`), and of every track whose Pump ducks to its notes, as long as that one rings on; one of a track's sound (its level, pan, instrument,
 * inserts, sends, routing...) or of its automation (a lane holds before and after its points), and
 * any change of a clip with controller or step lanes (what they hold carries into the track's
 * later clips), the bars where that track sounds (its clips with their tails, and the clips of
 * every track playing into it, when it's a bus or a return); a tempo or time signature change at
 * bar N, bar N to the end (from the change before it, when a glide starts there); one for the
 * whole song (the tempo, the time signature, the master, a solo) or anything not known here, the
 * whole song; a name, a marker or a link, nowhere (nothing to hear), but a link on a track with
 * notes played on some passes, and a change that makes a track's feel clips play as another part
 * (a rename too), are heard as a change of those notes and where those clips sound. The studio adds the bars it
 * finds by sound (whereHeard.ts). Plain logic, used by applyOps, the command line's diff and the
 * studio's suggestion cards.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationLane, Clip, MasterSettings, NoteEvent, Track } from '../store/timelineTypes';
import { DEFAULT_MASTER_FX, durationToBars, PUMP_RELEASE_MAX, pumpFollowsDrums } from '../store/timelineTypes';
import { INSTRUMENTS, isDrumKind } from '../audio/instrumentCatalog';
import { formatPan, specOf } from '../audio/automation';
import { barToSeconds, FOUR_FOUR, isPlainMeter, secondsToBar, toMeasureBeat, type MeterMap, type TempoPoint } from '../audio/tempoMap';
import { clipSoundEnd, RELEASE_ALLOWANCE_SECONDS, releaseSeconds, soundingNotes } from '../audio/auditionMath';
import { chainTail, feedsMasterDelay, feedsMasterReverb, lanesKnown, masterDelaySeconds, masterReverbSeconds, ownInsertTail, playedTracks, slowestBpm } from '../audio/effectTails';
import { liveSends } from '../store/buses';
import { DUCK_BRIDGE, DUCK_LOOKAHEAD, DUCK_RELEASE } from '../store/duck';
import { carriesState, swingReadsClip, type NoteMemory } from '../audio/noteMemory';
import { clipHasConditions } from '../store/noteChance';
import { feelPartOf } from '../audio/mixCheck';
import { stableJson } from './fingerprint';
import { insertLabel, settingWord, valueWord } from './settingWords';
import { nm, plainNames } from './names';
import { maxOf, minOf } from '../support/minMax';

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
/** "bar 7.5", or in a song not in 4/4 (`meter`, see wordMeter), the measure (and beat) the ruler shows there: "bar 9", "bar 9 beat 2". */
export const positionWords = (bar: number, meter: MeterMap | null): string => {
  if (!meter) return `bar ${r1(bar)}`;
  const m = toMeasureBeat(bar, meter);
  return m.beat === 1 && m.hundredths === 0 ? `bar ${m.measure}` : `bar ${m.measure} beat ${r1(m.beat + m.hundredths / 100)}`;
};
/** A length: "4 bars", or in a song not in 4/4 (`meter`: where a bar isn't a measure) in quarter notes. */
export const lengthWordsIn = (lengthBars: number, meter: MeterMap | null): string => {
  const n = lengthNumber(meter ? lengthBars * 4 : lengthBars);
  const word = meter ? 'quarter note' : 'bar';
  return `${n} ${word}${n === '1' ? '' : 's'}`;
};
/** A length's number to 1 decimal, but never 0 for a length that isn't (two figures then: 0.004). */
const lengthNumber = (v: number): string => (r1(v) === 0 && v > 0 ? String(Number(v.toPrecision(2))) : String(r1(v)));
const barAt = (bar: number): string => positionWords(bar, sentenceMeter);
/** A clip's length (see lengthWordsIn). */
const lengthWords = (lengthBars: number): string => lengthWordsIn(lengthBars, sentenceMeter);
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
  /** Whether a track plays notes only on some passes, in either version (noteMemory.ts 'passes': its clips' runs of copies decide which). */
  const playsPasses = (id: string): boolean => [before, after].some((s) => s.clips.some((c) => c.trackId === id && !c.audio && clipHasConditions(c)));

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
    if (old !== t && !same(old, t)) diffTrack(old, t, after.tracks, add, trackName);
  }
  for (const t of before.tracks) if (!after.tracks.some((o) => o.id === t.id)) add({ text: `Removes the track ${nm(t.name)} and its clips.`, trackId: t.id, hear: 'track' });

  // ---------- Clips ----------
  for (const c of after.clips) {
    const old = before.clips.find((o) => o.id === c.id);
    if (!old) {
      add({ text: `Adds the clip ${nm(c.name)} on ${trackName(c.trackId)} at ${bars(c.startBar, c.startBar + c.lengthBars)}${c.notes.length ? `, ${plural(c.notes.length, 'note')}` : ''}${c.pattern && before.clips.some((o) => o.pattern === c.pattern) ? ', linked to the clips it was copied from' : ''}.`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: clipSoundEnd(c), hear: hasLanes(c) ? 'track' : 'here' });
      continue;
    }
    if (old !== c) diffClip(old, c, trackName, add, playsPasses);
  }
  for (const c of before.clips) {
    if (!after.clips.some((o) => o.id === c.id) && after.tracks.some((t) => t.id === c.trackId))
      add({ text: `Removes the clip ${nm(c.name)} from ${trackName(c.trackId)} (${bars(c.startBar, c.startBar + c.lengthBars)}).`, trackId: c.trackId, clipId: c.id, fromBar: c.startBar, toBar: clipSoundEnd(c), hear: hasLanes(c) ? 'track' : 'here' });
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
  const range = located.length ? { fromBar: minOf(located.map((c) => c.fromBar!)), toBar: maxOf(located.map((c) => c.toBar!)) } : null;
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

/** Whether rangesWords names more than one bar (by measure in a song not in 4/4, as it does): for "were" or "was". */
export const namesManyBars = (list: readonly BarRange[], meter: MeterMap | null = null): boolean => list.length > 1 || (list.length === 1 && barWords(list[0], meter).startsWith('bars '));

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
 * Delay and Reverb, and on), and the master reverb and delay when it feeds them (a send, or a lane
 * moving one). Every lane counts alike, read from the tracks as they play (effectTails.ts
 * playedTracks: the track's automation, its clips' controller lanes, CC 91 and 93 or one its MIDI
 * learn maps to a setting, and its clips' step lanes); a lane for a setting not known here, a
 * plugin instrument's or a plugin effect's own tail isn't known (not sure).
 */
export interface TrackTail {
  seconds: number;
  sure: boolean;
}

/** How long a note of `track` rings on as its instrument plays it (see TrackTail). */
function noteTail(track: Track): TrackTail {
  const samples = INSTRUMENTS[track.instrumentKey]?.samples;
  const known = (track.ring !== undefined && !!samples) || typeof samples?.release === 'number' || !!track.synth || !!track.bass808;
  const seconds = Math.max(releaseSeconds(track), track.synth?.amp?.release ?? 0, track.bass808?.decay ?? 0, samples?.releases?.decay ?? 0);
  return { seconds, sure: known && !track.plugin };
}

/** Every track's tail in `songs` (the longest of its versions, sure only if every one is): see TrackTail. */
export function trackTails(songs: readonly ProjectSnapshot[]): (id: string) => TrackTail {
  const bpm = slowestBpm(songs.map((s) => ({ bpm: s.bpm, points: s.tempoPoints ?? [] })));
  // Each version's tracks as they play: every lane that moves a setting (the track's automation,
  // its clips' controller and step lanes) is then an automation lane (effectTails.ts playedTracks)
  const played = songs.map((s) => ({ song: s, tracks: playedTracks(s.tracks, s.clips, { bpm: s.bpm, points: s.tempoPoints ?? [] }) }));
  const memo = new Map<string, TrackTail>();
  type Played = (typeof played)[number];
  /** The master reverb and delay, when it feeds them (the delay's echoes counted into the reverb too, to be safe). */
  const master = (song: Played) => (t: Track): number => {
    const fx = song.song.masterFx ?? DEFAULT_MASTER_FX;
    return (feedsMasterReverb(t) ? masterReverbSeconds(fx) : 0) + (feedsMasterDelay(t) ? masterDelaySeconds(fx, bpm, Infinity) : 0);
  };
  /** A track's own inserts' tail (its lane-moved settings at their longest); not sure with a plugin effect, or a lane for something not known here. */
  const fxTail = (t: Track): TrackTail => ({
    seconds: ownInsertTail(t, bpm, Infinity) + EFFECT_TAIL_SECONDS,
    sure: !t.pluginFx?.some((p) => !p.bypass) && lanesKnown(t),
  });
  return (id) => {
    const known = memo.get(id);
    if (known) return known;
    let seconds = 0;
    let sure = true;
    let any = false;
    for (const song of played) {
      const t = song.tracks.find((x) => x.id === id);
      if (!t) continue;
      any = true;
      // (its notes' release, then its inserts and everything after them: effectTails.ts chainTail)
      const parts = [noteTail(t), chainTail(t, song.tracks, fxTail, master(song))];
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
    const until = maxOf(tempos.map((t) => secondsToBar(barToSeconds(to, t) + seconds, t)));
    return Number.isFinite(until) ? Math.max(to, until) : to;
  };
  /** Where a clip of `track` sounds: from its start to past its end by its tail. */
  // (to where its last note stops: a note runs its whole length, past the clip's end too)
  const clipRange = (c: Clip): BarRange => ({ fromBar: c.startBar, toBar: past(clipSoundEnd(c), tailOf(c.trackId).seconds) });
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
  /**
   * The tracks whose Pump ducks to `id`'s notes, in either version (one that follows it, or follows
   * the drums when it's a drum track): a change of its notes moves their ducking too, which rings on
   * through all that follows the Pump (their sends, bus and returns: their tail, and the Pump's
   * release).
   */
  const pumped = (id: string): string[] => {
    const out = new Set<string>();
    for (const s of songs) {
      const src = s.tracks.find((t) => t.id === id);
      for (const t of s.tracks) {
        const pump = t.fx?.pump;
        if (t.id === id || !pump?.on) continue;
        if ((pump.trigger === 'track' && pump.source === id) || (pumpFollowsDrums(pump.trigger) && !!src && isDrumKind(src.instrumentKey))) out.add(t.id);
      }
    }
    return [...out];
  };
  const duckTail = (id: string) => tailOf(id).seconds + PUMP_RELEASE_MAX / 1000;
  /**
   * The tracks that duck under `id` when it's a proxy (the game's dialogue or sound effects, in
   * either version: store/duck.ts): every other track but the proxies. A change of its notes,
   * clips or mute moves their dip, which starts DUCK_LOOKAHEAD early, comes back over DUCK_RELEASE,
   * bridges gaps under DUCK_BRIDGE, and rings on through all that follows it on those tracks
   * (their sends, bus and returns: their tail).
   */
  const proxyDucked = (id: string): string[] => {
    if (!songs.some((s) => s.tracks.some((t) => t.id === id && t.duckProxy))) return [];
    const out = new Set<string>();
    for (const s of songs) for (const t of s.tracks) if (t.id !== id && !t.duckProxy) out.add(t.id);
    return [...out];
  };
  // (in bars, as duck.ts reckons them: by each version's tempo, the longer of the two)
  const duckBars = (seconds: number) => maxOf(songs.map((s) => (seconds * s.bpm) / 240));
  const dipRange = (r: BarRange, id: string): BarRange => ({
    fromBar: Math.max(1, r.fromBar - duckBars(DUCK_LOOKAHEAD + DUCK_BRIDGE)),
    toBar: past(r.toBar + duckBars(DUCK_BRIDGE + DUCK_RELEASE), tailOf(id).seconds),
  });
  /**
   * What a track remembers from note to note (noteMemory.ts: takes played in turn, strums, passes,
   * a plugin's own state, a monophonic synth carrying on, a new note cutting one still sounding),
   * in either version.
   */
  const memoryMemo = new Map<string, NoteMemory | null>();
  const memoryOf = (id: string): NoteMemory | null => {
    if (memoryMemo.has(id)) return memoryMemo.get(id)!;
    const clips = songs.flatMap((s) => s.clips.filter((c) => c.trackId === id));
    const found = songs.flatMap((s) => s.tracks.filter((t) => t.id === id)).map((t) => carriesState(t, clips)).filter((m): m is NoteMemory => !!m);
    const out: NoteMemory | null = found.length
      ? { reach: found.some((m) => m.reach === 'onward') ? 'onward' : 'joined', sure: found.every((m) => m.sure), kinds: [...new Set(found.flatMap((m) => m.kinds))] }
      : null;
    memoryMemo.set(id, out);
    return out;
  };
  /**
   * The end of the run of `id`'s notes joined to a change from `from` to `to`, in either version:
   * every note still sounding at `from` (a note held over the change runs to its own end), then
   * each starting before the run so far has rung out (its notes' release, see releaseSeconds). How
   * far a monophonic synth carries the change on (noteMemory.ts 'legato'), and a note cut short by a
   * newer one, or let ring again when that one goes (noteMemory.ts 'cuts').
   */
  const joinedEnd = (id: string, from: number, to: number): number => {
    let reach = to;
    for (const s of songs) {
      const track = s.tracks.find((t) => t.id === id);
      const ring = releaseSeconds(track);
      const notes = s.clips
        .filter((c) => c.trackId === id)
        .flatMap((c) => soundingNotes(c).map(({ note, bars }) => ({ start: c.startBar + note.startOffset, end: c.startBar + note.startOffset + bars })))
        .sort((x, y) => x.start - y.start);
      let end = to;
      for (const n of notes) {
        if (n.end <= from) continue;
        // (a sixteenth to spare: swing and the Human insert can move a note a little later)
        if (n.start >= from && n.start > past(end, ring) + 1 / 16) break;
        end = Math.max(end, n.end);
      }
      reach = Math.max(reach, end);
    }
    return reach;
  };
  /**
   * What a track's clips with a measured feel and no part of their own play as, in each version
   * (mixCheck.ts feelPartOf: by its name and the notes of all its clips, a Drum Rack by its pads'
   * names): the drums, a rack's pads, the bass, or chords or lead by each clip's own notes.
   */
  const feelPart = (s: ProjectSnapshot, id: string): string | null => {
    const t = s.tracks.find((x) => x.id === id);
    if (!t) return null;
    const part = feelPartOf(t, s.clips);
    return part === 'drums' || part === 'bass' || part.startsWith('rack:') ? part : 'melodic';
  };
  /** A clip with a measured feel that takes its part from its track (one of its own doesn't). */
  const feelByTrack = (c: Clip): boolean => !c.audio && !!c.groove?.feel && !c.groove.feel.role;
  /**
   * Where `id`'s feel clips sound (with their tail), when they play as another part in the other
   * version (the track renamed, notes added far off that move its pitch): every note of them moves
   * and is accented by the other part's map. Else none.
   */
  const feelMemo = new Map<string, BarRange[]>();
  const feelMoved = (id: string): BarRange[] => {
    let out = feelMemo.get(id);
    if (!out) {
      const clips = songs.flatMap((s) => s.clips.filter((c) => c.trackId === id && feelByTrack(c)));
      const [a, b] = songs.map((s) => feelPart(s, id));
      out = clips.length && a !== null && b !== null && a !== b ? clips.map(clipRange) : [];
      feelMemo.set(id, out);
    }
    return out;
  };
  /**
   * A clip's bars in either version, when a change of one of its notes can move the others: its
   * swing is decided over the whole clip (noteMemory.ts swingReadsClip), or its measured feel plays
   * it as chords or a lead by all its notes together (grooveFeels.ts melodicRoleOf).
   */
  const swingSpan = (clipId: string): BarRange | null => {
    const versions = songs.flatMap((s) => s.clips.filter((c) => c.id === clipId));
    // (a clip with no swing of its own plays the song's, in that version)
    const swing = songs.some((s) => s.clips.some((c) => c.id === clipId && swingReadsClip(c, s.swing ?? 0)));
    const feel = songs.some((s) => s.clips.some((c) => c.id === clipId && feelByTrack(c) && feelPart(s, c.trackId) === 'melodic'));
    if (!swing && !feel) return null;
    return { fromBar: minOf(versions.map((c) => c.startBar)), toBar: maxOf(versions.map(clipSoundEnd)) };
  };
  const allSure = songs.every((s) => s.tracks.every((t) => tailOf(t.id).sure));
  const end = maxOf(2, [...ranges.values()].flat().map((r) => Math.ceil(r.toBar - 1e-9)));
  const song: BarRange = { fromBar: 1, toBar: end };
  const rule = (c: SongChange): { heard: BarRange[]; sure: boolean } => {
    // (what isn't known to sit somewhere is heard everywhere)
    const how: HearWhere = c.hear ?? 'song';
    if (how === 'silent') return { heard: [], sure: true };
    if (how === 'song') return { heard: [song], sure: allSure };
    if (how === 'from' && c.fromBar !== undefined) return { heard: c.fromBar < end ? joinRanges([{ fromBar: c.fromBar, toBar: end }]) : joinRanges([{ fromBar: c.fromBar, toBar: c.fromBar + 1 }]), sure: allSure };
    const tracks = c.trackId ? [c.trackId, ...(alsoTracks.get(c) ?? [])] : [];
    // (and the tracks whose Pump ducks to them: where those sound, past by their own tail)
    const ducked = [...new Set(tracks.flatMap(pumped))].filter((id) => !tracks.includes(id));
    // (and, when one is a proxy, every track that ducks under it: from its look-ahead before to past its release by their tail)
    const dipped = [...new Set(tracks.flatMap(proxyDucked))].filter((id) => !tracks.includes(id));
    if (how === 'track' && tracks.length) {
      const own = tracks.flatMap((id) => sounds(id));
      const duck = ducked.flatMap((p) => own.map((r) => ({ fromBar: r.fromBar, toBar: past(r.toBar, duckTail(p)) })));
      const dips = dipped.flatMap((d) => own.map((r) => dipRange(r, d)));
      return { heard: joinRanges([...own, ...duck, ...dips]), sure: tracks.every((id) => sureOf(id)) && [...ducked, ...dipped].every((id) => tailOf(id).sure) };
    }
    // (a change on a track rings on past its bars: its notes' release, the track's effects, and those it plays into)
    if (how === 'here' && c.fromBar !== undefined && c.toBar !== undefined) {
      // (a clip whose swing is decided over all of it: a change of one note can move any of them)
      const swing = c.clipId ? swingSpan(c.clipId) : null;
      // (a track that plays a note by the notes before it: the change carries on, see noteMemory.ts)
      const memories = c.clipId ? tracks.map((id) => ({ id, memory: memoryOf(id) })).filter((x) => !!x.memory) : [];
      // (notes played on some passes only: a change of the clip can change its run of copies, and
      // so the pass of all its notes, from its start: noteChance.ts clipRuns)
      const passStart = memories.some((x) => x.memory!.kinds.includes('passes')) ? minOf(songs.flatMap((s) => s.clips.filter((k) => k.id === c.clipId).map((k) => k.startBar))) : Infinity;
      const from = Math.min(c.fromBar, swing?.fromBar ?? Infinity, passStart);
      let to = Math.max(c.toBar, swing?.toBar ?? -Infinity);
      const onward: BarRange[] = [];
      let notesMove = false;
      for (const { id, memory } of memories) {
        if (memory!.reach === 'joined') to = Math.max(to, joinedEnd(id, from, to));
        else for (const r of sounds(id)) if (r.toBar > from) onward.push({ fromBar: Math.max(from, r.fromBar), toBar: r.toBar });
        // (passes decide which notes play: what ducks to them moves on too)
        if (memory!.kinds.includes('passes')) notesMove = true;
      }
      const duckTo = notesMove ? maxOf(to, onward.map((r) => r.toBar)) : to;
      const here: BarRange = { fromBar: from, toBar: tracks.length ? maxOf(tracks.map((id) => past(to, tailOf(id).seconds)), ducked.map((id) => past(duckTo, duckTail(id)))) : to };
      return {
        heard: joinRanges([here, ...onward, ...dipped.map((d) => dipRange({ fromBar: from, toBar: duckTo }, d))]),
        sure: [...tracks, ...ducked, ...dipped].every((id) => tailOf(id).sure) && memories.every((x) => x.memory!.sure),
      };
    }
    return { heard: [song], sure: allSure };
  };
  return (c) => {
    const found = rule(c);
    // (a change of a track whose feel clips then play as another part: heard wherever they sound)
    const ids = c.trackId && c.hear !== 'song' ? [c.trackId, ...(alsoTracks.get(c) ?? [])] : [];
    const moved = ids.filter((id) => feelMoved(id).length);
    if (!moved.length) return found;
    return { heard: joinRanges([...found.heard, ...moved.flatMap(feelMoved)]), sure: found.sure && moved.every((id) => tailOf(id).sure) };
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
    const start = minOf(clips.map((c) => c.startBar));
    return fit(start, start + 8);
  }
  const end = song.clips.reduce((e, c) => Math.max(e, clipSoundEnd(c)), 1);
  return fit(1, Math.min(end, 9));
}

function diffMaster(a: MasterSettings | undefined, b: MasterSettings | undefined, add: (c: SongChange) => void) {
  if (!a || !b || same(a, b)) return;
  if (a.level !== b.level) add({ text: `Turns the master Level ${b.level > a.level ? 'up' : 'down'} by ${r1(Math.abs(b.level - a.level))} dB (${db(a.level)} to ${db(b.level)}).` });
  if (a.glue !== b.glue) add({ text: `Sets the master compressor to ${valueWord('glue', b.glue) ?? 'another style'}.` });
  const part = (label: string, x: unknown, y: unknown) => {
    const on = (v: unknown) => !!(v as { on?: boolean } | undefined)?.on;
    if (same(x, y)) return;
    // (switched on: with what it's set to, as a track's insert is)
    if (on(x) !== on(y)) add({ text: `Turns ${on(y) ? 'on' : 'off'} the master ${label}${on(y) ? ` (${settingChanges(x, y) || 'as it was set'})` : ''}.` });
    else if (on(y)) add({ text: `Changes the master ${label} (${settingChanges(x, y)}).` });
  };
  part('OTT', a.ott, b.ott);
  part('stereo width', a.width, b.width);
  part('Loud', a.loud, b.loud);
  part('clipper', a.clipper, b.clipper);
  if (!!a.monoLow !== !!b.monoLow) add({ text: `${b.monoLow ? 'Keeps' : 'Stops keeping'} the master's low end in the middle.` });
}

/** " (sub layer, ring)": settings by their plain names, those not plain left out (nothing when none is). */
const settingList = (keys: readonly string[]): string => {
  const words = keys.map(settingWord).filter((w): w is string => !!w);
  return words.length ? ` (${words.join(', ')})` : '';
};

/**
 * "cutoff 1000 to 800, mix 0.3 to 0.5, ping-pong on to off": the settings of an object that differ,
 * in words (valueWord), the track a Pump follows by its name (`trackName`).
 */
function settingChanges(x: unknown, y: unknown, trackName?: (id: string) => string): string {
  const a = (x ?? {}) as Record<string, unknown>;
  const b = (y ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'on' || same(a[k], b[k])) continue;
    // (only the app's own words and numbers: a text an agent could have written is "changed", never shown)
    const show = (v: unknown) => (v === undefined ? 'none' : k === 'source' && typeof v === 'string' && trackName ? trackName(v) : valueWord(k, v));
    // (by its plain name: "low crossover", never the song file's "lowFreq")
    const name = settingWord(k);
    if (!name) continue;
    const from = show(a[k]);
    const to = show(b[k]);
    // (a setting there wasn't before, an insert new to the track: its value alone, never "none to 300")
    out.push(typeof b[k] === 'object' || from === null || to === null ? `${name} changed` : a[k] === undefined ? `${name} ${to}` : `${name} ${from} to ${to}`);
  }
  return out.slice(0, 4).join(', ') + (out.length > 4 ? `, and ${out.length - 4} more` : '');
}

function diffTrack(a: Track, b: Track, tracks: readonly Track[], add: (c: SongChange) => void, trackName: (id: string) => string) {
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
      const label = insertLabel(k);
      const on = (v: unknown) => !!(v as { on?: boolean } | undefined)?.on;
      if (on(x) !== on(y)) add({ text: `Turns ${on(y) ? 'on' : 'off'} the ${label} on ${n}${on(y) ? ` (${settingChanges(x, y, trackName) || 'as it was set'})` : ''}.`, ...at });
      else add({ text: `Changes the ${label} on ${n}${on(y) ? '' : ' (switched off)'}: ${settingChanges(x, y, trackName)}.`, ...at });
    }
  }
  if (!same(a.synth, b.synth) && a.instrumentKey === b.instrumentKey) add({ text: `Gives ${n} a new synth sound.`, ...at });
  if (!same(a.drumDesign, b.drumDesign)) add({ text: `Changes the designed drum sounds of ${n}.`, ...at });
  if (!same(a.automation, b.automation)) diffLanes(a, b, tracks, add);
  if (!same(a.sends, b.sends)) add({ text: `Changes the sends of ${n} to the returns.`, ...at });
  const known = new Set(['name', 'instrumentKey', 'color', 'volume', 'pan', 'isMuted', 'isSoloed', 'reverbSend', 'delaySend', 'distance', 'output', 'eq', 'fx', 'synth', 'automation', 'sends', 'drumDesign']);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  // (settings not known here: heard anywhere, for all that's known)
  if (other.length) add({ text: `Changes other settings of ${n}${settingList(other)}.`, trackId: b.id, hear: 'song' });
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
  // (a send's lane is named by its return, whose name an agent may have written: marked as a name)
  const label = (l: AutomationLane) => {
    const to = l.param.startsWith('send:') ? tracks.find((t) => t.id === l.param.slice(5)) : undefined;
    return to ? `Send → ${nm(to.name)}` : specOf(l.param, b, tracks).label;
  };
  const span = (lanes: AutomationLane[]) => {
    const all = lanes.flatMap((l) => l.points.map((p) => p.bar));
    return all.length ? { fromBar: minOf(all), toBar: maxOf(all) + 1 } : {};
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
  return bars.length ? { fromBar: minOf(bars), toBar: maxOf(bars) + 1 } : {};
}

/** Whether a clip has lanes of its own (controllers: bend, mod, sustain, CCs; step lanes): what they set holds on past the clip, into the track's later clips. */
const hasLanes = (c: Clip): boolean => !!c.stepLanes?.length || (!!c.expression && Object.values(c.expression).some((v) => !!v?.length));

/** The other tracks a change is heard on too (a clip moved from one track to another: both). */
const alsoTracks = new WeakMap<SongChange, string[]>();

function diffClip(a: Clip, b: Clip, trackName: (id: string) => string, add: (c: SongChange) => void, playsPasses: (trackId: string) => boolean) {
  const n = nm(b.name);
  // (a clip with lanes, in either version: what they hold carries into the track's later clips, so
  // a change of it is heard wherever the track plays; else in its bars, with the notes' tail)
  const hear: HearWhere = hasLanes(a) || hasLanes(b) ? 'track' : 'here';
  const at = { trackId: b.trackId, clipId: b.id, hear };
  if (a.trackId !== b.trackId) {
    const moved: SongChange = { text: `Moves the clip ${n} from ${trackName(a.trackId)} to ${trackName(b.trackId)}.`, ...at, fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(clipSoundEnd(a), clipSoundEnd(b)) };
    alsoTracks.set(moved, [a.trackId]);
    add(moved);
  }
  if (Math.abs(a.startBar - b.startBar) > 1e-9)
    add({ text: `Moves the clip ${n} from ${barAt(a.startBar)} to ${barAt(b.startBar)}.`, ...at, fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(clipSoundEnd(a), clipSoundEnd(b)) });
  if (Math.abs(a.lengthBars - b.lengthBars) > 1e-9)
    add({ text: `Makes the clip ${n} ${lengthWords(b.lengthBars)} long (was ${lengthWords(a.lengthBars)}).`, ...at, fromBar: Math.min(a.startBar, b.startBar) + Math.min(a.lengthBars, b.lengthBars), toBar: Math.max(clipSoundEnd(a), clipSoundEnd(b)) });
  if (a.name !== b.name) add({ text: `Renames the clip ${nm(a.name)} to ${n}.`, ...at, hear: 'silent' });
  if (a.notes !== b.notes && !same(a.notes, b.notes)) {
    const before = new Map(a.notes.map((x) => [x.id, x]));
    const after = new Map(b.notes.map((x) => [x.id, x]));
    const added = b.notes.filter((x) => !before.has(x.id));
    const removed = a.notes.filter((x) => !after.has(x.id));
    const changed = b.notes.filter((x) => before.has(x.id) && !same(before.get(x.id), x));
    const touched = [...added, ...removed, ...changed, ...changed.map((x) => before.get(x.id)!)];
    const parts = [added.length && `adds ${plural(added.length, 'note')}`, changed.length && `changes ${plural(changed.length, 'note')}`, removed.length && `removes ${plural(removed.length, 'note')}`].filter(Boolean);
    const from = b.startBar + Math.max(0, minOf(touched.map((x) => x.startOffset)));
    // (to where the last of them stops: a note runs its whole length, past the clip's end too, and
    // the sustain pedal holds it on; one hidden by a trim doesn't play, so its own length is enough)
    const heldEnd = (x: NoteEvent) => maxOf(Math.min(b.lengthBars, noteEnd(x)), [a, b].flatMap((c) => soundingNotes({ ...c, notes: [x] }).map((h) => x.startOffset + h.bars)));
    const to = b.startBar + maxOf(touched.map(heldEnd));
    const where = to > from ? ` in ${bars(from, to)}` : '';
    // (heard in their bars and as they ring out after: the release and the track's effects, see hearing)
    add({ text: `In ${n} on ${trackName(b.trackId)}: ${parts.join(', ')}${where}.`, ...at, fromBar: from, toBar: Math.max(to, from + 1 / 16) });
  }
  // (a link plays the same notes, but it changes the clip's run of copies, and with it the pass of
  // its notes and of every later copy that play only on some passes: noteChance.ts contentKey. Then
  // heard as a change of its notes, from its start on: see hearing)
  if ((a.pattern ?? null) !== (b.pattern ?? null)) {
    const passes = playsPasses(a.trackId) || playsPasses(b.trackId);
    add({ text: b.pattern ? `Links the clip ${n} to its copies.` : `Unlinks the clip ${n} from its copies.`, ...at, ...(passes ? { fromBar: Math.min(a.startBar, b.startBar), toBar: Math.max(clipSoundEnd(a), clipSoundEnd(b)) } : { hear: 'silent' as HearWhere }) });
  }
  for (const k of ['expression', 'groove', 'wobble', 'stepLanes'] as const) if (!same(a[k], b[k])) add({ text: `Changes the ${k === 'stepLanes' ? 'step lanes' : k} of the clip ${n}.`, ...at, fromBar: b.startBar, toBar: Math.max(clipSoundEnd(a), clipSoundEnd(b)) });
  // (anything else about a clip, not known here: heard anywhere, for all that's known)
  const known = new Set(['id', 'trackId', 'startBar', 'lengthBars', 'name', 'notes', 'pattern', 'expression', 'groove', 'wobble', 'stepLanes', 'isSelected']);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  if (other.length) add({ text: `Changes other settings of the clip ${n}${settingList(other)}.`, trackId: b.trackId, clipId: b.id, hear: 'song' });
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
