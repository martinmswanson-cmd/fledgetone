/**
 * Offline rendering and WAV encoding. The arrangement (or its stems, an intro plus loop, loop
 * takes, or one track for a freeze) is rendered faster than real time in an OfflineAudioContext,
 * built from the same instrument, strip, schedule and master factories as live playback, so an
 * export sounds like the app. Endings are ring-out, exact length or a seamless loop; WAVs are 16,
 * 24 or 32-bit with markers as cue points and loop points. A mix is rendered in parts on several
 * processor cores at once where that sounds exactly the same (see renderTracks and renderParts.ts).
 */
import { truePeakOf } from './loudness';
import { audibleIds, busChain, busFirst, busOf, liveSends } from '../store/buses';
import { insertTailSeconds } from './effects/spaceFx';
import { secondsBetween, tempoAt, type Tempo, type TempoMap, type TempoPoint } from './tempoMap';
import * as Tone from 'tone';
import { syncBuiltinPlugins } from './plugins/builtinHost';
import { captureWamStates } from './wamHost';
import { BUS_GAIN, createMixChain } from './engine';
import { createLimiterKernel, LIMITER_CEILING_DBTP } from './effects/limiter';
import { type DropFrames, type MasterStats } from './effects/masterAfter';
import { masterAfterOffThread } from './effects/masterAfterRun';
import { dropMoves, isDropTrack } from '../store/dropMoves';
import { lushReverbOf } from './effects/lushAfter';
import { leadIntoLoop } from './introSeam';
import { measureCompressorLatency } from './compressorLatency';
import { compensateTracks } from './delayCompensation';
import { createBusEffects, delaySeconds, designedDecay, ROOM_MAX_SECONDS } from './effects/busEffects';
import { roomSeconds } from './effects/roomIR';
import { ringOutLength, RING_OUT_FADE_SECONDS } from './ringOutTail';
import { createPumpClock, createTrackStrip } from './effects/trackStrip';
import type { TrackStrip } from './effects/trackStrip';
import { createInstrument, trackInstrumentOptions } from './instruments';
import { exactSumsIn, settleSums } from './exactSums';
import { deliverEnded, endedOnTimeIn } from './endedOnTime';
import { nativeInputOf } from './nativeNodes';
import { renderParts, trackCost } from './renderParts';
import type { TrackInstrument } from './instruments';
import { createClipSchedule } from './scheduler';
import { createAudioClipSchedule } from './audioClipSchedule';
import { createAutomationSchedule } from './automationSchedule';
import { decodeSound, stretchSound, useSoundLibrary, wantCopies, warpSound } from './soundLibrary';
import { isWarped } from '../store/warp';
import { withControllerLanes } from '../store/ccLanes';
import { withStepLanes } from '../store/stepLanes';
import { stretchRatio } from '../store/audioClips';
import { expandAudioComps } from '../store/takes';
import { holdRecordingsAt, loadCustomSample, songSampleLoads } from './samplers/samplerManager';
import { INSTRUMENTS, isDrumKind } from './instrumentCatalog';
import { applyTempoAt, barToTicks, scheduleTempo, ticksToBar } from './transport';
import { markerCues } from './wavCues';
import { ditherSeedOf, encodeChannels } from './wavFile';
import { withTimeout } from './waitFor';
import { trackIntensityLevel, type IntensityCurve } from '../store/intensity';
import { duckPoints } from '../store/duck';
import type { WavCue } from './wavCues';
import type { Clip, DrumHit, Marker, MasterFx, MasterSettings, Track } from '../store/timelineTypes';
import { normalizeMasterSettings, pumpFollowsDrums } from '../store/timelineTypes';
import { countedRender } from './renderBusy';
import { isNativeApp, nativeShareFile } from '../native/nativeApp';

/** Sample rates the export offers (88.2 and 96 kHz for WAV only: MP3 stops at 48 kHz). */
export const SAMPLE_RATES = [44100, 48000, 88200, 96000] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];
/** The rates every format can use (MP3 and Ogg, the game kits, freezing). */
export const BASE_SAMPLE_RATES = [44100, 48000] as const;
/** The rate a compressed file is made at for a chosen `rate`: the hi-res rates' base rate (88.2 → 44.1, 96 → 48). */
export const lossyRate = (rate: SampleRate): SampleRate => (rate === 88200 ? 44100 : rate === 96000 ? 48000 : rate);
const DEFAULT_SAMPLE_RATE: SampleRate = 44100;

export { encodeChannels, ditherSeedOf, KEPT_RENDER_BITS } from './wavFile';
/** The longest an export waits for one instrument's recordings before it gives up (ms) */
const SAMPLE_WAIT_MS = 120000;
/** WAV sample formats: 16 and 24 are integer PCM, 32 is IEEE float. */
export const BIT_DEPTHS = [16, 24, 32] as const;
export type BitDepth = (typeof BIT_DEPTHS)[number];

/**
 * How the rendered file ends:
 * - ringOut: the range, then room for release, reverb and echo tails to die away.
 * - exact: exactly the range, the last few milliseconds faded so the cut doesn't click.
 * - seamless: exactly one pass of the range played as a loop, whose start already holds what
 *   rings on from the pass before, so the file repeats without a gap or click.
 */
export type ExportEnding = 'ringOut' | 'exact' | 'seamless';

export interface RenderOptions {
  tracks: Track[];
  clips: Clip[];
  /** The tempo at bar 1 */
  bpm: number;
  /** Tempo changes after bar 1 (none: one tempo throughout) */
  tempoPoints?: TempoPoint[];
  swing: number;
  /** 1-based bar range to render, [startBar, endBar). */
  startBar: number;
  endBar: number;
  /** Shared reverb / delay settings. */
  masterFx: MasterFx;
  /** The master section's OTT and stereo width (default: both off). */
  master?: MasterSettings;
  /** Default 'ringOut'. */
  ending?: ExportEnding;
  /** Default 44100. */
  sampleRate?: SampleRate;
  /** Leave out the master compressor and limiter (for stems that add up to the mix). */
  bypassMaster?: boolean;
  /**
   * Use this reverb impulse response (at the same sample rate) instead of generating one. Each
   * generated one is fresh random noise, so separate renders only share a reverb this way.
   */
  reverbImpulse?: AudioBuffer;
  /** Aborting stops the render, which then rejects with the signal's reason (an AbortError). */
  signal?: AbortSignal;
  /**
   * Called between the render's steps, which wait for it: a background render (auto-freeze)
   * pauses this way while the song plays, so it doesn't take the computer from the live sound.
   */
  hold?: () => Promise<void> | void;
  /** Markers: the ones in the range go into the file as cue points (see exportCues). */
  markers?: Marker[];
  /**
   * A Loud master's loudness target (LUFS): the push into its clipper and limiter is found afresh
   * to get there (loudMaster.ts), and onMasterStats hears what it found. Ignored without a Loud master.
   */
  loudTargetLufs?: number;
  /** Intensity: each track plays at its stem group's level (see intensity.ts); absent: all at full level. */
  intensity?: { value: number; curves: Record<string, IntensityCurve> };
  /** An exact-length render ends without its 5 ms fade (an intro that leads straight into a loop). */
  noEndFade?: boolean;
  /**
   * Keep a ring-out render whole, not cut where its tails die away: the caller turns it up or down
   * to a loudness target first, then cuts it (cutRingOut), so the tails end under -70 dBFS in the
   * file it saves, not in the render before it was turned up.
   */
  keepRingOut?: boolean;
  /**
   * Of the tracks that sound, play only these (ids), as a stem does: the others' drum hits still
   * drive the Pumps that follow them (the hit check's bass alone, with its duck holes).
   */
  soundOnly?: readonly string[];
  /** The least a ring-out render runs past its range (default RING_OUT_LISTEN): a freeze, which cuts its own silent tail, renders less. */
  ringOutMin?: number;
  /**
   * The true-peak ceiling (dBTP) the master limiter and the final scaling hold the file under.
   * Default -1, every mixdown's (see exportCeilingDbtp); compressed stems pass a lower one.
   */
  peakCeilingDbtp?: number;
  /**
   * How many parts a mix may be rendered in at once, each on a processor core of its own (see
   * renderTracks). Default: one fewer than the computer has, up to MAX_PARTS (rendered one after
   * another where the browser doesn't render them side by side); 1: in one piece.
   */
  threads?: number;
  /** Told what the master section did after the render (how hard its clipper and limiter worked), for the Mix check. */
  onMasterStats?: (stats: MasterStats) => void;
  /** (Set by the render itself: how far a Loud master's match has got, 0 to 1.) */
  onMatchProgress?: (fraction: number) => void;
}

/**
 * A render's progress: 0 to 1, with the stage once it's a Loud master's match (the render done,
 * the push into its clipper and limiter being found: see loudMaster.ts).
 */
export type RenderProgress = (fraction: number, stage?: 'matching') => void;
/** The share of the progress bar the render fills when a Loud master's match follows it. */
const RENDER_SHARE_BEFORE_MATCH = 0.6;

/** Seconds of audio rendered between scheduling passes. */
const RENDER_STEP = 1;
/** How far past the render position notes are scheduled, so none are ever late. */
const SCHEDULE_LEAD = 0.25;
/** Fade at the end of an exact-length file. */
const EXACT_FADE_SECONDS = 0.005;
/**
 * The least a ring-out render runs past its range (seconds), so a cymbal, a long release or an echo
 * has time to die away; the file is then cut once it has (ringOutTail.ts). A fixed two seconds or
 * so ended drum and cymbal tails at about -55 dB, a lo-fi or jazz one at -46.
 */
