import * as Tone from 'tone';
import { createMixChain, getMasterVolume } from './engine';
import { delaySeconds } from './effects/busEffects';
import { createPumpClock, createTrackStrip } from './effects/trackStrip';
import type { TrackStrip } from './effects/trackStrip';
import { createInstrument } from './instruments';
import type { TrackInstrument } from './instruments';
import { createClipSchedule } from './scheduler';
import { createAudioClipSchedule } from './audioClipSchedule';
import { createAutomationSchedule } from './automationSchedule';
import { decodeSound, useSoundLibrary } from './soundLibrary';
import { hasRecordings, loadCustomSample, loadSamples } from './samplers/samplerManager';
import { INSTRUMENTS, isDrumKind } from './instrumentCatalog';
import { barToTicks, ticksPerBar, ticksToBar } from './transport';
import { cueChunks, loopChunk, markerCues } from './wavCues';
import { trackIntensityLevel, type IntensityCurve } from '../store/intensity';
import type { WavCue } from './wavCues';
import type { Clip, Marker, MasterFx, MasterSettings, Track } from '../store/timelineTypes';

/** Sample rates the export offers. */
export const SAMPLE_RATES = [44100, 48000] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];
const DEFAULT_SAMPLE_RATE: SampleRate = 44100;

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
  bpm: number;
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
  /** Markers: the ones in the range go into the file as cue points (see exportCues). */
  markers?: Marker[];
  /** Leave the master volume out (a freeze: live playback applies it to the frozen sound anyway). */
  ignoreMasterVolume?: boolean;
  /** Intensity: each track plays at its stem group's level (see intensity.ts); absent: all at full level. */
  intensity?: { value: number; curves: Record<string, IntensityCurve> };
  /** An exact-length render ends without its 5 ms fade (an intro that leads straight into a loop). */
  noEndFade?: boolean;
}

/** Seconds of audio rendered between scheduling passes. */
const RENDER_STEP = 1;
/** How far past the render position notes are scheduled, so none are ever late. */
const SCHEDULE_LEAD = 0.25;
/** Exports are scaled down (never up) so their peaks sit here, just under full scale. */
const PEAK_CEILING = 0.98;
/** Fade at the end of an exact-length file. */
const EXACT_FADE_SECONDS = 0.005;
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
  const anySolo = tracks.some((t) => t.isSoloed);
  return tracks.filter((t) => !t.isMuted && (!anySolo || t.isSoloed));
}

/** The tracks that get a stem: audible ones with a clip in [startBar, endBar). */
export function stemTracks(opts: Pick<RenderOptions, 'tracks' | 'clips' | 'startBar' | 'endBar'>): Track[] {
  const used = new Set(opts.clips.filter((c) => c.startBar < opts.endBar && c.startBar + c.lengthBars > opts.startBar).map((c) => c.trackId));
  return audibleTracks(opts.tracks).filter((t) => used.has(t.id));
}

/** Seconds a ring-out export runs past the end of its range, for release and reverb tails. */
export function ringOutSeconds(masterFx: MasterFx): number {
  return Math.max(2, masterFx.reverbDecay + 0.5);
}

/**
 * How long a loop pass keeps sounding into the passes after it: the ring-out tail, or the echo
 * if any track feeds the delay and its repeats take longer to fall 60 dB.
 */
function loopTailSeconds(opts: RenderOptions): number {
  const { masterFx, bpm } = opts;
  let tail = ringOutSeconds(masterFx);
  const echoes = audibleTracks(opts.tracks).some((t) => t.delaySend > 0) && masterFx.delayFeedback > 0;
  if (echoes) {
    const repeats = Math.log(0.001) / Math.log(Math.min(0.8, masterFx.delayFeedback));
    tail = Math.max(tail, Math.min(MAX_ECHO_TAIL, repeats * delaySeconds(masterFx.delayTime, bpm)));
  }
  return tail;
}

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

