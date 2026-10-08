import * as Tone from 'tone';
import type { AutomationParam, PumpTrigger, Track } from '../../store/timelineTypes';
import { activeLanes, AUTOMATION } from '../automation';
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
 * width while the pan turns down the side it moves away from.
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
  /** Its own connections, for rewire() to take apart (a warming patch's, see warmIn). */
  inner?: Link[];
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

/** How long a fresh Compressor and a fresh Distortion take to sound as they will (see warmIn). */
const COMPRESSOR_WARM_UP = 0.2;
const DISTORTION_WARM_UP = 0.01;
/** The crossfade onto an insert once it has warmed up. */
const WARM_FADE = 0.01;

/** An insert that can be disposed. */
interface Unit extends Insert {
  dispose: () => void;
}

/**
 * Patch a fresh `insert` in with a way round it. A browser compressor passes nothing for its
 * 6 ms look-ahead and then brings its gain up from nothing over about 0.2 s; the Distortion's
 * oversampling holds back its first 2 ms. Switched on while playing, either dropped the track
 * out with a click. So until `warmUp` has passed the sound goes round the insert, which fills up
 * meanwhile, and then crossfades onto it over 10 ms; once that's done the strip patches in the
 * insert itself instead (the same sound by then) and disposes this. (Disposing it leaves
 * `insert` alone.)
 */
