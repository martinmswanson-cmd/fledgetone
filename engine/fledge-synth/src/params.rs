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
    /// Whole numbers from `min` to `max`
    Int { min: i32, max: i32, unit: &'static str },
    /// One of `names`
    Choice { names: &'static [&'static str] },
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

pub const TABLES: &[&str] = &["Basic shapes", "Pulse width", "Dark saw", "Vowels", "Harmonic sweep", "Growl FM", "Metal FM", "Fold"];
pub const FILTERS: &[&str] = &["Low pass 12", "Low pass 24", "Ladder", "Band pass", "High pass 12", "High pass 24", "Notch", "Comb +", "Comb −", "Formant", "Off"];
pub const SHAPERS: &[&str] = &["Off", "Soft", "Warm", "Hard clip", "Fold", "Asymmetric"];
pub const LFO_SHAPES: &[&str] = &["Sine", "Triangle", "Saw up", "Saw down", "Square", "Wobble", "Steps", "Drift"];
/// Tempo divisions, in beats (quarter notes) per cycle
pub const SYNC_NAMES: &[&str] = &["4 bars", "2 bars", "1 bar", "1/2.", "1/2", "1/4.", "1/2T", "1/4", "1/8.", "1/4T", "1/8", "1/16.", "1/8T", "1/16", "1/16T", "1/32"];
pub const SYNC_BEATS: &[f32] = &[16.0, 8.0, 4.0, 3.0, 2.0, 1.5, 4.0 / 3.0, 1.0, 0.75, 2.0 / 3.0, 0.5, 0.375, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125];
pub const DESTS: &[&str] = &["None", "Cutoff", "Resonance", "A position", "B position", "Pitch", "Volume", "Drive", "FM", "Pan", "B pitch", "Sub"];
pub const MODES: &[&str] = &["Poly", "Mono", "Legato"];
pub const SUB_OCTAVES: &[&str] = &["−1 octave", "−2 octaves"];

macro_rules! osc_params {
    ($p:literal) => {
        [
            Param { name: concat!($p, " on"), kind: Kind::Toggle, default: 1.0 },
            Param { name: concat!($p, " table"), kind: Kind::Choice { names: TABLES }, default: 0.0 },
            Param { name: concat!($p, " position"), kind: Kind::Percent, default: 0.0 },
            Param { name: concat!($p, " octave"), kind: Kind::Int { min: -3, max: 3, unit: "" }, default: 0.0 },
            Param { name: concat!($p, " semitone"), kind: Kind::Int { min: -12, max: 12, unit: " st" }, default: 0.0 },
            Param { name: concat!($p, " fine"), kind: Kind::Lin { min: -100.0, max: 100.0, unit: " cents" }, default: 0.0 },
            Param { name: concat!($p, " level"), kind: Kind::Db { min: -48.0, max: 0.0 }, default: 0.0 },
            Param { name: concat!($p, " unison"), kind: Kind::Int { min: 1, max: 16, unit: " voices" }, default: 1.0 },
            Param { name: concat!($p, " detune"), kind: Kind::Percent, default: 0.25 },
            Param { name: concat!($p, " blend"), kind: Kind::Percent, default: 0.7 },
            Param { name: concat!($p, " width"), kind: Kind::Percent, default: 0.5 },
        ]
    };
}

macro_rules! lfo_params {
    ($p:literal) => {
        [
            Param { name: concat!($p, " shape"), kind: Kind::Choice { names: LFO_SHAPES }, default: 0.0 },
            Param { name: concat!($p, " sync"), kind: Kind::Toggle, default: 1.0 },
            Param { name: concat!($p, " rate (sync)"), kind: Kind::Choice { names: SYNC_NAMES }, default: 10.0 },
            Param { name: concat!($p, " rate (Hz)"), kind: Kind::Log { min: 0.05, max: 30.0, unit: " Hz" }, default: 2.0 },
            Param { name: concat!($p, " restart on note"), kind: Kind::Toggle, default: 1.0 },
            Param { name: concat!($p, " target 1"), kind: Kind::Choice { names: DESTS }, default: 0.0 },
            Param { name: concat!($p, " amount 1"), kind: Kind::Bipolar, default: 0.0 },
            Param { name: concat!($p, " target 2"), kind: Kind::Choice { names: DESTS }, default: 0.0 },
            Param { name: concat!($p, " amount 2"), kind: Kind::Bipolar, default: 0.0 },
        ]
    };
}