/** `latency`: frames the output lags the Transport by (the master chain's look-ahead). */
function planRender(opts: RenderOptions, latency = 0): RenderPlan {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  // 0.3 of a frame past the pre-roll. At round tempos many notes fall exactly on a frame (every
  // beat at 120 BPM and 44.1 kHz), and floating-point noise rounded each one to that frame or
  // the next, differently from one loop pass to another. At a whole-number tempo a note falls
  // a whole number of frames plus a fraction that is never 0.7, so moved by 0.3 none is on one.
  const preroll = Math.round(PREROLL_SECONDS * sampleRate);
  const startAt = (preroll + 0.3) / sampleRate;
  // Where the range start comes out of the graph
  const lead = preroll + latency;
  const rangeSeconds = ((opts.endBar - opts.startBar) * 240) / opts.bpm;
  const ending = opts.ending ?? 'ringOut';
  if (ending === 'seamless') {
    // One pass of the Transport's loop, whose ends sit on whole ticks
    const loopSeconds = (((barToTicks(opts.endBar) - barToTicks(opts.startBar)) / ticksPerBar()) * 240) / opts.bpm;
    // Warm-up passes until whatever rings on from the first one has died away, then the pass that's kept
    const passes = 2 + Math.ceil(loopTailSeconds(opts) / loopSeconds);
    const keepFrom = lead + Math.round((passes - 1) * loopSeconds * sampleRate);
    const keepLength = Math.round(loopSeconds * sampleRate);
    return { sampleRate, length: keepFrom + keepLength, keepFrom, keepLength, startAt, stopAt: startAt + passes * loopSeconds, passes };
  }
  const keepLength =
    ending === 'exact' ? Math.round(rangeSeconds * sampleRate) : Math.ceil((rangeSeconds + ringOutSeconds(opts.masterFx)) * sampleRate);
  return { sampleRate, length: lead + keepLength, keepFrom: lead, keepLength, startAt, stopAt: startAt + rangeSeconds, passes: 1 };
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
    bpm: opts.bpm,
    sampleRate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
    frames: exportFrames(opts).frames,
    includeEnd: (opts.ending ?? 'ringOut') === 'ringOut',
  });
}

const masterLatency = new Map<number, Promise<number>>();

/**
 * Frames the master compressor and limiter delay the sound by. Each is a DynamicsCompressorNode
 * with a fixed look-ahead (6 ms in Chrome, Firefox and Safari), so without allowing for it every
 * export came out 12 ms late, out of step with the timeline and with stems that skip the chain.
 * Measured once per sample rate by sending a click through the same pair of nodes.
 */
