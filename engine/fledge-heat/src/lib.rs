//! Fledge Heat: a saturator in three bands.
//!
//! Driving a whole sound into distortion muddies it: the bass makes the top crackle, and the top
//! turns the bass to fuzz. Here the sound is split into lows, mids and highs first, and each band
//! has its own kind of distortion, its own drive and its own level: a warm tube low end under a
//! clean middle and a little hard grit on top, or the reverse.
//!
//! The split is a pair of Linkwitz-Riley crossovers (the lows also pass the upper one's turn of
//! phase, so the three bands add back to the whole sound level for level wherever the crossovers
//! sit), and each band is shaped at twice the sample rate, which keeps its top end: at the base
//! rate the antialiasing took 8 dB off at 18 kHz from any band that was driven. The shapes are
//! fledge-dsp's antialiased ones, each matched in loudness for a
//! sound near full level, so there more drive is more grit, not more level (a quiet sound comes up
//! with the drive, as through any saturator). Written from those textbook parts, not from anyone's code.
//! No frames and no look-ahead: the sound is late only by what the filters turn it (a few
//! samples). The Mix blends against the sound as the split passes it, at the doubled rate, so the
//! two stay in step.

use fledge_dsp::filter::{DcBlock, Svf, SvfCoef};
use fledge_dsp::oversample::{Down2, Up2};
use fledge_dsp::shaper::{shaper_makeup, Shaper};
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const LOW_SPLIT: usize = 0;
pub const HIGH_SPLIT: usize = 1;
/// Each band's three follow, lows first: its style, drive and level
pub const BAND: usize = 2;
pub const STYLE: usize = 0;
pub const DRIVE: usize = 1;
pub const LEVEL: usize = 2;
pub const MIX: usize = 11;
pub const OUTPUT: usize = 12;
pub const COUNT: usize = 13;

const NAMES: [&str; COUNT] = [
    "Low / mid",
    "Mid / high",
    "Low style",
    "Low drive",
    "Low level",
    "Mid style",
    "Mid drive",
    "Mid level",
    "High style",
    "High drive",
    "High level",
    "Mix",
    "Output",
];

/// The kinds of distortion, as fledge-dsp numbers them (0 leaves the band clean)
pub const STYLES: [&str; 7] = ["Clean", "Soft", "Warm", "Hard", "Fold", "Bias", "Tube"];
pub const MOST_DRIVE: f32 = 36.0;

fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}
/// Which of a band's three a parameter is (None for the others).
fn part(i: usize) -> Option<usize> {
    (BAND..MIX).contains(&i).then(|| (i - BAND) % 3)
}

