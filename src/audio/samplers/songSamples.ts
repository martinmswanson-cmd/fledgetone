/**
 * Which of a recorded instrument's recordings a song needs first: for each note it plays, the
 * recording nearest that pitch (the one the sampler would pick) at every loudness its velocity can
 * reach, every take of those, the next recording on the other side within stretching distance,
 * and the release sounds nearest it. The instrument loads these first and plays as soon as they're
 * in; the rest follow in the background, or for a big set only as notes ask for them (see
 * samplerManager.ts). And how an export spends its memory on them, and whether the device has
 * little of it.
 *
 * Pure: sample names and numbers in, sample names out, so Node can test it.
 */
import { HUMAN_MAX_DYNAMICS } from '../human';
import type { Clip, NoteEvent, Track } from '../../store/timelineTypes';
import { durationToBars } from '../../store/timelineTypes';
import { sustainNotes } from '../../store/expression';

/** How far either side of a loudness boundary (in velocity) two recordings are blended. */
export const BLEND_ZONE = 0.07;
/** How far (semitones) a recording is stretched before a nearer one elsewhere is preferred. */
export const STRETCH_SEMITONES = 3;
/** The furthest a recording is searched for from a note (semitones), as the sampler does. */
const SEARCH = 96;

/**
 * A note a song plays: its MIDI note, its velocity, the loudest of the chord it's in (a chord
 * plays at its loudest), and how far its velocity can drift either way as it plays (a fraction:
 * its track's Human insert, up to HUMAN_MAX_DYNAMICS).
 */
export interface SongNote {
  midi: number;
  velocity: number;
  loudest: number;
  drift?: number;
}

/** A sample's name taken apart: "<note>|<layer>|<take>", or "rel|<note>|<take>" for a release sound. */
export function parseSampleName(name: string): { note: string; layer: number; take: number; release: boolean } {
  const parts = name.split('|');
  if (parts[0] === 'rel') return { note: parts[1], layer: 0, take: Number(parts[2] ?? 0), release: true };
  return { note: parts[0], layer: Number(parts[1] ?? 0), take: Number(parts[2] ?? 0), release: false };
}

/**
 * How many times the rate it plays at a recording is decoded at. Twice: a note played on its own
 * recording reads every other sample (exactly what was recorded, no interpolation), and one
 * stretched to another pitch has about 12 dB less of the buffer source's interpolation error.
 */
export const OVERSAMPLE = 2 as const;

/** The rate an instrument's recordings are decoded at for a context at `rate` (`lowMemory`: at that rate, to save memory). */
export function decodeRateOf(rate: number, lowMemory = false): number {
  return lowMemory ? rate : OVERSAMPLE * rate;
}

/**
 * The MIDI note in `sorted` (ascending) a sampler plays `midi` from: the nearest, the higher on a
 * tie, within SEARCH semitones; undefined if none.
 */
export function nearestMidi(sorted: number[], midi: number): number | undefined {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < midi) lo = mid + 1;
    else hi = mid;
  }
  const up = sorted[lo];
  const down = sorted[lo] === midi ? midi : sorted[lo - 1];
  const upGap = up === undefined ? Infinity : up - midi;
  const downGap = down === undefined ? Infinity : midi - down;
  const gap = Math.min(upGap, downGap);
  if (gap >= SEARCH) return undefined;
  return upGap <= downGap ? up : down;
}

/** The loudness (index into `tops`) a velocity plays, as the sampler picks it. */
export function layerOf(tops: number[], velocity: number): number {
  const found = tops.findIndex((top) => velocity <= top + 1e-6);
  return found < 0 ? tops.length - 1 : found;
}

/** One sampler slot's recordings (one loudness, one take): MIDI numbers ascending, and the name at each. */
export interface SlotIndex {
  midis: number[];
  names: Map<number, string>;
}

/** An instrument's recordings, indexed for neededSamples, slot by slot as the sampler holds them. */
export interface RecordingIndex {
  /** By loudness, then take */
  layers: SlotIndex[][];
  /** Release sounds by take */
  releases: SlotIndex[];
  /** Velocity tops of the loudnesses (SampleSource.layers) */
  tops: number[];
  /** The loudness loaded first when nothing is known of the song (see quickLayer) */
  quick: number;
}

/** Which loudness of `count` loads first when nothing is known of the song: one just above the middle. */
export const quickLayer = (count: number) => Math.min(count - 1, Math.floor(count * 0.6));

const slot = (): SlotIndex => ({ midis: [], names: new Map() });

