import * as Tone from 'tone';
import type { AutomationParam, PumpTrigger, Track } from '../../store/timelineTypes';
import { activeLanes, AUTOMATION } from '../automation';
import type { BusEffects } from './busEffects';
import { createParamWriter, type AutomationTarget, type ParamWriter } from './paramWriter';
import {
  createLightChorus,
  createLightEq3,
  createLightFilter,
  createLightPump,
  type LightChorus,
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
 * cost more CPU than the instruments, so a dozen tracks could starve live playback. The EQ,
 * chorus, filter and pump are lean nodes (see lightFx.ts), for the same reason. The Filter sits
 * late so a sweep shapes everything before it; the Pump is last so it ducks the whole sound.
 *
 * The channel is stereo. Tone.Channel's panner folds whatever reaches it to mono first, so a
 * Supersaw's spread, a chorus or a stereo sample lost its width at the strip. The pan here is a
 * balance: each side has its own gain, the equal-power pair StereoPannerNode gives a mono
 * source (cos and sin, -3 dB each at the centre). A mono source is spread to both sides first,
 * so it pans exactly as it did through Tone.Channel; a stereo one keeps its width, and the pan
 * turns down the side it moves away from.
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

/** An insert in the chain: where the signal goes in and where it comes out. */
interface Insert {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
}

/**
 * The gains a pan position gives the left and right channels: equal power, as Web Audio's
 * StereoPannerNode pans a mono source (its formula exactly).
 */
export function panGains(pan: number): [left: number, right: number] {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

export function createTrackStrip(bus: Tone.InputNode, busFx: BusEffects): TrackStrip {
  const input = new Tone.Gain(1);
  const solo = new Tone.Solo();
  // A mono source becomes the same sound on both sides here, for the balance to split
  solo.channelCount = 2;
  solo.channelCountMode = 'explicit';
  const fader = new Tone.Volume(0);
  const reverbSend = new Tone.Gain(0);
  const delaySend = new Tone.Gain(0);
  const raw = input.context.rawContext as unknown as BaseAudioContext;

  // The balance: a gain per side, between the solo and the fader
  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  const left = raw.createGain();
  const right = raw.createGain();
  solo.connect(split);
  split.connect(left, 0);
  split.connect(right, 1);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  merge.connect(fader.input.input as unknown as AudioNode);

  input.connect(solo);
  fader.connect(bus);
  fader.connect(reverbSend);
  reverbSend.connect(busFx.reverbInput);
  fader.connect(delaySend);
  delaySend.connect(busFx.delayInput);

  let distortion: Tone.Distortion | null = null;
  let eq: LightEq3 | null = null;
  let compressor: Tone.Compressor | null = null;
  let makeup: Tone.Gain | null = null;
  let chorus: LightChorus | null = null;
  let filter: LightFilter | null = null;
  let pump: LightPump | null = null;
  let pumpTrigger: PumpTrigger | null = null;
  /** The inserts currently patched in, in signal order. */
  let chain: Insert[] = [];

  const now = () => input.context.now();
  const writer = (param: Tone.Param<any>, initial: number) =>
    createParamWriter(param.input as AudioParam, { raw, now, initial });
  // (A gain's own value until the first apply(), which sets the pan before anything sounds)
  const panLeft = createParamWriter(left.gain, { raw, now, initial: left.gain.value });
  const panRight = createParamWriter(right.gain, { raw, now, initial: right.gain.value });
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

  /** Patch input -> active inserts -> solo, only when the set of inserts changed. */
  const rewire = () => {
    const next: Insert[] = [];
    if (distortion) next.push({ input: distortion, output: distortion });
    if (eq) next.push({ input: eq.input, output: eq.output });
    if (compressor && makeup) next.push({ input: compressor, output: makeup });
    if (chorus) next.push({ input: chorus.input, output: chorus.output });
    if (filter) next.push({ input: filter.input, output: filter.output });
    if (pump) next.push({ input: pump.input, output: pump.output });
    if (laneGain) next.push({ input: laneGain.node, output: laneGain.node });
    if (next.length === chain.length && next.every((ins, i) => ins.input === chain[i].input)) return;

    input.disconnect();
    chain.forEach((ins) => ins.output.disposed || ins.output.disconnect());
    let from: Tone.ToneAudioNode = input;
    for (const ins of next) {
      from.connect(ins.input);
      from = ins.output;
    }
    from.connect(solo);
    chain = next;
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
        lane.node.dispose();
        laneGain = null;
        retiring = false;
        version++;
        rewire();
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

      if (fx.distortion.on) {
        distortion ??= new Tone.Distortion({ distortion: fx.distortion.amount, oversample: '2x', wet: 1 });
        distortion.distortion = fx.distortion.amount;
      } else if (distortion) {
        distortion.dispose();
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
        eq.dispose();
        eq = null;
        version++;
      }

      if (fx.compressor.on) {
        const fresh = !compressor;
        compressor ??= new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
        makeup ??= new Tone.Gain(1);
        if (fresh) compressor.connect(makeup);
        // Set directly, never ramped: Tone starts any ramp from max(current, 1e-7), which is
        // above the threshold's 0 dB cap.
        set(compressor.threshold, fx.compressor.threshold, 0);
        set(compressor.ratio, fx.compressor.ratio, 0);
        set(makeup.gain, Tone.dbToGain(fx.compressor.makeup), fresh ? 0 : ramp);
      } else if (compressor) {
        compressor.dispose();
        makeup?.dispose();
        compressor = null;
        makeup = null;
      }

      if (fx.chorus.on) {
        const fresh = !chorus;
        chorus ??= createLightChorus({ rate: fx.chorus.rate, delayMs: 3.5, depth: fx.chorus.depth, spread: 180, wet: fx.chorus.mix });
        chorus.setWet(fx.chorus.mix, fresh ? 0 : ramp);
        chorus.setRate(fx.chorus.rate, fresh ? 0 : ramp);
        chorus.setDepth(fx.chorus.depth);
      } else if (chorus) {
        chorus.dispose();
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
        filter.dispose();
        filter = null;
        version++;
      }

      if (fx.pump?.on) {
        pump ??= createLightPump();
        pump.setShape(fx.pump.depth, fx.pump.release / 1000);
        pumpTrigger = fx.pump.trigger;
      } else {
        pump?.dispose();
        pump = null;
        pumpTrigger = null;
      }

      if (owned.has('volume')) {
        if (!laneGain || retiring) takeVolume(track, muted, ramp);
      } else if (laneGain && !retiring) {
        giveVolumeBack(track, muted, ramp);
      }
      rewire();

      // The fader's bottom (-60) is silence, but not -Infinity: Tone's Channel takes a volume of
      // -Infinity to mean muted, so the unmute below put a set-at-once fader (the WAV export's)
      // back to 0 dB, and a track faded all the way down played at full volume in the export.
      // While a Volume lane owns the level the fader stays at 0 dB (and is left alone while the
      // two trade places, which Tone's ramp would undo).
      if (handoverUntil <= now()) set(fader.volume, owned.has('volume') ? 0 : faderDb(track), ramp);
      if (!owned.has('pan')) {
        const [l, r] = panGains(track.pan);
        panLeft.set(l, ramp);
        panRight.set(r, ramp);
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
            { writer: panLeft, map: (pan) => panGains(pan)[0] },
            { writer: panRight, map: (pan) => panGains(pan)[1] },
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
      [distortion, eq, compressor, makeup, chorus, filter, pump, laneGain?.node, input, solo, fader, reverbSend, delaySend].forEach((n) => n?.dispose());
      [split, left, right, merge].forEach((n) => n.disconnect());
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
