/**
 * The store side of the chills tools (chills.ts, chillsBuild.ts): a chills progression as a new
 * clip, and the build into a peak, each one undo step, all or nothing against the caps. The build
 * writes ordinary automation lanes (volume, and the filter's cutoff) the person can see and edit,
 * plus a riser and a pad at the peak on new tracks if asked, their levels set by measuring the
 * music around them (rendered, as Export renders it). It then renders the bars again and says in
 * plain words what it did and what the peak measures, with the app's own cautions (agent/safety.ts,
 * the rules' and the sound check's) should anything come out louder.
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
import { checkSafety, measuredRise } from '../agent/safety';
import { makeTrack } from './trackFactory';
import { renderRange } from '../audio/listen';
import { listenSnapshot } from '../agent/listenSnapshot';
import { levelsOf } from '../agent/whereHeard';
import { channelsOf } from '../audio/exportWav';
import { measureLoudness } from '../audio/loudness';
import { barToSeconds, measuresFrom } from '../audio/tempoMap';

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
/** How far under the music at the peak the pad sits, LU (measured): it adds well under 1 dB. */
export const PAD_UNDER_LU = 10;
/** How far under the music at the end of the build the riser's loudest moment sits, dB (measured, 400 ms). */
export const RISER_UNDER_DB = 6;
/** A Filter with more resonance than this peaks at its cutoff: it isn't swept (it would sing through the sweep). */
export const RESONANT_Q = 1;

/** Tracks that can swell: playing in [from, peak), heard, not a bus or return, not the Drop pad. */
export function buildTracks(from: number, peak: number, only?: readonly string[]): Track[] {
  const s = tl();
  return s.tracks.filter(
    (t) =>
      (!only || only.includes(t.id)) &&
      !isMixTrack(t) &&
      !isDropKind(t.instrumentKey) &&
      !t.isMuted &&
      s.clips.some((c) => c.trackId === t.id && (!!c.audio || c.notes.length > 0) && c.startBar < peak - EPS && c.startBar + c.lengthBars > from + EPS)
  );
}

/** Whether a build with these choices would do anything at all. */
export const buildChosen = (o: Pick<BuildChoices, 'volume' | 'filter' | 'riser' | 'gap' | 'layer'>): boolean => o.volume || o.filter || o.riser || o.gap || o.layer;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mean square level of frames [a, b) of `ch`, dB. */
function levelDb(ch: readonly Float32Array[], a: number, b: number): number {
  let sum = 0;
  let n = 0;
  for (const c of ch)
    for (let i = Math.max(0, a); i < Math.min(c.length, b); i++) {
      sum += c[i] * c[i];
      n++;
    }
  return n && sum > 0 ? 10 * Math.log10(sum / n) : -Infinity;
}

/** The loudest 400 ms of frames [a, b) of `ch` (every 50 ms), dB. */
function loudestDb(ch: readonly Float32Array[], a: number, b: number, rate: number): number {
  const win = Math.round(rate * 0.4);
  const hop = Math.round(rate * 0.05);
  let most = -Infinity;
  for (let i = a; i + Math.min(win, b - a) <= b; i += hop) most = Math.max(most, levelDb(ch, i, i + Math.min(win, b - a)));
  return most;
}

/** Integrated loudness of frames [a, b) of `ch`, LUFS. */
const loudnessOf = async (ch: readonly Float32Array[], a: number, b: number, rate: number) => (b > a ? (await measureLoudness(ch.map((c) => c.slice(Math.max(0, a), b)), rate)).integrated : -Infinity);

/** What the build will write: the tracks with their lanes, and the new tracks and clips. */
interface BuildPlan {
  tracks: Map<string, Pick<Track, 'automation' | 'fx'>>;
  riser: { track: Track; clip: Clip } | null;
  pad: { track: Track; clip: Clip } | null;
  swelled: number;
  opened: number;
  resonant: string[];
  noChords: boolean;
  padEnd: number;
}

