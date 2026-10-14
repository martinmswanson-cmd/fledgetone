/**
 * The Synth Designer's settings (a "patch"): two oscillators with unison, a sub and noise, a
 * filter with its own envelope, an amp envelope, an LFO, drive and glide. Stored on the track
 * (Track.synth) and saved with the project; the sound engine is src/audio/presets/designer.ts.
 */

export type OscWave = 'sine' | 'triangle' | 'sawtooth' | 'square';
export const OSC_WAVES: OscWave[] = ['sawtooth', 'square', 'triangle', 'sine'];

export interface OscSettings {
  on: boolean;
  wave: OscWave;
  /** Octaves up or down, -3 to 3 */
  octave: number;
  /** Semitones up or down, -12 to 12 */
  semi: number;
  /** Cents, -100 to 100 */
  fine: number;
  /** 0 to 1 */
  level: number;
}

export interface Envelope {
  /** Seconds */
  attack: number;
  /** Seconds */
  decay: number;
  /** 0 to 1 */
  sustain: number;
  /** Seconds */
  release: number;
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type LfoTarget = 'off' | 'pitch' | 'filter' | 'amp';
export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth';
/** An LFO rate as a note value (tempo-synced) or 'free' (Hz). */
export const LFO_SYNC = ['free', '1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export type LfoSync = (typeof LFO_SYNC)[number];

export interface SynthPatch {
  osc1: OscSettings;
  osc2: OscSettings;
  /** A sine an octave below osc 1, 0 to 1 */
  sub: number;
  /** White noise, 0 to 1 */
  noise: number;
  /** Copies of each oscillator, 1 to 7, detuned across `spread` cents and panned across `width` */
  unison: { voices: number; spread: number; width: number };
  filter: {
    type: FilterType;
    /** Hz, 20 to 20000 */
    cutoff: number;
    /** 0.1 to 20 */
    resonance: number;
    /** How far the filter envelope opens it, in octaves, -6 to 6 */
    envAmount: number;
    /** How much the cutoff follows the note (1 = an octave per octave), 0 to 1 */
    keyTrack: number;
  };
  filterEnv: Envelope;
  amp: Envelope;
  lfo: { target: LfoTarget; shape: LfoShape; sync: LfoSync; /** Hz, when free */ rate: number; /** 0 to 1 */ depth: number };
  /** Soft clipping after the filter, 0 (off) to 1 */
  drive: number;
  /** One note at a time, sliding between them */
  mono: boolean;
  /** Seconds to slide from the last note (mono) */
  glide: number;
  /** Output level in dB, -24 to 6 */
  level: number;
}

const osc = (patch: Partial<OscSettings> = {}): OscSettings => ({ on: true, wave: 'sawtooth', octave: 0, semi: 0, fine: 0, level: 0.8, ...patch });
const env = (attack: number, decay: number, sustain: number, release: number): Envelope => ({ attack, decay, sustain, release });

export function defaultSynthPatch(): SynthPatch {
  return {
    osc1: osc(),
    osc2: osc({ on: false, wave: 'square', fine: 7, level: 0.6 }),
    sub: 0,
    noise: 0,
    unison: { voices: 1, spread: 20, width: 0.7 },
    filter: { type: 'lowpass', cutoff: 2400, resonance: 1, envAmount: 2, keyTrack: 0.5 },
    filterEnv: env(0.005, 0.4, 0.3, 0.3),
    amp: env(0.005, 0.3, 0.8, 0.25),
    lfo: { target: 'off', shape: 'sine', sync: '1/8', rate: 4, depth: 0.5 },
    drive: 0,
    mono: false,
    glide: 0.06,
    level: 2,
  };
}

type PatchEdit = Partial<Omit<SynthPatch, 'osc1' | 'osc2' | 'unison' | 'filter' | 'filterEnv' | 'amp' | 'lfo'>> & {
  osc1?: Partial<OscSettings>;
  osc2?: Partial<OscSettings>;
  unison?: Partial<SynthPatch['unison']>;
  filter?: Partial<SynthPatch['filter']>;
  filterEnv?: Partial<Envelope>;
  amp?: Partial<Envelope>;
  lfo?: Partial<SynthPatch['lfo']>;
};

/** A copy of `base` with parts changed (nested settings merge). */
export function withPatch(base: SynthPatch, edit: PatchEdit): SynthPatch {
  return {
    ...base,
    ...edit,
    osc1: { ...base.osc1, ...edit.osc1 },
    osc2: { ...base.osc2, ...edit.osc2 },
    unison: { ...base.unison, ...edit.unison },
    filter: { ...base.filter, ...edit.filter },
    filterEnv: { ...base.filterEnv, ...edit.filterEnv },
    amp: { ...base.amp, ...edit.amp },
    lfo: { ...base.lfo, ...edit.lfo },
  };
}

/** Starting points, one for each kind of sound people reach for first. */
export const SYNTH_PRESETS: Array<{ name: string; patch: PatchEdit }> = [
  { name: 'Init saw', patch: {} },
  {
    name: 'Supersaw lead',
    patch: { osc2: { on: true, wave: 'sawtooth', octave: 1, fine: 0, level: 0.4 }, unison: { voices: 7, spread: 28, width: 0.9 }, filter: { cutoff: 5000, envAmount: 1, resonance: 0.8 }, amp: { attack: 0.01, release: 0.35 }, level: 1 },
  },
  {
    name: 'Wobble bass',
    patch: { osc1: { octave: -1 }, osc2: { on: true, wave: 'square', octave: -1, fine: -8, level: 0.7 }, sub: 0.7, filter: { cutoff: 300, resonance: 6, envAmount: 0, keyTrack: 0 }, lfo: { target: 'filter', shape: 'sine', sync: '1/8', depth: 0.9 }, drive: 0.5, mono: true, amp: { attack: 0.003, sustain: 1, release: 0.08 }, level: -3 },
  },
  {
    name: 'Growl bass',
    patch: { osc1: { octave: -1, wave: 'square' }, osc2: { on: true, wave: 'sawtooth', octave: -1, semi: 7, level: 0.5 }, sub: 0.6, unison: { voices: 3, spread: 15 }, filter: { type: 'bandpass', cutoff: 700, resonance: 8, envAmount: 0 }, lfo: { target: 'filter', shape: 'triangle', sync: '1/16', depth: 0.8 }, drive: 0.85, mono: true, amp: { attack: 0.003, sustain: 1, release: 0.06 }, level: 3 },
  },
  { name: 'Sub bass', patch: { osc1: { wave: 'sine', octave: -1 }, sub: 0.3, filter: { cutoff: 400, envAmount: 0, keyTrack: 0 }, mono: true, glide: 0.04, amp: { attack: 0.004, sustain: 1, release: 0.1 }, level: 3.5 } },
  {
    name: 'Angelic pad',
    patch: { osc1: { wave: 'triangle' }, osc2: { on: true, wave: 'sawtooth', octave: 1, fine: 6, level: 0.25 }, unison: { voices: 5, spread: 18, width: 1 }, filter: { cutoff: 1800, envAmount: 1, resonance: 0.5 }, filterEnv: { attack: 1.5, decay: 2, sustain: 0.6, release: 2 }, amp: { attack: 1.2, decay: 1, sustain: 0.9, release: 2.5 }, lfo: { target: 'amp', shape: 'sine', sync: 'free', rate: 0.4, depth: 0.15 }, level: 4.5 },
  },
  { name: 'Warm pad', patch: { osc2: { on: true, wave: 'sawtooth', fine: 12, level: 0.7 }, unison: { voices: 3, spread: 12 }, filter: { cutoff: 900, envAmount: 1.5 }, filterEnv: { attack: 0.8, decay: 1.5, sustain: 0.4, release: 1.5 }, amp: { attack: 0.6, sustain: 0.9, release: 1.5 }, level: 0 } },
  {
    name: 'Glass pad',
    patch: { osc1: { wave: 'triangle' }, osc2: { on: true, wave: 'sine', octave: 2, level: 0.35 }, unison: { voices: 3, spread: 10, width: 1 }, filter: { cutoff: 5000, envAmount: 0.5, resonance: 0.6 }, amp: { attack: 0.4, decay: 1.5, sustain: 0.75, release: 2 }, lfo: { target: 'amp', shape: 'sine', sync: 'free', rate: 0.3, depth: 0.1 }, level: 1.5 },
  },
  {
    name: 'Halo pad',
    patch: { osc1: { wave: 'sawtooth', level: 0.5 }, osc2: { on: true, wave: 'triangle', octave: 1, fine: 5, level: 0.7 }, unison: { voices: 5, spread: 14, width: 1 }, filter: { cutoff: 1400, envAmount: 0.8, resonance: 0.6 }, filterEnv: { attack: 1, decay: 2, sustain: 0.7, release: 2 }, amp: { attack: 0.9, decay: 1, sustain: 0.9, release: 2.5 }, lfo: { target: 'filter', shape: 'sine', sync: 'free', rate: 0.2, depth: 0.25 }, level: 0 },
  },
  {
    name: 'Sweep pad',
    patch: { osc2: { on: true, wave: 'sawtooth', fine: 10, level: 0.8 }, unison: { voices: 3, spread: 16, width: 0.9 }, filter: { cutoff: 600, envAmount: 0.5, resonance: 3 }, filterEnv: { attack: 1, decay: 1, sustain: 0.6, release: 1.5 }, amp: { attack: 0.5, sustain: 0.9, release: 1.8 }, lfo: { target: 'filter', shape: 'triangle', sync: '1/1', depth: 0.6 }, level: 1.5 },
  },
  {
    name: 'Polysynth',
    patch: { osc2: { on: true, wave: 'square', fine: -9, level: 0.5 }, unison: { voices: 2, spread: 12, width: 0.7 }, filter: { cutoff: 1500, envAmount: 1.5, resonance: 1 }, filterEnv: { attack: 0.01, decay: 0.6, sustain: 0.35, release: 0.4 }, amp: { attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.5 }, level: 3.5 },
  },
  {
    name: 'Soundtrack pad',
    patch: { osc1: { wave: 'triangle' }, osc2: { on: true, wave: 'sawtooth', octave: -1, fine: 4, level: 0.4 }, noise: 0.04, unison: { voices: 3, spread: 20, width: 1 }, filter: { cutoff: 1100, envAmount: 1, resonance: 0.7 }, filterEnv: { attack: 2, decay: 2, sustain: 0.5, release: 2 }, amp: { attack: 1.5, decay: 1, sustain: 0.9, release: 3 }, lfo: { target: 'pitch', shape: 'sine', sync: 'free', rate: 0.25, depth: 0.05 }, level: 6 },
  },
  { name: 'Pluck', patch: { osc2: { on: true, wave: 'square', fine: 8, level: 0.5 }, filter: { cutoff: 600, envAmount: 4, resonance: 2 }, filterEnv: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 }, amp: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.2 }, level: 0 } },
  { name: 'Bell', patch: { osc1: { wave: 'sine' }, osc2: { on: true, wave: 'sine', octave: 2, semi: 7, level: 0.45 }, filter: { cutoff: 8000, envAmount: 0 }, amp: { attack: 0.002, decay: 2.2, sustain: 0, release: 1.5 }, level: -1 } },
  { name: 'Brass', patch: { osc2: { on: true, wave: 'sawtooth', fine: -6, level: 0.8 }, filter: { cutoff: 700, envAmount: 2.5, resonance: 1.2 }, filterEnv: { attack: 0.06, decay: 0.4, sustain: 0.5, release: 0.2 }, amp: { attack: 0.04, sustain: 0.85, release: 0.2 }, lfo: { target: 'pitch', shape: 'sine', sync: 'free', rate: 5, depth: 0.08 }, level: -1.5 } },
  { name: '8-bit lead', patch: { osc1: { wave: 'square' }, filter: { cutoff: 12000, envAmount: 0 }, lfo: { target: 'pitch', shape: 'triangle', sync: 'free', rate: 6, depth: 0.15 }, amp: { attack: 0.002, sustain: 1, release: 0.05 }, level: -4 } },
  { name: 'Riser noise', patch: { osc1: { on: false }, noise: 0.9, filter: { type: 'bandpass', cutoff: 400, resonance: 3, envAmount: 5, keyTrack: 0 }, filterEnv: { attack: 4, decay: 0.1, sustain: 1, release: 0.5 }, amp: { attack: 3, sustain: 1, release: 0.5 }, level: 0 } },
  {
    // Three saws a little out of tune with each other and a saw an octave under, gliding from note
    // to note (pair it with the piano roll's Scoop tool for the swoop into each note)
    name: 'Rave hoover',
    patch: {
      osc2: { on: true, wave: 'sawtooth', octave: -1, fine: -12, level: 0.55 },
      unison: { voices: 3, spread: 45, width: 0.8 },
      filter: { cutoff: 3200, envAmount: 1.2, resonance: 1.4, keyTrack: 0.4 },
      filterEnv: { attack: 0.01, decay: 0.5, sustain: 0.4 },
      amp: { attack: 0.01, decay: 0.2, sustain: 0.85, release: 0.3 },
      lfo: { target: 'pitch', shape: 'sine', sync: 'free', rate: 5, depth: 0.06 },
      drive: 0.25,
      mono: true,
      glide: 0.09,
      level: 0,
    },
  },
];