export const RING_OUT_LISTEN = 6;
/** Crossfade at the end of a seamless loop into the end of the pass before it (see renderTracks). */
const SEAM_FADE_SECONDS = 0.01;
/** Longest echo tail a seamless loop warms up for, however high the feedback. */
const MAX_ECHO_TAIL = 60;
/**
 * Silence rendered before the Transport starts (in whole frames, so cuts stay exact). The master
 * compressor and limiter, and a track's Compressor, start cold in a fresh render and bring their
 * gain up from nothing over about 0.15 s, so the first beat of a mixdown came out up to 12 dB
 * quiet (a kick there lost its attack); they settle in the silence. Instruments also treat a note
 * due less than 5 ms after the render position as late and push it back (see monotonic.ts).
 */
const PREROLL_SECONDS = 0.25;
/** The most parts a mix renders in at once (see renderTracks). */
const MAX_PARTS = 4;
/** A render shorter than this (seconds, tails included) is done in one piece: setting up the parts would cost more than they save. */
const MIN_PARTS_SECONDS = 4;
/** Memory the parts of a render may take between them (bytes): a long song gets fewer parts, or none. */
const PARTS_MEMORY = 2 ** 30;
/** The share of the progress bar the parts fill; the master section over their sum fills the rest. */
const PARTS_PROGRESS = 0.97;

/** The fields of Tone's one-shot sources (ToneOscillatorNode, ToneBufferSource) read here. */
interface OneShotSource {
  context: Tone.BaseContext;
  disposed: boolean;
  dispose: () => void;
  toSeconds: (time: Tone.Unit.Time) => number;
  _onended: () => void;
  _stopTime: number;
  _fadeOut: Tone.Unit.Time;
  _curve: 'linear' | 'exponential';
}

/**
 * Every note starts fresh oscillator / buffer nodes. Live, Tone disposes them when they end,
 * but never in an offline context: there its scheduling clock runs ahead of the render, so
 * "ended" can still be in the render's future. Left connected, each finished node costs time
 * in every later render block, so render time grew with the square of the song length (a
 * busy hi-hat alone took 2x real time by 12 seconds in). Tone's ended hook is wrapped here to
 * collect the export's finished sources, and each is disposed once the render is past it.
 */
const finishedSources = new WeakMap<Tone.BaseContext, OneShotSource[]>();
const oneShotPrototype = Object.getPrototypeOf(Tone.ToneBufferSource.prototype) as OneShotSource;
const toneOnended = oneShotPrototype._onended;
oneShotPrototype._onended = function (this: OneShotSource) {
  finishedSources.get(this.context)?.push(this);
  toneOnended.call(this);
};

/** Dispose the finished sources (of `context`) whose sound, fade-out tail included, is over by `time`. */
function disposeFinishedSources(context: Tone.BaseContext, time: number): void {
  const finished = finishedSources.get(context);
  if (!finished) return;
  const ringing = finished.filter((source) => {
    if (source.disposed) return false;
    // Tone stops an exponential fade 2 fade-times after the stop time
    const tail = source._curve === 'exponential' ? 2 * source.toSeconds(source._fadeOut) : 0;
    if (source._stopTime + tail + 0.1 > time) return true;
    source.dispose();
    return false;
  });
  finishedSources.set(context, ringing);
}

/** The tracks that sound: not muted, and soloed if any track is. */
export function audibleTracks(tracks: Track[]): Track[] {
  // Muted and soloed through their buses too (see buses.ts)
  const heard = audibleIds(tracks);
  return tracks.filter((t) => heard.has(t.id));
}

/** The tracks that get a stem: audible ones with a clip in [startBar, endBar) (not the Drop pad, which makes no sound of its own). */
export function stemTracks(opts: Pick<RenderOptions, 'tracks' | 'clips' | 'startBar' | 'endBar'>): Track[] {
  const used = new Set(opts.clips.filter((c) => c.startBar < opts.endBar && c.startBar + c.lengthBars > opts.startBar).map((c) => c.trackId));
  return audibleTracks(opts.tracks).filter((t) => used.has(t.id) && !isDropTrack(t));
}

/**
 * The most seconds a ring-out export runs past the end of its range, for release, reverb and echo
 * tails: as long as the reverb's impulse response, a track's own Delay or Reverb insert, the master
 * delay's repeats (when a track sends to it), or `least`
 * (RING_OUT_LISTEN), whichever is longest. An export's file ends sooner once its tails have died
 * away (see ringOutTail.ts).
 */
export function ringOutSeconds(masterFx: MasterFx, tracks: Track[] = [], bpm = 120, least = RING_OUT_LISTEN): number {
  // A track's own Delay or Reverb insert can ring on longer than the master reverb
  const inserts = audibleTracks(tracks).reduce((tail, t) => Math.max(tail, insertTailSeconds(t.fx, bpm)), 0);
  // The reverb rings as long as its impulse response: a recorded room's recording (up to the
  // length the reverb keeps), or the designed room's, whose lows ring longer than its decay (up to
  // 1.4 times, in a church: as much as 18 s)
  const hall = masterFx.room
    ? Math.min(ROOM_MAX_SECONDS, useSoundLibrary.getState().metas[masterFx.room]?.seconds ?? masterFx.reverbDecay)
    : roomSeconds(masterFx.roomStyle ?? 'hall', designedDecay(masterFx.reverbDecay));
  // The master delay's repeats, when a track feeds it, until they've fallen 60 dB (up to MAX_ECHO_TAIL)
  let echoes = 0;
  if (masterFx.delayFeedback > 0 && audibleTracks(tracks).some((t) => t.delaySend > 0)) {
    const repeats = Math.log(0.001) / Math.log(Math.min(0.8, masterFx.delayFeedback));
    echoes = Math.min(MAX_ECHO_TAIL, repeats * delaySeconds(masterFx.delayTime, bpm));
  }
  return Math.max(least, hall + 0.5, inserts > 0 ? inserts + 0.5 : 0, echoes);
}

/** The frames of a render's range (before any ring-out). */
const rangeFrames = (opts: RenderOptions) => Math.round(secondsBetween(opts.startBar, opts.endBar, renderTempo(opts)) * (opts.sampleRate ?? DEFAULT_SAMPLE_RATE));

/**
 * How long a loop pass keeps sounding into the passes after it: the ring-out tail, or the echo
 * if any track feeds the delay and its repeats take longer to fall 60 dB.
 */
function loopTailSeconds(opts: RenderOptions): number {
  // (the echoes are in it: see ringOutSeconds)
  return ringOutSeconds(opts.masterFx, opts.tracks, opts.bpm);
}

/** The tempo a render plays at. */
const renderTempo = (opts: Pick<RenderOptions, 'bpm' | 'tempoPoints'>): TempoMap => ({ bpm: opts.bpm, points: opts.tempoPoints ?? [] });

/** What one render produces: how many frames, which of them make the file, and when the Transport runs. */
interface RenderPlan {
  sampleRate: number;
  /** Frames rendered in all. */
  length: number;
  /** The file is frames [keepFrom, keepFrom + keepLength) of the render. */
  keepFrom: number;
  keepLength: number;
  /** Seconds into the render where the Transport starts and stops. */
  startAt: number;
  stopAt: number;
  /** Times the range plays: 1, or the seamless loop's passes. */
  passes: number;
}

/**
 * `latency`: frames the output lags the Transport by (the master chain's look-ahead and the tracks'
 * delay compensation). `slack`: frames rendered past the end, so the kept frames can still move
 * that much later (see settleLatency).
 */
function planRender(opts: RenderOptions, latency = 0, slack = 0): RenderPlan {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  // 0.3 of a frame past the pre-roll. At round tempos many notes fall exactly on a frame (every
  // beat at 120 BPM and 44.1 kHz), and floating-point noise rounded each one to that frame or
  // the next, differently from one loop pass to another. At a whole-number tempo a note falls
  // a whole number of frames plus a fraction that is never 0.7, so moved by 0.3 none is on one.
  const preroll = Math.round(PREROLL_SECONDS * sampleRate);
  const startAt = (preroll + 0.3) / sampleRate;
  // Where the range start comes out of the graph
  const lead = preroll + latency;
  const tempo = renderTempo(opts);
  const rangeSeconds = secondsBetween(opts.startBar, opts.endBar, tempo);
  const ending = opts.ending ?? 'ringOut';
  if (ending === 'seamless') {
    // One pass of the Transport's loop, whose ends sit on whole ticks
    const loopSeconds = secondsBetween(ticksToBar(barToTicks(opts.startBar)), ticksToBar(barToTicks(opts.endBar)), tempo);
    // Warm-up passes until whatever rings on from the first one has died away, then the pass that's kept
    const passes = 2 + Math.ceil(loopTailSeconds(opts) / loopSeconds);
    const keepFrom = lead + Math.round((passes - 1) * loopSeconds * sampleRate);
    const keepLength = Math.round(loopSeconds * sampleRate);
    return { sampleRate, length: keepFrom + keepLength + slack, keepFrom, keepLength, startAt, stopAt: startAt + passes * loopSeconds, passes };
  }
  const keepLength =
    ending === 'exact' ? Math.round(rangeSeconds * sampleRate) : Math.ceil((rangeSeconds + ringOutSeconds(opts.masterFx, opts.tracks, opts.bpm, opts.ringOutMin)) * sampleRate);
  return { sampleRate, length: lead + keepLength + slack, keepFrom: lead, keepLength, startAt, stopAt: startAt + rangeSeconds, passes: 1 };
}

/** The length of the file a render makes, in frames, and how many times the range plays in it. */
export function exportFrames(opts: RenderOptions): { frames: number; passes: number } {
  const plan = planRender(opts);
  return { frames: plan.keepLength, passes: plan.passes };
}

/**
 * The markers in the range as cue points for the file, at their sample positions from its first
 * sample, which is the range start (a loop's In, seamless loops included). A ring-out file runs on
 * past the end of the range, so a marker right at the end is in it too.
 */
