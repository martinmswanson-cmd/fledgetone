import * as Tone from 'tone';
import { createWidener } from '../presets/widen';
import { createLightChorus } from '../effects/lightFx';
import { fixedDelay } from '../effects/delayLink';
import { roomChannels } from '../effects/roomIR';
import { STRUMMED, strumPlan } from '../guitarStrum';
import type { LastStrum } from '../guitarStrum';
import { breathOf, INSTRUMENTS, isSection } from '../instrumentCatalog';
import type { AmpModel, InstrumentDef, InstrumentKey, SampleSource, Shaping } from '../instrumentCatalog';
import { auditionInput } from '../engine';
import { liveContext } from '../liveContext';
import { decodeSound } from '../soundLibrary';
import { recordingBytes } from '../recordingStore';
import { useAudioStore } from '../../store/audioStore';
import type { CustomSample, NoteEvent } from '../../store/timelineTypes';
import { alwaysStereo, keepActive, nativeContextOf, nativeInputOf } from '../nativeNodes';
import { foldToMono, isDualMono, keptLength, lengthenSustain, levelOutline, OUTLINE_STEP, planRingOn, planSustain, removeDc, RING_MOST, ringOn } from './recordingMaths';
import { chooseNoteToSteal, noteLevelNow } from './noteStealing';
import { blendFor, correlationOf, layerBlend } from './layerBlend';
import { expressiveCutoff, OPEN_CUTOFF } from './velocityTone';
import { decodedBytes, decodedOf, setDecodedBytes } from './setSizes';
import { BLEND_ZONE, chooseExportDecodes, COPY_SEMITONES, decodeRateOf, OVERSAMPLE, indexRecordings, layerOf, layersInReach, lowMemoryDevice, neededPitches, neededSamples, quickLayer, quickSamples, songNotesByInstrument, SPARSE_QUICK, STRETCH_SEMITONES } from './songSamples';
import type { RecordingIndex, SongNotes, TrackPlan } from './songSamples';
import { clearCopies, copyBytes, copySet, dropCopy, forgetCopiesOf, makeCopy, onCopyMade, setCopyCap, type CopySet, type CopyWish } from './pitchedCopies';
import { stretchOutline } from './resampler';
import { createBendTimeline } from '../bendTimeline';

/**
 * Sampled instruments. Each instrument's recordings are downloaded and decoded once, then
 * shared by every sampler that plays it: each track's own sampler, the instrument menus'
 * preview sampler, and the offline export (AudioBuffers aren't tied to a context).
 *
 * Decoded sound takes eight to ten times the room of the downloaded files, so recordings are kept
 * small as they load (see recordingMaths.ts): a silent tail is cut, and two identical channels
 * become one. And an instrument loads what the song plays first (see songSamples.ts and
 * loadSongSamples), so it can start sooner; the rest of its recordings follow in the
 * background, one at a time, or at once when a note is played that needs one.
 *
 * Sample rates. A recording plays through an AudioBufferSourceNode, which Chromium resamples with
 * linear interpolation whenever the buffer's rate isn't the context's or the note is re-pitched: a
 * slight dulling above 8 kHz and faint grit, heard on bright sounds. So recordings are decoded at
 * twice the rate they play at (decodeAudioData resamples with a high-quality filter; see
 * OVERSAMPLE): the live context's for live playback, and an export's own (holdRecordingsAt: the
 * export decodes the recordings its song needs again, at its rate, and lets them go after). A
 * note played on its own recording then reads every other sample, exactly as recorded, and one
 * re-pitched has about 12 dB less of the interpolation's error, the top octave about 1.5 dB
 * brighter, for twice the memory. Live playback decodes at its own rate on a device with little
 * memory, and for the big sets (see oversampledLive, which also load only what's asked for); a
 * file export decodes what the song plays at twice its rate within a budget (planExport), and a
 * render the app plays itself (a freeze, a preview) the live recordings. Everything that counts
 * samples uses the buffer's own sampleRate, never the context's.
 *
 * A note between two recordings (or a release sound, or a recorded kit's open hat) plays a copy
 * of its recording re-pitched ahead with a windowed sinc (pitchedCopies.ts), at a rate of exactly
 * 1, rather than the recording stretched by the buffer source: images 80 dB down or more instead
 * of 11 to 36, and flat to 20 kHz. An export makes every copy its song plays before it renders
 * (TrackInstrument.prepare), within its memory budget (copyAllowed); live playback makes a song's
 * as it opens (liveCopies) and a note's the first time it misses one, in a Worker.
 */
type SampleSet = Record<string, Tone.ToneAudioBuffer>;

/** One instrument's recordings, as they arrive. */
interface Loading {
  source: SampleSource;
  /** The sample rate they play at (the live context's, or an export's) */
  rate: number;
  /** Live playback's (with loading badges and background filling), not an export's */
  live: boolean;
  /** Decoded at twice `rate` (see OVERSAMPLE), not at `rate` */
  oversample: boolean;
  /** Every sample's name: the notes ("<note>|<layer>|<take>") and release sounds ("rel|<note>|<take>") */
  names: string[];
  index: RecordingIndex;
  /** Loaded so far, by name */
  have: Map<string, Tone.ToneAudioBuffer>;
  /** Loading now, by name */
  pending: Map<string, Promise<void>>;
  /** Told of each recording as it arrives: the samplers playing the instrument */
  listeners: Set<(name: string, buffer: Tone.ToneAudioBuffer) => void>;
  /** What the song plays (loadSongSamples), loaded first; unset: one loudness of every note */
  first?: Set<string>;
  /** The whole set loading (loadSamples) */
  full?: Promise<SampleSet>;
  /** Notes asked for while playing (wantNote), so each is looked up once */
  asked: Set<string>;
  /** The background filling stopped at a failed download (Retry or an export tries again) */
  stalled?: boolean;
}

const loadings: Partial<Record<InstrumentKey, Loading>> = {};
/** Live playback's recordings (an export's copies of these stay for live playback after it: see holdRecordingsAt) */
const liveRecordings = new WeakSet<AudioBuffer>();

/** The live context's sample rate: live playback's recordings are decoded for it. */
const liveRate = () => liveContext.sampleRate;
/** Whether `context` renders offline (an export, a freeze), not live playback. */
const isOffline = (context: Tone.BaseContext) => typeof OfflineAudioContext !== 'undefined' && nativeContextOf(context) instanceof OfflineAudioContext;

/** Every recording's name an instrument has: its notes ("<note>|<layer>|<take>") and release sounds ("rel|<note>|<take>"). */
const namesOf = (source: SampleSource) => [...Object.keys(source.samples), ...Object.keys(source.releases?.samples ?? {}).map((n) => `rel|${n}`)];

/** An empty loading: live playback's (decoded at twice the rate unless oversampledLive says not), or an export's (`oversample`: at twice its rate). */
function newLoading(key: InstrumentKey, rate: number, live: boolean, oversample = true): Loading {
  const source = INSTRUMENTS[key].samples!;
  const names = namesOf(source);
  return { source, rate, live, oversample: live ? oversampledLive(source) : oversample, names, index: indexRecordings(names, midiOfNote, source.layers ?? [1]), have: new Map(), pending: new Map(), listeners: new Set(), asked: new Set() };
}

/** The instrument's loading state for live playback (made empty the first time). */
function loadingOf(key: InstrumentKey): Loading {
  let l = loadings[key];
  if (!l) {
    l = newLoading(key, liveRate(), true);
    loadings[key] = l;
  }
  return l;
}

/**
 * How a render plays the recorded instruments: `file`, a file being exported (its own recordings
 * at twice its rate where the song's fit in EXPORT_DECODE_BYTES, see chooseExportDecodes), or
 * `playback`, a render the app plays itself (a freeze, a bounce, a preview, an analysis, the web
 * runtime's music): the recordings live playback has at the live rate, decoded afresh only at
 * another rate (at that rate, never twice it, and within the same budget).
 */
export type RenderRecordings = 'file' | 'playback';

/**
 * How an export plays an instrument's recordings: `live`, live playback's (already decoded twice
 * over, or the render reuses them rather than decode a copy: resampled as they play where its
 * rate isn't the live one); `once` or `twice`, its own decoded at its rate or twice that.
 */
type RatePlan = 'live' | 'once' | 'twice';

/**
 * What an export at one rate decodes of its own, at most (bytes, every instrument together, an
 * estimate: setSizes.ts). About a song's worth of most instruments at twice the rate; a piano
 * part over much of the keyboard at several loudnesses is more than this, and plays at the
 * export's rate, or from the live recordings when even that doesn't fit.
 */
const EXPORT_DECODE_BYTES = 512e6;
/**
 * What an export's re-pitched copies may take on a device with little memory (bytes): there it
 * plays live playback's recordings (it decodes none of its own), so its copies come on top of
 * those and are held for the whole render. Notes past it play their recordings stretched.
 */
const LOW_MEMORY_EXPORT_COPY_BYTES = 64e6;

/**
 * Recordings decoded for an export at its sample rate, where the live ones won't do (another
 * rate, or twice the rate where live playback decodes them at the live rate alone), by rate,
 * while an export at that rate holds them (holdRecordingsAt), with how it plays each instrument
 * (`plans`, chosen once in songSampleLoads) and how many of its holds are files'. Only what the
 * export's songs need is decoded, from the kept compressed files; nothing here updates the
 * loading badges or fills in the background.
 */
interface RateEntry {
  loadings: Partial<Record<InstrumentKey, Loading>>;
  plans: Map<InstrumentKey, RatePlan>;
  holds: number;
  files: number;
  timer?: ReturnType<typeof setTimeout>;
  /** The re-pitched copies its renders have made ready (see copyAllowed): bytes, which (each counted once), and in order, to let go with it */
  copyBytes: number;
  copied: WeakMap<AudioBuffer, Set<string>>;
  made: Array<[AudioBuffer, string]>;
}
const atRate = new Map<number, RateEntry>();
/** How long an export's recordings stay after its last render lets go (the next stem or take uses them again). */
const RATE_KEEP_MS = 10000;

/**
 * A render at `rate` is rendering: until the returned function is called, its instruments play
 * recordings decoded for its rate (where the live ones aren't), so no note is resampled on the
 * way, at twice it for a file (`recordings`, see RenderRecordings). Holds overlap (the parts of a
 * mix, stems); the recordings go a little after the last.
 */
export function holdRecordingsAt(rate: number, recordings: RenderRecordings = 'file'): () => void {
  let entry = atRate.get(rate);
  if (!entry) atRate.set(rate, (entry = { loadings: {}, plans: new Map(), holds: 0, files: 0, copyBytes: 0, copied: new WeakMap(), made: [] }));
  const held = entry;
  held.holds++;
  const file = recordings === 'file';
  if (file) held.files++;
  clearTimeout(held.timer);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (file) held.files--;
    if (--held.holds > 0) return;
    held.timer = setTimeout(() => {
      if (held.holds > 0 || atRate.get(rate) !== held) return;
      atRate.delete(rate);
      // ...and the re-pitched copies its renders made (live playback makes its own as it needs them)
      // (a copy of a recording live playback has is kept for it, unless it's only the start of one: live playback never asks for those)
      for (const [source, key] of held.made) if (!liveRecordings.has(source) || isHeadCopy(key)) dropCopy(source, key);
      for (const [id, ref] of decoded) if (!ref.deref()) decoded.delete(id);
    }, RATE_KEEP_MS);
  };
}

/**
 * The instrument's recordings for a context at `rate`: an export's own while one at that rate
 * holds them, as its plan says (see planExport), else the live ones. Live playback (`offline`
 * false) keeps the live ones at the live rate. An instrument the plan doesn't know plays the live
 * ones at the live rate, its own at the export's rate at another.
 */
function loadingAt(key: InstrumentKey, rate: number, offline = true): Loading {
  const entry = atRate.get(rate);
  if (!entry || (!offline && rate === liveRate())) return loadingOf(key);
  const plan = entry.plans.get(key) ?? (rate === liveRate() ? 'live' : 'once');
  if (plan === 'live') return loadingOf(key);
  return (entry.loadings[key] ??= newLoading(key, rate, false, plan === 'twice'));
}

/**
 * How an export at `rate` (held: `entry`) plays each of these instruments, given the recordings
 * the song needs of each (chosen once per instrument for as long as the export holds them, so
 * the stems and parts of one export play alike):
 * - live playback's recordings where they're already twice the live rate, at the live rate for a
 *   render the app plays itself, and always on a device with little memory;
 * - else its own, the cheapest instruments first, at twice the rate for a file (or at the rate)
 *   while they fit in EXPORT_DECODE_BYTES with what the export already decodes; at the live rate
 *   the live ones rather than a copy at the same rate; past the budget, the live ones.
 */
function planExport(entry: RateEntry, rate: number, needs: ReadonlyArray<readonly [InstrumentKey, Iterable<string>, number]>): void {
  const atLive = rate === liveRate();
  const file = entry.files > 0;
  const costs: Array<[InstrumentKey, number]> = [];
  for (const [key, names, copies] of needs) {
    if (entry.plans.has(key)) continue;
    const source = INSTRUMENTS[key].samples!;
    if (LOW_MEMORY || (atLive && (!file || oversampledLive(source)))) entry.plans.set(key, 'live');
    // (with the re-pitched copies its notes play, `copies` bytes at the export's rate (see
    // copiesCost), at the recording's for an instrument whose notes bend: see wishOf and
    // copyAllowed; the cost is doubled at twice the rate, a copy at the export's rate isn't)
    else costs.push([key, decodedBytes(source, names, rate) + copies / (bendsByDesign(INSTRUMENTS[key]) ? 1 : OVERSAMPLE)]);
  }
  let spent = 0;
  for (const [key, l] of Object.entries(entry.loadings) as Array<[InstrumentKey, Loading]>) spent += decodedBytes(l.source, l.have.keys(), entry.plans.get(key) === 'twice' ? decodeRateOf(rate) : rate);
  const times = chooseExportDecodes(costs, Math.max(0, EXPORT_DECODE_BYTES - spent), file ? OVERSAMPLE : 1);
  for (const [key] of costs) {
    const t = times.get(key) ?? 0;
    // (a playback render at another rate decodes at it, never twice; at the live rate a copy at the same rate is no better than the live ones)
    const plan: RatePlan = t === 2 ? 'twice' : t === 1 && !atLive ? 'once' : 'live';
    entry.plans.set(key, plan);
  }
}

/**
 * About how many bytes the copies `pitches` describes take at `rate` (each copy once): a whole
 * copy of each recording at its other pitch, or, for notes of a known length, as much of it as
 * they play with their release (as the sampler's prepare makes them), in stereo: on the safe
 * side, so an instrument doesn't lose its twice-the-rate decode to copies that would never be
 * made that big.
 */
function copiesCost(source: SampleSource, pitches: Map<string, Map<number, number>>, rate: number): number {
  const release = source.release ?? 1;
  let bytes = 0;
  for (const [name, row] of pitches) {
    const whole = decodedOf(source, name);
    for (const [semis, seconds] of row) {
      const ratio = 2 ** (semis / 12);
      const head = Number.isFinite(seconds) ? ((seconds + release + 0.2) * 1.1 * ratio + 0.1) * 48000 * 4 * 2 : Infinity;
      bytes += Math.min(whole, head) / ratio;
    }
  }
  return bytes * (rate / 48000);
}

/** How an export at `rate` plays each instrument, while one holds its recordings (see planExport): for the checks. */
export const exportPlansAt = (rate: number): Record<string, RatePlan> => Object.fromEntries(atRate.get(rate)?.plans ?? []);

/** Whether an offline render at `rate` decodes the user's own sounds at twice its rate (see decodePitchedSound): a file's, not on a device with little memory. */
function soundsTwiceAt(rate: number): boolean {
  if (LOW_MEMORY) return false;
  const entry = atRate.get(rate);
  return !entry || entry.files > 0;
}

/**
 * Whether a render at `rate` may make `source`'s copy under `key` (`bytes` big) ready: what the
 * renders at that rate decode of their own and the copies they've made ready stay within
 * EXPORT_DECODE_BYTES (planExport counted the song's copies when it chose the rates). A copy
 * already counted (another stem, part or take of the same export) is allowed again for nothing.
 * A render nothing holds (a preview) may.
 */
