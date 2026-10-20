//! The factory presets, written in the engine's own units (Hz, dB, seconds, a choice's place in
//! its list) against parameter names, and turned into 0..1 values when chosen. Every one is
//! levelled to the same loudness (tests::presets_are_level_matched checks it). Names are
//! "Category/Name"; the matrix's slots 5 to 8 hold each preset's macros.

use crate::params::{defaults, index_of, param, COUNT};

pub struct Preset {
    pub name: &'static str,
    pub sets: &'static [(&'static str, f32)],
}

impl Preset {
    /// The preset as stored 0..1 values: the defaults, with its settings over them.
    pub fn values(&self) -> [f32; COUNT] {
        let mut v = defaults();
        for &(name, value) in self.sets {
            let i = index_of(name).unwrap_or_else(|| panic!("preset {}: no parameter {}", self.name, name));
            v[i] = param(i).kind.normal(value);
        }
        v
    }
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

pub const PRESETS: &[Preset] = &[
    Preset {
        name: "Init saw",
        sets: &[("A table", T_BASIC), ("A position", SAW)],
    },
    // ---------- Bass ----------
    Preset {
        name: "Bass/Wobble",
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
            ("OTT", 0.35), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Bass/Riddim",
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
            ("OTT", 0.4), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Bass/Detune",
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
            ("OTT", 0.25), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Neuro",
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
            ("OTT", 0.45), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Talking",
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
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Yoi",
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
            ("OTT", 0.4), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Tearout",
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
            ("OTT", 0.5), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Bass/Screech",
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
            ("OTT", 0.4), ("Level", -1.5),
        ],
    },
    Preset {
        name: "Bass/Sync",
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
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Split",
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
            ("OTT", 0.35), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Bass/Sub",
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 400.0), ("Resonance", 0.0),
            ("Drive type", WARM), ("Drive", 4.0), ("Drive mix", 0.5),
            ("Amp attack", 0.005), ("Amp release", 0.1),
            ("Voices", MONO), ("Glide", 0.03),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.4),
            ("Level", -7.0),
        ],
    },
    Preset {
        name: "Bass/808 slide",
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 600.0), ("Resonance", 0.0), ("Key tracking", 0.0),
            ("Pitch envelope", 12.0), ("Pitch decay", 0.03),
            ("Drive type", SOFT), ("Drive", 10.0), ("Drive mix", 0.7),
            ("Amp attack", 0.003), ("Amp decay", 1.6), ("Amp sustain", 0.3), ("Amp release", 0.2),
            ("Voices", LEGATO), ("Glide", 0.08),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.5),
            ("Level", -3.0),
        ],
    },
    // ---------- Lead ----------
    Preset {
        name: "Lead/Supersaw",
        sets: &[
            ("A position", SAW), ("A unison", 9.0), ("A detune", 0.35), ("A blend", 0.8), ("A width", 0.8),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 5.0), ("B detune", 0.3), ("B level", -8.0),
            ("Filter type", LP12), ("Cutoff", 9000.0), ("Resonance", 0.1),
            ("Amp attack", 0.005), ("Amp decay", 0.4), ("Amp sustain", 0.85), ("Amp release", 0.25),
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
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 6000.0),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.5), ("LFO 1 fade in", 0.4), ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.012),
            ("Mod 1 source", SRC_MW), ("Mod 1 target", PITCH), ("Mod 1 amount", 0.03),
            ("Drive type", WARM), ("Drive", 3.0),
            ("Amp attack", 0.004), ("Amp release", 0.2),
            ("Voices", LEGATO), ("Glide", 0.05),
            ("Delay on", 1.0), ("Delay time (sync)", D_EIGHTH_DOT), ("Delay feedback", 0.35), ("Delay mix", 0.2),
            ("Mod 5 source", M1), ("Mod 5 target", DRIVE), ("Mod 5 amount", 0.5),
            ("Mod 6 source", M2), ("Mod 6 target", DELAY_MIX), ("Mod 6 amount", 0.5),
            ("Level", -8.0),
        ],
    },
    Preset {
        name: "Lead/Sync",
        sets: &[
            ("A table", T_SYNC), ("A position", 0.1), ("A unison", 3.0), ("A detune", 0.12),
            ("B position", SAW), ("B level", -10.0),
            ("Filter type", LP24), ("Cutoff", 7000.0), ("Resonance", 0.15),
            ("Mod env attack", 0.002), ("Mod env decay", 0.6), ("Mod env sustain", 0.2),
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
        sets: &[
            ("A table", T_PULSE), ("A position", 0.5), ("A warp", W_QUANT), ("A warp amount", 0.75),
            ("B on", 0.0),
            ("Filter type", 10.0),
            ("LFO 1 shape", S_SQUARE), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.3),
            ("Amp attack", 0.003), ("Amp release", 0.05),
            ("Voices", MONO),
            ("Mod 5 source", M1), ("Mod 5 target", A_WARP), ("Mod 5 amount", 0.25),
            ("Level", -7.5),
        ],
    },
    // ---------- Keys and plucks ----------
    Preset {
        name: "Keys/Pluck",
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
        sets: &[
            ("A table", T_ORGAN), ("A position", 0.55),
            ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 8000.0), ("Resonance", 0.0),
            ("Amp attack", 0.005), ("Amp release", 0.06),
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
        sets: &[
            ("A position", SAW), ("A unison", 6.0), ("A detune", 0.12), ("A stack", ST_MINOR), ("A width", 0.6),
            ("B on", 0.0),
            ("Filter type", LP24), ("Cutoff", 1800.0), ("Filter envelope", 0.3), ("Filter decay", 0.6), ("Resonance", 0.15),
            ("Amp attack", 0.004), ("Amp release", 0.4),
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
];

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

    /// Every setting a preset writes is inside its parameter's range (out of range would be
    /// clamped, silently changing the sound)
    #[test]
    fn preset_values_are_in_range() {
        for p in PRESETS {
            for &(name, v) in p.sets {
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
