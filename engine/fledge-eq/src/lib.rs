//! Fledge Dynamic EQ: four bells that can move with the sound.
//!
//! An equaliser's band is a fixed amount up or down. Each band here can also *move*: give it a
//! "Moves by" amount and a threshold, and it turns by that much more as the sound in its own
//! range passes the threshold, easing back as it falls. Down, that is a de-esser, or a boom that
//! is tamed only on the notes that boom; up, a part that opens as it's played harder.
//!
//! Each band also chooses what it works on: both sides (Stereo), only what the two sides share
//! (Mid: what's in the centre), or only where they differ (Side: the width). A bell up on the
//! Side widens the top; a deep one down on the Side at 80 Hz puts the bass in the middle.
//!
//! Written from the textbook parts (the cookbook bell, a band-pass and a follower for each band's
//! own level), not from anyone's code. No added delay.

use fledge_dsp::bank::Bell;
use fledge_dsp::filter::{Svf, SvfCoef};
use fledge_dsp::math::flush;
use fledge_plugin::{Block, Info, Plugin};

/// The bands, and each one's six parameters in order. New parameters are only ever added at the
/// end (see fledge-plugin).
pub const BANDS: usize = 4;
pub const FREQ: usize = 0;
pub const GAIN: usize = 1;
pub const Q: usize = 2;
pub const MOVES: usize = 3;
pub const THRESHOLD: usize = 4;
pub const CHANNEL: usize = 5;
pub const PER_BAND: usize = 6;
pub const OUTPUT: usize = BANDS * PER_BAND;
pub const COUNT: usize = OUTPUT + 1;

const PARTS: [&str; PER_BAND] = ["frequency", "gain", "width", "moves by", "threshold", "works on"];
pub const CHANNELS: [&str; 3] = ["Stereo", "Mid", "Side"];
const NAMES: [&str; COUNT] = {
    // (Written out: a name must be a plain string the host can keep)
    [
        "Band 1 frequency", "Band 1 gain", "Band 1 width", "Band 1 moves by", "Band 1 threshold", "Band 1 works on",
        "Band 2 frequency", "Band 2 gain", "Band 2 width", "Band 2 moves by", "Band 2 threshold", "Band 2 works on",
        "Band 3 frequency", "Band 3 gain", "Band 3 width", "Band 3 moves by", "Band 3 threshold", "Band 3 works on",
        "Band 4 frequency", "Band 4 gain", "Band 4 width", "Band 4 moves by", "Band 4 threshold", "Band 4 works on",
        "Output",
    ]
};

pub const MOST_GAIN: f32 = 18.0;
/// A band moves its whole amount once its level is this far over its threshold
const KNEE_DB: f32 = 12.0;
/// How fast a band's movement follows: toward more, and back
const ATTACK_S: f32 = 0.010;
const RELEASE_S: f32 = 0.150;
/// The bells are worked out again this often, in samples (the same whatever the block size)
const EVERY: usize = 32;

/// The parameter for `band`'s `part`.
pub const fn at(band: usize, part: usize) -> usize {
    band * PER_BAND + part
}
fn part(i: usize) -> Option<usize> {
    (i < OUTPUT).then_some(i % PER_BAND)
}
fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}

/// A parameter's 0..1 as its own value: Hz, dB, a width, or a choice's number.
pub fn value(i: usize, v: f32) -> f32 {
    match part(i) {
        Some(FREQ) => expo(v, 20.0, 20000.0),
        Some(GAIN) | Some(MOVES) => -MOST_GAIN + 2.0 * MOST_GAIN * v,
        Some(Q) => expo(v, 0.3, 12.0),
        Some(THRESHOLD) => -70.0 + 70.0 * v,
        Some(CHANNEL) => (v * 2.0).round(),
        _ => -12.0 + 24.0 * v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match part(i) {
        Some(FREQ) => expo_inv(x, 20.0, 20000.0),
        Some(GAIN) | Some(MOVES) => ((x + MOST_GAIN) / (2.0 * MOST_GAIN)).clamp(0.0, 1.0),
        Some(Q) => expo_inv(x, 0.3, 12.0),
        Some(THRESHOLD) => ((x + 70.0) / 70.0).clamp(0.0, 1.0),
        Some(CHANNEL) => (x / 2.0).clamp(0.0, 1.0),
        _ => ((x + 12.0) / 24.0).clamp(0.0, 1.0),
    }
}

/// Settings from each band's own values (frequency, gain, width, moves by, threshold, works on by number).
fn settings(bands: [[f32; PER_BAND]; BANDS]) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    for (b, band) in bands.into_iter().enumerate() {
        for (k, x) in band.into_iter().enumerate() {
            v[at(b, k)] = normal(at(b, k), x);
        }
    }
    v[OUTPUT] = normal(OUTPUT, 0.0);
    v
}