/// A parameter's 0..1 as its own value: Hz, a style's number, dB, a fraction.
pub fn value(i: usize, v: f32) -> f32 {
    match (i, part(i)) {
        (LOW_SPLIT, _) => expo(v, 60.0, 1000.0),
        (HIGH_SPLIT, _) => expo(v, 1000.0, 12000.0),
        (_, Some(STYLE)) => (v * (STYLES.len() - 1) as f32).round(),
        (_, Some(DRIVE)) => MOST_DRIVE * v,
        (_, Some(LEVEL)) | (OUTPUT, _) => -12.0 + 24.0 * v,
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match (i, part(i)) {
        (LOW_SPLIT, _) => expo_inv(x, 60.0, 1000.0),
        (HIGH_SPLIT, _) => expo_inv(x, 1000.0, 12000.0),
        (_, Some(STYLE)) => (x / (STYLES.len() - 1) as f32).clamp(0.0, 1.0),
        (_, Some(DRIVE)) => (x / MOST_DRIVE).clamp(0.0, 1.0),
        (_, Some(LEVEL)) | (OUTPUT, _) => ((x + 12.0) / 24.0).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from the two crossovers and each band's style (by number), drive and level; all wet, output at 0 dB.
fn settings(splits: [f32; 2], bands: [[f32; 3]; 3], mix: f32) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    v[LOW_SPLIT] = normal(LOW_SPLIT, splits[0]);
    v[HIGH_SPLIT] = normal(HIGH_SPLIT, splits[1]);
    for (b, band) in bands.into_iter().enumerate() {
        for (k, x) in band.into_iter().enumerate() {
            v[BAND + b * 3 + k] = normal(BAND + b * 3 + k, x);
        }
    }
    v[MIX] = mix;
    v[OUTPUT] = normal(OUTPUT, 0.0);
    v
}

/// The settings a fresh one has: split at 200 Hz and 3 kHz, every band clean (it does nothing yet).
pub fn defaults() -> [f32; COUNT] {
    settings([200.0, 3000.0], [[0.0, 12.0, 0.0]; 3], 1.0)
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("Warm lows, clean top", settings([180.0, 3000.0], [[6.0, 14.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], 1.0)),
        ("Mid bite", settings([250.0, 4000.0], [[0.0, 0.0, 0.0], [3.0, 16.0, 0.0], [0.0, 0.0, 0.0]], 1.0)),
        ("Air and sparkle", settings([200.0, 5000.0], [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 14.0, 1.5]], 0.6)),
        ("Tape-like glue", settings([150.0, 3500.0], [[2.0, 8.0, 0.0], [2.0, 6.0, 0.0], [1.0, 8.0, 0.0]], 1.0)),
        ("Bass that speaks on small speakers", settings([120.0, 2500.0], [[6.0, 20.0, 0.0], [2.0, 8.0, 0.0], [0.0, 0.0, 0.0]], 1.0)),
        ("Torn apart", settings([200.0, 3000.0], [[3.0, 24.0, 0.0], [4.0, 22.0, -2.0], [5.0, 26.0, -3.0]], 1.0)),
    ]
}

/// One band's distortion: the shape for each side, what takes out the offset a lopsided shape
/// leaves, and its gains as they are now (they ease to their settings).
#[derive(Clone, Copy, Default)]
struct Stage {
    /// To twice the sample rate, for each side
    up: [Up2; 2],
    shaper: [Shaper; 2],
    dc: [DcBlock; 2],
    /// The style it had last block
    kind: u32,
    gain: f32,
    back: f32,
    level: f32,
}

pub struct Heat {
    sr: f32,
    pub params: [f32; COUNT],
    /// The crossovers' filters, for each side: four at the lower one, four at the upper
    low: [[Svf; 4]; 2],
    high: [[Svf; 4]; 2],
    /// What turns the lows as the upper crossover turns the other two
    turn: [[Svf; 4]; 2],
    stages: [Stage; 3],
    /// Back to the sample rate, for each side
    down: [Down2; 2],
    mix: f32,
    out: f32,
    fresh: bool,
}

impl Heat {
    /// One sample of one side split into its lows, mids and highs.
    #[inline]
    fn split(&mut self, c: usize, x: f32, lo: &SvfCoef, hi: &SvfCoef) -> [f32; 3] {
        let a = self.low[c][0].tick(lo, x);
        let low = self.low[c][1].tick(lo, a.lp).lp;
        let b = self.low[c][2].tick(lo, x);
        let rest = self.low[c][3].tick(lo, b.hp).hp;
        let m = self.high[c][0].tick(hi, rest);
        let mid = self.high[c][1].tick(hi, m.lp).lp;
        let h = self.high[c][2].tick(hi, rest);
        let high = self.high[c][3].tick(hi, h.hp).hp;
        // The mids and highs have been through the upper crossover, whose two halves add back
        // to the sound turned in phase. The lows are turned the same (both halves, added), or
        // they'd cancel against the others where the crossovers are close: 7 dB at 900 Hz with
        // them at 800 Hz and 1.2 kHz
        let a = self.turn[c][0].tick(hi, low);
        let b = self.turn[c][2].tick(hi, low);
        let low = self.turn[c][1].tick(hi, a.lp).lp + self.turn[c][3].tick(hi, b.hp).hp;
        [low, mid, high]
    }
}

impl Plugin for Heat {
    fn info() -> Info {
        Info {
            name: "Fledge Heat",
            category: "Saturation",
            about: "A saturator in three bands: lows, mids and highs each get their own kind of distortion (Soft, Warm, Hard, Fold, Bias, Tube, or left Clean), their own drive and their own level, so the bass can be warmed without the top crackling, or the top given grit without fuzzing the bass. A loud sound keeps its level as the drive goes up (more grit, not more volume); a quiet one comes up, as through any saturator: trim it with the band's level, which works on a Clean band too. Set where the bands meet with Low / mid and Mid / high; Mix blends it with the clean sound. No frames and no look-ahead, so it stays in time.",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["saturation", "distortion", "multiband", "warm", "tube", "tape", "drive"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        Heat { sr: sample_rate.max(8000.0), params: defaults(), low: [[Svf::default(); 4]; 2], high: [[Svf::default(); 4]; 2], turn: [[Svf::default(); 4]; 2], stages: [Stage::default(); 3], down: [Down2::default(); 2], mix: 1.0, out: 1.0, fresh: true }
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
        match (i, part(i)) {
            // (The upper crossover keeps half an octave and more above the lower: shown as it's used)
            (HIGH_SPLIT, _) => format!("{:.1} kHz", x.max(value(LOW_SPLIT, self.params[LOW_SPLIT]) * 1.5) / 1000.0),
            (LOW_SPLIT, _) if x >= 1000.0 => format!("{:.1} kHz", x / 1000.0),
            (LOW_SPLIT, _) => format!("{x:.0} Hz"),
            (_, Some(STYLE)) => STYLES[x as usize].to_string(),
            (_, Some(DRIVE)) => format!("{x:.1} dB"),
            (_, Some(LEVEL)) | (OUTPUT, _) => format!("{x:+.1} dB"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let sqrt2 = std::f32::consts::SQRT_2;
        let lo = SvfCoef::new(p(LOW_SPLIT), self.sr, sqrt2);
        let hi = SvfCoef::new(p(HIGH_SPLIT).max(p(LOW_SPLIT) * 1.5), self.sr, sqrt2);
        // Where each band's gains are headed
        let mut kinds = [0u32; 3];
        let mut to = [[1.0f32; 3]; 3];
        for b in 0..3 {
            kinds[b] = p(BAND + b * 3 + STYLE) as u32;
            // (A band's level is its own whatever its style: a Clean one can be turned up or down too)
            to[b][2] = 10f32.powf(p(BAND + b * 3 + LEVEL) / 20.0);
            if kinds[b] != 0 {
                let gain = 10f32.powf(p(BAND + b * 3 + DRIVE) / 20.0);
                to[b][0] = gain;
                to[b][1] = 1.0 / shaper_makeup(kinds[b], gain);
            }
            let s = &mut self.stages[b];
            if (kinds[b] == 0) != (s.kind == 0) {
                // To or from Clean: its shape starts afresh (while Clean it was passed by, and
                // what it last held would come out as a thump)
                s.shaper = [Shaper::default(); 2];
                s.dc = [DcBlock::default(); 2];
            }
            s.kind = kinds[b];
        }
        let (mix_to, out_to) = (self.params[MIX], 10f32.powf(p(OUTPUT) / 20.0));
        if self.fresh {
            // The first sound through it starts at its settings, not easing in from nothing
            for b in 0..3 {
                (self.stages[b].gain, self.stages[b].back, self.stages[b].level) = (to[b][0], to[b][1], to[b][2]);
            }
            (self.mix, self.out) = (mix_to, out_to);
            self.fresh = false;
        }
        // Gains ease over about 5 ms, so a moved slider doesn't click
        let ease = 1.0 - (-1.0 / (0.005 * self.sr)).exp();
        // (The offset a lopsided shape leaves is taken out at the doubled rate)
        let dc = 1.0 - std::f32::consts::TAU * 5.0 / (2.0 * self.sr);
        let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
        for i in 0..block.frames() {
            for b in 0..3 {
                let s = &mut self.stages[b];
                s.gain += (to[b][0] - s.gain) * ease;
                s.back += (to[b][1] - s.back) * ease;
                s.level += (to[b][2] - s.level) * ease;
            }
            self.mix += (mix_to - self.mix) * ease;
            self.out += (out_to - self.out) * ease;
            for c in 0..2 {
                let bands = self.split(c, clean(block.input[c][i]), &lo, &hi);
                // Each band at twice the rate: shaped there, and added to the others there
                let (mut dry, mut wet) = ([0.0f32; 2], [0.0f32; 2]);
                for b in 0..3 {
                    let s = &mut self.stages[b];
                    let two = s.up[c].tick(bands[b]);
                    for j in 0..2 {
                        dry[j] += two[j];
                        wet[j] += s.level * if kinds[b] == 0 { two[j] } else { s.dc[c].tick(s.shaper[c].tick(kinds[b], two[j] * s.gain), dc) * s.back };
                    }
                }
                let mixed = [dry[0] + (wet[0] - dry[0]) * self.mix, dry[1] + (wet[1] - dry[1]) * self.mix];
                block.output[c][i] = self.down[c].tick(mixed) * self.out;
            }
        }
    }

    fn settle(&mut self) {
        self.low = [[Svf::default(); 4]; 2];
        self.high = [[Svf::default(); 4]; 2];
        self.turn = [[Svf::default(); 4]; 2];
        self.stages = [Stage::default(); 3];
        self.down = [Down2::default(); 2];
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

fledge_wasm::export!(Heat);

#[cfg(test)]
mod tests;
