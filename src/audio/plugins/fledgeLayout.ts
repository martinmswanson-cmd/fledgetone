/**
 * Fledge Synth's settings as its editor (FledgeSynthPanel.tsx) lays them out: each control names
 * the engine's parameter (engine/fledge-synth/src/params.rs), and the panel finds its index from
 * the names the plugin reports. Choices carry their list and its room to grow (`cap`: the stored
 * 0..1 is the option's place out of cap). scripts/plugins.test.mjs checks all of this against
 * the engine itself, so the two can't drift apart.
 */

export type FledgeControl =
  | { p: string; label: string; kind: 'knob'; bipolar?: boolean }
  | { p: string; label: string; kind: 'choice'; options: string[]; cap: number }
  | { p: string; label: string; kind: 'toggle' };

export const FLEDGE_TABLES = [
  'Basic shapes', 'Pulse width', 'Dark saw', 'Vowels', 'Harmonic sweep', 'Growl FM', 'Metal FM', 'Fold',
  'Sync sweep', 'Organ', 'Octave stack', 'Digital', 'Resonant', 'Screech', 'FM 1:2', 'Random harmonics',
];
export const FLEDGE_FILTERS = ['Low pass 12', 'Low pass 24', 'Ladder', 'Band pass', 'High pass 12', 'High pass 24', 'Notch', 'Comb +', 'Comb −', 'Formant', 'Off'];
export const FLEDGE_SHAPERS = ['Off', 'Soft', 'Warm', 'Hard clip', 'Fold', 'Asymmetric', 'Tube', 'Bitcrush', 'Downsample'];
export const FLEDGE_WARPS = ['Off', 'Sync', 'Bend +', 'Bend −', 'Squeeze', 'Mirror', 'Quantize', 'Fold', 'Ring'];
export const FLEDGE_STACKS = ['Off', 'Octave', '2 octaves', 'Fifth', 'Fifth + octave', 'Major', 'Minor', 'Sus 4'];
export const FLEDGE_ROUTES = ['Filter 1', 'Filter 2', 'Both filters', 'Straight out'];
export const FLEDGE_LFO_SHAPES = ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Wobble', 'Steps', 'Drift', 'Pump', 'Drawn 1', 'Drawn 2'];
export const FLEDGE_LFO_MODES = ['Free', 'Retrig', 'Envelope', 'Sustain env'];
export const FLEDGE_LFO_RETRIGS = ['As the voices', 'Always', 'Legato continues', 'Never'];
/** The tempo divisions, in the engine's order (the later ones came later: saved songs keep their place) */
export const FLEDGE_SYNC = ['4 bars', '2 bars', '1 bar', '1/2.', '1/2', '1/4.', '1/2T', '1/4', '1/8.', '1/4T', '1/8', '1/16.', '1/8T', '1/16', '1/16T', '1/32', '2 bars.', '1 bar.', '1/1T', '1/32.', '1/32T', '1/64'];
/** Each division's length in beats (as the engine's SYNC_BEATS) */
export const FLEDGE_SYNC_BEATS = [16, 8, 4, 3, 2, 1.5, 4 / 3, 1, 0.75, 2 / 3, 0.5, 0.375, 1 / 3, 0.25, 1 / 6, 0.125, 12, 6, 8 / 3, 0.1875, 1 / 12, 0.0625];
export const FLEDGE_DESTS = [
  'None', 'F1 cutoff', 'F1 resonance', 'A position', 'B position', 'Pitch', 'Volume', 'Drive', 'FM', 'Pan', 'B pitch', 'Sub',
  'A pitch', 'A level', 'B level', 'A detune', 'B detune', 'A warp', 'B warp', 'F2 cutoff', 'F2 resonance', 'Noise', 'Filter drive', 'Drive mix',
  'LFO 1 rate', 'LFO 2 rate', 'LFO 3 rate', 'LFO 4 rate', 'Chorus mix', 'Phaser mix', 'Delay mix', 'Reverb mix', 'Width',
  'Pre drive', 'Crush', 'Band drive',
];
export const FLEDGE_SOURCES = [
  'None', 'LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'Volume env', 'Filter env', 'Mod env', 'Velocity', 'Note', 'Mod wheel', 'Aftertouch', 'Pitch bend', 'Random', 'Macro 1', 'Macro 2', 'Macro 3', 'Macro 4',
  'Note random', 'Note random ±', 'Chaos', 'Release velocity', 'Note pressure',
];
/** Where the macros are in FLEDGE_SOURCES (Macro 1 is MACRO_SOURCE + 1) */
export const MACRO_SOURCE = 13;
export const FLEDGE_CURVES = ['Linear', 'Exponential', 'Logarithmic', 'S-curve'];
export const FLEDGE_SUB_PATHS = ['With the voices', 'Clean, after effects'];
export const FLEDGE_GLIDE_MODES = ['Always', 'Legato only'];
export const FLEDGE_GLIDE_RATES = ['Constant time', 'Constant rate'];
export const FLEDGE_GLIDE_CURVES = ['Exponential', 'Linear'];
export const FLEDGE_PENV_CURVES = ['Exponential', 'Linear'];
export const FLEDGE_RANDOM_CYCLES = ['Never', '1 bar', '2 bars', '4 bars'];
/** How many matrix slots there are */
export const FLEDGE_SLOTS = 16;
export const FLEDGE_MODES = ['Poly', 'Mono', 'Legato'];
export const FLEDGE_SUB_OCTAVES = ['−1 octave', '−2 octaves'];
export const FLEDGE_PHASER_MODES = ['Phaser', 'Flanger'];