export function exportCues(opts: RenderOptions): WavCue[] {
  if (!opts.markers?.length) return [];
  return markerCues(opts.markers, {
    startBar: opts.startBar,
    endBar: opts.endBar,
    // The Transport starts on the tick nearest the range start, and that's where the file starts
    originBar: ticksToBar(barToTicks(opts.startBar)),
    bpm: renderTempo(opts),
    sampleRate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
    frames: exportFrames(opts).frames,
    includeEnd: (opts.ending ?? 'ringOut') === 'ringOut',
  });
}

/**
 * Frames the master compressor and limiter delay the sound by. The compressor is a
 * DynamicsCompressorNode with a fixed look-ahead (measured: see compressorLatency.ts); the
 * look-ahead limiter (effects/limiter.ts) adds its own fixed delay, or, where its AudioWorklet
 * can't run or didn't load, the stand-in limiter (another compressor) adds the compressor's.
 * Without allowing for it every export came out late, out of step with the timeline and with
 * stems that skip the chain.
 */
function masterLatencyWith(compressor: number, sampleRate: number, lookahead: boolean): number {
  return compressor + (lookahead ? createLimiterKernel(sampleRate).latency : compressor);
}

/** Whether a render plans for the look-ahead limiter: where AudioWorklets exist (settleLatency corrects it if it doesn't load). */
const expectsLookahead = () => typeof AudioWorkletNode !== 'undefined';

/** The master section's latency a render is planned with (see masterLatencyWith). */
async function masterChainLatency(sampleRate: number): Promise<number> {
  return masterLatencyWith(await measureCompressorLatency(sampleRate), sampleRate, expectsLookahead());
}

/** Frames a plan with the master section keeps past its end, so settleLatency can move it either way. */
async function latencySlack(sampleRate: number): Promise<number> {
  const compressor = await measureCompressorLatency(sampleRate);
  return Math.abs(masterLatencyWith(compressor, sampleRate, false) - masterLatencyWith(compressor, sampleRate, true));
}

/**
 * The plan with its kept frames where the sound comes out with the limiter actually in place
 * (`lookahead`: the look-ahead one, else the stand-in), once the render's chain is built: it was
 * planned for the look-ahead limiter wherever AudioWorklets exist, but the worklet can still
 * fail to load, and the stand-in delays the sound by another amount.
 */
async function settleLatency(plan: RenderPlan, lookahead: boolean): Promise<RenderPlan> {
  if (lookahead === expectsLookahead()) return plan;
  const compressor = await measureCompressorLatency(plan.sampleRate);
  const shift = masterLatencyWith(compressor, plan.sampleRate, lookahead) - masterLatencyWith(compressor, plan.sampleRate, expectsLookahead());
  const keepFrom = Math.max(0, Math.min(plan.length - plan.keepLength, plan.keepFrom + shift));
  return { ...plan, keepFrom };
}

/** `promise`, or a rejection as soon as `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Render the arrangement faster than real time in an OfflineContext. Every instrument and
 * the master chain are rebuilt inside it from the same factories used live, so the export
 * sounds like playback (mixer, track effects, sends and the shared reverb / delay included).
 *
 * Unlike Tone.Offline, which runs the whole Transport (creating a node for every note of the
 * song) before rendering a single sample, this schedules notes one step ahead of the render
 * using OfflineAudioContext.suspend(). Finished notes are released as it goes, so render
 * time grows linearly with song length instead of quadratically. `onProgress` gets 0..1.
 *
 * Every audible track goes into one stereo mix, scaled down if needed so it doesn't clip.
 */
export async function renderArrangement(opts: RenderOptions, onProgress?: RenderProgress): Promise<AudioBuffer> {
  // Solo is resolved here as mute rather than with Channel.solo. Silent tracks aren't built at
  // all (so their notes cost nothing) and their samples aren't needed.
  const sounding = audibleTracks(opts.tracks);
  const only = opts.soundOnly && new Set(opts.soundOnly);
  const rendered = await renderTracks(opts, only ? sounding.filter((t) => only.has(t.id)) : sounding, onProgress);
  const { sampleRate } = rendered;
  scale(rendered.channels, peakGain(peakOf(rendered.channels), opts));
  const channels = opts.keepRingOut ? rendered.channels : endRingOut(rendered.channels, sampleRate, opts, ringOutLength(rendered.channels, sampleRate, rangeFrames(opts)));
  return toAudioBuffer(channels, sampleRate);
}

function toAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const audio = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate });
  channels.forEach((ch, c) => audio.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return audio;
}

/**
 * A render made with `keepRingOut`, cut where its tails have died away at the level it has now
 * (after a loudness match) and faded there, as renderArrangement cuts the others. Anything but a
 * ring-out comes back as it is.
 */
export function cutRingOut(audio: AudioBuffer, opts: RenderOptions): AudioBuffer {
  const channels = channelsOf(audio);
  const cut = endRingOut(channels, audio.sampleRate, opts, ringOutLength(channels, audio.sampleRate, rangeFrames(opts)));
  return cut === channels ? audio : toAudioBuffer(cut, audio.sampleRate);
}

/**
 * Render one WAV per stem track (see stemTracks), each through its own strip, sends and the
 * shared reverb / delay, and the master chain unless `bypassMaster`. Every stem starts at the
 * range start and has the same length. One gain, set by the loudest stem's peak, scales them
 * all (never up), so their levels still match each other and the mix. `onProgress` gets the
 * overall fraction and the stem being rendered.
 */
export async function renderStems(
  opts: RenderOptions,
  bitDepth: BitDepth,
  onProgress?: (fraction: number, stem: { track: Track; index: number; count: number }) => void,
  /**
   * How each stem's samples become a file (default: WAV at `bitDepth`, with the markers as cue
   * points). Or `together`: every stem handed over at once, as a way to get each one's samples (one
   * in memory at a time), for files made with one shared gain (a compressed file held under its
   * ceiling: encodeTogether in encoders.ts).
   */
  encode?: ((channels: Float32Array[], sampleRate: number) => Promise<Blob>) | { together: (stems: Array<() => Promise<Float32Array[]>>, sampleRate: number) => Promise<Blob[]> }
): Promise<Array<{ track: Track; wav: Blob }>> {
  const tracks = stemTracks(opts);
  if (!tracks.length) throw new Error('no audible track has clips in this range');
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const parked: Array<{ track: Track; samples: Blob; length: number }> = [];
  let reverbImpulse = opts.reverbImpulse;
  let peak = 0;
  let ringsUntil = 0;
  const done = tracks.map(() => 0);
  const renderStem = async (i: number, threads = opts.threads) => {
    const track = tracks[i];
    const stem = { track, index: i, count: tracks.length };
    const progress = (f: number) => {
      done[i] = f;
      onProgress?.(done.reduce((a, b) => a + b, 0) / tracks.length, stem);
    };
    const result = await renderTracks({ ...opts, reverbImpulse, threads }, [track], progress);
    // Every stem gets the first one's reverb, so the stems' reverb tails add up to exactly
    // what the mix's one shared reverb would make of them
    reverbImpulse ??= result.reverbImpulse;
    peak = Math.max(peak, peakOf(result.channels));
    // A ring-out ends once every stem's tail has died away (each at its level before the gain
    // below, which only turns them down)
    ringsUntil = Math.max(ringsUntil, ringOutLength(result.channels, sampleRate, rangeFrames(opts)));
    // Parked in a Blob (kept by the browser outside the page's memory, on disk if need be)
    // until every stem's peak is known: a dozen long stems can be gigabytes of samples
    parked[i] = { track, samples: new Blob(result.channels), length: result.channels[0].length };
  };
  // The first stem alone (it makes the reverb the others share), then the rest several at a time,
  // each in an OfflineAudioContext of its own on a processor core of its own (see renderTracks)
  await renderStem(0);
  const atOnce = await stemsAtOnce(opts, tracks.length - 1);
  let next = 1;
  let failed = false;
  const worker = async () => {
    while (next < tracks.length && !failed) {
      const i = next++;
      try {
        await renderStem(i, atOnce > 1 ? 1 : opts.threads);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, atOnce) }, worker));

  const gain = peakGain(peak, opts);
  const cues = exportCues(opts);
  const unpark = async (stem: (typeof parked)[number]) => {
    opts.signal?.throwIfAborted();
    const samples = new Float32Array(await stem.samples.arrayBuffer());
    const channels = endRingOut([samples.subarray(0, stem.length), samples.subarray(stem.length)], sampleRate, opts, ringsUntil);
    scale(channels, gain);
    return channels;
  };
  if (encode && typeof encode !== 'function') {
    const files = await encode.together(parked.map((stem) => () => unpark(stem)), sampleRate);
    return parked.map((stem, i) => ({ track: stem.track, wav: files[i] }));
  }
  const stems: Array<{ track: Track; wav: Blob }> = [];
  for (const stem of parked) {
    const channels = await unpark(stem);
    stems.push({ track: stem.track, wav: encode ? await encode(channels, sampleRate) : encodeChannels(channels, sampleRate, bitDepth, cues, wholeFileLoop(opts, channels[0].length), ditherSeedOf(stem.track.id)) });
  }
  return stems;
}

/**
 * How many of `count` stems to render at once: as many as a mix's parts may be (partsAllowed,
 * within PARTS_MEMORY), where the browser renders offline contexts side by side; one at a time
 * for a background render.
 */
async function stemsAtOnce(opts: RenderOptions, count: number): Promise<number> {
  if (count < 2 || opts.hold) return 1;
  const plan = planRender(opts);
  const allowed = Math.min(count, partsAllowed(opts), Math.floor(PARTS_MEMORY / (plan.length * 4 * 2)));
  if (allowed < 2) return 1;
  if (opts.threads === undefined && !(await sideBySideHelps())) return 1;
  return allowed;
}