function masterChainLatency(sampleRate: number): Promise<number> {
  let latency = masterLatency.get(sampleRate);
  if (!latency) {
    latency = (async () => {
      const probe = new OfflineAudioContext(1, 4096, sampleRate);
      const click = probe.createBuffer(1, 1, sampleRate);
      click.getChannelData(0)[0] = 0.01; // well under the threshold, so the gain stays put
      const source = probe.createBufferSource();
      source.buffer = click;
      // The same two stages as createMixChain (engine.ts): compressor, then limiter
      source.connect(probe.createDynamicsCompressor()).connect(probe.createDynamicsCompressor()).connect(probe.destination);
      source.start(0);
      const out = (await probe.startRendering()).getChannelData(0);
      let at = 0;
      for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[at])) at = i;
      return at;
    })().catch(() => 0);
    masterLatency.set(sampleRate, latency);
  }
  return latency;
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
export async function renderArrangement(opts: RenderOptions, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  // Solo is resolved here as mute rather than with Channel.solo. Silent tracks aren't built at
  // all (so their notes cost nothing) and their samples aren't needed.
  const { channels, sampleRate } = await renderTracks(opts, audibleTracks(opts.tracks), onProgress);
  scale(channels, peakGain(peakOf(channels)));
  const audio = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate });
  channels.forEach((ch, c) => audio.copyToChannel(ch, c));
  return audio;
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
  /** How each stem's samples become a file (default: WAV at `bitDepth`, with the markers as cue points). */
  encode?: (channels: Float32Array[], sampleRate: number) => Promise<Blob>
): Promise<Array<{ track: Track; wav: Blob }>> {
  const tracks = stemTracks(opts);
  if (!tracks.length) throw new Error('no audible track has clips in this range');
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const parked: Array<{ track: Track; samples: Blob; length: number }> = [];
  let reverbImpulse = opts.reverbImpulse;
  let peak = 0;
  for (const [i, track] of tracks.entries()) {
    const stem = { track, index: i, count: tracks.length };
    const result = await renderTracks({ ...opts, reverbImpulse }, [track], (f) => onProgress?.((i + f) / tracks.length, stem));
    // Every stem gets the first one's reverb, so the stems' reverb tails add up to exactly
    // what the mix's one shared reverb would make of them
    reverbImpulse ??= result.reverbImpulse;
    peak = Math.max(peak, peakOf(result.channels));
    // Parked in a Blob (kept by the browser outside the page's memory, on disk if need be)
    // until every stem's peak is known: a dozen long stems can be gigabytes of samples
    parked.push({ track, samples: new Blob(result.channels), length: result.channels[0].length });
  }

  const gain = peakGain(peak);
  const cues = exportCues(opts);
  const stems: Array<{ track: Track; wav: Blob }> = [];
  for (const stem of parked) {
    opts.signal?.throwIfAborted();
    const samples = new Float32Array(await stem.samples.arrayBuffer());
    const channels = [samples.subarray(0, stem.length), samples.subarray(stem.length)];
    scale(channels, gain);
    stems.push({ track: stem.track, wav: encode ? await encode(channels, sampleRate) : encodeChannels(channels, sampleRate, bitDepth, cues, wholeFileLoop(opts, channels[0].length)) });
  }
  return stems;
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
 * straight into the loop. With `layers`, one pair per track that plays (for adaptive music: the
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
    parts.push({ track: group.track, intro: a.channels.map((c) => c.slice()), loop: b.channels.map((c) => c.slice()) });
  }
  const gain = peakGain(peak);
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
  const gain = peakGain(peak);
  for (const take of out) scale(take, gain);
  return { takes: out, sampleRate };
}

/**
 * Render one track for freezing (see src/store/freeze.ts): through its instrument, inserts and
 * strip, without the master chain or volume, at its true level (not scaled to fit), with every
 * other track's kicks still driving its Pump. `opts.tracks` is the whole arrangement.
 */
export async function renderForFreeze(opts: RenderOptions, track: Track, onProgress?: (fraction: number) => void): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const { channels, sampleRate } = await renderTracks({ ...opts, bypassMaster: true, ignoreMasterVolume: true }, [track], onProgress);
  return { channels, sampleRate };
}

/**
 * Render `tracks` (already filtered to the ones that sound) as planned by planRender. Returns
 * the file's samples per channel, views into the render.
 */
