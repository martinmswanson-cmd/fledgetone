/**
 * The store side of the chills tools (chills.ts, chillsBuild.ts): a chills progression as a new
 * clip, and the build into a peak, each one undo step, all or nothing against the caps. The build
 * writes ordinary automation lanes (volume, and the filter's cutoff) the person can see and edit,
 * plus a riser and a pad at the peak on new tracks if asked, and says in plain words what it did,
 * with the app's own cautions (agent/safety.ts) should anything come out louder.
 */
import { allOrNothing, currentProject, songMeterOf, useTimelineStore } from './timelineStore';
import { pastCapsWords } from './songCaps';
import type { AutomationLane, Clip, NoteEvent, Track } from './timelineTypes';
import { barsToDuration, formatBarPosition, formatBarRange, normalizeTrackFx, TOTAL_BARS, uid } from './timelineTypes';
import type { SongKey } from './songKey';
import { chillsChords, chillsNotes, chillsById, wideChord } from './chills';
import { chordChanges, chordSpans } from './smartTools';
import { placeClip } from './smartActions';
import { BUILD_MOST_RISE_DB, buildPlaces, openingLane, swellLane } from './chillsBuild';
import { addMeasures } from '../audio/tempoMap';
import { FX_NOTES, INSTRUMENTS, isDropKind, isDrumKind, isFxKind } from '../audio/instrumentCatalog';
import { isMixTrack } from './buses';
import { nameOf } from './noteTools';
import { checkSafety } from '../agent/safety';

const tl = () => useTimelineStore.getState();
const EPS = 1e-6;
const newId = () => uid('note');

/** An instrument's playable range (the whole keyboard for one that doesn't say). */
const rangeOf = (track: Track | undefined): readonly [number, number] => INSTRUMENTS[track?.instrumentKey ?? 'keys']?.range ?? [0, 127];

/**
 * A chills progression clip on a pitched track at `atBar`: each chord `chordBars` measures (as the
 * ruler counts them), `repeats` times through (once for a key change). One undo step; the clip's id
 * (null: none made).
 */
export function makeChillsClip(trackId: string, atBar: number, progId: string, key: SongKey, chordBars: number, repeats: number): string | null {
  const prog = chillsById(progId);
  const track = tl().tracks.find((t) => t.id === trackId);
  if (!prog || !track || isDropKind(track.instrumentKey) || isDrumKind(track.instrumentKey)) return null;
  const count = chillsChords(key, prog).length * (prog.lift ? 1 : Math.max(1, Math.round(repeats)));
  const { spans, length } = chordSpans(atBar, count, chordBars, songMeterOf(tl()));
  const notes = chillsNotes(key, prog, spans, newId, { range: rangeOf(track) });
  return placeClip(trackId, atBar, length, notes, prog.name);
}

/** Notes heard on a track over [from, to), as positions from `from`. */
function notesOver(trackId: string, from: number, to: number): NoteEvent[] {
  return tl()
    .clips.filter((c) => c.trackId === trackId && !c.audio && c.startBar < to - EPS && c.startBar + c.lengthBars > from + EPS)
    .flatMap((c) => c.notes.filter((n) => n.startOffset >= -EPS && n.startOffset < c.lengthBars - EPS).map((n) => ({ ...n, startOffset: c.startBar + n.startOffset - from })));
}

/** A pitched track's chords over [from, to) (the one playing the most, three notes or more at once), from `from`. */
function chordsOver(from: number, to: number): ReturnType<typeof chordChanges> {
  let best: ReturnType<typeof chordChanges> = [];
  let most = 0;
  for (const t of tl().tracks) {
    const k = t.instrumentKey;
    if (isDrumKind(k) || isFxKind(k) || isDropKind(k) || isMixTrack(t) || t.isMuted) continue;
    const notes = notesOver(t.id, from, to);
    const starts = new Map<number, number>();
    for (const n of notes) starts.set(Math.round(n.startOffset * 192), (starts.get(Math.round(n.startOffset * 192)) ?? 0) + 1);
    const chords = [...starts.values()].filter((v) => v >= 3).length;
    if (chords > most) {
      most = chords;
      best = chordChanges(notes, to - from);
    }
  }
  return best;
}

