import * as Tone from 'tone';
import type { MasterFx } from '../../store/timelineTypes';
import { createLightPingPong, type LightPingPong } from './lightFx';
import { decodeSound } from '../soundLibrary';
import { ROOM_STYLES, roomChannels, type RoomStyle } from './roomIR';
import { LUSH_PROCESSOR, LUSH_WORKLET_SOURCE } from './lushReverb';
import { dampingMakeup, LUSH_PRE_DELAY, lushDecay, RECORDED_ROOM_DAMP_HZ, REVERB_DAMP_HZ, REVERB_FILTER_Q, REVERB_LOW_CUT_HZ } from './lushAfter';
import { createWorkletNode, loadWorklet } from '../worklets';

/**
 * Shared return effects fed by every track's post-fader sends: one reverb and one
 * ping-pong delay. One instance of each keeps CPU low however many tracks there are.
 * Built per context (live, and again inside the offline export render).
 *
 * The reverb is a convolver (a designed room from roomIR.ts, or a recorded one), except for the
 * 'lush' style, which is the algorithmic reverb in lushReverb.ts (an AudioWorklet), made only
 * while it's chosen. Switching between them crossfades on the audio clock; until the worklet has
 * loaded, or where AudioWorklets can't run, the hall convolver plays instead.
 *
 * A new impulse response (another decay, style or recorded room) goes into a second convolver
 * while the sound plays: the input moves over to it in a few hundredths of a second, and the
 * first one rings out what it already heard before it's let go. Replacing a convolver's impulse
 * response in place cut its tail off at once, heard as a gap or a click. A decay being dragged is
 * only rebuilt once the slider pauses (and every so often during a long drag): each rebuild is a
 * few tens of milliseconds of work on the page.
 */
export interface BusEffects {
  delay: LightPingPong;
  reverbInput: Tone.Gain;
  delayInput: Tone.Gain;
  /** Resolves when the reverb impulse response is in place (generated, or the recorded room loaded). */
  ready: Promise<void>;
  /** The impulse response the reverb plays now (an export shares it between its renders) */
  impulse: () => AudioBuffer | undefined;
  /** Play this impulse response instead (an export's later renders: the first one's) */
  useImpulse: (buffer: AudioBuffer) => void;
  apply: (fx: MasterFx, bpm: number) => void;
  dispose: () => void;
}

const BEATS: Record<string, number> = { '4n': 1, '8n.': 0.75, '8n': 0.5, '16n': 0.25 };

/** Delay subdivision in seconds at a tempo (computed here so tempo changes stay in sync). */
export function delaySeconds(subdivision: string, bpm: number): number {
  return ((BEATS[subdivision] ?? 0.5) * 60) / bpm;
}

/** How long the input takes to move to a new impulse response's convolver (seconds) */
const SWAP_FADE = 0.05;
/** A decay change is built once changes pause this long (ms)... */
const REBUILD_QUIET_MS = 120;
/** ...or at the latest this long after the first of them (a long drag is heard as it goes) */
const REBUILD_MAX_WAIT_MS = 450;

