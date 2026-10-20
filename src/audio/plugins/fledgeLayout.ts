/**
 * Fledge Synth's parameters as its editor (FledgeSynthPanel.tsx) lays them out: their indices in
 * the engine (engine/fledge-synth/src/params.rs, whose order never changes), grouped into the
 * panel's sections, with each choice's list. scripts/plugins.test.mjs checks this against the
 * engine itself, so the two can't drift apart.
 */

export type FledgeControl =
  | { i: number; label: string; kind: 'knob'; bipolar?: boolean }
  | { i: number; label: string; kind: 'choice'; options: string[] }
  | { i: number; label: string; kind: 'toggle' };

export const FLEDGE_TABLES = ['Basic shapes', 'Pulse width', 'Dark saw', 'Vowels', 'Harmonic sweep', 'Growl FM', 'Metal FM', 'Fold'];
export const FLEDGE_FILTERS = ['Low pass 12', 'Low pass 24', 'Ladder', 'Band pass', 'High pass 12', 'High pass 24', 'Notch', 'Comb +', 'Comb −', 'Formant', 'Off'];
export const FLEDGE_SHAPERS = ['Off', 'Soft', 'Warm', 'Hard clip', 'Fold', 'Asymmetric'];
export const FLEDGE_LFO_SHAPES = ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Wobble', 'Steps', 'Drift'];
export const FLEDGE_SYNC = ['4 bars', '2 bars', '1 bar', '1/2.', '1/2', '1/4.', '1/2T', '1/4', '1/8.', '1/4T', '1/8', '1/16.', '1/8T', '1/16', '1/16T', '1/32'];
export const FLEDGE_DESTS = ['None', 'Cutoff', 'Resonance', 'A position', 'B position', 'Pitch', 'Volume', 'Drive', 'FM', 'Pan', 'B pitch', 'Sub'];
export const FLEDGE_MODES = ['Poly', 'Mono', 'Legato'];
export const FLEDGE_SUB_OCTAVES = ['−1 octave', '−2 octaves'];

/** Where each group starts (as in params.rs) */
export const FLEDGE = { A: 0, B: 11, LFO_1: 45, LFO_2: 54, COUNT: 79 } as const;

const knob = (i: number, label: string, bipolar = false): FledgeControl => ({ i, label, kind: 'knob', bipolar });
const choice = (i: number, label: string, options: string[]): FledgeControl => ({ i, label, kind: 'choice', options });
const toggle = (i: number, label: string): FledgeControl => ({ i, label, kind: 'toggle' });

/** An oscillator's controls from its group's start: on, table, then its knobs. */
export const oscControls = (at: number) => ({
  on: toggle(at, 'On'),
  table: choice(at + 1, 'Table', FLEDGE_TABLES),
  knobs: [
    knob(at + 2, 'Position'),
    knob(at + 3, 'Octave', true),
    knob(at + 4, 'Semi', true),
    knob(at + 5, 'Fine', true),
    knob(at + 6, 'Level'),
    knob(at + 7, 'Unison'),
    knob(at + 8, 'Detune'),
    knob(at + 9, 'Blend'),
    knob(at + 10, 'Width'),
  ],
});

/** An LFO's controls from its group's start. */
export const lfoControls = (at: number) => ({
  shape: choice(at, 'Shape', FLEDGE_LFO_SHAPES),
  sync: toggle(at + 1, 'Sync to song'),
  division: choice(at + 2, 'Rate', FLEDGE_SYNC),
  hz: knob(at + 3, 'Rate'),
  restart: toggle(at + 4, 'Restart on note'),
  targets: [
    { target: choice(at + 5, 'Target 1', FLEDGE_DESTS), amount: knob(at + 6, 'Amount', true) },
    { target: choice(at + 7, 'Target 2', FLEDGE_DESTS), amount: knob(at + 8, 'Amount', true) },
  ],
});

export const FLEDGE_SECTIONS = {
  sources: [knob(22, 'FM B→A'), knob(23, 'Sub'), choice(24, 'Sub octave', FLEDGE_SUB_OCTAVES), knob(25, 'Noise')],
  filter: { type: choice(26, 'Type', FLEDGE_FILTERS), knobs: [knob(27, 'Cutoff'), knob(28, 'Resonance'), knob(29, 'Drive'), knob(30, 'Key track'), knob(31, 'Envelope', true)] },
  ampEnv: [knob(32, 'Attack'), knob(33, 'Decay'), knob(34, 'Sustain'), knob(35, 'Release')],
  filterEnv: [knob(36, 'Attack'), knob(37, 'Decay'), knob(38, 'Sustain'), knob(39, 'Release')],
  pitchEnv: [knob(40, 'Amount', true), knob(41, 'Decay')],
  drive: { type: choice(42, 'Type', FLEDGE_SHAPERS), knobs: [knob(43, 'Drive'), knob(44, 'Mix')] },
  modWheel: { target: choice(63, 'Target', FLEDGE_DESTS), amount: knob(64, 'Amount', true) },
  play: { mode: choice(65, 'Voices', FLEDGE_MODES), knobs: [knob(66, 'Glide'), knob(67, 'Bend'), knob(68, 'Velocity')] },
  output: [knob(69, 'OTT'), knob(70, 'OTT time'), knob(71, 'Width'), knob(72, 'Level')],
};

/** The stored 0..1 of a choice's option `k` (as the engine reads it). */
export const choiceValue = (k: number, count: number) => (count > 1 ? k / (count - 1) : 0);
/** The option a stored 0..1 picks. */
export const choiceIndex = (v: number, count: number) => Math.max(0, Math.min(count - 1, Math.round(v * (count - 1))));
