/**
 * The Drop pad's effects: what a DJ does to the whole mix with a finger, held for as long as the
 * pad is held and in time with the song. Stutter repeats the 16th that was playing; Filter sweeps
 * the mix down to a muffle over a bar; Tape stop slows it to a halt over a beat; Crush makes it
 * gritty and lo-fi; Gate chops it into 16ths; Echo throws what's playing into a dotted-8th echo
 * that rings on after letting go. Several can be held at once.
 *
 * They run on the master, after the OTT and the width, before the Level and the limiter (so the
 * limiter still catches anything they push up). Live as an AudioWorklet (DROP_WORKLET_SOURCE);
 * in an export the same kernel runs over the render in plain JavaScript (masterAfter.ts), so a
 * song plays the same in both. Which effect starts and stops when comes from the Drop track's
 * notes (see dropMoves.ts); the kernel only hears "on" and "off" at a sample, with the song's 16th
 * at that moment in samples.
 *
 * Every change glides over a few milliseconds, so nothing clicks, and nothing here makes the mix
 * louder than it was by more than the echo's tail adds.
 */

/** The effects, in the order the kernel numbers them (and the Drop track's rows: see DROP_ROWS). */
export const DROP_EFFECTS = ['stutter', 'filter', 'tape', 'crush', 'gate', 'echo'] as const;
export type DropEffect = (typeof DROP_EFFECTS)[number];

export interface DropKernel {
  /** Start effect `fx` (its index in DROP_EFFECTS) at sample `frame`, with a 16th `sixteenth` samples long. */
  on: (fx: number, frame: number, sixteenth: number) => void;
  /** Let go of effect `fx` at sample `frame`. */
  off: (fx: number, frame: number) => void;
  /** Forget everything due from `frame` on, and let go of every effect there (a stop or a seek). */
  cancel: (frame: number) => void;
  /**
   * Process `frames` samples starting at sample `frame` (the context's own count: live, the
   * worklet's currentFrame; in an export, from the render's start). In place or into separate arrays.
   */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, frame: number) => void;
  /** Whether anything is on, ringing on, or due (else process only copies). */
  busy: () => boolean;
}

/**
 * The effects at one sample rate. SELF-CONTAINED: everything it needs is defined inside, since its
 * source is also the worklet's (see DROP_WORKLET_SOURCE).
 */
