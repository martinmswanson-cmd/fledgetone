/**
 * The mixer channel each track plays through: its inserts (in the order listed on TrackStrip), a
 * stereo balance pan, solo and mute, the fader, and post-fader sends to the shared reverb and
 * delay and to return tracks. An insert exists only while it's switched on, so idle effects cost
 * nothing. Also the Pump's beat clock (createPumpClock).
 */
import * as Tone from 'tone';
import type { AutomationParam, GateRate, PumpTrigger, Track } from '../../store/timelineTypes';
import { GATE_TICKS } from '../../store/timelineTypes';
import { activeLanes, parseParam, specOf } from '../automation';
import { roomSendLevel } from './distance';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { BusEffects } from './busEffects';
import { createEcho, createReverb, type EchoUnit, type ReverbUnit } from './spaceFx';
import { createMonoBass, createSaturation, type MonoBassInsert, type SaturationInsert } from './busInserts';
import { createParamWriter, type AutomationTarget, type ParamWriter } from './paramWriter';
import { smoothSet } from './smoothParam';
import { createDelayLink, fixedDelay, glidingDelay, type DelayLink } from './delayLink';
import { glideAt, planGlide, type Glide } from '../delayGlide';
import type { PathDelays } from '../delayCompensation';
import { createBassDrive, type BassDriveUnit } from './bassDrive';
import {
  atControlTime,
  createLightChorus,
  createLightDistortion,
  createLightEq3,
  createLightMbc,
  createLightPeq,
  peqActiveBands,
  type LightMbc,
  type LightPeq,
  createLightFilter,
  createLightGate,
  createLightLofi,
  createLightPump,
  type LightChorus,
  type LightGate,
  type LightLofi,
  type LightDistortion,
  type LightEq3,
  type LightFilter,
  type LightPump,
} from './lightFx';

/**
 * One mixer channel per track:
 *   input -> Distortion -> Bass Drive -> EQ3 -> Pro EQ -> Compressor -> makeup gain -> Multiband
 *         -> Saturation -> Chorus -> Lo-fi -> Filter -> Delay -> Reverb -> Gate
 *         -> Pump -> (Volume lane) -> Mono bass -> (alignment delay) -> solo -> pan -> fader -> level (Intensity, mute)
 *   level -> duck -> (dry delay) -> master bus, plus post-fader sends to the shared reverb and
 *   delay; sends to returns (each with its own delay, when it needs one) after the pan or the duck.
 *
 * The three delays are delay compensation (see delayCompensation.ts and setAlignment): each
 * exists only while it holds the sound back, and a change glides (see delayLink.ts).
 *
 * An insert only exists while it's switched on (the EQ while any band is boosted or cut).
 * A bypassed insert is disposed and patched out of the chain rather than left running at
 * wet 0: Web Audio keeps processing every connected node, and a full set of idle inserts
 * cost more CPU than the instruments, so a dozen tracks could starve live playback. The
 * distortion, EQ, chorus, filter and pump are lean nodes (see lightFx.ts), for the same reason.
 * The Filter sits late so a sweep shapes everything before it; the Pump is last so it ducks the
 * whole sound.
 *
 * The channel is stereo. Tone.Channel's panner folds whatever reaches it to mono first, so a
 * Supersaw's spread, a chorus or a stereo sample lost its width at the strip. The pan here is a
 * balance made of two of those same mono panners, one per side: the left one pans the left
 * channel and keeps its left output; the right one pans the right channel at the mirror-image
 * position, so its left output is the right side's share. Each side gets the equal-power gain
 * Tone.Channel gave a mono source (-3 dB at the centre), sample for sample, ramps included. So a
 * mono source (spread to both sides first) pans exactly as before, and a stereo one keeps its
 * width while the pan turns down the side it moves away from. The synthesized drum kits are
 * folded to mono at the end of the inserts, where that panner used to fold them: their noise is
 * stereo, but they were voiced hearing it folded, and their inserts heard it in stereo.
 *
 * Automation: while a lane with points owns a setting, apply() leaves that setting to the lane
 * (automationSchedule.ts writes it) and puts the track's own value back when the lane goes. Pan,
 * the sends, the Filter and the EQ bands are native params that only ever change through a
 * ParamWriter, whoever moves them. A Volume lane gets a gain of its own at the end of the
 * inserts, made only while that lane exists, with the fader held at 0 dB: the fader also
 * carries Tone's mute, so a lane writing it directly would fight that.
 */
export interface TrackStrip {
  /** Instruments connect here. */
  input: Tone.InputNode;
  apply: (track: Track, opts?: { ramp?: number; muteOverride?: boolean }) => void;
  /** What the Pump follows, or null while it's off. */
  pumpTrigger: () => PumpTrigger | null;
  /** A `source` trigger at `time`: the Pump ducks if it follows that source (for 'track', the notes of `fromTrack`). */
  pump: (time: number, source: PumpTrigger, fromTrack?: string) => void;
  /** The track a 'track'-triggered Pump follows, or null. */
  pumpSource: () => string | null;
  /** The Gate's speed, or null while it's off. */
  gateRate: () => GateRate | null;
  /**
   * The clock's 8th at Transport tick `tick` plays at `time`: chop the Gate for the steps that start
   * in it (`windowTicks` long), at `secondsPerTick`.
   */
  gate: (time: number, tick: number, windowTicks: number, secondsPerTick: number) => void;
  /**
   * What a lane for `param` drives, or null while it can't sound (its Filter is off) or no lane
   * owns it (as of the last apply()).
   */
  automationTargets: (param: AutomationParam) => AutomationTarget[] | null;
  /** Changes whenever automationTargets() might answer differently (an insert came or went, the Filter changed type...). */
  automationVersion: () => number;
  /** The duck gain's writer (a gain, 1 = full level), for ducking under a proxy track. */
  duckTarget: () => AutomationTarget;
  /** The Intensity level (0 to 1), gliding there over `ramp` seconds (0: at once). */
  setIntensityLevel: (gain: number, ramp?: number) => void;
  /** The level after the fader (for the mixer's meters): peak 0..1 since the last call, built on first use. */
  peak: () => number;
  /** The track's spectrum now, in dB per bin, into `out` (at least 2048 long); returns the bin count. Built on first use. */
  spectrum: (out: Float32Array) => number;
  /** The multiband compressor's gain reduction per band now (dB), or null when it's off. */
  mbcReduction: () => [number, number, number] | null;
  /** The song's tempo, which the Delay insert's echoes follow. */
  setTempo: (bpm: number) => void;
  /** Play into `target` (a bus track's strip input) instead of where it plays now (the master bus at first). */
  setOutput: (target: Tone.InputNode) => void;
  /**
   * Put the channel to sleep, or wake it (live only). Asleep, it's cut off from everything after
   * it, so the audio thread doesn't run it or its instrument: for a track with nothing to play for
   * a while (see liveTracks.ts). Only for a channel that is silent: anything still ringing is cut.
   */
  sleep: (asleep: boolean) => void;
  /**
   * Its sends to return tracks: each to `target` (the return's input) at `level`, taken after the
   * fader or (`pre`) before it. Sends not named go; a level changes smoothly. `muted`: the track
   * is muted (a pre-fader send goes quiet with it).
   */
  setSends: (sends: ReadonlyArray<{ id: string; target: Tone.InputNode; level: number; pre: boolean }>, muted: boolean) => void;
  /**
   * Delay compensation (see delayCompensation.ts), in frames: `tail` after the inserts (before the
   * sends are taken), `dry` on the way out, `sends` on each send to a return. Null: none. A change
   * crossfades while playing.
   */
  setAlignment: (delays: PathDelays | null) => void;
  /** A send's level param, for its automation lane (null if it has no such send). */
  sendTarget: (returnId: string) => AutomationTarget | null;
  /**
   * Where lanes of the track's plugin parameters go: `set` a parameter (0 to 1 of its range) at a
   * time. Until it's given (or while the plugin is loading) those lanes wait.
   */
  setPluginParams: (set: ((pluginId: string, paramId: string, value: number, time: number) => boolean) | null) => void;
  dispose: () => void;
}

