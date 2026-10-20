//! The factory presets, written in the engine's own units (Hz, dB, seconds, a choice's place in
//! its list) against parameter names, and turned into 0..1 values when chosen. Every one is
//! levelled to the same loudness (tests::presets_are_level_matched checks it).

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
// Choices by name, for reading the presets
const SAW: f32 = 2.0 / 3.0; // Basic shapes: the saw's position
const SQUARE: f32 = 1.0;
const T_BASIC: f32 = 0.0;
const T_PULSE: f32 = 1.0;
const T_DARK: f32 = 2.0;
const T_VOWEL: f32 = 3.0;
const T_FM: f32 = 5.0;
const T_METAL: f32 = 6.0;
const T_FOLD: f32 = 7.0;
const LP12: f32 = 0.0;
const LP24: f32 = 1.0;
const LADDER: f32 = 2.0;
const COMB_P: f32 = 7.0;
const COMB_N: f32 = 8.0;
const FORMANT: f32 = 9.0;
const SOFT: f32 = 1.0;
const WARM: f32 = 2.0;
const HARD: f32 = 3.0;
const FOLD: f32 = 4.0;
const S_SINE: f32 = 0.0;
const S_TRI: f32 = 1.0;
const S_SAWDOWN: f32 = 3.0;
const S_SQUARE: f32 = 4.0;
const S_WOBBLE: f32 = 5.0;
const S_STEPS: f32 = 6.0;
const S_DRIFT: f32 = 7.0;
// Tempo divisions (their place in SYNC_NAMES)
const D_QUARTER: f32 = 7.0;
const D_EIGHTH: f32 = 10.0;
const D_EIGHTH_T: f32 = 12.0;
const D_SIXTEENTH: f32 = 13.0;
// LFO targets
const CUTOFF: f32 = 1.0;
const A_POS: f32 = 3.0;
const B_POS: f32 = 4.0;
const PITCH: f32 = 5.0;
const VOLUME: f32 = 6.0;
const FMT: f32 = 8.0;
const MONO: f32 = 1.0;
const LEGATO: f32 = 2.0;