export interface BuildChoices {
  /** The build: from here to the peak */
  from: number;
  peak: number;
  /** Only these tracks swell (none given: every track playing in the build) */
  trackIds?: readonly string[];
  /** How far under their level the tracks start, dB (at most BUILD_MOST_RISE_DB) */
  depthDb: number;
  volume: boolean;
  filter: boolean;
  riser: boolean;
  gap: boolean;
  /** A pad at the peak, the chords there spread wide */
  layer: boolean;
}

/** The defaults the studio's dialog and Pocket start from. */
export const BUILD_DEFAULTS: Omit<BuildChoices, 'from' | 'peak'> = { depthDb: BUILD_MOST_RISE_DB, volume: true, filter: true, riser: true, gap: true, layer: true };

/** How long the pad at the peak plays, in measures. */
const LAYER_MEASURES = 4;
/** The riser's and the pad's faders, dB: under the mix. */
const RISER_DB = -14;
const LAYER_DB = -12;

/** Tracks that can swell: playing in [from, peak), heard, not a bus or return, not the Drop pad. */
export function buildTracks(from: number, peak: number, only?: readonly string[]): Track[] {
  const s = tl();
  return s.tracks.filter(
    (t) =>
      (!only || only.includes(t.id)) &&
      !isMixTrack(t) &&
      !isDropKind(t.instrumentKey) &&
      !t.isMuted &&
      s.clips.some((c) => c.trackId === t.id && c.startBar < peak - EPS && c.startBar + c.lengthBars > from + EPS)
  );
}

/**
 * The build into a peak (see BuildChoices): one undo step. Returns what it did in plain words (or
 * why it did nothing).
 */