/** How many places each list keeps (as params.rs) */
const CAP = { table: 64, filter: 32, shaper: 16, warp: 32, stack: 16, route: 8, lfo: 32, lfoMode: 8, sync: 32, dest: 64, source: 32, mode: 8, sub: 4, phaser: 8, retrig: 8, curve: 8, subPath: 4, glide: 8, cycle: 8 };

const knob = (p: string, label: string, bipolar = false): FledgeControl => ({ p, label, kind: 'knob', bipolar });
const choice = (p: string, label: string, options: string[], cap: number): FledgeControl => ({ p, label, kind: 'choice', options, cap });
const toggle = (p: string, label: string): FledgeControl => ({ p, label, kind: 'toggle' });

/** An oscillator's controls ("A" or "B"). */
export const oscControls = (o: 'A' | 'B') => ({
  on: toggle(`${o} on`, 'On'),
  table: choice(`${o} table`, 'Table', FLEDGE_TABLES, CAP.table),
  tone: [knob(`${o} position`, 'Position'), knob(`${o} octave`, 'Octave', true), knob(`${o} semitone`, 'Semi', true), knob(`${o} fine`, 'Fine', true), knob(`${o} level`, 'Level'), knob(`${o} pan`, 'Pan', true)],
  unison: [knob(`${o} unison`, 'Unison'), knob(`${o} detune`, 'Detune'), knob(`${o} blend`, 'Blend'), knob(`${o} width`, 'Width')],
  stack: choice(`${o} stack`, 'Stack', FLEDGE_STACKS, CAP.stack),
  warp: choice(`${o} warp`, 'Warp', FLEDGE_WARPS, CAP.warp),
  warpKnobs: [knob(`${o} warp amount`, 'Amount'), knob(`${o} phase`, 'Phase'), knob(`${o} random phase`, 'Random')],
  route: choice(`${o} route`, 'To', FLEDGE_ROUTES, CAP.route),
});