const OSC_A: [Param; 11] = osc_params!("A");
const OSC_B: [Param; 11] = osc_params!("B");
const LFO1: [Param; 9] = lfo_params!("LFO 1");
const LFO2: [Param; 9] = lfo_params!("LFO 2");

const REST: [Param; 39] = [
    Param { name: "FM B → A", kind: Kind::Percent, default: 0.0 },
    Param { name: "Sub level", kind: Kind::Db { min: -48.0, max: 0.0 }, default: f32::NEG_INFINITY },
    Param { name: "Sub octave", kind: Kind::Choice { names: SUB_OCTAVES }, default: 0.0 },
    Param { name: "Noise level", kind: Kind::Db { min: -48.0, max: 0.0 }, default: f32::NEG_INFINITY },
    Param { name: "Filter type", kind: Kind::Choice { names: FILTERS }, default: 1.0 },
    Param { name: "Cutoff", kind: Kind::Log { min: 20.0, max: 20000.0, unit: " Hz" }, default: 8000.0 },
    Param { name: "Resonance", kind: Kind::Percent, default: 0.15 },
    Param { name: "Filter drive", kind: Kind::Percent, default: 0.0 },
    Param { name: "Key tracking", kind: Kind::Percent, default: 0.5 },
    Param { name: "Filter envelope", kind: Kind::Bipolar, default: 0.0 },
    Param { name: "Amp attack", kind: Kind::Log { min: 0.003, max: 10.0, unit: " s" }, default: 0.003 },
    Param { name: "Amp decay", kind: Kind::Log { min: 0.005, max: 10.0, unit: " s" }, default: 0.3 },
    Param { name: "Amp sustain", kind: Kind::Percent, default: 1.0 },
    Param { name: "Amp release", kind: Kind::Log { min: 0.005, max: 10.0, unit: " s" }, default: 0.12 },
    Param { name: "Filter attack", kind: Kind::Log { min: 0.001, max: 10.0, unit: " s" }, default: 0.001 },
    Param { name: "Filter decay", kind: Kind::Log { min: 0.005, max: 10.0, unit: " s" }, default: 0.4 },
    Param { name: "Filter sustain", kind: Kind::Percent, default: 0.0 },
    Param { name: "Filter release", kind: Kind::Log { min: 0.005, max: 10.0, unit: " s" }, default: 0.2 },
    Param { name: "Pitch envelope", kind: Kind::Lin { min: -24.0, max: 24.0, unit: " st" }, default: 0.0 },
    Param { name: "Pitch decay", kind: Kind::Log { min: 0.005, max: 2.0, unit: " s" }, default: 0.08 },
    Param { name: "Drive type", kind: Kind::Choice { names: SHAPERS }, default: 0.0 },
    Param { name: "Drive", kind: Kind::Lin { min: 0.0, max: 36.0, unit: " dB" }, default: 0.0 },
    Param { name: "Drive mix", kind: Kind::Percent, default: 1.0 },
    // LFO 1 and 2 (see LFO1/LFO2) sit here in the full list
    Param { name: "Mod wheel target", kind: Kind::Choice { names: DESTS }, default: 0.0 },
    Param { name: "Mod wheel amount", kind: Kind::Bipolar, default: 0.0 },
    Param { name: "Voices", kind: Kind::Choice { names: MODES }, default: 0.0 },
    Param { name: "Glide", kind: Kind::Log { min: 0.001, max: 2.0, unit: " s" }, default: 0.001 },
    Param { name: "Bend range", kind: Kind::Int { min: 1, max: 24, unit: " st" }, default: 2.0 },
    Param { name: "Velocity", kind: Kind::Percent, default: 0.5 },
    Param { name: "OTT", kind: Kind::Percent, default: 0.0 },
    Param { name: "OTT time", kind: Kind::Percent, default: 0.6 },
    Param { name: "Width", kind: Kind::Percent, default: 0.4 },
    Param { name: "Level", kind: Kind::Db { min: -36.0, max: 6.0 }, default: -14.0 },
    // Placeholders keep room for the next additions without moving anything: unused for now
    Param { name: "(spare 1)", kind: Kind::Percent, default: 0.0 },
    Param { name: "(spare 2)", kind: Kind::Percent, default: 0.0 },
    Param { name: "(spare 3)", kind: Kind::Percent, default: 0.0 },
    Param { name: "(spare 4)", kind: Kind::Percent, default: 0.0 },
    Param { name: "(spare 5)", kind: Kind::Percent, default: 0.0 },
    Param { name: "(spare 6)", kind: Kind::Percent, default: 0.0 },
];

