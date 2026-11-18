//! Fledge Smooth: a resonance suppressor.
//!
//! Some sounds have frequencies that ring out over the rest: a harsh edge on a supersaw, a
//! whistle in a growl bass, one boomy note on a bass guitar, the bite of a vocal's "ee". An
//! equaliser can turn such a frequency down, but it stays down when the ringing has moved on.
//! This listens to the sound in 28 narrow bands, compares each with its neighbours, and turns a
//! band down only while it stands out from them, and only by as much as it does.
//!
//! Written from the idea (a band's level against the average of the bands around it), not from
//! anyone's code. The sound is never cut into frames: each band is a filter that runs along with
//! it, so there is no added delay and a track stays in time.

use fledge_dsp::bank::{Bank, Cuts};
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const DEPTH: usize = 0;
pub const THRESHOLD: usize = 1;
pub const ATTACK: usize = 2;
pub const RELEASE: usize = 3;
pub const LOW: usize = 4;
pub const HIGH: usize = 5;
pub const LISTEN: usize = 6;
pub const COUNT: usize = 7;

const NAMES: [&str; COUNT] = ["Depth", "Stands out by", "Attack", "Release", "From", "To", "Removed only"];

/// The bands: how many, and from where to where
pub const BANDS: usize = 28;
pub const BANK_LO: f32 = 60.0;
pub const BANK_HI: f32 = 16000.0;
/// The most a band is ever turned down (at full depth), dB
pub const MOST_CUT: f32 = 24.0;
/// A band is compared with its neighbours from this far away to this far, on each side (the ones
/// right next to it hear some of the same note, so they'd hide it)
const NEAR: usize = 2;
const FAR: usize = 4;
/// Under this level a band is left alone (silence and noise aren't "resonances")
const FLOOR_DB: f32 = -70.0;
/// The cuts are worked out again this often, in samples (the same whatever the block size)
const EVERY: usize = 32;

fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}

/// A parameter's 0..1 as its own value: a fraction, dB, milliseconds, Hz, or 0 and 1 for a switch.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        THRESHOLD => 18.0 * v,
        ATTACK => expo(v, 1.0, 200.0),
        RELEASE => expo(v, 20.0, 2000.0),
        LOW | HIGH => expo(v, BANK_LO, BANK_HI),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        THRESHOLD => (x / 18.0).clamp(0.0, 1.0),
        ATTACK => expo_inv(x, 1.0, 200.0),
        RELEASE => expo_inv(x, 20.0, 2000.0),
        LOW | HIGH => expo_inv(x, BANK_LO, BANK_HI),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order (the listen switch off).
fn settings(values: [f32; 6]) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    for (i, x) in values.into_iter().enumerate() {
        v[i] = normal(i, x);
    }
    v
}

/// The settings a fresh one has: half depth, on anything 4 dB over its neighbours, the whole range.
pub fn defaults() -> [f32; COUNT] {
    settings([0.5, 4.0, 10.0, 150.0, BANK_LO, BANK_HI])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 5] {
    [
        ("Tame a harsh synth", settings([0.6, 3.0, 5.0, 120.0, 1500.0, BANK_HI])),
        ("Soften a vocal", settings([0.4, 4.0, 10.0, 180.0, 2000.0, 10000.0])),
        ("A bass that booms on one note", settings([0.7, 4.0, 20.0, 300.0, BANK_LO, 400.0])),
        ("Smooth the whole mix, gently", settings([0.25, 6.0, 30.0, 400.0, 200.0, BANK_HI])),
        ("Hard, for sound design", settings([1.0, 1.0, 2.0, 80.0, BANK_LO, BANK_HI])),
    ]
}

pub struct Smooth {
    sr: f32,
    pub params: [f32; COUNT],
    bank: Bank,
    cuts: Cuts,
    /// Samples until the cuts are worked out again
    until: usize,
    db: [f32; BANDS],
}

impl Smooth {
    /// How far band `b` is turned down now, dB: for a display.
    pub fn cut(&self, b: usize) -> f32 {
        self.cuts.cut[b]
    }
    /// Band `b`'s centre, Hz.
    pub fn band_hz(&self, b: usize) -> f32 {
        self.bank.hz[b]
    }

