/**
 * The modern sound effects engine's parts (sfxSynth.ts uses them for a sound with `modern` on; a
 * classic sound renders as it always has):
 *   - band-limited square and saw (PolyBLEP), so high notes don't fold back into gritty tones;
 *   - material bodies: a struck object simulated by its resonances (modes), each a decaying
 *     two-pole resonator, with the mode ratios, levels and ring times of wood, metal, glass, stone,
 *     plastic or a stretched skin, so a hit sounds like the thing that was hit;
 *   - recordings: public-domain foley (footsteps, cloth, water, debris...) played as a layer, from a
 *     registry the app fills when they've loaded (sfxRecordings.ts), so this file stays pure;
 *   - a stereo space: early reflections, then a stereo reverb (Freeverb, the right channel's delays
 *     a little longer), and a ping-pong echo.
 * Plain arrays in and out, so Node can test it.
 */

/** PolyBLEP: the correction that smooths a jump in a waveform at phase `t` (0..1), `dt` the phase step. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export const SFX_MATERIALS = ['wood', 'metal', 'glass', 'stone', 'plastic', 'skin'] as const;
export type SfxMaterial = (typeof SFX_MATERIALS)[number];

export const SFX_MATERIAL_LABELS: Record<SfxMaterial, string> = { wood: 'Wood', metal: 'Metal', glass: 'Glass', stone: 'Stone', plastic: 'Plastic', skin: 'Skin' };

/**
 * Each material's modes: frequency ratios to the lowest, levels, the lowest's ring time (seconds,
 * to -60 dB), and how much faster each higher mode dies away (its ring time over 1 + k * fall).
 * Ratios from struck bars and plates (wood and metal bars, a glass's bending modes, a circular
 * membrane for skin); stone is many close modes that die at once, so it reads as a dull knock.
 */
const MATERIALS: Record<SfxMaterial, { ratios: number[]; levels: number[]; ring: number; fall: number }> = {
  wood: { ratios: [1, 2.57, 4.21, 6.24, 8.69], levels: [1, 0.55, 0.32, 0.18, 0.1], ring: 0.12, fall: 0.9 },
  metal: { ratios: [1, 2.756, 5.404, 8.933, 13.344, 19.9], levels: [1, 0.8, 0.62, 0.45, 0.3, 0.2], ring: 1.3, fall: 0.3 },
  glass: { ratios: [1, 2.32, 4.25, 6.63, 9.38], levels: [1, 0.7, 0.5, 0.3, 0.2], ring: 0.7, fall: 0.5 },
  stone: { ratios: [1, 1.48, 2.1, 2.9, 3.7, 4.6, 5.9], levels: [1, 0.9, 0.75, 0.6, 0.45, 0.35, 0.25], ring: 0.045, fall: 0.25 },
  plastic: { ratios: [1, 1.71, 2.86, 4.13], levels: [1, 0.5, 0.3, 0.15], ring: 0.07, fall: 0.6 },
  skin: { ratios: [1, 1.594, 2.136, 2.296, 2.653, 2.918], levels: [1, 0.6, 0.45, 0.35, 0.25, 0.2], ring: 0.18, fall: 0.4 },
};

/** How long a body rings after it's struck, seconds (its longest mode, to -60 dB). */
export const bodyRing = (material: SfxMaterial, ring: number) => MATERIALS[material].ring * ring;

/**
 * A struck object: a bank of resonators at `freq` times the material's ratios. `ring` scales the
 * ring time (1: the material's own); `detune` (from the seed) moves each mode a little, so no two
 * objects are quite the same. Feed it the strike (a click, a noise burst, a thump) sample by sample.
 */
export class ModalBody {
  private b0: Float64Array;
  private a1: Float64Array;
  private a2: Float64Array;
  private y1: Float64Array;
  private y2: Float64Array;
  constructor(material: SfxMaterial, freq: number, ring: number, sampleRate: number, detune: () => number) {
    const m = MATERIALS[material];
    const modes = m.ratios
      .map((ratio, k) => ({ f: freq * ratio * (1 + (detune() * 2 - 1) * 0.02), level: m.levels[k], t60: Math.max(0.005, (m.ring * ring) / (1 + k * m.fall)) }))
      .filter((x) => x.f < sampleRate * 0.45 && x.f > 20);
    const n = modes.length;
    this.b0 = new Float64Array(n);
    this.a1 = new Float64Array(n);
    this.a2 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.y2 = new Float64Array(n);
    modes.forEach((x, k) => {
      const w = (2 * Math.PI * x.f) / sampleRate;
      const r = Math.exp(-6.9 / (x.t60 * sampleRate));
      this.a1[k] = 2 * r * Math.cos(w);
      this.a2[k] = -r * r;
      // An impulse in gives a ring that starts at `level`
      this.b0[k] = x.level * Math.sin(w);
    });
  }
  run(x: number): number {
    let out = 0;
    for (let k = 0; k < this.b0.length; k++) {
      const y = this.b0[k] * x + this.a1[k] * this.y1[k] + this.a2[k] * this.y2[k];
      this.y2[k] = this.y1[k];
      this.y1[k] = y;
      out += y;
    }
    return out;
  }
}

