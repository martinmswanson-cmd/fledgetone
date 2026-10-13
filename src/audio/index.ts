/**
 * The sound deck's audio entry point (SoundAuditionPanel.tsx): the original synth instruments'
 * factories and trigger helpers, re-exported, and the chords, brass stabs and bass notes its pads
 * play.
 */
export * from './engine';
export * from './presets/bass';
export * from './presets/keys';
export * from './presets/brass';
export * from './presets/drums';

// Re-export specific common chord and stab definitions for UI helpers
export const CHORD_PRESETS = {
  Dm9: ['D3', 'F3', 'A3', 'C4', 'E4'],
  G13: ['G2', 'F3', 'B3', 'E4'],
  Bbmaj7: ['Bb2', 'F3', 'A3', 'D4'],
} as const;

export const BRASS_PRESETS = {
  Dm_Stab: ['D4', 'F4', 'A4'],
  C_Stab: ['C4', 'E4', 'G4'],
} as const;

export const BASS_NOTES = ['D1', 'F1', 'G1', 'A1'] as const;