pub const PRESETS: &[Preset] = &[
    Preset {
        name: "Init saw",
        sets: &[("A table", T_BASIC), ("A position", SAW)],
    },
    Preset {
        name: "Wobble bass",
        sets: &[
            ("A position", SAW), ("A unison", 3.0), ("A detune", 0.2), ("A width", 0.3),
            ("B position", SQUARE), ("B octave", -1.0), ("B level", -6.0),
            ("Sub level", -8.0),
            ("Filter type", LP24), ("Cutoff", 180.0), ("Resonance", 0.55), ("Key tracking", 0.3),
            ("LFO 1 shape", S_WOBBLE), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", CUTOFF), ("LFO 1 amount 1", 0.75),
            ("Drive type", WARM), ("Drive", 8.0),
            ("Voices", MONO), ("Glide", 0.04), ("Amp release", 0.08),
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Growl bass",
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
            ("OTT", 0.35), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Riddim",
        sets: &[
            ("A position", SQUARE),
            ("B position", SQUARE), ("B octave", 1.0), ("B level", -8.0),
            ("Sub level", -6.0),
            ("Filter type", COMB_N), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.6),
            ("LFO 1 shape", S_SQUARE), ("LFO 1 rate (sync)", D_EIGHTH_T), ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", -0.7),
            ("Drive type", HARD), ("Drive", 10.0),
            ("Voices", MONO), ("Amp release", 0.06),
            ("OTT", 0.4), ("Level", -1.0),
        ],
    },
    Preset {
        name: "Reese",
        sets: &[
            ("A position", SAW), ("A unison", 2.0), ("A detune", 0.25), ("A width", 0.2),
            ("B table", T_PULSE), ("B position", 0.5), ("B level", -4.0),
            ("Sub level", -8.0),
            ("Filter type", LADDER), ("Cutoff", 900.0), ("Resonance", 0.2),
            ("LFO 1 shape", S_TRI), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.3), ("LFO 1 restart on note", 0.0), ("LFO 1 target 1", B_POS), ("LFO 1 amount 1", 0.5),
            ("Drive type", WARM), ("Drive", 6.0),
            ("Voices", LEGATO), ("Glide", 0.06), ("Amp release", 0.15),
            ("OTT", 0.25), ("Level", -2.5),
        ],
    },
    Preset {
        name: "Neuro bass",
        sets: &[
            ("A table", T_METAL), ("A position", 0.6), ("A unison", 2.0), ("A detune", 0.1),
            ("B table", T_FOLD), ("B position", 0.4), ("B level", -6.0),
            ("Sub level", -8.0),
            ("Filter type", COMB_P), ("Cutoff", 261.6), ("Key tracking", 1.0), ("Resonance", 0.5),
            ("LFO 1 shape", S_DRIFT), ("LFO 1 rate (sync)", D_SIXTEENTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.7),
            ("LFO 2 shape", S_STEPS), ("LFO 2 rate (sync)", D_SIXTEENTH), ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.25),
            ("Drive type", FOLD), ("Drive", 12.0), ("Drive mix", 0.6),
            ("Voices", MONO), ("Amp release", 0.08),
            ("OTT", 0.45), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Talking bass",
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.2),
            ("B position", SAW), ("B level", -10.0),
            ("Sub level", -8.0),
            ("Filter type", FORMANT), ("Cutoff", 300.0), ("Resonance", 0.55),
            ("LFO 1 shape", S_DRIFT), ("LFO 1 rate (sync)", D_EIGHTH), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.8),
            ("LFO 2 shape", S_WOBBLE), ("LFO 2 rate (sync)", D_QUARTER), ("LFO 2 target 1", CUTOFF), ("LFO 2 amount 1", 0.6),
            ("Drive type", SOFT), ("Drive", 10.0),
            ("Voices", MONO), ("Glide", 0.04), ("Amp release", 0.08),
            ("OTT", 0.3), ("Level", -2.0),
        ],
    },
    Preset {
        name: "Sub bass",
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 400.0), ("Resonance", 0.0),
            ("Drive type", WARM), ("Drive", 4.0), ("Drive mix", 0.5),
            ("Amp attack", 0.005), ("Amp release", 0.1),
            ("Voices", MONO), ("Glide", 0.03),
            ("Level", -7.0),
        ],
    },
    Preset {
        name: "Supersaw lead",
        sets: &[
            ("A position", SAW), ("A unison", 9.0), ("A detune", 0.35), ("A blend", 0.8), ("A width", 0.8),
            ("B position", SAW), ("B octave", 1.0), ("B unison", 5.0), ("B detune", 0.3), ("B level", -8.0),
            ("Filter type", LP12), ("Cutoff", 9000.0), ("Resonance", 0.1),
            ("Amp attack", 0.005), ("Amp decay", 0.4), ("Amp sustain", 0.85), ("Amp release", 0.25),
            ("OTT", 0.3), ("Width", 0.6), ("Level", -3.0),
        ],
    },
    Preset {
        name: "Future bass chords",
        sets: &[
            ("A position", SAW), ("A unison", 7.0), ("A detune", 0.3), ("A width", 0.7),
            ("B position", SQUARE), ("B unison", 5.0), ("B detune", 0.25), ("B level", -6.0),
            ("Filter type", LP24), ("Cutoff", 2500.0), ("Resonance", 0.15), ("Filter envelope", 0.25), ("Filter decay", 0.5),
            ("LFO 1 shape", S_SAWDOWN), ("LFO 1 rate (sync)", D_QUARTER), ("LFO 1 restart on note", 0.0), ("LFO 1 target 1", VOLUME), ("LFO 1 amount 1", -0.6),
            ("Amp release", 0.3),
            ("OTT", 0.35), ("Width", 0.6), ("Level", -3.5),
        ],
    },
    Preset {
        name: "Hoover",
        sets: &[
            ("A table", T_PULSE), ("A position", 0.3), ("A unison", 5.0), ("A detune", 0.55), ("A width", 0.7),
            ("B position", SAW), ("B octave", -1.0), ("B unison", 3.0), ("B detune", 0.3), ("B level", -3.0),
            ("Filter type", LP12), ("Cutoff", 5000.0),
            ("Pitch envelope", -6.0), ("Pitch decay", 0.12),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.0), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.4),
            ("Voices", MONO), ("Glide", 0.08), ("Amp release", 0.2),
            ("OTT", 0.2), ("Width", 0.6), ("Level", -5.5),
        ],
    },
    Preset {
        name: "Pluck",
        sets: &[
            ("A position", SAW), ("A unison", 3.0), ("A detune", 0.15),
            ("B position", SQUARE), ("B octave", 1.0), ("B level", -10.0),
            ("Filter type", LP24), ("Cutoff", 300.0), ("Filter envelope", 0.6), ("Filter decay", 0.25), ("Filter sustain", 0.0),
            ("Amp decay", 0.35), ("Amp sustain", 0.0), ("Amp release", 0.3),
            ("OTT", 0.2), ("Level", 0.0),
        ],
    },
    Preset {
        name: "Dark pad",
        sets: &[
            ("A table", T_VOWEL), ("A position", 0.3), ("A unison", 5.0), ("A detune", 0.25), ("A width", 0.7),
            ("B table", T_DARK), ("B position", 0.2), ("B unison", 5.0), ("B detune", 0.2), ("B level", -4.0),
            ("Filter type", LP24), ("Cutoff", 1200.0), ("Resonance", 0.2),
            ("Amp attack", 0.6), ("Amp release", 1.5),
            ("LFO 1 shape", S_TRI), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 0.15), ("LFO 1 restart on note", 0.0), ("LFO 1 target 1", A_POS), ("LFO 1 amount 1", 0.4),
            ("Width", 0.7), ("Level", -8.0),
        ],
    },
    Preset {
        name: "Sine lead",
        sets: &[
            ("A position", 0.0), ("B on", 0.0),
            ("Filter type", LP12), ("Cutoff", 6000.0),
            ("LFO 1 shape", S_SINE), ("LFO 1 sync", 0.0), ("LFO 1 rate (Hz)", 5.5), ("LFO 1 target 1", PITCH), ("LFO 1 amount 1", 0.012),
            ("Mod wheel target", PITCH), ("Mod wheel amount", 0.03),
            ("Drive type", WARM), ("Drive", 3.0),
            ("Amp attack", 0.01), ("Amp release", 0.2),
            ("Voices", LEGATO), ("Glide", 0.05),
            ("Level", -8.0),
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

    #[test]
    fn every_preset_loads_and_sounds() {
        for p in PRESETS {
            let _ = p.values();
            let (db, peak) = loudness(p, 48);
            assert!(db > -40.0, "{} is almost silent ({db} dB)", p.name);
            assert!(peak <= 0.9, "{} peaks at {peak}", p.name);
        }
    }

    /// Sustained presets sit within 3 dB of -18 dB RMS (a pluck fades and a pad swells, so not those)
    #[test]
    fn presets_are_level_matched() {
        for p in PRESETS.iter().filter(|p| !matches!(p.name, "Pluck" | "Dark pad")) {
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