function planBuild(o: BuildChoices, tracks: readonly Track[], map: ReturnType<typeof songMeterOf>): BuildPlan {
  const s = tl();
  const places = buildPlaces(o, map);
  const plan: BuildPlan = { tracks: new Map(), riser: null, pad: null, swelled: 0, opened: 0, resonant: [], noChords: false, padEnd: o.peak };
  for (const t of tracks) {
    let automation = [...(t.automation ?? [])];
    let fx: Track['fx'] = t.fx;
    let changed = false;
    const lane = (param: AutomationLane['param']) => automation.find((l) => l.param === param);
    const put = (param: AutomationLane['param'], points: AutomationLane['points']) => {
      automation = lane(param) ? automation.map((l) => (l.param === param ? { param, points } : l)) : [...automation, { param, points }];
      changed = true;
    };
    if (o.volume || o.gap) {
      // (the near-silence alone: no swell, only the breath before the peak)
      const points = swellLane(lane('volume')?.points, t.volume, { ...o, depthDb: o.volume ? o.depthDb : 0 }, map);
      if (points) {
        put('volume', points);
        if (o.volume) plan.swelled++;
      }
    }
    const k = t.instrumentKey;
    const filter = t.fx.filter;
    const stepped = s.clips.some((c) => c.trackId === t.id && c.stepLanes?.some((l) => l.target === 'filterCutoff'));
    if (o.filter && !isDrumKind(k) && !isFxKind(k) && !stepped && (!filter?.on || filter.type === 'lowpass')) {
      const resonant = !!filter?.on && (filter.resonance > RESONANT_Q || !!lane('filterResonance')?.points.length);
      if (resonant) plan.resonant.push(t.name);
      else {
        put('filterCutoff', openingLane(lane('filterCutoff')?.points, filter?.on ? filter.cutoff : 20000, o, map));
        // A filter that was off comes on gentle: a 12 dB low-pass with no peak, fully open after the build
        if (!filter?.on) fx = normalizeTrackFx({ ...t.fx, filter: { ...t.fx.filter, on: true, type: 'lowpass', resonance: Math.SQRT1_2, slope: 12 } });
        plan.opened++;
      }
    }
    if (changed) plan.tracks.set(t.id, { automation, fx });
  }
  const made: Track[] = [...s.tracks];
  if (o.riser && places.gapStart - o.from >= 1 / 4 - EPS) {
    const track = { ...makeTrack('fx', made, 'Riser'), volume: -60 };
    made.push(track);
    const len = places.gapStart - o.from;
    plan.riser = { track, clip: { id: uid('clip'), trackId: track.id, name: 'Riser', startBar: o.from, lengthBars: len, notes: [{ id: newId(), note: FX_NOTES.riser, startOffset: 0, duration: barsToDuration(len), velocity: 0.6 }], isSelected: false } };
  }
  if (o.layer) {
    const end = Math.min(TOTAL_BARS + 1, addMeasures(o.peak, LAYER_MEASURES, map));
    const chords = end > o.peak + EPS ? chordsOver(o.peak, end) : [];
    plan.noChords = !chords.length;
    if (chords.length) {
      const track = { ...makeTrack('wavetable', made, 'Peak pad'), volume: -60 };
      const range = rangeOf(track);
      let prev: number[] | null = null;
      const notes: NoteEvent[] = chords.flatMap((c) => {
        const voiced = wideChord(c.pcs.slice(0, 4), prev, range);
        prev = voiced.upper;
        return [...voiced.bass, ...voiced.upper].map((m) => ({ id: newId(), note: nameOf(m), startOffset: Math.round(c.at * 192) / 192, duration: barsToDuration(c.end - c.at), velocity: 0.5 }));
      });
      plan.pad = { track, clip: { id: uid('clip'), trackId: track.id, name: 'Peak pad', startBar: o.peak, lengthBars: end - o.peak, notes, isSelected: false } };
      plan.padEnd = end;
    }
  }
  return plan;
}

/** A build being measured: one at a time. */
let measuring = false;

/**
 * The build into a peak (see BuildChoices): one undo step. A riser or a pad is set by measuring
 * the music first (the song rendered over the bars before the build to the end of the pad, and each
 * new part on its own): the riser's loudest moment RISER_UNDER_DB under the music where the build
 * ends, the pad PAD_UNDER_LU under the music at the peak. After it's written the bars are rendered
 * again and measured: what the peak comes out at against the bars before the build, and the sound
 * check's caution (safety.ts measuredRise) if anything is much louder. Resolves to what it did in
 * plain words (or why it did nothing: then there's no undo step).
 */