/** A recording for a layer: its samples (mono) and their rate. */
export interface SfxRecordingData {
  samples: Float32Array;
  sampleRate: number;
}

/** Where the recordings come from: group and take, once loaded (sfxRecordings.ts sets this). */
let recordingSource: (group: string, take: number) => SfxRecordingData | undefined = () => undefined;
/** How many takes each recording group has (so a layer's seed can pick one) */
let takesOf: (group: string) => number = () => 0;

export function setSfxRecordings(get: typeof recordingSource, takes: typeof takesOf): void {
  recordingSource = get;
  takesOf = takes;
}

/** The take a layer plays: chosen by its seed, so each variation of a sound picks another. */
export function recordingFor(group: string, seed: number): SfxRecordingData | undefined {
  const n = takesOf(group);
  if (!n) return undefined;
  return recordingSource(group, seed % n);
}

/** Stereo space over `L` and `R` in place: echo (ping-pong), early reflections and a stereo reverb. */
export function stereoSpace(L: Float32Array, R: Float32Array, o: { echo: number; echoTime: number; echoFeedback: number; reverb: number; room: number }, sampleRate: number): void {
  if (o.echo > 0) {
    // Ping-pong: each repeat on the other side
    const d = Math.max(1, Math.round(o.echoTime * sampleRate));
    const lineL = new Float32Array(d);
    const lineR = new Float32Array(d);
    for (let i = 0, p = 0; i < L.length; i++, p = (p + 1) % d) {
      const dl = lineL[p];
      const dr = lineR[p];
      lineL[p] = (L[i] + R[i]) * 0.5 + dr * o.echoFeedback;
      lineR[p] = dl * o.echoFeedback;
      L[i] += dl * o.echo;
      R[i] += dr * o.echo;
    }
  }
  if (o.reverb > 0) {
    const n = L.length;
    const dryL = L.slice();
    const dryR = R.slice();
    // Early reflections: a few taps a room of this size would send back, alternating sides
    const size = 0.3 + o.room * 0.9;
    const taps = [
      [0.0043, 0.84, 1],
      [0.0071, 0.7, -1],
      [0.0113, 0.6, 1],
      [0.0167, 0.5, -1],
      [0.0231, 0.42, 1],
      [0.0311, 0.34, -1],
    ].map(([t, g, side]) => ({ d: Math.round(t * size * sampleRate), g: g * 0.45, side }));
    const early = { L: new Float32Array(n), R: new Float32Array(n) };
    for (const tap of taps) {
      for (let i = tap.d; i < n; i++) {
        const v = (dryL[i - tap.d] + dryR[i - tap.d]) * 0.5 * tap.g;
        if (tap.side > 0) {
          early.L[i] += v;
          early.R[i] += v * 0.6;
        } else {
          early.R[i] += v;
          early.L[i] += v * 0.6;
        }
      }
    }
    // Late reverb: a Freeverb per side, the right's combs 23 samples longer (as Freeverb does)
    const scale = (sampleRate / 44100) * (0.5 + o.room * 0.8);
    const tank = (spread: number) => ({
      combs: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((c) => ({ buf: new Float32Array(Math.max(1, Math.round((c + spread) * scale))), p: 0, low: 0 })),
      alls: [556, 441, 341, 225].map((a) => ({ buf: new Float32Array(Math.max(1, Math.round((a + spread) * (sampleRate / 44100)))), p: 0 })),
    });
    const tanks = [tank(0), tank(23)];
    const feedback = 0.7 + o.room * 0.28;
    const damp = 0.3;
    const predelay = Math.round((0.008 + o.room * 0.02) * sampleRate);
    for (let i = 0; i < n; i++) {
      const j = i - predelay;
      const input = j >= 0 ? (dryL[j] + dryR[j]) * 0.5 * 0.15 : 0;
      for (let side = 0; side < 2; side++) {
        const t = tanks[side];
        let wet = 0;
        for (const c of t.combs) {
          const y = c.buf[c.p];
          c.low = y * (1 - damp) + c.low * damp;
          c.buf[c.p] = input + c.low * feedback;
          c.p = (c.p + 1) % c.buf.length;
          wet += y;
        }
        for (const a of t.alls) {
          const y = a.buf[a.p];
          a.buf[a.p] = wet + y * 0.5;
          a.p = (a.p + 1) % a.buf.length;
          wet = y - wet;
        }
        const target = side === 0 ? L : R;
        const dry = side === 0 ? dryL : dryR;
        const er = side === 0 ? early.L : early.R;
        target[i] = dry[i] * (1 - o.reverb * 0.4) + (er[i] * 0.6 + wet) * o.reverb;
      }
    }
  }
}