/** An LFO's controls (1 to 4). */
export const lfoControls = (n: number) => {
  const p = `LFO ${n}`;
  return {
    shape: choice(`${p} shape`, 'Shape', FLEDGE_LFO_SHAPES, CAP.lfo),
    sync: toggle(`${p} sync`, 'Sync to song'),
    division: choice(`${p} rate (sync)`, 'Rate', FLEDGE_SYNC, CAP.sync),
    hz: knob(`${p} rate (Hz)`, 'Rate'),
    mode: choice(`${p} mode`, 'Mode', FLEDGE_LFO_MODES, CAP.lfoMode),
    retrig: choice(`${p} retrigger`, 'Retrigger', FLEDGE_LFO_RETRIGS, CAP.retrig),
    knobs: [knob(`${p} phase`, 'Phase'), knob(`${p} delay`, 'Delay'), knob(`${p} fade in`, 'Rise'), knob(`${p} smooth`, 'Smooth'), knob(`${p} key tracking`, 'Key track')],
    /** Where a Sustain env LFO holds while the key is down */
    sustain: knob(`${p} sustain point`, 'Hold at'),
    targets: [1, 2].map((t) => ({ target: choice(`${p} target ${t}`, `Target ${t}`, FLEDGE_DESTS, CAP.dest), amount: knob(`${p} amount ${t}`, 'Amount', true) })),
  };
};

/** A drawn shape's 16 steps and its smoothing (1 or 2). */
export const shapeControls = (n: number) => ({
  steps: Array.from({ length: 16 }, (_, i) => knob(`Shape ${n} step ${i + 1}`, `Step ${i + 1}`, true)),
  smooth: knob(`Shape ${n} smooth`, 'Smooth'),
});

/** A matrix slot (1 to 16): its source moves its target by its amount (bent by its curve, and scaled by its "via" source). */
export const slotControls = (n: number) => ({
  source: choice(`Mod ${n} source`, 'Source', FLEDGE_SOURCES, CAP.source),
  target: choice(`Mod ${n} target`, 'Target', FLEDGE_DESTS, CAP.dest),
  amount: knob(`Mod ${n} amount`, 'Amount', true),
  curve: choice(`Mod ${n} curve`, 'Curve', FLEDGE_CURVES, CAP.curve),
  via: choice(`Mod ${n} via`, 'Via', FLEDGE_SOURCES, CAP.source),
});
/** The matrix slots, 1 to 16 */
export const SLOT_NUMBERS = Array.from({ length: FLEDGE_SLOTS }, (_, i) => i + 1);

const adsr = (p: string) => [knob(`${p} attack`, 'Attack'), knob(`${p} decay`, 'Decay'), knob(`${p} sustain`, 'Sustain'), knob(`${p} release`, 'Release')];