export async function buildForChills(o: BuildChoices): Promise<string> {
  const s = tl();
  const map = songMeterOf(s);
  if (!buildChosen(o)) return 'Choose at least one part of the build: nothing was changed.';
  if (!(o.peak > o.from + EPS) || o.from < 1 - EPS || o.peak > TOTAL_BARS + 1 + EPS) return 'Pick the bars before a peak: the build needs room before it.';
  const tracks = buildTracks(o.from, o.peak, o.trackIds);
  if (!tracks.length) return 'Nothing plays there to build: put some parts in those bars first.';
  if (measuring) return 'A build is being measured already.';
  const places = buildPlaces(o, map);
  const plan = planBuild(o, tracks, map);
  if (!plan.tracks.size && !plan.riser && !plan.pad) return `Nothing to change there${plan.resonant.length ? `: the filter on ${plan.resonant.join(', ')} has a resonant peak, so it isn't swept` : plan.noChords ? ': no chords play at the peak, so no pad joins there' : ''}. Nothing was changed.`;
  const before = currentProject();
  const tempo = { bpm: before.bpm, points: before.tempoPoints ?? [] };
  // The bars measured: as many before the build as it is long (at least a measure), to the pad's end (or a measure past the peak)
  const pre = Math.max(1, Math.min(measuresFrom(o.from, -1, map), o.from - (o.peak - o.from)));
  const end = Math.max(plan.padEnd, Math.min(TOTAL_BARS + 1, addMeasures(o.peak, 1, map)));
  const sec = (bar: number) => barToSeconds(bar, tempo) - barToSeconds(pre, tempo);
  measuring = true;
  let riserDb: number | null = null;
  let padDb: number | null = null;
  let a: AudioBuffer;
  try {
    s.pause();
    a = await renderRange(listenSnapshot(before), pre, end);
    const rate = a.sampleRate;
    const at = (bar: number) => Math.round(sec(bar) * rate);
    const music = channelsOf(a);
    const alone = (part: { track: Track; clip: Clip }) => renderRange(listenSnapshot({ ...before, tracks: [{ ...part.track, volume: 0 }], clips: [part.clip] }), part.clip.startBar, part.clip.startBar + part.clip.lengthBars);
    if (plan.riser) {
      // The music over the build's last measure (where the swell is back at its level)
      const musicEnd = levelDb(music, at(Math.max(o.from, measuresFrom(places.gapStart, -1, map))), at(places.gapStart));
      const r = await alone(plan.riser);
      const loudest = loudestDb(channelsOf(r), 0, r.length, r.sampleRate);
      if (Number.isFinite(musicEnd) && musicEnd > -60 && Number.isFinite(loudest)) riserDb = Math.max(-60, Math.min(0, musicEnd - RISER_UNDER_DB - loudest));
    }
    if (plan.pad) {
      const musicPeak = await loudnessOf(music, at(o.peak), at(plan.padEnd), rate);
      const p = await alone(plan.pad);
      const padLufs = await loudnessOf(channelsOf(p), 0, p.length, p.sampleRate);
      if (Number.isFinite(musicPeak) && Number.isFinite(padLufs)) padDb = Math.max(-60, Math.min(0, musicPeak - PAD_UNDER_LU - padLufs));
    }
  } catch {
    measuring = false;
    return 'The music couldn’t be measured for the build, so nothing was changed. Try again.';
  }
  measuring = false;
  // (the song changed while it was measured: what was measured isn't the song any more)
  const now = tl();
  if (now.tracks !== before.tracks || now.clips !== before.clips || now.master !== before.master) return 'The song changed while the build was being measured, so nothing was changed. Try again.';
  const riser = plan.riser && riserDb !== null ? { ...plan.riser, track: { ...plan.riser.track, volume: Math.round(riserDb * 10) / 10 } } : null;
  const pad = plan.pad && padDb !== null ? { ...plan.pad, track: { ...plan.pad.track, volume: Math.round(padDb * 10) / 10 } } : null;
  if (!plan.tracks.size && !riser && !pad) return 'The music there is silent, so there is nothing to build on: nothing was changed.';
  const done = allOrNothing(() => {
    s.checkpoint();
    const past = tl().past;
    useTimelineStore.setState((st) => ({
      tracks: [...st.tracks.map((t) => (plan.tracks.has(t.id) ? { ...t, ...plan.tracks.get(t.id)! } : t)), ...(riser ? [riser.track] : []), ...(pad ? [pad.track] : [])],
      clips: [...st.clips, ...(riser ? [riser.clip] : []), ...(pad ? [pad.clip] : [])],
    }));
    // One undo step, whatever the edits above recorded
    useTimelineStore.setState({ past, future: [] });
  }, true);
  if (!done.done) return pastCapsWords(done.past);
  // The lanes in view on the tracks that swell (a view setting: no undo step)
  if (o.volume || o.gap) for (const t of tracks.filter((x) => plan.tracks.has(x.id)).slice(0, 8)) tl().showAutomation(t.id, true, 'volume');
  const after = currentProject();
  const cautions = checkSafety(before, after);
  // Measured again with the build in: the peak against the bars before the build, and the sound check
  let measured = '';
  try {
    const b = await renderRange(listenSnapshot(after), pre, end);
    const rate = b.sampleRate;
    const at = (bar: number) => Math.round(sec(bar) * rate);
    const ac = channelsOf(a);
    const bc = channelsOf(b);
    if (pre < o.from - EPS) {
      const was = await loudnessOf(ac, at(pre), at(o.from), rate);
      const peakNow = await loudnessOf(bc, at(o.peak), at(end), rate);
      if (Number.isFinite(was) && Number.isFinite(peakNow)) {
        const d = r1(peakNow - was);
        measured = ` Measured, the peak comes out ${Math.abs(d) < 0.05 ? 'as loud as' : `${Math.abs(d)} dB ${d > 0 ? 'louder' : 'quieter'} than`} the bars before the build.`;
      }
    }
    const spans: Array<{ start: number; end: number }> = [];
    for (let bar = pre; bar < end - EPS; bar = Math.min(end, addMeasures(bar, 1, map))) spans.push({ start: sec(bar), end: sec(Math.min(end, addMeasures(bar, 1, map))) });
    const signal = new AbortController().signal;
    const [la, lb] = [await levelsOf(a, spans, signal), await levelsOf(b, spans, signal)];
    const rise = measuredRise(la.bars, lb.bars, la.song);
    if (rise) cautions.push(`The build comes out up to ${Math.round(rise.own)} dB louder (from bar ${formatBarPosition(addMeasures(pre, rise.bar - 1, map), map)}). Turn your speakers down before you listen.`);
  } catch {
    measured = ' (It couldn’t be measured again afterwards.)';
  }
  const what = [
    plan.swelled ? `${plural(plan.swelled, 'track swells', 'tracks swell')} from ${o.depthDb} dB under ${plan.swelled === 1 ? 'its' : 'their'} level back to it (${plan.swelled === 1 ? 'a volume lane' : 'volume lanes'})` : '',
    plan.opened ? `a low-pass filter opens on ${plural(plan.opened, 'track', 'tracks')} (${plan.opened === 1 ? 'a filter lane' : 'filter lanes'})` : '',
    riser ? `a riser plays under it on a new track, ${RISER_UNDER_DB} dB under the music at its loudest` : plan.riser ? 'no riser, as the music there is silent' : '',
    places.gapIn ? 'half a beat of near-silence comes just before the peak' : '',
    pad ? `a pad joins at the peak on a new track with the chords spread wide, ${PAD_UNDER_LU} dB under the music` : plan.pad ? 'no pad, as the music at the peak is silent' : plan.noChords ? 'no chords play at the peak, so no pad joins there' : '',
    plan.resonant.length ? `the filter on ${plan.resonant.join(', ')} has a resonant peak, so it isn't swept` : '',
  ].filter(Boolean);
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : (what[0] ?? 'nothing more');
  const head = `A build for chills over ${formatBarRange(o.from, o.peak, map)} into bar ${formatBarPosition(o.peak, map)}: ${list}. No track already there is turned up past where it was.${measured}`;
  return `${head}${cautions.length ? ` ${cautions.join(' ')}` : ''} Undo takes it out.`;
}

