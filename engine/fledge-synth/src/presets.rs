//! The factory presets, written in the engine's own units (Hz, dB, seconds, a choice's place in
//! its list) against parameter names, and turned into 0..1 values when chosen. Every one is
//! levelled to the same loudness (tests::presets_are_level_matched checks it). Names are
//! "Category/Name"; the matrix's slots 5 to 8 hold each preset's macros.

use crate::params::{defaults, index_of, legacy, param, COUNT, COUNT_V1, COUNT_V2};

pub struct Preset {
    pub name: &'static str,
    /// Made before the per-note movement work: it keeps the settings it had then for the
    /// parameters added since (params::legacy), so it sounds as it always did
    pub classic: bool,
    pub sets: &'static [(&'static str, f32)],
}

impl Preset {
    /// The preset as stored 0..1 values: the defaults, with its settings over them, and its
    /// keyboard-range settings (EVEN, EVEN_ALL) over those.
    pub fn values(&self) -> [f32; COUNT] {
        let mut v = self.values_before_range();
        for &(name, value) in EVEN_ALL.iter().chain(even(self.name)) {
            set(&mut v, self.name, name, value);
        }
        v
    }

    /// The preset as it was before the keyboard-range work (as a song saved then has it): the
    /// parameters added since set as they sounded then.
    pub fn values_before_range(&self) -> [f32; COUNT] {
        let mut v = defaults();
        legacy(&mut v, if self.classic { COUNT_V1 } else { COUNT_V2 });
        for &(name, value) in self.sets {
            set(&mut v, self.name, name, value);
        }
        v
    }
}

fn set(v: &mut [f32; COUNT], preset: &str, name: &str, value: f32) {
    let i = index_of(name).unwrap_or_else(|| panic!("preset {preset}: no parameter {name}"));
    v[i] = param(i).kind.normal(value);
}

/// Every preset's keyboard-range settings: no step between the table's octave levels, a note's
/// random start from its step (not its pitch), and the unison's detune narrowing above middle C
/// (half way: three octaves up it beats under three times as fast, not eight)
pub const EVEN_ALL: &[(&str, f32)] = &[("Even keyboard", 1.0), ("Detune key tracking", 0.5)];

/// The filters' key tracking, so a preset's tone follows the note (its harmonics through the
/// filter the same from its lowest notes to its highest) instead of turning dull at the bottom
/// and thin at the top: basses, leads and keys 0.85, chords and pads 0.75. Each cutoff moves
/// so the preset sounds as it did on its home notes (basses F2, leads E4, keys C4, chords and
/// pads F3, where it was made and is measured). Not the formant filters (a voice's vowels stay
/// put, whatever the note: that is the sound), the combs already tracking the note, the sines and
/// the FX (their sweeps are their own)
pub const EVEN: &[(&str, &[(&str, f32)])] = &[
    ("Bass/Wobble", &[("Key tracking", 0.85), ("Cutoff", 329.2)]),
    ("Bass/Detune", &[("Key tracking", 0.85), ("Cutoff", 1321.0)]),
    ("Bass/Screech", &[("Key tracking", 0.85), ("Cutoff", 2056.0)]),
    ("Bass/Sync", &[("Key tracking", 0.85), ("Cutoff", 3671.0)]),
    ("Bass/Split", &[("Key tracking", 0.85), ("Cutoff", 367.1), ("Filter 2 key tracking", 0.85), ("Filter 2 cutoff", 1321.0)]),
    ("Lead/Supersaw", &[("Key tracking", 0.85), ("Cutoff", 8301.0)]),
    ("Lead/Rave", &[("Key tracking", 0.85), ("Cutoff", 4612.0)]),
    ("Lead/Sync", &[("Key tracking", 0.85), ("Cutoff", 6456.0)]),
    ("Lead/Fifths", &[("Key tracking", 0.85), ("Cutoff", 3228.0)]),
    ("Lead/Folded", &[("Key tracking", 0.85), ("Cutoff", 4150.0), ("Filter 2 key tracking", 0.85), ("Filter 2 cutoff", 1383.0)]),
    ("Keys/Pluck", &[("Key tracking", 0.85)]),
    ("Keys/Bell", &[("Key tracking", 0.85)]),
    ("Keys/Organ", &[("Key tracking", 0.85)]),
    ("Keys/Stab", &[("Key tracking", 0.85)]),
    ("Chords/Future bass", &[("Key tracking", 0.75), ("Cutoff", 2766.0)]),
    ("Chords/Gated", &[("Key tracking", 0.75), ("Cutoff", 4425.0)]),
    ("Chords/Minor stack", &[("Key tracking", 0.75), ("Cutoff", 1991.0)]),
    ("Pad/Dark", &[("Key tracking", 0.75), ("Cutoff", 1328.0)]),
    ("Pad/Warm strings", &[("Key tracking", 0.75), ("Cutoff", 2338.0)]),
    ("Pad/Shimmer", &[("Key tracking", 0.75), ("Cutoff", 243.8)]),
    ("Pad/Glass", &[("Key tracking", 0.75), ("Cutoff", 5532.0)]),
    ("Bass/Colour Chord Stab", &[("Key tracking", 0.85), ("Cutoff", 4405.0)]),
    ("Bass/Neuro Reese", &[("Key tracking", 0.35), ("Cutoff", 5513.0), ("Filter 2 key tracking", 1.0), ("Filter 2 cutoff", 556.0)]),
    // (With each step's random start the same whatever its note, these two came round a little
    // too alike: Dive Screech's notes each pick their band a little further, Crunch Formant's
    // two-bar sweep is gentler)
    ("Bass/Dive Screech", &[("Key tracking", 0.85), ("Cutoff", 1579.0), ("Mod 9 amount", 0.25)]),
    ("Bass/Crunch Formant", &[("LFO 3 amount 1", 0.3)]),
    ("Lead/Hardcore Supersaw", &[("Key tracking", 0.85), ("Cutoff", 6456.0)]),
    ("Pad/Wide Wash", &[("Key tracking", 0.75), ("Cutoff", 3359.0)]),
    ("Keys/Bright Pluck", &[("Key tracking", 0.85)]),
    ("Bass/Resample Chop", &[("Key tracking", 0.85), ("Cutoff", 4260.0)]),
    ("Bass/Clipped Square", &[("Key tracking", 0.85), ("Cutoff", 2202.0)]),
    ("Bass/Hard Clip Stab", &[("Key tracking", 0.85), ("Cutoff", 3524.0)]),
    ("Lead/Chip Crunch", &[("Key tracking", 0.85), ("Cutoff", 8301.0)]),
    ("Bass/Driven Legato", &[("Key tracking", 0.85), ("Cutoff", 8163.0)]),
    ("Lead/Soaring Saw", &[("Key tracking", 0.85), ("Cutoff", 3605.0)]),
    ("Chords/Silk Stack", &[("Key tracking", 0.75), ("Cutoff", 3479.0)]),
    ("Pad/Silk Wash", &[("Key tracking", 0.75), ("Cutoff", 5998.0)]),
    ("Bass/Round Root", &[("Key tracking", 0.85), ("Cutoff", 3674.0)]),
    ("Keys/Vowel Chop", &[("Key tracking", 0.85)]),
    ("Keys/Glass Pluck", &[("Key tracking", 0.85)]),
];

/// A preset's own keyboard-range settings (EVEN), if any
fn even(name: &str) -> &'static [(&'static str, f32)] {
    EVEN.iter().find(|e| e.0 == name).map_or(&[], |e| e.1)
}

const OFF: f32 = f32::NEG_INFINITY;
// Choices by their place in their lists, for reading the presets
const SAW: f32 = 2.0 / 3.0; // Basic shapes: the saw's position
const SQUARE: f32 = 1.0;
const T_BASIC: f32 = 0.0;
const T_PULSE: f32 = 1.0;
const T_DARK: f32 = 2.0;
const T_VOWEL: f32 = 3.0;
const T_HARM: f32 = 4.0;
const T_FM: f32 = 5.0;
const T_METAL: f32 = 6.0;
const T_FOLD: f32 = 7.0;
const T_SYNC: f32 = 8.0;
const T_ORGAN: f32 = 9.0;
const T_OCTAVES: f32 = 10.0;
const T_DIGITAL: f32 = 11.0;
const T_RESO: f32 = 12.0;
const T_SCREECH: f32 = 13.0;
const T_FM12: f32 = 14.0;
const T_RANDH: f32 = 15.0;
const LP12: f32 = 0.0;
const LP24: f32 = 1.0;
const LADDER: f32 = 2.0;
const BP: f32 = 3.0;
const HP12: f32 = 4.0;
const NOTCH: f32 = 6.0;
const COMB_P: f32 = 7.0;
const COMB_N: f32 = 8.0;
const FORMANT: f32 = 9.0;
const SOFT: f32 = 1.0;
const WARM: f32 = 2.0;
const HARD: f32 = 3.0;
const FOLD: f32 = 4.0;
const ASYM: f32 = 5.0;
// Warps
const W_SYNC: f32 = 1.0;
const W_BEND: f32 = 2.0;
const W_SQUEEZE: f32 = 4.0;
const W_MIRROR: f32 = 5.0;
const W_QUANT: f32 = 6.0;
const W_FOLD: f32 = 7.0;
// Stacks
const ST_OCT: f32 = 1.0;
const ST_FIFTH: f32 = 3.0;
const ST_FIFTH_OCT: f32 = 4.0;
const ST_MINOR: f32 = 6.0;
// Routes
const R_F2: f32 = 1.0;
const R_BOTH: f32 = 2.0;
const R_OUT: f32 = 3.0;
// LFO shapes and modes
const S_SINE: f32 = 0.0;
const S_TRI: f32 = 1.0;
const S_SQUARE: f32 = 4.0;
const S_WOBBLE: f32 = 5.0;
const S_STEPS: f32 = 6.0;
const S_DRIFT: f32 = 7.0;
const S_PUMP: f32 = 8.0;
const S_DRAWN1: f32 = 9.0;
const S_DRAWN2: f32 = 10.0;
const FREE: f32 = 0.0;
// Tempo divisions (their place in SYNC_NAMES)
const D_BAR: f32 = 2.0;
const D_2BARS: f32 = 1.0;
const D_QUARTER: f32 = 7.0;
const D_EIGHTH_DOT: f32 = 8.0;
const D_EIGHTH: f32 = 10.0;
const D_EIGHTH_T: f32 = 12.0;
const D_SIXTEENTH: f32 = 13.0;
// Targets
const CUTOFF: f32 = 1.0;
const RESO: f32 = 2.0;
const A_POS: f32 = 3.0;
const B_POS: f32 = 4.0;
const PITCH: f32 = 5.0;
const VOLUME: f32 = 6.0;
const DRIVE: f32 = 7.0;
const FMT: f32 = 8.0;
const A_DETUNE: f32 = 15.0;
const A_WARP: f32 = 17.0;
const B_WARP: f32 = 18.0;
const F2_CUT: f32 = 19.0;
const NOISE_T: f32 = 21.0;
const LFO1_RATE: f32 = 24.0;
const CHORUS_MIX: f32 = 28.0;
const DELAY_MIX: f32 = 30.0;
const REVERB_MIX: f32 = 31.0;
// Sources
const SRC_LFO3: f32 = 3.0;
const SRC_MENV: f32 = 7.0;
const SRC_VEL: f32 = 8.0;
const SRC_MW: f32 = 10.0;
const SRC_AT: f32 = 11.0;
const M1: f32 = 14.0;
const M2: f32 = 15.0;
const M3: f32 = 16.0;
const MONO: f32 = 1.0;
const LEGATO: f32 = 2.0;
// Added with the per-note movement work
const TUBE: f32 = 6.0;
const BITS: f32 = 7.0;
const RETRIG: f32 = 1.0;
const ENVELOPE: f32 = 2.0;
const SUSTAIN_ENV: f32 = 3.0;
const SRC_LFO1: f32 = 1.0;
const SRC_FENV: f32 = 6.0;
const SRC_NOTE: f32 = 9.0;
const SRC_NRAND: f32 = 18.0;
const SRC_NRAND_BI: f32 = 19.0;
const SRC_CHAOS: f32 = 20.0;
const F2_RES: f32 = 20.0;
const B_DETUNE: f32 = 16.0;
const PHASER_MIX: f32 = 29.0;
const PRE_DRIVE: f32 = 33.0;
const CRUSH: f32 = 34.0;
const BAND_DRIVE: f32 = 35.0;
const C_EXP: f32 = 1.0;
const C_LOG: f32 = 2.0;
const C_S: f32 = 3.0;
const CLEAN_SUB: f32 = 1.0;
const LEGATO_ONLY: f32 = 1.0;
const LINEAR: f32 = 1.0;
// Added with the loud, crunchy presets
const D_32ND: f32 = 15.0;