export const FLEDGE_SECTIONS = {
  sources: [knob('FM B → A', 'FM B→A'), knob('Sub level', 'Sub'), choice('Sub octave', 'Sub octave', FLEDGE_SUB_OCTAVES, CAP.sub), knob('Noise level', 'Noise'), choice('Noise route', 'Noise to', FLEDGE_ROUTES, CAP.route)],
  subPath: choice('Sub path', 'Sub goes', FLEDGE_SUB_PATHS, CAP.subPath),
  filter1: { type: choice('Filter type', 'Type', FLEDGE_FILTERS, CAP.filter), knobs: [knob('Cutoff', 'Cutoff'), knob('Resonance', 'Resonance'), knob('Filter drive', 'Drive'), knob('Key tracking', 'Key track'), knob('Filter envelope', 'Envelope', true)] },
  filter2: {
    type: choice('Filter 2 type', 'Type', FLEDGE_FILTERS, CAP.filter),
    serial: toggle('Filter 1 into 2', 'Filter 1 into 2'),
    knobs: [knob('Filter 2 cutoff', 'Cutoff'), knob('Filter 2 resonance', 'Resonance'), knob('Filter 2 key tracking', 'Key track'), knob('Filter 2 envelope', 'Envelope', true)],
  },
  ampEnv: adsr('Amp'),
  filterEnv: adsr('Filter'),
  modEnv: adsr('Mod env'),
  pitchEnv: [knob('Pitch envelope', 'Amount', true), knob('Pitch decay', 'Time')],
  pitchCurve: choice('Pitch envelope curve', 'Curve', FLEDGE_PENV_CURVES, CAP.glide),
  /** The drive after the filters (the first there was) */
  drive: { type: choice('Drive type', 'Type', FLEDGE_SHAPERS, CAP.shaper), knobs: [knob('Drive', 'Drive'), knob('Drive mix', 'Mix'), knob('Drive crush', 'Crush'), knob('Drive tone', 'Cab tone')] },
  /** Before the filters */
  preDrive: { type: choice('Pre drive type', 'Type', FLEDGE_SHAPERS, CAP.shaper), knobs: [knob('Pre drive', 'Drive'), knob('Pre drive mix', 'Mix'), knob('Pre drive crush', 'Crush')] },
  /** After the voices, mids and highs only */
  bandDrive: {
    type: choice('Band drive type', 'Type', FLEDGE_SHAPERS, CAP.shaper),
    knobs: [knob('Band drive', 'Drive'), knob('Band drive mix', 'Mix'), knob('Band drive crush', 'Crush'), knob('Band drive tone', 'Cab tone')],
    split: [knob('Band low split', 'Low split'), knob('Band high split', 'High split'), knob('Band high amount', 'Highs')],
  },
  chaos: { rate: choice('Chaos rate (sync)', 'Chaos rate', FLEDGE_SYNC, CAP.sync), smooth: knob('Chaos smooth', 'Smooth'), cycle: choice('Random repeat', 'Repeats every', FLEDGE_RANDOM_CYCLES, CAP.cycle), byStep: toggle('Random by step', 'By step, not pitch') },
  macros: [1, 2, 3, 4].map((n) => knob(`Macro ${n}`, `Macro ${n}`)),
  play: { mode: choice('Voices', 'Voices', FLEDGE_MODES, CAP.mode), knobs: [knob('Glide', 'Glide'), knob('Bend range', 'Bend'), knob('Velocity', 'Velocity')] },
  /** Mono and legato: a note that doesn't join the last starts afresh (so a repeating riff repeats) */
  monoRestart: toggle('Mono restart', 'Restart each note'),
  /** The same sound up the whole keyboard: no step where the wavetable changes octave, a note's
   * random start from its step (not its pitch); and how much the unison's detune narrows above
   * middle C (so it doesn't beat faster and faster up high) */
  evenKeys: toggle('Even keyboard', 'Even keyboard'),
  detuneKey: knob('Detune key tracking', 'Detune key'),
  glide: [choice('Glide mode', 'Glide', FLEDGE_GLIDE_MODES, CAP.glide), choice('Glide rate', 'Glide time', FLEDGE_GLIDE_RATES, CAP.glide), choice('Glide curve', 'Glide curve', FLEDGE_GLIDE_CURVES, CAP.glide)],
  eq: { on: toggle('EQ on', 'On'), knobs: [knob('EQ low', 'Low', true), knob('EQ low freq', 'Low freq'), knob('EQ mid', 'Mid', true), knob('EQ mid freq', 'Mid freq'), knob('EQ high', 'High', true), knob('EQ high freq', 'High freq')] },
  chorus: { on: toggle('Chorus on', 'On'), knobs: [knob('Chorus rate', 'Rate'), knob('Chorus depth', 'Depth'), knob('Chorus mix', 'Mix')] },
  phaser: { on: toggle('Phaser on', 'On'), mode: choice('Phaser mode', 'Mode', FLEDGE_PHASER_MODES, CAP.phaser), knobs: [knob('Phaser rate', 'Rate'), knob('Phaser depth', 'Depth'), knob('Phaser feedback', 'Feedback'), knob('Phaser mix', 'Mix')] },
  delay: {
    on: toggle('Delay on', 'On'),
    sync: toggle('Delay sync', 'Sync to song'),
    division: choice('Delay time (sync)', 'Time', FLEDGE_SYNC, CAP.sync),
    ms: knob('Delay time (ms)', 'Time'),
    pingpong: toggle('Delay ping-pong', 'Ping-pong'),
    knobs: [knob('Delay feedback', 'Feedback'), knob('Delay tone', 'Tone'), knob('Delay mix', 'Mix')],
  },
  reverb: { on: toggle('Reverb on', 'On'), knobs: [knob('Reverb size', 'Size'), knob('Reverb decay', 'Decay'), knob('Reverb tone', 'Tone'), knob('Reverb pre-delay', 'Pre-delay'), knob('Reverb mix', 'Mix')] },
  output: [knob('OTT', 'OTT'), knob('OTT time', 'OTT time'), knob('Width', 'Width'), knob('Mono below', 'Mono below'), knob('Level', 'Level')],
};