function copyAllowed(rate: number, source: AudioBuffer, key: string, bytes: number): boolean {
  const entry = atRate.get(rate);
  if (!entry) return true;
  const done = entry.copied.get(source);
  if (done?.has(key)) return true;
  let spent = entry.copyBytes;
  for (const l of Object.values(entry.loadings)) spent += bytesOf(l);
  if (spent + bytes > (LOW_MEMORY ? LOW_MEMORY_EXPORT_COPY_BYTES : EXPORT_DECODE_BYTES)) return false;
  entry.copyBytes += bytes;
  entry.made.push([source, key]);
  if (done) done.add(key);
  else entry.copied.set(source, new Set([key]));
  return true;
}

/** Whether a copy's key (copyKey) is of a stretch of its recording (an export's start of one, a slice), not the whole. */
const isHeadCopy = (key: string) => key.split('|').length > 3;

/** Whether `l` is live playback's (with loading badges and background filling), not an export's. */
const isLive = (l: Loading) => l.live;

const isComplete = (l: Loading) => l.have.size === l.names.length;
const setOf = (l: Loading): SampleSet => Object.fromEntries(l.have);
const setStatus = (key: InstrumentKey, status: 'loading' | 'ready' | 'error' | 'unloaded') => useAudioStore.getState().setInstrumentStatus(key, status);
const isReady = (key: InstrumentKey) => useAudioStore.getState().instrumentStatus[key] === 'ready';

/** Recordings being loaded for playing now (not the background filling): the background waits for them. */
let foreground = 0;

/** Load `names` of an instrument (each once), telling its samplers as each arrives. */
function loadNames(l: Loading, names: Iterable<string>, background = false): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const name of names) {
    if (l.have.has(name)) continue;
    let p = l.pending.get(name);
    if (!p) {
      if (!background) foreground++;
      p = decodeEntry(l.source, name, decodeRateOf(l.rate, !l.oversample))
        .then((buffer) => {
          l.have.set(name, buffer);
          const audio = buffer.get();
          if (l.live && audio) liveRecordings.add(audio);
          for (const listener of l.listeners) listener(name, buffer);
        })
        .finally(() => {
          l.pending.delete(name);
          if (!background && --foreground === 0) fillSoon();
        });
      p.catch(() => {}); // (whoever waits for it hears of a failure)
      l.pending.set(name, p);
    }
    waits.push(p);
  }
  return Promise.all(waits).then(() => undefined);
}

/** Load `names` of an instrument, showing it loading on its badge until they're in. */
function loadSome(key: InstrumentKey, l: Loading, names: Iterable<string>): Promise<SampleSet> {
  if (!isReady(key)) setStatus(key, 'loading');
  return loadNames(l, names).then(
    () => {
      setStatus(key, 'ready');
      // Downloading again: the background filling stopped at a failed one carries on
      if (l.stalled && !isComplete(l)) {
        l.stalled = false;
        fillInBackground(key);
      }
      return setOf(l);
    },
    (err) => {
      console.error(`Failed to load samples [${key}]:`, err);
      setStatus(key, 'error');
      throw err;
    }
  );
}

/**
 * The instrument's first recordings: what the song plays (loadSongSamples), or one loudness of
 * every note when that isn't known; the whole set once that's loaded. It plays once these are in;
 * the rest follow in the background.
 */
export function loadQuick(key: InstrumentKey): Promise<SampleSet> {
  const l = loadingOf(key);
  if (isComplete(l)) return Promise.resolve(setOf(l));
  return loadSome(key, l, l.first ?? quickSamples(l.index, isBigSet(l.source) ? SPARSE_QUICK : 0)).then((set) => {
    fillInBackground(key);
    return set;
  });
}

/** What each instrument plays in these tracks' clips (see songSamples.ts). */
function songsOf(tracks: Parameters<typeof songNotesByInstrument>[0], clips: Parameters<typeof songNotesByInstrument>[1], barSeconds?: number) {
  const midiOf = (note: string) => {
    try {
      return midiOfNote(note);
    } catch {
      return NaN; // (not a note: skipped)
    }
  };
  return songNotesByInstrument(tracks, clips, midiOf, barSeconds);
}

/** The recordings `song` needs of an instrument (see songSamples.ts). */
const neededFor = (key: InstrumentKey, l: Loading, song: SongNotes | undefined) =>
  song?.notes.length ? neededSamples(l.index, song.notes, INSTRUMENTS[key].dynamics ? song.wheel : null) : new Set<string>();

/**
 * A song is opening: start loading every recorded instrument it plays, each with what the song
 * plays on it first, then the rest in the background (the recorded drum kits load whole: they're
 * small, and every row is a hit).
 */
export function loadSongSamples(tracks: Parameters<typeof songNotesByInstrument>[0], clips: Parameters<typeof songNotesByInstrument>[1]): void {
  const songs = songsOf(tracks, clips);
  for (const key of new Set(tracks.map((t) => t.instrumentKey))) {
    if (!hasRecordings(key)) continue;
    if (isSamplerKey(key)) {
      const l = loadingOf(key);
      const song = songs.get(key);
      const needed = neededFor(key, l, song);
      l.first = needed.size ? needed : undefined;
      // ...and once they're in, the copies its notes between recordings play (in the background)
      loadQuick(key).then(() => song && liveCopies(key, l, song), () => {}); // the loading badge reports a failure
      continue;
    }
    loadSamples(key).catch(() => {}); // the loading badge reports it
  }
}

/**
 * Make, in the background, the re-pitched copies `song` plays of an instrument's recordings
 * (live playback's): its notes between two recordings then play a copy at a rate of exactly 1
 * from their first time (see pitchedCopies.ts). A note that comes before its copy plays its
 * recording stretched, as before, and the copy is there the next time.
 */
function liveCopies(key: InstrumentKey, l: Loading, song: SongNotes): void {
  // (on a device with little memory a song's copies seldom fit: a note's copy is made when it's played)
  if (LOW_MEMORY) return;
  for (const [name, semis] of neededPitches(l.index, song.notes, INSTRUMENTS[key].dynamics ? song.wheel : null)) {
    const audio = l.have.get(name)?.get();
    if (!audio) continue;
    // (planned: only while they fit in the cap, see pitchedCopies.ts roomFor)
    for (const st of semis.keys()) void makeCopy(audio, wishOf(audio, 2 ** (st / 12), l.rate, bendsByDesign(INSTRUMENTS[key])), false, false, true);
  }
}

/** Whether an instrument's notes move in pitch as they sound by design (a vibrato, a bowed legato's slide): its copies keep its recordings' rate (see wishOf). */
const bendsByDesign = (def: InstrumentDef) => !!(def.vibrato || def.bowed);

/**
 * What a copy of a recording `ratio` times as fast is, to play in a context at `playRate`: its
 * loop moved with it, and for one decoded at twice the rate, nothing above RECORDED_BAND. At the
 * context's rate (half the memory and the work of one at a recording's twice-the-rate) for notes
 * that hold their pitch; `wide`, for an instrument or a track whose notes bend, vibrate or glide,
 * at the recording's own rate (a moving rate then still reads twice the frames it plays, as it
 * did from the recording).
 */
function wishOf(audio: AudioBuffer, ratio: number, playRate: number, wide = false): CopyWish {
  const loop = loopsOf.get(audio);
  return { ratio, playRate, ...(wide ? {} : { outRate: playRate }), ...(audio.sampleRate >= 1.5 * playRate ? { band: RECORDED_BAND } : {}), ...(loop ? { loop } : {}) };
}

/** What a copy of `audio` `ratio` times as fast is, to play in `context` at a rate of exactly 1 (see wishOf): for the drum kits. */
export const recordingWish = (audio: AudioBuffer, ratio: number, context: BaseAudioContext): CopyWish => wishOf(audio, ratio, context.sampleRate);

/**
 * The re-pitched copies an instrument playing in `context` plays (see pitchedCopies.ts): a
 * render's within its budget (copyAllowed), live playback's any there are.
 */
export function copySetFor(context: BaseAudioContext): CopySet {
  const offline = typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
  return copySet(offline, (source, key, bytes) => copyAllowed(context.sampleRate, source, key, bytes));
}

/** The most a recording decoded at twice the rate holds (Hz): its file's Nyquist (the hosted sets and the soundfonts are at most 48 kHz). */
const RECORDED_BAND = 24000;

/**
 * A copy has its source's level outline, peak, audible end and recorded length (each at its own
 * speed), and a whole copy its moved loop (planCopy), before anything plays it.
 */
onCopyMade((source, copy, wish) => {
  // (a slice: nothing to carry over; the start of a recording keeps its own)
  if (wish.region && wish.region[0] !== 0) return;
  const audio = copy.buffer;
  const r = copy.ratio;
  const shape = outlines.get(source);
  if (shape) outlines.set(audio, stretchOutline(shape, r));
  peaks.set(audio, peakOf(source));
  audibleEnds.set(audio, Math.min(audio.duration, audibleEnd(source) / r));
  if (fullDurations.has(source)) fullDurations.set(audio, recordedDuration(source) / r);
  if (copy.loop) loopsOf.set(audio, copy.loop);
  // (the start of a recording that loops has no loop of its own, but its notes are held ones: see releaseNow)
  else if (loopsOf.has(source)) heldCopies.add(audio);
});

/** Copies of only the start of a recording that loops (see onCopyMade). */
const heldCopies = new WeakSet<AudioBuffer>();

/**
 * Everything these tracks' clips play, for an export at `rate` (default: the live context's): each
 * recorded instrument's recordings the notes need (a drum kit's every one), by instrument. At the
 * live rate the export plays the same recordings live playback does once every recording is in;
 * at another rate, held by holdRecordingsAt, recordings decoded at that rate.
 */
export function songSampleLoads(tracks: Parameters<typeof songNotesByInstrument>[0], clips: Parameters<typeof songNotesByInstrument>[1], rate = liveRate(), offline = true, barSeconds?: number): Array<[InstrumentKey, Promise<unknown>]> {
  const songs = songsOf(tracks, clips, barSeconds);
  const keys = [...new Set(tracks.map((t) => t.instrumentKey))].filter(hasRecordings);
  // An export: how it plays each instrument, from what the song needs of each
  const entry = offline ? atRate.get(rate) : undefined;
  if (entry) {
    planExport(
      entry,
      rate,
      keys.map((key) => {
        const source = INSTRUMENTS[key].samples!;
        const names = namesOf(source);
        if (!isSamplerKey(key)) return [key, names, 0] as const;
        const index = indexRecordings(names, midiOfNote, source.layers ?? [1]);
        const wheel = INSTRUMENTS[key].dynamics ? (songs.get(key)?.wheel ?? null) : null;
        const notes = songs.get(key)?.notes ?? [];
        return [key, neededSamples(index, notes, wheel), copiesCost(source, neededPitches(index, notes, wheel), rate)] as const;
      })
    );
  }
  return keys.map((key) => {
      const l = loadingAt(key, rate, offline);
      if (!isLive(l)) {
        // An export's own: what the song needs (a kit's every row), and the instrument starts with those
        const needed = isSamplerKey(key) ? neededFor(key, l, songs.get(key)) : new Set(l.names);
        if (isSamplerKey(key)) l.first = new Set([...(l.first ?? []), ...needed]);
        return [key, loadNames(l, needed)];
      }
      if (!isSamplerKey(key)) return [key, loadSamples(key)];
      return [key, isComplete(l) ? Promise.resolve() : loadSome(key, l, neededFor(key, l, songs.get(key)))];
    });
}

/** The recordings `notes` need of an instrument (a drum kit's every one), loaded: for a stinger or a transition's notes. */
export function loadSamplesForNotes(key: InstrumentKey, notes: readonly NoteEvent[]): Promise<unknown> {
  // (for live playback: the live recordings, even while an export holds its own at the live rate)
  return songSampleLoads([{ id: 'notes', instrumentKey: key }], [{ trackId: 'notes', notes: [...notes] }], liveRate(), false)[0]?.[1] ?? Promise.resolve();
}

/** True for instruments that stream recordings (piano, sax, marimba...). */
export function isSamplerKey(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'sampled';
}

/** True for instruments with recordings to download first: the sampled ones and the recorded drum kits. */
export function hasRecordings(key: InstrumentKey): boolean {
  return !!INSTRUMENTS[key].samples;
}

/**
 * Recordings decoded, by URL (and how they were trimmed): instruments that play the same
 * recordings through different amps share them. Held weakly, so a recording only an instrument
 * since let go (or one copied louder or retuned on loading) is freed. The bytes come from this
 * browser's kept copy, or are downloaded (from `baseUrl`, or `fallbackUrl` when that can't serve
 * them) and kept for next time: see recordingStore.ts.
 */
const decoded = new Map<string, WeakRef<Tone.ToneAudioBuffer>>();
const decoding = new Map<string, Promise<Tone.ToneAudioBuffer>>();
/** Each trimmed recording's length before it was trimmed, in seconds (see recordedDuration). */
const fullDurations = new WeakMap<AudioBuffer, number>();

/**
 * A recording, decoded and made compact: its silent tail cut (never before `keep` seconds, the end
 * of a loop or a stretch to be looped, nor where it's still above `ceiling`, the level the sampler
 * hears as the end of the sound: see audibleEnd), and folded to one channel if its two are the same.
 */
function fetchRecording(source: Pick<SampleSource, 'baseUrl' | 'fallbackUrl' | 'version'>, file: string, rate: number, keep = 0, ceiling = SILENT): Promise<Tone.ToneAudioBuffer> {
  const id = `${source.baseUrl}${file}|${keep}|${ceiling}|${rate}`;
  const alive = decoded.get(id)?.deref();
  if (alive) return Promise.resolve(alive);
  let p = decoding.get(id);
  if (!p) {
    p = recordingBytes(source, file)
      .then((bytes) => decodeAt(bytes, rate))
      .then((audio) => new Tone.ToneAudioBuffer(compact(audio, keep, ceiling)));
    decoding.set(id, p);
    p.then(
      (b) => {
        decoded.set(id, new WeakRef(b));
        decoding.delete(id);
      },
      () => decoding.delete(id)
    );
  }
  return p;
}

/** Contexts that only decode, one per sample rate (never rendered, so they hold nothing but themselves). */
const decoders = new Map<number, BaseAudioContext>();

/**
 * Decode a recording at `rate`: in the live context at its own rate, else in a small offline
 * context at that rate. Either way decodeAudioData resamples from the file's rate with a
 * high-quality filter, far cleaner than a buffer source's linear interpolation at play time.
 */
function decodeAt(bytes: ArrayBuffer, rate: number): Promise<AudioBuffer> {
  if (rate === liveRate()) return liveContext.decodeAudioData(bytes);
  let decoder = decoders.get(rate);
  if (!decoder) decoders.set(rate, (decoder = new OfflineAudioContext(1, 1, rate)));
  return decoder.decodeAudioData(bytes);
}

/**
 * `audio` without its silent tail, in one channel if its two are the same (see fetchRecording), and
 * without the DC some recordings carry (removeDc: only where it's measurable).
 */
function compact(audio: AudioBuffer, keep: number, ceiling: number): AudioBuffer {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  removeDc(channels, audio.sampleRate);
  // Its outline first: it finds the tail without reading the whole recording again, and is kept
  const shape = levelOutline(channels, audio.sampleRate);
  const length = keptLength(channels, audio.sampleRate, Math.ceil(keep * audio.sampleRate), ceiling, shape);
  const kept = channels.map((d) => d.subarray(0, length));
  const mono = kept.length === 2 && isDualMono(kept[0], kept[1]);
  if (length === audio.length && !mono) {
    outlines.set(audio, shape);
    return audio;
  }
  const out = new AudioBuffer({ numberOfChannels: mono ? 1 : kept.length, length, sampleRate: audio.sampleRate });
  if (mono) out.copyToChannel(foldToMono(kept[0], kept[1]), 0);
  else kept.forEach((d, c) => out.copyToChannel(d, c));
  fullDurations.set(out, audio.duration);
  outlines.set(out, shape.subarray(0, Math.ceil(length / Math.max(1, Math.round(OUTLINE_STEP * audio.sampleRate)))));
  return out;
}