/** One file pair of an intro + loop export: the mix, or one track's layer. */
export interface IntroLoopPart {
  /** The track, for a layer; absent for the mix. */
  track?: Track;
  intro: Float32Array[];
  loop: Float32Array[];
}

/**
 * Render a game's music the way game engines play it: an intro, from bar 1 to the loop's In,
 * played once, then the loop region as a seamless loop, repeated. The intro ends without a fade,
 * straight into the loop, its last few milliseconds crossfaded so it leads into the loop's start. With `layers`, one pair per track that plays (for adaptive music: the
 * game fades layers in and out, and they all line up); otherwise one pair for the mix. Every file
 * shares one reverb and one gain (set by the loudest peak of all, never up), so intro and loop,
 * and the layers, match each other.
 */
export async function renderIntroLoop(
  opts: RenderOptions,
  layers: boolean,
  onProgress?: (fraction: number, detail: string) => void
): Promise<{ parts: IntroLoopPart[]; sampleRate: number }> {
  const inBar = opts.startBar;
  const outBar = opts.endBar;
  if (inBar <= 1) throw new Error('the loop starts at bar 1, so there is no intro: move the loop In later');
  const intro: RenderOptions = { ...opts, startBar: 1, endBar: inBar, ending: 'exact', noEndFade: true, markers: [] };
  const loop: RenderOptions = { ...opts, startBar: inBar, endBar: outBar, ending: 'seamless', markers: [] };
  const groups: Array<{ track?: Track; tracks: Track[] }> = layers
    ? stemTracks({ ...opts, startBar: 1, endBar: outBar }).map((t) => ({ track: t, tracks: [t] }))
    : [{ tracks: audibleTracks(opts.tracks) }];
  if (!groups.length || !groups[0].tracks.length) throw new Error('no audible track has clips in this range');
  let reverbImpulse = opts.reverbImpulse;
  let sampleRate: number = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  let peak = 0;
  const parts: IntroLoopPart[] = [];
  const steps = groups.length * 2;
  for (const [i, group] of groups.entries()) {
    const name = group.track ? `${group.track.name}: ` : '';
    const a = await renderTracks({ ...intro, reverbImpulse }, group.tracks, (f) => onProgress?.((2 * i + f) / steps, `${name}intro`));
    reverbImpulse ??= a.reverbImpulse;
    const b = await renderTracks({ ...loop, reverbImpulse }, group.tracks, (f) => onProgress?.((2 * i + 1 + f) / steps, `${name}loop`));
    sampleRate = a.sampleRate;
    peak = Math.max(peak, peakOf(a.channels), peakOf(b.channels));
    // Copies: the renders' channels are views into much larger buffers
    const part = { track: group.track, intro: a.channels.map((c) => c.slice()), loop: b.channels.map((c) => c.slice()) };
    // The intro's end leads into the loop's start without a step (see introSeam.ts)
    leadIntoLoop(part.intro, part.loop, sampleRate);
    parts.push(part);
  }
  const gain = peakGain(peak, opts);
  for (const part of parts) {
    scale(part.intro, gain);
    scale(part.loop, gain);
  }
  return { parts, sampleRate };
}

/**
 * Render takes of the loop region (see loopVariations.ts), each a seamless loop of the same
 * length, sharing one reverb and one gain so they can be swapped mid-game without a jump in
 * level. `takes` are the clips of each take; with `humanize`, tracks without the Human insert get
 * a light one, so every take's feel differs too.
 */
export async function renderLoopTakes(
  opts: RenderOptions,
  takes: Clip[][],
  humanize: boolean,
  onProgress?: (fraction: number, detail: string) => void
): Promise<{ takes: Float32Array[][]; sampleRate: number }> {
  const tracks = humanize ? opts.tracks.map((t) => (t.fx.human.on ? t : { ...t, fx: { ...t.fx, human: { on: true, timing: 0.35, dynamics: 0.4, pitch: 0.25 } } })) : opts.tracks;
  const audible = audibleTracks(tracks);
  if (!audible.length) throw new Error('no audible track has clips in the loop');
  let reverbImpulse = opts.reverbImpulse;
  let sampleRate: number = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  let peak = 0;
  const out: Float32Array[][] = [];
  for (const [i, clips] of takes.entries()) {
    const r = await renderTracks({ ...opts, tracks, clips, ending: 'seamless', markers: [], reverbImpulse }, audible, (f) => onProgress?.((i + f) / takes.length, `take ${i + 1}`));
    reverbImpulse ??= r.reverbImpulse;
    sampleRate = r.sampleRate;
    peak = Math.max(peak, peakOf(r.channels));
    out.push(r.channels.map((c) => c.slice()));
  }
  const gain = peakGain(peak, opts);
  for (const take of out) scale(take, gain);
  return { takes: out, sampleRate };
}

/**
 * Render the range as one seamless loop per group of tracks (a game's stems), all the same length,
 * sharing one reverb and one gain so that, played together at full level, they make the mix.
 */
export async function renderGroupStems(
  opts: RenderOptions,
  groups: Array<{ name: string; tracks: Track[] }>,
  onProgress?: (fraction: number, detail: string) => void
): Promise<{ stems: Array<{ name: string; channels: Float32Array[] }>; sampleRate: number }> {
  let reverbImpulse = opts.reverbImpulse;
  let sampleRate: number = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  let peak = 0;
  const stems: Array<{ name: string; channels: Float32Array[] }> = [];
  for (const [i, group] of groups.entries()) {
    const r = await renderTracks({ ...opts, ending: 'seamless', markers: [], reverbImpulse }, group.tracks, (f) => onProgress?.((i + f) / groups.length, group.name));
    reverbImpulse ??= r.reverbImpulse;
    sampleRate = r.sampleRate;
    peak = Math.max(peak, peakOf(r.channels));
    stems.push({ name: group.name, channels: r.channels.map((c) => c.slice()) });
  }
  const gain = peakGain(peak, opts);
  for (const stem of stems) scale(stem.channels, gain);
  return { stems, sampleRate };
}

/** The least a freeze's ring-out runs (seconds): it cuts its own silent tail after (freezeActions.ts). */
const FREEZE_RING_OUT = 2;

/**
 * A ring-out file cut to `length` frames (from ringOutLength) and faded there; anything else as it is.
 * (Views into `channels`.)
 */
function endRingOut<T extends Float32Array>(channels: T[], sampleRate: number, opts: RenderOptions, length: number): T[] {
  if ((opts.ending ?? 'ringOut') !== 'ringOut' || opts.noEndFade || length >= channels[0].length) return channels;
  const cut = channels.map((ch) => ch.subarray(0, length) as T);
  fadeOut(cut, Math.min(Math.round(RING_OUT_FADE_SECONDS * sampleRate), Math.floor(length / 4)));
  return cut;
}

/**
 * Render one track for freezing (see src/store/freeze.ts): through its instrument, inserts and
 * strip, without the master chain or volume, at its true level (not scaled to fit), with every
 * other track's kicks still driving its Pump. `opts.tracks` is the whole arrangement.
 */
export async function renderForFreeze(opts: RenderOptions, track: Track, onProgress?: (fraction: number) => void): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const { channels, sampleRate } = await renderTracks({ ...opts, bypassMaster: true, ringOutMin: opts.ringOutMin ?? FREEZE_RING_OUT }, [track], onProgress);
  return { channels, sampleRate };
}

/** Renders taking turns at the global context (see withContext). */
let contextSwaps: Promise<void> = Promise.resolve();

/**
 * Run `build` with `context` as Tone's global one (so the factories make their nodes in it), and
 * put the live one back after. Two renders at once (a game matrix still rendering behind another
 * export, or the parts of one) take turns, so neither takes the other's offline context for the
 * live one and leaves it in place.
 */
function withContext<T>(context: Tone.BaseContext, build: () => Promise<T>): Promise<T> {
  const swap = contextSwaps.then(async () => {
    const original = Tone.getContext();
    Tone.setContext(context);
    try {
      return await build();
    } finally {
      Tone.setContext(original);
    }
  });
  contextSwaps = swap.then(
    () => undefined,
    () => undefined
  );
  return swap;
}

/** What renderTracks makes: the file's samples per channel (views into the render), and the reverb it used. */
interface Rendered {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  reverbImpulse: AudioBuffer | undefined;
}

/**
 * Render `sounding` (already filtered to the tracks that sound) as planned by planRender. A mix
 * through the master section is split, where that sounds exactly the same (see renderParts.ts),
 * into parts rendered at the same time, each in an OfflineAudioContext of its own, which the
 * browser runs on a processor core of its own; the parts' sound before the master section is
 * added up and the master section runs once over the sum. If anything goes wrong with the parts,
 * it's rendered in one piece instead.
 */
async function renderTracks(opts: RenderOptions, sounding: Track[], onProgress?: RenderProgress): Promise<Rendered> {
  // Counted, so the update notice waits for it (renderBusy.ts). The plugins' latest settings
  // first: they reach the tracks every few seconds otherwise, and the render builds from them
  return countedRender(async () => {
    await captureWamStates();
    return renderTracksNow(opts, sounding, onProgress);
  });
}

async function renderTracksNow(opts: RenderOptions, sounding: Track[], onProgress?: RenderProgress): Promise<Rendered> {
  // A Loud master's match after the render takes a share of the bar of its own (it runs in a
  // Worker: see finishMaster), so the bar keeps moving while it works
  if (onProgress && opts.loudTargetLufs !== undefined && opts.master?.loud?.on && !opts.bypassMaster) {
    const report = onProgress;
    let shown = 0;
    const show = (f: number, stage?: 'matching') => {
      if (f > shown) report((shown = f), stage);
    };
    onProgress = (f) => show(RENDER_SHARE_BEFORE_MATCH * f);
    opts = { ...opts, onMatchProgress: (f) => show(RENDER_SHARE_BEFORE_MATCH + (1 - RENDER_SHARE_BEFORE_MATCH) * f, 'matching') };
  }
  // With the lush reverb fed, even a render in one piece goes the parts' way, as one part: its
  // reverb then runs after the render (lushAfter.ts), never as a worklet in an offline context
  const parts = (await partsFor(opts, sounding)) ?? (lushFed(opts) ? [sounding] : null);
  if (parts) {
    try {
      return await renderInParts(opts, parts, onProgress);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      console.warn('Rendering in parts failed, so rendering in one piece:', err);
    }
  }
  const { rendered, plan, reverbImpulse } = await renderGraph(opts, sounding, onProgress);
  return { channels: finishRender(rendered, plan, opts), sampleRate: plan.sampleRate, reverbImpulse };
}