export const presetPatch = (name: string): SynthPatch => withPatch(defaultSynthPatch(), SYNTH_PRESETS.find((p) => p.name === name)?.patch ?? {});

// ---------- reading saved patches ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

function readOsc(v: unknown, d: OscSettings): OscSettings {
  const o = isObj(v) ? v : {};
  return {
    on: bool(o.on, d.on),
    wave: pick(o.wave, OSC_WAVES, d.wave),
    octave: Math.round(num(o.octave, d.octave, -3, 3)),
    semi: Math.round(num(o.semi, d.semi, -12, 12)),
    fine: num(o.fine, d.fine, -100, 100),
    level: num(o.level, d.level, 0, 1),
  };
}

function readEnv(v: unknown, d: Envelope): Envelope {
  const e = isObj(v) ? v : {};
  return { attack: num(e.attack, d.attack, 0.001, 10), decay: num(e.decay, d.decay, 0.001, 10), sustain: num(e.sustain, d.sustain, 0, 1), release: num(e.release, d.release, 0.005, 10) };
}

/** A saved (or hand-edited) patch made safe: every setting present and in range. Undefined if it isn't one. */
export function normalizeSynthPatch(v: unknown): SynthPatch | undefined {
  if (!isObj(v)) return undefined;
  const d = defaultSynthPatch();
  const u = isObj(v.unison) ? v.unison : {};
  const f = isObj(v.filter) ? v.filter : {};
  const l = isObj(v.lfo) ? v.lfo : {};
  return {
    osc1: readOsc(v.osc1, d.osc1),
    osc2: readOsc(v.osc2, d.osc2),
    sub: num(v.sub, d.sub, 0, 1),
    noise: num(v.noise, d.noise, 0, 1),
    unison: { voices: Math.round(num(u.voices, d.unison.voices, 1, 7)), spread: num(u.spread, d.unison.spread, 0, 100), width: num(u.width, d.unison.width, 0, 1) },
    filter: {
      type: pick(f.type, ['lowpass', 'highpass', 'bandpass'] as const, d.filter.type),
      cutoff: num(f.cutoff, d.filter.cutoff, 20, 20000),
      resonance: num(f.resonance, d.filter.resonance, 0.1, 20),
      envAmount: num(f.envAmount, d.filter.envAmount, -6, 6),
      keyTrack: num(f.keyTrack, d.filter.keyTrack, 0, 1),
    },
    filterEnv: readEnv(v.filterEnv, d.filterEnv),
    amp: readEnv(v.amp, d.amp),
    lfo: {
      target: pick(l.target, ['off', 'pitch', 'filter', 'amp'] as const, d.lfo.target),
      shape: pick(l.shape, ['sine', 'triangle', 'square', 'sawtooth'] as const, d.lfo.shape),
      sync: pick(l.sync, LFO_SYNC, d.lfo.sync),
      rate: num(l.rate, d.lfo.rate, 0.05, 30),
      depth: num(l.depth, d.lfo.depth, 0, 1),
    },
    drive: num(v.drive, d.drive, 0, 1),
    mono: bool(v.mono, d.mono),
    glide: num(v.glide, d.glide, 0, 2),
    level: num(v.level, d.level, -24, 6),
  };
}