/**
 * How long a recording was before its silent tail was cut (see fetchRecording): what a drum hit
 * shortened to a length fades over, so the fade is the same as on the whole recording.
 */
export function recordedDuration(buffer: AudioBuffer): number {
  return fullDurations.get(buffer) ?? buffer.duration;
}

/** Each recording's level outline (see recordingMaths.ts), for choosing which note to let go. */
const outlines = new WeakMap<AudioBuffer, Float32Array>();
function outline(audio: AudioBuffer): void {
  if (outlines.has(audio)) return;
  outlines.set(audio, levelOutline(Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c)), audio.sampleRate));
}

/** One of an instrument's recordings by name (a note, or "rel|..." a release sound), decoded at `rate` and readied to play. */
async function decodeEntry(source: SampleSource, name: string, rate: number): Promise<Tone.ToneAudioBuffer> {
  if (name.startsWith('rel|')) {
    const rel = source.releases!;
    const loaded = await fetchRecording(rel, rel.samples[name.slice(4)], rate);
    if (loaded.get()) outline(loaded.get()!);
    return loaded;
  }
  const loop = source.loops?.[name];
  const db = source.gains?.[name] ?? 0;
  // Never cut into a loop, nor the stretch a held soundfont note loops (a little past it, as a
  // retune moves it by a hair); and a recording played louder keeps the tail that becomes audible
  const keep = Math.max(loop?.[1] ?? 0, source.sustain?.to ?? 0) + 0.05;
  const loaded = await fetchRecording(source, source.samples[name], rate, keep, SILENT * 10 ** (-Math.max(0, db) / 20));
  const tuned = source.tune?.[name] ? retune(loaded, source.tune[name]) : loaded;
  const buffer = db ? louder(tuned, db) : tuned;
  const hz = noteHz(name);
  const held = source.sustain ? extendSustain(buffer, source.sustain, hz) : source.ringOn ? ringOnBuffer(buffer, hz) : buffer;
  const ready = source.onset === undefined ? held : trimOnset(held, source.onset);
  const audio = ready.get();
  if (audio) {
    // Its seamless loop, if it has one (and nothing above moved its timing but a retune, which
    // reads it `rate` times as fast: the loop moves with it)
    const rate = 2 ** ((source.tune?.[name] ?? 0) / 1200);
    if (loop && ready === buffer) loopsOf.set(audio, rate === 1 ? loop : [loop[0] / rate, loop[1] / rate]);
    else {
      // A lengthened sustain loops one of its own repeats for a note held longer still (moved
      // with the start, where the onset was trimmed off after: see extendSustain)
      const repeat = held !== buffer ? loopsOf.get(held.get()!) : undefined;
      const shift = repeat ? (held.get()!.length - audio.length) / audio.sampleRate : 0;
      if (repeat && repeat[0] - shift > 0) loopsOf.set(audio, [repeat[0] - shift, repeat[1] - shift]);
    }
    outline(audio);
  }
  return ready;
}

/**
 * An instrument's every recording for a context at `rate` (a recorded drum kit's): live playback's
 * (loadSamples), or an export's at its own rate (see holdRecordingsAt).
 */
export function loadSamplesAt(key: InstrumentKey, rate: number, offline = false): Promise<SampleSet> {
  const l = INSTRUMENTS[key].samples ? loadingAt(key, rate, offline) : undefined;
  if (!l || isLive(l)) return loadSamples(key);
  return loadNames(l, l.names).then(() => setOf(l));
}

/** Load an instrument's every recording (once). Updates the loading badge in audioStore. */
export function loadSamples(key: InstrumentKey): Promise<SampleSet> {
  if (!INSTRUMENTS[key].samples) return Promise.reject(new Error(`${key} has no samples`));
  const l = loadingOf(key);
  if (l.full) return l.full;
  if (!isComplete(l) && !isReady(key)) setStatus(key, 'loading');
  const full: Promise<SampleSet> = loadNames(l, l.names).then(
    () => {
      l.stalled = false;
      setStatus(key, 'ready');
      return setOf(l);
    },
    (err) => {
      console.error(`Failed to load samples [${key}]:`, err);
      setStatus(key, 'error');
      if (l.full === full) l.full = undefined; // allow a retry next time
      throw err;
    }
  );
  l.full = full;
  return full;
}

/** Instruments with recordings still to load in the background, in the order they asked. */
const backlog: InstrumentKey[] = [];
let filling = false;

/**
 * On a device with little memory (4 GB or less, where the browser says: a phone, an older laptop),
 * the rest of an instrument's recordings load only as notes need them, never all in the background.
 */
const LOW_MEMORY = typeof navigator !== 'undefined' && lowMemoryDevice(navigator as Navigator & { deviceMemory?: number });

/**
 * How many bytes live playback keeps of re-pitched copies (see pitchedCopies.ts), the least
 * recently played going first past it: a song's worth of notes between recordings on most
 * instruments (each about as big as its recording). An export's are on top while it renders,
 * within its own budget (copyAllowed).
 */
const LIVE_COPY_BYTES = LOW_MEMORY ? 48e6 : 192e6;
setCopyCap(LIVE_COPY_BYTES);

/**
 * Sets bigger than this (decoded at 48 kHz, every recording: setSizes.ts) are big: live playback
 * decodes them at their own rate, not twice it, and loads only the recordings the song and the
 * notes played ask for, never the rest in the background, starting from a few (quickSamples'
 * SPARSE_QUICK). The biggest pianos take over a gigabyte decoded once every recording is in (the
 * grand 1.45 GB at 48 kHz). Over it are the pianos, the double bass (190 MB), the tenor saxophone
 * and the tremolo strings (170 MB); the next, the folk harp, takes 150 MB. (Counted by their
 * files' bytes once; the sets' files grew unevenly when they were encoded at higher quality.)
 */
const BIG_SET_DECODED = 160e6;

/** Whether `source` is a big set (see BIG_SET_DECODED). */
const isBigSet = (source: SampleSource) => setDecodedBytes(source) > BIG_SET_DECODED;

/** Whether live playback decodes `source`'s recordings at twice the rate (see OVERSAMPLE): not on a device with little memory, nor for the big sets. */
function oversampledLive(source: SampleSource): boolean {
  return !LOW_MEMORY && !isBigSet(source);
}

/** Load the rest of an instrument's recordings in the background, one at a time, when nothing more pressing loads (not on a device with little memory, nor for a big set). */
function fillInBackground(key: InstrumentKey): void {
  if (LOW_MEMORY || isBigSet(INSTRUMENTS[key].samples!)) return;
  if (!backlog.includes(key)) backlog.push(key);
  fillSoon();
}

/** The next background recording when the page is idle. */
function fillSoon(): void {
  if (filling || !backlog.length) return;
  filling = true;
  const go = () => {
    filling = false;
    fillNext();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 1000 });
  else setTimeout(go, 50);
}

function fillNext(): void {
  // Recordings a song or a note is waiting for go first (this resumes when they're in)
  if (foreground > 0 || filling) return;
  while (backlog.length) {
    const key = backlog[0];
    const l = loadings[key];
    // (Only while a sampler plays it: an instrument switched away from, or a song closed, stops
    // filling. A sampler made for it later asks for the rest again: see loadQuick)
    const next = l && !l.stalled && l.listeners.size > 0 ? l.names.find((n) => !l.have.has(n) && !l.pending.has(n)) : undefined;
    if (!l || !next) {
      backlog.shift();
      continue;
    }
    filling = true;
    loadNames(l, [next], true).then(
      () => {
        filling = false;
        fillSoon();
      },
      (err) => {
        console.warn(`Couldn't load a recording of ${INSTRUMENTS[key].name} in the background:`, err);
        l.stalled = true;
        filling = false;
        fillSoon();
      }
    );
    return;
  }
}

/**
 * A note the song or a player asks of an instrument still loading: its own recordings, at once
 * (`wheel`: played under the mod wheel's dynamics at that value, which picks its loudnesses).
 */
function wantNote(l: Loading, midi: number, velocity: number, wheel?: number): void {
  if (isComplete(l)) return;
  const ask = `${midi}:${layerOf(l.index.tops, velocity)}${wheel === undefined ? '' : `:${Math.round(wheel * 100)}`}`;
  if (l.asked.has(ask)) return;
  l.asked.add(ask);
  loadNames(l, neededSamples(l.index, [{ midi, velocity, loudest: velocity }], wheel === undefined ? null : [wheel, wheel])).catch(() => l.asked.delete(ask));
}

/**
 * Re-pitch a recording by `cents` (an out-of-tune one: see sampleTuning.ts), by reading it a little
 * faster or slower with cubic interpolation. A few cents changes its length by a fraction of a
 * percent, which nobody hears.
 */
/** A copy of a recording `db` louder (an ensemble's sections levelled with each other: SampleSource.gains). */
function louder(buffer: Tone.ToneAudioBuffer, db: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const k = 10 ** (db / 20);
  const out = Tone.getContext().createBuffer(audio.numberOfChannels, audio.length, audio.sampleRate);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const x = audio.getChannelData(c);
    const y = out.getChannelData(c);
    for (let i = 0; i < x.length; i++) y[i] = x[i] * k;
  }
  return new Tone.ToneAudioBuffer(out);
}

function retune(buffer: Tone.ToneAudioBuffer, cents: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio || !cents) return buffer;
  const rate = 2 ** (cents / 1200);
  const length = Math.max(1, Math.floor((audio.length - 3) / rate));
  const out = Tone.getContext().createBuffer(audio.numberOfChannels, length, audio.sampleRate);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const x = audio.getChannelData(c);
    const y = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const pos = i * rate;
      const k = Math.floor(pos);
      const t = pos - k;
      const p0 = x[k > 0 ? k - 1 : 0];
      const p1 = x[k];
      const p2 = x[k + 1];
      const p3 = x[k + 2];
      // Catmull-Rom
      y[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    }
  }
  return new Tone.ToneAudioBuffer(out);
}

/**
 * Cut a recording's slow start: it begins 30 ms before its level (20 ms RMS) first reaches
 * `onsetDb` under its peak, with a 15 ms fade so the cut itself is silent. A recording that is
 * there from the first window is returned as it is.
 */
function trimOnset(buffer: Tone.ToneAudioBuffer, onsetDb: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const sr = audio.sampleRate;
  const window = Math.round(sr * 0.02);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const levels: number[] = [];
  for (let i = 0; i + window <= audio.length; i += window) {
    let sum = 0;
    for (const data of channels) for (let k = i; k < i + window; k++) sum += data[k] * data[k];
    levels.push(sum);
  }
  const peak = Math.max(...levels);
  const first = levels.findIndex((l) => l >= peak * 10 ** (onsetDb / 10));
  const start = Math.max(0, first * window - Math.round(sr * 0.03));
  if (start <= 0) return buffer;
  const fade = Math.round(sr * 0.015);
  const trimmed = Tone.getContext().createBuffer(channels.length, audio.length - start, sr);
  channels.forEach((data, c) => {
    const out = trimmed.getChannelData(c);
    out.set(data.subarray(start));
    for (let k = 0; k < fade && k < out.length; k++) out[k] *= k / fade;
  });
  return new Tone.ToneAudioBuffer(trimmed);
}

/** The pitch (Hz) of a recording named by its note ("C#4", "C#4|1|0"), or 0. */
function noteHz(name: string): number {
  const m = /^([A-G])(#?)(-?\d+)/.exec(name);
  if (!m) return 0;
  const midi = 'C D EF G A B'.indexOf(m[1]) + (m[2] ? 1 : 0) + 12 * (Number(m[3]) + 1);
  return 440 * 2 ** ((midi - 69) / 12);
}

/** The channels of `audio`, or one if its two are the same sound up to `end` (a mono recording saved as stereo). */
function distinctChannels(audio: AudioBuffer, end: number): Float32Array[] {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  if (channels.length === 2) {
    const [l, r] = channels;
    let diff = 0, sum = 0;
    for (let i = 0; i < end; i += 7) { diff += (l[i] - r[i]) ** 2; sum += (l[i] + r[i]) ** 2; }
    if (diff < sum * 1e-4) return [l];
  }
  return channels;
}

/** The channels mixed into one (what a plan is worked out on, so every channel is cut alike). */
function mixed(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const data of channels) for (let i = 0; i < out.length; i++) out[i] += data[i] / channels.length;
  return out;
}

/**
 * Lengthen a recording that stops dead from its steady part, crossfading 120 ms at each join, until
 * it is `hold` seconds long; the last 300 ms fade out. Two identical channels (a mono recording
 * saved as stereo) are folded to one, halving the memory it takes.
 *
 * It's lengthened with pieces of the steady part, of different lengths from different places in
 * it, each joined where it best continues the sound (see planSustain), rather than the whole part
 * over and over: that brought its slow movement round every 1.7 s, which was easy to hear. The
 * pieces make one cycle as long as there's room for, a seamless loop (kept in loopsOf): a note held
 * longer than `hold` plays on, looping it, until it's released. Without it an ambience or a drone
 * written as one long note (rain under a whole song) went silent after `hold` seconds.
 */
function extendSustain(buffer: Tone.ToneAudioBuffer, { from, to, hold }: { from: number; to: number; hold: number }, hz: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const sr = audio.sampleRate;
  const end = Math.min(audio.length, Math.round(to * sr));
  const start = Math.round(from * sr);
  const xf = Math.round(0.12 * sr);
  if (end - start < xf * 3) return buffer;
  const channels = distinctChannels(audio, end);
  const length = Math.max(end, Math.round(hold * sr));
  const fade = Math.round(0.3 * sr);
  // (a join is searched for within a period of the note, or 20 ms)
  const reach = Math.round(hz > 0 ? Math.min(sr / hz, 0.03 * sr) : 0.02 * sr);
  const plan = planSustain(mixed(channels), start, end, xf, length, fade, reach);
  const out = Tone.getContext().createBuffer(channels.length, length, sr);
  channels.forEach((data, c) => lengthenSustain(out.getChannelData(c), data, end, plan, xf, fade));
  if (plan.loop) loopsOf.set(out, [plan.loop[0] / sr, plan.loop[1] / sr]);
  return new Tone.ToneAudioBuffer(out);
}

/**
 * A recording cut off while it still sounds (a General MIDI soundfont note: they all end at 3.1 s)
 * given the rest of its decay (planRingOn, ringOn), so a note held or rung on past its end fades
 * away instead of stopping dead. One that died away by itself is returned as it is.
 */
function ringOnBuffer(buffer: Tone.ToneAudioBuffer, hz: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const sr = audio.sampleRate;
  const channels = distinctChannels(audio, audio.length);
  const plan = planRingOn(mixed(channels), sr, hz, Math.round(RING_MOST * sr));
  if (!plan) return buffer;
  const out = Tone.getContext().createBuffer(channels.length, plan.length, sr);
  channels.forEach((data, c) => ringOn(out.getChannelData(c), data, plan, sr, hz));
  return new Tone.ToneAudioBuffer(out);
}

// ---------- the user's own sounds (Sampler instrument) ----------

const customSamples = new Map<string, Promise<Tone.ToneAudioBuffer>>();

/**
 * Decode a sound a project from before the sound library carries as a data: URL on its track
 * (loadProject moves it into the library; this plays it meanwhile). Cached per sound.
 */
export function loadCustomSample(dataUrl: string): Promise<Tone.ToneAudioBuffer> {
  let p = customSamples.get(dataUrl);
  if (!p) {
    p = fetch(dataUrl)
      .then((r) => r.arrayBuffer())
      .then((data) => liveContext.decodeAudioData(data))
      .then((audio) => new Tone.ToneAudioBuffer(audio));
    p.catch(() => customSamples.delete(dataUrl));
    customSamples.set(dataUrl, p);
  }
  return p;
}