/** Whether a render plays the lush reverb (the room style, no recorded room) and anything can reach it. */
function lushFed(opts: Pick<RenderOptions, 'masterFx' | 'tracks'>): boolean {
  return !opts.masterFx.room && opts.masterFx.roomStyle === 'lush' && feedsReverb(opts.tracks);
}

/** Whether any of these tracks can send to the shared reverb (a send, a distance, or a send lane). */
const feedsReverb = (tracks: readonly Track[]) => tracks.some((t) => t.reverbSend > 0 || (t.distance ?? 0) > 0 || t.automation?.some((l) => l.param === 'reverbSend'));

/** How many parts a render may run in at once on this computer, unless the options say. */
function partsAllowed(opts: RenderOptions): number {
  if (opts.threads !== undefined) return Math.max(1, Math.min(MAX_PARTS, Math.floor(opts.threads)));
  const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1;
  // One core stays with the page, which schedules every part's notes
  return Math.max(1, Math.min(MAX_PARTS, cores - 1));
}

/** The parts to render `sounding` in, or null to render it in one piece. */
async function partsFor(opts: RenderOptions, sounding: Track[]): Promise<Track[][] | null> {
  // A background render (hold) shouldn't take more of the computer from the live sound. Renders
  // without the master section split the same way (a stem or a freeze of one track is one part,
  // but a mix or a group of tracks without it isn't: in one piece it took twice as long)
  if (opts.hold) return null;
  const plan = planRender(opts);
  if (plan.length / plan.sampleRate < MIN_PARTS_SECONDS) return null;
  // Each part holds a whole render (stereo, 32-bit; with the lush reverb, its sends too) until
  // they're added up
  const channels = !opts.masterFx.room && opts.masterFx.roomStyle === 'lush' ? 4 : 2;
  const allowed = Math.min(partsAllowed(opts), Math.floor(PARTS_MEMORY / (plan.length * 4 * channels)));
  if (allowed < 2) return null;
  const parts = renderParts(opts.tracks, sounding, opts.clips, opts, allowed);
  // (Split the same way whether or not the browser renders the parts side by side, which a timing
  // decides: in one piece, the same song came out a rounding error different, so two exports of it
  // could differ. Where they don't run side by side, renderInParts renders them one after another.)
  return parts.length < 2 ? null : parts;
}

/** What sideBySideHelps found: true for good; false to look again at a later export (up to 3 looks). */
let sideBySide: Promise<boolean> | undefined;
let sideBySideLooks = 0;

/**
 * Whether this browser renders two OfflineAudioContexts at once faster than one after the other
 * (Chromium gives each a thread of its own). Timed on a second of a chain of filters (one thread's
 * work: a convolver would bring threads of its own), the best of two tries each, so a busy moment
 * doesn't decide it: two at once must take well under twice as long as one. About a third of a
 * second, once.
 */
async function sideBySideHelps(): Promise<boolean> {
  sideBySide ??= (async () => {
    sideBySideLooks++;
    const rate = 44100;
    const probe = () => {
      const ctx = new OfflineAudioContext(2, rate, rate);
      const source = ctx.createOscillator();
      let node: AudioNode = source;
      for (let i = 0; i < 100; i++) node = node.connect(ctx.createBiquadFilter());
      node.connect(ctx.destination);
      source.start();
      return ctx.startRendering();
    };
    const time = async (n: number) => {
      const t0 = performance.now();
      await Promise.all(Array.from({ length: n }, probe));
      return performance.now() - t0;
    };
    await time(1);
    const one = [await time(1)];
    const two = [await time(2)];
    one.push(await time(1));
    two.push(await time(2));
    return Math.min(...two) < 1.7 * Math.min(...one);
  })().catch(() => false);
  const helps = await sideBySide;
  if (!helps && sideBySideLooks < 3) sideBySide = undefined;
  return helps;
}

/**
 * Render `parts` at the same time, each without the master section, add them up, and run the
 * master section over the sum (see renderTracks). Every part is planned with the master section's
 * latency, so the parts and the sum line up sample for sample with the one render they replace.
 */
async function renderInParts(opts: RenderOptions, parts: Track[][], onProgress?: (fraction: number) => void): Promise<Rendered> {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  // Without the master section, the parts are planned as the one render without it would be
  const bypass = !!opts.bypassMaster;
  const latency = bypass ? 0 : await masterChainLatency(sampleRate);
  const slack = bypass ? 0 : await latencySlack(sampleRate);
  // The lush reverb is an AudioWorklet live, which would put every part on Chromium's one shared
  // worklet thread (and keep its render in memory for good), and its slow drift runs only while it
  // hears something, so copies of it in the parts wouldn't add up to the one: the parts send what
  // they'd feed it, and it plays once over their sum, in plain JavaScript (see renderGraph's
  // reverbSends and lushAfter.ts)
  const lush = !opts.masterFx.room && opts.masterFx.roomStyle === 'lush';
  // The listening volume never reaches a file: renders are at 0 dB master volume (see monitor.ts)
  const masterDb = 0;
  // The bar moves as the work does: each part counts by its rough cost
  const costs = parts.map((p) => p.reduce((sum, t) => sum + trackCost(t, opts.clips, opts.startBar, opts.endBar), 0));
  const total = costs.reduce((a, b) => a + b, 0) || 1;
  const done = parts.map(() => 0);
  let shown = 0;
  const report = () => {
    const fraction = (PARTS_PROGRESS * done.reduce((sum, f, i) => sum + f * costs[i], 0)) / total;
    if (fraction > shown) onProgress?.((shown = fraction));
  };
  // A cancel stops every part, and so does one part failing (the whole is then rendered in one piece)
  const stop = new AbortController();
  const cancel = () => stop.abort(opts.signal?.reason);
  if (opts.signal?.aborted) cancel();
  opts.signal?.addEventListener('abort', cancel, { once: true });
  let results: Array<Awaited<ReturnType<typeof renderGraph>>>;
  const renderPart = (part: Track[], i: number) => {
    const progress = (f: number) => {
      done[i] = f;
      report();
    };
    return renderGraph({ ...opts, signal: stop.signal }, part, progress, { latency, slack, reverbSends: lush }).catch((err: unknown) => {
      stop.abort(err);
      throw err;
    });
  };
  try {
    // At once where the browser renders them side by side (or asked for by number: done whatever
    // the browser makes of it); otherwise one after another, which adds up to the same
    if (opts.threads !== undefined || (await sideBySideHelps())) results = await Promise.all(parts.map(renderPart));
    else {
      results = [];
      for (const [i, part] of parts.entries()) results.push(await renderPart(part, i));
    }
  } finally {
    opts.signal?.removeEventListener('abort', cancel);
  }
  let plan = results[0].plan;
  // The sum, in the first part's buffer (and the others let go of)
  const sum = results[0].rendered;
  for (let c = 0; c < sum.numberOfChannels; c++) {
    const into = sum.getChannelData(c);
    for (const r of results.slice(1)) {
      const from = r.rendered.getChannelData(c);
      for (let i = 0; i < into.length; i++) into[i] += from[i];
    }
  }
  const reverbImpulse = results[0].reverbImpulse;
  results = [];
  opts.signal?.throwIfAborted();
  // The lush reverb, once, over the parts' summed sends (channels 3 and 4), into the sum where its
  // return plays into the mix bus
  if (lush) addLushReverb(sum, opts.masterFx.reverbDecay);
  if (bypass) {
    if (masterDb) scale(channelsOf(sum).slice(0, 2), Math.pow(10, masterDb / 20));
    return { channels: finishRender(sum, plan, opts), sampleRate, reverbImpulse };
  }

  // The master section, fed the sum where the mix bus would feed it
  const native = new OfflineAudioContext(2, plan.length, sampleRate);
  exactSumsIn(native);
  const context = new Tone.OfflineContext(native);
  const mix = await withContext(context, async () => {
    // (Master volume comes after the limiter, which runs after the render: see finishMaster)
    context.destination.volume.value = 0;
    // (No lush reverb here: the sum already has it, see above)
    const chain = createMixChain(context.destination, { ...opts.masterFx, roomStyle: 'hall' }, opts.bpm, opts.master);
    chain.auditionInput.dispose();
    // The parts' sound already has the bus's gain and the shared reverb and delay in it
    chain.busFx.dispose();
    chain.bus.dispose();
    await Promise.all([chain.inserts.ready(), chain.limiterReady]);
    return chain;
  });
  // The sound comes out as late as the limiter actually in place makes it
  plan = await settleLatency(plan, mix.lookahead());
  const source = native.createBufferSource();
  source.buffer = sum;
  const split = native.createChannelSplitter(sum.numberOfChannels);
  const dry = native.createChannelMerger(2);
  source.connect(split);
  split.connect(dry, 0, 0);
  split.connect(dry, 1, 1);
  dry.connect(nativeInputOf(mix.compressor));
  source.start(0);
  const rendered = await abortable(native.startRendering(), opts.signal).finally(() => {
    source.disconnect();
    mix.inserts.dispose();
    mix.compressor.dispose();
    mix.disposeLimiter();
    settleSums(native);
  });
  await finishMaster(rendered, mix.limitsAfter, opts, masterDb, plan);
  onProgress?.(1);
  return { channels: finishRender(rendered, plan, opts), sampleRate, reverbImpulse };
}