pub const PRESETS: &[Preset] = &[
    Preset {
        name: "Init saw",
        classic: true,
        sets: &[("A table", T_BASIC), ("A position", SAW)],
    },
    // ---------- Bass ----------
    Preset {
        name: "Bass/Wobble",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 3.0), ("A detune", 0.2), ("A width", 0.3),
            ("B position", SQUARE), ("B octave", -1.0), ("B level", -6.0),
            ("Sub level", -8.0),
            ("Filter type", LP24), ("Cutoff", 180.0), ("Resonance", 0.55), ("Key tracking", 0.3),
            ("LFO 1 shape", S_WOBBLE), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", CUTOFF), ("LFO 1 amount 1", 0.75),
            ("Drive type", WARM), ("Drive", 8.0),
            ("Voices", MONO), ("Glide", 0.04), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", LFO1_RATE), ("Mod 5 amount", 0.333),
            ("Mod 6 source", M2), ("Mod 6 target", RESO), ("Mod 6 amount", 0.6),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.6),
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Growl",
        classic: true,
        sets: &[
            ("A table", T_FM), ("A position", 0.45),
            ("B position", 0.0), ("B level", OFF),
            ("FM B → A", 0.45),
            ("Sub level", -10.0),
            ("Filter type", FORMANT), ("Cutoff", 420.0), ("Resonance", 0.5),
            ("LFO 1 shape", S_WOBBLE), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.6), ("LFO 1 target 2", FMT), ("LFO 1 amount 2", 0.35),
            ("LFO 2 shape", S_DRIFT), ("LFO 2 rate (sync)", D_QUARTER), ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.45),
            ("Drive type", SOFT), ("Drive", 14.0),
            ("Voices", MONO), ("Glide", 0.03), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", FMT), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.35), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Bass/Riddim",
        classic: true,
        sets: &[
            ("A position", SQUARE),
            ("B position", SQUARE), ("B octave", 1.0), ("B level", -8.0),
            ("Sub level", -6.0),
            ("Filter type", COMB_N), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.6),
            ("LFO 1 shape", S_SQUARE), ("LFO 1 rate (sync)", D_EIGHTH_T), ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", -0.7),
            ("Drive type", HARD), ("Drive", 10.0),
            ("Voices", MONO), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", RESO), ("Mod 5 amount", 0.6),
            ("Mod 6 source", M2), ("Mod 6 target", DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", FMT), ("Mod 7 amount", 0.4),
            ("OTT", 0.4), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Bass/Detune",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 2.0), ("A detune", 0.25), ("A width", 0.2),
            ("B table", T_PULSE), ("B position", 0.5), ("B level", -4.0),
            ("Sub level", -8.0),
            ("Filter type", LADDER), ("Cutoff", 900.0), ("Resonance", 0.2),
            ("LFO 1 shape", S_TRI), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.3), ("LFO 1 mode", FREE), ("LFO 1 target 1", B_POS), ("LFO 1 amount 1", 0.5),
            ("Drive type", WARM), ("Drive", 6.0),
            ("Voices", LEGATO), ("Glide", 0.06), ("Amp release", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", A_DETUNE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.25), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Neuro",
        classic: true,
        sets: &[
            ("A table", T_METAL), ("A position", 0.6), ("A unison", 2.0), ("A detune", 0.1),
            ("B table", T_FOLD), ("B position", 0.4), ("B level", -6.0),
            ("Sub level", -8.0),
            ("Filter type", COMB_P), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.5),
            ("LFO 1 shape", S_DRIFT), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.7),
            ("LFO 2 shape", S_STEPS), ("LFO 2 rate (sync)", D_SIXTEENTH), ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.25),
            ("Drive type", FOLD), ("Drive", 12.0), ("Drive mix", 0.6),
            ("Voices", MONO), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", RESO), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.6),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.4),
            ("OTT", 0.45), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Talking",
        classic: true,
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.2),
            ("B position", SAW), ("B level", -10.0),
            ("Sub level", -8.0),
            ("Filter type", FORMANT), ("Cutoff", 300.0), ("Resonance", 0.55),
            ("LFO 1 shape", S_DRIFT), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.8),
            ("LFO 2 shape", S_WOBBLE), ("LFO 2 rate (sync)", D_QUARTER), ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.6),
            ("Drive type", SOFT), ("Drive", 10.0),
            ("Voices", MONO), ("Glide", 0.04), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", RESO), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Yoi",
        classic: true,
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.0), ("A unison", 2.0), ("A detune", 0.12),
            ("B table", T_FM12), ("B position", 0.5), ("B level", -8.0),
            ("Sub level", -8.0),
            ("Filter type", FORMANT), ("Cutoff", 120.0), ("Resonance", 0.6),
            // The mod envelope sweeps the vowel oo → ee across each note: "yoi"
            ("Mod env attack", 0.048), ("Mod env decay", 0.25), ("Mod env sustain", 0.3),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.75),
            ("Mod 2 source", SRC_MENV), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.8),
            ("Drive type", ASYM), ("Drive", 12.0),
            ("Voices", MONO), ("Glide", 0.05), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", RESO), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", FMT), ("Mod 7 amount", 0.4),
            ("OTT", 0.4), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Tearout",
        classic: true,
        sets: &[
            ("A table", T_FM12), ("A position", 0.7), ("A warp", W_SYNC), ("A warp amount", 0.2),
            ("B table", T_SCREECH), ("B position", 0.4), ("B level", -6.0), ("B octave", 1.0),
            ("Sub level", -7.0),
            ("Filter type", COMB_N), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.45),
            ("LFO 1 shape", S_STEPS), ("LFO 1 rate (sync)", D_EIGHTH_T), ("LFO 1 target 1", A_WARP), ("LFO 1 amount 1", 0.6), ("LFO 1 target 2", B_POS), ("LFO 1 amount 2", 0.5),
            ("LFO 2 shape", S_DRAWN1), ("LFO 2 rate (sync)", D_BAR), ("LFO 2 target 1", VOLUME), ("LFO 2 amount 1", 0.8),
            ("Drive type", HARD), ("Drive", 14.0),
            ("Voices", MONO), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", A_WARP), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", FMT), ("Mod 7 amount", 0.4),
            ("OTT", 0.5), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Screech",
        classic: true,
        sets: &[
            ("A table", T_SCREECH), ("A position", 0.3), ("A unison", 3.0), ("A detune", 0.15),
            ("B on", 0.0),
            ("Sub level", -8.0),
            ("Filter type", BP), ("Cutoff", 1400.0), ("Resonance", 0.4),
            ("LFO 1 shape", S_WOBBLE), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.7), ("LFO 1 target 2", CUTOFF), ("LFO 1 amount 2", 0.3),
            ("Drive type", HARD), ("Drive", 9.0),
            ("Voices", MONO), ("Glide", 0.03), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", LFO1_RATE), ("Mod 5 amount", 0.333),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.4), ("Level", -1.5),
        ],
    },
    Preset {
        name: "Bass/Sync",
        classic: true,
        sets: &[
            ("A position", SAW), ("A warp", W_SYNC), ("A warp amount", 0.1),
            ("B position", 0.0), ("B octave", -1.0), ("B level", -6.0),
            ("Filter type", LP24), ("Cutoff", 2500.0), ("Resonance", 0.2),
            ("Mod env decay", 0.35), ("Mod env sustain", 0.1),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_WARP), ("Mod 1 amount", 0.7),
            ("Drive type", WARM), ("Drive", 6.0),
            ("Voices", MONO), ("Glide", 0.04), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", A_WARP), ("Mod 5 amount", 0.6),
            ("Mod 6 source", M2), ("Mod 6 target", CUTOFF), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Split",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 2.0), ("A detune", 0.1),
            ("B table", T_PULSE), ("B position", 0.3), ("B warp", W_SQUEEZE), ("B warp amount", 0.4), ("B route", R_F2),
            ("Sub level", -8.0),
            ("Filter type", LP24), ("Cutoff", 250.0), ("Resonance", 0.3),
            ("Filter 2 type", BP), ("Filter 2 cutoff", 900.0), ("Filter 2 resonance", 0.5), ("Filter 2 key tracking", 0.5),
            ("LFO 1 shape", S_WOBBLE), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", F2_CUT), ("LFO 1 amount 1", 0.7), ("LFO 1 target 2", B_WARP), ("LFO 1 amount 2", 0.4),
            ("Drive type", WARM), ("Drive", 8.0),
            ("Voices", MONO), ("Glide", 0.03), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", F2_CUT), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.35), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Sub",
        classic: true,
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 400.0), ("Resonance", 0.0),
            ("Drive type", WARM), ("Drive", 4.0), ("Drive mix", 0.5),
            ("Amp attack", 0.002), ("Amp release", 0.1),
            ("Voices", MONO), ("Glide", 0.03),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", CUTOFF), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", A_POS), ("Mod 7 amount", 0.3),
            ("Level", -7.0),
        ],
    },
    Preset {
        name: "Bass/808 slide",
        classic: true,
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 600.0), ("Resonance", 0.0), ("Key tracking", 0.0),
            ("Pitch envelope", 12.0), ("Pitch decay", 0.03),
            ("Drive type", SOFT), ("Drive", 10.0), ("Drive mix", 0.7),
            ("Amp attack", 0.0012), ("Amp decay", 1.6), ("Amp sustain", 0.3), ("Amp release", 0.2),
            ("Voices", LEGATO), ("Glide", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", CUTOFF), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", A_POS), ("Mod 7 amount", 0.3),
            ("Level", -3.0),
        ],
    },
    // ---------- Lead ----------
    Preset {
        name: "Lead/Supersaw",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 9.0), ("A detune", 0.35), ("A blend", 0.8), ("A width", 0.8),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 5.0), ("B detune", 0.3), ("B level", -8.0),
            ("Filter type", LP12), ("Cutoff", 9000.0), ("Resonance", 0.1),
            ("Amp attack", 0.002), ("Amp decay", 0.4), ("Amp sustain", 0.85), ("Amp release", 0.25),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.3), ("Delay mix", 0.15),
            ("Reverb on", 1.0), ("Reverb mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", -0.5),
            ("Mod 6 source", M2), ("Mod 6 target", A_DETUNE), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", REVERB_MIX), ("Mod 7 amount", 0.5),
            ("OTT", 0.3), ("Width", 0.6), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Lead/Rave",
        classic: true,
        sets: &[
            ("A table", T_PULSE), ("A position", 0.3), ("A unison", 5.0), ("A detune", 0.55), ("A width", 0.7),
            ("B position", SAW), ("B octave", -1.0), ("B unison", 3.0), ("B detune", 0.3), ("B level", -3.0),
            ("Filter type", LP12), ("Cutoff", 5000.0),
            ("Pitch envelope", -6.0), ("Pitch decay", 0.12),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.0), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.4),
            ("Voices", MONO), ("Glide", 0.08), ("Amp release", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", -0.5),
            ("OTT", 0.2), ("Width", 0.6), ("Level", -5.5),
        ],
    },
    Preset {
        name: "Lead/Sine",
        classic: true,
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 6000.0),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.5), ("LFO 1 fade in", 0.4), ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.012),
            ("Mod 1 source", SRC_MW), ("Mod 1 target", PITCH), ("Mod 1 amount", 0.03),
            ("Drive type", WARM), ("Drive", 3.0),
            ("Amp attack", 0.0016), ("Amp release", 0.2),
            ("Voices", LEGATO), ("Glide", 0.05),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.35), ("Delay mix", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("Level", -8.0),
        ],
    },
    Preset {
        name: "Lead/Sync",
        classic: true,
        sets: &[
            ("A table", T_SYNC), ("A position", 0.1), ("A unison", 3.0), ("A detune", 0.12),
            ("B position", SAW), ("B level", -10.0),
            ("Filter type", LP24), ("Cutoff", 7000.0), ("Resonance", 0.15),
            ("Mod env attack", 0.0008), ("Mod env decay", 0.6), ("Mod env sustain", 0.2),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_POS), ("Mod 1 amount", 1.0),
            ("Mod 2 source", SRC_AT), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.6),
            ("Drive type", SOFT), ("Drive", 6.0),
            ("Voices", LEGATO), ("Glide", 0.04), ("Amp release", 0.15),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH), ("Delay feedback", 0.3), ("Delay mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.6),
            ("OTT", 0.2), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Lead/Fifths",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 4.0), ("A detune", 0.2), ("A stack", ST_FIFTH), ("A width", 0.6),
            ("B on", 0.0),
            ("Filter type", LADDER), ("Cutoff", 3500.0), ("Resonance", 0.25), ("Filter envelope", 0.2),
            ("Drive type", ASYM), ("Drive", 8.0),
            ("Voices", LEGATO), ("Glide", 0.05), ("Amp release", 0.2),
            ("Delay on", 1.0), ("Delay time (sync)", D_QUARTER), ("Delay feedback", 0.3), ("Delay mix", 0.15),
            ("Reverb on", 1.0), ("Reverb mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DRIVE), ("Mod 6 amount", 0.5),
            ("OTT", 0.2), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Lead/Folded",
        classic: true,
        sets: &[
            ("A position", 0.0), ("A warp", W_FOLD), ("A warp amount", 0.3),
            ("B position", SAW), ("B warp", W_MIRROR), ("B warp amount", 0.5), ("B unison", 3.0), ("B detune", 0.15), ("B stack", ST_FIFTH_OCT), ("B level", -6.0), ("B route", R_BOTH),
            ("Filter type", LP12), ("Cutoff", 4500.0), ("Resonance", 0.1),
            ("Filter 2 type", NOTCH), ("Filter 2 cutoff", 1500.0), ("Filter 2 resonance", 0.3), ("Filter 1 into 2", 1.0),
            ("Mod env decay", 0.5), ("Mod env sustain", 0.2),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_WARP), ("Mod 1 amount", 0.6),
            ("LFO 3 shape", S_SINE), ("LFO 3 sync", 0.0), ("LFO 3 rate (Hz)", 0.4), ("LFO 3 mode", FREE),
            ("Mod 2 source", SRC_LFO3), ("Mod 2 target", F2_CUT), ("Mod 2 amount", 0.4),
            ("Voices", LEGATO), ("Glide", 0.05), ("Amp release", 0.2),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.3), ("Delay mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", A_WARP), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("Level", -10.5),
        ],
    },
    Preset {
        name: "Lead/Chip",
        classic: true,
        sets: &[
            ("A table", T_PULSE), ("A position", 0.5), ("A warp", W_QUANT), ("A warp amount", 0.75),
            ("B on", 0.0),
            ("Filter type", 10.0),
            ("LFO 1 shape", S_SQUARE), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.3),
            ("Amp attack", 0.0012), ("Amp release", 0.05),
            ("Voices", MONO),
            ("Mod 5 source", M1), ("Mod 5 target", A_WARP), ("Mod 5 amount", 0.25),
            ("Level", -7.5),
        ],
    },
    // ---------- Keys and plucks ----------
    Preset {
        name: "Keys/Pluck",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 3.0), ("A detune", 0.15),
            ("B position", SQUARE), ("B octave", 1.0), ("B level", -10.0),
            ("Filter type", LP24), ("Cutoff", 300.0), ("Filter envelope", 0.6), ("Filter decay", 0.25), ("Filter sustain", 0.0),
            ("Mod 1 source", SRC_VEL), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.25),
            ("Amp decay", 0.35), ("Amp sustain", 0.0), ("Amp release", 0.3),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.35), ("Delay mix", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("OTT", 0.2), ("Level", 2.0),
        ],
    },
    Preset {
        name: "Keys/Bell",
        classic: true,
        sets: &[
            ("A table", T_METAL), ("A position", 0.35),
            ("B position", 0.0), ("B octave", 2.0), ("B level", -12.0),
            ("Filter type", LP12), ("Cutoff", 9000.0), ("Resonance", 0.0),
            ("Amp decay", 2.5), ("Amp sustain", 0.0), ("Amp release", 1.5),
            ("Mod env decay", 0.8),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.5),
            ("Reverb on", 1.0), ("Reverb size", 0.7), ("Reverb decay", 3.5), ("Reverb mix", 0.3),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.6), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Keys/Organ",
        classic: true,
        sets: &[
            ("A table", T_ORGAN), ("A position", 0.55),
            ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 8000.0), ("Resonance", 0.0),
            ("Amp attack", 0.002), ("Amp release", 0.06),
            ("Drive type", WARM), ("Drive", 3.0),
            ("Chorus on", 1.0), ("Chorus rate", 5.0), ("Chorus depth", 0.25), ("Chorus mix", 0.5),
            ("Mod 1 source", SRC_MW), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.9),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.9),
            ("Mod 6 source", M2), ("Mod 6 target", CHORUS_MIX), ("Mod 6 amount", 0.5),
            ("Level", -3.0),
        ],
    },
    Preset {
        name: "Keys/Stab",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.3), ("A width", 0.7),
            ("B table", T_PULSE), ("B position", 0.4), ("B unison", 3.0), ("B level", -6.0),
            ("Filter type", LP24), ("Cutoff", 600.0), ("Filter envelope", 0.5), ("Filter decay", 0.3), ("Resonance", 0.2),
            ("Amp decay", 0.4), ("Amp sustain", 0.0), ("Amp release", 0.3),
            ("Reverb on", 1.0), ("Reverb size", 0.5), ("Reverb decay", 1.8), ("Reverb mix", 0.25),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("OTT", 0.3), ("Width", 0.6), ("Level", 2.0),
        ],
    },
    // ---------- Chords ----------
    Preset {
        name: "Chords/Future bass",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.3), ("A width", 0.7),
            ("B position", SQUARE), ("B unison", 5.0), ("B detune", 0.25), ("B level", -6.0),
            ("Filter type", LP24), ("Cutoff", 2500.0), ("Resonance", 0.15), ("Filter envelope", 0.25), ("Filter decay", 0.5),
            ("LFO 1 shape", S_PUMP), ("LFO 1 rate (sync)", D_QUARTER), ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", 0.85),
            ("Amp release", 0.3),
            ("Reverb on", 1.0), ("Reverb mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_DETUNE), ("Mod 6 amount", 0.4),
            ("OTT", 0.35), ("Width", 0.6), ("Level", -3.5),
        ],
    },
    Preset {
        name: "Chords/Gated",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 5.0), ("A detune", 0.25), ("A width", 0.7),
            ("B table", T_HARM), ("B position", 0.5), ("B level", -6.0),
            ("Filter type", LP12), ("Cutoff", 4000.0), ("Resonance", 0.1),
            ("LFO 1 shape", S_DRAWN2), ("LFO 1 rate (sync)", D_BAR), ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", 0.9),
            ("Amp release", 0.2),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.3), ("Delay mix", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("OTT", 0.25), ("Width", 0.6), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Chords/Minor stack",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 6.0), ("A detune", 0.12), ("A stack", ST_MINOR), ("A width", 0.6),
            ("B on", 0.0),
            ("Filter type", LP24), ("Cutoff", 1800.0), ("Filter envelope", 0.3), ("Filter decay", 0.6), ("Resonance", 0.15),
            ("Amp attack", 0.0016), ("Amp release", 0.4),
            ("Chorus on", 1.0), ("Chorus mix", 0.3),
            ("Reverb on", 1.0), ("Reverb mix", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.6), ("Level", -5.0),
        ],
    },
    // ---------- Pads ----------
    Preset {
        name: "Pad/Dark",
        classic: true,
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.3), ("A unison", 5.0), ("A detune", 0.25), ("A width", 0.7),
            ("B table", T_DARK), ("B position", 0.2), ("B unison", 5.0), ("B detune", 0.2), ("B level", -4.0),
            ("Filter type", LP24), ("Cutoff", 1200.0), ("Resonance", 0.2),
            ("Amp attack", 0.24), ("Amp release", 1.5),
            ("LFO 1 shape", S_TRI), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.15), ("LFO 1 mode", FREE), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.4),
            ("Reverb on", 1.0), ("Reverb size", 0.8), ("Reverb decay", 5.0), ("Reverb mix", 0.3),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.7), ("Level", -6.0),
        ],
    },
    Preset {
        name: "Pad/Warm strings",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.22), ("A width", 0.8),
            ("B table", T_DARK), ("B position", 0.5), ("B octave", -1.0), ("B unison", 3.0), ("B level", -6.0),
            ("Filter type", LP12), ("Cutoff", 2200.0), ("Resonance", 0.05), ("Key tracking", 0.6),
            ("Amp attack", 0.14), ("Amp release", 0.9),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 4.5), ("LFO 1 fade in", 1.0), ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.008),
            ("Chorus on", 1.0), ("Chorus mix", 0.35),
            ("Reverb on", 1.0), ("Reverb size", 0.7), ("Reverb decay", 3.0), ("Reverb mix", 0.25),
            ("Mod 1 source", SRC_MW), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.4),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.7), ("Level", -6.0),
        ],
    },
    Preset {
        name: "Pad/Shimmer",
        classic: true,
        sets: &[
            ("A table", T_OCTAVES), ("A position", 0.6), ("A unison", 4.0), ("A detune", 0.15), ("A stack", ST_OCT), ("A width", 0.9),
            ("B table", T_BASIC), ("B position", 0.15), ("B octave", 1.0), ("B unison", 3.0), ("B level", -8.0),
            ("Filter type", HP12), ("Cutoff", 180.0), ("Resonance", 0.0), ("Key tracking", 0.0),
            ("Amp attack", 0.48), ("Amp release", 2.5),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.1), ("LFO 1 mode", FREE), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.5),
            ("Phaser on", 1.0), ("Phaser rate", 0.1), ("Phaser mix", 0.4),
            ("Reverb on", 1.0), ("Reverb size", 1.0), ("Reverb decay", 8.0), ("Reverb mix", 0.4),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.8), ("Level", -4.0),
        ],
    },
    Preset {
        name: "Pad/Glass",
        classic: true,
        sets: &[
            ("A table", T_RESO), ("A position", 0.4), ("A unison", 3.0), ("A detune", 0.1), ("A width", 0.6),
            ("B table", T_DIGITAL), ("B position", 0.2), ("B level", -12.0), ("B octave", 1.0),
            ("Filter type", LP12), ("Cutoff", 5000.0), ("Resonance", 0.1),
            ("Amp attack", 0.16), ("Amp release", 1.8),
            ("LFO 1 shape", S_TRI), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.2), ("LFO 1 mode", FREE), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.5),
            ("Delay on", 1.0), ("Delay time (sync)", D_QUARTER), ("Delay feedback", 0.45), ("Delay mix", 0.2),
            ("Reverb on", 1.0), ("Reverb size", 0.9), ("Reverb decay", 6.0), ("Reverb mix", 0.35),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.8), ("Level", -6.0),
        ],
    },
    // ---------- FX ----------
    Preset {
        name: "FX/Riser",
        classic: true,
        sets: &[
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.4), ("A width", 0.8),
            ("B on", 0.0),
            ("Noise level", -10.0),
            ("Filter type", BP), ("Cutoff", 300.0), ("Resonance", 0.4), ("Key tracking", 0.0),
            ("Mod env attack", 3.2), ("Mod env sustain", 1.0), ("Mod env release", 0.5),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 1.0),
            ("Mod 2 source", SRC_MENV), ("Mod 2 target", PITCH), ("Mod 2 amount", 1.0),
            ("Mod 3 source", SRC_MENV), ("Mod 3 target", NOISE_T), ("Mod 3 amount", 1.0),
            ("Amp attack", 0.8), ("Amp release", 1.0),
            ("Reverb on", 1.0), ("Reverb size", 0.9), ("Reverb decay", 4.0), ("Reverb mix", 0.35),
            ("Mod 5 source", M1), ("Mod 5 target", REVERB_MIX), ("Mod 5 amount", 0.5),
            ("Width", 0.8), ("Level", -8.0),
        ],
    },
    Preset {
        name: "FX/Downlifter",
        classic: true,
        sets: &[
            ("A table", T_FM), ("A position", 0.5),
            ("B on", 0.0),
            ("Noise level", -12.0), ("Noise route", R_OUT),
            ("Filter type", LP24), ("Cutoff", 6000.0), ("Resonance", 0.2), ("Key tracking", 0.0), ("Filter envelope", -0.6), ("Filter decay", 2.5),
            ("Pitch envelope", 24.0), ("Pitch decay", 1.2),
            ("Amp decay", 3.0), ("Amp sustain", 0.0), ("Amp release", 1.0),
            ("Reverb on", 1.0), ("Reverb size", 1.0), ("Reverb decay", 5.0), ("Reverb mix", 0.4),
            ("Width", 0.8), ("Level", -3.0),
        ],
    },
    Preset {
        name: "FX/Laser",
        classic: true,
        sets: &[
            ("A table", T_BASIC), ("A position", 0.3), ("A warp", W_BEND), ("A warp amount", 0.4),
            ("B on", 0.0),
            ("Filter type", 10.0),
            ("Pitch envelope", 24.0), ("Pitch decay", 0.15),
            ("Amp decay", 0.4), ("Amp sustain", 0.0), ("Amp release", 0.2),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH), ("Delay feedback", 0.4), ("Delay mix", 0.3),
            ("Level", -1.0),
        ],
    },
    // ---------- Made for per-note movement: no two notes alike, the sub clean under it all ----------
    Preset {
        name: "Bass/Talking Growl",
        classic: false,
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.3), ("A unison", 2.0), ("A detune", 0.08),
            ("B table", T_FM), ("B position", 0.4), ("B level", -7.0),
            ("FM B → A", 0.25),
            ("Sub level", -6.0), ("Sub path", CLEAN_SUB),
            ("Filter type", FORMANT), ("Cutoff", 350.0), ("Resonance", 0.55),
            // Each note says its own word: an envelope LFO sweeps the vowel and the table once,
            // from a place and by an amount the note picks at random
            ("LFO 1 shape", S_DRAWN1), ("LFO 1 mode", ENVELOPE), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 smooth", 0.3),
            ("LFO 1 target 2", A_POS), ("LFO 1 amount 2", 0.5),
            // (Its vowel sweep goes through the matrix: each note sweeps it its own way and depth)
            ("Mod 9 source", SRC_LFO1), ("Mod 9 target", CUTOFF), ("Mod 9 amount", 0.35), ("Mod 9 via", SRC_NRAND_BI),
            ("Shape 1 step 1", -1.0), ("Shape 1 step 2", -0.6), ("Shape 1 step 3", 0.2), ("Shape 1 step 4", 0.8), ("Shape 1 step 5", 1.0), ("Shape 1 step 6", 0.7),
            ("Shape 1 step 7", 0.2), ("Shape 1 step 8", -0.2), ("Shape 1 step 9", -0.5), ("Shape 1 step 10", -0.3), ("Shape 1 step 11", 0.3), ("Shape 1 step 12", 0.6),
            ("Shape 1 step 13", 0.4), ("Shape 1 step 14", 0.0), ("Shape 1 step 15", -0.4), ("Shape 1 step 16", -0.6), ("Shape 1 smooth", 0.8),
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.3),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.6),
            ("Mod 3 source", SRC_NRAND), ("Mod 3 target", FMT), ("Mod 3 amount", 0.35), ("Mod 3 curve", C_EXP),
            // Over two bars the table sweeps a little further and back (free, with the song)
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", A_POS), ("LFO 3 amount 1", 0.6),
            ("Mod 4 source", SRC_VEL), ("Mod 4 target", DRIVE), ("Mod 4 amount", 0.25),
            ("Drive type", TUBE), ("Drive", 12.0),
            ("Band drive type", SOFT), ("Band drive", 8.0), ("Band drive mix", 0.6),
            ("Voices", MONO), ("Glide", 0.03), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", LFO1_RATE), ("Mod 5 amount", 0.333),
            ("Mod 6 source", M2), ("Mod 6 target", CUTOFF), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("EQ on", 1.0), ("EQ high", 5.0), ("EQ high freq", 4500.0),
            ("OTT", 0.35), ("Level", -4.0),
        ],
    },
    Preset {
        name: "Bass/Riddim Cell",
        classic: false,
        sets: &[
            ("A table", T_PULSE), ("A position", 0.5), ("A unison", 2.0), ("A detune", 0.05),
            ("B table", T_PULSE), ("B position", 0.7), ("B octave", 1.0), ("B level", -9.0),
            ("Sub level", -5.0), ("Sub path", CLEAN_SUB),
            ("Filter type", COMB_N), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.55),
            // A gate on every 16th, restarting with the note; the drive steps to a new level on
            // each 16th (chaos), and each note picks its own grit and comb
            ("LFO 1 shape", S_SQUARE), ("LFO 1 mode", RETRIG), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 phase", 0.0), ("LFO 1 smooth", 0.08),
            ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", -0.55),
            ("Chaos rate (sync)", D_SIXTEENTH),
            ("Mod 1 source", SRC_CHAOS), ("Mod 1 target", DRIVE), ("Mod 1 amount", 0.5),
            ("Mod 2 source", SRC_NRAND_BI), ("Mod 2 target", RESO), ("Mod 2 amount", 0.4),
            ("Mod 3 source", SRC_NRAND), ("Mod 3 target", A_POS), ("Mod 3 amount", 0.45),
            // Over two bars the pulse width sweeps a little further and back, and the drive with
            // it (free, with the song)
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", A_POS), ("LFO 3 amount 1", 0.45),
            ("LFO 3 target 2", DRIVE), ("LFO 3 amount 2", 0.15),
            ("Mod 4 source", SRC_CHAOS), ("Mod 4 target", CRUSH), ("Mod 4 amount", 0.5), ("Mod 4 curve", C_S),
            ("Mod 9 source", SRC_CHAOS), ("Mod 9 target", B_POS), ("Mod 9 amount", -0.6),
            ("Drive type", FOLD), ("Drive", 8.0),
            ("Band drive type", BITS), ("Band drive", 6.0), ("Band drive mix", 0.35), ("Band drive crush", 0.35),
            ("Voices", MONO), ("Amp release", 0.05),
            ("Mod 5 source", M1), ("Mod 5 target", RESO), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", BAND_DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.4), ("Level", -3.5),
        ],
    },
    Preset {
        name: "Bass/Colour Chord Stab",
        classic: false,
        sets: &[
            // One key plays a bright minor chord: the stack puts the unison voices on its notes
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.2), ("A blend", 0.75), ("A width", 0.6), ("A stack", ST_MINOR),
            ("B table", T_HARM), ("B position", 0.6), ("B unison", 3.0), ("B detune", 0.2), ("B level", -8.0), ("B stack", ST_OCT),
            ("Sub level", -7.0), ("Sub path", CLEAN_SUB),
            ("Filter type", LP24), ("Cutoff", 3000.0), ("Resonance", 0.25), ("Filter envelope", 0.45),
            ("Filter attack", 0.0004), ("Filter decay", 0.18), ("Filter sustain", 0.35),
            // Over two bars the stabs open and close a little (free, with the song)
            ("LFO 3 shape", S_SINE), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.18),
            ("Filter 2 type", COMB_P), ("Filter 2 cutoff", 261.6), ("Filter 2 key tracking", 1.0), ("Filter 2 resonance", 0.4), ("Filter 1 into 2", 1.0),
            ("Amp attack", 0.0012), ("Amp decay", 0.22), ("Amp sustain", 0.35), ("Amp release", 0.12),
            // Each stab its own colour: the comb's tuning and the brightness move per note
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", F2_CUT), ("Mod 1 amount", 0.08),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", F2_RES), ("Mod 2 amount", 0.4),
            ("Mod 3 source", SRC_VEL), ("Mod 3 target", CUTOFF), ("Mod 3 amount", 0.25), ("Mod 3 via", SRC_FENV),
            ("Mod 4 source", SRC_NRAND), ("Mod 4 target", B_POS), ("Mod 4 amount", 0.8),
            ("Mod 9 source", SRC_NRAND_BI), ("Mod 9 target", CUTOFF), ("Mod 9 amount", 0.45),
            ("Drive type", SOFT), ("Drive", 6.0), ("Drive tone", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", F2_RES), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("EQ on", 1.0), ("EQ high", 6.0), ("EQ high freq", 4000.0),
            ("OTT", 0.35), ("Width", 0.7), ("Level", 1.5),
        ],
    },
    Preset {
        name: "Bass/Neuro Reese",
        classic: false,
        sets: &[
            // The reese: two saws a little apart, through the drive, then a comb that moves per
            // note, then the phaser
            ("A position", SAW), ("A unison", 2.0), ("A detune", 0.22), ("A width", 0.3),
            ("B position", SAW), ("B fine", 18.0), ("B unison", 2.0), ("B detune", 0.3), ("B level", -2.0),
            ("Sub level", -6.0), ("Sub path", CLEAN_SUB),
            ("Pre drive type", TUBE), ("Pre drive", 18.0),
            ("Filter type", LP24), ("Cutoff", 6500.0), ("Resonance", 0.25),
            ("Filter 2 type", COMB_P), ("Filter 2 cutoff", 400.0), ("Filter 2 key tracking", 0.7), ("Filter 2 resonance", 0.55), ("Filter 1 into 2", 1.0),
            // The comb sweeps once per note (an envelope LFO), from a place each note picks
            ("LFO 1 shape", S_TRI), ("LFO 1 mode", ENVELOPE), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 smooth", 0.2),
            ("LFO 1 target 1", F2_CUT), ("LFO 1 amount 1", 0.35), ("LFO 1 target 2", CUTOFF), ("LFO 1 amount 2", 0.25),
            ("LFO 2 shape", S_DRIFT), ("LFO 2 mode", RETRIG), ("LFO 2 rate (sync)", D_EIGHTH_T), ("LFO 2 target 1", B_DETUNE), ("LFO 2 amount 1", 0.4),
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", F2_CUT), ("Mod 1 amount", 0.08),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", PRE_DRIVE), ("Mod 2 amount", 0.4),
            ("Mod 3 source", SRC_CHAOS), ("Mod 3 target", PHASER_MIX), ("Mod 3 amount", 0.4),
            ("Mod 4 source", SRC_NOTE), ("Mod 4 target", CUTOFF), ("Mod 4 amount", 0.3),
            ("Mod 9 source", SRC_NRAND_BI), ("Mod 9 target", CUTOFF), ("Mod 9 amount", 0.25),
            ("Mod 10 source", SRC_NRAND), ("Mod 10 target", A_DETUNE), ("Mod 10 amount", 0.4),
            ("Chaos rate (sync)", D_EIGHTH), ("Chaos smooth", 0.5),
            // Over two bars the whole riff opens and closes a little (free, with the song): a riff
            // that repeats each bar comes back alike, not the same
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.2),
            ("Drive type", WARM), ("Drive", 12.0),
            // A shelf over 4 kHz: the growl's top cuts through the mix
            ("EQ on", 1.0), ("EQ high", 7.0), ("EQ high freq", 4000.0),
            ("Phaser on", 1.0), ("Phaser rate", 0.3), ("Phaser depth", 0.7), ("Phaser feedback", 0.5), ("Phaser mix", 0.25),
            ("Voices", LEGATO), ("Glide", 0.05), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.1),
            ("Mod 5 source", M1), ("Mod 5 target", F2_CUT), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", PRE_DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", PHASER_MIX), ("Mod 7 amount", 0.5),
            ("OTT", 0.4), ("Level", -3.5),
        ],
    },
    Preset {
        name: "Bass/Dive Screech",
        classic: false,
        sets: &[
            ("A table", T_SCREECH), ("A position", 0.35), ("A unison", 3.0), ("A detune", 0.12),
            ("B table", T_FM12), ("B position", 0.3), ("B octave", 1.0), ("B level", -10.0),
            ("FM B → A", 0.35),
            ("Sub level", -6.0), ("Sub path", CLEAN_SUB),
            ("Filter type", BP), ("Cutoff", 1200.0), ("Resonance", 0.35), ("Key tracking", 0.6),
            // Each note dives an octave into place (straight, over 90 ms)
            ("Pitch envelope", 12.0), ("Pitch decay", 0.09), ("Pitch envelope curve", LINEAR),
            // The FM screams on the attack and settles; how far is the note's own
            ("Mod env attack", 0.0004), ("Mod env decay", 0.2), ("Mod env sustain", 0.35),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", FMT), ("Mod 1 amount", 0.4), ("Mod 1 via", SRC_NRAND),
            ("Mod 2 source", SRC_NRAND_BI), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.3),
            ("Mod 3 source", SRC_MENV), ("Mod 3 target", CUTOFF), ("Mod 3 amount", 0.35), ("Mod 3 curve", C_LOG),
            ("Mod 9 source", SRC_NRAND_BI), ("Mod 9 target", CUTOFF), ("Mod 9 amount", 0.15),
            ("LFO 1 shape", S_SINE), ("LFO 1 mode", RETRIG), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 7.0), ("LFO 1 delay", 0.12), ("LFO 1 fade in", 0.1),
            ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.03),
            // Over two bars the band opens and closes a little (free, with the song)
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.15),
            ("Drive type", HARD), ("Drive", 10.0), ("Drive tone", 0.3),
            // (A touch of top: before the drive ran at twice the rate it dulled the highs, and 3 dB here made up for it)
            ("EQ on", 1.0), ("EQ high", 0.5), ("EQ high freq", 5000.0),
            ("Voices", MONO), ("Glide", 0.04), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.07),
            ("Mod 5 source", M1), ("Mod 5 target", FMT), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("OTT", 0.4), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Clean Sub",
        classic: false,
        sets: &[
            // A pure sine in the middle, to lay under a growl (its own sub is off)
            ("A position", 0.0), ("A width", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 3000.0), ("Resonance", 0.0), ("Key tracking", 0.5),
            ("Amp attack", 0.002), ("Amp release", 0.06),
            ("Voices", LEGATO), ("Glide", 0.04), ("Glide mode", LEGATO_ONLY),
            ("Width", 0.0),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.3),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.15),
            ("Mod 7 source", M3), ("Mod 7 target", CUTOFF), ("Mod 7 amount", -0.8),
            ("Drive type", TUBE), ("Drive", 0.0), ("Drive mix", 0.6),
            ("Level", -9.0),
        ],
    },
    Preset {
        name: "Lead/Hardcore Supersaw",
        classic: false,
        sets: &[
            ("A position", SAW), ("A unison", 11.0), ("A detune", 0.42), ("A blend", 0.85), ("A width", 0.9),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 7.0), ("B detune", 0.35), ("B level", -6.0), ("B width", 0.9),
            ("Filter type", LP12), ("Cutoff", 7000.0), ("Resonance", 0.1), ("Filter envelope", 0.2), ("Filter decay", 0.25), ("Filter sustain", 0.4),
            ("Pitch envelope", 2.0), ("Pitch decay", 0.03),
            ("Amp attack", 0.0012), ("Amp decay", 0.5), ("Amp sustain", 0.85), ("Amp release", 0.25),
            ("Mod 1 source", SRC_VEL), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.15),
            ("Mod 2 source", SRC_NRAND_BI), ("Mod 2 target", A_DETUNE), ("Mod 2 amount", 0.08),
            ("Band drive type", SOFT), ("Band drive", 9.0), ("Band drive mix", 0.5), ("Band low split", 200.0),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.3), ("Delay mix", 0.15),
            ("Reverb on", 1.0), ("Reverb mix", 0.18), ("Reverb decay", 1.8),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", -0.5),
            ("Mod 6 source", M2), ("Mod 6 target", BAND_DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", REVERB_MIX), ("Mod 7 amount", 0.5),
            ("OTT", 0.4), ("Width", 0.75), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Pad/Wide Wash",
        classic: false,
        sets: &[
            ("A position", SAW), ("A unison", 8.0), ("A detune", 0.3), ("A width", 1.0),
            ("B table", T_HARM), ("B position", 0.4), ("B unison", 6.0), ("B detune", 0.25), ("B width", 1.0), ("B octave", 1.0), ("B level", -9.0),
            ("Filter type", LP12), ("Cutoff", 2800.0), ("Resonance", 0.15), ("Key tracking", 0.3),
            ("Amp attack", 0.6), ("Amp decay", 1.0), ("Amp sustain", 0.9), ("Amp release", 1.8),
            // Air on top, a little less of the crowded low mids, and the chords' low notes kept in
            // the middle (the side loses what's under 250 Hz)
            ("EQ on", 1.0), ("EQ high", 2.5), ("EQ high freq", 7000.0), ("EQ mid", -3.0), ("EQ mid freq", 400.0),
            ("Mono below", 250.0),
            // Slow and never quite the same twice: free drifts (with the song), a random tilt per chord note
            ("LFO 1 shape", S_DRIFT), ("LFO 1 mode", FREE), ("LFO 1 rate (sync)", D_BAR), ("LFO 1 smooth", 0.5),
            ("LFO 1 target 1", CUTOFF), ("LFO 1 amount 1", 0.15), ("LFO 1 target 2", B_POS), ("LFO 1 amount 2", 0.3),
            // Each chord opens up over a bar and stays open while it's held, then closes as it ends
            ("LFO 2 shape", S_TRI), ("LFO 2 mode", SUSTAIN_ENV), ("LFO 2 rate (sync)", 1.0), ("LFO 2 sustain point", 0.5),
            ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.2),
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", 9.0), ("Mod 1 amount", 0.4),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.1),
            ("Chorus on", 1.0), ("Chorus rate", 0.3), ("Chorus depth", 0.6), ("Chorus mix", 0.45),
            ("Reverb on", 1.0), ("Reverb size", 0.85), ("Reverb decay", 5.0), ("Reverb mix", 0.4),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 1.0), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Keys/Bright Pluck",
        classic: false,
        sets: &[
            ("A position", SAW), ("A unison", 3.0), ("A detune", 0.15), ("A width", 0.6),
            ("B position", SQUARE), ("B octave", 1.0), ("B level", -10.0),
            ("Filter type", LP24), ("Cutoff", 600.0), ("Resonance", 0.2), ("Filter envelope", 0.6), ("Key tracking", 0.6),
            ("Filter decay", 0.22), ("Filter sustain", 0.0),
            ("Amp attack", 0.0012), ("Amp decay", 0.45), ("Amp sustain", 0.0), ("Amp release", 0.3),
            ("Mod 1 source", SRC_VEL), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.2), ("Mod 1 curve", C_EXP),
            ("Mod 2 source", SRC_NRAND_BI), ("Mod 2 target", 9.0), ("Mod 2 amount", 0.3),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.3), ("Delay mix", 0.2),
            ("Reverb on", 1.0), ("Reverb mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("OTT", 0.25), ("Width", 0.6), ("Level", 2.0),
        ],
    },
    // ---------- Loud and crunchy: the modern drop's sounds (clipped on purpose, every 16th its own) ----------
    Preset {
        name: "Bass/Crunch Formant",
        classic: false,
        sets: &[
            // A vowel table hard-clipped before a formant filter: a talking growl with a crunchy edge
            ("A table", T_VOWEL), ("A position", 0.4), ("A unison", 2.0), ("A detune", 0.06),
            ("B table", T_FM), ("B position", 0.5), ("B level", -6.0),
            ("FM B → A", 0.3),
            ("Sub level", -6.0), ("Sub path", CLEAN_SUB),
            ("Pre drive type", HARD), ("Pre drive", 14.0),
            ("Filter type", FORMANT), ("Cutoff", 520.0), ("Resonance", 0.6),
            // Each note its own vowel and table place; the FM steps to a new depth every 16th
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.38),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.55),
            ("Chaos rate (sync)", D_SIXTEENTH), ("Chaos smooth", 0.1),
            ("Mod 3 source", SRC_CHAOS), ("Mod 3 target", FMT), ("Mod 3 amount", 0.3),
            // ...and says its word once (an envelope LFO through the formant), its own way and depth
            ("LFO 1 shape", S_DRAWN1), ("LFO 1 mode", ENVELOPE), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 smooth", 0.25),
            ("Mod 9 source", SRC_LFO1), ("Mod 9 target", CUTOFF), ("Mod 9 amount", 0.3), ("Mod 9 via", SRC_NRAND_BI),
            ("Shape 1 step 1", -0.8), ("Shape 1 step 2", 0.1), ("Shape 1 step 3", 0.9), ("Shape 1 step 4", 1.0), ("Shape 1 step 5", 0.5),
            ("Shape 1 step 6", -0.2), ("Shape 1 step 7", -0.6), ("Shape 1 step 8", -0.2), ("Shape 1 step 9", 0.4), ("Shape 1 step 10", 0.7),
            ("Shape 1 step 11", 0.3), ("Shape 1 step 12", -0.3), ("Shape 1 step 13", -0.7), ("Shape 1 step 14", -0.4), ("Shape 1 step 15", 0.0),
            ("Shape 1 step 16", -0.5), ("Shape 1 smooth", 0.6),
            // Over two bars the table sweeps a little further and back (free, with the song)
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", A_POS), ("LFO 3 amount 1", 0.4),
            ("Drive type", HARD), ("Drive", 9.0), ("Drive tone", 0.3),
            ("Band drive type", BITS), ("Band drive", 6.0), ("Band drive mix", 0.3), ("Band drive crush", 0.3),
            ("Voices", MONO), ("Glide", 0.035), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", PRE_DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", CRUSH), ("Mod 7 amount", 0.5),
            ("EQ on", 1.0), ("EQ high", 5.0), ("EQ high freq", 4500.0),
            ("OTT", 0.4), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Bass/Resample Chop",
        classic: false,
        sets: &[
            // As if resampled and chopped: every 16th jumps to another slice of a digital table,
            // crushed and downsampled, the note held through it
            ("A table", T_HARM), ("A position", 0.3), ("A unison", 2.0), ("A detune", 0.05),
            ("B table", T_RANDH), ("B position", 0.5), ("B level", -5.0),
            ("Sub level", -6.0), ("Sub path", CLEAN_SUB),
            ("Filter type", LP24), ("Cutoff", 2600.0), ("Resonance", 0.3), ("Key tracking", 0.4),
            ("Chaos rate (sync)", D_SIXTEENTH), ("Chaos smooth", 0.0),
            ("Mod 1 source", SRC_CHAOS), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.38),
            ("Mod 2 source", SRC_CHAOS), ("Mod 2 target", CUTOFF), ("Mod 2 amount", 0.35), ("Mod 2 curve", C_S),
            ("Mod 3 source", SRC_NRAND), ("Mod 3 target", B_POS), ("Mod 3 amount", 0.6),
            ("Mod 4 source", SRC_NRAND_BI), ("Mod 4 target", CRUSH), ("Mod 4 amount", 0.3),
            // A chop inside each 16th now and then: a 32nd gate, its depth the note's own
            ("LFO 1 shape", S_SQUARE), ("LFO 1 mode", RETRIG), ("LFO 1 rate (sync)", D_32ND), ("LFO 1 smooth", 0.1),
            ("Mod 9 source", SRC_LFO1), ("Mod 9 target", VOLUME), ("Mod 9 amount", -0.25), ("Mod 9 via", SRC_NRAND),
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.22),
            ("Pre drive type", BITS), ("Pre drive", 6.0), ("Pre drive mix", 0.5), ("Pre drive crush", 0.4),
            ("Drive type", HARD), ("Drive", 10.0), ("Drive tone", 0.25),
            ("Voices", MONO), ("Glide", 0.02), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.05),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", CRUSH), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("EQ on", 1.0), ("EQ high", 4.0), ("EQ high freq", 5000.0),
            ("OTT", 0.4), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Clipped Square",
        classic: false,
        sets: &[
            // A square an octave under a saw, hard-clipped: a bright, buzzing bass that jumps and
            // glides across two octaves, each note a different width and brightness
            ("A table", T_PULSE), ("A position", 0.5), ("A unison", 2.0), ("A detune", 0.04),
            ("B position", SAW), ("B octave", 1.0), ("B level", -9.0),
            ("Sub level", -5.0), ("Sub path", CLEAN_SUB),
            ("Filter type", LP24), ("Cutoff", 1500.0), ("Resonance", 0.3), ("Key tracking", 0.5), ("Filter envelope", 0.35),
            ("Filter attack", 0.0004), ("Filter decay", 0.12), ("Filter sustain", 0.3),
            ("Mod 1 source", SRC_NRAND), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.4),
            ("Mod 2 source", SRC_NRAND_BI), ("Mod 2 target", CUTOFF), ("Mod 2 amount", 0.4),
            ("Chaos rate (sync)", D_SIXTEENTH), ("Chaos smooth", 0.15),
            ("Mod 3 source", SRC_CHAOS), ("Mod 3 target", DRIVE), ("Mod 3 amount", 0.35),
            ("Mod 4 source", SRC_VEL), ("Mod 4 target", CUTOFF), ("Mod 4 amount", 0.2), ("Mod 4 via", SRC_FENV),
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.35), ("LFO 3 target 2", A_POS), ("LFO 3 amount 2", 0.3),
            ("Drive type", HARD), ("Drive", 16.0), ("Drive tone", 0.3),
            ("Band drive type", SOFT), ("Band drive", 6.0), ("Band drive mix", 0.4),
            ("Voices", LEGATO), ("Glide", 0.045), ("Glide mode", LEGATO_ONLY), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.5),
            ("EQ on", 1.0), ("EQ high", 4.0), ("EQ high freq", 4500.0),
            ("OTT", 0.35), ("Level", -4.8),
        ],
    },
    Preset {
        name: "Bass/Hard Clip Stab",
        classic: false,
        sets: &[
            // One key plays a fifth-and-octave stack of saws, clipped flat: a short, crunchy stab
            ("A position", SAW), ("A unison", 5.0), ("A detune", 0.18), ("A blend", 0.7), ("A width", 0.5), ("A stack", ST_FIFTH_OCT),
            ("B table", T_PULSE), ("B position", 0.4), ("B level", -8.0),
            ("Sub level", -7.0), ("Sub path", CLEAN_SUB),
            ("Filter type", LP24), ("Cutoff", 2400.0), ("Resonance", 0.2), ("Filter envelope", 0.5),
            ("Filter attack", 0.0004), ("Filter decay", 0.15), ("Filter sustain", 0.25),
            ("Amp attack", 0.0012), ("Amp decay", 0.2), ("Amp sustain", 0.45), ("Amp release", 0.08),
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", CUTOFF), ("Mod 1 amount", 0.4),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", B_POS), ("Mod 2 amount", 0.7),
            ("Mod 3 source", SRC_VEL), ("Mod 3 target", CUTOFF), ("Mod 3 amount", 0.25), ("Mod 3 via", SRC_FENV),
            ("Chaos rate (sync)", D_SIXTEENTH), ("Chaos smooth", 0.0),
            ("Mod 4 source", SRC_CHAOS), ("Mod 4 target", A_POS), ("Mod 4 amount", 0.3),
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.35), ("LFO 3 target 2", B_POS), ("LFO 3 amount 2", 0.4),
            ("Drive type", HARD), ("Drive", 18.0), ("Drive tone", 0.35),
            ("Voices", MONO), ("Amp release", 0.06),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_DETUNE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.4),
            ("EQ on", 1.0), ("EQ high", 4.0), ("EQ high freq", 4500.0),
            ("OTT", 0.35), ("Width", 0.6), ("Level", 1.3),
        ],
    },
    Preset {
        name: "Lead/Chip Crunch",
        classic: false,
        sets: &[
            // A narrow pulse, bit-crushed, with a short glide: a chip lead made loud and modern
            // (driven, squeezed, a slap of delay, a little width)
            ("A table", T_PULSE), ("A position", 0.25), ("A warp", W_QUANT), ("A warp amount", 0.45),
            ("B table", T_PULSE), ("B position", 0.5), ("B octave", 1.0), ("B level", -12.0), ("B fine", 7.0),
            ("Sub level", OFF), ("Sub path", CLEAN_SUB),
            ("Filter type", LP12), ("Cutoff", 9000.0), ("Resonance", 0.1),
            ("Amp attack", 0.0012), ("Amp release", 0.06),
            // A delayed vibrato, and the pulse width a little different on each note
            ("LFO 1 shape", S_SINE), ("LFO 1 mode", RETRIG), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 6.5), ("LFO 1 delay", 0.15), ("LFO 1 fade in", 0.1),
            ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.03),
            ("Mod 1 source", SRC_NRAND), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.2),
            ("Pre drive type", BITS), ("Pre drive", 3.0), ("Pre drive mix", 0.6), ("Pre drive crush", 0.35),
            ("Drive type", HARD), ("Drive", 6.0),
            ("Delay on", 1.0), ("Delay time (sync)", D_SIXTEENTH), ("Delay feedback", 0.2), ("Delay mix", 0.12),
            ("Voices", LEGATO), ("Glide", 0.03), ("Glide mode", LEGATO_ONLY),
            ("Mod 5 source", M1), ("Mod 5 target", CRUSH), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", A_WARP), ("Mod 6 amount", 0.5),
            ("EQ on", 1.0), ("EQ low", -4.0), ("EQ low freq", 300.0),
            ("OTT", 0.4), ("Width", 0.45), ("Level", -0.5),
        ],
    },
    Preset {
        name: "Bass/Driven Legato",
        classic: false,
        sets: &[
            // One gritty voice that holds through a riff: detuned saws over a square, clipped
            // twice, in the middle, playing legato and gliding into each joined note. No per-note
            // randomness, no filter envelope and velocity left out, so a run of notes is one
            // continuous sound: the movement is the pitch, plus a slow two-bar sweep of brightness
            ("A position", SAW), ("A unison", 5.0), ("A detune", 0.25), ("A blend", 0.8), ("A width", 0.5),
            ("B table", T_PULSE), ("B position", 0.5), ("B level", -3.0),
            ("Sub level", -9.0), ("Sub path", CLEAN_SUB),
            ("Noise level", -24.0),
            ("Filter type", LP24), ("Cutoff", 4000.0), ("Resonance", 0.15), ("Key tracking", 0.2), ("Filter envelope", 0.0),
            ("Amp attack", 0.002), ("Amp sustain", 1.0), ("Amp release", 0.05), ("Velocity", 0.0),
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.2), ("LFO 3 target 2", A_POS), ("LFO 3 amount 2", 0.15),
            ("Pre drive type", HARD), ("Pre drive", 10.0),
            ("Drive type", HARD), ("Drive", 24.0), ("Drive tone", 0.4),
            ("Band drive type", SOFT), ("Band drive", 6.0), ("Band drive mix", 0.4),
            ("Voices", LEGATO), ("Glide", 0.05), ("Glide mode", LEGATO_ONLY),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.3),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.4),
            ("OTT", 0.3), ("Width", 0.8), ("Level", -4.0),
        ],
    },
    // ---------- A melodic song's sounds: a singing lead, the stack and wash under it, a held bass, chops, a glass pluck, a reverse swell ----------
    Preset {
        name: "Lead/Soaring Saw",
        classic: false,
        sets: &[
            // A wide supersaw that sings a tune: darker on top than Supersaw, detuned less than Supersaw (its voices within about 12 cents, so it sits in tune with a piano), with a
            // gentle vibrato (about 6 cents) that only comes in on a held note, a quiet quarter-note echo and a long room
            ("A position", SAW), ("A unison", 9.0), ("A detune", 0.42), ("A blend", 0.8), ("A width", 0.85),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 5.0), ("B detune", 0.22), ("B level", -13.0), ("B width", 0.8),
            ("Filter type", LP12), ("Cutoff", 4000.0), ("Resonance", 0.1), ("Key tracking", 0.4),
            ("Filter envelope", 0.12), ("Filter decay", 0.3), ("Filter sustain", 0.5),
            ("Amp attack", 0.004), ("Amp decay", 0.4), ("Amp sustain", 0.85), ("Amp release", 0.3),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.2), ("LFO 1 mode", RETRIG), ("LFO 1 fade in", 0.6),
            ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.005),
            ("Delay on", 1.0), ("Delay time (sync)", D_QUARTER), ("Delay feedback", 0.2), ("Delay mix", 0.08),
            ("Reverb on", 1.0), ("Reverb decay", 2.4), ("Reverb mix", 0.35),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", -0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_DETUNE), ("Mod 6 amount", 0.4),
            ("Mod 7 source", M3), ("Mod 7 target", REVERB_MIX), ("Mod 7 amount", 0.5),
            ("OTT", 0.3), ("Width", 0.7), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Chords/Silk Stack",
        classic: false,
        sets: &[
            // Held supersaw chords to sit under a lead: dark (the top under 3 kHz), softly driven
            // above 200 Hz, a little less of the crowded low mids, wide from its unison alone (no
            // chorus: its pitch wobble put the chords out of tune with the piano)
            ("A position", SAW), ("A unison", 11.0), ("A detune", 0.42), ("A blend", 0.85), ("A width", 0.9),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 7.0), ("B detune", 0.35), ("B level", -8.0), ("B width", 0.9),
            ("Filter type", LP12), ("Cutoff", 2900.0), ("Resonance", 0.1), ("Key tracking", 0.3),
            ("Filter envelope", 0.15), ("Filter decay", 0.3), ("Filter sustain", 0.4),
            ("Amp attack", 0.006), ("Amp decay", 0.6), ("Amp sustain", 0.85), ("Amp release", 0.35),
            ("Band drive type", SOFT), ("Band drive", 6.0), ("Band drive mix", 0.5), ("Band low split", 200.0),
            ("EQ on", 1.0), ("EQ mid", -2.0), ("EQ mid freq", 400.0),
            ("Mono below", 200.0),
            ("Reverb on", 1.0), ("Reverb decay", 2.2), ("Reverb mix", 0.4),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", BAND_DRIVE), ("Mod 6 amount", 0.5),
            ("Mod 7 source", M3), ("Mod 7 target", REVERB_MIX), ("Mod 7 amount", 0.4),
            ("OTT", 0.35), ("Width", 0.85), ("Level", 0.5),
        ],
    },
    Preset {
        name: "Pad/Silk Wash",
        classic: false,
        sets: &[
            // Wide Wash opened up and further away: brighter, a slower swell, a longer room; its low
            // notes kept in the middle
            ("A position", SAW), ("A unison", 8.0), ("A detune", 0.3), ("A width", 1.0),
            ("B table", T_HARM), ("B position", 0.4), ("B unison", 6.0), ("B detune", 0.25), ("B width", 1.0), ("B octave", 1.0), ("B level", -9.0),
            ("Filter type", LP12), ("Cutoff", 5000.0), ("Resonance", 0.15), ("Key tracking", 0.3),
            ("Amp attack", 0.8), ("Amp decay", 1.0), ("Amp sustain", 0.9), ("Amp release", 2.0),
            ("EQ on", 1.0), ("EQ high", 2.0), ("EQ high freq", 7000.0), ("EQ mid", -3.0), ("EQ mid freq", 400.0),
            ("Mono below", 250.0),
            ("LFO 1 shape", S_DRIFT), ("LFO 1 mode", FREE), ("LFO 1 rate (sync)", D_BAR), ("LFO 1 smooth", 0.5),
            ("LFO 1 target 1", CUTOFF), ("LFO 1 amount 1", 0.12), ("LFO 1 target 2", B_POS), ("LFO 1 amount 2", 0.3),
            ("LFO 2 shape", S_TRI), ("LFO 2 mode", SUSTAIN_ENV), ("LFO 2 rate (sync)", 1.0), ("LFO 2 sustain point", 0.5),
            ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.15),
            ("Mod 1 source", SRC_NRAND_BI), ("Mod 1 target", 9.0), ("Mod 1 amount", 0.4),
            ("Mod 2 source", SRC_NRAND), ("Mod 2 target", A_POS), ("Mod 2 amount", 0.1),
            ("Chorus on", 1.0), ("Chorus rate", 0.3), ("Chorus depth", 0.4), ("Chorus mix", 0.3),
            ("Reverb on", 1.0), ("Reverb size", 0.9), ("Reverb decay", 5.5), ("Reverb mix", 0.6),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.4),
            ("Width", 1.0), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Bass/Round Root",
        classic: false,
        sets: &[
            // A bass that holds a chord's root under piano and pads: Driven Legato with the grit
            // taken down (a little clipping, no band drive), darker, no glide and no sub of its own
            // (lay Clean Sub under it); a slow two-bar sweep of brightness
            ("A position", 0.73), ("A unison", 5.0), ("A detune", 0.25), ("A blend", 0.8), ("A width", 0.5),
            ("B table", T_PULSE), ("B position", 0.5), ("B level", -3.0),
            ("Noise level", -24.0),
            ("Filter type", LP24), ("Cutoff", 1800.0), ("Resonance", 0.15), ("Key tracking", 0.2), ("Filter envelope", 0.0),
            ("Amp attack", 0.002), ("Amp sustain", 1.0), ("Amp release", 0.06), ("Velocity", 0.0),
            ("LFO 3 shape", S_TRI), ("LFO 3 mode", FREE), ("LFO 3 rate (sync)", D_2BARS), ("LFO 3 target 1", CUTOFF), ("LFO 3 amount 1", 0.15),
            ("Pre drive type", HARD), ("Pre drive", 3.0),
            ("Drive type", HARD), ("Drive", 8.0), ("Drive tone", 0.4),
            ("Voices", LEGATO), ("Glide mode", LEGATO_ONLY),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", A_POS), ("Mod 6 amount", 0.3),
            ("Mod 7 source", M3), ("Mod 7 target", DRIVE), ("Mod 7 amount", 0.4),
            ("OTT", 0.25), ("Width", 0.5), ("Level", -1.5),
        ],
    },
    Preset {
        name: "Keys/Vowel Chop",
        classic: false,
        sets: &[
            // Like a chopped vocal: a vowel-shaped wave, short, its vowel opening a little through
            // each note, the same on every note (no random, no pitch scoop: they sounded out of tune),
            // dark enough not to whistle, dry but for some room
            ("A table", T_VOWEL), ("A position", 0.35), ("A unison", 3.0), ("A detune", 0.12), ("A width", 0.6),
            ("B position", SAW), ("B level", -14.0),
            ("Filter type", LP24), ("Cutoff", 2400.0), ("Resonance", 0.15), ("Key tracking", 0.5),
            ("Amp attack", 0.003), ("Amp decay", 0.22), ("Amp sustain", 0.4), ("Amp release", 0.1),
            ("Mod env decay", 0.2),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.25),
            ("Reverb on", 1.0), ("Reverb mix", 0.25),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("OTT", 0.3), ("Width", 0.6), ("Level", 0.0),
        ],
    },
    Preset {
        name: "Keys/Glass Pluck",
        classic: false,
        sets: &[
            // A clear, bell-like pluck to double a tune high up: a harmonic wave (every partial in
            // tune) that mellows as it rings, no low end, a soft top, a long room
            ("A table", T_HARM), ("A position", 0.3),
            ("B position", 0.0), ("B octave", 1.0), ("B level", -18.0),
            ("Filter type", LP12), ("Cutoff", 4500.0), ("Resonance", 0.0), ("Key tracking", 0.3),
            ("Amp decay", 0.8), ("Amp sustain", 0.0), ("Amp release", 0.5),
            ("Mod env decay", 0.4),
            ("Mod 1 source", SRC_MENV), ("Mod 1 target", A_POS), ("Mod 1 amount", 0.3),
            ("EQ on", 1.0), ("EQ low", -6.0), ("EQ low freq", 300.0),
            ("Reverb on", 1.0), ("Reverb size", 0.7), ("Reverb decay", 3.0), ("Reverb mix", 0.3),
            ("Mod 5 source", M1), ("Mod 5 target", A_POS), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 0.6), ("Level", 6.0),
        ],
    },
    Preset {
        name: "FX/Reverse Swell",
        classic: false,
        sets: &[
            // A swell into a downbeat, like a reversed cymbal: noise and wide saws fading in over
            // about a bar while the filter opens, then stopping dead when the note ends
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.5), ("A width", 1.0), ("A level", -8.0),
            ("B on", 0.0),
            ("Noise level", -4.0),
            ("Filter type", LP24), ("Cutoff", 250.0), ("Resonance", 0.2), ("Key tracking", 0.0),
            ("Filter envelope", 0.9), ("Filter attack", 1.3), ("Filter sustain", 1.0),
            ("Amp attack", 1.3), ("Amp sustain", 1.0), ("Amp release", 0.03),
            ("Reverb on", 1.0), ("Reverb mix", 0.15),
            ("Mod 5 source", M1), ("Mod 5 target", CUTOFF), ("Mod 5 amount", 0.4),
            ("Mod 6 source", M2), ("Mod 6 target", REVERB_MIX), ("Mod 6 amount", 0.5),
            ("Width", 1.0), ("Level", -6.0),
        ],
    },
];