export function createDropKernel(sampleRate: number): DropKernel {
  const sr = sampleRate;
  /** Crossfades in and out of an effect (samples) */
  const FADE = Math.max(1, Math.round(0.004 * sr));
  const STUTTER_MAX = Math.round(2 * sr);
  const TAPE_MAX = Math.round(4 * sr);
  const ECHO_MAX = Math.round(3 * sr);
  /** The filter sweeps down to this over a bar, and back up over two 16ths after letting go */
  const FILTER_TOP = Math.min(18000, sr * 0.45);
  const FILTER_LOW = 300;
  const FILTER_Q = 1.3;
  /** Crush: the sample rate it holds down to, and the step its levels snap to */
  const CRUSH_RATE = 5500;
  const CRUSH_STEP = 1 / 32;
  const CRUSH_TRIM = 0.8;
  const ECHO_FEEDBACK = 0.55;
  const ECHO_WET = 0.45;

  /** type: 0 off, 1 on, 2 let go of everything */
  const events: Array<{ frame: number; type: 0 | 1 | 2; fx: number; sixteenth: number }> = [];
  /** Per effect: how many of its notes are held now */
  const held = [0, 0, 0, 0, 0, 0];
  /** Per effect: its wet share, gliding to 1 while held and back to 0 after */
  const wet = [0, 0, 0, 0, 0, 0];
  const sixteenthOf = [0, 0, 0, 0, 0, 0];
  /** Per effect: where its latest "on" was scheduled (an "off" never comes before its own "on") */
  const lastOn = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
  /**
   * Stutter and Tape stop start over when pressed again while they still sound: the jump from the
   * old sound to the new one glides away over FADE (its size at the restart, shrinking to 0)
   */
  const restarting = [false, false, false];
  const lastL = [0, 0, 0];
  const lastR = [0, 0, 0];
  const jumpL = [0, 0, 0];
  const jumpR = [0, 0, 0];
  const jumpLeft = [0, 0, 0];
  const startedAt = [0, 0, 0, 0, 0, 0];

  // Stutter: the 16th from the press, repeated
  const stL = new Float32Array(STUTTER_MAX);
  const stR = new Float32Array(STUTTER_MAX);
  let stLen = 1;
  let stPos = 0;
  let stFilled = false;
  // Tape stop: what came in since the press, read slower and slower
  const tpL = new Float32Array(TAPE_MAX);
  const tpR = new Float32Array(TAPE_MAX);
  let tpWrite = 0;
  let tpRead = 0;
  let tpT = 0;
  let tpLen = 1;
  // Filter: a low-pass biquad, its cutoff on a log scale
  const lnTop = Math.log(FILTER_TOP);
  const lnLow = Math.log(FILTER_LOW);
  let lnCut = lnTop;
  let fb0 = 1;
  let fb1 = 0;
  let fb2 = 0;
  let fa1 = 0;
  let fa2 = 0;
  const fz = [0, 0, 0, 0, 0, 0, 0, 0];
  let fCount = 0;
  // Crush
  const crushHold = Math.max(1, Math.round(sr / CRUSH_RATE));
  let crCount = 0;
  let crL = 0;
  let crR = 0;
  // Gate
  let gateGain = 1;
  // Echo: a delay line fed only while held, ringing on after
  const ecL = new Float32Array(ECHO_MAX);
  const ecR = new Float32Array(ECHO_MAX);
  let ecWrite = 0;
  let ecDelay = 1;
  let ecSend = 0;
  let ecLpL = 0;
  let ecLpR = 0;
  let ecPeak = 0;
  let ecRinging = false;
  const ecLpK = 1 - Math.exp((-2 * Math.PI * 3500) / sr);
  /** What's written into the line, followed slowly enough to last an echo's length of quiet */
  let ecDecay = 1;

  const setFilter = () => {
    const f = Math.exp(lnCut);
    const w = (2 * Math.PI * f) / sr;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * FILTER_Q);
    const a0 = 1 + alpha;
    const beta = (1 - cosw) / 2;
    fb0 = beta / a0;
    fb1 = (2 * beta) / a0;
    fb2 = beta / a0;
    fa1 = (-2 * cosw) / a0;
    fa2 = (1 - alpha) / a0;
  };
  setFilter();

  const start = (fx: number, frame: number, sixteenth: number) => {
    const six = Math.max(16, sixteenth);
    held[fx]++;
    sixteenthOf[fx] = six;
    startedAt[fx] = frame;
    if ((fx === 0 || fx === 2) && wet[fx] > 0) restarting[fx] = true;
    // A fresh start counts from its first sample, so live and the export (in other block sizes) match
    if (fx === 1 && wet[1] === 0) fCount = 0;
    if (fx === 3 && wet[3] === 0) crCount = 0;
    if (fx === 0) {
      stLen = Math.max(16, Math.min(STUTTER_MAX, Math.round(six)));
      stPos = 0;
      stFilled = false;
    } else if (fx === 2) {
      tpWrite = 0;
      tpRead = 0;
      tpT = 0;
      tpLen = Math.max(16, Math.min(TAPE_MAX / 2, Math.round(4 * six)));
    } else if (fx === 4) {
      if (wet[4] === 0) gateGain = 1;
    } else if (fx === 5) {
      // The echo's time is set when it starts from quiet (changing it while it rings would jump)
      if (!ecRinging) {
        ecDelay = Math.max(16, Math.min(ECHO_MAX - 1, Math.round(3 * six)));
        ecDecay = Math.exp(-1 / ecDelay);
        ecL.fill(0);
        ecR.fill(0);
        ecLpL = 0;
        ecLpR = 0;
      }
      ecRinging = true;
    }
  };
  const stop = (fx: number) => {
    if (held[fx] > 0) held[fx]--;
  };

  const schedule = (ev: { frame: number; type: 0 | 1 | 2; fx: number; sixteenth: number }) => {
    let i = events.length;
    // In frame order, an "off" before an "on" at the same frame (a note ending where the next starts)
    while (i > 0 && (events[i - 1].frame > ev.frame || (events[i - 1].frame === ev.frame && ev.type === 0 && events[i - 1].type === 1))) i--;
    events.splice(i, 0, ev);
  };

  /** An effect's output sample, with any restart's jump gliding away (see restarting). */
  const glide = (fx: number, l: number, r: number): [number, number] => {
    if (restarting[fx]) {
      restarting[fx] = false;
      jumpL[fx] = lastL[fx] - l;
      jumpR[fx] = lastR[fx] - r;
      jumpLeft[fx] = FADE;
    }
    if (jumpLeft[fx] > 0) {
      const k = jumpLeft[fx]-- / FADE;
      l += jumpL[fx] * k;
      r += jumpR[fx] * k;
    }
    lastL[fx] = l;
    lastR[fx] = r;
    return [l, r];
  };

  /** Each effect over [from, to) of the working arrays, in place. */
  const run = (L: Float32Array, R: Float32Array, from: number, to: number) => {
    // Stutter
    if (held[0] > 0 || wet[0] > 0) {
      const want = held[0] > 0 ? 1 : 0;
      const seam = Math.max(1, Math.min(FADE, stLen >> 2));
      for (let i = from; i < to; i++) {
        let w = wet[0];
        if (w !== want) wet[0] = w = want > w ? Math.min(1, w + 1 / FADE) : Math.max(0, w - 1 / FADE);
        let l = L[i];
        let r = R[i];
        if (!stFilled) {
          stL[stPos] = l;
          stR[stPos] = r;
          // Its last few ms fade out as every repeat's do, so the first repeat follows without a jump
          const g = Math.min(1, (stLen - stPos) / seam);
          l = l * (1 - w) + l * g * w;
          r = r * (1 - w) + r * g * w;
          if (++stPos >= stLen) {
            stPos = 0;
            stFilled = true;
          }
        } else {
          const k = stPos;
          const g = Math.min(1, (k + 1) / seam, (stLen - k) / seam);
          const sl = stL[k] * g;
          const sr2 = stR[k] * g;
          if (++stPos >= stLen) stPos = 0;
          l = l * (1 - w) + sl * w;
          r = r * (1 - w) + sr2 * w;
        }
        [l, r] = glide(0, l, r);
        L[i] = l;
        R[i] = r;
      }
    }
    // Tape stop
    if (held[2] > 0 || wet[2] > 0) {
      const want = held[2] > 0 ? 1 : 0;
      for (let i = from; i < to; i++) {
        let w = wet[2];
        if (w !== want) wet[2] = w = want > w ? Math.min(1, w + 1 / (2 * FADE)) : Math.max(0, w - 1 / (2 * FADE));
        const l = L[i];
        const r = R[i];
        let ol = 0;
        let or = 0;
        if (tpWrite < TAPE_MAX) {
          tpL[tpWrite] = l;
          tpR[tpWrite] = r;
          tpWrite++;
        }
        const rate = Math.max(0, 1 - tpT / tpLen);
        if (rate > 0) {
          const j = Math.floor(tpRead);
          const frac = tpRead - j;
          const j2 = Math.min(j + 1, tpWrite - 1);
          // Fades out as it slows, so it ends in silence rather than a held level
          const g = Math.min(1, rate * 6);
          ol = (tpL[j] + (tpL[j2] - tpL[j]) * frac) * g;
          or = (tpR[j] + (tpR[j2] - tpR[j]) * frac) * g;
          tpRead += rate;
          if (tpRead > tpWrite - 1) tpRead = tpWrite - 1;
        }
        tpT++;
        const [gl, gr] = glide(2, l * (1 - w) + ol * w, r * (1 - w) + or * w);
        L[i] = gl;
        R[i] = gr;
      }
    }
    // Filter
    if (held[1] > 0 || wet[1] > 0) {
      const six = sixteenthOf[1];
      const down = (lnTop - lnLow) / (16 * six);
      const up = (lnTop - lnLow) / (2 * six);
      for (let i = from; i < to; i++) {
        let w = wet[1];
        if (held[1] > 0) {
          if (w < 1) wet[1] = w = Math.min(1, w + 1 / FADE);
          lnCut = Math.max(lnLow, lnCut - down);
        } else {
          lnCut = Math.min(lnTop, lnCut + up);
          if (lnCut >= lnTop && w > 0) wet[1] = w = Math.max(0, w - 1 / FADE);
        }
        if ((fCount++ & 15) === 0) setFilter();
        const l = L[i];
        const r = R[i];
        const yl = fb0 * l + fb1 * fz[0] + fb2 * fz[1] - fa1 * fz[2] - fa2 * fz[3];
        fz[1] = fz[0];
        fz[0] = l;
        fz[3] = fz[2];
        fz[2] = yl;
        const yr = fb0 * r + fb1 * fz[4] + fb2 * fz[5] - fa1 * fz[6] - fa2 * fz[7];
        fz[5] = fz[4];
        fz[4] = r;
        fz[7] = fz[6];
        fz[6] = yr;
        L[i] = l * (1 - w) + yl * w;
        R[i] = r * (1 - w) + yr * w;
      }
      if (wet[1] === 0 && held[1] === 0) fz.fill(0);
    }
    // Crush
    if (held[3] > 0 || wet[3] > 0) {
      const want = held[3] > 0 ? 1 : 0;
      for (let i = from; i < to; i++) {
        let w = wet[3];
        if (w !== want) wet[3] = w = want > w ? Math.min(1, w + 1 / FADE) : Math.max(0, w - 1 / FADE);
        const l = L[i];
        const r = R[i];
        if (crCount++ % crushHold === 0) {
          crL = Math.round(l / CRUSH_STEP) * CRUSH_STEP * CRUSH_TRIM;
          crR = Math.round(r / CRUSH_STEP) * CRUSH_STEP * CRUSH_TRIM;
        }
        L[i] = l * (1 - w) + crL * w;
        R[i] = r * (1 - w) + crR * w;
      }
    }
    // Gate: open for the first half of each 16th from the press
    if (held[4] > 0 || wet[4] > 0) {
      const want = held[4] > 0 ? 1 : 0;
      const six = sixteenthOf[4];
      const half = six / 2;
      const step = 1 / Math.max(1, Math.min(FADE / 2, half / 4));
      for (let i = from; i < to; i++) {
        let w = wet[4];
        if (w !== want) wet[4] = w = want > w ? Math.min(1, w + 1 / FADE) : Math.max(0, w - 1 / FADE);
        const p = (i + base - startedAt[4]) % six;
        const target = p < half ? 1 : 0;
        if (gateGain !== target) gateGain = target > gateGain ? Math.min(1, gateGain + step) : Math.max(0, gateGain - step);
        const g = 1 - w + w * gateGain;
        L[i] *= g;
        R[i] *= g;
      }
    }
    // Echo: always dry plus the echoes
    if (held[5] > 0 || ecRinging) {
      const want = held[5] > 0 ? 1 : 0;
      for (let i = from; i < to; i++) {
        if (ecSend !== want) ecSend = want > ecSend ? Math.min(1, ecSend + 1 / FADE) : Math.max(0, ecSend - 1 / FADE);
        let rd = ecWrite - ecDelay;
        if (rd < 0) rd += ECHO_MAX;
        const yl = ecL[rd];
        const yr = ecR[rd];
        ecLpL += (yl - ecLpL) * ecLpK;
        ecLpR += (yr - ecLpR) * ecLpK;
        // (Tiny values flushed to 0: denormals held over silence are slow to work with)
        if (ecLpL < 1e-20 && ecLpL > -1e-20) ecLpL = 0;
        if (ecLpR < 1e-20 && ecLpR > -1e-20) ecLpR = 0;
        const l = L[i];
        const r = R[i];
        ecL[ecWrite] = l * ecSend + ecLpL * ECHO_FEEDBACK;
        ecR[ecWrite] = r * ecSend + ecLpR * ECHO_FEEDBACK;
        if (++ecWrite >= ECHO_MAX) ecWrite = 0;
        L[i] = l + yl * ECHO_WET;
        R[i] = r + yr * ECHO_WET;
        const a = Math.abs(ecL[ecWrite === 0 ? ECHO_MAX - 1 : ecWrite - 1]) + Math.abs(ecR[ecWrite === 0 ? ECHO_MAX - 1 : ecWrite - 1]);
        ecPeak = a > ecPeak ? a : ecPeak * ecDecay;
      }
      // Rung out: quiet for longer than an echo and nothing feeding it
      if (held[5] === 0 && ecSend === 0 && ecPeak < 3e-5) ecRinging = false;
    }
  };

  /** The frame `run` index 0 stands for (the gate counts from the press) */
  let base = 0;

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, frame: number) => {
    if (outL !== inL) for (let i = 0; i < frames; i++) outL[i] = inL[i];
    if (outR !== inR) for (let i = 0; i < frames; i++) outR[i] = inR[i];
    base = frame;
    let at = 0;
    while (at < frames) {
      // Events due before this block's next sample apply now
      while (events.length && events[0].frame <= frame + at) {
        const ev = events.shift()!;
        if (ev.type === 1) start(ev.fx, Math.max(ev.frame, frame + at), ev.sixteenth);
        else if (ev.type === 0) stop(ev.fx);
        else held.fill(0);
      }
      const next = events.length ? Math.min(frames, events[0].frame - frame) : frames;
      const end = Math.max(at + 1, next);
      if (anyActive()) run(outL, outR, at, end);
      at = end;
    }
  };

  const anyActive = () => {
    for (let fx = 0; fx < 5; fx++) if (held[fx] > 0 || wet[fx] > 0) return true;
    return held[5] > 0 || ecRinging;
  };

  return {
    on: (fx: number, frame: number, sixteenth: number) => {
      lastOn[fx] = frame;
      schedule({ frame, type: 1, fx, sixteenth });
    },
    // At least a sample after its own "on" (one at the same frame would be put before it, and the effect left on)
    off: (fx: number, frame: number) => schedule({ frame: Math.max(frame, lastOn[fx] + 1), type: 0, fx, sixteenth: 0 }),
    cancel: (frame: number) => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].frame >= frame) events.splice(i, 1);
      schedule({ frame, type: 2, fx: 0, sixteenth: 0 });
    },
    process,
    busy: () => events.length > 0 || anyActive(),
  };
}

/** The worklet processor's name. */
export const DROP_PROCESSOR = 'bbx-drop';

/**
 * The AudioWorklet module: the kernel above, told when to start and stop each effect by messages
 * carrying audio-clock times (`{ on, at, sixteenth }`, `{ off, at }`, `{ cancel, at }`), which it
 * turns into samples. A 'dispose' message stops it for good.
 */
export const DROP_WORKLET_SOURCE = `
const createDropKernel = ${createDropKernel.toString()};
class DropProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = createDropKernel(sampleRate);
    this.alive = true;
    this.silence = new Float32Array(128);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m === 'dispose') { this.alive = false; return; }
      const at = Math.max(currentFrame, Math.round((m.at || 0) * sampleRate));
      if (m.on !== undefined) this.kernel.on(m.on, at, m.sixteenth * sampleRate);
      else if (m.off !== undefined) this.kernel.off(m.off, at);
      else if (m.cancel) this.kernel.cancel(at);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = input.length > 0 ? input[0] : this.silence;
    const inR = input.length > 1 ? input[1] : inL;
    this.kernel.process(inL, inR, outL, outR, frames, currentFrame);
    return this.alive;
  }
}
registerProcessor('${DROP_PROCESSOR}', DropProcessor);
`;