/**
 * The lush reverb over a render's reverb sends (channels 3 and 4, see renderGraph's reverbSends),
 * added into its stereo mix (channels 1 and 2) through the mix bus's gain, as its return plays into
 * the bus (see lushAfter.ts).
 */
function addLushReverb(sum: AudioBuffer, decay: number): void {
  if (sum.numberOfChannels < 4) return;
  const [left, right, sendL, sendR] = channelsOf(sum);
  const [wetL, wetR] = lushReverbOf(sendL, sendR, sum.sampleRate, decay);
  for (let i = 0; i < left.length; i++) {
    left[i] += BUS_GAIN * wetL[i];
    right[i] += BUS_GAIN * wetR[i];
  }
}

/**
 * The Drop pad's moves in a render (see dropMoves.ts), as samples where the sound reaches them:
 * after the compressor, before the limiter, which delays it by its look-ahead. As live, a move
 * plays only if it starts in the range (a note starts only on its own tick), and lets go at the
 * range's end, where the Transport stops (or, in a seamless loop, wraps: each pass plays it again).
 */
function dropFramesOf(opts: RenderOptions, plan: RenderPlan): DropFrames[] {
  const moves = dropMoves(opts.tracks, opts.clips);
  if (!moves.length) return [];
  const sr = plan.sampleRate;
  const tempo = renderTempo(opts);
  // The Transport starts on the tick nearest the range start (see exportCues), and so do the passes
  const origin = ticksToBar(barToTicks(opts.startBar));
  const end = ticksToBar(barToTicks(opts.endBar));
  const loopSeconds = secondsBetween(origin, end, tempo);
  const loopFrames = plan.passes > 1 ? Math.round((plan.passes - 1) * loopSeconds * sr) : 0;
  const base = plan.keepFrom - loopFrames - createLimiterKernel(sr).latency;
  const frames: DropFrames[] = [];
  for (let pass = 0; pass < plan.passes; pass++) {
    for (const m of moves) {
      if (m.from < origin - 1e-9 || m.from >= end - 1e-9) continue;
      const at = (bar: number) => base + Math.round((pass * loopSeconds + secondsBetween(origin, bar, tempo)) * sr);
      frames.push({ fx: m.fx, from: at(m.from), to: at(Math.min(m.to, end)), sixteenth: secondsBetween(m.from, m.from + 1 / 16, tempo) * sr });
    }
  }
  return frames;
}

/**
 * The master section after the compressor (the OTT, width, Level and limiter) run over a finished
 * render (an export's chain ends at its compressor: see createMixChain and masterAfter.ts), then
 * the master volume, which comes after it. In a Worker (masterAfterRun.ts): a Loud master's match
 * runs the clipper and limiter over the song several times, which froze the page for many seconds.
 */
async function finishMaster(rendered: AudioBuffer, limitsAfter: boolean, opts: RenderOptions, masterDb: number, plan: RenderPlan): Promise<void> {
  if (!limitsAfter) return;
  const [l, r] = channelsOf(rendered);
  const stats = await masterAfterOffThread(
    { left: l, ...(r && r !== l ? { right: r } : {}), sampleRate: rendered.sampleRate, master: normalizeMasterSettings(opts.master), volumeDb: masterDb, ceilingDbtp: opts.peakCeilingDbtp ?? LIMITER_CEILING_DBTP, drops: dropFramesOf(opts, plan), matchLufs: opts.loudTargetLufs },
    opts.signal,
    opts.onMatchProgress
  );
  opts.onMasterStats?.(stats);
}

/**
 * Cut a whole render (`plan`'s) down to the file: a seamless loop's end crossfaded into the pass
 * before, an exact length's last few milliseconds faded. Returns views into the render.
 */
function finishRender(rendered: AudioBuffer, plan: RenderPlan, opts: RenderOptions): Float32Array<ArrayBuffer>[] {
  const ending = opts.ending ?? 'ringOut';
  if (ending === 'seamless') {
    // The render ran the pass before straight into the kept one. So that the file's end leads
    // into its start exactly as that pass led into this one, the last 10 ms crossfade into the
    // end of the pass before. Passes aren't sample-for-sample repeats (free-running chorus and
    // filter sweeps, voices whose phase depends on what they played before), so without this
    // the wrap from the last sample to the first could click.
    const fade = Math.min(Math.round(SEAM_FADE_SECONDS * plan.sampleRate), plan.keepLength);
    const end = plan.keepFrom + plan.keepLength;
    for (const ch of channelsOf(rendered).slice(0, 2)) {
      for (let i = end - fade; i < end; i++) {
        const w = (i - (end - fade) + 1) / fade;
        ch[i] += (ch[i - plan.keepLength] - ch[i]) * w;
      }
    }
  }
  // Cut to the sample: the file starts where the range start comes out (a seamless loop's last pass).
  // Stereo: the sum of a render's parts can carry their reverb sends after it (see renderInParts)
  const channels = channelsOf(rendered).slice(0, 2).map((ch) => ch.subarray(plan.keepFrom, plan.keepFrom + plan.keepLength));
  if (ending === 'exact' && !opts.noEndFade) fadeOut(channels, Math.round(EXACT_FADE_SECONDS * plan.sampleRate));
  // A ring-out's tail can still be sounding faintly when the file ends (a long cymbal, about -50 dB):
  // fade its last moments so it dies away instead of stopping on a non-zero sample
  if (ending === 'ringOut' && !opts.noEndFade) fadeOut(channels, Math.min(Math.round(RING_OUT_FADE_SECONDS * plan.sampleRate), Math.floor(plan.keepLength / 4)));
  return channels;
}

/**
 * Render `sounding`'s graph in one OfflineAudioContext as planned by planRender, and return the
 * whole render (pre-roll and tail included: finishRender cuts it). With `premaster`, the sound is
 * taken before the master section and master volume (a part, for renderInParts), planned with the
 * master section's latency as if it were there.
 */
async function renderGraph(
  opts: RenderOptions,
  sounding: Track[],
  onProgress?: (fraction: number) => void,
  premaster?: { latency: number; slack?: number; reverbSends?: boolean }
): Promise<{ rendered: AudioBuffer; plan: RenderPlan; reverbImpulse: AudioBuffer | undefined }> {
  // At a rate other than the live context's, the recorded instruments play recordings decoded at
  // this rate, not the live ones resampled note by note (see holdRecordingsAt)
  const letGo = holdRecordingsAt(opts.sampleRate ?? DEFAULT_SAMPLE_RATE);
  try {
    return await renderGraphHeld(opts, sounding, onProgress, premaster);
  } finally {
    letGo();
  }
}