/** Every control on the panel (the test checks each against the engine). */
export function allFledgeControls(): FledgeControl[] {
  const out: FledgeControl[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === 'object' && 'kind' in x && 'p' in x) out.push(x as FledgeControl);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(FLEDGE_SECTIONS);
  walk([oscControls('A'), oscControls('B')]);
  walk([1, 2, 3, 4].map(lfoControls));
  walk([1, 2].map(shapeControls));
  walk(SLOT_NUMBERS.map(slotControls));
  return out;
}

/** The stored 0..1 of a choice's option `k` (its place out of `cap`, as the engine reads it). */
export const choiceValue = (k: number, cap: number) => (cap > 1 ? k / (cap - 1) : 0);
/** The option a stored 0..1 picks (the last one past the list's end). */
export const choiceIndex = (v: number, count: number, cap: number) => Math.max(0, Math.min(count - 1, Math.round(v * (cap - 1))));
/** A bipolar knob's stored 0..1 for -1..1, and back. */
export const bipolarValue = (x: number) => (Math.max(-1, Math.min(1, x)) + 1) / 2;
export const bipolarOf = (v: number) => v * 2 - 1;

// --- Pictures of the LFO shapes (as the engine draws them: engine/fledge-synth/src/dsp.rs) ---

/**
 * LFO shape `shape` at `phase` (0..1), -1..1. Steps and Drift show a fixed example of their
 * randomness: one level (Steps) or one glide (Drift) per cycle, as the engine makes them.
 */
export function lfoPoint(shape: number, phase: number, drawn: [number[], number][]): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 0:
      return Math.sin(2 * Math.PI * p);
    case 1:
      return 1 - 4 * Math.abs(p - 0.5);
    case 2:
      return 2 * p - 1;
    case 3:
      return 1 - 2 * p;
    case 4:
      return p < 0.5 ? 1 : -1;
    case 5:
      return Math.tanh(3 * Math.sin(2 * Math.PI * p)) / Math.tanh(3);
    case 6:
      return 0.6;
    case 7:
      return -0.5 + 1.1 * p * p * (3 - 2 * p);
    case 8:
      return (2 * (1 - Math.exp(-8 * p))) / (1 - Math.exp(-8)) - 1;
    default: {
      const [steps, smooth] = drawn[Math.min(1, shape - 9)] ?? [new Array(16).fill(0), 0];
      return drawnPoint(steps, smooth, p);
    }
  }
}

/** A drawn shape at `phase`: 16 steps, each sliding into the next over its last `smooth`. */
export function drawnPoint(steps: number[], smooth: number, phase: number): number {
  const x = Math.min(0.99999, Math.max(0, phase)) * 16;
  const i = Math.floor(x);
  const t = x - i;
  const a = steps[i];
  if (smooth <= 0.001) return a;
  const b = steps[(i + 1) % 16];
  const u = Math.max(0, Math.min(1, (t - (1 - smooth)) / smooth));
  return a + (b - a) * u * u * (3 - 2 * u);
}