/** The volume of a fader pulled all the way down: a gain of 1e-10, far below hearing. */
const FADER_SILENT_DB = -200;
/** How long a Volume lane takes to hand the level back to the fader when it goes. */
const VOLUME_HANDBACK = 0.03;

/** One connection of the chain, from a node's output to the next one's input. */
type Link = [from: Tone.ToneAudioNode | AudioNode, to: Tone.ToneAudioNode | AudioNode];

/** An insert in the chain: where the signal goes in and where it comes out. */
interface Insert {
  input: Tone.ToneAudioNode | AudioNode;
  output: Tone.ToneAudioNode | AudioNode;
}

/** An insert that can be disposed. */
interface Unit extends Insert {
  dispose: () => void;
}

/**
 * A link of the live chain of inserts, made through a gain of its own so that it can be faded in
 * and out on the audio clock (see rewire).
 */
interface Gate {
  link: Link;
  gain: GainNode;
  /** Its last fade: from `from` at `start` to `to` at `end` (audio clock). */
  fade: { from: number; to: number; start: number; end: number };
  /** In the chain; else it's on its way out, to be taken apart once its fade has played. */
  wanted: boolean;
}

/**
 * Read a DelayNode's delay time once per render block, not per sample (its delay never moves). Live,
 * the node is standardized-audio-context's wrapper, whose params don't pass automationRate on, so
 * it's set on the native node the wrapper keeps; if that's missing it just stays per-sample.
 */
function blockRateDelay(node: DelayNode): void {
  const native = (node as DelayNode & { _nativeAudioNode?: DelayNode })._nativeAudioNode ?? node;
  try {
    native.delayTime.automationRate = 'k-rate';
  } catch {
    // A browser without automationRate: per-sample it is
  }
}

/**
 * How long after a switch the crossfade to the new chain starts. The fades are all set by then
 * (in a few microseconds), whatever the main thread does next. A fresh Distortion's oversampling
 * holds back its first 2 ms, which this covers too.
 */
const SWITCH_LEAD = 0.02;
/** The crossfade from the old chain of inserts to the new one. */
const SWITCH_FADE = 0.01;
/**
 * How long a fresh Compressor takes to sound as it will: a browser compressor passes nothing for
 * its 6 ms look-ahead and then brings its gain up from nothing over about 0.2 s.
 */
const COMPRESSOR_WARM_UP = 0.2;

/** A gain that folds whatever comes in to mono (the average of its sides), for the drum kits. */
function createMonoFold(): Unit {
  const fold = new Tone.Gain(1);
  fold.channelCount = 1;
  fold.channelCountMode = 'explicit';
  fold.channelInterpretation = 'speakers';
  return { input: fold, output: fold, dispose: () => fold.dispose() };
}

/** An equal-power panner for one channel (`discrete`: of a stereo input it takes the first). */
function monoPanner(raw: BaseAudioContext, interpretation: ChannelInterpretation): StereoPannerNode {
  const panner = raw.createStereoPanner();
  panner.channelCount = 1;
  panner.channelCountMode = 'explicit';
  panner.channelInterpretation = interpretation;
  return panner;
}