/** renderGraph, with the recordings at its rate held. */
async function renderGraphHeld(
  opts: RenderOptions,
  sounding: Track[],
  onProgress?: (fraction: number) => void,
  premaster?: { latency: number; slack?: number; reverbSends?: boolean }
): Promise<{ rendered: AudioBuffer; plan: RenderPlan; reverbImpulse: AudioBuffer | undefined }> {
  // The buses these tracks play through come too (a stem of a bused track has its bus's sound),
  // each made before the tracks that play into it
  // ...and the returns they or their buses send to (heard ones: a muted return takes nothing), with their buses
  const heard = audibleIds(opts.tracks);
  const soundingIds = new Set(sounding.map((t) => t.id));
  const senders = [...sounding, ...sounding.flatMap((t) => busChain(t, opts.tracks))];
  const returns = opts.tracks.filter((r) => !soundingIds.has(r.id) && heard.has(r.id) && senders.some((t) => liveSends(t, opts.tracks).some((x) => x.to === r.id)));
  const withReturns = [...sounding, ...returns];
  const busIds = new Set(withReturns.flatMap((t) => busChain(t, opts.tracks).map((b) => b.id)));
  const { clips, bpm, swing, startBar, endBar, masterFx, signal } = opts;
  // Clips' controller lanes and step lanes play as their tracks' automation (see ccLanes.ts, stepLanes.ts)
  const tracks = withStepLanes(withControllerLanes(busFirst([...withReturns.filter((t) => !busIds.has(t.id)), ...opts.tracks.filter((t) => busIds.has(t.id))]), clips), clips, renderTempo(opts));
  const ending = opts.ending ?? 'ringOut';
  const bypassMaster = opts.bypassMaster || !!premaster;
  // Every track is held back to the slowest path through the mix (see delayCompensation.ts),
  // worked out over the whole song so a stem, or a part of a mix, lines up with the full mix
  const rate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const alignment = compensateTracks(opts.tracks, await measureCompressorLatency(rate));
  const withMaster = !premaster && !opts.bypassMaster;
  let plan = planRender(opts, alignment.total + (premaster ? premaster.latency : withMaster ? await masterChainLatency(rate) : 0), premaster ? (premaster.slack ?? 0) : withMaster ? await latencySlack(rate) : 0);
  const { sampleRate, length } = plan;
  if (plan.keepLength < 1) throw new Error('the range is empty');
  const duration = length / sampleRate;
  signal?.throwIfAborted();
  // The listening volume never reaches a file: renders are at 0 dB master volume (see monitor.ts)
  const masterDb = 0;

  // Download the recordings the song plays first (shared with live playback, so usually instant):
  // each recorded instrument's for the notes it plays here (see songSamples.ts)
  // A download that hangs gives up by itself (recordingStore.ts), and anything else that holds an
  // instrument up (its kept copies, decoding) gives up after SAMPLE_WAIT_MS, naming the instrument
  for (const [key, loading] of songSampleLoads(tracks, clips, sampleRate)) {
    const name = INSTRUMENTS[key].name;
    try {
      await withTimeout(loading, SAMPLE_WAIT_MS, `the ${name} recordings took too long to download. Check your internet connection and try again.`, signal);
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof Error && err.message.startsWith(`the ${name} recordings`)) throw err;
      throw new Error(`couldn't download the ${name} recordings. Check your internet connection and try again.`);
    }
  }
  // ...and the sounds this render plays (audio clips, Slicer and Sampler tracks), at its sample rate
  await loadSounds(tracks, clips, startBar, endBar, sampleRate, renderTempo(opts));
  signal?.throwIfAborted();

  // A native OfflineAudioContext, not Tone's default standardized-audio-context wrapper: the
  // wrapper only builds the real audio graph when rendering starts, so notes created while
  // the render is suspended would never be heard. Native nodes join the live graph at once.
  // A part's reverb sends come out on channels 3 and 4, in place of the shared reverb (renderInParts)
  const reverbSends = !!premaster?.reverbSends;
  const native = new OfflineAudioContext(reverbSends ? 4 : 2, length, sampleRate);
  // So that it renders the same every time: its sums are added up in the same order (see
  // exactSums.ts), and its notes let go of their nodes on its own clock (endedOnTime.ts)
  exactSumsIn(native);
  endedOnTimeIn(native);
  const context = new Tone.OfflineContext(native);
  finishedSources.set(context, []);
  let graph: Awaited<ReturnType<typeof buildGraph>>;
  // The global context is this render's while its graph is built
  try {
    graph = await withContext(context, () => buildGraph(context));
  } catch (err) {
    finishedSources.delete(context);
    throw err;
  }
  // The sound comes out as late as the limiter actually in place makes it
  if (withMaster) plan = await settleLatency(plan, graph.lookahead);
  // After a cancel: schedule nothing more, and free the graph so the rest of the render (which
  // an OfflineAudioContext can't stop early) runs on silence and finishes at once. And once it
  // has rendered: its instruments are let go (a recorded instrument's sampler is otherwise held by
  // the instrument's loading for good, its whole render with it, and keeps its recordings coming)
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    graph.dispose();
    finishedSources.get(context)?.forEach((source) => source.disposed || source.dispose());
    finishedSources.delete(context);
    deliverEnded(native, Infinity);
    settleSums(native);
  };
  if (signal?.aborted) {
    release();
    signal.throwIfAborted();
  }

  // Drive Tone's offline clock by hand (what OfflineContext.render does all at once)
  const clock = context as unknown as { _currentTime: number; emit(event: string): void };
  const quantum = 128 / sampleRate;
  // Run the Transport a little ahead of the clock. With no look-ahead it plays a note on the
  // first clock step at or after the note's time, and Tone starts oscillators no earlier than
  // the clock, so notes came out up to 128 samples late, by a different amount each loop pass.
  // (Set after building the graph, so its starting settings still apply from time 0.)
  // Further ahead where a groove feel or a row shift plays notes early: Tone starts them no
  // earlier than the clock, so a push longer than the look-ahead came out shorter than live
  context.lookAhead = 2 * quantum + (graph.early > 0 ? graph.early : 0);
  const advanceClock = (to: number) => {
    const end = Math.min(to, duration);
    while (clock._currentTime <= end) {
      clock.emit('tick');
      clock._currentTime += quantum;
    }
  };

  if (typeof native.suspend === 'function') {
    // Suspends land on 128-frame blocks and must come before the last one
    const lastSuspend = (Math.floor((length - 1) / 128) * 128) / sampleRate;
    // One suspend at a time, each scheduling the next, so a cancel leaves none behind
    const stepAt = (at: number) => {
      void native.suspend(at).then(async () => {
        try {
          await opts.hold?.();
          if (signal?.aborted) {
            release();
            return;
          }
          deliverEnded(native, at);
          disposeFinishedSources(context, at);
          // Paused: the links of finished notes can go without landing between two render blocks
          settleSums(native);
          const next = at + RENDER_STEP;
          if (next < lastSuspend) {
            advanceClock(next + SCHEDULE_LEAD);
            stepAt(next);
          } else {
            advanceClock(duration);
          }
          onProgress?.(at / duration);
        } finally {
          // Never leave the render suspended, or it would hold its memory forever. Built-in
          // plugins get this step's notes first (they arrive by message: see builtinHost.ts)
          void syncBuiltinPlugins(native).finally(() => native.resume());
        }
      });
    };
    if (RENDER_STEP < lastSuspend) {
      advanceClock(RENDER_STEP + SCHEDULE_LEAD);
      stepAt(RENDER_STEP);
    } else {
      advanceClock(duration);
    }
  } else {
    // No offline suspend (older Safari): schedule everything up front, slower for long songs.
    // With no suspend to wait for, a cancel frees the graph straight away, mid-render.
    advanceClock(duration);
    signal?.addEventListener('abort', release, { once: true });
  }
  await syncBuiltinPlugins(native);
  const rendered = await abortable(
    native.startRendering().finally(() => {
      signal?.removeEventListener('abort', release);
      finishedSources.delete(context);
    }),
    signal
  );
  const reverbImpulse = graph.reverbImpulse();
  const limitsAfter = graph.limitsAfter;
  // Let the graph go before the master section: it's done with, and a cancel during the Loud
  // match (which can take a while) mustn't keep it alive
  try {
    release();
  } catch (err) {
    // (The render is done: a node that won't be let go doesn't spoil it)
    console.warn('Letting go of a finished render failed:', err);
  }
  await finishMaster(rendered, limitsAfter, opts, masterDb, plan);
  onProgress?.(1);
  return { rendered, plan, reverbImpulse };

  /** Mix chain, one strip + instrument per track, and the Transport, inside the offline context. */
  async function buildGraph(context: Tone.OfflineContext) {
    // (With the master section, master volume comes after its limiter, run after the render)
    context.destination.volume.value = bypassMaster ? masterDb : 0;
    // Without the master section (stems, freezes, the parts of a mix) only the mix bus and the
    // shared reverb and delay are built, as createMixChain builds them, the bus straight to the
    // output (master volume still applies, as it's a plain gain). Then nothing loads an
    // AudioWorklet (the limiter is one) unless a track's plugin does: Chromium renders every
    // offline context with one on a single shared thread, so the parts couldn't run side by side.
    // The lush reverb (an AudioWorklet too) is never built here when something can reach it: such
    // renders go through renderInParts, which plays it after the render (lushAfter.ts), since
    // Chromium never lets go of an offline context an AudioWorklet was loaded into, nor the render
    // it holds. (Only rendering in one piece after the parts failed builds it here.)
    const section = bypassMaster ? null : createMixChain(context.destination, masterFx, bpm, opts.master);
    const mixBus = section?.bus ?? new Tone.Gain(BUS_GAIN).connect(context.destination);
    const unfed = masterFx.roomStyle === 'lush' && !tracks.some((t) => t.reverbSend > 0 || (t.distance ?? 0) > 0 || t.automation?.some((l) => l.param === 'reverbSend'));
    const busFx = section?.busFx ?? createBusEffects(mixBus, reverbSends || unfed ? { ...masterFx, roomStyle: 'hall' } : masterFx, bpm);
    if (reverbSends) {
      // Out on channels 3 and 4 (the stereo mix fills 1 and 2 and leaves them silent)
      const raw = native.destination;
      raw.channelInterpretation = 'discrete';
      const split = native.createChannelSplitter(2);
      const out = native.createChannelMerger(4);
      busFx.reverbInput.disconnect();
      Tone.connect(busFx.reverbInput, split);
      split.connect(out, 0, 2);
      split.connect(out, 1, 3);
      out.connect(raw);
    }

    const strips: TrackStrip[] = [];
    const stripOf = new Map<string, TrackStrip>();
    const instruments = new Map<string, TrackInstrument>();
    for (const track of tracks) {
      // Into its bus's strip (made already: buses come first), or the master
      const bus = busOf(track, opts.tracks);
      const strip = createTrackStrip((bus && stripOf.get(bus.id)?.input) || mixBus, busFx);
      strip.setTempo(bpm);
      strip.apply(track, { ramp: 0, muteOverride: false });
      if (opts.intensity) strip.setIntensityLevel(trackIntensityLevel(track, opts.intensity.curves, opts.intensity.value));
      strips.push(strip);
      stripOf.set(track.id, strip);
      const instrument = createInstrument(track.instrumentKey, strip.input, trackInstrumentOptions(track));
      strip.setPluginParams(instrument.setPluginParam ?? null);
      instruments.set(track.id, instrument);
    }
    // Sends into the returns (made already: returns come before the tracks that send to them)
    for (const track of tracks) {
      const sends = liveSends(track, opts.tracks).flatMap((x) => {
        const ret = stripOf.get(x.to);
        return ret ? [{ id: x.to, target: instruments.get(x.to)?.sendInput ?? ret.input, level: x.level, pre: !!x.pre }] : [];
      });
      if (sends.length) stripOf.get(track.id)!.setSends(sends, false);
    }
    for (const [id, strip] of stripOf) strip.setAlignment(alignment.delays.get(id) ?? null);
    await Promise.all([busFx.ready, section?.inserts.ready(), section?.limiterReady, ...[...instruments.values()].map((i) => i.ready)]);
    if (opts.reverbImpulse?.sampleRate === sampleRate) busFx.useImpulse(opts.reverbImpulse);

    const transport = context.transport;
    const tempo = renderTempo(opts);
    transport.loop = ending === 'seamless';
    if (transport.loop) {
      transport.loopStart = `${barToTicks(startBar)}i`;
      transport.loopEnd = `${barToTicks(endBar)}i`;
    }
    // The tempo map plays as Transport events (and from the loop's start on each pass), as live
    applyTempoAt(transport, tempo, startBar, plan.startAt);
    scheduleTempo(transport, tempo, transport.loop ? startBar : null);
    // Pumps that follow the kick hear every kick of the drum kits that sound, including ones this
    // render leaves out (a stem): those tracks' notes are scheduled, but play no instrument
    const kickTracks = audibleTracks(opts.tracks).filter((t) => isDrumKind(t.instrumentKey));
    const kickIds = new Set(kickTracks.map((t) => t.id));
    const pumpOnKick = (trackId: string, time: number, hit: DrumHit) => {
      if (kickIds.has(trackId)) strips.forEach((s) => s.pump(time, hit));
    };
    // Pumps that follow a track hear its notes even when this render leaves it out (a stem)
    const sourceIds = new Set(strips.map((s) => s.pumpSource()).filter((id): id is string => !!id));
    const pumpOnTrack = sourceIds.size ? (trackId: string, time: number) => sourceIds.has(trackId) && strips.forEach((s) => s.pump(time, 'track', trackId)) : undefined;
    const schedule = createClipSchedule(transport, (trackId) => instruments.get(trackId), pumpOnKick, () => swing, pumpOnTrack);
    const followsKick = strips.some((s) => pumpFollowsDrums(s.pumpTrigger()));
    const extra = [...(followsKick ? kickTracks : []), ...opts.tracks.filter((t) => sourceIds.has(t.id))].filter((t, i, all) => !instruments.has(t.id) && all.indexOf(t) === i);
    schedule.update([...tracks, ...extra], clips);
    const pumpClock = createPumpClock(transport, () => strips, barToTicks(startBar), barToTicks(endBar));
    pumpClock.update();
    // Audio clips play their sound files on the same Transport, from the right place in them
    // wherever the range begins (see audioClipSchedule.ts)
    const audioClips = createAudioClipSchedule(transport, (trackId) => instruments.get(trackId)?.clipBus, () => tempo);
    audioClips.update(tracks, clips);
    // Automated settings start at their lanes' values at the range start, set before the render
    // begins, and follow the lanes from when the Transport starts
    const automation = createAutomationSchedule(transport, (trackId) => stripOf.get(trackId), { holdGlide: 0, tempo: () => tempo });
    automation.hold(startBar);
    // Every track but the proxies ducks under the dialogue / SFX proxies (see duck.ts)
    automation.update(tracks, duckPoints(opts.tracks, opts.clips, bpm));
    transport.start(plan.startAt, `${barToTicks(startBar)}i`);
    // Stop at endBar (after the last pass of a seamless loop): the render runs on for the
    // tail, and notes after endBar (the rest of the song, past a loop region's Out) must not
    // play into it. A seamless loop, or an intro leading into one, runs on as long as notes play
    // early: a note pushed early off the loop's first tick sounds at the end of the pass before
    // it, as it does live, so the last pass (or the intro) ends with it too
    const early = (schedule.earliest() * 15) / Math.min(opts.bpm, ...(opts.tempoPoints ?? []).map((p) => p.bpm));
    transport.stop(plan.stopAt + (ending === 'seamless' || opts.noEndFade ? early : 0));

    return {
      /** The look-ahead limiter is in place (not the stand-in), where the master section is */
      lookahead: section ? section.lookahead() : expectsLookahead(),
      limitsAfter: !!section?.limitsAfter,
      /** Seconds before its tick the earliest note a groove feel or a row shift moves early plays (at the slowest tempo), 0 for none */
      early,
      reverbImpulse: () => busFx.impulse(),
      dispose: () => {
        schedule.dispose();
        audioClips.dispose();
        pumpClock.dispose();
        automation.dispose();
        instruments.forEach((i) => i.dispose());
        strips.forEach((s) => s.dispose());
        busFx.dispose();
        if (!mixBus.disposed) mixBus.dispose();
        if (section) {
          section.inserts.dispose();
          [section.compressor, section.auditionInput].forEach((n) => n.disposed || n.dispose());
          section.disposeLimiter();
        }
      },
    };
  }
}