export function createBusEffects(destination: Tone.InputNode, fx: MasterFx, bpm: number): BusEffects {
  const reverbInput = new Tone.Gain(1);
  const delayInput = new Tone.Gain(1);
  const context = reverbInput.context;

  // Tone.PingPongDelay's sound at wet 1, at a fraction of its CPU (see lightFx.ts)
  const delay = createLightPingPong({
    delayTime: delaySeconds(fx.delayTime, bpm),
    maxDelay: 2,
    feedback: Math.max(0, Math.min(0.8, fx.delayFeedback)),
  });

  // What goes into the hall is low-cut and damped in the highs, as a real room soaks up the top:
  // the reverb's own impulse is full-band noise, which kept bright parts' hiss in the tail and
  // the bass's boom in the wash. Each style damps where its room would (RoomDesign.damp: a
  // plate keeps its shine, a church is dark), and the convolver's feed is evened up for it
  // (dampingMakeup), so on a song the room is as loud as when every style damped at 5.5 kHz
  const lowCut = new Tone.Filter({ type: 'highpass', frequency: REVERB_LOW_CUT_HZ, Q: REVERB_FILTER_Q, rolloff: -12 });
  const damp = new Tone.Filter({ type: 'lowpass', frequency: REVERB_DAMP_HZ, Q: REVERB_FILTER_Q, rolloff: -12 });
  // Each reverb has its own level, for the crossfade between them. The convolvers are fed from
  // convIn, which is cut off from the input while the lush reverb plays instead.
  const convIn = new Tone.Gain(1);
  const convOut = new Tone.Gain(1);
  const lushOut = new Tone.Gain(0);
  reverbInput.chain(lowCut, damp, convIn);
  convOut.connect(destination);
  lushOut.connect(destination);
  delayInput.connect(delay.input);
  delay.output.connect(destination);

  /**
   * A convolver with its own feed (the input moves between two of these when the impulse
   * response changes) and its own output level (to fade one still ringing when a third comes).
   */
  interface Room {
    feed: Tone.Gain;
    convolver: ConvolverNode;
    out: Tone.Gain;
  }
  const makeRoom = (feedGain: number): Room => {
    const feed = new Tone.Gain(feedGain);
    const convolver = context.createConvolver();
    const out = new Tone.Gain(1);
    convIn.connect(feed);
    Tone.connect(feed, convolver);
    Tone.connect(convolver, out);
    out.connect(convOut);
    return { feed, convolver, out };
  };
  const dropRoom = (r: Room) => {
    r.feed.dispose();
    r.convolver.disconnect();
    r.out.dispose();
  };
  let room = makeRoom(1);
  /** The convolver ringing out after the last change, and its timer to be let go */
  let ringing: { room: Room; timer: ReturnType<typeof setTimeout> } | null = null;
  const live = () => !context.isOffline && context.state === 'running';
  /**
   * Play `buffer`: at once before the sound starts (or while the lush reverb plays and the
   * convolver hears nothing), else in a second convolver the input moves over to, while the first
   * rings out what it already heard (see above).
   */
  const setImpulse = (buffer: AudioBuffer) => {
    if (!room.convolver.buffer || !live() || !convolverFed) {
      room.convolver.buffer = buffer;
      return;
    }
    const at = context.currentTime + 0.005;
    // The one still ringing from the change before is faded out quickly and let go
    if (ringing) {
      const old = ringing.room;
      clearTimeout(ringing.timer);
      old.out.gain.setValueAtTime(1, at);
      old.out.gain.linearRampToValueAtTime(0, at + SWAP_FADE);
      setTimeout(() => dropRoom(old), (SWAP_FADE + 0.1) * 1000);
      ringing = null;
    }
    const before = room;
    room = makeRoom(0);
    room.convolver.buffer = buffer;
    before.feed.gain.setValueAtTime(1, at);
    before.feed.gain.linearRampToValueAtTime(0, at + SWAP_FADE);
    room.feed.gain.setValueAtTime(0, at);
    room.feed.gain.linearRampToValueAtTime(1, at + SWAP_FADE);
    // Let go once it has rung out all it heard
    const tail = (before.convolver.buffer?.duration ?? 0) + SWAP_FADE + 0.2;
    const entry = {
      room: before,
      timer: setTimeout(() => {
        if (ringing === entry) ringing = null;
        dropRoom(before);
      }, tail * 1000),
    };
    ringing = entry;
  };

  /** The damping in front of the room, and its makeup (see RoomDesign.damp). */
  const setDamping = (hz: number) => {
    const at = context.now();
    if (context.isOffline || context.state !== 'running') {
      damp.frequency.setValueAtTime(hz, at);
      convIn.gain.setValueAtTime(dampingMakeup(hz), at);
    } else {
      damp.frequency.rampTo(hz, 0.05, at);
      convIn.gain.rampTo(dampingMakeup(hz), 0.05, at);
    }
  };
  // The generated room (roomIR.ts): designed for its style
  const designed = (style: RoomStyle | undefined, decay: number) => {
    setDamping(ROOM_STYLES[style ?? 'hall']?.damp ?? REVERB_DAMP_HZ);
    const rate = context.sampleRate;
    const [l, r] = roomChannels(style ?? 'hall', designedDecay(decay), rate);
    const buffer = context.createBuffer(2, l.length, rate);
    buffer.copyToChannel(l, 0);
    buffer.copyToChannel(r, 1);
    setImpulse(buffer);
  };
  // A recorded room: its impulse response (a sound in the library) goes into the convolver in
  // place of the generated one, so the sends, filters and exports all stay as they are
  let roomToken = 0;
  const loadRoom = async (recorded: string | undefined) => {
    const token = ++roomToken;
    cancelRebuild();
    if (!recorded) {
      designed(current.roomStyle, current.reverbDecay);
      return;
    }
    setLush(false);
    try {
      const buffer = roomImpulse(await decodeSound(recorded, context.sampleRate), context);
      if (token === roomToken) {
        setDamping(RECORDED_ROOM_DAMP_HZ);
        setImpulse(buffer);
      }
    } catch {
      // Not in this browser any more: the generated room stands in
      if (token === roomToken) designed(current.roomStyle, current.reverbDecay);
    }
  };
  // A decay change waiting to be built (see REBUILD_QUIET_MS)
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let rebuildFirst = 0;
  const cancelRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
    rebuildFirst = 0;
  };
  const rebuild = () => {
    cancelRebuild();
    if (disposed || current.room) return;
    // Only the lush reverb's decay changed: nothing to build (the lush style's impulse response
    // is the hall's, for when the lush reverb isn't running)
    if (lushOn && current.roomStyle === 'lush') return;
    designed(current.roomStyle, current.reverbDecay);
  };
  const rebuildSoon = () => {
    // An export's offline context builds at once (nothing is heard until it renders)
    if (context.isOffline) return rebuild();
    const now = performance.now();
    if (!rebuildFirst) rebuildFirst = now;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, Math.max(0, Math.min(REBUILD_QUIET_MS, rebuildFirst + REBUILD_MAX_WAIT_MS - now)));
  };

  // The lush reverb: loaded into the context the first time it's wanted, its node made while
  // it's chosen and let go once it has faded out
  const lushDesign = ROOM_STYLES.lush;
  let lushLoaded = false;
  let lushLoading: Promise<void> | null = null;
  let lush: AudioWorkletNode | null = null;
  let lushOn = false;
  let convolverFed = true;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const wantsLush = (f: MasterFx) => !f.room && f.roomStyle === 'lush';
  const loadLush = () => {
    lushLoading ??= loadWorklet(context, LUSH_PROCESSOR, LUSH_WORKLET_SOURCE).then(
      () => {
        lushLoaded = true;
        if (!disposed && wantsLush(current)) setLush(true);
      },
      (err) => {
        // Stays on the hall convolver
        console.warn('The lush reverb could not start; using the hall:', err);
      }
    );
    return lushLoading;
  };
  // Switch with a quarter-second crossfade while playing, so the sound never drops out; at once
  // before the sound starts (an export's first moment, or before the first click)
  const setLush = (on: boolean) => {
    if (on && !lushLoaded) {
      void loadLush();
      return;
    }
    if (on === lushOn) return;
    lushOn = on;
    clearTimeout(fadeTimer);
    const fade = context.state === 'running' ? 0.25 : 0;
    if (on) {
      // (The lush reverb runs at half the sample rate, on what's under its damping)
      setDamping(REVERB_DAMP_HZ);
      if (!lush) {
        lush = createWorkletNode(context, LUSH_PROCESSOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
          processorOptions: { low: lushDesign.low, preDelay: LUSH_PRE_DELAY },
        });
        lush.parameters.get('high')!.value = lushDesign.high;
        damp.connect(lush);
        Tone.connect(lush, lushOut);
      }
      lush.parameters.get('decay')!.value = lushDecay(current.reverbDecay);
    } else if (!convolverFed) {
      damp.connect(convIn);
      convolverFed = true;
    }
    if (fade > 0) {
      convOut.gain.rampTo(on ? 0 : 1, fade);
      lushOut.gain.rampTo(on ? 1 : 0, fade);
    } else {
      convOut.gain.cancelScheduledValues(0);
      lushOut.gain.cancelScheduledValues(0);
      convOut.gain.value = on ? 0 : 1;
      lushOut.gain.value = on ? 1 : 0;
    }
    // Once faded out, the one not playing stops costing anything: the convolver gets no more
    // sound (so it goes quiet), and the worklet is let go
    const settle = () => {
      if (disposed) return;
      if (on && convolverFed) {
        damp.disconnect(convIn);
        convolverFed = false;
      } else if (!on && lush) {
        dropLush();
      }
    };
    if (fade > 0) fadeTimer = setTimeout(settle, (fade + 0.1) * 1000);
    else settle();
  };
  const dropLush = () => {
    if (!lush) return;
    lush.port.postMessage('dispose');
    damp.disconnect(lush);
    lush.disconnect();
    lush = null;
  };

  let disposed = false;
  let current = { ...fx };
  const start = async () => {
    if (current.room) return loadRoom(current.room);
    // An export waits for the lush reverb, so it renders with it from the first sample (and only
    // needs the hall's impulse response if it can't run)
    if (wantsLush(current)) await loadLush();
    if (!lushOn) designed(current.roomStyle, current.reverbDecay);
  };
  return {
    delay,
    reverbInput,
    delayInput,
    ready: start(),
    impulse: () => room.convolver.buffer ?? undefined,
    useImpulse: (buffer) => {
      roomToken++;
      cancelRebuild();
      setImpulse(buffer);
    },
    apply: (next, tempo) => {
      const before = current;
      current = { ...next };
      if (next.room !== before.room) void loadRoom(next.room);
      else if (!next.room && (next.reverbDecay !== before.reverbDecay || next.roomStyle !== before.roomStyle)) {
        // Rebuilding the impulse response takes a moment: only when the room changes, and a
        // decay being dragged once the drag pauses (see rebuildSoon). A new style is a click,
        // built at once (the lush reverb may be handing over to the convolver right now).
        roomToken++;
        if (next.roomStyle !== before.roomStyle) rebuild();
        else rebuildSoon();
      }
      setLush(wantsLush(next));
      if (lush) lush.parameters.get('decay')!.value = lushDecay(next.reverbDecay);
      delay.setDelayTime(delaySeconds(next.delayTime, tempo), 0.05);
      delay.setFeedback(Math.max(0, Math.min(0.8, next.delayFeedback)), 0.05);
    },
    dispose: () => {
      roomToken++;
      disposed = true;
      cancelRebuild();
      clearTimeout(fadeTimer);
      dropLush();
      if (ringing) {
        clearTimeout(ringing.timer);
        dropRoom(ringing.room);
      }
      dropRoom(room);
      [reverbInput, lowCut, damp, convIn, convOut, lushOut, delayInput, delay].forEach((n) => n.dispose());
    },
  };
}