    fn work_out(&mut self) {
        let p = |i: usize| value(i, self.params[i]);
        let (depth, over) = (p(DEPTH), p(THRESHOLD));
        let (lo, hi) = (p(LOW), p(HIGH).max(p(LOW)));
        let step = EVERY as f32 / self.sr;
        let attack = 1.0 - (-step / (p(ATTACK) * 0.001)).exp();
        let release = 1.0 - (-step / (p(RELEASE) * 0.001)).exp();
        // Each band's level, steadied over 40 ms: hiss wavers from moment to moment in a narrow
        // band, and a waver is not a resonance
        let steady = 1.0 - (-step / 0.04).exp();
        for b in 0..BANDS {
            self.db[b] += (self.bank.db(b) - self.db[b]) * steady;
        }
        for b in 0..BANDS {
            let hz = self.bank.hz[b];
            let mut to = 0.0;
            if depth > 0.0 && hz >= lo * 0.98 && hz <= hi * 1.02 && self.db[b] > FLOOR_DB {
                // The bands around it, averaged (in dB: a quiet neighbour counts as much as a loud one)
                let (mut sum, mut count) = (0.0, 0);
                for d in NEAR..=FAR {
                    for n in [b.checked_sub(d), Some(b + d).filter(|n| *n < BANDS)].into_iter().flatten() {
                        sum += self.db[n].max(FLOOR_DB - 20.0);
                        count += 1;
                    }
                }
                let around = sum / count as f32;
                to = (self.db[b] - around - over).clamp(0.0, MOST_CUT) * depth;
            }
            self.cuts.ease(b, to, attack, release);
        }
    }
}

impl Plugin for Smooth {
    fn info() -> Info {
        Info {
            name: "Fledge Smooth",
            category: "EQ",
            about: "A resonance suppressor: it listens in 28 narrow bands and turns a band down only while it stands out from the bands around it, and only by as much as it does. For a harsh supersaw, a whistle in a growl bass, one booming bass note, the bite of a vocal. Depth is how much; \"Stands out by\" is how far over its neighbours a band must be before it's touched; From and To keep it to a range; \"Removed only\" plays only what it takes out. No added delay.",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["resonance", "harsh", "smooth", "de-harsh", "dynamic eq", "tame"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        let bank = Bank::new(sr, BANDS, BANK_LO, BANK_HI, 0.02);
        let cuts = Cuts::new(&bank, sr);
        Smooth { sr, params: defaults(), bank, cuts, until: 0, db: [-120.0; BANDS] }
    }

    fn param_count() -> usize {
        COUNT
    }

    fn param_name(i: usize) -> &'static str {
        NAMES[i]
    }

    fn get(&self, i: usize) -> f32 {
        self.params[i]
    }

    fn set(&mut self, i: usize, value: f32) {
        self.params[i] = value;
    }

    fn param_display(&self, i: usize) -> String {
        let x = value(i, self.params[i]);
        match i {
            DEPTH => format!("{:.0} %", x * 100.0),
            THRESHOLD => format!("{x:.1} dB"),
            ATTACK | RELEASE => format!("{x:.0} ms"),
            LOW | HIGH if x >= 1000.0 => format!("{:.1} kHz", x / 1000.0),
            LOW | HIGH => format!("{x:.0} Hz"),
            _ => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let listen = self.params[LISTEN] >= 0.5;
        for i in 0..block.frames() {
            // (A sample that isn't a number is silence: it mustn't stick in a filter)
            let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
            let (l, r) = (clean(block.input[0][i]), clean(block.input[1][i]));
            self.bank.hear(l, r);
            if self.until == 0 {
                self.work_out();
                self.until = EVERY;
            }
            self.until -= 1;
            let (yl, yr) = self.cuts.tick(l, r);
            if listen {
                block.output[0][i] = l - yl;
                block.output[1][i] = r - yr;
            } else {
                block.output[0][i] = yl;
                block.output[1][i] = yr;
            }
        }
    }

    fn settle(&mut self) {
        self.bank.reset();
        self.cuts.reset();
        self.until = 0;
        self.db = [-120.0; BANDS];
    }

    fn program_count() -> usize {
        presets().len()
    }

    fn program_name(i: usize) -> &'static str {
        presets()[i].0
    }

    fn set_program(&mut self, i: usize) {
        self.params = presets()[i].1;
    }
}

fledge_wasm::export!(Smooth);

#[cfg(test)]
mod tests;