/// The bass riff the presets are measured on (see analysis.rs): two bars of 16ths, each a little
/// shorter than its step, as (16th, note, velocity).
pub const RIFF: &[(u32, u8, u8)] = &[
    (0, 41, 110), (1, 41, 90), (2, 53, 100), (3, 41, 90), (4, 44, 105), (5, 41, 90), (6, 48, 100), (7, 41, 90),
    (8, 41, 110), (9, 53, 90), (10, 51, 100), (11, 41, 90), (12, 46, 105), (13, 41, 90), (14, 39, 100), (15, 41, 90),
    (16, 41, 110), (17, 41, 90), (18, 53, 100), (19, 41, 90), (20, 44, 105), (21, 41, 90), (22, 48, 100), (23, 51, 90),
    (24, 41, 110), (25, 53, 90), (26, 51, 100), (27, 41, 90), (28, 46, 105), (29, 48, 90), (30, 39, 100), (31, 36, 90),
];

/// Render preset `p` playing RIFF at `bpm` (at 48 kHz, the song position given with each note as
/// the host gives it), plus a short tail: left and right.
pub fn riff_render(p: &Preset, bpm: f32) -> (Vec<f32>, Vec<f32>) {
    loop_render(&p.values(), bpm, 1, false)
}

/// Render `values` playing RIFF `times` times over (or, `one_bar`, only its first bar: a riff
/// that repeats each bar), the song position given with each note as the host gives it, plus a
/// short tail: left and right, at 48 kHz.
pub fn loop_render(values: &[f32; COUNT], bpm: f32, times: usize, one_bar: bool) -> (Vec<f32>, Vec<f32>) {
    use crate::synth::{Synth, BLOCK};
    let sr = 48000.0;
    let mut s = Synth::new(sr);
    s.set_tempo(bpm);
    s.params = *values;
    // (Settled first, as a synth is long before its first note)
    for _ in 0..40 {
        s.process(BLOCK);
    }
    let six = 60.0 / bpm / 4.0;
    let unit = if one_bar { 16 } else { RIFF.len() as u32 };
    let mut ev: Vec<(usize, bool, u8, u8, u32)> = vec![];
    for t in 0..times as u32 {
        for &(step, note, vel) in RIFF.iter().take(unit as usize) {
            let step = t * unit + step;
            ev.push(((step as f32 * six * sr) as usize, true, note, vel, step));
            ev.push((((step as f32 + 0.85) * six * sr) as usize, false, note, 0, step));
        }
    }
    ev.sort_by_key(|e| (e.0, e.1));
    let total = (((times as u32 * unit) as f32 * six) * sr) as usize + 2048;
    let (mut l, mut r) = (Vec::with_capacity(total), Vec::with_capacity(total));
    let (mut t, mut k) = (0usize, 0usize);
    while t < total {
        while k < ev.len() && ev[k].0 <= t {
            let (_, on, note, vel, step) = ev[k];
            if on {
                s.set_position(step as f64 / 4.0);
                s.midi(0x90, note, vel);
            } else {
                s.midi(0x80, note, 0);
            }
            k += 1;
        }
        let next = if k < ev.len() { ev[k].0.min(total) } else { total };
        let n = (next - t).clamp(1, BLOCK);
        s.process(n);
        l.extend_from_slice(&s.out[0][..n]);
        r.extend_from_slice(&s.out[1][..n]);
        t += n;
    }
    (l, r)
}