/// Where each group starts in the full list
pub const A: usize = 0;
pub const B: usize = 11;
pub const FM: usize = 22;
pub const SUB_LEVEL: usize = 23;
pub const SUB_OCT: usize = 24;
pub const NOISE: usize = 25;
pub const FILTER_TYPE: usize = 26;
pub const CUTOFF: usize = 27;
pub const RESO: usize = 28;
pub const FILTER_DRIVE: usize = 29;
pub const KEYTRACK: usize = 30;
pub const FENV_AMT: usize = 31;
pub const AMP_A: usize = 32;
pub const AMP_D: usize = 33;
pub const AMP_S: usize = 34;
pub const AMP_R: usize = 35;
pub const FENV_A: usize = 36;
pub const FENV_D: usize = 37;
pub const FENV_S: usize = 38;
pub const FENV_R: usize = 39;
pub const PENV_AMT: usize = 40;
pub const PENV_D: usize = 41;
pub const SHAPER: usize = 42;
pub const DRIVE: usize = 43;
pub const DRIVE_MIX: usize = 44;
pub const LFO_1: usize = 45;
pub const LFO_2: usize = 54;
pub const MW_DEST: usize = 63;
pub const MW_AMT: usize = 64;
pub const MODE: usize = 65;
pub const GLIDE: usize = 66;
pub const BEND: usize = 67;
pub const VELOCITY: usize = 68;
pub const OTT: usize = 69;
pub const OTT_TIME: usize = 70;
pub const WIDTH: usize = 71;
pub const LEVEL: usize = 72;
pub const COUNT: usize = 79;

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
}

/// Offsets within an LFO's group
pub mod lfo {
    pub const SHAPE: usize = 0;
    pub const SYNC: usize = 1;
    pub const DIV: usize = 2;
    pub const HZ: usize = 3;
    pub const RETRIG: usize = 4;
    pub const DEST1: usize = 5;
    pub const AMT1: usize = 6;
    pub const DEST2: usize = 7;
    pub const AMT2: usize = 8;
}

/// The parameter at index `i`.
pub fn param(i: usize) -> &'static Param {
    match i {
        0..=10 => &OSC_A[i],
        11..=21 => &OSC_B[i - 11],
        22..=44 => &REST[i - 22],
        45..=53 => &LFO1[i - 45],
        54..=62 => &LFO2[i - 54],
        _ => &REST[i - 63 + 23],
    }
}

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
            Kind::Int { min, max, .. } => (min as f32 + ((max - min) as f32 * n).round()).round(),
            Kind::Choice { names } => (n * (names.len() - 1) as f32).round(),
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
            Kind::Int { min, max, .. } => (v - min as f32) / (max - min) as f32,
            Kind::Choice { names } => v / (names.len() - 1).max(1) as f32,
            Kind::Db { min, max } => {
                if v == f32::NEG_INFINITY || v < min {
                    0.0
                } else {
                    (v - min) / (max - min)
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
            Kind::Log { unit, .. } => {
                if unit == " Hz" && v >= 1000.0 {
                    format!("{} kHz", trim(v / 1000.0))
                } else if unit == " s" && v < 1.0 {
                    format!("{} ms", trim(v * 1000.0))
                } else {
                    format!("{}{}", trim(v), unit)
                }
            }
            Kind::Int { unit, .. } => format!("{}{}", v as i32, unit),
            Kind::Choice { names } => names[v as usize].to_string(),
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