/** Index an instrument's sample names (`midiOf` reads a note name). */
export function indexRecordings(names: string[], midiOf: (note: string) => number, tops: number[] = [1]): RecordingIndex {
  const layers: SlotIndex[][] = tops.map(() => []);
  const releases: SlotIndex[] = [];
  for (const name of names) {
    const p = parseSampleName(name);
    const midi = Math.round(midiOf(p.note));
    if (p.release) {
      while (releases.length <= p.take) releases.push(slot());
      releases[p.take].names.set(midi, name);
      continue;
    }
    while (layers.length <= p.layer) layers.push([]);
    const takes = layers[p.layer];
    while (takes.length <= p.take) takes.push(slot());
    takes[p.take].names.set(midi, name);
  }
  for (const s of [...layers.flat(), ...releases]) s.midis = [...s.names.keys()].sort((a, b) => a - b);
  return { layers, releases, tops, quick: quickLayer(tops.length) };
}

/**
 * The recordings `notes` need, by name. `wheel` is the span of a mod wheel lane's values, for an
 * instrument whose loudnesses the wheel crossfades (InstrumentDef.dynamics): it plays the
 * loudness at the wheel's value and the next louder one.
 *
 * A note's velocity can move before it sounds (its drift; a chord plays at its loudest note's),
 * and near a loudness boundary the two recordings either side are blended (BLEND_ZONE), so every
 * loudness in reach of those is included, every take of each. A note further than
 * STRETCH_SEMITONES from any recording in its slot plays the first-loaded slot's nearest instead
 * (the sampler's fallback), so that's included too.
 */
export function neededSamples(index: RecordingIndex, notes: SongNote[], wheel?: [number, number] | null): Set<string> {
  const out = new Set<string>();
  /** The recording `s` plays `midi` from (added), and the next one on the other side if within stretching distance. */
  const take = (s: SlotIndex, midi: number, neighbour: boolean) => {
    const m = nearestMidi(s.midis, midi);
    if (m === undefined) return undefined;
    out.add(s.names.get(m)!);
    if (neighbour && m !== midi) {
      const i = s.midis.indexOf(m);
      const other = m > midi ? s.midis[i - 1] : s.midis[i + 1];
      if (other !== undefined && Math.abs(other - midi) <= STRETCH_SEMITONES) out.add(s.names.get(other)!);
    }
    return m;
  };
  walkNotes(index, notes, wheel, take);
  return out;
}

/**
 * Every note of `notes` (once per pitch and loudnesses in reach) against the slots it can play
 * from: `take(slot, midi, neighbour)` for each slot of each loudness in reach (see neededSamples)
 * and returns the recording that slot plays it from; a note too far from it plays the first-loaded
 * slot's (taken without its neighbour), and each release slot's nearest is taken too.
 */