/// Render `values` playing RIFF twice, legato: each note held 10 ms into the next (as the app's
/// Legato tool writes them), so a synth in Legato mode joins and glides them; left and right, at
/// 48 kHz, plus a short tail.
pub fn legato_render(values: &[f32; COUNT], bpm: f32) -> (Vec<f32>, Vec<f32>) {
    use crate::synth::{Synth, BLOCK};
    let sr = 48000.0;
    let mut s = Synth::new(sr);
    s.set_tempo(bpm);
    s.params = *values;
    for _ in 0..40 {
        s.process(BLOCK);
    }
    let six = 60.0 / bpm / 4.0;
    let n = RIFF.len() as u32;
    let mut ev: Vec<(usize, bool, u8, u8, u32)> = vec![];
    for t in 0..2u32 {
        for (k, &(step, note, vel)) in RIFF.iter().enumerate() {
            let step = t * n + step;
            let last = t == 1 && k + 1 == RIFF.len();
            let end = if last { (step as f32 + 1.0) * six } else { (step as f32 + 1.0) * six + 0.01 };
            ev.push(((step as f32 * six * sr) as usize, true, note, vel, step));
            ev.push(((end * sr) as usize, false, note, 0, step));
        }
    }
    ev.sort_by_key(|e| (e.0, !e.1));
    let total = ((2 * n) as f32 * six * sr) as usize + 2048;
    let (mut l, mut r) = (Vec::with_capacity(total), Vec::with_capacity(total));
    let (mut t, mut k) = (0usize, 0usize);
    while t < total {
        while k < ev.len() && ev[k].0 <= t {
            let (_, on, note, vel, step) = ev[k];
            if on {
                s.set_position(step as f64 / 4.0);
                s.midi(0x90, note, vel);
            } else {
                s.midi(0x80, note, 0);
            }
            k += 1;
        }
        let next = if k < ev.len() { ev[k].0.min(total) } else { total };
        let m = (next - t).clamp(1, BLOCK);
        s.process(m);
        l.extend_from_slice(&s.out[0][..m]);
        r.extend_from_slice(&s.out[1][..m]);
        t += m;
    }
    (l, r)
}

