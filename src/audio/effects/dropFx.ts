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
  /** Let go of effect `fx` at sample `frame`, of the note that started at sample `from` (if known). */
  off: (fx: number, frame: number, from?: number) => void;
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
  /** Per effect: where its latest "on" was scheduled (an "off" given without its own "on" comes after this) */
  const lastOn = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
  const startedAt = [0, 0, 0, 0, 0, 0];

  /*
   * Stutter and Tape stop each have two voices. Pressed again while it still sounds, the effect
   * starts over on the other voice, and the old one crossfades out over FADE as the new one comes
   * in: never louder than either, and no click.
   */
  // Stutter: the 16th from the press, repeated
  const stutterVoice = () => ({ L: new Float32Array(STUTTER_MAX), R: new Float32Array(STUTTER_MAX), len: 1, pos: 0, filled: false });
  const st = [stutterVoice(), stutterVoice()];
  let stNow = 0;
  /** Samples left of the old voice's crossfade out (0: none) */
  let stFade = 0;
  // Tape stop: what came in since the press, read slower and slower
  const tapeVoice = () => ({ L: new Float32Array(TAPE_MAX), R: new Float32Array(TAPE_MAX), write: 0, read: 0, t: 0, len: 1 });
  const tp = [tapeVoice(), tapeVoice()];
  let tpNow = 0;
  let tpFade = 0;
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
    // A fresh start counts from its first sample, so live and the export (in other block sizes) match
    if (fx === 1 && wet[1] === 0) fCount = 0;
    if (fx === 3 && wet[3] === 0) crCount = 0;
    if (fx === 0) {
      // Still sounding: the new start on the other voice, the old one fading out
      if (wet[0] > 0) {
        stNow ^= 1;
        stFade = FADE;
      } else stFade = 0;
      const v = st[stNow];
      v.len = Math.max(16, Math.min(STUTTER_MAX, Math.round(six)));
      v.pos = 0;
      v.filled = false;
    } else if (fx === 2) {
      if (wet[2] > 0) {
        tpNow ^= 1;
        tpFade = FADE;
      } else tpFade = 0;
      const v = tp[tpNow];
      v.write = 0;
      v.read = 0;
      v.t = 0;
      v.len = Math.max(16, Math.min(TAPE_MAX / 2, Math.round(4 * six)));
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

  /** A stutter voice's next sample for input l/r (the input itself while it takes its 16th in), into `out`. */
  const stutterAt = (v: ReturnType<typeof stutterVoice>, l: number, r: number, out: number[]) => {
    const seam = Math.max(1, Math.min(FADE, v.len >> 2));
    if (!v.filled) {
      v.L[v.pos] = l;
      v.R[v.pos] = r;
      // Its last few ms fade out as every repeat's do, so the first repeat follows without a jump
      const g = Math.min(1, (v.len - v.pos) / seam);
      out[0] = l * g;
      out[1] = r * g;
      if (++v.pos >= v.len) {
        v.pos = 0;
        v.filled = true;
      }
      return;
    }
    const k = v.pos;
    const g = Math.min(1, (k + 1) / seam, (v.len - k) / seam);
    out[0] = v.L[k] * g;
    out[1] = v.R[k] * g;
    if (++v.pos >= v.len) v.pos = 0;
  };
  /** A tape voice's next sample for input l/r, into `out`. */
  const tapeAt = (v: ReturnType<typeof tapeVoice>, l: number, r: number, out: number[]) => {
    if (v.write < TAPE_MAX) {
      v.L[v.write] = l;
      v.R[v.write] = r;
      v.write++;
    }
    out[0] = 0;
    out[1] = 0;
    const rate = Math.max(0, 1 - v.t / v.len);
    if (rate > 0) {
      const j = Math.floor(v.read);
      const frac = v.read - j;
      const j2 = Math.min(j + 1, v.write - 1);
      // Fades out as it slows, so it ends in silence rather than a held level
      const g = Math.min(1, rate * 6);
      out[0] = (v.L[j] + (v.L[j2] - v.L[j]) * frac) * g;
      out[1] = (v.R[j] + (v.R[j2] - v.R[j]) * frac) * g;
      v.read += rate;
      if (v.read > v.write - 1) v.read = v.write - 1;
    }
    v.t++;
  };
  const fresh = [0, 0];
  const old = [0, 0];

  /** Each effect over [from, to) of the working arrays, in place. */
  const run = (L: Float32Array, R: Float32Array, from: number, to: number) => {
    // Stutter
    if (held[0] > 0 || wet[0] > 0) {
      const want = held[0] > 0 ? 1 : 0;
      for (let i = from; i < to; i++) {
        let w = wet[0];
        if (w !== want) wet[0] = w = want > w ? Math.min(1, w + 1 / FADE) : Math.max(0, w - 1 / FADE);
        const l = L[i];
        const r = R[i];
        stutterAt(st[stNow], l, r, fresh);
        let el = fresh[0];
        let er = fresh[1];
        if (stFade > 0) {
          stutterAt(st[stNow ^ 1], l, r, old);
          const k = stFade-- / FADE;
          el = el * (1 - k) + old[0] * k;
          er = er * (1 - k) + old[1] * k;
        }
        L[i] = l * (1 - w) + el * w;
        R[i] = r * (1 - w) + er * w;
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
        tapeAt(tp[tpNow], l, r, fresh);
        let el = fresh[0];
        let er = fresh[1];
        if (tpFade > 0) {
          tapeAt(tp[tpNow ^ 1], l, r, old);
          const k = tpFade-- / FADE;
          el = el * (1 - k) + old[0] * k;
          er = er * (1 - k) + old[1] * k;
        }
        L[i] = l * (1 - w) + el * w;
        R[i] = r * (1 - w) + er * w;
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
    // At least a sample after its own "on" (`from`; else the effect's latest), else an "off" at the
    // same frame would be put before it and the effect left on
    off: (fx: number, frame: number, from?: number) => schedule({ frame: Math.max(frame, (from ?? lastOn[fx]) + 1), type: 0, fx, sixteenth: 0 }),
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
 * carrying audio-clock times (`{ on, at, sixteenth }`, `{ off, at, from }`, `{ cancel, at }`), which it
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
      else if (m.off !== undefined) this.kernel.off(m.off, at, m.from === undefined ? undefined : Math.max(currentFrame, Math.round(m.from * sampleRate)));
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
