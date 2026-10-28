/**
 * Built-in plugin parameters kept inside the range they're safe in, by the plugin's address and
 * the parameter's name (as it reports it), as [lowest, highest] of its 0..1. Past these the plugin
 * blows up or blasts: Faust's piano model goes unstable on its low notes with a stiffer string
 * (from 0.32 at A0; a note at 0.5 played a full-scale blast), the compressor's makeup gain went to
 * +96 dB, the reverbs' output level to +40 dB and the phaser's feedback to the edge of ringing on.
 * The waveguide flute's vibrato blew up from 0.84. Others stayed stable but jumped loud: the
 * piano's brightness lifted its top notes by up to 21 dB (+17 dBFS), and the parametric EQ
 * boosted by up to 40 dB.
 * Only the part past a limit changes: a setting inside it plays as it always has, and one saved
 * past it plays at the limit (the processor clamps what's set, saved or automated; see processor.ts).
 */
export const PARAM_LIMITS: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  // Stiffness 0 to 0.30 (its default is 0.28)
  // Brightness 0 to 0.05 (its default is 0): at most 3 dB over the default anywhere on the keyboard
  'builtin:faust/Piano Model': { 'Stiffness factor': [0, 0.3], 'Brightness factor': [0, 0.05] },
  // Vibrato gain 0 to 0.6 (its default is 0.1; from 0.84 it blew up)
  'builtin:faust/Waveguide Flute': { 'Vibrato gain': [0, 0.6] },
  // Each band's boost -40 to +18 dB (of -40 to +40 dB)
  'builtin:faust/Parametric EQ': { 'Low boost|Cut': [0, 0.725], 'Peak boost|Cut': [0, 0.725], 'High boost|Cut': [0, 0.725] },
  // Makeup gain -96 to +24 dB (of -96 to +96 dB)
  'builtin:faust/Stereo Compressor': { 'Makeup gain': [0, 0.625] },
  // Output level -70 to +12 dB (of -70 to +40 dB)
  'builtin:faust/Studio Hall': { Level: [0, 0.7455] },
  'builtin:faust/Plate Reverb': { Level: [0, 0.7455] },
  // Feedback -0.9 to +0.9 (of -1 to +1)
  'builtin:faust/Phaser': { 'Feedback gain': [0.05, 0.95] },
  // Output -60 to +12 dB (of -60 to +60 dB: 0.5 is 0 dB, 60 (2v - 1)^2 dB over it)
  'builtin:mda/Loudness': { Output: [0, 0.7236] },
};

/**
 * Families whose plugins each get a WebAssembly instance (and memory) of their own rather than
 * sharing one: the Mutable Instruments models read memory they never set, and in the memory a
 * plugin of the family left behind ("Particles" deleted, then "String and Reverb" added) they
 * played NaN, which silenced the whole mix, or crashed. About 16 MB each.
 */
export const OWN_MEMORY_FAMILIES: ReadonlySet<string> = new Set(['mutable']);

/**
 * Whether a plugin of `family` gets an instance of its own, in a live context or a render
 * (`offline`). Only live: in a render every plugin is made at the start into the family's fresh
 * (zeroed) instance and none is deleted before the end, so none can find another's leftovers; and
 * Chromium never frees a render's instances (an OfflineAudioContext an AudioWorklet module went
 * into stays), about 124 WebAssembly memories in all fit in a page, so one per plugin per render ran
 * out after some 25 exports of a song with five of them, and every plugin failed to load after.
 * A shared one started again after a blow-up still gets a fresh instance (`freshOnRestart`).
 */
export const ownMemoryFor = (family: string, offline: boolean): { ownMemory: boolean; freshOnRestart: boolean } => {
  const own = OWN_MEMORY_FAMILIES.has(family);
  return { ownMemory: own && !offline, freshOnRestart: own && offline };
};

/**
 * Built-in plugins turned down as a whole (dB), by address: ones whose loudest notes stood far
 * over the rest. Faust's piano model plays E6 at +5.7 dBFS, 10 dB over the notes either side
 * (G#6 next at -0.9, most notes -5 to -12), at any velocity (its velocity hardly changes its
 * level, so a trim of the hot notes' velocity can't level them); turned down so its loudest note
 * stays under -1 dBFS.
 */
export const OUTPUT_TRIMS_DB: Readonly<Record<string, number>> = {
  'builtin:faust/Piano Model': -7,
};