/// Render `values` playing one note (struck `at` beats into the song, held `hold` seconds at
/// velocity `vel`, then 0.3 s to let go): left and right, at 48 kHz. A fresh synth each time, so
/// every note of a range starts alike.
pub fn note_render(values: &[f32; COUNT], note: u8, vel: u8, hold: f32, at: f64) -> (Vec<f32>, Vec<f32>) {
    use crate::synth::{Synth, BLOCK};
    let sr = 48000.0;
    let mut s = Synth::new(sr);
    s.set_tempo(140.0);
    s.params = *values;
    for _ in 0..40 {
        s.process(BLOCK);
    }
    s.set_position(at);
    s.midi(0x90, note, vel);
    let off = (hold * sr) as usize;
    let total = off + (0.3 * sr) as usize;
    let (mut l, mut r) = (Vec::with_capacity(total), Vec::with_capacity(total));
    let mut t = 0;
    while t < total {
        if t == off {
            s.midi(0x80, note, 0);
        }
        let n = if t < off { (off - t).min(BLOCK) } else { (total - t).min(BLOCK) };
        s.process(n);
        l.extend_from_slice(&s.out[0][..n]);
        r.extend_from_slice(&s.out[1][..n]);
        t += n;
    }
    (l, r)
}

/// The notes a preset is played on, lowest and highest (MIDI): its category's musical range
pub fn keyboard_range(name: &str) -> (u8, u8) {
    match name.split('/').next().unwrap_or("") {
        "Bass" => (24, 72),
        "Lead" => (48, 96),
        "Keys" => (36, 96),
        "Chords" | "Pad" | "FX" => (36, 84),
        _ => (24, 96),
    }
}