export interface SamplerVoice {
  play: (notes: string[], duration: string, time: number | undefined, velocity: number) => void;
  /** A key held on a MIDI keyboard: `note` sounds from `time` until released. */
  attack: (note: string, time: number, velocity: number) => void;
  release: (note: string, time: number) => void;
  /** Pitch bend in cents from `time`: every sounding note, and the notes after, play that far off (`cut`: see TrackInstrument.bend). */
  bend: (cents: number, time: number, live?: boolean, cut?: boolean) => void;
  /**
   * The mod wheel as dynamics (0 soft to 1 loud), from `time`, for an instrument recorded at several
   * loudnesses (InstrumentDef.dynamics); null hands loudness back to each note's velocity.
   */
  dynamics?: (value: number | null, time: number) => void;
  releaseAll: () => void;
  /** Resolves once samples are attached (rejects if they failed to download). */
  ready: Promise<void>;
  /** Make ahead the copies these notes play (see TrackInstrument.prepare). */
  prepare: (plan: TrackPlan) => Promise<unknown>;
  dispose: () => void;
}

/** Where a sampler's notes go: the shaping's input, its nodes to dispose, and a hook for each note's start. */
interface ShapingChain {
  input: Tone.InputNode;
  nodes: { dispose: () => void }[];
  /** A note starts at `time` (audio clock): the erhu's vibrato swells in from there. */
  onNote?: (time: number) => void;
}

/**
 * A soft clipper: `drive` times the input through tanh, scaled back so full scale stays full scale.
 * Oversampled 2x, not 4x, unless asked: the recordings it shapes are dull (little above a few
 * kHz) and the cabinet after it rolls the top off, so what 2x lets fold back is under -88 dB of the
 * guitar (a phrase through each amp, and the rock and metal guitars, against 4x). A 4x shaper cost
 * as much as nine biquads; at 2x the metal starter's two guitars render 16% faster. The clean
 * amp keeps 4x: it's brightened before and after its clip, and 2x came to -74 dB there, closer to
 * hearing than the rest. 2x holds the sound back 64 samples less than 4x (Chromium's shapers: 128
 * against 192), which moved the guitars against the bass enough to change a mix's loudness by 0.2
 * LU: a delay line after the stages (inStep) puts them back where they were.
 */
function saturator(drive: number, oversample: OverSampleType = '2x'): WaveShaperNode {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const shaper = raw.createWaveShaper();
  const curve = new Float32Array(2049);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(drive * ((i / (curve.length - 1)) * 2 - 1)) / norm;
  shaper.curve = curve;
  shaper.oversample = oversample;
  return shaper;
}

/** How many samples less a 2x shaper holds the sound back than a 4x one (see saturator). */
const SHAPER_2X_EARLIER = 64;

/** The erhu's vibrato: how far the delay swings, in seconds, once a note has settled (about ±20 cents at 5.5 Hz). */
const ERHU_VIBRATO = 0.00035;

/** A guitar amp's settings (played by shapingChain). */
interface AmpSettings {
  /** High-pass in front of the amp, Hz: higher keeps a driven amp's lows from turning to mud */
  tight: number;
  /** A compressor's threshold and ratio, as a clean amp and a picking hand even notes out */
  squeeze?: [threshold: number, ratio: number];
  /** EQ before the drive: [type, Hz, Q, dB] */
  pre: Array<[BiquadFilterType, number, number, number]>;
  /** Drive of each gain stage (more stages: more distortion, smoother) */
  stages: number[];
  /** Tone stack, dB: bass (120 Hz), mid (at midHz), treble (2.5 kHz) */
  bass: number;
  mid: number;
  midHz: number;
  treble: number;
  /** Where the speaker cabinet rolls the top off, Hz */
  cabTop: number;
  /** The gain stages' oversampling (default 2x: see saturator) */
  oversample?: OverSampleType;
}

/**
 * The real electric guitars are recorded straight from the pickup, as a guitarist records direct
 * to choose the amp later; each instrument is that recording through one of these amps. Pickup
 * signal → (compression) → preamp EQ → gain stages → tone stack → a 1×12 speaker cabinet (a low
 * resonance, the cone's upper-mid bite, a dip where cabinets honk, and a steep top roll-off: what
 * makes an amp sound like an amp rather than a fuzz box).
 */
// (An amp with a squeeze has a compressor: list it in COMPRESSED_SHAPINGS, instrumentCatalog.ts)
const AMPS: Record<AmpModel, AmpSettings> = {
  // Clear and glassy, a touch of edge when picked hard
  cleanAmp: { tight: 70, squeeze: [-26, 3], pre: [['highshelf', 1500, 0.7, 4.5]], stages: [1.4], bass: 1, mid: -1, midHz: 600, treble: 2.5, cabTop: 6000, oversample: '4x' },
  // Warm and round: treble down, the neck pickup sound
  jazzAmp: { tight: 60, squeeze: [-30, 2], pre: [], stages: [1.2], bass: 2, mid: 0, midHz: 700, treble: -1.5, cabTop: 4500 },
  // An amp turned up until it breaks up: rock rhythm
  crunchAmp: { tight: 110, pre: [['peaking', 800, 0.8, 6], ['highshelf', 1800, 0.7, 8.5]], stages: [5], bass: 0, mid: 1, midHz: 700, treble: 5, cabTop: 5000 },
  // Two gain stages, scooped mids: riffs and leads
  leadAmp: { tight: 150, pre: [['peaking', 900, 0.8, 6], ['highshelf', 2000, 0.7, 4.5]], stages: [8, 4], bass: 3, mid: -4, midHz: 500, treble: 1.5, cabTop: 4500 },
};

/**
 * Character processing that turns a recording into the instrument.
 * - erhu: a solo violin through a nasal formant and a dark top (the snakeskin resonator), with a
 *   wide vibrato that swells in over the first half second of each note, as a player's does.
 * - amp: the electric guitar's recordings are a dull direct signal with almost nothing above
 *   2 kHz. An amp stage brightens it before a soft clip (which adds the upper harmonics a real
 *   amp does), then a speaker-like presence peak and top roll-off.
 * - acoustic: the steel-string recordings are dark too; brightened with a little edge.
 * - mandolin: doubled (paired) strings and a bright top.
 * - violin: what string players' engineers do to a close violin. Rumble cut below 120 Hz, two
 *   narrow 3 dB dips at 2.5 and 4 kHz (the bridge hill and the edge, right where hearing is most
 *   sensitive) and a gentle shelf down above 6 kHz: the bite that made high lines piercing goes,
 *   the bow and the body stay.
 * - hall: a solo string recorded close in a dead room, heard as in a hall from a few rows back:
 *   rumble out below 90 Hz, a broad 9 dB dip centred at 2.4 kHz (the bow's bite and the bridge
 *   hill, which a close microphone hears in full and a hall softens), 2 dB at 4.3 kHz,
 *   and the top above 7 kHz rolled off by 3 dB.
 */
function shapingChain(shape: Shaping | undefined, output: Tone.InputNode): ShapingChain {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const biquad = (type: BiquadFilterType, frequency: number, Q: number, gain = 0) => {
    const f = raw.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  };
  /** A delay line that holds back `stages` 2x shapers' sound as 4x ones would (see saturator). */
  const inStep = (stages: number) => fixedDelay(raw, (stages * SHAPER_2X_EARLIER) / raw.sampleRate);
  const chain = (nodes: AudioNode[]) => {
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    Tone.connect(nodes[nodes.length - 1], output);
    return { input: nodes[0], nodes: nodes.map((n) => ({ dispose: () => n.disconnect() })) };
  };
  if (shape === 'erhu') {
    // Vibrato: a sine wobbles the delay line's time around 2.5 ms; `depth` is how far it swings
    const delay = raw.createDelay(0.01);
    delay.delayTime.value = 0.0025;
    const lfo = raw.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = raw.createGain();
    depth.gain.value = ERHU_VIBRATO;
    lfo.connect(depth);
    depth.connect(delay.delayTime);
    lfo.start();
    const thin = biquad('highpass', 240, 0.7);
    const nasal = biquad('peaking', 1200, 1.6, 5);
    const edge = biquad('peaking', 3000, 2, 2);
    const dark = biquad('lowpass', 6500, 0.7);
    const built = chain([delay, thin, nasal, edge, dark]);
    built.nodes.push({ dispose: () => { lfo.stop(); lfo.disconnect(); depth.disconnect(); } });
    return {
      ...built,
      onNote: (time) => {
        const at = Math.max(time, raw.currentTime);
        depth.gain.cancelScheduledValues(at);
        depth.gain.setValueAtTime(ERHU_VIBRATO * 0.2, at);
        depth.gain.linearRampToValueAtTime(ERHU_VIBRATO, at + 0.45);
      },
    };
  }
  if (shape === 'amp') {
    // Tighten the lows, even the level out (an amp's sustain), brighten before the clip so the
    // harmonics land where a guitar's bite is, then the speaker: a bump in the lows, a scooped
    // low-mid, presence, and a steep top
    const tight = biquad('highpass', 80, 0.7);
    const sustain = raw.createDynamicsCompressor();
    sustain.threshold.value = -30;
    sustain.knee.value = 12;
    sustain.ratio.value = 3;
    sustain.attack.value = 0.004;
    sustain.release.value = 0.15;
    const pre = biquad('highshelf', 1200, 0.7, 6);
    const drive = saturator(3);
    const thump = biquad('peaking', 120, 1, 3);
    const scoop = biquad('peaking', 450, 1, -3);
    const presence = biquad('peaking', 2200, 1, 1.5);
    const cab = biquad('lowpass', 4800, 0.8);
    const trim = raw.createGain();
    trim.gain.value = Tone.dbToGain(-6);
    return chain([tight, sustain, pre, drive, inStep(1), thump, scoop, presence, cab, trim]);
  }
  if (shape && Object.hasOwn(AMPS, shape)) {
    const amp = AMPS[shape as AmpModel];
    const nodes: AudioNode[] = [biquad('highpass', amp.tight, 0.7)];
    if (amp.squeeze) {
      const squeeze = raw.createDynamicsCompressor();
      squeeze.threshold.value = amp.squeeze[0];
      squeeze.ratio.value = amp.squeeze[1];
      squeeze.knee.value = 10;
      squeeze.attack.value = 0.005;
      squeeze.release.value = 0.12;
      nodes.push(squeeze);
    }
    for (const [type, hz, q, db] of amp.pre) nodes.push(biquad(type, hz, q, db));
    amp.stages.forEach((drive, i) => {
      // Between stages: the coupling that keeps a high-gain amp's lows tight and its fizz down
      if (i > 0) nodes.push(biquad('highpass', 180, 0.7), biquad('lowpass', 4500, 0.7));
      nodes.push(saturator(drive, amp.oversample));
    });
    if ((amp.oversample ?? '2x') === '2x') nodes.push(inStep(amp.stages.length));
    nodes.push(
      biquad('lowshelf', 120, 0.7, amp.bass),
      biquad('peaking', amp.midHz, 0.7, amp.mid),
      biquad('highshelf', 2500, 0.7, amp.treble),
      // The cabinet as a microphone in front of it hears it, mixed as on a record: its presence
      // a little lower and broader, and the cone's narrow peak near 4 kHz (a close microphone's
      // ice-pick, the sharpest thing in the guitar: the clean amp measured 3 dB over its
      // neighbours there) taken down rather than up
      biquad('highpass', 70, 0.8),
      biquad('peaking', 115, 1.2, 2.5),
      biquad('peaking', 400, 1, -2.5),
      biquad('peaking', 1900, 1, 1.5),
      biquad('peaking', 3600, 1.6, -1.5),
      biquad('lowpass', amp.cabTop, 0.7),
      biquad('lowpass', amp.cabTop * 1.15, 0.7)
    );
    return chain(nodes);
  }
  if (shape === 'acoustic') {
    // (a shelf of 8 dB from 1.8 kHz, 3 more at 3.2 kHz and a soft clip used to make it sharp:
    // the bite, 2 to 5 kHz, is left as recorded and the brightness goes over it)
    const rumble = biquad('highpass', 75, 0.7);
    const boom = biquad('peaking', 220, 1, -2);
    const presence = biquad('peaking', 2800, 0.8, 4.5);
    const fizz = biquad('highshelf', 9000, 0.7, -2);
    return chain([rumble, boom, presence, fizz]);
  }
  if (shape === 'violin') {
    const rumble = biquad('highpass', 120, 0.6);
    const bite = biquad('peaking', 2500, 2.2, -3);
    const edge = biquad('peaking', 4000, 2.2, -3);
    const air = biquad('highshelf', 6000, 0.7, -3);
    return chain([rumble, bite, edge, air]);
  }
  if (shape === 'hall') {
    const rumble = biquad('highpass', 90, 0.6);
    const bite = biquad('peaking', 2400, 0.7, -9);
    const edge = biquad('peaking', 4300, 1.2, -2);
    const air = biquad('highshelf', 7000, 0.7, -3);
    return chain([rumble, bite, edge, air]);
  }
  if (shape === 'mandolin') {
    const courses = createLightChorus({ rate: 5, delayMs: 1.8, depth: 0.35, spread: 160, wet: 0.55 });
    const bright = new Tone.BiquadFilter({ type: 'highshelf', frequency: 2500, gain: 4 });
    courses.output.chain(bright, output);
    return { input: courses.input, nodes: [courses, bright] };
  }
  return { input: output, nodes: [] };
}

/** The instrument's tone correction (InstrumentDef.tone) in front of its shaping chain. */
function toneChain(tone: InstrumentDef['tone'], next: ShapingChain): ShapingChain {
  if (!tone || (!tone.presence && !tone.mud)) return next;
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const presence = raw.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = tone.presenceHz ?? 2500;
  presence.Q.value = 0.8;
  presence.gain.value = tone.presence ?? 0;
  const mud = raw.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 300;
  mud.Q.value = 0.9;
  mud.gain.value = tone.mud ?? 0;
  presence.connect(mud);
  Tone.connect(mud, next.input);
  return { ...next, input: presence, nodes: [...next.nodes, { dispose: () => { presence.disconnect(); mud.disconnect(); } }] };
}

/**
 * A string's body under the vibrato (InstrumentDef.vibrato.body): narrow resonances at these
 * frequencies, each a few dB. A real string's vibrato moves its harmonics across its body's
 * resonances, so each harmonic swells and dips at its own moment and the tone shimmers; a
 * recording made without vibrato and only re-pitched has none of that, the giveaway of a
 * synthetic vibrato. Played through fixed resonances after the pitch moves, its harmonics do the
 * same (a tenth harmonic moves tens of hertz).
 */
function bodyChain(body: readonly number[] | undefined, next: ShapingChain): ShapingChain {
  if (!body?.length) return next;
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const filters = body.map((hz) => {
    const f = raw.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = Math.min(hz, raw.sampleRate / 2 - 100);
    f.Q.value = BODY_Q;
    f.gain.value = BODY_DB;
    return f;
  });
  for (let i = 0; i + 1 < filters.length; i++) filters[i].connect(filters[i + 1]);
  Tone.connect(filters[filters.length - 1], next.input);
  return { ...next, input: filters[0], nodes: [...next.nodes, { dispose: () => filters.forEach((f) => f.disconnect()) }] };
}
/** The body's resonances: how narrow (Q) and how strong (dB) */
const BODY_Q = 14;
const BODY_DB = 4;

/**
 * A small stage around an instrument recorded in a dead room (InstrumentDef.room): the direct
 * sound, and beside it a convolution with the stage's response (stageResponse) `db` dB under it.
 */
function stageChain(db: number | undefined, next: ShapingChain): ShapingChain {
  if (db === undefined) return next;
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const input = raw.createGain();
  const stage = raw.createConvolver();
  stage.normalize = false;
  stage.buffer = stageResponse(raw.sampleRate);
  const wet = raw.createGain();
  wet.gain.value = Tone.dbToGain(db);
  const into = raw.createGain();
  input.connect(into);
  input.connect(stage).connect(wet).connect(into);
  Tone.connect(into, next.input);
  return { ...next, input, nodes: [...next.nodes, { dispose: () => [input, stage, wet, into].forEach((n) => n.disconnect()) }] };
}

/** A pad or lead recorded in mono, widened to stereo (InstrumentDef.widen, see presets/widen.ts). */
function widenChain(amount: number | undefined, next: ShapingChain): ShapingChain {
  if (!amount) return next;
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const into = raw.createGain();
  Tone.connect(into, next.input);
  const widener = createWidener(raw, amount, into);
  return { ...next, input: widener.input, nodes: [...next.nodes, { dispose: () => { widener.disconnect(); into.disconnect(); } }] };
}

