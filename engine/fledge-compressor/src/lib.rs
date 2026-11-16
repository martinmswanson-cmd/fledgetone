//! Fledge Compressor: a clean stereo compressor that can be keyed from a sidechain.
//!
//! With nothing connected to its sidechain it follows its own input, as any compressor does.
//! With another track connected it follows that instead: the bass ducking under the kick, the
//! music under a voice. Written from the textbook design (a soft-knee gain computer in decibels,
//! then the gain smoothed with separate attack and release times: Giannoulis, Massberg & Reiss,
//! "Digital Dynamic Range Compressor Design", 2012), not from anyone's code.
//!
//! No look-ahead, so it adds no delay. The two channels share one gain, so the stereo picture
//! doesn't move.

use fledge_dsp::filter::{Svf, SvfCoef};
use fledge_dsp::math::flush;
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const THRESHOLD: usize = 0;
pub const RATIO: usize = 1;
pub const ATTACK: usize = 2;
pub const RELEASE: usize = 3;
pub const KNEE: usize = 4;
pub const MAKEUP: usize = 5;
pub const KEY_HIGH_PASS: usize = 6;
pub const MIX: usize = 7;
pub const KEY_LISTEN: usize = 8;
pub const COUNT: usize = 9;

const NAMES: [&str; COUNT] = ["Threshold", "Ratio", "Attack", "Release", "Knee", "Make-up", "Key high-pass", "Mix", "Key listen"];

/// The lowest key high-pass: at this setting the filter is out of the path.
const KEY_HP_OFF: f32 = 20.0;

fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}

/// A parameter's 0..1 as its own value: dB, a ratio, milliseconds, Hz, a fraction.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        THRESHOLD => -60.0 + 60.0 * v,
        RATIO => expo(v, 1.0, 20.0),
        ATTACK => expo(v, 0.1, 200.0),
        RELEASE => expo(v, 10.0, 2000.0),
        KNEE => 24.0 * v,
        MAKEUP => 24.0 * v,
        KEY_HIGH_PASS => expo(v, KEY_HP_OFF, 1000.0),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        THRESHOLD => ((x + 60.0) / 60.0).clamp(0.0, 1.0),
        RATIO => expo_inv(x, 1.0, 20.0),
        ATTACK => expo_inv(x, 0.1, 200.0),
        RELEASE => expo_inv(x, 10.0, 2000.0),
        KNEE | MAKEUP => (x / 24.0).clamp(0.0, 1.0),
        KEY_HIGH_PASS => expo_inv(x, KEY_HP_OFF, 1000.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// The settings a fresh compressor has: threshold -18 dB, 4:1, 10 ms, 120 ms, a 6 dB knee.
pub fn defaults() -> [f32; COUNT] {
    settings(-18.0, 4.0, 10.0, 120.0, 6.0, 0.0, KEY_HP_OFF)
}

fn settings(threshold: f32, ratio: f32, attack: f32, release: f32, knee: f32, makeup: f32, key_hp: f32) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    for (i, x) in [(THRESHOLD, threshold), (RATIO, ratio), (ATTACK, attack), (RELEASE, release), (KNEE, knee), (MAKEUP, makeup), (KEY_HIGH_PASS, key_hp)] {
        v[i] = normal(i, x);
    }
    v[MIX] = 1.0;
    v
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 5] {
    [
        ("Gentle glue", settings(-20.0, 2.0, 30.0, 250.0, 12.0, 2.0, KEY_HP_OFF)),
        ("Duck under the kick", settings(-30.0, 8.0, 1.0, 140.0, 6.0, 0.0, KEY_HP_OFF)),
        ("Music under a voice", settings(-34.0, 3.0, 40.0, 600.0, 12.0, 0.0, 150.0)),
        ("Hard pump", settings(-40.0, 20.0, 0.3, 220.0, 0.0, 0.0, KEY_HP_OFF)),
        ("Tight drums", settings(-16.0, 4.0, 15.0, 80.0, 4.0, 3.0, 80.0)),
    ]
}

/// How many dB the gain computer takes off a level of `level_db` (0 or less): nothing below the
/// knee, the full ratio above it, and a smooth curve between.
#[inline]
pub fn reduction_db(level_db: f32, threshold: f32, ratio: f32, knee: f32) -> f32 {
    let over = level_db - threshold;
    let slope = 1.0 / ratio - 1.0;
    if 2.0 * over <= -knee {
        0.0
    } else if 2.0 * over >= knee {
        slope * over
    } else {
        slope * (over + knee * 0.5) * (over + knee * 0.5) / (2.0 * knee)
    }
}

