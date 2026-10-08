import * as Tone from 'tone';
import type { AutomationParam, PumpTrigger, Track } from '../../store/timelineTypes';
import { activeLanes, AUTOMATION } from '../automation';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { BusEffects } from './busEffects';
import { createParamWriter, type AutomationTarget, type ParamWriter } from './paramWriter';
import {
  createLightChorus,
  createLightDistortion,
  createLightEq3,
  createLightFilter,
  createLightPump,
  type LightChorus,
  type LightDistortion,
  type LightEq3,
  type LightFilter,
  type LightPump,
} from './lightFx';

/**
 * One mixer channel per track:
 *   input -> Distortion -> EQ3 -> Compressor -> makeup gain -> Chorus -> Filter -> Pump
 *         -> (Volume lane) -> solo -> pan -> fader (vol/mute)
 *   fader -> master bus, plus post-fader sends to the shared reverb and delay.
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
  /** A `source` trigger at `time`: the Pump ducks if it follows that source. */
  pump: (time: number, source: PumpTrigger) => void;
  /**
   * What a lane for `param` drives, or null while it can't sound (its Filter is off) or no lane
   * owns it (as of the last apply()).
   */
  automationTargets: (param: AutomationParam) => AutomationTarget[] | null;
  /** Changes whenever automationTargets() might answer differently (an insert came or went, the Filter changed type...). */
  automationVersion: () => number;
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
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
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

  fader.connect(bus);
  fader.connect(reverbSend);
  reverbSend.connect(busFx.reverbInput);
  fader.connect(delaySend);
  delaySend.connect(busFx.delayInput);

  let distortion: LightDistortion | null = null;
  let eq: LightEq3 | null = null;
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
  const delayWriter = writer(delaySend.gain, 0);
  /** The Volume lane's own gain, and its writer: only while a Volume lane owns the level. */
  let laneGain: { node: Tone.Gain; writer: ParamWriter } | null = null;
  /** Settings lanes own, as of the last apply(). */
  let owned = new Set<AutomationParam>();
  let version = 0;
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
    if (eq) next.push(eq);
    if (compressorUnit) next.push(compressorUnit);
    if (chorus) next.push(chorus);
    if (filter) next.push(filter);
    if (pump) next.push(pump);
    if (laneGain) next.push({ input: laneGain.node, output: laneGain.node });
    if (fold) next.push(fold);
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

  return {
    input,
    apply: (track, opts = {}) => {
      const ramp = opts.ramp ?? 0.03;
      const { fx, eq: bands } = track;
      const muted = opts.muteOverride ?? track.isMuted;
      // A Filter lane only counts while the Filter is on
      owned = new Set(activeLanes(track).map((l) => l.param).filter((p) => !AUTOMATION[p].filter || fx.filter?.on));
      /** Inserts switched off: disposed once they're patched out (see rewire). */
      const retired: Array<{ dispose: () => unknown }> = [];

      if (fx.distortion.on) {
        distortion ??= createLightDistortion(fx.distortion.amount);
        distortion.setAmount(fx.distortion.amount);
      } else if (distortion) {
        retired.push(distortion);
        distortion = null;
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

      if (fx.pump?.on) {
        pump ??= createLightPump();
        pump.setShape(fx.pump.depth, fx.pump.release / 1000);
        pumpTrigger = fx.pump.trigger;
      } else {
        if (pump) retired.push(pump);
        pump = null;
        pumpTrigger = null;
      }

      if (owned.has('volume')) {
        if (!laneGain || retiring) takeVolume(track, muted, ramp);
      } else if (laneGain && !retiring) {
        giveVolumeBack(track, muted, ramp);
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
      fader.mute = muted;
      if (opts.muteOverride === undefined) solo.solo = track.isSoloed;

      if (!owned.has('reverbSend')) reverbWriter.set(Math.max(0, Math.min(1, track.reverbSend)), ramp);
      if (!owned.has('delaySend')) delayWriter.set(Math.max(0, Math.min(1, track.delaySend)), ramp);
    },
    pumpTrigger: () => pumpTrigger,
    pump: (time, source) => {
      if (pump && source === pumpTrigger) pump.trigger(time);
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
        case 'reverbSend':
          return [{ writer: reverbWriter, map: same }];
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
    },
    automationVersion: () => version,
    dispose: () => {
      clearTimeout(retireTimer);
      clearTimeout(tidyTimer);
      gates.forEach((g) => g.gain.disconnect());
      [...leaving, distortion, eq, compressorUnit, chorus, filter, pump, fold, laneGain?.node, input, solo, fader, reverbSend, delaySend].forEach((n) => n?.dispose());
      [barrier, left, split, right, merge].forEach((n) => n?.disconnect());
    },
  };
}

/** The Transport's scheduling calls a pump clock needs (live and offline Transports both have them). */
type PumpTransport = Pick<ReturnType<typeof Tone.getTransport>, 'schedule' | 'clear'>;

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
    for (const strip of strips()) {
      strip.pump(time, 'eighth');
      if (onBeat) strip.pump(time, 'beat');
    }
  };
  return {
    update: () => {
      let wanted = 0;
      for (const strip of strips()) {
        const trigger = strip.pumpTrigger();
        if (trigger === 'eighth') wanted = EIGHTH_TICKS;
        else if (trigger === 'beat' && !wanted) wanted = BEAT_TICKS;
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
