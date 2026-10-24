//! The synth's parameters: every one a value from 0 to 1 (what the host stores, automates and
//! saves), with its own curve to the value the sound uses (Hz, dB, seconds, a choice from a
//! list) and the text it shows. The order is the parameter's index and never changes: new
//! parameters go at the end, so saved songs keep their meaning.

/// How a parameter's 0..1 maps to the value the engine uses.
#[derive(Clone, Copy)]
pub enum Kind {
    /// From `min` to `max` in a straight line, shown with `unit`
    Lin { min: f32, max: f32, unit: &'static str },
    /// From `min` to `max` along an exponential curve (frequencies, times), shown with `unit`
    Log { min: f32, max: f32, unit: &'static str },
    /// As Log, but 0 is off (the value 0)
    LogOff { min: f32, max: f32, unit: &'static str },
    /// Whole numbers from `min` to `max`
    Int { min: i32, max: i32, unit: &'static str },
    /// One of `names`. Stored as its place out of `cap` (more than the list has), so a list can
    /// grow without moving what saved songs chose.
    Choice { names: &'static [&'static str], cap: usize },
    /// A level in dB from `min` to `max`; 0 is silent (−∞)
    Db { min: f32, max: f32 },
    /// −1 to +1 around the middle (modulation amounts), shown as a percentage
    Bipolar,
    /// 0 to 100 %
    Percent,
    /// Off or on
    Toggle,
}

pub struct Param {
    pub name: &'static str,
    pub kind: Kind,
    /// The value it starts at, in the engine's units (Hz, dB, the choice's index...)
    pub default: f32,
}

pub const TABLES: &[&str] = &[
    "Basic shapes", "Pulse width", "Dark saw", "Vowels", "Harmonic sweep", "Growl FM", "Metal FM", "Fold",
    "Sync sweep", "Organ", "Octave stack", "Digital", "Resonant", "Screech", "FM 1:2", "Random harmonics",
];
pub const FILTERS: &[&str] = &["Low pass 12", "Low pass 24", "Ladder", "Band pass", "High pass 12", "High pass 24", "Notch", "Comb +", "Comb −", "Formant", "Off"];
pub const FILTER_OFF: usize = 10;
pub const SHAPERS: &[&str] = &["Off", "Soft", "Warm", "Hard clip", "Fold", "Asymmetric", "Tube", "Bitcrush", "Downsample"];
/// The shapers that crush (bits, rate) rather than bend: not antialiased shapes, see synth.rs
pub const CRUSH_BITS: u32 = 7;
pub const CRUSH_RATE: u32 = 8;
pub const WARPS: &[&str] = &["Off", "Sync", "Bend +", "Bend −", "Squeeze", "Mirror", "Quantize", "Fold", "Ring"];
pub const STACKS: &[&str] = &["Off", "Octave", "2 octaves", "Fifth", "Fifth + octave", "Major", "Minor", "Sus 4"];
/// Semitones added to unison voices in turn, per stack
pub const STACK_STEPS: &[&[f32]] = &[&[0.0], &[0.0, 12.0], &[0.0, 12.0, 24.0], &[0.0, 7.0], &[0.0, 7.0, 12.0], &[0.0, 4.0, 7.0], &[0.0, 3.0, 7.0], &[0.0, 5.0, 7.0]];
pub const ROUTES: &[&str] = &["Filter 1", "Filter 2", "Both filters", "Straight out"];
pub const LFO_SHAPES: &[&str] = &["Sine", "Triangle", "Saw up", "Saw down", "Square", "Wobble", "Steps", "Drift", "Pump", "Drawn 1", "Drawn 2"];
pub const LFO_DRAWN: u32 = 9;
/// Free: one LFO for every note, its phase following the song; Retrig: from the top with each
/// note; Envelope: one cycle per note, then it holds its end; Sustain env: runs to its sustain
/// point and holds there while the key is down, then finishes the cycle once it's let go
pub const LFO_MODES: &[&str] = &["Free", "Retrig", "Envelope", "Sustain env"];
/// When a mono or legato note restarts a note's LFO: as the voices do (a joined legato note
/// carries on, any other note restarts it), on every note, only on a note that isn't joined, or
/// only when the voice starts from silence
pub const LFO_RETRIGS: &[&str] = &["As the voices", "Always", "Legato continues", "Never"];
/// Tempo divisions, in beats (quarter notes) per cycle
/// (The ones after "1/32" came later, so they're at the end: saved songs keep their choice)
pub const SYNC_NAMES: &[&str] = &[
    "4 bars", "2 bars", "1 bar", "1/2.", "1/2", "1/4.", "1/2T", "1/4", "1/8.", "1/4T", "1/8", "1/16.", "1/8T", "1/16", "1/16T", "1/32",
    "2 bars.", "1 bar.", "1/1T", "1/32.", "1/32T", "1/64",
];
pub const SYNC_BEATS: &[f32] = &[
    16.0, 8.0, 4.0, 3.0, 2.0, 1.5, 4.0 / 3.0, 1.0, 0.75, 2.0 / 3.0, 0.5, 0.375, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125,
    12.0, 6.0, 8.0 / 3.0, 0.1875, 1.0 / 12.0, 0.0625,
];
/// What modulation can move (LFO targets, the matrix). The ones from "LFO 1 rate" on are the
/// whole synth's, not a note's: only the shared sources move them (free LFOs, macros, the mod
/// wheel, aftertouch and pitch bend).
pub const DESTS: &[&str] = &[
    "None", "F1 cutoff", "F1 resonance", "A position", "B position", "Pitch", "Volume", "Drive", "FM", "Pan", "B pitch", "Sub",
    "A pitch", "A level", "B level", "A detune", "B detune", "A warp", "B warp", "F2 cutoff", "F2 resonance", "Noise", "Filter drive", "Drive mix",
    "LFO 1 rate", "LFO 2 rate", "LFO 3 rate", "LFO 4 rate", "Chorus mix", "Phaser mix", "Delay mix", "Reverb mix", "Width",
    "Pre drive", "Crush", "Band drive",
];
/// Where the whole-synth targets start in DESTS (up to "Width"; the later "Band drive" is one too)
pub const GLOBAL_DESTS: usize = 24;
/// Whether target `d` is the whole synth's (no note's): LFO rates, effect mixes, width, band drive
pub const fn is_global_dest(d: usize) -> bool {
    (d >= GLOBAL_DESTS && d <= 32) || d == 35
}
pub const SOURCES: &[&str] = &[
    "None", "LFO 1", "LFO 2", "LFO 3", "LFO 4", "Volume env", "Filter env", "Mod env", "Velocity", "Note", "Mod wheel", "Aftertouch", "Pitch bend", "Random", "Macro 1", "Macro 2", "Macro 3", "Macro 4",
    "Note random", "Note random ±", "Chaos", "Release velocity", "Note pressure",
];
/// How a matrix slot bends its source: straight, slow then fast, fast then slow, or an S
pub const CURVES: &[&str] = &["Linear", "Exponential", "Logarithmic", "S-curve"];
pub const SUB_PATHS: &[&str] = &["With the voices", "Clean, after effects"];
pub const GLIDE_MODES: &[&str] = &["Always", "Legato only"];
pub const GLIDE_RATES: &[&str] = &["Constant time", "Constant rate"];
pub const GLIDE_CURVES: &[&str] = &["Exponential", "Linear"];
pub const PENV_CURVES: &[&str] = &["Exponential", "Linear"];
/// How often the note-random values and chaos come round again (a riff that repeats each bar
/// gets the same values at the same places), or never
pub const RANDOM_CYCLES: &[&str] = &["Never", "1 bar", "2 bars", "4 bars"];
pub const RANDOM_CYCLE_BEATS: &[f64] = &[0.0, 4.0, 8.0, 16.0];
pub const MODES: &[&str] = &["Poly", "Mono", "Legato"];
pub const SUB_OCTAVES: &[&str] = &["−1 octave", "−2 octaves"];
pub const PHASER_MODES: &[&str] = &["Phaser", "Flanger"];

/// How many places each list keeps (its room to grow)
const fn choice(names: &'static [&'static str], cap: usize) -> Kind {
    Kind::Choice { names, cap }
}
const TABLE_K: Kind = choice(TABLES, 64);
const FILTER_K: Kind = choice(FILTERS, 32);
const SHAPER_K: Kind = choice(SHAPERS, 16);
const WARP_K: Kind = choice(WARPS, 32);
const STACK_K: Kind = choice(STACKS, 16);
const ROUTE_K: Kind = choice(ROUTES, 8);
const LFO_K: Kind = choice(LFO_SHAPES, 32);
const LFO_MODE_K: Kind = choice(LFO_MODES, 8);
const SYNC_K: Kind = choice(SYNC_NAMES, 32);
const DEST_K: Kind = choice(DESTS, 64);
const SOURCE_K: Kind = choice(SOURCES, 32);
const MODE_K: Kind = choice(MODES, 8);
const SUB_K: Kind = choice(SUB_OCTAVES, 4);
const PHASER_K: Kind = choice(PHASER_MODES, 8);
const RETRIG_K: Kind = choice(LFO_RETRIGS, 8);
const CURVE_K: Kind = choice(CURVES, 8);
const SUB_PATH_K: Kind = choice(SUB_PATHS, 4);
const GLIDE_MODE_K: Kind = choice(GLIDE_MODES, 8);
const GLIDE_RATE_K: Kind = choice(GLIDE_RATES, 8);
const GLIDE_CURVE_K: Kind = choice(GLIDE_CURVES, 8);
const PENV_CURVE_K: Kind = choice(PENV_CURVES, 8);
const RANDOM_CYCLE_K: Kind = choice(RANDOM_CYCLES, 8);
const SECONDS: Kind = Kind::Log { min: 0.005, max: 10.0, unit: " s" };

const fn pr(name: &'static str, kind: Kind, default: f32) -> Param {
    Param { name, kind, default }
}

macro_rules! osc_params {
    ($p:literal) => {
        [
            pr(concat!($p, " on"), Kind::Toggle, 1.0),
            pr(concat!($p, " table"), TABLE_K, 0.0),
            pr(concat!($p, " position"), Kind::Percent, 0.0),
            pr(concat!($p, " octave"), Kind::Int { min: -3, max: 3, unit: "" }, 0.0),
            pr(concat!($p, " semitone"), Kind::Int { min: -12, max: 12, unit: " st" }, 0.0),
            pr(concat!($p, " fine"), Kind::Lin { min: -100.0, max: 100.0, unit: " ct" }, 0.0),
            pr(concat!($p, " level"), Kind::Db { min: -48.0, max: 0.0 }, 0.0),
            pr(concat!($p, " unison"), Kind::Int { min: 1, max: 16, unit: " voices" }, 1.0),
            pr(concat!($p, " detune"), Kind::Percent, 0.25),
            pr(concat!($p, " blend"), Kind::Percent, 0.7),
            pr(concat!($p, " width"), Kind::Percent, 0.5),
            pr(concat!($p, " warp"), WARP_K, 0.0),
            pr(concat!($p, " warp amount"), Kind::Percent, 0.0),
            pr(concat!($p, " phase"), Kind::Percent, 0.0),
            pr(concat!($p, " random phase"), Kind::Percent, 0.0),
            pr(concat!($p, " stack"), STACK_K, 0.0),
            pr(concat!($p, " pan"), Kind::Bipolar, 0.0),
            pr(concat!($p, " route"), ROUTE_K, 0.0),
        ]
    };
}

macro_rules! lfo_params {
    ($p:literal) => {
        [
            pr(concat!($p, " shape"), LFO_K, 0.0),
            pr(concat!($p, " sync"), Kind::Toggle, 1.0),
            pr(concat!($p, " rate (sync)"), SYNC_K, 10.0),
            pr(concat!($p, " rate (Hz)"), Kind::Log { min: 0.05, max: 30.0, unit: " Hz" }, 2.0),
            pr(concat!($p, " mode"), LFO_MODE_K, 1.0),
            pr(concat!($p, " phase"), Kind::Percent, 0.0),
            pr(concat!($p, " fade in"), Kind::Log { min: 0.001, max: 8.0, unit: " s" }, 0.001),
            pr(concat!($p, " target 1"), DEST_K, 0.0),
            pr(concat!($p, " amount 1"), Kind::Bipolar, 0.0),
            pr(concat!($p, " target 2"), DEST_K, 0.0),
            pr(concat!($p, " amount 2"), Kind::Bipolar, 0.0),
        ]
    };
}

macro_rules! shape_params {
    ($p:literal, $d:expr, $smooth:expr) => {
        [
            pr(concat!($p, " step 1"), Kind::Bipolar, $d[0]),
            pr(concat!($p, " step 2"), Kind::Bipolar, $d[1]),
            pr(concat!($p, " step 3"), Kind::Bipolar, $d[2]),
            pr(concat!($p, " step 4"), Kind::Bipolar, $d[3]),
            pr(concat!($p, " step 5"), Kind::Bipolar, $d[4]),
            pr(concat!($p, " step 6"), Kind::Bipolar, $d[5]),
            pr(concat!($p, " step 7"), Kind::Bipolar, $d[6]),
            pr(concat!($p, " step 8"), Kind::Bipolar, $d[7]),
            pr(concat!($p, " step 9"), Kind::Bipolar, $d[8]),
            pr(concat!($p, " step 10"), Kind::Bipolar, $d[9]),
            pr(concat!($p, " step 11"), Kind::Bipolar, $d[10]),
            pr(concat!($p, " step 12"), Kind::Bipolar, $d[11]),
            pr(concat!($p, " step 13"), Kind::Bipolar, $d[12]),
            pr(concat!($p, " step 14"), Kind::Bipolar, $d[13]),
            pr(concat!($p, " step 15"), Kind::Bipolar, $d[14]),
            pr(concat!($p, " step 16"), Kind::Bipolar, $d[15]),
            pr(concat!($p, " smooth"), Kind::Percent, $smooth),
        ]
    };
}

macro_rules! mod_slot {
    ($p:literal) => {
        [pr(concat!($p, " source"), SOURCE_K, 0.0), pr(concat!($p, " target"), DEST_K, 0.0), pr(concat!($p, " amount"), Kind::Bipolar, 0.0)]
    };
}

macro_rules! env_params {
    ($p:literal, $a:expr, $d:expr, $s:expr, $r:expr) => {
        [
            pr(concat!($p, " attack"), Kind::Log { min: 0.0004, max: 10.0, unit: " s" }, $a),
            pr(concat!($p, " decay"), SECONDS, $d),
            pr(concat!($p, " sustain"), Kind::Percent, $s),
            pr(concat!($p, " release"), SECONDS, $r),
        ]
    };
}

const OSC_A: [Param; 18] = osc_params!("A");
const OSC_B: [Param; 18] = osc_params!("B");
const SOURCES_P: [Param; 5] = [
    pr("FM B → A", Kind::Percent, 0.0),
    pr("Sub level", Kind::Db { min: -48.0, max: 0.0 }, f32::NEG_INFINITY),
    pr("Sub octave", SUB_K, 0.0),
    pr("Noise level", Kind::Db { min: -48.0, max: 0.0 }, f32::NEG_INFINITY),
    pr("Noise route", ROUTE_K, 0.0),
];
const FILTER1: [Param; 6] = [
    pr("Filter type", FILTER_K, 1.0),
    pr("Cutoff", Kind::Log { min: 20.0, max: 20000.0, unit: " Hz" }, 8000.0),
    pr("Resonance", Kind::Percent, 0.15),
    pr("Filter drive", Kind::Percent, 0.0),
    pr("Key tracking", Kind::Percent, 0.5),
    pr("Filter envelope", Kind::Bipolar, 0.0),
];
const FILTER2: [Param; 6] = [
    pr("Filter 2 type", FILTER_K, 0.0),
    pr("Filter 2 cutoff", Kind::Log { min: 20.0, max: 20000.0, unit: " Hz" }, 8000.0),
    pr("Filter 2 resonance", Kind::Percent, 0.15),
    pr("Filter 2 key tracking", Kind::Percent, 0.5),
    pr("Filter 2 envelope", Kind::Bipolar, 0.0),
    pr("Filter 1 into 2", Kind::Toggle, 0.0),
];
const AMP_ENV: [Param; 4] = [
    // (Its fastest, 1.2 ms, is a clean start: no click, no softening)
    pr("Amp attack", Kind::Log { min: 0.0012, max: 10.0, unit: " s" }, 0.0012),
    pr("Amp decay", SECONDS, 0.3),
    pr("Amp sustain", Kind::Percent, 1.0),
    pr("Amp release", SECONDS, 0.12),
];
const FILTER_ENV: [Param; 4] = env_params!("Filter", 0.0004, 0.4, 0.0, 0.2);
const MOD_ENV: [Param; 4] = env_params!("Mod env", 0.0004, 0.5, 0.0, 0.3);
const PITCH_ENV: [Param; 2] = [
    pr("Pitch envelope", Kind::Lin { min: -24.0, max: 24.0, unit: " st" }, 0.0),
    pr("Pitch decay", Kind::Log { min: 0.005, max: 2.0, unit: " s" }, 0.08),
];
const DRIVE_P: [Param; 3] = [pr("Drive type", SHAPER_K, 0.0), pr("Drive", Kind::Lin { min: 0.0, max: 36.0, unit: " dB" }, 0.0), pr("Drive mix", Kind::Percent, 1.0)];
const LFO1: [Param; 11] = lfo_params!("LFO 1");
const LFO2: [Param; 11] = lfo_params!("LFO 2");
const LFO3: [Param; 11] = lfo_params!("LFO 3");
const LFO4: [Param; 11] = lfo_params!("LFO 4");
const SHAPE1: [Param; 17] = shape_params!("Shape 1", [1.0, 1.0, -1.0, -1.0, 0.5, 0.5, -1.0, -1.0, 1.0, 0.0, -1.0, 0.0, 1.0, 0.5, 0.0, -0.5], 0.3);
const SHAPE2: [Param; 17] = shape_params!("Shape 2", [1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, -1.0], 0.1);
const MATRIX: [[Param; 3]; 8] = [mod_slot!("Mod 1"), mod_slot!("Mod 2"), mod_slot!("Mod 3"), mod_slot!("Mod 4"), mod_slot!("Mod 5"), mod_slot!("Mod 6"), mod_slot!("Mod 7"), mod_slot!("Mod 8")];
const MACROS: [Param; 4] = [pr("Macro 1", Kind::Percent, 0.0), pr("Macro 2", Kind::Percent, 0.0), pr("Macro 3", Kind::Percent, 0.0), pr("Macro 4", Kind::Percent, 0.0)];
const PLAY: [Param; 4] = [
    pr("Voices", MODE_K, 0.0),
    pr("Glide", Kind::Log { min: 0.001, max: 2.0, unit: " s" }, 0.001),
    pr("Bend range", Kind::Int { min: 1, max: 24, unit: " st" }, 2.0),
    pr("Velocity", Kind::Percent, 0.5),
];
const EQ: [Param; 7] = [
    pr("EQ on", Kind::Toggle, 0.0),
    pr("EQ low", Kind::Lin { min: -12.0, max: 12.0, unit: " dB" }, 0.0),
    pr("EQ low freq", Kind::Log { min: 30.0, max: 600.0, unit: " Hz" }, 120.0),
    pr("EQ mid", Kind::Lin { min: -12.0, max: 12.0, unit: " dB" }, 0.0),
    pr("EQ mid freq", Kind::Log { min: 150.0, max: 8000.0, unit: " Hz" }, 1000.0),
    pr("EQ high", Kind::Lin { min: -12.0, max: 12.0, unit: " dB" }, 0.0),
    pr("EQ high freq", Kind::Log { min: 1500.0, max: 16000.0, unit: " Hz" }, 6000.0),
];
const CHORUS: [Param; 4] = [
    pr("Chorus on", Kind::Toggle, 0.0),
    pr("Chorus rate", Kind::Log { min: 0.05, max: 5.0, unit: " Hz" }, 0.6),
    pr("Chorus depth", Kind::Percent, 0.5),
    pr("Chorus mix", Kind::Percent, 0.4),
];
const PHASER: [Param; 6] = [
    pr("Phaser on", Kind::Toggle, 0.0),
    pr("Phaser mode", PHASER_K, 0.0),
    pr("Phaser rate", Kind::Log { min: 0.02, max: 10.0, unit: " Hz" }, 0.3),
    pr("Phaser depth", Kind::Percent, 0.7),
    pr("Phaser feedback", Kind::Percent, 0.5),
    pr("Phaser mix", Kind::Percent, 0.5),
];
const DELAY: [Param; 8] = [
    pr("Delay on", Kind::Toggle, 0.0),
    pr("Delay sync", Kind::Toggle, 1.0),
    pr("Delay time (sync)", SYNC_K, 8.0),
    pr("Delay time (ms)", Kind::Log { min: 1.0, max: 2000.0, unit: " ms" }, 300.0),
    pr("Delay feedback", Kind::Percent, 0.35),
    pr("Delay ping-pong", Kind::Toggle, 1.0),
    pr("Delay tone", Kind::Log { min: 500.0, max: 20000.0, unit: " Hz" }, 6000.0),
    pr("Delay mix", Kind::Percent, 0.25),
];
const REVERB: [Param; 6] = [
    pr("Reverb on", Kind::Toggle, 0.0),
    pr("Reverb size", Kind::Percent, 0.6),
    pr("Reverb decay", Kind::Log { min: 0.3, max: 20.0, unit: " s" }, 2.5),
    pr("Reverb tone", Kind::Log { min: 1000.0, max: 20000.0, unit: " Hz" }, 7000.0),
    pr("Reverb pre-delay", Kind::Lin { min: 0.0, max: 150.0, unit: " ms" }, 10.0),
    pr("Reverb mix", Kind::Percent, 0.25),
];
const OUTPUT: [Param; 4] = [
    pr("OTT", Kind::Percent, 0.0),
    pr("OTT time", Kind::Percent, 0.6),
    pr("Width", Kind::Percent, 0.4),
    pr("Level", Kind::Db { min: -36.0, max: 6.0 }, -14.0),
];

// ---------- added for per-note movement (after Level: saved songs keep their places) ----------

macro_rules! lfo_more {
    ($p:literal) => {
        [
            pr(concat!($p, " retrigger"), RETRIG_K, 0.0),
            pr(concat!($p, " delay"), Kind::LogOff { min: 0.005, max: 4.0, unit: " s" }, 0.0),
            pr(concat!($p, " smooth"), Kind::Percent, 0.0),
            pr(concat!($p, " key tracking"), Kind::Percent, 0.0),
            pr(concat!($p, " sustain point"), Kind::Percent, 0.5),
        ]
    };
}
const LFO1_MORE: [Param; 5] = lfo_more!("LFO 1");
const LFO2_MORE: [Param; 5] = lfo_more!("LFO 2");
const LFO3_MORE: [Param; 5] = lfo_more!("LFO 3");
const LFO4_MORE: [Param; 5] = lfo_more!("LFO 4");
const CHAOS: [Param; 3] = [pr("Chaos rate (sync)", SYNC_K, 13.0), pr("Chaos smooth", Kind::Percent, 0.0), pr("Random repeat", RANDOM_CYCLE_K, 1.0)];
const MATRIX2: [[Param; 3]; 8] = [mod_slot!("Mod 9"), mod_slot!("Mod 10"), mod_slot!("Mod 11"), mod_slot!("Mod 12"), mod_slot!("Mod 13"), mod_slot!("Mod 14"), mod_slot!("Mod 15"), mod_slot!("Mod 16")];
macro_rules! slot_more {
    ($p:literal) => {
        [pr(concat!($p, " curve"), CURVE_K, 0.0), pr(concat!($p, " via"), SOURCE_K, 0.0)]
    };
}
const SLOT_MORE: [[Param; 2]; 16] = [
    slot_more!("Mod 1"), slot_more!("Mod 2"), slot_more!("Mod 3"), slot_more!("Mod 4"), slot_more!("Mod 5"), slot_more!("Mod 6"), slot_more!("Mod 7"), slot_more!("Mod 8"),
    slot_more!("Mod 9"), slot_more!("Mod 10"), slot_more!("Mod 11"), slot_more!("Mod 12"), slot_more!("Mod 13"), slot_more!("Mod 14"), slot_more!("Mod 15"), slot_more!("Mod 16"),
];
const DRIVE_MORE: [Param; 14] = [
    pr("Pre drive type", SHAPER_K, 0.0),
    pr("Pre drive", Kind::Lin { min: 0.0, max: 36.0, unit: " dB" }, 0.0),
    pr("Pre drive mix", Kind::Percent, 1.0),
    pr("Pre drive crush", Kind::Percent, 0.5),
    pr("Drive crush", Kind::Percent, 0.5),
    pr("Drive tone", Kind::Percent, 0.0),
    pr("Band drive type", SHAPER_K, 0.0),
    pr("Band drive", Kind::Lin { min: 0.0, max: 36.0, unit: " dB" }, 0.0),
    pr("Band drive mix", Kind::Percent, 1.0),
    pr("Band drive crush", Kind::Percent, 0.5),
    pr("Band drive tone", Kind::Percent, 0.0),
    pr("Band low split", Kind::Log { min: 60.0, max: 500.0, unit: " Hz" }, 150.0),
    pr("Band high split", Kind::Log { min: 1000.0, max: 8000.0, unit: " Hz" }, 2500.0),
    pr("Band high amount", Kind::Percent, 1.0),
];
const PLAY_MORE: [Param; 8] = [
    pr("Sub path", SUB_PATH_K, 1.0),
    pr("Glide mode", GLIDE_MODE_K, 0.0),
    pr("Glide rate", GLIDE_RATE_K, 0.0),
    pr("Glide curve", GLIDE_CURVE_K, 0.0),
    pr("Pitch envelope curve", PENV_CURVE_K, 0.0),
    // Mono and legato: a note that doesn't join the last starts afresh (its oscillators from their
    // start phases, its filters and LFOs from the top), the last one fading out under it in 3 ms,
    // so a riff that repeats sounds the same each time round
    pr("Mono restart", Kind::Toggle, 1.0),
    // Everything under this is kept in the middle (the side loses it), after the unison spread,
    // the chorus and the width
    pr("Mono below", Kind::Log { min: 60.0, max: 400.0, unit: " Hz" }, 180.0),
    // A note's own random values follow its step in the bar and its place in a chord (lowest
    // first), not its pitch, so a riff that comes round on other notes moves as it did
    pr("Random by step", Kind::Toggle, 1.0),
];
// ---------- added for the keyboard range (after "Random by step") ----------
const RANGE_P: [Param; 2] = [
    // A note sounds alike wherever it is on the keyboard: the wavetable's octave levels fade into
    // each other (no step in brightness where one takes over), and a note's random start (its
    // unison phases, a Steps or Drift LFO's first levels, the Random source) follows its step and
    // its place in a chord, not its pitch
    pr("Even keyboard", Kind::Toggle, 1.0),
    // How much the unison's detune narrows for notes above middle C, so its beating doesn't race
    // on high notes: 0 the same cents everywhere (it beats eight times as fast three octaves up),
    // 100 % as slow as at middle C
    pr("Detune key tracking", Kind::Percent, 0.5),
];

/// What a parameter added later is set to when an older saved sound (one with fewer values)
/// loads, where that differs from its default: the old sound, exactly. (The sub went through the
/// effects with the rest of the voice before "Sub path" came; a mono note ran on from the last one's
/// phases before "Mono restart"; the side lost only what was under 120 Hz before "Mono below"; a
/// note's random values came from its step and its pitch before "Random by step".)
/// (Before the keyboard-range work, a wavetable stepped from one octave level to the next, a
/// note's random start followed its pitch and the detune was the same in cents on every note.)
const LEGACY: &[(&str, f32)] = &[("Sub path", 0.0), ("Mono restart", 0.0), ("Mono below", 120.0), ("Random by step", 0.0), ("Even keyboard", 0.0), ("Detune key tracking", 0.0)];

/// Every group, in order: its place in the list is where it starts
const GROUPS: &[&[Param]] = &[
    &OSC_A, &OSC_B, &SOURCES_P, &FILTER1, &FILTER2, &AMP_ENV, &FILTER_ENV, &MOD_ENV, &PITCH_ENV, &DRIVE_P,
    &LFO1, &LFO2, &LFO3, &LFO4, &SHAPE1, &SHAPE2,
    &MATRIX[0], &MATRIX[1], &MATRIX[2], &MATRIX[3], &MATRIX[4], &MATRIX[5], &MATRIX[6], &MATRIX[7],
    &MACROS, &PLAY, &EQ, &CHORUS, &PHASER, &DELAY, &REVERB, &OUTPUT,
    &LFO1_MORE, &LFO2_MORE, &LFO3_MORE, &LFO4_MORE, &CHAOS,
    &MATRIX2[0], &MATRIX2[1], &MATRIX2[2], &MATRIX2[3], &MATRIX2[4], &MATRIX2[5], &MATRIX2[6], &MATRIX2[7],
    &SLOT_MORE[0], &SLOT_MORE[1], &SLOT_MORE[2], &SLOT_MORE[3], &SLOT_MORE[4], &SLOT_MORE[5], &SLOT_MORE[6], &SLOT_MORE[7],
    &SLOT_MORE[8], &SLOT_MORE[9], &SLOT_MORE[10], &SLOT_MORE[11], &SLOT_MORE[12], &SLOT_MORE[13], &SLOT_MORE[14], &SLOT_MORE[15],
    &DRIVE_MORE, &PLAY_MORE, &RANGE_P,
];

/// Where each group starts in the full list (tests::indices_name_their_parameters checks them)
pub const OSC_LEN: usize = 18;
pub const A: usize = 0;
pub const B: usize = A + OSC_LEN;
pub const FM: usize = B + OSC_LEN;
pub const SUB_LEVEL: usize = FM + 1;
pub const SUB_OCT: usize = FM + 2;
pub const NOISE: usize = FM + 3;
pub const NOISE_ROUTE: usize = FM + 4;
pub const FILTER_TYPE: usize = FM + 5;
pub const CUTOFF: usize = FILTER_TYPE + 1;
pub const RESO: usize = FILTER_TYPE + 2;
pub const FILTER_DRIVE: usize = FILTER_TYPE + 3;
pub const KEYTRACK: usize = FILTER_TYPE + 4;
pub const FENV_AMT: usize = FILTER_TYPE + 5;
pub const F2_TYPE: usize = FILTER_TYPE + 6;
pub const F2_CUTOFF: usize = F2_TYPE + 1;
pub const F2_RESO: usize = F2_TYPE + 2;
pub const F2_KEYTRACK: usize = F2_TYPE + 3;
pub const F2_ENV: usize = F2_TYPE + 4;
pub const F2_SERIAL: usize = F2_TYPE + 5;
pub const AMP_A: usize = F2_TYPE + 6;
pub const AMP_D: usize = AMP_A + 1;
pub const AMP_S: usize = AMP_A + 2;
pub const AMP_R: usize = AMP_A + 3;
pub const FENV_A: usize = AMP_A + 4;
pub const FENV_D: usize = FENV_A + 1;
pub const FENV_S: usize = FENV_A + 2;
pub const FENV_R: usize = FENV_A + 3;
pub const MENV_A: usize = FENV_A + 4;
pub const PENV_AMT: usize = MENV_A + 4;
pub const PENV_D: usize = PENV_AMT + 1;
pub const SHAPER: usize = PENV_AMT + 2;
pub const DRIVE: usize = SHAPER + 1;
pub const DRIVE_MIX: usize = SHAPER + 2;
pub const LFO_LEN: usize = 11;
pub const LFO_1: usize = SHAPER + 3;
pub const LFOS: usize = 4;
pub const SHAPE_LEN: usize = 17;
pub const SHAPE_1: usize = LFO_1 + LFO_LEN * LFOS;
pub const MATRIX_1: usize = SHAPE_1 + SHAPE_LEN * 2;
pub const SLOTS: usize = 8;
pub const MACRO_1: usize = MATRIX_1 + 3 * SLOTS;
pub const MODE: usize = MACRO_1 + 4;
pub const GLIDE: usize = MODE + 1;
pub const BEND: usize = MODE + 2;
pub const VELOCITY: usize = MODE + 3;
pub const EQ_ON: usize = MODE + 4;
pub const CHORUS_ON: usize = EQ_ON + 7;
pub const PHASER_ON: usize = CHORUS_ON + 4;
pub const DELAY_ON: usize = PHASER_ON + 6;
pub const REVERB_ON: usize = DELAY_ON + 8;
pub const OTT: usize = REVERB_ON + 6;
pub const OTT_TIME: usize = OTT + 1;
pub const WIDTH: usize = OTT + 2;
pub const LEVEL: usize = OTT + 3;
/// How many parameters there were before the per-note movement work (saved sounds with this many
/// values are the old kind: see `legacy`)
pub const COUNT_V1: usize = LEVEL + 1;
pub const LFO_MORE_LEN: usize = 5;
pub const LFO_MORE_1: usize = COUNT_V1;
pub const CHAOS_DIV: usize = LFO_MORE_1 + LFO_MORE_LEN * LFOS;
pub const CHAOS_SMOOTH: usize = CHAOS_DIV + 1;
pub const RANDOM_CYCLE: usize = CHAOS_DIV + 2;
/// Matrix slots 9 to 16 (source, target, amount, as slots 1 to 8)
pub const MATRIX_9: usize = CHAOS_DIV + 3;
pub const SLOTS_ALL: usize = 16;
/// Every slot's curve and via, slot 1 first
pub const SLOT_MORE_1: usize = MATRIX_9 + 3 * 8;
pub const PRE_SHAPER: usize = SLOT_MORE_1 + 2 * SLOTS_ALL;
pub const PRE_DRIVE: usize = PRE_SHAPER + 1;
pub const PRE_MIX: usize = PRE_SHAPER + 2;
pub const PRE_CRUSH: usize = PRE_SHAPER + 3;
pub const DRIVE_CRUSH: usize = PRE_SHAPER + 4;
pub const DRIVE_TONE: usize = PRE_SHAPER + 5;
pub const BAND_SHAPER: usize = PRE_SHAPER + 6;
pub const BAND_DRIVE: usize = BAND_SHAPER + 1;
pub const BAND_MIX: usize = BAND_SHAPER + 2;
pub const BAND_CRUSH: usize = BAND_SHAPER + 3;
pub const BAND_TONE: usize = BAND_SHAPER + 4;
pub const BAND_LOW: usize = BAND_SHAPER + 5;
pub const BAND_HIGH: usize = BAND_SHAPER + 6;
pub const BAND_HIGH_AMT: usize = BAND_SHAPER + 7;
pub const SUB_PATH: usize = BAND_SHAPER + 8;
pub const GLIDE_MODE: usize = SUB_PATH + 1;
pub const GLIDE_RATE: usize = SUB_PATH + 2;
pub const GLIDE_CURVE: usize = SUB_PATH + 3;
pub const PENV_CURVE: usize = SUB_PATH + 4;
pub const MONO_RESTART: usize = SUB_PATH + 5;
pub const MONO_BELOW: usize = SUB_PATH + 6;
pub const RANDOM_BY_STEP: usize = SUB_PATH + 7;
/// How many parameters there were before the keyboard-range work (saved sounds with this many
/// values step between table levels, seed by pitch, detune in cents: see `legacy`)
pub const COUNT_V2: usize = RANDOM_BY_STEP + 1;
pub const EVEN_KEYS: usize = COUNT_V2;
pub const DETUNE_KEY: usize = COUNT_V2 + 1;
pub const COUNT: usize = DETUNE_KEY + 1;

/// Matrix slot `n`'s (0 to 15) source, target and amount; and its curve and via
pub const fn slot_base(n: usize) -> usize {
    if n < SLOTS {
        MATRIX_1 + 3 * n
    } else {
        MATRIX_9 + 3 * (n - SLOTS)
    }
}
pub const fn slot_more(n: usize) -> usize {
    SLOT_MORE_1 + 2 * n
}

/// An older saved sound, with only its first `count` values: the parameters it didn't have are
/// set as it sounded then (`LEGACY`), the rest stay as they are.
pub fn legacy(values: &mut [f32], count: usize) {
    for &(name, v) in LEGACY {
        if let Some(i) = index_of(name) {
            if i >= count && i < values.len() {
                values[i] = param(i).kind.normal(v);
            }
        }
    }
}

/// Offsets within an oscillator's group
pub mod osc {
    pub const ON: usize = 0;
    pub const TABLE: usize = 1;
    pub const POS: usize = 2;
    pub const OCT: usize = 3;
    pub const SEMI: usize = 4;
    pub const FINE: usize = 5;
    pub const LEVEL: usize = 6;
    pub const UNISON: usize = 7;
    pub const DETUNE: usize = 8;
    pub const BLEND: usize = 9;
    pub const WIDTH: usize = 10;
    pub const WARP: usize = 11;
    pub const WARP_AMT: usize = 12;
    pub const PHASE: usize = 13;
    pub const RAND: usize = 14;
    pub const STACK: usize = 15;
    pub const PAN: usize = 16;
    pub const ROUTE: usize = 17;
}

/// Offsets within an LFO's group
pub mod lfo {
    pub const SHAPE: usize = 0;
    pub const SYNC: usize = 1;
    pub const DIV: usize = 2;
    pub const HZ: usize = 3;
    pub const MODE: usize = 4;
    pub const PHASE: usize = 5;
    pub const FADE: usize = 6;
    pub const DEST1: usize = 7;
    pub const AMT1: usize = 8;
    pub const DEST2: usize = 9;
    pub const AMT2: usize = 10;
    /// (In the later group, from LFO_MORE_1 + k * LFO_MORE_LEN)
    pub const RETRIG: usize = 0;
    pub const DELAY: usize = 1;
    pub const SMOOTH: usize = 2;
    pub const KEYTRACK: usize = 3;
    pub const SUSTAIN: usize = 4;
}

/// The parameter at index `i`.
pub fn param(i: usize) -> &'static Param {
    ALL[i.min(COUNT - 1)]
}

/// Every parameter in order (made once, when compiled)
static ALL: [&Param; COUNT] = {
    let mut out: [&Param; COUNT] = [&OUTPUT[0]; COUNT];
    let mut g = 0;
    let mut i = 0;
    while g < GROUPS.len() {
        let mut k = 0;
        while k < GROUPS[g].len() {
            out[i] = &GROUPS[g][k];
            i += 1;
            k += 1;
        }
        g += 1;
    }
    out
};

/// The index of the parameter called `name` (presets are written with names).
pub fn index_of(name: &str) -> Option<usize> {
    (0..COUNT).find(|&i| param(i).name == name)
}

impl Kind {
    /// The engine's value for a stored 0..1.
    pub fn value(&self, n: f32) -> f32 {
        let n = n.clamp(0.0, 1.0);
        match *self {
            Kind::Lin { min, max, .. } => min + (max - min) * n,
            Kind::Log { min, max, .. } => min * (max / min).powf(n),
            Kind::LogOff { min, max, .. } => {
                if n <= 0.0 {
                    0.0
                } else {
                    min * (max / min).powf(n)
                }
            }
            Kind::Int { min, max, .. } => (min as f32 + ((max - min) as f32 * n).round()).round(),
            Kind::Choice { names, cap } => (n * (cap - 1) as f32).round().min((names.len() - 1) as f32),
            Kind::Db { min, max } => {
                if n <= 0.0 {
                    f32::NEG_INFINITY
                } else {
                    min + (max - min) * n
                }
            }
            Kind::Bipolar => n * 2.0 - 1.0,
            Kind::Percent => n,
            Kind::Toggle => {
                if n >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    /// The stored 0..1 for an engine value (the inverse of `value`).
    pub fn normal(&self, v: f32) -> f32 {
        let n = match *self {
            Kind::Lin { min, max, .. } => (v - min) / (max - min),
            Kind::Log { min, max, .. } => (v.max(min) / min).ln() / (max / min).ln(),
            Kind::LogOff { min, max, .. } => {
                if v <= 0.0 {
                    0.0
                } else {
                    // (Just above 0 at the minimum: 0 itself is "off")
                    ((v.max(min) / min).ln() / (max / min).ln()).max(1e-6)
                }
            }
            Kind::Int { min, max, .. } => (v - min as f32) / (max - min) as f32,
            Kind::Choice { cap, .. } => v / (cap - 1) as f32,
            Kind::Db { min, max } => {
                if v == f32::NEG_INFINITY || v < min {
                    0.0
                } else {
                    // (Just above 0 at the minimum: 0 itself is "off")
                    ((v - min) / (max - min)).max(1e-6)
                }
            }
            Kind::Bipolar => (v + 1.0) * 0.5,
            Kind::Percent | Kind::Toggle => v,
        };
        n.clamp(0.0, 1.0)
    }

    /// The text shown for a stored 0..1.
    pub fn display(&self, n: f32) -> String {
        let v = self.value(n);
        match *self {
            Kind::Lin { unit, .. } => format!("{}{}", trim(v), unit),
            Kind::LogOff { .. } if v <= 0.0 => "off".to_string(),
            Kind::Log { unit, .. } | Kind::LogOff { unit, .. } => {
                if unit == " Hz" && v >= 1000.0 {
                    format!("{} kHz", trim(v / 1000.0))
                } else if unit == " s" && v < 1.0 {
                    format!("{} ms", trim(v * 1000.0))
                } else {
                    format!("{}{}", trim(v), unit)
                }
            }
            Kind::Int { unit, .. } => format!("{}{}", v as i32, unit),
            Kind::Choice { names, .. } => names[v as usize].to_string(),
            Kind::Db { .. } => {
                if v == f32::NEG_INFINITY {
                    "off".to_string()
                } else {
                    format!("{:.1} dB", v)
                }
            }
            Kind::Bipolar => format!("{:+}%", (v * 100.0).round() as i32),
            Kind::Percent => format!("{}%", (v * 100.0).round() as i32),
            Kind::Toggle => (if v > 0.5 { "on" } else { "off" }).to_string(),
        }
    }
}

/// A number with as many decimals as it needs (3 significant figures).
fn trim(v: f32) -> String {
    let a = v.abs();
    if a >= 100.0 {
        format!("{:.0}", v)
    } else if a >= 10.0 {
        format!("{:.1}", v)
    } else {
        format!("{:.2}", v)
    }
}

/// Every parameter at its default, as stored 0..1 values.
pub fn defaults() -> [f32; COUNT] {
    let mut out = [0.0; COUNT];
    for (i, o) in out.iter_mut().enumerate() {
        let p = param(i);
        *o = p.kind.normal(p.default);
    }
    out
}

/// A dB level as a gain (−∞ is silence).
pub fn db_gain(db: f32) -> f32 {
    if db == f32::NEG_INFINITY {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indices_name_their_parameters() {
        let total: usize = GROUPS.iter().map(|g| g.len()).sum();
        assert_eq!(total, COUNT);
        let check = [
            (B, "B on"), (FM, "FM B → A"), (NOISE_ROUTE, "Noise route"), (FILTER_TYPE, "Filter type"), (FENV_AMT, "Filter envelope"),
            (F2_TYPE, "Filter 2 type"), (F2_SERIAL, "Filter 1 into 2"), (AMP_A, "Amp attack"), (AMP_R, "Amp release"), (FENV_A, "Filter attack"),
            (MENV_A, "Mod env attack"), (PENV_AMT, "Pitch envelope"), (PENV_D, "Pitch decay"), (SHAPER, "Drive type"), (DRIVE_MIX, "Drive mix"),
            (LFO_1, "LFO 1 shape"), (LFO_1 + LFO_LEN * 3 + lfo::AMT2, "LFO 4 amount 2"), (SHAPE_1, "Shape 1 step 1"), (SHAPE_1 + SHAPE_LEN * 2 - 1, "Shape 2 smooth"),
            (MATRIX_1, "Mod 1 source"), (MATRIX_1 + 3 * SLOTS - 1, "Mod 8 amount"), (MACRO_1, "Macro 1"), (MODE, "Voices"), (VELOCITY, "Velocity"),
            (EQ_ON, "EQ on"), (CHORUS_ON, "Chorus on"), (PHASER_ON, "Phaser on"), (DELAY_ON, "Delay on"), (REVERB_ON, "Reverb on"), (OTT, "OTT"), (LEVEL, "Level"),
            (LFO_MORE_1, "LFO 1 retrigger"), (LFO_MORE_1 + LFO_MORE_LEN * 3 + lfo::SUSTAIN, "LFO 4 sustain point"), (CHAOS_DIV, "Chaos rate (sync)"), (CHAOS_SMOOTH, "Chaos smooth"), (RANDOM_CYCLE, "Random repeat"),
            (slot_base(8), "Mod 9 source"), (slot_base(15) + 2, "Mod 16 amount"), (slot_base(7) + 2, "Mod 8 amount"), (slot_more(0), "Mod 1 curve"), (slot_more(15) + 1, "Mod 16 via"),
            (PRE_SHAPER, "Pre drive type"), (DRIVE_TONE, "Drive tone"), (BAND_SHAPER, "Band drive type"), (BAND_HIGH_AMT, "Band high amount"),
            (SUB_PATH, "Sub path"), (GLIDE_MODE, "Glide mode"), (PENV_CURVE, "Pitch envelope curve"),
            (MONO_RESTART, "Mono restart"), (MONO_BELOW, "Mono below"), (RANDOM_BY_STEP, "Random by step"),
            (EVEN_KEYS, "Even keyboard"), (DETUNE_KEY, "Detune key tracking"),
        ];
        assert_eq!(COUNT_V1, 215, "the first version's parameters");
        for (i, name) in check {
            assert_eq!(param(i).name, name, "index {i}");
        }
        assert_eq!(param(A + osc::ROUTE).name, "A route");
        for i in 0..COUNT {
            assert_eq!(index_of(param(i).name), Some(i), "{} is named twice", param(i).name);
        }
    }

    #[test]
    fn choices_round_trip_and_fit_their_room() {
        for i in 0..COUNT {
            if let Kind::Choice { names, cap } = param(i).kind {
                assert!(names.len() <= cap, "{}", param(i).name);
                for k in 0..names.len() {
                    let n = param(i).kind.normal(k as f32);
                    assert_eq!(param(i).kind.value(n) as usize, k, "{} option {k}", param(i).name);
                }
            }
        }
    }
}