/// Render `values` holding a four-note chord (C3 E3 G3 B3, as pads are played) for 3 s from the
/// song's start, then letting go for 1 s: left and right, at 48 kHz.
pub fn chord_render(values: &[f32; COUNT]) -> (Vec<f32>, Vec<f32>) {
    use crate::synth::{Synth, BLOCK};
    let sr = 48000.0;
    let mut s = Synth::new(sr);
    s.set_tempo(140.0);
    s.params = *values;
    for _ in 0..40 {
        s.process(BLOCK);
    }
    s.set_position(0.0);
    const CHORD: [u8; 4] = [48, 52, 55, 59];
    for n in CHORD {
        s.midi(0x90, n, 100);
    }
    let (mut l, mut r) = (vec![], vec![]);
    for i in 0..(sr as usize * 4 / BLOCK) {
        if i == sr as usize * 3 / BLOCK {
            for n in CHORD {
                s.midi(0x80, n, 0);
            }
        }
        s.process(BLOCK);
        l.extend_from_slice(&s.out[0][..BLOCK]);
        r.extend_from_slice(&s.out[1][..BLOCK]);
    }
    (l, r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::{Synth, BLOCK};

    /// Loudness of a preset: RMS (dB) of a held note at velocity 100, over 1.5 s.
    fn loudness(p: &Preset, note: u8) -> (f32, f32) {
        let mut s = Synth::new(48000.0);
        s.set_tempo(140.0);
        s.params = p.values();
        s.midi(0x90, note, 100);
        let mut sum = 0.0f64;
        let mut n = 0usize;
        let mut peak: f32 = 0.0;
        for _ in 0..(48000 * 3 / 2 / BLOCK) {
            s.process(BLOCK);
            for c in 0..2 {
                for &x in &s.out[c] {
                    sum += (x as f64) * (x as f64);
                    n += 1;
                    peak = peak.max(x.abs());
                }
            }
        }
        ((10.0 * (sum / n as f64).log10()) as f32, peak)
    }

    /// Every setting a preset writes (its keyboard-range ones too) is inside its parameter's
    /// range (out of range would be clamped, silently changing the sound)
    #[test]
    fn preset_values_are_in_range() {
        for p in PRESETS {
            for &(name, v) in p.sets.iter().chain(EVEN_ALL).chain(even(p.name)) {
                let i = index_of(name).unwrap();
                let k = param(i).kind;
                let back = k.value(k.normal(v));
                let ok = if v == f32::NEG_INFINITY { back == v } else { (back - v).abs() <= 1e-3 * v.abs().max(1.0) };
                assert!(ok, "{}: {name} = {v} comes back as {back}", p.name);
            }
        }
    }

    #[test]
    fn every_preset_loads_and_sounds() {
        for p in PRESETS {
            let _ = p.values();
            let (db, peak) = loudness(p, 48);
            assert!(db > -40.0, "{} is almost silent ({db} dB)", p.name);
            assert!(peak <= 0.9, "{} peaks at {peak}", p.name);
        }
    }

    /// Held sounds: the ones that fade (keys, the 808), swell (pads) or sweep (FX) are levelled by ear
    fn held(p: &Preset) -> bool {
        !(["Keys/", "Pad/", "FX/"].iter().any(|c| p.name.starts_with(c)) || p.name == "Bass/808 slide")
    }

    /// Held presets sit within 3 dB of -18 dB RMS
    #[test]
    fn presets_are_level_matched() {
        for p in PRESETS.iter().filter(|p| held(p)) {
            let (lo, _) = loudness(p, 36);
            let (hi, _) = loudness(p, 60);
            let avg = (lo + hi) / 2.0;
            assert!((avg + 18.0).abs() <= 3.0, "{} averages {avg:.1} dB", p.name);
        }
    }

    /// Every bass has three macros (the phone shows them as its big sliders), and with all of
    /// them turned up it stays under the ceiling
    #[test]
    fn bass_presets_have_three_safe_macros() {
        for p in PRESETS.iter().filter(|p| p.name.starts_with("Bass/")) {
            let macros = (1..=3).filter(|m| p.sets.iter().any(|&(n, v)| n.starts_with("Mod ") && n.ends_with(" source") && v == 13.0 + *m as f32)).count();
            assert_eq!(macros, 3, "{} has {macros} macros", p.name);
            let mut s = Synth::new(48000.0);
            s.set_tempo(140.0);
            s.params = p.values();
            for m in 1..=4 {
                s.params[index_of(&format!("Macro {m}")).unwrap()] = 1.0;
            }
            s.midi(0x90, 36, 127);
            let mut peak: f32 = 0.0;
            for _ in 0..(48000 / BLOCK) {
                s.process(BLOCK);
                for c in 0..2 {
                    for &x in &s.out[c] {
                        peak = if x.is_finite() { peak.max(x.abs()) } else { f32::INFINITY };
                    }
                }
            }
            assert!(peak <= 0.9, "{} with its macros up peaks at {peak}", p.name);
        }
    }

    /// The basses that stay one sound from note to note (the clean sub, the legato bass): not
    /// held to the per-note movement tests
    const STEADY: [&str; 3] = ["Bass/Clean Sub", "Bass/Driven Legato", "Bass/Round Root"];

    /// The legato bass holds through a riff of joined 16ths as one sound: no dip in level where a
    /// note changes (no retriggered envelope, no gap: never 4 dB under its median), the timbre moving only a little from 16th
    /// to 16th though the riff leaps octaves, and the same each time it's played
    #[test]
    fn the_legato_bass_holds_through_a_riff() {
        let p = PRESETS.iter().find(|p| p.name == "Bass/Driven Legato").unwrap();
        let (l, r) = legato_render(&p.values(), 140.0);
        let mono: Vec<f32> = l.iter().zip(r.iter()).map(|(a, b)| 0.5 * (a + b)).collect();
        // 10 ms RMS from 50 ms in to the end of the last note
        let six = 60.0 / 140.0 / 4.0;
        let end = (64.0 * six * 48000.0) as usize;
        // (40 ms windows every 10 ms: longer than a cycle of the sub)
        let rms = |x: &[f32], a: usize, b: usize| -> Vec<f32> { (a..b - 1920).step_by(480).map(|i| 10.0 * (x[i..i + 1920].iter().map(|v| v * v).sum::<f32>() / 1920.0 + 1e-12).log10()).collect() };
        let db = rms(&mono, 2400, end);
        let mut sorted = db.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = sorted[sorted.len() / 2];
        assert!(sorted[0] >= median - 4.0, "a dip of {:.1} dB under the median", median - sorted[0]);
        let m = crate::analysis::movement(&mono, 48000.0, 140.0);
        assert!(m.jump <= 0.35, "{m:?}");
        assert_eq!(legato_render(&p.values(), 140.0).0, l);
    }

    /// The basses made for per-note movement move as the reference tracks' basses do on a riff
    /// of 16ths (analysis.rs): the timbre jumps from 16th to 16th (a median of at least 0.23 octave,
    /// half the 16ths over 0.25), no one rate holds most of the movement (not a constant wobble),
    /// and a riff that repeats each bar sounds alike a bar apart. (Not the clean sub: it's a sine)
    #[test]
    fn the_movement_basses_move_per_note() {
        for p in PRESETS.iter().filter(|p| !p.classic && p.name.starts_with("Bass/") && !STEADY.contains(&p.name)) {
            let (l, r) = riff_render(p, 140.0);
            let mono: Vec<f32> = l.iter().zip(r.iter()).map(|(a, b)| 0.5 * (a + b)).collect();
            let m = crate::analysis::movement(&mono, 48000.0, 140.0);
            assert!(m.jump >= 0.23 && m.over_quarter >= 0.5, "{}: {m:?}", p.name);
            assert!(m.top_rate <= 0.3, "{}: {m:?}", p.name);
            assert!(m.ac_bar >= 0.4 && m.ac_bar <= 0.85, "{}: {m:?}", p.name);
            // And again: the same, sample for sample
            assert_eq!(riff_render(p, 140.0).0, l, "{}", p.name);
        }
    }

    /// A riff that repeats each bar: the movement basses play each note the same way each bar
    /// ("Random repeat" 1 bar, "Mono restart" on), with a slow two-bar sweep over it, so a bar
    /// apart they're alike (as the references' basses, 0.5 to 0.8), not the same and not unlike;
    /// with "Random repeat" at "Never" each note is new each time
    #[test]
    fn the_movement_basses_come_back_each_bar() {
        let rc = index_of("Random repeat").unwrap();
        for p in PRESETS.iter().filter(|p| !p.classic && p.name.starts_with("Bass/") && !STEADY.contains(&p.name)) {
            let ac = |v: &[f32; COUNT]| {
                let (l, r) = loop_render(v, 145.0, 6, true);
                let mono: Vec<f32> = l.iter().zip(r.iter()).map(|(a, b)| 0.5 * (a + b)).collect();
                crate::analysis::movement(&mono, 48000.0, 145.0).ac_bar
            };
            let mut v = p.values();
            let looped = ac(&v);
            assert!((0.5..=0.85).contains(&looped), "{}: {looped:.2}", p.name);
            v[rc] = 0.0;
            let never = ac(&v);
            assert!(never < looped - 0.1, "{}: never {never:.2}, each bar {looped:.2}", p.name);
        }
    }

    /// The new growls, screech and stabs carry a bright top over 4 kHz (as modern bass sounds do),
    /// with no harsh narrow peak; the wide pad keeps its low notes in the middle
    #[test]
    fn the_new_basses_are_bright_without_a_harsh_peak() {
        for (name, presence, air) in [
            ("Bass/Talking Growl", -17.0, -30.0),
            ("Bass/Riddim Cell", -17.0, -24.0),
            ("Bass/Neuro Reese", -17.0, -27.0),
            ("Bass/Dive Screech", -17.0, -24.0),
            ("Bass/Colour Chord Stab", -22.0, -27.0),
        ] {
            let p = PRESETS.iter().find(|p| p.name == name).unwrap();
            let (l, r) = riff_render(p, 140.0);
            let b = crate::analysis::balance(&l, &r, 48000.0);
            assert!(b.presence >= presence && b.air >= air, "{name}: {b:?}");
            // (Not shrill either: the top under the mids)
            assert!(b.presence <= -12.0 && b.air <= -17.0, "{name}: {b:?}");
            assert!(b.peak <= 8.0, "{name}: {b:?}");
        }
        let wash = PRESETS.iter().find(|p| p.name == "Pad/Wide Wash").unwrap();
        let (l, r) = chord_render(&wash.values());
        let b = crate::analysis::balance(&l, &r, 48000.0);
        assert!(b.presence >= -22.0 && b.air >= -32.0 && b.peak <= 8.0, "{b:?}");
        assert!(b.side_low <= -18.0, "{b:?}");
    }

    /// New presets restart their mono notes and keep more of the low end in the middle; the older
    /// ones keep running on, with the side cut under 120 Hz, as they always sounded
    #[test]
    fn new_presets_restart_and_keep_the_lows_mono() {
        let (rs, mb, st) = (index_of("Mono restart").unwrap(), index_of("Mono below").unwrap(), index_of("Random by step").unwrap());
        for p in PRESETS {
            let v = p.values();
            let (restart, below, step) = (param(rs).kind.value(v[rs]), param(mb).kind.value(v[mb]), param(st).kind.value(v[st]));
            if p.classic {
                assert!(restart == 0.0 && (below - 120.0).abs() < 0.01 && step == 0.0, "{}", p.name);
            } else {
                assert!(restart == 1.0 && below >= 179.0 && step == 1.0, "{}", p.name);
            }
        }
    }

    /// The new presets keep their sub clean (after the effects), and the clean sub is a sine
    #[test]
    fn new_presets_keep_the_sub_clean() {
        for p in PRESETS.iter().filter(|p| !p.classic) {
            let v = p.values();
            let i = index_of("Sub path").unwrap();
            assert_eq!(param(i).kind.value(v[i]), 1.0, "{}", p.name);
        }
    }

    /// Every keyboard-range entry names a preset
    #[test]
    fn even_entries_name_presets() {
        for (name, _) in EVEN {
            assert!(PRESETS.iter().any(|p| p.name == *name), "no preset {name}");
        }
    }

    /// Every preset plays "Even keyboard" with the detune narrowing half way above middle C; as a
    /// song saved before has it, neither
    #[test]
    fn presets_play_evenly_up_the_keyboard() {
        let (ek, dk) = (crate::params::EVEN_KEYS, crate::params::DETUNE_KEY);
        for p in PRESETS {
            let (now, was) = (p.values(), p.values_before_range());
            assert_eq!(param(ek).kind.value(now[ek]), 1.0, "{}", p.name);
            assert!((param(dk).kind.value(now[dk]) - 0.5).abs() < 1e-6, "{}", p.name);
            assert_eq!(param(ek).kind.value(was[ek]), 0.0, "{}", p.name);
            assert_eq!(param(dk).kind.value(was[dk]), 0.0, "{}", p.name);
        }
    }

    /// Each preset's filters follow the note (so its tone does): basses, leads and keys at 0.85
    /// or more (with any Note → cutoff in the matrix), chords and pads at 0.75, the combs at 1 (on
    /// the note's own pitch); each still sounds as it did on its home notes (the cutoff there the
    /// same). Not the formant filters (the vowels stay put), the sines, the FX
    #[test]
    fn preset_filters_follow_the_note() {
        use crate::params as q;
        const SINES: [&str; 4] = ["Bass/Sub", "Bass/808 slide", "Bass/Clean Sub", "Lead/Sine"];
        let at = |v: &[f32; COUNT], i: usize| param(i).kind.value(v[i]);
        for p in PRESETS.iter().filter(|p| !SINES.contains(&p.name)) {
            let (target, home) = match p.name.split('/').next().unwrap() {
                "Bass" => (0.85, 41.0),
                "Lead" => (0.85, 64.0),
                "Keys" => (0.85, 60.0),
                "Chords" | "Pad" => (0.75, 53.0),
                _ => continue,
            };
            let (now, was) = (p.values(), p.values_before_range());
            let routed = |o: usize| at(&now, o + q::osc::ON) > 0.5 && [1.0, 2.0].contains(&at(&now, o + q::osc::ROUTE));
            let f2_used = at(&now, q::F2_SERIAL) > 0.5 || routed(q::A) || routed(q::B);
            for (f, (ty, cut, kt, dest)) in [(q::FILTER_TYPE, q::CUTOFF, q::KEYTRACK, 1.0), (q::F2_TYPE, q::F2_CUTOFF, q::F2_KEYTRACK, 19.0)].into_iter().enumerate() {
                if f == 1 && !f2_used {
                    continue;
                }
                // (Note → this cutoff in the matrix tracks too: the note's ±3 octaves are ±1, an amount of 1 is 5 octaves)
                let matrix: f32 = (0..q::SLOTS_ALL).filter(|&n| at(&now, q::slot_base(n)) == 9.0 && at(&now, q::slot_base(n) + 1) == dest).map(|n| at(&now, q::slot_base(n) + 2) * 5.0 / 3.0).sum();
                let kind = at(&now, ty) as usize;
                let track = at(&now, kt) + matrix;
                match kind {
                    0..=6 => {
                        assert!(track >= target - 1e-3, "{}: filter {} tracks {track}", p.name, f + 1);
                        let home_cut = |v: &[f32; COUNT]| at(v, cut) * 2f32.powf(at(v, kt) * (home - 60.0) / 12.0);
                        let (a, b) = (home_cut(&now), home_cut(&was));
                        assert!((a / b - 1.0).abs() < 0.005, "{}: filter {} at its home note {a} Hz, was {b}", p.name, f + 1);
                    }
                    7 | 8 => assert!((track - 1.0).abs() < 1e-3, "{}: comb {} tracks {track}", p.name, f + 1),
                    _ => {}
                }
            }
        }
    }

    #[test]
    #[ignore]
    fn print_preset_loudness() {
        for p in PRESETS {
            let (lo, pk) = loudness(p, 36);
            let (mid, pk2) = loudness(p, 60);
            println!("{:22} C2 {:6.1} dB (peak {:.2})  C4 {:6.1} dB (peak {:.2})", p.name, lo, pk, mid, pk2);
        }
    }
}