export function createTrackStrip(bus: Tone.InputNode, busFx: BusEffects): TrackStrip {
  const input = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  // A delay of nothing, which passes the sound through sample for sample. It is here for the live
  // context's standardized-audio-context, which on every connect walks every path downstream of
  // it looking for loops, and stops only at a DelayNode. Every note connects new nodes, and each
  // walk went on through the strip, the sends and the master chain: a fifth of the main thread
  // while a dense song played. Stopped here, a note's walk covers only its own instrument. With
  // its delay time fixed per render block it costs about what a gain does. (The WAV export's
  // native context does no such walking, so there the strip starts at its input.)
  const barrier = typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext ? null : raw.createDelay(0.01);
  if (barrier) {
    blockRateDelay(barrier);
    input.connect(barrier);
  }
  /** Where the chain of inserts starts. */
  const head = barrier ?? input;
  const solo = new Tone.Solo();
  // A mono source becomes the same sound on both sides here, for the pan to take apart
  solo.channelCount = 2;
  solo.channelCountMode = 'explicit';
  const fader = new Tone.Volume(0);
  const reverbSend = new Tone.Gain(0);
  const delaySend = new Tone.Gain(0);

  // The pan (see above), between the solo and the fader. Each input of the merge keeps only the
  // first channel of what comes in: the left panner's left output, the right panner's left output.
  const left = monoPanner(raw, 'discrete');
  const right = monoPanner(raw, 'speakers');
  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  merge.channelInterpretation = 'discrete';
  Tone.connect(solo, left);
  Tone.connect(solo, split);
  split.connect(right, 1);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  Tone.connect(merge, fader);
  /**
   * Distance (Track.distance): set back on the stage, a part loses some top (a high shelf), comes
   * through a little quieter, and more of it reaches the hall (see apply). Made the first time a
   * track is set back, between the pan and the fader; a track never set back has none of it.
   */
  let far: { shelf: BiquadFilterNode; trim: GainNode } | null = null;
  /** The distance as last applied: its extra reverb send is added to a Reverb send lane's values too */
  let distanceNow = 0;
  const setDistance = (distance: number, ramp: number) => {
    if (distance <= 0 && !far) return;
    if (!far) {
      const shelf = raw.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 4500;
      shelf.gain.value = 0;
      const trim = raw.createGain();
      Tone.disconnect(merge, fader);
      merge.connect(shelf).connect(trim);
      Tone.connect(trim, fader);
      far = { shelf, trim };
    }
    const at = raw.currentTime;
    const tc = Math.max(0.001, ramp / 3);
    smoothSet(far.shelf.gain, -9 * distance, at, tc);
    smoothSet(far.trim.gain, 10 ** ((-2.5 * distance) / 20), at, tc);
  };

  // Intensity (see intensity.ts): the track's stem-group level, after the fader and before the
  // sends. Mute is here too (the level times 0 or 1), gliding like any other control: Tone's own
  // mute on the fader jumped to silence and back, a click on a track that was sounding.
  const level = new Tone.Gain(1);
  let intensity = 1;
  let muted = false;
  /** Glide the level to the Intensity times the mute, over about `ramp` seconds (0: at once). */
  const writeLevel = (ramp: number) => smoothSet(level.gain, muted ? 0 : intensity, now(), ramp / 3);
  // Ducking under a dialogue / SFX proxy track (see duck.ts), played by the automation schedule
  const duck = new Tone.Gain(1);
  fader.connect(level);
  level.connect(duck);
  /** Where the strip plays into: the master bus, or a bus track's strip (setOutput) */
  let output: Tone.InputNode = bus;
  /** Into it, held back by the dry part of the track's delay compensation (see setAlignment) */
  const dryLink = createDelayLink(duck, bus);
  // The mixer's meter's samples (see peak)
  const meterData = new Float32Array(512);
  reverbSend.connect(busFx.reverbInput);
  /** Sends to return tracks, by return id (see setSends) */
  const sends = new Map<
    string,
    { gain: Tone.Gain; writer: ParamWriter; target: Tone.InputNode; pre: boolean; link: ((need: boolean, ramp: number) => void) & { forget: () => void }; out: DelayLink }
  >();
  /** Delay compensation (see setAlignment): the tail's delay line in the chain, and the sends' delays by return id, in seconds */
  let tailDelay: { input: DelayNode; output: DelayNode; seconds: number; glide?: Glide; dispose: () => void } | null = null;
  let tailTimer = 0;
  let sendDelays: Record<string, number> = {};
  delaySend.connect(busFx.delayInput);

  /**
   * Asleep (live only; see sleep): nothing goes out of the strip (to its output, its sends, its
   * meters), so the audio thread leaves the whole channel and the instrument feeding it alone.
   */
  let awake = true;
  /** Every send link, to cut while asleep and join again on waking */
  const linkSyncs = new Set<(ramp: number) => void>();
  /**
   * A send link that exists only while something goes through it. A send at 0 (most of them: a
   * track sends to one or two effects, if any) still processes every render block and keeps the
   * effect it feeds busy, and every node costs the audio thread time however little it does. So a
   * send is joined to the track only while it's turned up or a lane owns it: turned up, it's joined
   * first (still at 0) and then ramps; turned down to 0, it ramps to silence and is cut once that has
   * played. In an export (set up once, before anything plays) it's simply joined or not.
   */
  const sendLink = (from: Tone.ToneAudioNode | AudioNode, to: Tone.Gain) => {
    let want = false;
    let joined = false;
    let timer = 0;
    const sync = (ramp: number) => {
      window.clearTimeout(timer);
      // Asleep (see sleep), nothing is joined; it's joined again on waking if still wanted
      const need = want && awake;
      if (need && !joined) {
        Tone.connect(from, to);
        joined = true;
      } else if (!need && joined) {
        const cut = () => {
          try {
            Tone.disconnect(from, to);
          } catch {
            // Already apart (the send was let go)
          }
          joined = false;
        };
        if (!barrier || !awake) cut();
        else timer = window.setTimeout(cut, (ramp + 0.05) * 1000 + 50);
      }
    };
    linkSyncs.add(sync);
    const set = (need: boolean, ramp: number) => {
      want = need;
      sync(ramp);
    };
    return Object.assign(set, { forget: () => linkSyncs.delete(sync) });
  };
  const reverbLink = sendLink(duck, reverbSend);
  const delayLink = sendLink(duck, delaySend);

  /**
   * An analyser read by the screen (the mixer's meter, the EQ's spectrum): joined when first read
   * and let go a second after the last read, so a track nobody is looking at doesn't feed one.
   */
  /** Let go of the screen's analysers (asleep, nothing reaches them) */
  const taps = new Set<() => void>();
  const screenTap = (fftSize: number, smoothing?: number) => {
    let node: AnalyserNode | null = null;
    let lastRead = 0;
    let timer = 0;
    const check = () => {
      if (!node) return;
      if (performance.now() - lastRead < 1000) {
        timer = window.setTimeout(check, 500);
        return;
      }
      try {
        Tone.disconnect(duck, node);
      } catch {
        // The strip was let go
      }
      node = null;
      timer = 0;
    };
    taps.add(() => {
      if (!node) return;
      try {
        Tone.disconnect(duck, node);
      } catch {
        // The strip was let go
      }
      node = null;
    });
    return (): AnalyserNode => {
      lastRead = performance.now();
      if (!node) {
        node = raw.createAnalyser();
        node.fftSize = fftSize;
        if (smoothing !== undefined) node.smoothingTimeConstant = smoothing;
        duck.connect(node as unknown as Tone.InputNode);
      }
      if (!timer) timer = window.setTimeout(check, 500);
      return node;
    };
  };
  const meterTap = screenTap(512);
  const spectrumTap = screenTap(4096, 0.75);

  let distortion: LightDistortion | null = null;
  let bassDrive: BassDriveUnit | null = null;
  let eq: LightEq3 | null = null;
  let peq: LightPeq | null = null;
  let mbc: LightMbc | null = null;
  /** The bus inserts (busInserts.ts): Saturation after the dynamics, Mono bass at the end of the inserts. */
  let saturate: SaturationInsert | null = null;
  let monoLow: MonoBassInsert | null = null;
  let compressor: Tone.Compressor | null = null;
  let makeup: Tone.Gain | null = null;
  /** The Compressor and its makeup gain as one insert. */
  let compressorUnit: Unit | null = null;
  /** When the Compressor will have warmed up, on the audio clock (live; see rewire). */
  let compressorReady = 0;
  let chorus: LightChorus | null = null;
  let filter: LightFilter | null = null;
  let pump: LightPump | null = null;
  let pumpTrigger: PumpTrigger | null = null;
  let pumpSource: string | null = null;
  let lofi: LightLofi | null = null;
  let echo: EchoUnit | null = null;
  let reverb: ReverbUnit | null = null;
  /** The tempo the Delay follows, and its settings as last applied. */
  let tempo = 120;
  let echoSettings: Track['fx']['echo'] | null = null;
  let gateUnit: LightGate | null = null;
  let gateRate: GateRate | null = null;
  /** The drum kits' fold to mono, after the other inserts (see above). */
  let fold: Unit | null = null;
  /** The inserts currently patched in, in signal order. */
  let chain: Insert[] = [];
  /** Live, the links of the chain (and those still fading out), each through its own gain. */
  let gates: Gate[] = [];
  /** Inserts switched off, disposed once they have faded out. */
  let leaving: Array<{ dispose: () => unknown }> = [];
  let tidyTimer = 0;

  const now = () => input.context.now();
  const writer = (param: Tone.Param<any>, initial: number) =>
    createParamWriter(param.input as AudioParam, { raw, now, initial });
  const panLeft = createParamWriter(left.pan, { raw, now, initial: 0 });
  // At the mirror-image position (see above)
  const panRight = createParamWriter(right.pan, { raw, now, initial: 0 });
  const reverbWriter = writer(reverbSend.gain, 0);
  const duckWriter = writer(duck.gain, 1);
  const delayWriter = writer(delaySend.gain, 0);
  /** The Volume lane's own gain, and its writer: only while a Volume lane owns the level. */
  let laneGain: { node: Tone.Gain; writer: ParamWriter } | null = null;
  /** Settings lanes own, as of the last apply(). */
  let owned = new Set<AutomationParam>();
  let version = 0;
  /**
   * Lanes of settings that aren't a single native param (an insert's settings, a plugin's
   * parameters), by lane: the scheduler writes each into a writer of no param of its own, and on
   * every tick of the clock (20 a second live, every render block in an export) the value due next
   * is handed on. `value` is the last one handed on (null: none yet). See controlTick.
   */
  const controls = new Map<AutomationParam, { writer: ParamWriter; value: number | null; apply: (v: number, at: number, ramp: number) => boolean }>();
  /** The track's effect settings as last applied, before lanes override any (see effective). */
  let baseFx: Track['fx'] | null = null;
  /** The track as last applied. */
  let lastTrack: Track | null = null;
  let pluginSink: ((pluginId: string, paramId: string, value: number, time: number) => boolean) | null = null;
  let controlListening = false;
  /** Until this (Tone) time the fader and the Volume lane's gain are trading places: leave the fader be. */
  let handoverUntil = -Infinity;
  /** The Volume lane's gain is handing the level back and will be patched out. */
  let retiring = false;
  let retireTimer = 0;
  /** The fader level the channel plays at, in dB. */
  const faderDb = (track: Track) => (track.volume <= -60 ? FADER_SILENT_DB : track.volume);

  /** The connections of a chain of inserts, from the head to the solo. */
  const linksOf = (inserts: Insert[]): Link[] => {
    const links: Link[] = [];
    let from: Tone.ToneAudioNode | AudioNode = head;
    for (const ins of inserts) {
      links.push([from, ins.input]);
      from = ins.output;
    }
    links.push([from, solo]);
    return links;
  };
  const cut = (from: Link[0], to: Tone.InputNode) => {
    try {
      Tone.disconnect(from, to);
    } catch {
      // Not connected (any more): nothing to cut
    }
  };
  const sameLink = (a: Link, b: Link) => a[0] === b[0] && a[1] === b[1];
  /** When a switch of the inserts made now crossfades (see rewire): shortly, or once a fresh Compressor has warmed up. */
  const switchAt = () => Math.max(raw.currentTime + SWITCH_LEAD, compressorUnit ? compressorReady : 0);

  /** Make a live link (see rewire), open (`level` 1) or shut (0). */
  const gate = (link: Link, level: number) => {
    const gain = raw.createGain();
    gain.gain.value = level;
    Tone.connect(gain, link[1]);
    Tone.connect(link[0], gain);
    gates.push({ link, gain, fade: { from: level, to: level, start: 0, end: 0 }, wanted: true });
  };
  /**
   * Fade a link to `level` over SWITCH_FADE from `at`, starting from wherever its earlier fades
   * have it then. (cancelAndHoldAtTime() cuts short a fade still under way at `at`, but holds
   * nothing when none is: the new ramp would then start from the param's last event, long ago.)
   */
  const fadeTo = (g: Gate, level: number, at: number) => {
    const { from, to, start, end } = g.fade;
    const held = at >= end ? to : at <= start ? from : from + ((to - from) * (at - start)) / (end - start);
    if (held === level && at >= end) return;
    const param = g.gain.gain;
    param.cancelAndHoldAtTime(at);
    param.setValueAtTime(held, at);
    param.linearRampToValueAtTime(level, at + SWITCH_FADE);
    g.fade = { from: held, to: level, start: at, end: at + SWITCH_FADE };
  };
  // The chain starts empty, the head joined straight to the solo
  if (barrier) gate([head, solo], 1);
  else Tone.connect(head, solo);

  /** Take apart the links that have faded out, and dispose the inserts switched off. */
  const tidy = () => {
    // The fades are on the audio clock and this runs from the wall clock. While the page's audio
    // is suspended (a project opened before anything was played) the audio clock stands still,
    // and the old links went before the new ones had faded in: the first Play then started with
    // a gap on a track whose Compressor was still waiting to be heard. So wait for the clock.
    const fadesEnd = gates.reduce((end, g) => (g.wanted ? end : Math.max(end, g.fade.end)), 0);
    if (raw.currentTime < fadesEnd) {
      clearTimeout(tidyTimer);
      tidyTimer = window.setTimeout(tidy, Math.max(250, (fadesEnd - raw.currentTime) * 1000 + 50));
      return;
    }
    for (const g of gates) {
      if (g.wanted) continue;
      cut(g.link[0], g.gain);
      g.gain.disconnect();
    }
    gates = gates.filter((g) => g.wanted);
    leaving.forEach((insert) => insert.dispose());
    leaving = [];
  };

  /**
   * Patch head -> active inserts -> solo, only when the chain changed; `retired` are the inserts
   * switched off, disposed once they're out.
   *
   * An insert switched on or off while playing mustn't open a gap in the sound, or double it.
   * A link made or broken on the main thread takes effect whenever the audio thread next renders,
   * so joining up the new chain and breaking the old one in turn left the track silent (or
   * doubled) for the render blocks in between: 3 to 9 ms whenever a walk of the graph (live, by
   * standardized-audio-context, after every connection) or a pause for garbage collection fell
   * there. So live, every link of the chain goes through a gain of its own. A switch adds the new
   * links, silent; then, on the audio clock, crossfades from the old links to the new ones in
   * 10 ms; and takes the old ones apart once that has played. What the main thread does in
   * between can't be heard. A link into a fresh insert opens at once (nothing hears it until its
   * way out fades in), so the insert has filled up by then: a fresh Compressor is heard only once
   * it has warmed up, and the switch waits for it. (The live strip's gains at 1 pass the sound
   * through sample for sample. Offline nothing is playing while the strip is set up, so the
   * export's chain is joined up directly.)
   */
  const rewire = (retired: Array<{ dispose: () => unknown }> = []) => {
    leaving.push(...retired);
    const next: Insert[] = [];
    if (distortion) next.push(distortion);
    if (bassDrive) next.push(bassDrive);
    if (eq) next.push(eq);
    if (peq) next.push(peq);
    if (compressorUnit) next.push(compressorUnit);
    if (mbc) next.push(mbc);
    if (saturate) next.push(saturate);
    if (chorus) next.push(chorus);
    if (lofi) next.push(lofi);
    if (filter) next.push(filter);
    if (echo) next.push(echo);
    if (reverb) next.push(reverb);
    if (gateUnit) next.push(gateUnit);
    if (pump) next.push(pump);
    if (laneGain) next.push({ input: laneGain.node, output: laneGain.node });
    if (monoLow) next.push(monoLow);
    if (fold) next.push(fold);
    if (tailDelay) next.push(tailDelay);
    const unchanged = next.length === chain.length && next.every((ins, i) => ins.input === chain[i].input && ins.output === chain[i].output);
    const before = linksOf(chain);
    const links = linksOf(next);
    chain = next;
    if (unchanged) {
      // (Nothing to wait for unless an earlier switch is still fading)
      if (!gates.some((g) => !g.wanted)) tidy();
      return;
    }
    if (!barrier) {
      before.filter((link) => !links.some((l) => sameLink(l, link))).forEach(([from, to]) => cut(from, to));
      links.filter((link) => !before.some((l) => sameLink(l, link))).forEach(([from, to]) => Tone.connect(from, to));
      tidy();
      return;
    }

    // The new links, silent unless they feed a fresh insert
    const fed = new Set(gates.map((g) => g.link[1]));
    for (const link of links) if (!gates.some((g) => sameLink(g.link, link))) gate(link, fed.has(link[1]) ? 0 : 1);
    // Then, all at once on the audio clock, the new links fade in and the old ones into what
    // stays fade out. (Links into inserts on their way out are left alone: they are only heard
    // through those inserts' own links out, which fade.)
    const at = switchAt();
    const staying = new Set(links.map((link) => link[1]));
    for (const g of gates) {
      g.wanted = links.some((link) => sameLink(g.link, link));
      if (g.wanted || staying.has(g.link[1])) fadeTo(g, g.wanted ? 1 : 0, at);
    }
    // And once that has played, the old ones go
    clearTimeout(tidyTimer);
    tidyTimer = window.setTimeout(tidy, (at + SWITCH_FADE - raw.currentTime) * 1000 + 50);
  };

  /**
   * Ramp a param, or set it outright when ramp is 0 (offline setup, or an insert that was just
   * created). Always a linear ramp: rampTo() goes exponential for decibel params, which can't
   * reach 0 dB (the compressor threshold's ceiling) and throws.
   */
  const set = (param: Tone.Param<any> | Tone.Signal<any>, value: number, ramp: number) => {
    if (ramp > 0) param.linearRampTo(value, ramp);
    else param.value = value;
  };

  /**
   * A Volume lane takes the level over: from `at`, the fader goes to 0 dB and the lane's
   * gain to the fader's level in the same instant, so nothing changes until the lane moves it.
   * A new lane's gain is patched in first (at 1, so that changes nothing either), so the two
   * trade places only once it's in.
   */
  const takeVolume = (track: Track, muted: boolean, ramp: number) => {
    clearTimeout(retireTimer);
    retiring = false;
    if (!laneGain) {
      const node = new Tone.Gain(1);
      laneGain = { node, writer: writer(node.gain, 1) };
      version++;
    } else if (handoverUntil > now()) {
      // Taken back before a hand-back finished: the fader is still at 0 dB, so just drop the rest
      // of the hand-back; the lane carries on from wherever its gain has got to
      laneGain.writer.cut(now());
      fader.volume.cancelScheduledValues(now());
      handoverUntil = -Infinity;
      return;
    }
    if (muted || ramp === 0) {
      // Silent anyway (or not yet playing): no need to line the two up
      set(fader.volume, 0, ramp);
      laneGain.writer.set(Tone.dbToGain(faderDb(track)), 0);
      return;
    }
    const at = laneGain.writer.jump(Tone.dbToGain(faderDb(track)), laneGain.writer.cut(Math.max(now(), switchAt() + SWITCH_FADE)));
    fader.volume.cancelScheduledValues(at);
    fader.volume.setValueAtTime(0, at);
    handoverUntil = at;
  };

  /** The Volume lane is gone: its gain glides to the fader's level, then fader and gain trade back and the gain goes. */
  const giveVolumeBack = (track: Track, muted: boolean, ramp: number) => {
    if (!laneGain) return;
    const lane = laneGain;
    retiring = true;
    let done: number;
    if (muted || ramp === 0) {
      set(fader.volume, faderDb(track), ramp);
      lane.writer.set(1, 0);
      done = now();
    } else {
      const from = lane.writer.cut(now());
      const glided = lane.writer.curve(new Float32Array([lane.writer.valueAt(from), Tone.dbToGain(faderDb(track))]), from, VOLUME_HANDBACK);
      done = lane.writer.jump(1, glided);
      fader.volume.cancelScheduledValues(done);
      fader.volume.setValueAtTime(faderDb(track), done);
      handoverUntil = done;
    }
    // Patched out once the hand-back has played
    clearTimeout(retireTimer);
    retireTimer = window.setTimeout(
      () => {
        if (laneGain !== lane || !retiring) return;
        laneGain = null;
        retiring = false;
        version++;
        rewire([lane.node]);
      },
      Math.max(0, done - raw.currentTime) * 1000 + 100
    );
  };

  /** Effect settings with the lanes' values in place of the track's own, for the settings lanes own. */
  const effective = (fx: Track['fx']): Track['fx'] => {
    let out = fx;
    for (const [param, c] of controls) {
      if (c.value === null) continue;
      const p = parseParam(param);
      if (p.kind !== 'fx') continue;
      const settings = (out[p.insert] ?? {}) as unknown as Record<string, unknown>;
      if (settings[p.field] === c.value) continue;
      if (out === fx) out = { ...fx };
      (out as unknown as Record<string, unknown>)[p.insert] = { ...settings, [p.field]: c.value };
    }
    return out;
  };

  /** Hand an insert's settings (with the lanes' values) to it, scheduled at `at`. */
  const applyInsert = (insert: keyof Track['fx'], at: number, ramp: number) => {
    if (!baseFx) return;
    const fx = effective(baseFx);
    atControlTime(at, () => {
      switch (insert) {
        case 'distortion':
          distortion?.setAmount(fx.distortion.amount, ramp);
          break;
        case 'compressor':
          if (compressor && makeup) {
            // (The compressor's own attack and release smooth a change of threshold or ratio)
            compressor.threshold.setValueAtTime(fx.compressor.threshold, Math.max(at, compressor.now()));
            compressor.ratio.setValueAtTime(fx.compressor.ratio, Math.max(at, compressor.now()));
            smoothSet(makeup.gain, Tone.dbToGain(fx.compressor.makeup), Math.max(at, makeup.now()), ramp / 3);
          }
          break;
        case 'chorus':
          if (chorus) {
            chorus.setWet(fx.chorus.mix, ramp);
            chorus.setRate(fx.chorus.rate, ramp);
            chorus.setDepth(fx.chorus.depth);
          }
          break;
        case 'lofi':
          lofi?.set(fx.lofi, ramp);
          break;
        case 'echo':
          echoSettings = fx.echo;
          echo?.set(fx.echo, tempo, ramp);
          break;
        case 'reverb':
          reverb?.set(fx.reverb, ramp);
          break;
        case 'gate':
          gateUnit?.setShape(fx.gate.depth, fx.gate.length);
          break;
        case 'pump':
          pump?.setShape(fx.pump.depth, fx.pump.release / 1000);
          break;
      }
    });
  };

  /** How far ahead of the clock a control's value is taken, and how long it glides there. */
  const offline = typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext;
  const CONTROL_STEP = offline ? 128 / raw.sampleRate : 0.05;
  const controlTick = () => {
    const t = input.context.currentTime;
    const dirty = new Set<keyof Track['fx']>();
    for (const [param, c] of controls) {
      const v = c.writer.valueAt(t + CONTROL_STEP);
      if (c.value !== null && Math.abs(v - c.value) <= 1e-6 * Math.max(1, Math.abs(v))) continue;
      const p = parseParam(param);
      if (p.kind === 'fx') {
        c.value = v;
        dirty.add(p.insert);
      } else if (c.apply(v, t, CONTROL_STEP)) c.value = v;
    }
    for (const insert of dirty) applyInsert(insert, t, CONTROL_STEP);
  };
  const listenControls = () => {
    const want = controls.size > 0;
    if (want === controlListening) return;
    controlListening = want;
    if (want) input.context.on('tick', controlTick);
    else input.context.off('tick', controlTick);
  };
  /** A param that isn't one: writing it does nothing, the writer just remembers what was written. */
  const noParam = { setValueAtTime: () => noParam, linearRampToValueAtTime: () => noParam, cancelScheduledValues: () => noParam } as unknown as AudioParam;

  /** Keep a control for each owned lane of an insert setting or a plugin parameter (see controls). */
  const syncControls = (track: Track) => {
    let changed = false;
    for (const param of owned) {
      const p = parseParam(param);
      if (p.kind !== 'fx' && p.kind !== 'plugin') continue;
      if (p.kind === 'plugin' && !pluginSink) continue;
      if (controls.has(param)) continue;
      const initial = p.kind === 'fx' ? specOf(param).trackValue(track) : specOf(param, track).trackValue(track);
      const apply = p.kind === 'plugin' ? (v: number, at: number) => pluginSink?.(p.pluginId, p.paramId, v, at) ?? false : () => true;
      controls.set(param, { writer: createParamWriter(noParam, { raw, now, initial }), value: null, apply });
      changed = true;
    }
    for (const param of [...controls.keys()]) {
      if (owned.has(param)) continue;
      controls.delete(param);
      changed = true;
    }
    if (changed) version++;
    listenControls();
  };

  return {
    input,
    setPluginParams: (set) => {
      if (set === pluginSink) return;
      pluginSink = set;
      for (const param of [...controls.keys()]) if (parseParam(param).kind === 'plugin') controls.delete(param);
      version++;
      // The plugin lanes the track already has go to the new plugins
      if (lastTrack) syncControls(lastTrack);
      listenControls();
    },
    setSends: (list, muted) => {
      const wanted = new Set(list.map((x) => x.id));
      for (const [id, send] of sends) {
        if (wanted.has(id)) continue;
        // Faded out, then let go
        send.writer.set(0, 0.03);
        const gone = send;
        send.link.forget();
        sends.delete(id);
        window.setTimeout(() => {
          gone.out.dispose();
          gone.gain.dispose();
        }, 120);
        version++;
      }
      for (const want of list) {
        let send = sends.get(want.id);
        if (send && (send.target !== want.target || send.pre !== want.pre)) {
          send.link.forget();
          send.out.dispose();
          send.gain.dispose();
          sends.delete(want.id);
          send = undefined;
        }
        if (!send) {
          const gain = new Tone.Gain(0);
          const out = createDelayLink(gain, want.target, (sendDelays[want.id] ?? 0) / raw.sampleRate);
          send = { gain, writer: writer(gain.gain, 0), target: want.target, pre: want.pre, link: sendLink(want.pre ? merge : duck, gain), out };
          sends.set(want.id, send);
          version++;
        }
        const lane = owned.has(`send:${want.id}` as AutomationParam);
        const level = want.pre && muted ? 0 : Math.max(0, Math.min(1, want.level));
        if (!lane) send.writer.set(level, 0.02);
        send.link(lane || level > 0, 0.02);
      }
    },
    setAlignment: (delays) => {
      const seconds = (frames: number) => Math.max(0, frames) / raw.sampleRate;
      sendDelays = delays?.sends ?? {};
      dryLink.set(seconds(delays?.dry ?? 0));
      for (const [id, send] of sends) send.out.set(seconds(sendDelays[id] ?? 0));
      // The tail is a delay line at the end of the inserts, swapped in and out like any insert (a
      // new length is a new one), so the change crossfades (see rewire). Live, it glides there as
      // a delay link does (delayLink.ts): a delay line as long as the old one's takes over, glides
      // to the new length, then a plain one of that length takes over, all without a dip
      const tail = seconds(delays?.tail ?? 0);
      if (Math.abs((tailDelay?.seconds ?? 0) - tail) < 1e-9) return;
      const retired = tailDelay ? [tailDelay] : [];
      clearTimeout(tailTimer);
      if (barrier) {
        // (Its crossfade starts at switchAt and takes SWITCH_FADE; the glide starts after it)
        const at = switchAt();
        const from = tailDelay?.glide ? glideAt(tailDelay.glide, at) : (tailDelay?.seconds ?? 0);
        const glide = planGlide(from, tail, at + SWITCH_FADE + 0.01);
        const node = glidingDelay(raw, glide);
        tailDelay = { input: node, output: node, seconds: tail, glide, dispose: () => node.disconnect() };
        const settle = () => {
          if (tailDelay?.glide !== glide) return;
          if (raw.currentTime < glide.end) {
            tailTimer = window.setTimeout(settle, (glide.end - raw.currentTime) * 1000 + 50);
            return;
          }
          const gliding = tailDelay;
          if (tail > 0) {
            const plain = fixedDelay(raw, tail);
            tailDelay = { input: plain, output: plain, seconds: tail, dispose: () => plain.disconnect() };
          } else tailDelay = null;
          rewire([gliding]);
        };
        tailTimer = window.setTimeout(settle, (glide.end - raw.currentTime) * 1000 + 50);
      } else if (tail > 0) {
        const node = fixedDelay(raw, tail);
        tailDelay = { input: node, output: node, seconds: tail, dispose: () => node.disconnect() };
      } else tailDelay = null;
      rewire(retired);
    },
    sendTarget: (returnId) => {
      const send = sends.get(returnId);
      return send ? { writer: send.writer, map: (v: number) => Math.max(0, Math.min(1, v)) } : null;
    },
    setTempo: (bpm) => {
      if (bpm === tempo) return;
      tempo = bpm;
      if (echo && echoSettings) echo.set(echoSettings, tempo, 0.05);
    },
    setOutput: (target) => {
      if (target === output) return;
      if (awake) dryLink.retarget(target);
      output = target;
    },
    sleep: (asleep) => {
      // Live only: an export plays every track from the start
      if (!barrier || asleep === !awake) return;
      awake = !asleep;
      if (asleep) {
        dryLink.retarget(null);
        taps.forEach((drop) => drop());
      } else dryLink.retarget(output);
      linkSyncs.forEach((sync) => sync(0));
    },
    apply: (track, opts = {}) => {
      const ramp = opts.ramp ?? 0.03;
      // A bus pans its tracks' already-panned sound again: the pan's -3 dB at the centre is made up
      // at its input, so a bus at 0 dB, centred, passes its tracks through at the level they had
      const busMakeup = INSTRUMENTS[track.instrumentKey]?.kind === 'bus' || INSTRUMENTS[track.instrumentKey]?.kind === 'return' ? Math.SQRT2 : 1;
      if (input.gain.value !== busMakeup) input.gain.value = busMakeup;
      const { eq: bands } = track;
      const mute = opts.muteOverride ?? track.isMuted;
      // A lane of an insert's setting only counts while the insert is on
      owned = new Set(
        activeLanes(track)
          .map((l) => l.param)
          .filter((p) => {
            const insert = specOf(p).insert;
            return !insert || (track.fx[insert] as { on?: boolean } | undefined)?.on;
          })
      );
      baseFx = track.fx;
      lastTrack = track;
      syncControls(track);
      // The settings lanes drive, at the lanes' values
      const fx = effective(track.fx);
      /** Inserts switched off: disposed once they're patched out (see rewire). */
      const retired: Array<{ dispose: () => unknown }> = [];

      if (fx.distortion.on) {
        distortion ??= createLightDistortion(fx.distortion.amount);
        distortion.setAmount(fx.distortion.amount);
      } else if (distortion) {
        retired.push(distortion);
        distortion = null;
      }

      if (fx.bassDrive?.on) {
        if (bassDrive) bassDrive.set(fx.bassDrive, ramp);
        else bassDrive = createBassDrive(fx.bassDrive);
      } else if (bassDrive) {
        retired.push(bassDrive);
        bassDrive = null;
      }

      const eqLanes = owned.has('eqLow') || owned.has('eqMid') || owned.has('eqHigh');
      if (bands.low !== 0 || bands.mid !== 0 || bands.high !== 0 || eqLanes) {
        if (!eq) version++;
        eq ??= createLightEq3(400, 2500);
        // (A writer sets a fresh EQ's gains at once)
        if (!owned.has('eqLow')) eq.low.set(Tone.dbToGain(bands.low), ramp);
        if (!owned.has('eqMid')) eq.mid.set(Tone.dbToGain(bands.mid), ramp);
        if (!owned.has('eqHigh')) eq.high.set(Tone.dbToGain(bands.high), ramp);
      } else if (eq) {
        retired.push(eq);
        eq = null;
        version++;
      }

      const peqBands = fx.peq?.on ? peqActiveBands(fx.peq.bands) : 0;
      if (peqBands > 0) {
        // A band switched on or off: a new EQ with a filter per band that's on (see createLightPeq)
        const fresh = !peq || peq.count !== peqBands;
        if (fresh && peq) retired.push(peq);
        if (fresh) peq = createLightPeq(peqBands);
        peq!.set(fx.peq!.bands, fresh ? 0 : ramp);
      } else if (peq) {
        retired.push(peq);
        peq = null;
      }

      if (fx.mbc?.on) {
        if (mbc) mbc.set(fx.mbc, ramp);
        else mbc = createLightMbc(fx.mbc);
      } else if (mbc) {
        retired.push(mbc);
        mbc = null;
      }

      if (fx.saturate?.on) {
        if (saturate) saturate.set(fx.saturate);
        else saturate = createSaturation(fx.saturate);
      } else if (saturate) {
        retired.push(saturate);
        saturate = null;
      }

      if (fx.monoLow?.on) {
        if (monoLow) monoLow.set(fx.monoLow, ramp);
        else monoLow = createMonoBass(fx.monoLow);
      } else if (monoLow) {
        retired.push(monoLow);
        monoLow = null;
      }

      if (fx.compressor.on) {
        if (!compressor || !makeup || !compressorUnit) {
          // Made with their settings: set afterwards, they'd only apply a look-ahead (0.1 s) later
          const comp = new Tone.Compressor({ threshold: fx.compressor.threshold, ratio: fx.compressor.ratio, attack: 0.01, release: 0.2 });
          const gain = new Tone.Gain(Tone.dbToGain(fx.compressor.makeup));
          comp.connect(gain);
          compressor = comp;
          makeup = gain;
          compressorUnit = { input: comp, output: gain, dispose: () => [comp, gain].forEach((n) => n.dispose()) };
          // Live, it's heard once it has warmed up (see rewire)
          compressorReady = raw.currentTime + COMPRESSOR_WARM_UP;
        } else {
          // Set directly, never ramped: Tone starts any ramp from max(current, 1e-7), which is
          // above the threshold's 0 dB cap.
          set(compressor.threshold, fx.compressor.threshold, 0);
          set(compressor.ratio, fx.compressor.ratio, 0);
          set(makeup.gain, Tone.dbToGain(fx.compressor.makeup), ramp);
        }
      } else if (compressorUnit) {
        retired.push(compressorUnit);
        compressor = null;
        makeup = null;
        compressorUnit = null;
      }

      if (fx.chorus.on) {
        if (!chorus) {
          chorus = createLightChorus({ rate: fx.chorus.rate, delayMs: 3.5, depth: fx.chorus.depth, spread: 180, wet: fx.chorus.mix });
        } else {
          chorus.setWet(fx.chorus.mix, ramp);
          chorus.setRate(fx.chorus.rate, ramp);
          chorus.setDepth(fx.chorus.depth);
        }
      } else if (chorus) {
        retired.push(chorus);
        chorus = null;
      }

      // Older test fixtures and hand-built tracks may lack the newer inserts: treat them as off
      if (fx.filter?.on) {
        const fresh = !filter;
        filter ??= createLightFilter();
        const shape = filter.shape();
        filter.set(fx.filter, fresh ? 0 : ramp, { cutoff: owned.has('filterCutoff'), resonance: owned.has('filterResonance') });
        if (filter.shape() !== shape) version++;
      } else if (filter) {
        retired.push(filter);
        filter = null;
        version++;
      }

      if (fx.lofi?.on) {
        if (lofi) lofi.set(fx.lofi, ramp);
        else lofi = createLightLofi(fx.lofi);
      } else if (lofi) {
        retired.push(lofi);
        lofi = null;
      }

      if (fx.echo?.on) {
        echoSettings = fx.echo;
        if (echo) echo.set(fx.echo, tempo, ramp);
        else echo = createEcho(fx.echo, tempo);
      } else if (echo) {
        retired.push(echo);
        echo = null;
        echoSettings = null;
      }

      if (fx.reverb?.on) {
        if (reverb) reverb.set(fx.reverb, ramp);
        else reverb = createReverb(fx.reverb);
      } else if (reverb) {
        retired.push(reverb);
        reverb = null;
      }

      if (fx.gate?.on) {
        gateUnit ??= createLightGate();
        gateUnit.setShape(fx.gate.depth, fx.gate.length);
        gateRate = fx.gate.rate;
      } else if (gateUnit) {
        retired.push(gateUnit);
        gateUnit = null;
        gateRate = null;
      }

      if (fx.pump?.on) {
        pump ??= createLightPump();
        pump.setShape(fx.pump.depth, fx.pump.release / 1000);
        pumpTrigger = fx.pump.trigger;
        pumpSource = fx.pump.trigger === 'track' ? fx.pump.source ?? null : null;
      } else {
        if (pump) retired.push(pump);
        pump = null;
        pumpTrigger = null;
        pumpSource = null;
      }

      if (owned.has('volume')) {
        if (!laneGain || retiring) takeVolume(track, mute, ramp);
      } else if (laneGain && !retiring) {
        giveVolumeBack(track, mute, ramp);
      }

      if (INSTRUMENTS[track.instrumentKey]?.mono) {
        fold ??= createMonoFold();
      } else if (fold) {
        retired.push(fold);
        fold = null;
      }
      rewire(retired);

      // The fader's bottom (-60) is silence, but not -Infinity: Tone's Channel takes a volume of
      // -Infinity to mean muted, so the unmute below put a set-at-once fader (the WAV export's)
      // back to 0 dB, and a track faded all the way down played at full volume in the export.
      // While a Volume lane owns the level the fader stays at 0 dB (and is left alone while the
      // two trade places, which Tone's ramp would undo).
      if (handoverUntil <= now()) set(fader.volume, owned.has('volume') ? 0 : faderDb(track), ramp);
      if (!owned.has('pan')) {
        panLeft.set(track.pan, ramp);
        panRight.set(-track.pan, ramp);
      }
      if (mute !== muted) {
        muted = mute;
        writeLevel(ramp);
      }
      if (opts.muteOverride === undefined) solo.solo = track.isSoloed;

      // Set back on the stage, more of the track reaches the hall
      const distance = Math.max(0, Math.min(1, track.distance ?? 0));
      setDistance(distance, ramp);
      // (A lane writing the send adds the distance's extra to each value: read again when it changes)
      if (distance !== distanceNow && owned.has('reverbSend')) version++;
      distanceNow = distance;
      const roomSend = roomSendLevel(track.reverbSend, distance);
      if (!owned.has('reverbSend')) reverbWriter.set(roomSend, ramp);
      if (!owned.has('delaySend')) delayWriter.set(Math.max(0, Math.min(1, track.delaySend)), ramp);
      reverbLink(owned.has('reverbSend') || roomSend > 0, ramp);
      delayLink(owned.has('delaySend') || track.delaySend > 0, ramp);
    },
    pumpTrigger: () => pumpTrigger,
    pumpSource: () => pumpSource,
    gateRate: () => gateRate,
    gate: (time, tick, windowTicks, secondsPerTick) => {
      if (!gateUnit || !gateRate) return;
      const step = GATE_TICKS[gateRate];
      const steps: number[] = [];
      for (let k = Math.ceil(tick / step) * step; k < tick + windowTicks; k += step) steps.push(time + (k - tick) * secondsPerTick);
      gateUnit.schedule(steps, step * secondsPerTick, time + (windowTicks + step) * secondsPerTick + 0.05);
    },
    duckTarget: () => ({ writer: duckWriter, map: (v) => v }),
    setIntensityLevel: (gain, ramp = 0) => {
      intensity = Math.max(0, Math.min(1, gain));
      writeLevel(ramp);
    },
    spectrum: (out) => {
      if (!awake) {
        out.fill(-Infinity);
        return Math.min(out.length, 2048);
      }
      const node = spectrumTap();
      if (out.length >= node.frequencyBinCount) node.getFloatFrequencyData(out.subarray(0, node.frequencyBinCount) as Float32Array<ArrayBuffer>);
      return node.frequencyBinCount;
    },
    mbcReduction: () => mbc?.reduction() ?? null,
    peak: () => {
      if (!awake) return 0;
      meterTap().getFloatTimeDomainData(meterData);
      let p = 0;
      for (let i = 0; i < meterData.length; i++) p = Math.max(p, Math.abs(meterData[i]));
      return p;
    },
    pump: (time, source, fromTrack) => {
      if (pump && source === pumpTrigger && (source !== 'track' || fromTrack === pumpSource)) pump.trigger(time);
    },
    automationTargets: (param) => {
      if (!owned.has(param)) return null;
      const gain = (db: number) => (db === -Infinity ? 0 : Tone.dbToGain(db));
      const same = (v: number) => v;
      switch (param) {
        case 'volume':
          return laneGain && !retiring ? [{ writer: laneGain.writer, map: gain }] : null;
        case 'pan':
          return [
            { writer: panLeft, map: same },
            { writer: panRight, map: (pan) => -pan },
          ];
        case 'reverbSend': {
          // Set back on the stage, the lane's send plus the distance's extra
          const distance = distanceNow;
          return [{ writer: reverbWriter, map: distance > 0 ? (send: number) => roomSendLevel(send, distance) : same }];
        }
        case 'delaySend':
          return [{ writer: delayWriter, map: same }];
        case 'filterCutoff':
          return filter ? filter.targets('cutoff') : null;
        case 'filterResonance':
          return filter ? filter.targets('resonance') : null;
        case 'eqLow':
          return eq ? [{ writer: eq.low, map: gain }] : null;
        case 'eqMid':
          return eq ? [{ writer: eq.mid, map: gain }] : null;
        case 'eqHigh':
          return eq ? [{ writer: eq.high, map: gain }] : null;
      }
      const p = parseParam(param);
      if (p.kind === 'send') {
        const target = sends.get(p.returnId);
        return target ? [{ writer: target.writer, map: (v: number) => Math.max(0, Math.min(1, v)) }] : null;
      }
      const control = controls.get(param);
      return control ? [{ writer: control.writer, map: same }] : null;
    },
    automationVersion: () => version,
    dispose: () => {
      controls.clear();
      listenControls();
      clearTimeout(retireTimer);
      clearTimeout(tidyTimer);
      clearTimeout(tailTimer);
      gates.forEach((g) => g.gain.disconnect());
      dryLink.dispose();
      sends.forEach((x) => x.out.dispose());
      tailDelay?.dispose();
      [...leaving, distortion, bassDrive, eq, peq, mbc, saturate, monoLow, compressorUnit, chorus, lofi, filter, echo, reverb, gateUnit, pump, fold, laneGain?.node, input, solo, fader, level, duck, reverbSend, delaySend, ...[...sends.values()].map((x) => x.gain)].forEach((n) => n?.dispose());
      [barrier, left, split, right, merge, far?.shelf, far?.trim].forEach((n) => n?.disconnect());
    },
  };
}