/**
 * A studio room around a guitar recorded straight from its pickup or in a dead room
 * (InstrumentDef.studio): the direct sound, and beside it the room's short early reflections and
 * tail (the shared reverb's studio room, roomIR.ts, dying away over STUDIO_DECAY), `db` dB under
 * it. It comes after the amp, as a microphone in front of the speaker hears the room (a room in
 * front of an amp's distortion would smear into it), and before the track's own reverb send.
 */
function studioChain(db: number, output: Tone.InputNode): { input: AudioNode; nodes: { dispose: () => void }[] } {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const input = raw.createGain();
  const room = raw.createConvolver();
  room.normalize = false;
  room.buffer = studioResponse(raw.sampleRate);
  const wet = raw.createGain();
  wet.gain.value = Tone.dbToGain(db);
  const into = raw.createGain();
  input.connect(into);
  input.connect(room).connect(wet).connect(into);
  Tone.connect(into, output);
  return { input, nodes: [{ dispose: () => [input, room, wet, into].forEach((n) => n.disconnect()) }] };
}
/** The studio room's decay (seconds to fall 60 dB, its middle; its highs die sooner) */
const STUDIO_DECAY = 0.45;
/** The studio room's response by sample rate (made once each). */
const studioResponses = new Map<number, AudioBuffer>();
function studioResponse(rate: number): AudioBuffer {
  const have = studioResponses.get(rate);
  if (have) return have;
  const [left, right] = roomChannels('studio', STUDIO_DECAY, rate);
  const ir = new AudioBuffer({ length: left.length, sampleRate: rate, numberOfChannels: 2 });
  // (energy 1 over both sides together: each side's own energy is about a half, so twice that
  // leaves the room `db` under the direct sound in each ear)
  ir.copyToChannel(left.map((v) => v * Math.SQRT2), 0);
  ir.copyToChannel(right.map((v) => v * Math.SQRT2), 1);
  studioResponses.set(rate, ir);
  return ir;
}

/** The stage's response by sample rate (made once each: an AudioBuffer isn't tied to a context). */
const stageResponses = new Map<number, AudioBuffer>();
/**
 * A small concert stage heard from a few metres, in stereo: a dozen early reflections from 6 to
 * 45 ms (the floor, the side walls and the shell behind the player, each a little duller and from
 * one side or the other) and a diffuse tail dying away over about 0.8 s (60 dB), its highs going
 * first as air and walls take them. Its energy is the direct sound's, so the instrument's `room`
 * sets the level. The same every time (a seeded noise), so an export sounds as it plays live.
 */
export function stageResponse(rate: number): AudioBuffer {
  const have = stageResponses.get(rate);
  if (have) return have;
  const length = Math.round(rate * 0.9);
  const ir = new AudioBuffer({ length, sampleRate: rate, numberOfChannels: 2 });
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const left = ir.getChannelData(0);
  const right = ir.getChannelData(1);
  // The early reflections: [ms, gain, side (-1 left .. 1 right)]
  const early: Array<[number, number, number]> = [
    [6, 0.55, 0], [11, 0.42, -0.8], [13, 0.4, 0.8], [17, 0.3, -0.4], [21, 0.33, 0.5], [24, 0.25, -0.9],
    [28, 0.24, 0.9], [31, 0.2, -0.2], [35, 0.18, 0.4], [38, 0.15, -0.6], [42, 0.13, 0.7], [45, 0.12, -0.3],
  ];
  for (const [ms, g, side] of early) {
    const i = Math.round((ms / 1000) * rate);
    // a little duller each time: three samples' smear
    for (let k = -1; k <= 1; k++) {
      const w = k === 0 ? 0.5 : 0.25;
      left[i + k] += g * w * Math.sqrt((1 - side) / 2) * 1.2;
      right[i + k] += g * w * Math.sqrt((1 + side) / 2) * 1.2;
    }
  }
  // The tail: noise from 20 ms, its level falling 60 dB in 0.8 s, low-passed ever lower (8 kHz to 2 kHz)
  const begin = Math.round(0.02 * rate);
  let lpL = 0;
  let lpR = 0;
  for (let i = begin; i < length; i++) {
    const t = (i - begin) / rate;
    const env = 0.11 * Math.min(1, t / 0.03) * 10 ** ((-60 * t) / 0.8 / 20);
    const cutoff = 8000 * 0.25 ** Math.min(1, t / 0.6);
    const c = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    lpL += c * ((random() * 2 - 1) - lpL);
    lpR += c * ((random() * 2 - 1) - lpR);
    left[i] += env * lpL * 1.7;
    right[i] += env * lpR * 1.7;
  }
  // Its energy set to the direct sound's (1): `room` dB then says how much of it there is
  let energy = 0;
  for (let i = 0; i < length; i++) energy += (left[i] * left[i] + right[i] * right[i]) / 2;
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < length; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
  stageResponses.set(rate, ir);
  return ir;
}

/** How much quieter `note` plays under an instrument's taper (1 = as it is). */
export function taperGain(taper: InstrumentDef['taper'], note: string): number {
  if (!taper) return 1;
  const octaves = (Tone.Frequency(note).toMidi() - taper[0]) / 12;
  return octaves > 0 ? Tone.dbToGain(-taper[1] * octaves) : 1;
}

/**
 * Expressive playing (a track's Expressive switch): a recording made at one loudness is played
 * the way a real instrument sounds at the velocity asked for.
 * - Brightness follows velocity: a note played softer than hard goes through a low-pass, up to
 *   `depth` octaves lower at the softest (see velocityTone.ts), so a soft note is darker, not just
 *   quieter, as with SFZ's fil_veltrack; played hard it is the recording as made.
 * - Loudness follows a dB curve (`rangeDb` from the softest to full) instead of a straight line.
 * - No two hits are quite the same: each note's level moves up to ±0.6 dB, seeded from the note
 *   and its time, so a repeated note doesn't machine-gun and an export comes out the same every
 *   time. Its pitch doesn't move: a note on its own recording plays it exactly, never resampled
 *   (it was detuned up to ±3 cents once, which sent every note through the buffer source's
 *   interpolation and dulled its top).
 */
export interface Expressive {
  depth: number;
  rangeDb: number;
}

const EXPRESSIVE_BY_CATEGORY: Partial<Record<InstrumentDef['category'], Expressive>> = {
  'Winds & Brass': { depth: 3.2, rangeDb: 20 },
  Orchestra: { depth: 3, rangeDb: 20 },
  'Keys & Synths': { depth: 2.5, rangeDb: 18 },
  'Guitars & Strings': { depth: 2.5, rangeDb: 18 },
  'Choir & Voices': { depth: 2, rangeDb: 16 },
  'Mallets & Bells': { depth: 2.2, rangeDb: 20 },
  'Pads & Atmospheres': { depth: 1.5, rangeDb: 12 },
  World: { depth: 2.5, rangeDb: 18 },
  Bass: { depth: 2, rangeDb: 14 },
  'Drums & Percussion': { depth: 1.6, rangeDb: 18 },
};

/**
 * How an instrument plays expressively (null: as recorded, e.g. drum kits and sound effects). The
 * guitars in the older General MIDI group play as the other guitars do: before, a soft note there
 * was only quieter, never darker.
 */
export function expressiveFor(def: InstrumentDef): Expressive | null {
  const base = EXPRESSIVE_BY_CATEGORY[STRUMMED.has(def.key) ? 'Guitars & Strings' : def.category] ?? null;
  // Recorded at several loudnesses: a soft recording is already darker, so less filtering on top
  // (their levels are matched when converted, so velocity still sets the loudness)
  return base && (def.samples?.layers?.length ?? 0) > 1 ? { ...base, depth: base.depth * 0.4 } : base;
}

/** A note's level for `velocity` (0..1) on a dB curve `rangeDb` deep. */
export const expressiveGain = (velocity: number, rangeDb: number) => (velocity <= 0 ? 0 : 10 ** ((-rangeDb * (1 - Math.min(1, velocity))) / 20));