function warmIn(insert: Insert, warmUp: number): Unit {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const around = new Tone.Gain(1);
  const through = new Tone.Gain(0);
  const at = input.context.rawContext.currentTime + warmUp;
  around.gain.setValueAtTime(1, at);
  around.gain.linearRampToValueAtTime(0, at + WARM_FADE);
  through.gain.setValueAtTime(0, at);
  through.gain.linearRampToValueAtTime(1, at + WARM_FADE);
  const inner: Link[] = [
    [input, around],
    [around, output],
    [input, insert.input],
    [insert.output, through],
    [through, output],
  ];
  inner.forEach(([from, to]) => Tone.connect(from, to));
  return { input, output, inner, dispose: () => [input, output, around, through].forEach((n) => n.dispose()) };
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
  // And one where the inserts end, so that patching one in or out while playing walks no further
  // than the chain (see rewire). It costs about what a gain does.
  const tail = barrier ? raw.createDelay(0.01) : null;
  if (tail) blockRateDelay(tail);
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

  if (tail) Tone.connect(tail, solo);
  Tone.connect(head, tail ?? solo);
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
  /** Fresh inserts' warming patches (see warmIn), patched in instead of them for now (live only). */
  const warming = new Map<Insert, Unit>();
  const warmTimers = new Set<number>();
  let chorus: LightChorus | null = null;
  let filter: LightFilter | null = null;
  let pump: LightPump | null = null;
  let pumpTrigger: PumpTrigger | null = null;
  /** The inserts currently patched in, in signal order. */
  let chain: Insert[] = [];

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
      links.push([from, ins.input], ...(ins.inner ?? []));
      from = ins.output;
    }
    links.push([from, tail ?? solo]);
    return links;
  };

  /**
   * Patch head -> active inserts -> tail (-> solo), only when the chain changed.
   *
   * An insert switched on or off while playing mustn't open a gap in the sound, or double it.
   * Live, standardized-audio-context makes or breaks a native connection at once and then walks
   * the graph downstream of it, and natively disconnects whatever loses its last input (and
   * everything after that) until an input comes back. Cutting the chain and then joining up the
   * new one left the track silent for a render block or three (3 to 9 ms) whenever the audio
   * thread rendered in between, and connecting first doubled it the same way. So: new inserts
   * are fed first (nothing hears them yet); a silent gain from the head holds up each node whose
   * input changes; its old link is cut and the new one made straight after, with only a short
   * walk in between, as the chain ends at a DelayNode (where walks stop); the links into inserts
   * taken out go last, and the caller disposes those inserts afterwards.
   */
  const rewire = () => {
    const next: Insert[] = [];
    const patched = (ins: Insert) => warming.get(ins) ?? ins;
    if (distortion) next.push(patched(distortion));
    if (eq) next.push(eq);
    if (compressorUnit) next.push(patched(compressorUnit));
    if (chorus) next.push(chorus);
    if (filter) next.push(filter);
    if (pump) next.push(pump);
    if (laneGain) next.push({ input: laneGain.node, output: laneGain.node });
    if (next.length === chain.length && next.every((ins, i) => ins.input === chain[i].input && ins.output === chain[i].output)) return;

    const before = linksOf(chain);
    const after = linksOf(next);
    const has = (links: Link[], [from, to]: Link) => links.some(([f, t]) => f === from && t === to);
    const cut = (from: Link[0], to: Tone.InputNode) => {
      try {
        Tone.disconnect(from, to);
      } catch {
        // Not connected (any more): nothing to cut
      }
    };
    // Everything the chain feeds now
    const playing = new Set(before.map(([, to]) => to));
    const added = after.filter((link) => !has(before, link));
    added.filter(([, to]) => !playing.has(to)).forEach(([from, to]) => Tone.connect(from, to));
    const swaps = added.filter(([, to]) => playing.has(to));
    // (Offline nothing is playing while the strip is set up, and nothing is disconnected for it)
    const hold = barrier ? raw.createGain() : null;
    if (hold) {
      hold.gain.value = 0;
      Tone.connect(head, hold);
      swaps.forEach(([, to]) => Tone.connect(hold, to));
    }
    for (const [from, to] of swaps) {
      before.filter((link) => link[1] === to && !has(after, link)).forEach(([f]) => cut(f, to));
      Tone.connect(from, to);
    }
    before.filter((link) => !has(after, link)).forEach(([from, to]) => cut(from, to));
    if (hold) {
      swaps.forEach(([, to]) => cut(hold, to));
      cut(head, hold);
    }
    chain = next;
  };

  /** Live, patch a fresh `insert` in through warmIn until it has warmed up (`seconds`), then itself. */
  const warm = (insert: Insert, seconds: number) => {
    if (!barrier) return;
    const patch = warmIn(insert, seconds);
    warming.set(insert, patch);
    const timer = window.setTimeout(
      () => {
        warmTimers.delete(timer);
        // (Unless it was switched off meanwhile)
        if (warming.get(insert) !== patch) return;
        warming.delete(insert);
        rewire();
        patch.dispose();
      },
      (seconds + WARM_FADE) * 1000 + 50
    );
    warmTimers.add(timer);
  };
  /** An insert switched off: its warming patch (if it has one) and then itself go, once patched out. */
  const retire = (retired: Array<{ dispose: () => unknown }>, insert: Insert & { dispose: () => unknown }) => {
    const patch = warming.get(insert);
    if (patch) retired.push(patch);
    warming.delete(insert);
    retired.push(insert);
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
    const at = laneGain.writer.jump(Tone.dbToGain(faderDb(track)), laneGain.writer.cut(now()));
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
        rewire();
        lane.node.dispose();
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
        if (!distortion) {
          distortion = createLightDistortion(fx.distortion.amount);
          warm(distortion, DISTORTION_WARM_UP);
        }
        distortion.setAmount(fx.distortion.amount);
      } else if (distortion) {
        retire(retired, distortion);
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
          warm(compressorUnit, COMPRESSOR_WARM_UP);
        } else {
          // Set directly, never ramped: Tone starts any ramp from max(current, 1e-7), which is
          // above the threshold's 0 dB cap.
          set(compressor.threshold, fx.compressor.threshold, 0);
          set(compressor.ratio, fx.compressor.ratio, 0);
          set(makeup.gain, Tone.dbToGain(fx.compressor.makeup), ramp);
        }
      } else if (compressorUnit) {
        retire(retired, compressorUnit);
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
      rewire();
      retired.forEach((insert) => insert.dispose());

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
      warmTimers.forEach((timer) => clearTimeout(timer));
      warming.forEach((patch) => patch.dispose());
      [distortion, eq, compressorUnit, chorus, filter, pump, laneGain?.node, input, solo, fader, reverbSend, delaySend].forEach((n) => n?.dispose());
      [barrier, tail, left, split, right, merge].forEach((n) => n?.disconnect());
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
