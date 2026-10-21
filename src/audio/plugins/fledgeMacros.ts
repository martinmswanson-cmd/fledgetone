/**
 * Fledge Synth's macros and wobble in plain words: the presets in the engine's order, a short
 * name for what each preset's macros move ("Speed up", "Growl", "Grit"), what a macro moves
 * read from the matrix (slots 5 to 8 in the presets), and which LFO is the wobble (the first one
 * in time with the song that moves something), with the tempo divisions offered for it. The studio
 * panel (FledgeSynthPanel.tsx) and Pocket's Sound tool (PocketSynth.tsx) both use these;
 * scripts/fledgeMacros.test.mjs checks them against the engine.
 */
import { choiceIndex, FLEDGE_DESTS, FLEDGE_SYNC, lfoControls, slotControls, type FledgeControl } from './fledgeLayout';

/** Fledge Synth's address on a track (builtinHost.ts). */
export const FLEDGE_URL = 'builtin:fledge/Fledge Synth';
export const isFledgeUrl = (url: string | undefined): boolean => url === FLEDGE_URL;

/** The presets, in the engine's order (their index is the program number). */
export const FLEDGE_PRESETS = [
  'Init saw',
  'Bass/Wobble', 'Bass/Growl', 'Bass/Riddim', 'Bass/Detune', 'Bass/Neuro', 'Bass/Talking', 'Bass/Yoi', 'Bass/Tearout', 'Bass/Screech', 'Bass/Sync', 'Bass/Split', 'Bass/Sub', 'Bass/808 slide',
  'Lead/Supersaw', 'Lead/Rave', 'Lead/Sine', 'Lead/Sync', 'Lead/Fifths', 'Lead/Folded', 'Lead/Chip',
  'Keys/Pluck', 'Keys/Bell', 'Keys/Organ', 'Keys/Stab',
  'Chords/Future bass', 'Chords/Gated', 'Chords/Minor stack',
  'Pad/Dark', 'Pad/Warm strings', 'Pad/Shimmer', 'Pad/Glass',
  'FX/Riser', 'FX/Downlifter', 'FX/Laser',
];

/** The preset a new Fledge Synth track starts on in Pocket. */
export const FLEDGE_START_PRESET = 'Bass/Wobble';

/** What each preset's macros 1 to 4 do, in a word or two (a preset without macros has none). */
export const FLEDGE_MACRO_NAMES: Record<string, string[]> = {
  'Init saw': [],
  'Bass/Wobble': ['Speed up', 'Squelch', 'Grit'],
  'Bass/Growl': ['Open', 'Growl', 'Grit'],
  'Bass/Riddim': ['Squelch', 'Grit', 'Growl'],
  'Bass/Detune': ['Bright', 'Spread', 'Grit'],
  'Bass/Neuro': ['Squelch', 'Morph', 'Grit'],
  'Bass/Talking': ['Open', 'Squelch', 'Grit'],
  'Bass/Yoi': ['Squelch', 'Grit', 'Growl'],
  'Bass/Tearout': ['Tear', 'Grit', 'Growl'],
  'Bass/Screech': ['Speed up', 'Morph', 'Grit'],
  'Bass/Sync': ['Sync', 'Bright', 'Grit'],
  'Bass/Split': ['Body', 'Bite', 'Grit'],
  'Bass/Sub': ['Grit', 'Tone', 'Shape'],
  'Bass/808 slide': ['Grit', 'Tone', 'Shape'],
  'Lead/Supersaw': ['Darken', 'Spread', 'Space'],
  'Lead/Rave': ['Darken'],
  'Lead/Sine': ['Grit', 'Echo'],
  'Lead/Sync': ['Morph'],
  'Lead/Fifths': ['Bright', 'Grit'],
  'Lead/Folded': ['Fold', 'Echo'],
  'Lead/Chip': ['Crunch'],
  'Keys/Pluck': ['Bright', 'Echo'],
  'Keys/Bell': ['Morph', 'Space'],
  'Keys/Organ': ['Tone', 'Chorus'],
  'Keys/Stab': ['Bright', 'Space'],
  'Chords/Future bass': ['Bright', 'Spread'],
  'Chords/Gated': ['Bright', 'Echo'],
  'Chords/Minor stack': ['Bright', 'Space'],
  'Pad/Dark': ['Bright', 'Space'],
  'Pad/Warm strings': ['Bright', 'Space'],
  'Pad/Shimmer': ['Morph', 'Space'],
  'Pad/Glass': ['Morph', 'Space'],
  'FX/Riser': ['Space'],
  'FX/Downlifter': [],
  'FX/Laser': [],
};