/** Longest recorded room kept (seconds): a longer tail is faded out there */
export const ROOM_MAX_SECONDS = 12;
/** The decay a designed room is built with, for the reverb's `decay` setting (seconds). */
export const designedDecay = (decay: number) => Math.max(0.8, Math.min(12, decay));

/**
 * A room recording made ready for the convolver: mono or stereo (a recording with more channels
 * keeps its first two), its leading silence taken off so the hall answers on time, and no longer
 * than ROOM_MAX_SECONDS, faded at the cut.
 */
function roomImpulse(source: AudioBuffer, context: Tone.BaseContext): AudioBuffer {
  const rate = source.sampleRate;
  const channels = Math.min(2, source.numberOfChannels);
  let peak = 0;
  for (let c = 0; c < channels; c++) for (const v of source.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  let start = 0;
  const threshold = peak * 0.05;
  outer: for (; start < source.length; start++) for (let c = 0; c < channels; c++) if (Math.abs(source.getChannelData(c)[start]) >= threshold) break outer;
  // A millisecond before the first reflection, so its attack isn't clipped
  start = Math.max(0, start - Math.round(rate * 0.001));
  const length = Math.max(1, Math.min(source.length - start, Math.round(ROOM_MAX_SECONDS * rate)));
  const out = context.createBuffer(channels, length, rate);
  const fade = Math.min(length, Math.round(rate * 0.5));
  const cut = length < source.length - start;
  for (let c = 0; c < channels; c++) {
    const data = source.getChannelData(c).subarray(start, start + length);
    const copy = new Float32Array(data);
    if (cut) for (let i = 0; i < fade; i++) copy[length - 1 - i] *= i / fade;
    out.copyToChannel(copy, c);
  }
  return out;
}