/** The Transport's scheduling calls a pump clock needs (live and offline Transports both have them). */
type PumpTransport = Pick<ReturnType<typeof Tone.getTransport>, 'schedule' | 'clear' | 'bpm'>;

export interface PumpClock {
  /** Add or remove the clock's events to match what the strips' Pumps follow. */
  update: () => void;
  dispose: () => void;
}

/** Transport ticks in a beat and in an 8th (Tone's 192 per quarter note). */
const BEAT_TICKS = 192;
const EIGHTH_TICKS = 96;

/**
 * The Pump triggers that come from the Transport rather than from notes: every beat and every
 * 8th, counted from bar 1, over Transport ticks [fromTick, toTick). Each is an ordinary Transport
 * event at its tick, like a note's, so it fires at exactly the time a note on that tick plays,
 * through loops, seeks and tempo changes, live and in the export. The events exist only while a
 * strip's Pump follows the beat or the 8th: one per beat, or one per 8th if any Pump wants those
 * (about 3,200 over the whole timeline; switching costs a few milliseconds).
 */
export function createPumpClock(transport: PumpTransport, strips: () => Iterable<TrackStrip>, fromTick: number, toTick: number): PumpClock {
  let step = 0;
  let ids: number[] = [];
  const clear = () => {
    ids.forEach((id) => transport.clear(id));
    ids = [];
  };
  const fire = (tick: number) => (time: number) => {
    const onBeat = tick % BEAT_TICKS === 0;
    const secondsPerTick = 60 / (transport.bpm.value * BEAT_TICKS);
    for (const strip of strips()) {
      strip.pump(time, 'eighth');
      if (onBeat) strip.pump(time, 'beat');
      strip.gate(time, tick, step, secondsPerTick);
    }
  };
  return {
    update: () => {
      let wanted = 0;
      for (const strip of strips()) {
        const trigger = strip.pumpTrigger();
        if (trigger === 'eighth') wanted = EIGHTH_TICKS;
        else if (trigger === 'beat' && !wanted) wanted = BEAT_TICKS;
        // The Gate chops within each 8th
        if (strip.gateRate()) wanted = EIGHTH_TICKS;
      }
      if (wanted === step) return;
      clear();
      step = wanted;
      if (!step) return;
      for (let tick = Math.ceil(fromTick / step) * step; tick < toTick; tick += step) ids.push(transport.schedule(fire(tick), `${tick}i`));
    },
    dispose: () => {
      clear();
      step = 0;
    },
  };
}