/// A band that does nothing yet, at `hz`.
const fn flat(hz: f32) -> [f32; PER_BAND] {
    [hz, 0.0, 1.0, 0.0, -30.0, 0.0]
}

/// The settings a fresh one has: four flat bands at 100 Hz, 500 Hz, 2.5 kHz and 8 kHz.
pub fn defaults() -> [f32; COUNT] {
    settings([flat(100.0), flat(500.0), flat(2500.0), flat(8000.0)])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("De-ess", settings([flat(100.0), flat(500.0), flat(2500.0), [6500.0, 0.0, 2.0, -10.0, -38.0, 0.0]])),
        ("Tame the boom, only when it booms", settings([[120.0, 0.0, 1.5, -8.0, -26.0, 0.0], flat(500.0), flat(2500.0), flat(8000.0)])),
        ("Harshness down when it's loud", settings([flat(100.0), flat(500.0), [3200.0, 0.0, 2.0, -6.0, -30.0, 0.0], flat(8000.0)])),
        ("Wider top", settings([flat(100.0), flat(500.0), flat(2500.0), [10000.0, 4.0, 0.7, 0.0, -30.0, 2.0]])),
        ("Bass in the middle", settings([[70.0, -18.0, 0.5, 0.0, -30.0, 2.0], flat(500.0), flat(2500.0), flat(8000.0)])),
        ("The centre forward as it's sung", settings([flat(100.0), flat(500.0), [3000.0, 0.0, 1.0, 4.0, -36.0, 1.0], flat(8000.0)])),
    ]
}

#[derive(Clone, Copy, Default)]
struct Band {
    /// Its bell on the middle and on the sides
    bells: [Bell; 2],
    /// What hears its own range, and that range's level now
    hear: [Svf; 2],
    level: f32,
    /// How far it has moved now, dB
    moved: f32,
    /// What its bells were last set to
    set: [f32; 3],
    channel: usize,
}

pub struct DynamicEq {
    sr: f32,
    pub params: [f32; COUNT],
    bands: [Band; BANDS],
    until: usize,
    out: f32,
    fresh: bool,
}

impl DynamicEq {
    /// How far band `b` has moved now, dB: for a display.
    pub fn moved(&self, b: usize) -> f32 {
        self.bands[b].moved
    }

    fn work_out(&mut self) {
        let step = EVERY as f32 / self.sr;
        let attack = 1.0 - (-step / ATTACK_S).exp();
        let release = 1.0 - (-step / RELEASE_S).exp();
        for b in 0..BANDS {
            let p = |k: usize| value(at(b, k), self.params[at(b, k)]);
            let (hz, gain, q, moves, threshold) = (p(FREQ), p(GAIN), p(Q), p(MOVES), p(THRESHOLD));
            let band = &mut self.bands[b];
            let channel = p(CHANNEL) as usize;
            if channel != band.channel {
                // What it stops working on starts clean when it's next used
                band.channel = channel;
                band.bells[0].reset();
                band.bells[1].reset();
            }
            let mut to = 0.0;
            if moves != 0.0 {
                let db = 20.0 * band.level.max(1e-6).log10();
                let x = ((db - threshold) / KNEE_DB).clamp(0.0, 1.0);
                to = moves * x * x * (3.0 - 2.0 * x);
            }
            let c = if to.abs() > band.moved.abs() { attack } else { release };
            band.moved += (to - band.moved) * c;
            if band.moved.abs() < 0.005 && to == 0.0 {
                band.moved = 0.0;
            }
            let now = [hz, (gain + band.moved).clamp(-2.0 * MOST_GAIN, 2.0 * MOST_GAIN), q];
            if (now[1] - band.set[1]).abs() > 0.02 || now[0] != band.set[0] || now[2] != band.set[2] || (now[1] == 0.0 && band.set[1] != 0.0) {
                band.set = now;
                for bell in &mut band.bells {
                    bell.set(now[0], now[1], now[2], self.sr);
                    // (Flat, it's passed by: it starts clean when it's next used, not with what
                    // was ringing in it when it was last on)
                    if now[1] == 0.0 {
                        bell.reset();
                    }
                }
            }
        }
    }
}