function walkNotes(index: RecordingIndex, notes: SongNote[], wheel: [number, number] | null | undefined, take: (s: SlotIndex, midi: number, neighbour: boolean) => number | undefined): void {
  const seen = new Set<string>();
  const { layers, tops } = index;
  const fallback = layers[index.quick]?.[0];
  // The loudnesses the mod wheel reaches (see dynamicsMix in samplerManager.ts)
  const span = layers.length - 1;
  const wheelLow = (v: number) => Math.max(0, Math.min(span - 1, Math.floor(Math.max(0, Math.min(1, v)) * span)));
  const byWheel = wheel && span > 0 ? [wheelLow(wheel[0]), wheelLow(wheel[1]) + 1] : null;
  for (const note of notes) {
    const reach = layersInReach(tops, note);
    if (byWheel) for (let l = byWheel[0]; l <= byWheel[1]; l++) reach.add(l);
    const key = `${note.midi}:${[...reach].join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const layer of reach) {
      for (const s of layers[layer] ?? []) {
        const m = take(s, note.midi, true);
        // Too far to stretch: the sampler plays the first-loaded slot's recording
        if (fallback && s !== fallback && (m === undefined || Math.abs(m - note.midi) > STRETCH_SEMITONES)) take(fallback, note.midi, false);
      }
    }
    for (const r of index.releases) take(r, note.midi, false);
  }
}

/**
 * The loudnesses (indexes into `tops`) a note can play: its velocity can drift (its Human
 * insert), a chord plays at its loudest note's, and near a boundary two loudnesses blend.
 */
export function layersInReach(tops: number[], note: Pick<SongNote, 'velocity' | 'loudest' | 'drift'>): Set<number> {
  const drift = Math.max(0, Math.min(HUMAN_MAX_DYNAMICS, note.drift ?? 0));
  const soft = Math.max(0, note.velocity * (1 - drift) - BLEND_ZONE);
  const loud = Math.min(1, Math.max(note.velocity, note.loudest) * (1 + drift) + BLEND_ZONE);
  const reach = new Set<number>();
  for (let l = layerOf(tops, soft); l <= layerOf(tops, loud); l++) reach.add(l);
  return reach;
}

/** The furthest (semitones) a recording is copied at another pitch: past it a note plays it stretched as before (see pitchedCopies.ts). */
export const COPY_SEMITONES = 24;

/**
 * The pitches `notes` play each recording at, other than its own (semitones from it, by
 * recording's name): the recording each slot in reach plays a note from (see neededSamples),
 * and its release sound's. What a song needs of re-pitched copies (see pitchedCopies.ts), made
 * ahead so those notes play a copy instead of stretching the recording as they sound.
 */
export function neededPitches(index: RecordingIndex, notes: SongNote[], wheel?: [number, number] | null): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  walkNotes(index, notes, wheel, (s, midi) => {
    const m = nearestMidi(s.midis, midi);
    if (m === undefined) return undefined;
    const semis = midi - m;
    if (semis !== 0 && Math.abs(semis) <= COPY_SEMITONES) {
      const name = s.names.get(m)!;
      let row = out.get(name);
      if (!row) out.set(name, (row = new Set()));
      row.add(semis);
    }
    return m;
  });
  return out;
}

/**
 * The recordings loaded first when nothing is known of the song: one loudness (index.quick), the
 * first take, of every note; or, with `spacing` (semitones), only enough of them that every note
 * is within half that of one (a big set, which loads the rest as notes ask: a recording stretched
 * that far plays until the note's own is in).
 */
export function quickSamples(index: RecordingIndex, spacing = 0): Set<string> {
  const s = index.layers[index.quick]?.[0];
  if (!s) return new Set();
  if (spacing <= 1) return new Set(s.names.values());
  const out = new Set<string>();
  let last = -Infinity;
  s.midis.forEach((m, i) => {
    // (the lowest and the highest always, so the ends of the range aren't stretched further)
    if (m - last >= spacing || i === s.midis.length - 1) {
      out.add(s.names.get(m)!);
      last = m;
    }
  });
  return out;
}

/** How far apart (semitones) a big set's first recordings are (see quickSamples): every note within 3 of one, as the sampler stretches. */
export const SPARSE_QUICK = 2 * STRETCH_SEMITONES;

/**
 * How an export decodes each instrument's recordings, from what they'd take decoded at its rate
 * (bytes, by instrument): 2, at twice its rate; 1, at its rate; 0, not at all (it plays the
 * recordings live playback has, resampled as they play where the rates differ). The cheapest
 * first, each at the most that still fits in `budget` with those before it (never more than
 * `most` times), so a song with a big piano part doesn't take gigabytes to render.
 */
export function chooseExportDecodes<K>(costs: ReadonlyArray<readonly [K, number]>, budget: number, most: 1 | 2 = OVERSAMPLE): Map<K, 0 | 1 | 2> {
  const out = new Map<K, 0 | 1 | 2>();
  let spent = 0;
  for (const [key, bytes] of [...costs].sort((a, b) => a[1] - b[1])) {
    const times = most === 2 && spent + 2 * bytes <= budget ? 2 : spent + bytes <= budget ? 1 : 0;
    spent += times * bytes;
    out.set(key, times);
  }
  return out;
}

/** What a browser says of the device, for lowMemoryDevice. */
export interface DeviceHints {
  deviceMemory?: number;
  maxTouchPoints?: number;
  userAgent?: string;
}

/**
 * Whether the device has little memory: 4 GB or less where the browser says (Chromium's
 * deviceMemory); where it doesn't (Safari, Firefox), a phone or tablet (touch, iOS) or a browser
 * that never says, which is taken the careful way, since an iPhone's tab is closed for a gigabyte
 * or two.
 */
export function lowMemoryDevice(hints: DeviceHints): boolean {
  if (typeof hints.deviceMemory === 'number') return hints.deviceMemory <= 4;
  const ua = hints.userAgent ?? '';
  if ((hints.maxTouchPoints ?? 0) > 0 || /iPhone|iPad|iPod|Android/.test(ua)) return true;
  // Safari and Firefox don't say how much memory there is (Chromium only leaves it out on a page that isn't secure)
  const firefox = /Firefox\//.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua);
  return firefox || safari;
}

/** What a song plays on one instrument: its notes, and the span of its clips' mod wheel lanes (null: none). */
export interface SongNotes {
  notes: SongNote[];
  wheel: [number, number] | null;
}

/**
 * A note a track plays, for an instrument making ahead what it will play (TrackInstrument.prepare):
 * its name and velocity, the loudest of the chord it starts with, how far its Human insert lets
 * its velocity drift (see SongNote), and its own expression (a drum hit's starting bend sets its pitch).
 */
export interface PlannedNote {
  note: string;
  velocity: number;
  loudest: number;
  drift: number;
  expr?: NoteEvent['expr'];
  /** The longest it can be held (seconds, the sustain pedal included), where the render's slowest tempo is known */
  seconds?: number;
}

/** What a track plays (TrackInstrument.prepare): its notes, and the span of its clips' mod wheel lanes (null: none). */
export interface TrackPlan {
  notes: PlannedNote[];
  wheel: [number, number] | null;
  /** Whether its notes move in pitch as they sound: a bend or vibrato lane, a note's own bend, or its Human insert's pitch drift */
  bends: boolean;
}

/**
 * What a track's clips play (and their takes'), with the span of their mod wheel lanes: see
 * PlannedNote. `barSeconds`: how long a bar of four beats lasts at the song's slowest tempo, for
 * each note's longest hold.
 */
export function trackPlan(track: Pick<Track, 'id'> & { fx?: Partial<Pick<Track['fx'], 'human'>> }, clips: Array<Pick<Clip, 'trackId' | 'notes' | 'takes' | 'expression'> & Partial<Pick<Clip, 'lengthBars'>>>, barSeconds?: number): TrackPlan {
  const human = track.fx?.human;
  const drift = human?.on ? HUMAN_MAX_DYNAMICS * human.dynamics : 0;
  const out: TrackPlan = { notes: [], wheel: null, bends: !!(human?.on && human.pitch > 0) };
  for (const clip of clips) {
    if (clip.trackId !== track.id) continue;
    for (const ex of [clip.expression, ...(clip.takes ?? []).map((t) => t.expression)]) if (ex?.bend?.length || ex?.vibrato?.length) out.bends = true;
    for (const lane of [clip.expression?.mod, ...(clip.takes ?? []).map((t) => t.expression?.mod)]) {
      for (const p of lane ?? []) out.wheel = out.wheel ? [Math.min(out.wheel[0], p.value), Math.max(out.wheel[1], p.value)] : [p.value, p.value];
    }
    for (const played of [clip.notes, ...(clip.takes ?? []).map((t) => t.notes)]) {
      if (!played?.length) continue;
      // (held on by the sustain pedal as the scheduler holds them)
      const notes = clip.lengthBars ? sustainNotes(played, clip.expression?.sustain, clip.lengthBars) : played;
      const loudest = new Map<number, number>();
      const at = (offset: number) => Math.round(offset * 1e6);
      for (const n of notes) loudest.set(at(n.startOffset), Math.max(loudest.get(at(n.startOffset)) ?? 0, n.velocity));
      for (const n of notes) {
        if (n.expr?.bend?.length) out.bends = true;
        out.notes.push({ note: n.note, velocity: n.velocity, loudest: loudest.get(at(n.startOffset)) ?? n.velocity, drift, ...(n.expr ? { expr: n.expr } : {}), ...(barSeconds ? { seconds: durationToBars(n.duration) * barSeconds } : {}) });
      }
    }
  }
  return out;
}

/**
 * What each instrument plays in a song: every note of every clip (and its takes) on the tracks
 * playing it, with the loudest note starting at the same moment in its clip and how far its
 * track's Human insert lets its velocity drift, and the span of the clips' mod wheel lanes
 * (which crossfade an instrument's loudnesses: InstrumentDef.dynamics).
 */
export function songNotesByInstrument(tracks: Array<Pick<Track, 'id' | 'instrumentKey'> & { fx?: Pick<Track['fx'], 'human'> }>, clips: Pick<Clip, 'trackId' | 'notes' | 'takes' | 'expression'>[], midiOf: (note: string) => number): Map<string, SongNotes> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const out = new Map<string, SongNotes>();
  for (const clip of clips) {
    const track = byId.get(clip.trackId);
    if (!track) continue;
    const key = track.instrumentKey as string;
    const human = track.fx?.human;
    const drift = human?.on ? HUMAN_MAX_DYNAMICS * human.dynamics : 0;
    const song = out.get(key) ?? { notes: [], wheel: null };
    out.set(key, song);
    for (const lane of [clip.expression?.mod, ...(clip.takes ?? []).map((t) => t.expression?.mod)]) {
      for (const p of lane ?? []) song.wheel = song.wheel ? [Math.min(song.wheel[0], p.value), Math.max(song.wheel[1], p.value)] : [p.value, p.value];
    }
    for (const notes of [clip.notes, ...(clip.takes ?? []).map((t) => t.notes)]) {
      if (!notes?.length) continue;
      const loudest = new Map<number, number>();
      const at = (offset: number) => Math.round(offset * 1e6);
      for (const n of notes) loudest.set(at(n.startOffset), Math.max(loudest.get(at(n.startOffset)) ?? 0, n.velocity));
      for (const n of notes) {
        const midi = Math.round(midiOf(n.note));
        if (Number.isFinite(midi)) song.notes.push({ midi, velocity: n.velocity, loudest: loudest.get(at(n.startOffset)) ?? n.velocity, drift });
      }
    }
  }
  return out;
}