/**
 * Decode every sound a render plays, at its sample rate, before its graph is built: the sounds of
 * the audio clips in the range and of the Slicer and Sampler tracks. A Sampler from a project not
 * yet converted still carries its sound as a data: URL, decoded in the live context as before.
 */
async function loadSounds(tracks: Track[], all: Clip[], startBar: number, endBar: number, sampleRate: number, tempo: Tempo): Promise<void> {
  const clips = expandAudioComps(all, tempo);
  const trackIds = new Set(tracks.map((t) => t.id));
  // Each sound once, with what to call it in an error: the clip or track it's for
  const needed = new Map<string, string>();
  for (const c of clips) {
    if (c.audio && trackIds.has(c.trackId) && c.startBar < endBar && c.startBar + c.lengthBars > startBar && !needed.has(c.audio.soundId)) {
      needed.set(c.audio.soundId, `the clip "${c.name}"`);
    }
  }
  for (const t of tracks) {
    if (t.slicer && !needed.has(t.slicer.soundId)) needed.set(t.slicer.soundId, `the track "${t.name}"`);
    if (t.sample?.soundId && !needed.has(t.sample.soundId)) needed.set(t.sample.soundId, `the track "${t.name}"`);
    else if (t.sample?.dataUrl) await loadCustomSample(t.sample.dataUrl);
  }
  // Clips that follow the tempo play stretched copies, made before the render starts
  const stretches = new Map<string, number>();
  /** ...and the clips with warp markers, warped copies */
  const warps: Array<{ audio: NonNullable<Clip['audio']>; bpm: number }> = [];
  for (const c of clips) {
    if (!c.audio?.stretchBpm || !trackIds.has(c.trackId) || c.startBar >= endBar || c.startBar + c.lengthBars <= startBar) continue;
    if (isWarped(c.audio)) {
      warps.push({ audio: c.audio, bpm: tempoAt(c.startBar, tempo) });
      continue;
    }
    const ratio = stretchRatio(c.audio, tempoAt(c.startBar, tempo));
    if (ratio !== 1) stretches.set(`${c.audio.soundId}|${ratio}`, ratio);
  }
  // Kept while they're made, however many speeds of one sound the song plays (the render's own
  // clip schedule then holds them until it's done)
  wantCopies('export', [...[...stretches.entries()].map(([key, ratio]) => ({ id: key.slice(0, key.lastIndexOf('|')), sampleRate, ratio })), ...warps.map((w) => ({ id: w.audio.soundId, sampleRate, warp: w.audio, bpm: w.bpm }))], false);
  for (const [id, label] of needed) {
    try {
      await decodeSound(id, sampleRate);
      for (const [key, ratio] of stretches) if (key.startsWith(`${id}|`)) await stretchSound(id, sampleRate, ratio);
      for (const w of warps) if (w.audio.soundId === id) await warpSound(id, sampleRate, w.audio, w.bpm);
    } catch (err) {
      const name = useSoundLibrary.getState().metas[id]?.name;
      throw new Error(`couldn't load the sound ${name ? `"${name}"` : ''} for ${label}. ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** An AudioBuffer's channels, as views (writing to them changes the buffer). */
export const channelsOf = (audio: AudioBuffer) => Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));

/** Change the level of rendered audio in place (gain in dB), e.g. to normalize an export. */
export function scaleAudio(audio: AudioBuffer, gainDb: number): void {
  scale(channelsOf(audio), Math.pow(10, gainDb / 20));
}

/** The true peak (between samples too: a limiter that catches sample peaks lets those through). */
const peakOf = (channels: Float32Array[]): number => truePeakOf(channels);

/**
 * The master limiter holds the true peak under the ceiling already; this catches what comes out
 * of a render without it (stems, which skip the master section, and a master that's switched off).
 * Exports are scaled down (never up) so their true peaks stay under -1 dBTP (or the ceiling the
 * render asks for) instead of clipping. Float WAVs get the same treatment: most players and game
 * engines clip them at full scale anyway.
 */
const peakGain = (peak: number, opts: Pick<RenderOptions, 'peakCeilingDbtp'>) => {
  const ceiling = 10 ** ((opts.peakCeilingDbtp ?? LIMITER_CEILING_DBTP) / 20);
  return peak > ceiling ? ceiling / peak : 1;
};

function scale(channels: Float32Array[], gain: number): void {
  if (gain === 1) return;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
}

/** Fade the last `frames` samples down to silence. */
function fadeOut(channels: Float32Array[], frames: number): void {
  for (const ch of channels) {
    const n = Math.min(frames, ch.length);
    for (let i = 0; i < n; i++) ch[ch.length - n + i] *= 1 - (i + 1) / n;
  }
}

/**
 * Encode an AudioBuffer as a WAV file: 16- or 24-bit PCM, or 32-bit float, with cue points
 * (markers) after the audio if there are any.
 */
export function encodeWav(audio: AudioBuffer, bitDepth: BitDepth = 16, cues: readonly WavCue[] = [], loop?: { start: number; end: number }): Blob {
  return encodeChannels(channelsOf(audio), audio.sampleRate, bitDepth, cues, loop);
}

/** Loop points for a seamless loop render: the whole file loops (a 'smpl' chunk engines and samplers read). */
export const wholeFileLoop = (opts: Pick<RenderOptions, 'ending'>, frames: number) => (opts.ending === 'seamless' ? { start: 0, end: frames } : undefined);

/**
 * Save a file and say whether it was: a download in a browser (true), the share sheet in the app
 * (true once an app was picked, false if it was closed without one). Throws if it couldn't be offered.
 */
export async function saveBlobFile(blob: Blob, filename: string): Promise<boolean> {
  if (isNativeApp()) return nativeShareFile(blob, filename);
  downloadBlob(blob, filename);
  return true;
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  // (The phone app can't download: the file goes to the share sheet, to save to Files or send)
  if (isNativeApp()) {
    void nativeShareFile(blob, filename).catch((err) =>
      import('../components/timeline/toastStore').then(({ showToast }) => showToast(`Couldn't save ${filename}: ${err instanceof Error ? err.message : String(err)}`))
    );
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
