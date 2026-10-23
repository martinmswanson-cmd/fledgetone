/**
 * What Fledge Synth plays when someone asks to hear a preset (the ▶ Hear button by its preset
 * picker, and the ▶ by "Fledge Synth" before it's added): a short phrase that suits the preset's
 * category, at a fixed tempo, in the middle of that kind of part's range. Basses a low riff that
 * ends in an overlapping (legato) pair, so a preset with glide slides; leads a short tune; keys
 * and plucks an arpeggio; chords and pads two held chords; effects one long note. Velocities stay
 * moderate (chords lower, as their notes add up). Pure: the notes and when (fledgePreview.ts
 * plays them, fledgeTour.ts renders the ▶ before adding).
 */

/** The phrases' tempo (beats per minute): fixed, whatever the song's. */
export const PHRASE_BPM = 120;
const BEAT = 60 / PHRASE_BPM;

export type PhraseKind = 'bass' | 'lead' | 'keys' | 'chords' | 'pad' | 'fx';

/** One note of a phrase: MIDI note, start and length in seconds, velocity 0 to 1. */
export interface PhraseNote {
  midi: number;
  at: number;
  length: number;
  velocity: number;
}

/** The kind of part a preset is, from the category before the "/" in its name ("Init saw" is a lead). */
export function phraseKind(preset: string | undefined): PhraseKind {
  const cat = (preset ?? '').split('/')[0].trim().toLowerCase();
  if (cat === 'bass') return 'bass';
  if (cat === 'keys' || cat === 'pluck' || cat === 'plucks') return 'keys';
  if (cat === 'chords' || cat === 'chord') return 'chords';
  if (cat === 'pad' || cat === 'pads') return 'pad';
  if (cat === 'fx') return 'fx';
  return 'lead';
}

/** [midi, start beat, length in beats, velocity] */
type Step = [number, number, number, number];

const PHRASES: Record<PhraseKind, Step[]> = {
  // C2: a short riff, then a pair that overlaps by a 16th (legato: a preset with glide slides up)
  bass: [
    [36, 0, 0.45, 0.8],
    [36, 0.5, 0.2, 0.7],
    [39, 0.75, 0.2, 0.7],
    [36, 1, 0.45, 0.8],
    [43, 1.5, 0.75, 0.8],
    [46, 2, 1.25, 0.8],
  ],
  // Around C5: up, a turn, and a held note
  lead: [
    [67, 0, 0.45, 0.75],
    [70, 0.5, 0.45, 0.75],
    [72, 1, 0.45, 0.75],
    [75, 1.5, 0.45, 0.75],
    [74, 2, 0.25, 0.7],
    [72, 2.25, 0.25, 0.7],
    [70, 2.5, 0.25, 0.7],
    [72, 2.75, 1.25, 0.75],
  ],
  // Around C4: up and down a minor seventh chord in 8ths
  keys: [60, 63, 67, 70, 72, 70, 67, 63, 60].map((m, i): Step => [m, i * 0.5, i === 8 ? 1 : 0.4, 0.7]),
  // C minor, then A flat: two held chords
  chords: [
    ...[48, 55, 63].map((m): Step => [m, 0, 1.9, 0.5]),
    ...[44, 56, 63].map((m): Step => [m, 2, 2, 0.5]),
  ],
  // The same two chords, longer, for a slow start to swell into
  pad: [
    ...[48, 55, 63].map((m): Step => [m, 0, 2.4, 0.5]),
    ...[44, 56, 63].map((m): Step => [m, 2.5, 2.5, 0.5]),
  ],
  // One long note
  fx: [[60, 0, 5, 0.85]],
};

/** The phrase that preset `preset` plays to be heard (notes in time order). */
export function presetPhrase(preset: string | undefined): PhraseNote[] {
  return PHRASES[phraseKind(preset)].map(([midi, at, len, velocity]) => ({ midi, at: at * BEAT, length: len * BEAT, velocity }));
}

/** When a phrase's last note ends (seconds), before the sound's own release. */
export const phraseLength = (notes: readonly PhraseNote[]): number => Math.max(0, ...notes.map((n) => n.at + n.length));

/** How long to let a phrase ring on after its last note ends (seconds), for its release. */
export const PHRASE_TAIL = 0.8;

/** The presets the ▶ before adding Fledge Synth plays, one after another: a bass, a lead, chords. */
export const TOUR_PRESETS = ['Bass/Growl', 'Lead/Supersaw', 'Chords/Future bass'];

/** Seconds from one tour preset's start to the next one's (each phrase ends before it). */
export const TOUR_STEP = 2.25;

/**
 * How loud a sound is (dB): the mean power of its 100 ms blocks that aren't near silence (within
 * 40 dB of the loudest), both channels together; -Infinity for silence.
 */
export function loudnessDb(channels: readonly Float32Array[], sampleRate: number): number {
  const block = Math.max(1, Math.round(sampleRate / 10));
  const length = Math.min(...channels.map((c) => c.length));
  const powers: number[] = [];
  for (let s = 0; s + block <= length; s += block) {
    let sum = 0;
    for (const ch of channels) for (let i = s; i < s + block; i++) sum += ch[i] * ch[i];
    powers.push(sum / (block * channels.length));
  }
  const loudest = Math.max(0, ...powers);
  if (!(loudest > 0)) return -Infinity;
  const kept = powers.filter((p) => p >= loudest * 1e-4);
  return 10 * Math.log10(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** The gain (linear) that brings a sound to `targetDb` loudness (loudnessDb), its peak held under `ceilingDb`. */
export function matchGain(channels: readonly Float32Array[], sampleRate: number, targetDb: number, ceilingDb = -3): number {
  const level = loudnessDb(channels, sampleRate);
  if (!Number.isFinite(level)) return 1;
  let peak = 0;
  for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const gain = 10 ** ((targetDb - level) / 20);
  return Math.min(gain, peak > 0 ? 10 ** (ceilingDb / 20) / peak : gain);
}