async function renderTracks(
  opts: RenderOptions,
  tracks: Track[],
  onProgress?: (fraction: number) => void
): Promise<{ channels: Float32Array<ArrayBuffer>[]; sampleRate: number; reverbImpulse: AudioBuffer | undefined }> {
  const { clips, bpm, swing, startBar, endBar, masterFx, signal } = opts;
  const ending = opts.ending ?? 'ringOut';
  const plan = planRender(opts, opts.bypassMaster ? 0 : await masterChainLatency(opts.sampleRate ?? DEFAULT_SAMPLE_RATE));
  const { sampleRate, length } = plan;
  if (plan.keepLength < 1) throw new Error('the range is empty');
  const duration = length / sampleRate;
  signal?.throwIfAborted();
  // Read live state before the global context is swapped
  const masterDb = opts.ignoreMasterVolume ? 0 : getMasterVolume();

  // Download any sampled instruments first (shared with live playback, so usually instant)
  for (const key of new Set(tracks.map((t) => t.instrumentKey))) {
    if (!hasRecordings(key)) continue;
    try {
      await loadSamples(key);
    } catch {
      throw new Error(`couldn't download the ${INSTRUMENTS[key].name} samples. Check your internet connection and try again.`);
    }
    signal?.throwIfAborted();
  }
  // ...and the sounds this render plays (audio clips, Slicer and Sampler tracks), at its sample rate
  await loadSounds(tracks, clips, startBar, endBar, sampleRate);
  signal?.throwIfAborted();

  const original = Tone.getContext();
  // A native OfflineAudioContext, not Tone's default standardized-audio-context wrapper: the
  // wrapper only builds the real audio graph when rendering starts, so notes created while
  // the render is suspended would never be heard. Native nodes join the live graph at once.
  const native = new OfflineAudioContext(2, length, sampleRate);
  const context = new Tone.OfflineContext(native);
  finishedSources.set(context, []);
  let graph: Awaited<ReturnType<typeof buildGraph>>;
  Tone.setContext(context);
  try {
    graph = await buildGraph(context);
  } catch (err) {
    finishedSources.delete(context);
    throw err;
  } finally {
    Tone.setContext(original);
  }
  // After a cancel: schedule nothing more, and free the graph so the rest of the render (which
  // an OfflineAudioContext can't stop early) runs on silence and finishes at once
  const release = () => {
    graph.dispose();
    finishedSources.get(context)?.forEach((source) => source.disposed || source.dispose());
    finishedSources.delete(context);
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
  context.lookAhead = 2 * quantum;
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
      void native.suspend(at).then(() => {
        try {
          if (signal?.aborted) {
            release();
            return;
          }
          disposeFinishedSources(context, at);
          const next = at + RENDER_STEP;
          if (next < lastSuspend) {
            advanceClock(next + SCHEDULE_LEAD);
            stepAt(next);
          } else {
            advanceClock(duration);
          }
          onProgress?.(at / duration);
        } finally {
          // Never leave the render suspended, or it would hold its memory forever
          void native.resume();
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
  const rendered = await abortable(
    native.startRendering().finally(() => {
      signal?.removeEventListener('abort', release);
      finishedSources.delete(context);
    }),
    signal
  );
  onProgress?.(1);

  if (ending === 'seamless') {
    // The render ran the pass before straight into the kept one. So that the file's end leads
    // into its start exactly as that pass led into this one, the last 10 ms crossfade into the
    // end of the pass before. Passes aren't sample-for-sample repeats (free-running chorus and
    // filter sweeps, voices whose phase depends on what they played before), so without this
    // the wrap from the last sample to the first could click.
    const fade = Math.min(Math.round(SEAM_FADE_SECONDS * sampleRate), plan.keepLength);
    const end = plan.keepFrom + plan.keepLength;
    for (const ch of channelsOf(rendered)) {
      for (let i = end - fade; i < end; i++) {
        const w = (i - (end - fade) + 1) / fade;
        ch[i] += (ch[i - plan.keepLength] - ch[i]) * w;
      }
    }
  }
  // Cut to the sample: the file starts where the range start comes out (a seamless loop's last pass)
  const channels = channelsOf(rendered).map((ch) => ch.subarray(plan.keepFrom, plan.keepFrom + plan.keepLength));
  if (ending === 'exact' && !opts.noEndFade) fadeOut(channels, Math.round(EXACT_FADE_SECONDS * sampleRate));
  return { channels, sampleRate, reverbImpulse: graph.reverbImpulse() };

  /** Mix chain, one strip + instrument per track, and the Transport, inside the offline context. */
  async function buildGraph(context: Tone.OfflineContext) {
    context.destination.volume.value = masterDb;
    const mix = createMixChain(context.destination, masterFx, bpm, opts.master);
    if (opts.bypassMaster) {
      // The bus straight to the output (master volume still applies, as it's a plain gain)
      mix.bus.disconnect();
      mix.bus.connect(context.destination);
      mix.inserts.dispose();
      mix.compressor.dispose();
      mix.limiter.dispose();
      mix.ceiling.dispose();
    }

    const strips: TrackStrip[] = [];
    const stripOf = new Map<string, TrackStrip>();
    const instruments = new Map<string, TrackInstrument>();
    for (const track of tracks) {
      const strip = createTrackStrip(mix.bus, mix.busFx);
      strip.apply(track, { ramp: 0, muteOverride: false });
      if (opts.intensity) strip.setIntensityLevel(trackIntensityLevel(track, opts.intensity.curves, opts.intensity.value));
      strips.push(strip);
      stripOf.set(track.id, strip);
      instruments.set(track.id, createInstrument(track.instrumentKey, strip.input, { sample: track.sample, slicer: track.slicer, synth: track.synth }));
    }
    await Promise.all([mix.busFx.ready, mix.inserts.ready(), ...[...instruments.values()].map((i) => i.ready)]);
    // Tone.Reverb keeps its impulse response on a native ConvolverNode (set by the time it's ready)
    const convolver = (mix.busFx.reverb as unknown as { _convolver: ConvolverNode })._convolver;
    if (opts.reverbImpulse?.sampleRate === sampleRate) convolver.buffer = opts.reverbImpulse;

    const transport = context.transport;
    transport.bpm.value = bpm;
    transport.loop = ending === 'seamless';
    if (transport.loop) {
      transport.loopStart = `${barToTicks(startBar)}i`;
      transport.loopEnd = `${barToTicks(endBar)}i`;
    }
    // Pumps that follow the kick hear every kick of the drum kits that sound, including ones this
    // render leaves out (a stem): those tracks' notes are scheduled, but play no instrument
    const kickTracks = audibleTracks(opts.tracks).filter((t) => isDrumKind(t.instrumentKey));
    const kickIds = new Set(kickTracks.map((t) => t.id));
    const pumpOnKick = (trackId: string, time: number) => {
      if (kickIds.has(trackId)) strips.forEach((s) => s.pump(time, 'kick'));
    };
    // Pumps that follow a track hear its notes even when this render leaves it out (a stem)
    const sourceIds = new Set(strips.map((s) => s.pumpSource()).filter((id): id is string => !!id));
    const pumpOnTrack = sourceIds.size ? (trackId: string, time: number) => sourceIds.has(trackId) && strips.forEach((s) => s.pump(time, 'track', trackId)) : undefined;
    const schedule = createClipSchedule(transport, (trackId) => instruments.get(trackId), pumpOnKick, () => swing, pumpOnTrack);
    const followsKick = strips.some((s) => s.pumpTrigger() === 'kick');
    const extra = [...(followsKick ? kickTracks : []), ...opts.tracks.filter((t) => sourceIds.has(t.id))].filter((t, i, all) => !instruments.has(t.id) && all.indexOf(t) === i);
    schedule.update([...tracks, ...extra], clips);
    const pumpClock = createPumpClock(transport, () => strips, barToTicks(startBar), barToTicks(endBar));
    pumpClock.update();
    // Audio clips play their sound files on the same Transport, from the right place in them
    // wherever the range begins (see audioClipSchedule.ts)
    const audioClips = createAudioClipSchedule(transport, (trackId) => instruments.get(trackId)?.clipBus);
    audioClips.update(tracks, clips);
    // Automated settings start at their lanes' values at the range start, set before the render
    // begins, and follow the lanes from when the Transport starts
    const automation = createAutomationSchedule(transport, (trackId) => stripOf.get(trackId), { holdGlide: 0 });
    automation.hold(startBar);
    automation.update(tracks);
    transport.start(plan.startAt, `${barToTicks(startBar)}i`);
    // Stop at endBar (after the last pass of a seamless loop): the render runs on for the
    // tail, and notes after endBar (the rest of the song, past a loop region's Out) must not
    // play into it
    transport.stop(plan.stopAt);

    return {
      reverbImpulse: () => convolver.buffer ?? undefined,
      dispose: () => {
        schedule.dispose();
        audioClips.dispose();
        pumpClock.dispose();
        automation.dispose();
        instruments.forEach((i) => i.dispose());
        strips.forEach((s) => s.dispose());
        mix.busFx.dispose();
        mix.inserts.dispose();
        [mix.bus, mix.compressor, mix.limiter, mix.ceiling, mix.auditionInput].forEach((n) => n.disposed || n.dispose());
      },
    };
  }
}

/**
 * Decode every sound a render plays, at its sample rate, before its graph is built: the sounds of
 * the audio clips in the range and of the Slicer and Sampler tracks. A Sampler from a project not
 * yet converted still carries its sound as a data: URL, decoded in the live context as before.
 */
async function loadSounds(tracks: Track[], clips: Clip[], startBar: number, endBar: number, sampleRate: number): Promise<void> {
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
  for (const [id, label] of needed) {
    try {
      await decodeSound(id, sampleRate);
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

function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak;
}

/**
 * Tone.Limiter has no lookahead, so transients can overshoot 0 dBFS. Exports are scaled
 * down (never up) so they peak just under full scale instead of clipping. Float WAVs get the
 * same treatment: most players and game engines clip them at full scale anyway.
 */
const peakGain = (peak: number) => (peak > PEAK_CEILING ? PEAK_CEILING / peak : 1);

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

export function encodeChannels(
  data: Float32Array[],
  sampleRate: number,
  bitDepth: BitDepth,
  cues: readonly WavCue[] = [],
  /** Frames [start, end) the file loops (written as a 'smpl' chunk). */
  loop?: { start: number; end: number }
): Blob {
  const channels = data.length;
  const frames = data[0].length;
  const float = bitDepth === 32;
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = frames * blockAlign;
  // Float WAVs need the extended 18-byte format chunk and a fact chunk (the frame count)
  const formatSize = float ? 18 : 16;
  const headerSize = 12 + 8 + formatSize + (float ? 12 : 0) + 8;
  // Chunks after the audio (readers that expect the audio straight after the header still find
  // it there). A chunk of odd length is padded to an even one before the next.
  const cueBytes = cueChunks(cues);
  const loopBytes = loop ? loopChunk(sampleRate, loop.start, loop.end) : new Uint8Array(0);
  const trailer = new Uint8Array(cueBytes.length + loopBytes.length);
  trailer.set(cueBytes);
  trailer.set(loopBytes, cueBytes.length);
  const pad = trailer.length ? dataSize & 1 : 0;
  const view = new DataView(new ArrayBuffer(headerSize + dataSize + pad + trailer.length));

  let offset = 0;
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const u16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };

  text('RIFF');
  u32(headerSize - 8 + dataSize + pad + trailer.length);
  text('WAVE');
  text('fmt ');
  u32(formatSize);
  u16(float ? 3 : 1); // WAVE_FORMAT_IEEE_FLOAT or WAVE_FORMAT_PCM
  u16(channels);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(bitDepth);
  if (float) {
    u16(0); // no extension
    text('fact');
    u32(4);
    u32(frames);
  }
  text('data');
  u32(dataSize);

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      if (float) {
        view.setFloat32(offset, data[c][i], true);
        offset += 4;
        continue;
      }
      const s = Math.max(-1, Math.min(1, data[c][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
        offset += 2;
      } else {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  new Uint8Array(view.buffer).set(trailer, offset + pad);
  return new Blob([view], { type: 'audio/wav' });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
