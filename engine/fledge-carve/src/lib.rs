//! Fledge Carve: make room for another track.
//!
//! A sidechain compressor turns a whole track down while another plays. This turns it down only
//! where the other track is: it listens to the sidechain in 28 narrow bands and, band by band,
//! turns this track down by as much as the other is sounding there. A pad under a vocal loses a
//! little of the vocal's range while the singer sings and keeps its lows and its air; a bass
//! under a kick loses only the kick's thump.
//!
//! Written from the idea (the sidechain's spectrum as a cut on this track), not from anyone's
//! code. Each band is a filter that runs along with the sound, so there is no added delay. With
//! nothing connected to the sidechain it does nothing.

use fledge_dsp::bank::{Bank, Cuts};
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const AMOUNT: usize = 0;
pub const THRESHOLD: usize = 1;
pub const ATTACK: usize = 2;
pub const RELEASE: usize = 3;
pub const LOW: usize = 4;
pub const HIGH: usize = 5;
pub const LISTEN: usize = 6;
pub const COUNT: usize = 7;

const NAMES: [&str; COUNT] = ["Amount", "Threshold", "Attack", "Release", "From", "To", "Hear what's removed"];

/// The bands: how many, and from where to where
pub const BANDS: usize = 28;
pub const BANK_LO: f32 = 60.0;
pub const BANK_HI: f32 = 16000.0;
/// The most a band is turned down, dB (the top of Amount)
pub const MOST_CUT: f32 = 24.0;
/// A band of the other track this far over the threshold takes the whole Amount; under it, less
const KNEE_DB: f32 = 18.0;
/// Neighbouring bands' bells overlap, so when the other track fills many bands at once the cuts
/// add up to more than each one's own: each is set to this share of the Amount, which brings a
/// track carved across its whole range down by about the Amount (measured in the app: 28 dB for
/// an Amount of 20 without it)
const SHARE: f32 = 0.8;
/// The cuts are worked out again this often, in samples (the same whatever the block size)
const EVERY: usize = 32;

fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}

/// A parameter's 0..1 as its own value: dB, milliseconds, Hz, or 0 and 1 for a switch.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        AMOUNT => MOST_CUT * v,
        THRESHOLD => -70.0 + 70.0 * v,
        ATTACK => expo(v, 1.0, 200.0),
        RELEASE => expo(v, 20.0, 2000.0),
        LOW | HIGH => expo(v, BANK_LO, BANK_HI),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        AMOUNT => (x / MOST_CUT).clamp(0.0, 1.0),
        THRESHOLD => ((x + 70.0) / 70.0).clamp(0.0, 1.0),
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

/// The settings a fresh one has: up to 8 dB, from -40 dB, the whole range.
pub fn defaults() -> [f32; COUNT] {
    settings([8.0, -40.0, 10.0, 150.0, BANK_LO, BANK_HI])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 5] {
    [
        ("Room for a vocal", settings([6.0, -42.0, 15.0, 200.0, 250.0, 8000.0])),
        ("Bass under the kick", settings([12.0, -36.0, 2.0, 120.0, BANK_LO, 300.0])),
        ("Pads under the lead", settings([9.0, -40.0, 10.0, 250.0, 300.0, BANK_HI])),
        ("Music under speech", settings([10.0, -45.0, 30.0, 500.0, 150.0, 6000.0])),
        ("Deep carve", settings([20.0, -45.0, 5.0, 150.0, BANK_LO, BANK_HI])),
    ]
}

pub struct Carve {
    sr: f32,
    pub params: [f32; COUNT],
    /// The other track, band by band
    bank: Bank,
    cuts: Cuts,
    /// Samples until the cuts are worked out again
    until: usize,
    /// Whether the other track was connected last block
    keyed: bool,
}

impl Carve {
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
        let (amount, threshold) = (p(AMOUNT), p(THRESHOLD));
        let (lo, hi) = (p(LOW), p(HIGH).max(p(LOW)));
        let step = EVERY as f32 / self.sr;
        let attack = 1.0 - (-step / (p(ATTACK) * 0.001)).exp();
        let release = 1.0 - (-step / (p(RELEASE) * 0.001)).exp();
        for b in 0..BANDS {
            let hz = self.bank.hz[b];
            let mut to = 0.0;
            if self.keyed && hz >= lo * 0.98 && hz <= hi * 1.02 {
                // From nothing at the threshold to the whole amount a knee above it, easing in and out
                let x = ((self.bank.db(b) - threshold) / KNEE_DB).clamp(0.0, 1.0);
                to = amount * SHARE * x * x * (3.0 - 2.0 * x);
            }
            self.cuts.ease(b, to, attack, release);
        }
    }
}

impl Plugin for Carve {
    fn info() -> Info {
        Info {
            name: "Fledge Carve",
            category: "EQ",
            about: "Makes room for another track: pick it under \"Sidechain from\", and this track is turned down only at the frequencies that one is using, band by band, while it plays. A pad under a vocal keeps its lows and its air; a bass under a kick loses only the thump. Amount is the most a band is turned down; Threshold is how loud the other track must be in a band before it counts; From and To keep it to a range; \"Hear what's removed\" plays only what it takes out. With no sidechain it does nothing. No added delay.",
            instrument: false,
            sidechain: true,
            transport: false,
            tags: &["sidechain", "duck", "space", "unmask", "carve", "dynamic eq"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        let bank = Bank::new(sr, BANDS, BANK_LO, BANK_HI, 0.03);
        let cuts = Cuts::new(&bank, sr);
        Carve { sr, params: defaults(), bank, cuts, until: 0, keyed: false }
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
            AMOUNT | THRESHOLD => format!("{x:.1} dB"),
            ATTACK | RELEASE => format!("{x:.0} ms"),
            LOW | HIGH if x >= 1000.0 => format!("{:.1} kHz", x / 1000.0),
            LOW | HIGH => format!("{x:.0} Hz"),
            _ => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let listen = self.params[LISTEN] >= 0.5;
        if block.sidechain.is_none() && self.keyed {
            // The other track was taken away: forget it, so the cuts ease back out
            self.bank.reset();
        }
        self.keyed = block.sidechain.is_some();
        // (A sample that isn't a number is silence: it mustn't stick in a filter)
        let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
        for i in 0..block.frames() {
            let (l, r) = (clean(block.input[0][i]), clean(block.input[1][i]));
            if let Some(key) = &block.sidechain {
                self.bank.hear(key[0][i], key[1][i]);
            }
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

fledge_wasm::export!(Carve);

#[cfg(test)]
mod tests;
