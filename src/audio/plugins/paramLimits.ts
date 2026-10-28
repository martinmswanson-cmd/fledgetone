/**
 * Built-in plugin parameters kept inside the range they're safe in, by the plugin's address and
 * the parameter's name (as it reports it), as [lowest, highest] of its 0..1. Past these the plugin
 * blows up or blasts: Faust's piano model goes unstable on its low notes with a stiffer string
 * (from 0.32 at A0; a note at 0.5 played a full-scale blast), the compressor's makeup gain went to
 * +96 dB, the reverbs' output level to +40 dB and the phaser's feedback to the edge of ringing on.
 * Only the part past a limit changes: a setting inside it plays as it always has, and one saved
 * past it plays at the limit (the processor clamps what's set, saved or automated; see processor.ts).
 */
export const PARAM_LIMITS: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  // Stiffness 0 to 0.30 (its default is 0.28)
  'builtin:faust/Piano Model': { 'Stiffness factor': [0, 0.3] },
  // Makeup gain -96 to +24 dB (of -96 to +96 dB)
  'builtin:faust/Stereo Compressor': { 'Makeup gain': [0, 0.625] },
  // Output level -70 to +12 dB (of -70 to +40 dB)
  'builtin:faust/Studio Hall': { Level: [0, 0.7455] },
  'builtin:faust/Plate Reverb': { Level: [0, 0.7455] },
  // Feedback -0.9 to +0.9 (of -1 to +1)
  'builtin:faust/Phaser': { 'Feedback gain': [0.05, 0.95] },
};

/**
 * Families whose plugins each get a WebAssembly instance (and memory) of their own rather than
 * sharing one: the Mutable Instruments models read memory they never set, and in the memory a
 * plugin of the family left behind ("Particles" deleted, then "String and Reverb" added) they
 * played NaN, which silenced the whole mix, or crashed. About 16 MB each.
 */
export const OWN_MEMORY_FAMILIES: ReadonlySet<string> = new Set(['mutable']);