pub struct Compressor {
    sr: f32,
    pub params: [f32; COUNT],
    /// The gain reduction now, in dB (0 or less)
    reduction: f32,
    /// Make-up gain and mix as they are now (they ease to their settings, so a knob doesn't zip)
    makeup: f32,
    mix: f32,
    /// Nothing has been processed since it was made or settled: the eased values start at their settings
    fresh: bool,
    key_hp: [Svf; 2],
}

impl Compressor {
    /// The gain reduction at this moment, in dB (0 or less): for a meter.
    pub fn reduction(&self) -> f32 {
        self.reduction
    }
}

impl Plugin for Compressor {
    fn info() -> Info {
        Info {
            name: "Fledge Compressor",
            category: "Dynamics",
            about: "A clean stereo compressor with a sidechain: pick another track under \"Sidechain from\" and this one ducks to it (a bass under the kick, the music under a voice). With no sidechain it follows its own sound. Soft knee, a high-pass on what it listens to, parallel mix, no added delay.",
            instrument: false,
            sidechain: true,
            transport: false,
            tags: &["compressor", "sidechain", "ducking", "glue"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        Compressor { sr: sample_rate.max(8000.0), params: defaults(), reduction: 0.0, makeup: 1.0, mix: 1.0, fresh: true, key_hp: [Svf::default(); 2] }
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
            THRESHOLD | KNEE | MAKEUP => format!("{x:.1} dB"),
            RATIO => format!("{x:.1}:1"),
            ATTACK | RELEASE if x < 10.0 => format!("{x:.1} ms"),
            ATTACK | RELEASE => format!("{x:.0} ms"),
            KEY_HIGH_PASS if x <= KEY_HP_OFF * 1.001 => "Off".to_string(),
            KEY_HIGH_PASS => format!("{x:.0} Hz"),
            MIX => format!("{:.0} %", x * 100.0),
            _ => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let (threshold, ratio, knee) = (p(THRESHOLD), p(RATIO), p(KNEE));
        // (The gain gets about 63 % of the way in the time set)
        let attack = (-1.0 / (p(ATTACK) * 0.001 * self.sr)).exp();
        let release = (-1.0 / (p(RELEASE) * 0.001 * self.sr)).exp();
        let makeup_to = 10f32.powf(p(MAKEUP) / 20.0);
        let mix_to = p(MIX);
        let listen = self.params[KEY_LISTEN] >= 0.5;
        let hp_hz = p(KEY_HIGH_PASS);
        let hp = if hp_hz > KEY_HP_OFF * 1.001 { Some(SvfCoef::new(hp_hz, self.sr, std::f32::consts::SQRT_2)) } else { None };
        if hp.is_none() {
            self.key_hp = [Svf::default(); 2];
        }
        if self.fresh {
            (self.makeup, self.mix, self.fresh) = (makeup_to, mix_to, false);
        }
        // Make-up and mix ease over about 10 ms
        let ease = 1.0 - (-1.0 / (0.010 * self.sr)).exp();
        let key = block.sidechain.unwrap_or(block.input);
        for i in 0..block.frames() {
            let (l, r) = (block.input[0][i], block.input[1][i]);
            let (mut kl, mut kr) = (key[0][i], key[1][i]);
            if let Some(c) = &hp {
                kl = self.key_hp[0].tick(c, kl).hp;
                kr = self.key_hp[1].tick(c, kr).hp;
            }
            let level = kl.abs().max(kr.abs());
            let want = if level > 1e-6 { reduction_db(20.0 * level.log10(), threshold, ratio, knee) } else { 0.0 };
            // More reduction comes on at the attack time; it lets go at the release time
            let c = if want < self.reduction { attack } else { release };
            self.reduction = flush(want + (self.reduction - want) * c);
            self.makeup += (makeup_to - self.makeup) * ease;
            self.mix += (mix_to - self.mix) * ease;
            let wet = 10f32.powf(self.reduction / 20.0) * self.makeup;
            let g = 1.0 + (wet - 1.0) * self.mix;
            if listen {
                block.output[0][i] = kl;
                block.output[1][i] = kr;
            } else {
                block.output[0][i] = l * g;
                block.output[1][i] = r * g;
            }
        }
    }

    fn settle(&mut self) {
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

fledge_wasm::export!(Compressor);

#[cfg(test)]
mod tests;