/** A number from -1 to 1 for a note at a moment (the same every time). */
export function noteJitter(note: string, time: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  const text = `${note}@${Math.round(time * 1000)}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Each held recording's seamless loop in seconds (SampleSource.loops), once loaded. */
const loopsOf = new WeakMap<AudioBuffer, [number, number]>();

/** Recordings by MIDI note: what one sampler slot plays from (the nearest one, re-pitched). */
type Slot = Map<number, AudioBuffer>;

/**
 * The recordings a voice plays: one slot, or one per loudness and take (SampleSource.layers), and
 * which slot plays a note at a velocity.
 */
interface SlotBank {
  slots: Slot[];
  pick: (velocity: number) => Slot;
  /** The recordings at loudness `layer` (0 softest; its takes in turn), and how many loudnesses there are */
  layer?: (layer: number) => Slot;
  layers?: number;
  /**
   * Near the velocity where one loudness hands over to the next: the two recordings and how far
   * across (0 all the softer, 1 all the louder), so a velocity just either side of the boundary
   * doesn't jump from one recording's tone to the other's. Null away from a boundary.
   */
  blend?: (velocity: number) => { low: Slot; high: Slot; x: number } | null;
  /** The recordings loaded first when nothing is known of the song (see loadQuick), for a note whose own slot has nothing near */
  fallback?: Slot;
  /** False while some recordings are still to load (then a note plays the nearest loaded anywhere) */
  complete?: () => boolean;
  /** A note is playing whose own recordings may not be loaded yet: load them now (`wheel`: the mod wheel's dynamics it plays under) */
  want?: (midi: number, velocity: number, wheel?: number) => void;
  /** The sounds of keys being let go (ReleaseSounds), their takes in turn */
  releases?: { slots: Slot[]; db: number; decay?: number };
  /** The slots by loudness (then take) and the loudnesses' velocity tops, for making ahead what notes will play (prepare) */
  byLayer?: Slot[][];
  tops?: number[];
}

const peaks = new WeakMap<AudioBuffer, number>();
/** A recording's highest sample, for setting a release sound's level against its note's. */
function peakOf(buffer: AudioBuffer): number {
  let p = peaks.get(buffer);
  if (p === undefined) {
    p = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const a = d[i] < 0 ? -d[i] : d[i];
        if (a > p) p = a;
      }
    }
    peaks.set(buffer, p);
  }
  return p;
}

/** The recording nearest `midi` in `slot` and how many semitones it sits below (Tone.Sampler's search: the higher one on a tie). */
function nearest(slot: Slot, midi: number): { buffer: AudioBuffer; interval: number } | null {
  for (let i = 0; i < 96; i++) {
    const up = slot.get(midi + i);
    if (up) return { buffer: up, interval: -i };
    const down = slot.get(midi - i);
    if (down) return { buffer: down, interval: i };
  }
  return null;
}

/** A note's tail below this (about -90 dBFS, before velocity) is cut: nobody hears it, and it keeps a voice playing. */
const SILENT = 3e-5;
const audibleEnds = new WeakMap<AudioBuffer, number>();
/** Where `buffer` falls silent for good, in seconds (the end of its last sample above SILENT). */
function audibleEnd(buffer: AudioBuffer): number {
  let end = audibleEnds.get(buffer);
  if (end === undefined) {
    let last = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = data.length - 1; i > last; i--) if (Math.abs(data[i]) > SILENT) { last = i; break; }
    }
    end = Math.min(buffer.duration, (last + 1) / buffer.sampleRate + 0.01);
    audibleEnds.set(buffer, end);
  }
  return end;
}

/** At most this many notes of one pitch ring at once: a further repeat fades the oldest (as a re-struck string damps itself). */
const SAME_PITCH = 3;
/** At most this many notes of one instrument ring at once: past it, the quietest fades (see makeRoom). */
const MAX_NOTES = 64;
/** How alike two of a note's recordings are (correlationOf), worked out once per pair. */
const likeness = new WeakMap<AudioBuffer, WeakMap<AudioBuffer, number>>();
function alike(a: AudioBuffer, b: AudioBuffer): number {
  let row = likeness.get(a);
  if (!row) likeness.set(a, (row = new WeakMap()));
  let rho = row.get(b);
  if (rho === undefined) {
    const channels = (x: AudioBuffer) => Array.from({ length: x.numberOfChannels }, (_, c) => x.getChannelData(c));
    rho = correlationOf(channels(a), channels(b), a.sampleRate);
    row.set(b, rho);
  }
  return rho;
}

/**
 * The mod wheel's dynamics over a note playing loudness `low` and the next: the two recordings'
 * levels, blended (layerBlend.ts), times the loudness itself (DYNAMICS_DB from the softest to
 * the loudest, as the recordings are matched in level and the wheel sets it). A wheel outside the
 * pair's span holds its nearer end.
 */
export function dynamicsMix(value: number, low: number, span: number): [soft: number, loud: number] {
  const x = Math.max(0, Math.min(1, value * span - low));
  const level = 10 ** ((-DYNAMICS_DB * (1 - Math.max(0, Math.min(1, value)))) / 20);
  const [a, b] = layerBlend(x);
  return [a * level, b * level];
}
/** From the softest to the loudest under the mod wheel's dynamics, in dB. */
const DYNAMICS_DB = 18;
/** How quickly the dynamics follow the wheel (time constant, s): smooth, without zipper noise. */
const DYNAMICS_TC = 0.03;
/** A legato change on a bowed string: the new note starts this far in (past its attack) and the two crossfade over LEGATO_FADE seconds. */
const LEGATO_SKIP = 0.07;
/**
 * A legato change's slide: the new note starts PORTAMENTO_REACH of the interval back toward the
 * old one and reaches its own pitch in PORTAMENTO_BASE + PORTAMENTO_PER_SEMITONE a semitone
 * (seconds, at most PORTAMENTO_MAX); leaps over an octave don't slide.
 */
const PORTAMENTO_REACH = 0.6;
const PORTAMENTO_BASE = 0.045;
const PORTAMENTO_PER_SEMITONE = 0.008;
const PORTAMENTO_MAX = 0.12;
const LEGATO_FADE = 0.05;
/** How fast a note let go for a newer one fades (time constant, s: gone in about 50 ms). */
const STEAL_TC = 0.01;
/**
 * A held bowed note's swell in (InstrumentDef.bowed.attack): `most` seconds at the softest, a few
 * hundredths at full loudness (0..1: the velocity, or the mod wheel's dynamics), on a curve that
 * stays short through the loud half. A real bow at mezzo-forte takes about a tenth of a second to
 * bring the string to full level, and a soft note longer.
 */
export const bowAttack = (most: number, loudness: number) => BOW_ATTACK_FASTEST + most * (1 - Math.max(0, Math.min(1, loudness))) ** 1.3;
const BOW_ATTACK_FASTEST = 0.02;
/** A guitar's note picked again within this many seconds of being let go cancels its release sound */
const RE_PICK = 0.08;
/** A note shorter than this (seconds) is played straight, without the vibrato (InstrumentDef.vibrato) */
const VIBRATO_SHORTEST = 0.33;
/** How much the vibrato moves the level too (a share of it, either way): the bow's contact and the body's resonances follow the hand */
const VIBRATO_LEVEL = 0.035;
/**
 * How a track plays its recorded instrument (Track.ring, Track.breathe), read as each note starts
 * and ends so a change is heard from the next note: `ring` seconds for a note to die away once
 * it's let go (when longer than the instrument's own release), `breathe` false for wind and brass
 * players who never run out of breath.
 */
export interface PlayFeel {
  ring?: number;
  breathe?: boolean;
}

/** Out of breath, a held note fades towards this share of its level, with this time constant (s) */
const BREATH_FLOOR = 0.5;
const BREATH_TC = 2.5;

const midiOfNote = (note: string) => 69 + 12 * Math.log2(Tone.Frequency(note).toFrequency() / 440);

/**
 * Expressive cutoffs are shared a sixth of an octave apart: notes whose cutoffs round to the same
 * step play through one filter, instead of each note making its own (a biquad is the costliest
 * node a note had). A sixth of an octave is finer than the ear follows in a note's brightness.
 */
const CUTOFF_STEPS_PER_OCTAVE = 6;

/**
 * Plays recordings from plain Web Audio nodes: each note is an AudioBufferSourceNode and one
 * GainNode (its velocity, a short fade in, and its release), made on the browser's own context (see
 * nativeNodes.ts: Tone's wrapper added a gain to every buffer source and walked the graph on every
 * connect) when it starts, and let go when it has rung out, so nothing runs between notes. Tone.Sampler made two gains per note (and, played
 * expressively, a filter of its own), and on a repeat of a pitch still ringing it moved the earlier
 * note's end to the later one's, so fast repeats piled up as overlapping notes. Here a note lasts
 * what it says, plus its release.
 *
 * The envelope matches Tone.Sampler's: `attack` seconds in, and the release an exponential fall
 * whose last tenth is a straight line to silence (Tone's targetRampTo).
 */
function samplerVoice(
  bank: SlotBank,
  options: { attack: number; release: number },
  output: Tone.Gain,
  attach: Promise<void>,
  extra: { dispose: () => void }[],
  onNote?: (time: number) => void,
  taper?: InstrumentDef['taper'],
  expressive?: Expressive | null,
  bowed?: InstrumentDef['bowed'],
  /** Seconds a note can be held before the player runs out of breath (see breathOf) */
  breath?: number,
  /** A section: a chord's notes start a few milliseconds apart (see isSection) */
  section?: boolean,
  /** Recorded without vibrato: the vibrato each held note is given (see InstrumentDef.vibrato) */
  vibrato?: InstrumentDef['vibrato'],
  /** A guitar (or banjo, mandolin): a chord's notes are strummed (see guitarStrum.ts) */
  strummed?: boolean,
  /** The track's ring and breath (see PlayFeel) */
  feel?: PlayFeel
): SamplerVoice {
  let loaded = false;
  const ready = attach.then(() => {
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge / inspector reports failures
  const raw = nativeContextOf(output.context);
  const into = nativeInputOf(output);
  // Only native nodes feed `output`: keep Tone's wrapper from taking it out of the graph
  const letGo = keepActive(output);
  // Notes between two recordings play a re-pitched copy where there is one (see pitchedCopies.ts)
  const playRate = raw.sampleRate;
  const copies = copySetFor(raw);
  /** The recording nearest `midi` in `slot` that a note plays, once every recording is in (see start's `near`) */
  const nearIn = (slot: Slot, midi: number) => {
    const f = nearest(slot, midi);
    if (f && Math.abs(f.interval) <= STRETCH_SEMITONES) return f;
    return bank.fallback && slot !== bank.fallback ? nearest(bank.fallback, midi) : f;
  };
  /**
   * Whether this voice's copies keep the recordings' rate (see wishOf): its instrument's notes
   * bend by design, or (a render's) its track's notes bend, vibrate or drift in pitch (prepare).
   */
  let wide = !!(vibrato || bowed);
  /**
   * What plays `buffer` `interval` semitones up (and `frac` more, a detuned note's): its copy at
   * that interval where there's one, at the rate `frac` leaves (exactly 1 for a note in tune), and
   * `k`, how many times as fast as the recording the copy is; else the recording at the whole rate.
   * Where the copies are at the context's rate, a note that starts off its pitch (detuned, or under
   * a bend) plays the recording: a copy read between its frames would be no better.
   */
  /**
   * A render's copies, by recording and interval: what each was made ready as (see prepare: a
   * copy of only the start of a recording, as much of it as the track's notes play).
   */
  const readied = new Map<AudioBuffer, Map<number, CopyWish>>();
  const pitched = (buffer: AudioBuffer, interval: number, frac = 0, need = Infinity, offset = 0): { buffer: AudioBuffer; rate: number; k: number } => {
    const residual = Math.abs(frac) < 1e-9 ? 1 : 2 ** (frac / 12);
    if (interval !== 0 && Math.abs(interval) <= COPY_SEMITONES && (wide || (residual === 1 && bendNow === 1))) {
      const wish = readied.get(buffer)?.get(interval) ?? wishOf(buffer, 2 ** (interval / 12), playRate, wide);
      const copy = copies.find(buffer, wish);
      // (the start of a recording only where it lasts as long as this note sounds: else the recording)
      if (copy && (!wish.region || copy.buffer.duration >= offset / copy.ratio + need * residual)) return { buffer: copy.buffer, rate: residual, k: copy.ratio };
    }
    return { buffer, rate: interval === 0 ? residual : 2 ** ((interval + frac) / 12), k: 1 };
  };
  // (Read in the voice's own context: in an export, the render's tempo, not the live one)
  const release = options.release;
  /** The release's time constant and where its straight last tenth starts (as Tone's targetRampTo). */
  const releaseTc = Math.log(release + 1) / Math.log(200);
  /** How long a release really lasts: a long one is inaudible (below -70 dB) well before it ends, so it stops there. */
  const tail = Math.min(release, releaseTc * 8);
  /** The longest a note sounds after its key is let go, the track's ring included (see releaseNow) */
  const afterRelease = () => tail + (feel?.ring ?? 0) + 0.02;
  /**
   * A release as the track has it: the instrument's own, or a longer ring (Track.ring). A note
   * that dies away by itself (a piano's, a harp's: its recording doesn't loop) rings on untouched
   * for that many seconds, as if the pedal were down, then is damped; a held one (a bow, a breath)
   * fades 60 dB over them, as a string left to sound in the hall does. `hold`: seconds before the fall.
   */
  const releaseNow = (s: Sounding): { tc: number; tail: number; hold: number } => {
    const ring = feel?.ring;
    if (!ring || ring <= tail) return { tc: releaseTc, tail, hold: 0 };
    // (held: its recording has a loop, whether or not this note was long enough to reach it)
    return s.looping || loopsOf.has(s.buffer) || heldCopies.has(s.buffer) ? { tc: ring / 6.9, tail: ring, hold: 0 } : { tc: releaseTc, tail: ring + tail, hold: ring };
  };
  /** Seconds a note can be held before the player runs out of breath, as the track has it now */
  const breathNow = () => (feel?.breathe === false ? undefined : breath);
  /** Expressive filters, by cutoff step (see CUTOFF_STEPS_PER_OCTAVE). */
  const filters = new Map<number, BiquadFilterNode>();
  const filterFor = (cutoff: number): AudioNode => {
    const step = Math.round(Math.log2(cutoff) * CUTOFF_STEPS_PER_OCTAVE);
    let f = filters.get(step);
    if (!f) {
      f = raw.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.6;
      f.frequency.value = Math.min(raw.sampleRate / 2 - 1, 2 ** (step / CUTOFF_STEPS_PER_OCTAVE));
      f.connect(into);
      filters.set(step, f);
    }
    return f;
  };

  /**
   * A note sounding: `until` is when it has rung out (Infinity while its key is held). Pitch bend
   * scales every sounding note's rate, so each keeps its unbent rate (`base`) and how much of its
   * recording it has played (`played` by `last`, at `rate`), so a held note's end can be moved
   * when a bend changes its speed.
   */
  interface Sounding {
    src: AudioBufferSourceNode;
    gain: GainNode;
    note: string;
    level: number;
    start: number;
    until: number;
    base: number;
    played: number;
    last: number;
    rate: number;
    /** When it was let go (Infinity until then): a bowed note starting before this is a legato change */
    releasedAt: number;
    /** Its release's time constant once let go (a track's ring makes it longer: see releaseNow) */
    releaseTc?: number;
    /** When its release starts to fall (later than releasedAt while a track's ring holds it: see releaseNow) */
    fallsAt?: number;
    /** Its recording loops (a note held past the recording's end), so it plays until it's released */
    looping?: boolean;
    /** Fading out for a newer note (see steal) */
    stolen?: boolean;
    /** The (first) recording it plays, for its release sound's level */
    buffer: AudioBuffer;
    /**
     * Played under the mod wheel's dynamics: the next louder recording sounds with it, the two
     * mixed by `soft` and `loud` (see dynamicsMix), `low` the softer one's loudness.
     */
    pair?: { src: AudioBufferSourceNode; base: number; soft: GainNode; loud: GainNode; low: number; from: number; mainFrom: number; looping: boolean; mainLooping: boolean };
    /** Its vibrato's pull on the level (InstrumentDef.vibrato), let go with the note */
    wobble?: GainNode;
    /** The bends sent for later it has been given, up to this time (its note's end, then its release's: see follow) */
    followedTo?: number;
  }
  /** Every source a note plays (two under the mod wheel's dynamics). */
  const sourcesOf = (s: Sounding) => (s.pair ? [s.src, s.pair.src] : [s.src]);
  /** The mod wheel's dynamics now (null: off, each note's velocity sets it). */
  let dyn: number | null = null;
  /** The last chord strummed (a guitar's: the next one's direction follows the hand) */
  let lastStrum: LastStrum | null = null;
  const sounding: Sounding[] = [];
  /**
   * The pitch bend by time (cents): a note starts at the one in force then and follows the ones
   * sent for later (see bendTimeline.ts); `bendNow`, as a rate, for the note being started.
   */
  const bends = createBendTimeline(() => raw.currentTime);
  const ratioAt = (time: number) => 2 ** (bends.at(time) / 1200);
  let bendNow = 1;
  const prune = (time: number) => {
    for (let i = sounding.length - 1; i >= 0; i--) if (sounding[i].until < time) sounding.splice(i, 1);
  };

  /** Bend `s` to `ratio` times its unbent rate from `time`. */
  const bendSound = (s: Sounding, ratio: number, time: number) => {
    s.src.playbackRate.setTargetAtTime(s.base * ratio, time, 0.005);
    s.pair?.src.playbackRate.setTargetAtTime(s.pair.base * ratio, time, 0.005);
    if (time > s.last) s.played += (time - s.last) * s.rate;
    s.last = Math.max(s.last, time);
    s.rate = s.base * ratio;
    // A held key rings until its recording runs out at the new speed
    // (Each recording by its own loop: in a pair one can loop while the other runs out)
    if (s.until === Infinity) {
      const mainLoops = s.pair ? s.pair.mainLooping : s.looping;
      if (!mainLoops && s.src.buffer) s.src.stop(time + Math.max(0, audibleEnd(s.src.buffer) - s.played) / s.rate);
      // The louder recording plays at its own speed from its own start: how far it has got
      const p = s.pair;
      if (p && !p.looping && p.src.buffer) {
        const played = p.from + (s.played - p.mainFrom) * (p.base / s.base);
        p.src.stop(time + Math.max(0, audibleEnd(p.src.buffer) - played) / (p.base * ratio));
      }
    }
  };
  /**
   * The bends sent for after `from`, on a note just started (see bendTimeline.ts), while it sounds:
   * to its end, and its release's once it's let go (a long note's vibrato, sent whole when it
   * starts, is thousands of points, and every short note under it would otherwise be given them all).
   */
  const follow = (s: Sounding, from: number) => {
    const to = Math.min(s.until, s.followedTo ?? Infinity);
    for (const [t, cents] of bends.after(from, to === Infinity ? undefined : to + 1e-9)) bendSound(s, 2 ** (cents / 1200), t);
  };
  /** `s` now sounds until `until` (let go): the bends sent for its release too. */
  const followOn = (s: Sounding, until: number) => {
    const done = s.followedTo ?? Infinity;
    if (done >= until) return;
    s.followedTo = until;
    for (const [t, cents] of bends.after(done, until === Infinity ? undefined : until + 1e-9)) bendSound(s, 2 ** (cents / 1200), t);
  };

  /** Fade `s` out quickly from `at` (its place taken by a newer note), and stop it. */
  const steal = (s: Sounding, at: number) => {
    s.stolen = true;
    const g = s.gain.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, STEAL_TC);
    s.wobble?.gain.setTargetAtTime(0, at, STEAL_TC);
    const stop = at + STEAL_TC * 6;
    if (stop < s.until) {
      for (const x of sourcesOf(s)) x.stop(stop);
      s.until = stop;
    }
  };

  /** About how loud `s` is at `at` (see noteStealing.ts). */
  const loudnessAt = (s: Sounding, at: number) =>
    noteLevelNow(
      {
        gain: levelAt(s, at),
        position: s.played + Math.max(0, at - s.last) * s.rate,
        outline: outlines.get(s.buffer),
        loop: s.looping ? loopsOf.get(s.buffer) : undefined,
        releasedAt: s.fallsAt ?? s.releasedAt,
        releaseTc: s.releaseTc ?? releaseTc,
      },
      at
    );

  /**
   * Before a note starts at `at`: if SAME_PITCH notes of its pitch are still ringing then, the
   * oldest of them fades out (as a re-struck string damps itself); if MAX_NOTES in all are, the
   * one quietest by then does (see noteStealing.ts). A fast repeat on a long-ringing note otherwise
   * stacks up dozens of copies of it, which cost a voice each and blur together. Notes already
   * fading out for a newer one don't count.
   */
  const makeRoom = (note: string, at: number) => {
    let same: Sounding | null = null;
    let sameCount = 0;
    const ringing: Sounding[] = [];
    for (const x of sounding) {
      if (x.start >= at || x.until <= at || x.stolen) continue;
      ringing.push(x);
      if (x.note === note) {
        sameCount++;
        if (!same || x.start < same.start) same = x;
      }
    }
    if (same && sameCount >= SAME_PITCH) steal(same, at);
    else if (ringing.length >= MAX_NOTES) {
      const i = chooseNoteToSteal(ringing.map((x) => ({ start: x.start, level: loudnessAt(x, at), held: x.releasedAt > at })), at);
      if (i >= 0) steal(ringing[i], at);
    }
  };

  /** The velocity a note is triggered at: as given, or on the dB curve with a little variation. */
  const level = (note: string, velocity: number, at: number) =>
    expressive ? expressiveGain(velocity, expressive.rangeDb) * 10 ** ((0.6 * noteJitter(note, at, 7)) / 20) : velocity;

  /**
   * Start `note` at `at`; it plays to the end of its recording unless released. `offset` starts it
   * that far into its recording (past a bow's slow start), fading in over `fade` seconds. A bowed
   * note's `mode`: a legato change or a short stroke (neither swells in), else a held note.
   * `scale` scales its level (a strummed chord's later strings: see guitarStrum.ts).
   */
  const start = (note: string, at: number, velocity: number, offset = 0, fade = 0, hold = 0, mode?: 'legato' | 'short', scale = 1): Sounding | null => {
    const midiFloat = midiOfNote(note);
    const midi = Math.round(midiFloat);
    // Under the mod wheel: the recording at the wheel's loudness and the next louder one
    const span = (bank.layers ?? 1) - 1;
    const low = dyn !== null && bank.layer && span > 0 ? Math.min(span - 1, Math.floor(dyn * span)) : -1;
    // Off the mod wheel, a velocity near a loudness boundary blends the two recordings either side
    const blend = low < 0 && bank.blend ? bank.blend(velocity) : null;
    // Still loading: the note's own recordings are asked for, and meanwhile it plays the nearest
    // one loaded, so it's never silent
    const loading = bank.complete ? !bank.complete() : false;
    if (loading) bank.want?.(midi, velocity, low >= 0 ? dyn! : undefined);
    const near = (slot: Slot) => {
      const f = nearest(slot, midi);
      if (f && Math.abs(f.interval) <= STRETCH_SEMITONES) return f;
      // Nothing near at its loudness: the first-loaded loudness's nearest
      if (!loading) return bank.fallback && slot !== bank.fallback ? nearest(bank.fallback, midi) : f;
      let best = bank.fallback ? nearest(bank.fallback, midi) : null;
      for (const other of [slot, ...bank.slots]) {
        const g = other === slot ? f : nearest(other, midi);
        if (g && (!best || Math.abs(g.interval) < Math.abs(best.interval))) best = g;
      }
      return best;
    };
    let found = low >= 0 ? near(bank.layer!(low)) : blend ? near(blend.low) : near(bank.pick(velocity));
    if (!found) return null;
    let upper = low >= 0 ? near(bank.layer!(low + 1)) : blend ? near(blend.high) : null;
    // Two loudnesses whose nearest recordings are of different notes (a set recorded sparsely)
    // aren't blended: a note's recordings are lined up with each other, not with a neighbour's, so
    // blended they could partly cancel. The nearer loudness plays alone.
    if (blend && upper && upper.interval !== found.interval) {
      if (blend.x >= 0.5) found = upper;
      upper = null;
    }
    const frac = midiFloat - midi;
    bendNow = ratioAt(Math.max(at, raw.currentTime));
    // (how long it sounds: to its key's release and its release's end)
    const need = hold - Math.max(at, raw.currentTime) + afterRelease();
    const main = pitched(found.buffer, found.interval, frac, need, offset);
    const base = main.rate;
    const when = Math.max(at, raw.currentTime);
    const gain = raw.createGain();
    const v = level(note, velocity, at) * taperGain(taper, note) * scale;
    // How loud it's played: its velocity, or the mod wheel's dynamics when they choose the recording
    const loudness = low >= 0 ? dyn! : velocity;
    // A held bowed note swells in (not a legato change or a short stroke, nor a note too short for it)
    const swell = bowed?.attack && !mode && hold - when >= 0.25 ? Math.min(bowAttack(bowed.attack, loudness), 0.35 * (hold - when)) : 0;
    const rise = Math.max(options.attack, fade, swell);
    if (rise > 0) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(v, when + rise);
    } else gain.gain.value = v;
    // Held past the player's breath, the note fades (by half over the next few seconds)
    const breath = breathNow();
    if (breath && hold > when + breath) {
      gain.gain.setValueAtTime(v, when + breath);
      gain.gain.setTargetAtTime(v * BREATH_FLOOR, when + breath, BREATH_TC);
    }
    // (played hard enough, or not expressively: as recorded, no filter)
    const cutoff = expressive ? expressiveCutoff(velocity, expressive.depth, Tone.Frequency(note).toFrequency()) : OPEN_CUTOFF;
    gain.connect(cutoff < OPEN_CUTOFF ? filterFor(cutoff) : into);
    /**
     * A source of `buffer` (a recording, or its copy `k` times as fast) at `rate` into `to`,
     * started `offset` seconds of the recording in; returns it and when it runs out
     */
    const play = ({ buffer, rate, k }: ReturnType<typeof pitched>, to: AudioNode, extra: AudioNode[] = []) => {
      const src = raw.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate * bendNow;
      src.connect(to);
      const from = Math.min(offset / k, audibleEnd(buffer) / 2);
      src.start(when, from);
      let end = when + (audibleEnd(buffer) - from) / (rate * bendNow);
      // Held past the end of its recording: it loops its steady stretch until it's released
      const loop = loopsOf.get(buffer);
      if (loop && hold > end - 0.5 && loop[0] > from) {
        src.loop = true;
        src.loopStart = loop[0];
        src.loopEnd = loop[1];
        end = Infinity;
      } else src.stop(end);
      // Let go once it has played (nodes made in an export are dropped with its context anyway)
      src.onended = () => {
        src.disconnect();
        for (const n of extra) n.disconnect();
      };
      return { src, end, from };
    };
    let s: Sounding;
    if (upper) {
      const soft = raw.createGain();
      const loud = raw.createGain();
      const [a, b] = low >= 0 ? dynamicsMix(dyn!, low, span) : blendFor(blend!.x, alike(found.buffer, upper.buffer));
      soft.gain.value = a;
      loud.gain.value = b;
      soft.connect(gain);
      loud.connect(gain);
      // The note's gain is let go with whichever recording runs out last
      let left = 2;
      const done = { disconnect: () => --left === 0 && gain.disconnect() } as unknown as AudioNode;
      const one = play(main, soft, [soft, done]);
      const hi = pitched(upper.buffer, upper.interval, frac, need, offset);
      const hiBase = hi.rate;
      const two = play(hi, loud, [loud, done]);
      // (`played` and `from` count the main copy's own seconds; the louder one's, its own: see bend)
      s = { src: one.src, gain, note, level: v, start: when, until: Math.max(one.end, two.end), base, played: one.from, last: when, rate: base * bendNow, releasedAt: Infinity, looping: one.end === Infinity || two.end === Infinity, buffer: main.buffer, pair: { src: two.src, base: hiBase, soft, loud, low, from: two.from, mainFrom: one.from, looping: two.end === Infinity, mainLooping: one.end === Infinity } };
    } else {
      const one = play(main, gain, [gain]);
      s = { src: one.src, gain, note, level: v, start: when, until: one.end, base, played: one.from, last: when, rate: base * bendNow, releasedAt: Infinity, looping: one.end === Infinity, buffer: main.buffer };
    }
    if (vibrato && mode !== 'short' && hold - when >= VIBRATO_SHORTEST) addVibrato(s, note, at, when, mode === 'legato', loudness);
    // The same string picked again as it was let go: no damping sound (see comingReleases)
    // (only one not yet begun, so nothing already sounding is cut off)
    for (let i = comingReleases.length - 1; i >= 0; i--) {
      const r = comingReleases[i];
      if (r.note !== note || Math.abs(r.at - when) >= RE_PICK || r.at <= raw.currentTime) continue;
      r.src.stop(r.at);
      comingReleases.splice(i, 1);
    }
    makeRoom(note, when);
    sounding.push(s);
    // (A song's note, its end known: the bends to that; let go, its release's, see releaseAt)
    if (hold > 0 && hold < Infinity) s.followedTo = hold;
    follow(s, when);
    return s;
  };

  /**
   * A player's vibrato on `s` (InstrumentDef.vibrato), for recordings made without one: a sine
   * swinging the pitch `cents` either way, deeper the louder it's played. It comes in a fifth of a
   * second or so after the note starts and grows over half a second (at once on a legato change, as
   * the hand keeps going), starting a little slower than its rate and settling into it; and its
   * rate and depth differ a little from note to note (seeded, so an export comes out the same). The
   * level follows the pitch a little (VIBRATO_LEVEL), as a string's does.
   */
  const addVibrato = (s: Sounding, note: string, at: number, when: number, legato: boolean, loudness: number) => {
    const { cents, hz } = vibrato!;
    const rate = hz * (1 + 0.07 * noteJitter(note, at, 71));
    const osc = raw.createOscillator();
    osc.frequency.setValueAtTime(rate * (legato ? 0.95 : 0.82), when);
    osc.frequency.linearRampToValueAtTime(rate, when + (legato ? 0.3 : 0.9));
    const depth = raw.createGain();
    const delay = legato ? 0.03 : 0.2 + 0.06 * noteJitter(note, at, 79);
    depth.gain.setValueAtTime(0, when);
    depth.gain.setValueAtTime(0, when + delay);
    depth.gain.linearRampToValueAtTime(legato ? 0.8 : 1, when + delay + (legato ? 0.25 : 0.5));
    if (legato) depth.gain.linearRampToValueAtTime(1, when + delay + 0.6);
    osc.connect(depth);
    const swing = cents * (0.75 + 0.35 * Math.max(0, Math.min(1, loudness))) * (1 + 0.12 * noteJitter(note, at, 83));
    const nodes: AudioNode[] = [osc, depth];
    for (const [src, base] of [[s.src, s.base], ...(s.pair ? [[s.pair.src, s.pair.base] as const] : [])] as Array<readonly [AudioBufferSourceNode, number]>) {
      const k = raw.createGain();
      k.gain.value = base * (2 ** (swing / 1200) - 1);
      depth.connect(k).connect(src.playbackRate);
      nodes.push(k);
    }
    const wobble = raw.createGain();
    wobble.gain.value = VIBRATO_LEVEL * s.level;
    depth.connect(wobble).connect(s.gain.gain);
    nodes.push(wobble);
    s.wobble = wobble;
    osc.start(when);
    // Let go with the note (whichever of its recordings runs out last)
    let left = sourcesOf(s).length;
    for (const src of sourcesOf(s))
      src.addEventListener('ended', () => {
        if (--left) return;
        osc.stop();
        for (const n of nodes) n.disconnect();
      });
  };

  /**
   * Portamento on a legato change: the new note starts part of the way back toward the old pitch
   * and slides into its own, while the old note bends toward the new one as it fades, as a string
   * player's finger slides between positions. Wider intervals slide a little longer.
   */
  const slide = (old: Sounding, next: Sounding, at: number) => {
    const interval = midiOfNote(old.note) - midiOfNote(next.note);
    if (Math.abs(interval) < 0.5 || Math.abs(interval) > 12) return;
    const glide = Math.min(PORTAMENTO_MAX, PORTAMENTO_BASE + PORTAMENTO_PER_SEMITONE * Math.abs(interval));
    const when = Math.max(at, raw.currentTime);
    const from = 2 ** ((interval * PORTAMENTO_REACH) / 12);
    for (const [src, base] of [[next.src, next.base], ...(next.pair ? [[next.pair.src, next.pair.base] as const] : [])] as Array<readonly [AudioBufferSourceNode, number]>) {
      const rate = base * ratioAt(when);
      src.playbackRate.cancelScheduledValues(when);
      src.playbackRate.setValueAtTime(rate * from, when);
      src.playbackRate.exponentialRampToValueAtTime(rate, when + glide);
    }
    const toward = 2 ** ((-interval * (1 - PORTAMENTO_REACH)) / 12);
    for (const [src, base] of [[old.src, old.base], ...(old.pair ? [[old.pair.src, old.pair.base] as const] : [])] as Array<readonly [AudioBufferSourceNode, number]>) {
      src.playbackRate.setTargetAtTime(base * ratioAt(when) * toward, when, glide / 3);
    }
    // (The bends sent for later, which the slide's start dropped)
    follow(next, when);
  };

  let releaseTurn = 0;
  /**
   * A guitar's release sounds still to come (strummed instruments): a string picked again as it's
   * let go isn't damped, so a note of the same pitch starting within RE_PICK of one cancels it
   * (tremolo picking and chugs would otherwise damp every string between picks).
   */
  const comingReleases: Array<{ note: string; at: number; src: AudioBufferSourceNode }> = [];
  /** Release sounds still sounding (see releaseSound): they follow the bend as the notes do. */
  const releaseSounds = new Set<{ src: AudioBufferSourceNode; rate: number }>();
  /**
   * The sound of `s`'s key being let go at `at` (a harpsichord's jack, a piano's damper), if the
   * instrument has them and the note is still ringing: as loud against the note as they were
   * recorded together, quieter the longer the note was held when the instrument has a `decay`.
   */
  const releaseSound = (s: Sounding, at: number) => {
    const rel = bank.releases;
    if (!rel || at >= s.until - 0.05) return;
    const slot = rel.slots[releaseTurn++ % rel.slots.length];
    const found = slot && nearest(slot, Math.round(midiOfNote(s.note)));
    if (!found) return;
    const held = Math.max(0, at - s.start);
    const fade = rel.decay ? Math.max(0.25, Math.exp(-held / rel.decay)) : 1;
    const level = s.level * 10 ** (rel.db / 20) * (peakOf(s.buffer) / Math.max(1e-6, peakOf(found.buffer))) * fade;
    if (!(level > 1e-5)) return;
    const src = raw.createBufferSource();
    // (its copy at the note's pitch where there's one: see pitched)
    const sound = pitched(found.buffer, found.interval);
    src.buffer = sound.buffer;
    const begin = Math.max(at, raw.currentTime);
    // At the bend in force, following the bends to come while it sounds (as the note did)
    src.playbackRate.value = sound.rate * ratioAt(begin);
    const ringing = { src, rate: sound.rate };
    // (Well past its end at the lowest bend: it's let go when it ends)
    for (const [t, cents] of bends.after(begin, begin + (sound.buffer.duration / sound.rate) * 4)) src.playbackRate.setTargetAtTime(sound.rate * 2 ** (cents / 1200), t, 0.005);
    releaseSounds.add(ringing);
    const g = raw.createGain();
    g.gain.value = Math.min(4, level);
    src.connect(g).connect(into);
    src.start(begin);
    if (strummed) {
      for (let i = comingReleases.length - 1; i >= 0; i--) if (comingReleases[i].at < at - 1) comingReleases.splice(i, 1);
      comingReleases.push({ note: s.note, at: Math.max(at, raw.currentTime), src });
    }
    src.onended = () => {
      releaseSounds.delete(ringing);
      src.disconnect();
      g.disconnect();
    };
  };

  /** The level `s` is at by `at` (lower once it has run out of breath). */
  const levelAt = (s: Sounding, at: number) => {
    const breath = breathNow();
    if (!breath || at <= s.start + breath) return s.level;
    return s.level * (BREATH_FLOOR + (1 - BREATH_FLOOR) * Math.exp(-(at - s.start - breath) / BREATH_TC));
  };

  /** Release `s` at `time`: its level falls away over the release, then it stops (`sound`: with its release sound). */
  const releaseAt = (s: Sounding, time: number, sound = true) => {
    const at = Math.max(time, s.start + options.attack);
    if (sound) releaseSound(s, at);
    s.releasedAt = at;
    const { tc, tail, hold } = releaseNow(s);
    s.releaseTc = tc;
    const g = s.gain.gain;
    const from = levelAt(s, at);
    g.cancelScheduledValues(at);
    g.setValueAtTime(from, at);
    // (rung on untouched for `hold`, then the fall)
    const fall = at + hold;
    s.fallsAt = fall;
    if (hold > 0) g.setValueAtTime(from, fall);
    g.setTargetAtTime(0, fall, tc);
    s.wobble?.gain.setTargetAtTime(0, fall, tc / 2);
    const late = fall + (tail - hold) * 0.9;
    g.setValueAtTime(from * Math.exp((-(tail - hold) * 0.9) / tc), late);
    g.linearRampToValueAtTime(0, at + tail);
    const stop = at + tail + 0.01;
    if (stop < s.until) {
      for (const x of sourcesOf(s)) x.stop(stop);
      s.until = stop;
    }
    followOn(s, s.until);
  };

  return {
    play: (notes, duration, time, velocity) => {
      if (!loaded || notes.length === 0) return; // still downloading: skip rather than throw
      // (No time: now, on the audio clock; output.now() would add Tone's look-ahead)
      const at = time ?? raw.currentTime;
      onNote?.(at);
      const end = at + output.toSeconds(duration);
      prune(at);
      // A section's chord: each note a few milliseconds after the last (no two players start together)
      const spread = (note: string, i: number) => (section && notes.length > 1 ? (i + 0.5 * (1 + noteJitter(note, at, 53))) * 0.006 : 0);
      if (!bowed) {
        // A guitar's chord is strummed: low to high, or high to low on the way back up
        const plan = strummed && notes.length > 1 ? strumPlan(notes.map(midiOfNote), at, end - at, velocity, lastStrum, Math.floor((noteJitter(notes.join(' '), at, 61) + 1) * 1e9)) : null;
        if (plan?.strum) lastStrum = plan.strum;
        notes.forEach((note, i) => {
          const one = plan?.notes[i];
          const s = start(note, at + (one ? one.delay : spread(note, i)), velocity, 0, 0, end, undefined, one?.gain ?? 1);
          if (s) releaseAt(s, end);
        });
        return;
      }
      // A solo string plays two notes at most (a double stop): the outer two of a chord
      const list = bowed.solo && notes.length > 2 ? [...notes].sort((a, b) => midiOfNote(a) - midiOfNote(b)).filter((_, i, all) => i === 0 || i === all.length - 1) : notes;
      // Legato: a single note starting while the last one is still held changes note without a new
      // bow attack. It comes in past its own attack and the old one crossfades out under it.
      // Only from a single held note (a line): a note over a held chord leaves the chord sounding
      const held = list.length === 1 ? sounding.filter((x) => x.start < at - 0.01 && x.releasedAt > at + 0.03 && x.until > at) : [];
      const from = held.length === 1 && held[0].note !== list[0] ? held[0] : undefined;
      // A short note starts past the bow's slow start, so fast passages speak
      const short = end - at < 0.25;
      for (const [i, note] of list.entries()) {
        const at2 = at + spread(note, i);
        const s = from ? start(note, at2, velocity, Math.max(bowed.skip, LEGATO_SKIP), LEGATO_FADE, end, 'legato') : short ? start(note, at2, velocity, bowed.skip, 0.008, end, 'short') : start(note, at2, velocity, 0, 0, end);
        if (s) releaseAt(s, end);
        if (s && from) slide(from, s, at);
      }
      if (from) {
        const g = from.gain.gain;
        from.wobble?.gain.setTargetAtTime(0, at, LEGATO_FADE);
        g.cancelScheduledValues(at);
        // The old note fades slower than the new one comes in, so the change doesn't dip
        g.setTargetAtTime(0, at, LEGATO_FADE);
        const stop = at + LEGATO_FADE * 6;
        if (stop < from.until) {
          for (const x of sourcesOf(from)) x.stop(stop);
          from.until = stop;
        }
        from.releasedAt = at;
      }
    },
    attack: (note, time, velocity) => {
      if (!loaded) return;
      onNote?.(time);
      prune(time);
      const s = start(note, time, velocity, 0, 0, Infinity);
      if (s) s.until = Infinity;
    },
    bend: (cents, time, _live, cut) => {
      const next = 2 ** (cents / 1200);
      // (By the clock, not the bend's time: one sent ahead, a long note's vibrato, mustn't drop the
      // notes that end before it from the bends sent for nearer times after it)
      prune(raw.currentTime);
      if (cut) {
        for (const s of sounding) for (const src of sourcesOf(s)) src.playbackRate.cancelScheduledValues(time);
        for (const r of releaseSounds) r.src.playbackRate.cancelScheduledValues(time);
      } else if (Math.abs(next - ratioAt(time)) < 1e-6) return;
      bends.set(cents, time, cut);
      for (const r of releaseSounds) r.src.playbackRate.setTargetAtTime(r.rate * next, time, 0.005);
      // (Each note it reaches: one followed only to its end gets it once it's let go, see followOn)
      for (const s of sounding) if (s.until > time && time <= (s.followedTo ?? Infinity)) bendSound(s, next, time);
    },
    dynamics: (value, time) => {
      dyn = value === null ? null : Math.max(0, Math.min(1, value));
      if (dyn === null) return;
      prune(time);
      const span = (bank.layers ?? 1) - 1;
      for (const s of sounding) {
        // (a velocity blend, low -1, isn't the wheel's)
        if (!s.pair || s.pair.low < 0) continue;
        const [a, b] = dynamicsMix(dyn, s.pair.low, span);
        s.pair.soft.gain.setTargetAtTime(a, time, DYNAMICS_TC);
        s.pair.loud.gain.setTargetAtTime(b, time, DYNAMICS_TC);
      }
    },
    release: (note, time) => {
      if (!loaded) return;
      // The oldest key still held on that note
      const s = sounding.find((x) => x.note === note && x.until === Infinity);
      if (s) {
        s.until = Number.MAX_VALUE;
        releaseAt(s, time);
      }
    },
    releaseAll: () => {
      // (Stopped: the wheel's dynamics wait for the next clip or wheel to set them)
      dyn = null;
      const now = raw.currentTime;
      // (One already let go, or fading under a newer note, falls on as it was: released again it
      // would start its release from the level it was held at, a jump back up)
      for (const s of sounding) if (s.until > now && s.releasedAt > now && !s.stolen) releaseAt(s, now, false);
    },
    ready,
    prepare: async (plan) => {
      await ready;
      // (a track whose notes bend: copies a bend reads well from)
      if (plan.bends) wide = true;
      /** How much of each recording (seconds) its notes play at each interval: Infinity, all of it */
      const needs = new Map<AudioBuffer, Map<number, number>>();
      const want = (buffer: AudioBuffer | undefined, interval: number, seconds: number) => {
        if (!buffer || interval === 0 || Math.abs(interval) > COPY_SEMITONES) return;
        let row = needs.get(buffer);
        if (!row) needs.set(buffer, (row = new Map()));
        // A note's hold and release (with room to spare), read `ratio` times as fast, past a bowed note's skip
        const ratio = 2 ** (interval / 12);
        const most = Number.isFinite(seconds) && !plan.glides ? ((seconds + afterRelease() + 0.1) * 1.1 * ratio + Math.max(bowed?.skip ?? 0, bowed ? LEGATO_SKIP : 0)) : Infinity;
        row.set(interval, Math.max(row.get(interval) ?? 0, most));
      };
      const tops = bank.tops ?? [1];
      const layers = bank.byLayer ?? [bank.slots];
      for (const n of plan.notes) {
        let midi: number;
        try {
          midi = Math.round(midiOfNote(n.note));
        } catch {
          continue;
        }
        // Every loudness it can play (all of them under the mod wheel's dynamics), every take of each
        const reach = plan.wheel && bank.layer ? new Set(layers.keys()) : layersInReach(tops, n);
        for (const l of reach) {
          for (const slot of layers[l] ?? []) {
            const f = nearIn(slot, midi);
            if (f) want(f.buffer, f.interval, n.seconds ?? Infinity);
          }
        }
        // (a release sound plays to its end)
        for (const slot of bank.releases?.slots ?? []) {
          const f = nearest(slot, midi);
          if (f) want(f.buffer, f.interval, Infinity);
        }
      }
      const jobs: Promise<void>[] = [];
      for (const [buffer, row] of needs) {
        for (const [interval, most] of row) {
          const whole = wishOf(buffer, 2 ** (interval / 12), playRate, wide);
          // Only the start of a recording, where that's well short of all of it (and of one that
          // loops, short of where a note held that long would loop: the start has no loop)
          const wish: CopyWish = most < 0.8 * buffer.duration && (!whole.loop || most < audibleEnd(buffer) - 0.6 * whole.ratio) ? { ...whole, region: [0, most] } : whole;
          let r = readied.get(buffer);
          if (!r) readied.set(buffer, (r = new Map()));
          r.set(interval, wish);
          jobs.push(copies.prepare(buffer, wish));
        }
      }
      await Promise.all(jobs);
    },
    dispose: () => {
      copies.dispose();
      for (const s of sounding) {
        for (const x of sourcesOf(s)) {
          x.onended = null;
          try {
            x.stop();
          } catch {
            // Not started
          }
          x.disconnect();
        }
        s.pair?.soft.disconnect();
        s.pair?.loud.disconnect();
        s.gain.disconnect();
      }
      sounding.length = 0;
      filters.forEach((f) => f.disconnect());
      letGo();
      output.dispose();
      extra.forEach((n) => n.dispose());
    },
  };
}

/** A sampled instrument's voice in the current context, connected to `output`. */
export function createSamplerVoice(key: InstrumentKey, output: Tone.InputNode, expressive = false, feel?: PlayFeel): SamplerVoice {
  const def = INSTRUMENTS[key];
  // (a guitar's studio room after its amp: see studioChain)
  const studio = def.studio !== undefined ? studioChain(def.studio, output) : null;
  const shaped = shapingChain(def.shaping, studio?.input ?? output);
  if (studio) shaped.nodes.push(...studio.nodes);
  const chain = bodyChain(def.vibrato?.body, stageChain(def.room, toneChain(def.tone, widenChain(def.widen, shaped))));
  const out = new Tone.Gain(1).connect(chain.input);
  // Two channels from here on, whether a note's recording has one or two (see alwaysStereo)
  alwaysStereo(out);
  // A few ms of attack: a recording stretched to another pitch doesn't always start at zero
  const options = { attack: 0.004, release: def.samples?.release ?? 1 };
  const layers = def.samples?.layers ?? [1];
  // One slot per loudness and take (layered names are note|layer|take): a note plays the slot for
  // its velocity, its takes in turn
  const bank: Slot[][] = layers.map(() => []);
  for (const name of Object.keys(def.samples?.samples ?? {})) {
    const [, l = '0', t = '0'] = name.split('|');
    while (bank[Number(l)].length <= Number(t)) bank[Number(l)].push(new Map());
  }
  if (!bank[0].length) bank[0].push(new Map());
  const turn = layers.map(() => 0);
  const pick = (velocity: number) => {
    const found = layers.findIndex((top) => velocity <= top + 1e-6);
    const l = found < 0 ? layers.length - 1 : found;
    return bank[l][turn[l]++ % bank[l].length];
  };
  const releaseSlots: Slot[] = [];
  const fill = (name: string, buffer: Tone.ToneAudioBuffer) => {
    const audio = buffer.get();
    if (!audio) return;
    if (name.startsWith('rel|')) {
      const [, note, t = '0'] = name.split('|');
      while (releaseSlots.length <= Number(t)) releaseSlots.push(new Map());
      releaseSlots[Number(t)].set(Math.round(midiOfNote(note)), audio);
      return;
    }
    const [note, l = '0', t = '0'] = name.split('|');
    bank[Number(l)][Number(t)].set(Math.round(midiOfNote(note)), audio);
  };
  // Playable once its first recordings are in (loadQuick: what the song plays, or one loudness of
  // every note); every other recording joins as it arrives
  // (at the rate of the context it plays in: an export at another rate has its own, see holdRecordingsAt)
  const loading = def.samples ? loadingAt(key, out.context.sampleRate, isOffline(out.context)) : undefined;
  const extra = [...chain.nodes];
  let attach: Promise<void>;
  if (loading) {
    for (const [name, buffer] of loading.have) fill(name, buffer);
    loading.listeners.add(fill);
    extra.push({ dispose: () => loading.listeners.delete(fill) });
    attach = isLive(loading) ? loadQuick(key).then(() => undefined) : loadNames(loading, loading.first ?? quickSamples(loading.index));
  } else attach = Promise.reject(new Error(`${key} has no samples`));
  const rel = def.samples?.releases;
  // A note whose own loudness has nothing near plays the first-loaded one's
  const firstSlot = bank[quickLayer(layers.length)]?.[0];
  const layer = (l: number) => bank[l][turn[l]++ % bank[l].length];
  const blend = (velocity: number) => {
    for (let l = 0; l < layers.length - 1; l++) {
      const edge = layers[l];
      if (Math.abs(velocity - edge) < BLEND_ZONE) return { low: layer(l), high: layer(l + 1), x: (velocity - (edge - BLEND_ZONE)) / (2 * BLEND_ZONE) };
    }
    return null;
  };
  const progress = loading ? { complete: () => isComplete(loading), want: (midi: number, velocity: number, wheel?: number) => wantNote(loading, midi, velocity, wheel) } : {};
  return samplerVoice({ slots: bank.flat(), pick, byLayer: bank, tops: layers, ...progress, ...(firstSlot ? { fallback: firstSlot } : {}), ...(layers.length > 1 ? { blend } : {}), ...(def.dynamics ? { layer, layers: layers.length } : {}), ...(rel ? { releases: { slots: releaseSlots, db: rel.db, decay: rel.decay } } : {}) }, options, out, attach, extra, chain.onNote, def.taper, expressive ? expressiveFor(def) : null, def.bowed, breathOf(key), isSection(key), def.vibrato, STRUMMED.has(key), feel);
}

/**
 * A sound of the user's own that plays at other pitches (the Sampler, the Multi Sampler), decoded
 * for a context: at twice its rate, as the instruments' recordings are (at its own on a device
 * with little memory, live), falling back to its own rate for a sound the library keeps at that
 * rate alone.
 */
export function decodePitchedSound(id: string, context: Tone.BaseContext): Promise<AudioBuffer> {
  return decodePitchedSoundAt(id, context.sampleRate, isOffline(context));
}

/**
 * decodePitchedSound for a context at `rate` (`offline`: a render's, which decodes at twice the
 * rate for a file, at it for a render the app plays itself: see RenderRecordings).
 */
export function decodePitchedSoundAt(id: string, rate: number, offline: boolean): Promise<AudioBuffer> {
  const twice = offline ? soundsTwiceAt(rate) : !LOW_MEMORY;
  return decodeSound(id, decodeRateOf(rate, !twice)).catch(() => decodeSound(id, rate));
}

/**
 * A sampler playing the user's own sound, tuned so `root` plays it at its original pitch. The
 * sound comes from the sound library (decoded once per sample rate and shared), or, for a project
 * not yet converted, from the data: URL it carries.
 */
export function createCustomSamplerVoice(sample: CustomSample | undefined, output: Tone.InputNode): SamplerVoice {
  const dataUrl = sample?.soundId ? undefined : sample?.dataUrl;
  if (!sample || (!sample.soundId && !dataUrl)) {
    // No sound loaded yet: ready straight away (so exports never wait on it) and silent
    return { play: () => {}, attack: () => {}, release: () => {}, bend: () => {}, releaseAll: () => {}, ready: Promise.resolve(), prepare: () => Promise.resolve(), dispose: () => {} };
  }
  const out = new Tone.Gain(1).connect(output);
  const slot: Slot = new Map();
  const buffer = dataUrl ? loadCustomSample(dataUrl) : decodePitchedSound(sample.soundId!, out.context).then((audio) => new Tone.ToneAudioBuffer(audio));
  const attach = buffer.then((b) => {
    const audio = b.get();
    if (audio) slot.set(Math.round(midiOfNote(sample.root)), audio);
  });
  // A hair of attack (1.5 ms): a sound that doesn't start at zero would click
  return samplerVoice({ slots: [slot], pick: () => slot }, { attack: 0.0015, release: 0.4 }, out, attach, []);
}

// ---------- instrument browser / deck audition ----------

const auditionVoices: Partial<Record<InstrumentKey, SamplerVoice>> = {};

/** Play a sampled instrument on a dry audition sampler (loads the samples on first use). */
export async function triggerAuditionSampler(key: InstrumentKey, notes: string[], duration: string, velocity = 0.85): Promise<void> {
  const voice = (auditionVoices[key] ??= createSamplerVoice(key, auditionInput));
  try {
    await voice.ready;
    voice.play(notes, duration, undefined, velocity);
  } catch {
    // Download failed (the badge shows the error). A failed voice stays silent, so replace it:
    // the next press builds a new one, which tries the download again
    if (auditionVoices[key] === voice) {
      delete auditionVoices[key];
      voice.dispose();
    }
  }
}

/** About how many bytes an instrument's loaded recordings take (each counted once). */
function bytesOf(l: Loading | undefined, seen = new Set<AudioBuffer>()): number {
  let bytes = 0;
  for (const b of l?.have.values() ?? []) {
    const audio = b.get();
    if (!audio || seen.has(audio)) continue;
    seen.add(audio);
    bytes += audio.length * audio.numberOfChannels * 4;
  }
  return bytes;
}

/** About how many bytes every instrument's loaded recordings take (a recording two share counted once). */
export function decodedSampleBytes(): number {
  const seen = new Set<AudioBuffer>();
  // (with the re-pitched copies kept: see pitchedCopies.ts)
  return Object.values(loadings).reduce((n, l) => n + bytesOf(l, seen), 0) + copyBytes();
}

/** Let go of an instrument's recordings: they load again when next needed. */
function forget(key: InstrumentKey): void {
  // ...and its recordings' copies, made or still to make
  const l = loadings[key];
  if (l) forgetCopiesOf([...l.have.values()].flatMap((b) => b.get() ?? []));
  delete loadings[key];
  const at = backlog.indexOf(key);
  if (at >= 0) backlog.splice(at, 1);
  setStatus(key, 'unloaded');
}

/**
 * Let go of downloaded recordings no track uses (`keep`), and the instrument browser's preview
 * players: they're downloaded or rebuilt again when next needed. Returns about how many bytes of
 * sound that frees.
 */
export function forgetUnusedSamples(keep: Set<InstrumentKey>): number {
  // The re-pitched copies too (they're made again as notes ask for them)
  let bytes = clearCopies();
  for (const key of Object.keys(auditionVoices) as InstrumentKey[]) {
    auditionVoices[key]?.dispose();
    delete auditionVoices[key];
  }
  for (const key of Object.keys(loadings) as InstrumentKey[]) {
    if (keep.has(key)) continue;
    bytes += bytesOf(loadings[key]);
    forget(key);
  }
  return bytes;
}

/** The instruments whose recordings are loaded (or loading). */
export const loadedSampleKeys = (): InstrumentKey[] => Object.keys(loadings) as InstrumentKey[];

/**
 * Let go of these instruments' recordings (no track plays them any more), leaving every other
 * instrument and the instrument browser's previews as they are. They load again if needed. One
 * still downloading is left to finish. (A recording another instrument shares, as the guitars'
 * amps do, stays with that one.)
 */
export function forgetSampleSets(keys: InstrumentKey[]): void {
  for (const key of keys) {
    const l = loadings[key];
    if (l && !l.pending.size) forget(key);
  }
}

export function releaseAuditionSamplers(): void {
  Object.values(auditionVoices).forEach((v) => v?.releaseAll());
}