/** A parameter's stored 0..1 by its name. */
export type ValueOf = (param: string) => number;

/** The option a choice is on now (0 for a knob or a toggle). */
const pick = (val: ValueOf, c: FledgeControl): number => (c.kind === 'choice' ? choiceIndex(val(c.p), c.options.length, c.cap) : 0);

/** What macro `k` (1 to 4) moves: the targets of the matrix slots that read it. */
export function macroTargets(val: ValueOf, k: number): string[] {
  const out: string[] = [];
  for (let n = 1; n <= 8; n++) {
    const s = slotControls(n);
    const target = pick(val, s.target);
    if (pick(val, s.source) === 13 + k && target > 0) out.push(FLEDGE_DESTS[target]);
  }
  return out;
}

/**
 * Macro `k`'s name: the preset's own for it, else what it moves, else "Macro k". (A preset's name
 * is only used while the macro still moves something: rerouted to nothing, it's a plain macro.)
 */
export function macroLabel(preset: string | undefined, k: number, targets: string[]): string {
  const named = preset ? FLEDGE_MACRO_NAMES[preset]?.[k - 1] : undefined;
  if (named && targets.length) return named;
  return targets.length ? targets.join(', ') : `Macro ${k}`;
}

/** The divisions the wobble rate picker offers (their place in FLEDGE_SYNC), with how they're shown. */
export const WOBBLE_DIVISIONS: Array<{ index: number; label: string }> = [
  ['1 bar', '1/1'], ['1/2', '1/2'], ['1/4', '1/4'], ['1/4T', '1/4T'], ['1/8', '1/8'], ['1/8T', '1/8T'], ['1/16', '1/16'], ['1/16T', '1/16T'], ['1/32', '1/32'],
].map(([name, label]) => ({ index: FLEDGE_SYNC.indexOf(name), label }));

/** The wobble: an LFO in time with the song that moves something. */
export interface Wobble {
  /** Which LFO (1 to 4) */
  lfo: number;
  /** Its division now (its place in FLEDGE_SYNC) */
  division: number;
  /** "Wobble rate", or "Pulse rate" for one that only moves the volume (a gate, a pump) */
  label: string;
}

/** The sound's wobble: the first LFO in time with the song that moves something; null if none. */
export function wobbleOf(val: ValueOf): Wobble | null {
  for (let n = 1; n <= 4; n++) {
    const l = lfoControls(n);
    if (val(l.sync.p) < 0.5) continue;
    const targets = l.targets
      .filter((t) => Math.abs(val(t.amount.p) - 0.5) > 1e-4)
      .map((t) => FLEDGE_DESTS[pick(val, t.target)])
      .filter((d) => d !== 'None');
    // (Or the matrix reads it)
    for (let s = 1; s <= 8; s++) {
      const slot = slotControls(s);
      const target = pick(val, slot.target);
      if (pick(val, slot.source) === n && target > 0) targets.push(FLEDGE_DESTS[target]);
    }
    if (!targets.length) continue;
    return { lfo: n, division: pick(val, l.division), label: targets.every((t) => t === 'Volume') ? 'Pulse rate' : 'Wobble rate' };
  }
  return null;
}