impl Plugin for DynamicEq {
    fn info() -> Info {
        Info {
            name: "Fledge Dynamic EQ",
            category: "EQ",
            about: "Four bells that can move with the sound. Each has a frequency, a gain and a width, like any equaliser band. Give one a \"moves by\" amount and a threshold and it turns that much further as the sound in its own range gets loud, and eases back as it falls: down for a de-esser or a boom tamed only on the notes that boom, up for a part that opens as it's played harder. \"Works on\" sends a band to both sides, to the Mid (the centre) or to the Side (the width): lift the Side's top for a wider mix, or cut the Side's lows to keep the bass in the middle. No added delay.",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["eq", "dynamic eq", "mid side", "de-esser", "equaliser", "equalizer", "bell", "stereo width"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        DynamicEq { sr: sample_rate.max(8000.0), params: defaults(), bands: [Band::default(); BANDS], until: 0, out: 1.0, fresh: true }
    }

    fn param_count() -> usize {
        COUNT
    }

    fn param_name(i: usize) -> &'static str {
        debug_assert!(i >= OUTPUT || NAMES[i].ends_with(PARTS[i % PER_BAND]));
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
        match part(i) {
            Some(FREQ) if x >= 1000.0 => format!("{:.2} kHz", x / 1000.0),
            Some(FREQ) => format!("{x:.0} Hz"),
            Some(Q) => format!("{x:.2}"),
            Some(THRESHOLD) => format!("{x:.1} dB"),
            Some(CHANNEL) => CHANNELS[x as usize].to_string(),
            Some(MOVES) if x.abs() < 0.05 => "Off".to_string(),
            _ => format!("{x:+.1} dB"),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let out_to = 10f32.powf(value(OUTPUT, self.params[OUTPUT]) / 20.0);
        if self.fresh {
            self.out = out_to;
            self.fresh = false;
        }
        let ease = 1.0 - (-1.0 / (0.005 * self.sr)).exp();
        // Each band hears its own range: a band-pass as wide as its bell
        let mut hear = [SvfCoef::default(); BANDS];
        let mut width = [1.0f32; BANDS];
        let mut moving = [false; BANDS];
        for b in 0..BANDS {
            let p = |k: usize| value(at(b, k), self.params[at(b, k)]);
            width[b] = 1.0 / p(Q).max(0.5);
            hear[b] = SvfCoef::new(p(FREQ), self.sr, width[b]);
            moving[b] = p(MOVES) != 0.0;
        }
        // A follower that rises at once and falls over 60 ms
        let fall = (-1.0 / (0.06 * self.sr)).exp();
        let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
        for i in 0..block.frames() {
            let (l, r) = (clean(block.input[0][i]), clean(block.input[1][i]));
            let (mut m, mut s) = (0.5 * (l + r), 0.5 * (l - r));
            // (Every band hears the sound as it came in, so one band's work doesn't set off another)
            for b in 0..BANDS {
                let band = &mut self.bands[b];
                if !moving[b] {
                    // (Not moving, it hears nothing: turned on again it starts from silence, not
                    // from how loud the sound was when it was turned off)
                    band.level = 0.0;
                    band.hear = [Svf::default(); 2];
                    continue;
                }
                let (a, c) = match band.channel {
                    1 => (m, m),
                    2 => (s, s),
                    _ => (l, r),
                };
                let now = (band.hear[0].tick(&hear[b], a).bp * width[b]).abs().max((band.hear[1].tick(&hear[b], c).bp * width[b]).abs());
                band.level = flush(now.max(band.level * fall));
            }
            if self.until == 0 {
                self.work_out();
                self.until = EVERY;
            }
            self.until -= 1;
            for band in &mut self.bands {
                if band.set[1] == 0.0 {
                    continue;
                }
                if band.channel != 2 {
                    m = band.bells[0].tick(m);
                }
                if band.channel != 1 {
                    s = band.bells[1].tick(s);
                }
            }
            self.out += (out_to - self.out) * ease;
            block.output[0][i] = (m + s) * self.out;
            block.output[1][i] = (m - s) * self.out;
        }
    }

    fn settle(&mut self) {
        self.bands = [Band::default(); BANDS];
        self.until = 0;
        self.fresh = true;
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

fledge_wasm::export!(DynamicEq);

#[cfg(test)]
mod tests;