export function buildForChills(o: BuildChoices): string {
  const s = tl();
  const map = songMeterOf(s);
  if (!(o.peak > o.from + EPS) || o.from < 1 - EPS || o.peak > TOTAL_BARS + 1 + EPS) return 'Pick the bars before a peak: the build needs room before it.';
  const tracks = buildTracks(o.from, o.peak, o.trackIds);
  if (!tracks.length) return 'Nothing plays there to build: put some parts in those bars first.';
  const places = buildPlaces(o, map);
  const before = currentProject();
  let swelled = 0;
  let opened = 0;
  let riser = false;
  let layer: string | null = null;
  const done = allOrNothing(() => {
    s.checkpoint();
    const past = tl().past;
    const lanes = new Map<string, { automation: AutomationLane[]; fx?: Track['fx'] }>();
    for (const t of tracks) {
      let automation = [...(t.automation ?? [])];
      let fx: Track['fx'] | undefined;
      const lane = (param: AutomationLane['param']) => automation.find((l) => l.param === param);
      const put = (param: AutomationLane['param'], points: AutomationLane['points']) => {
        automation = lane(param) ? automation.map((l) => (l.param === param ? { param, points } : l)) : [...automation, { param, points }];
      };
      if (o.volume) {
        const points = swellLane(lane('volume')?.points, t.volume, { ...o, depthDb: o.depthDb }, map);
        if (points) {
          put('volume', points);
          swelled++;
        }
      }
      const k = t.instrumentKey;
      const filter = t.fx.filter;
      const stepped = s.clips.some((c) => c.trackId === t.id && c.stepLanes?.some((l) => l.target === 'filterCutoff'));
      if (o.filter && !isDrumKind(k) && !isFxKind(k) && !stepped && (!filter?.on || filter.type === 'lowpass')) {
        put('filterCutoff', openingLane(lane('filterCutoff')?.points, filter?.on ? filter.cutoff : 20000, o, map));
        // A filter that was off comes on gentle: a 12 dB low-pass with no peak, fully open after the build
        if (!filter?.on) fx = normalizeTrackFx({ ...t.fx, filter: { ...t.fx.filter, on: true, type: 'lowpass', resonance: Math.SQRT1_2, slope: 12 } });
        opened++;
      }
      lanes.set(t.id, { automation, ...(fx ? { fx } : {}) });
    }
    useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (lanes.has(t.id) ? { ...t, ...lanes.get(t.id)! } : t)) }));

    const added: Clip[] = [];
    const newTrack = (instrument: Track['instrumentKey'], name: string, db: number): string | null => {
      const id = tl().addTrack(instrument, name);
      if (!tl().tracks.some((t) => t.id === id)) return null;
      useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === id ? { ...t, volume: db } : t)) }));
      return id;
    };
    if (o.riser && places.gapStart - o.from >= 1 / 4 - EPS) {
      const id = newTrack('fx', 'Riser', RISER_DB);
      if (id) {
        const len = places.gapStart - o.from;
        added.push({ id: uid('clip'), trackId: id, name: 'Riser', startBar: o.from, lengthBars: len, notes: [{ id: newId(), note: FX_NOTES.riser, startOffset: 0, duration: barsToDuration(len), velocity: 0.6 }], isSelected: false });
        riser = true;
      }
    }
    if (o.layer) {
      const end = Math.min(TOTAL_BARS + 1, addMeasures(o.peak, LAYER_MEASURES, map));
      const chords = end > o.peak + EPS ? chordsOver(o.peak, end) : [];
      if (chords.length) {
        const id = newTrack('wavetable', 'Peak pad', LAYER_DB);
        if (id) {
          const range = rangeOf(tl().tracks.find((t) => t.id === id));
          let prev: number[] | null = null;
          const notes: NoteEvent[] = chords.flatMap((c) => {
            const voiced = wideChord(c.pcs.slice(0, 4), prev, range);
            prev = voiced.upper;
            return [...voiced.bass, ...voiced.upper].map((m) => ({ id: newId(), note: nameOf(m), startOffset: Math.round(c.at * 192) / 192, duration: barsToDuration(c.end - c.at), velocity: 0.5 }));
          });
          added.push({ id: uid('clip'), trackId: id, name: 'Peak pad', startBar: o.peak, lengthBars: end - o.peak, notes, isSelected: false });
          layer = id;
        }
      }
    }
    if (added.length) useTimelineStore.setState((st) => ({ clips: [...st.clips, ...added] }));
    // One undo step, whatever the edits above recorded
    useTimelineStore.setState({ past, future: [] });
  }, true);
  if (!done.done) return pastCapsWords(done.past);
  // The lanes in view on the tracks that swell (a view setting: no undo step)
  for (const t of tracks.slice(0, 8)) if (o.volume) tl().showAutomation(t.id, true, 'volume');
  const cautions = checkSafety(before, currentProject());
  const what = [
    swelled ? `${swelled} track${swelled === 1 ? '' : 's'} swell from ${o.depthDb} dB under ${swelled === 1 ? 'its' : 'their'} level back to it (volume lanes)` : '',
    opened ? `a low-pass filter opens on ${opened}` : '',
    riser ? 'a riser plays under it' : '',
    places.gapIn ? 'a moment of near-silence comes just before the peak' : '',
    layer ? 'a pad joins at the peak with the chords spread wide' : o.layer ? 'no chords play at the peak, so no pad joins there' : '',
  ].filter(Boolean);
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
  const head = `A build for chills over ${formatBarRange(o.from, o.peak, map)} into bar ${formatBarPosition(o.peak, map)}: ${list}. No track is turned up past where it was.`;
  return `${head}${cautions.length ? ` ${cautions.join(' ')}` : ''} Undo takes it out.`;
}
