//! Fledge Gate: a gate that can open on a sidechain.
//!
//! A gate lets a sound through while what it listens to is louder than the threshold, and turns
//! it down (by the Range) while it isn't. Listening to its own input it cleans up a recording:
//! the hiss between phrases, the spill between drum hits. Listening to another track (the
//! sidechain) it chops one sound to the rhythm of another: a pad that only sounds on the hats, a
//! bass that only sounds with the kick. Flipped, it does the opposite: closes while the other
//! track sounds.
//!
//! Written from the textbook form (a peak follower, a threshold with hysteresis so it doesn't
//! chatter, a hold time, and the gain eased open and shut), not from anyone's code. No look-ahead,
//! so it adds no delay; one gain for both channels.

use fledge_dsp::filter::{Svf, SvfCoef};
use fledge_dsp::math::flush;
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const THRESHOLD: usize = 0;
pub const RANGE: usize = 1;
pub const ATTACK: usize = 2;
pub const HOLD: usize = 3;
pub const RELEASE: usize = 4;
pub const HYSTERESIS: usize = 5;
pub const KEY_HIGH_PASS: usize = 6;
pub const FLIP: usize = 7;
pub const KEY_LISTEN: usize = 8;
pub const COUNT: usize = 9;

const NAMES: [&str; COUNT] = ["Threshold", "Range", "Attack", "Hold", "Release", "Hysteresis", "Key high-pass", "Flip", "Key listen"];

/// The lowest key high-pass: at this setting the filter is out of the path.
const KEY_HP_OFF: f32 = 20.0;
/// At the top of the Range the gate shuts completely.
const RANGE_MAX: f32 = 80.0;

fn expo(v: f32, lo: f32, hi: f32) -> f32 {
    lo * (hi / lo).powf(v)
}
fn expo_inv(x: f32, lo: f32, hi: f32) -> f32 {
    ((x / lo).ln() / (hi / lo).ln()).clamp(0.0, 1.0)
}

/// A parameter's 0..1 as its own value: dB, milliseconds, Hz, or 0 and 1 for a switch.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        THRESHOLD => -80.0 + 80.0 * v,
        RANGE => RANGE_MAX * v,
        ATTACK => expo(v, 0.1, 100.0),
        HOLD => 500.0 * v * v,
        RELEASE => expo(v, 5.0, 2000.0),
        HYSTERESIS => 12.0 * v,
        KEY_HIGH_PASS => expo(v, KEY_HP_OFF, 1000.0),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        THRESHOLD => ((x + 80.0) / 80.0).clamp(0.0, 1.0),
        RANGE => (x / RANGE_MAX).clamp(0.0, 1.0),
        ATTACK => expo_inv(x, 0.1, 100.0),
        HOLD => (x / 500.0).clamp(0.0, 1.0).sqrt(),
        RELEASE => expo_inv(x, 5.0, 2000.0),
        HYSTERESIS => (x / 12.0).clamp(0.0, 1.0),
        KEY_HIGH_PASS => expo_inv(x, KEY_HP_OFF, 1000.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order up to the key's high-pass, and the flip.
fn settings(values: [f32; 7], flip: bool) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    for (i, x) in values.into_iter().enumerate() {
        v[i] = normal(i, x);
    }
    v[FLIP] = if flip { 1.0 } else { 0.0 };
    v
}

/// The settings a fresh gate has: threshold -40 dB, shut completely, 1 ms open, 30 ms hold, 120 ms shut.
pub fn defaults() -> [f32; COUNT] {
    settings([-40.0, RANGE_MAX, 1.0, 30.0, 120.0, 3.0, KEY_HP_OFF], false)
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 5] {
    [
        ("Clean up a recording", settings([-45.0, 30.0, 2.0, 80.0, 250.0, 4.0, KEY_HP_OFF], false)),
        ("Tight drums", settings([-30.0, RANGE_MAX, 0.3, 20.0, 80.0, 3.0, KEY_HP_OFF], false)),
        ("Chop to the other track", settings([-30.0, RANGE_MAX, 1.0, 10.0, 60.0, 3.0, KEY_HP_OFF], false)),
        ("Chop to the hats", settings([-36.0, RANGE_MAX, 0.5, 5.0, 40.0, 3.0, 1000.0], false)),
        ("Silence under the other track", settings([-30.0, RANGE_MAX, 5.0, 30.0, 150.0, 3.0, KEY_HP_OFF], true)),
    ]
}

pub struct Gate {
    sr: f32,
    pub params: [f32; COUNT],
    /// What it listens to, followed: up at once, down over a few milliseconds (so a low note's
    /// own wave doesn't open and shut it)
    level: f32,
    /// Open (what it listens to is over the threshold, or was within the hold time)
    open: bool,
    /// Samples since the level last was over the closing threshold
    since: f32,
    /// The gain now (the floor the Range sets, up to 1)
    gain: f32,
    key_hp: [Svf; 2],
}

impl Gate {
    /// Whether the gate is letting the sound through now (after a flip: whether it's up).
    pub fn is_open(&self) -> bool {
        self.open != (self.params[FLIP] >= 0.5)
    }
    /// The gain now, 0 to 1: for a meter.
    pub fn gain(&self) -> f32 {
        self.gain
    }
}

impl Plugin for Gate {
    fn info() -> Info {
        Info {
            name: "Fledge Gate",
            category: "Dynamics",
            about: "A gate with a sidechain: it lets this track through while what it listens to is over the threshold, and turns it down by the Range while it isn't. By itself it cleans up a recording. Pick another track under \"Sidechain from\" and this track is chopped to that one's rhythm (a pad on the hats, a bass with the kick); Flip silences it under the other track instead. Hold and hysteresis keep it from chattering; no added delay.",
            instrument: false,
            sidechain: true,
            transport: false,
            tags: &["gate", "sidechain", "chop", "noise gate"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        Gate { sr: sample_rate.max(8000.0), params: defaults(), level: 0.0, open: false, since: f32::MAX, gain: 0.0, key_hp: [Svf::default(); 2] }
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
            RANGE if x >= RANGE_MAX - 0.05 => "Shut".to_string(),
            THRESHOLD | RANGE | HYSTERESIS => format!("{x:.1} dB"),
            ATTACK | HOLD | RELEASE if x < 10.0 => format!("{x:.1} ms"),
            ATTACK | HOLD | RELEASE => format!("{x:.0} ms"),
            KEY_HIGH_PASS if x <= KEY_HP_OFF * 1.001 => "Off".to_string(),
            KEY_HIGH_PASS => format!("{x:.0} Hz"),
            _ => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let opens_at = 10f32.powf(p(THRESHOLD) / 20.0);
        let shuts_at = 10f32.powf((p(THRESHOLD) - p(HYSTERESIS)) / 20.0);
        let range = p(RANGE);
        let floor = if range >= RANGE_MAX - 0.05 { 0.0 } else { 10f32.powf(-range / 20.0) };
        // (The gain gets about 63 % of the way in the time set)
        let attack = 1.0 - (-1.0 / (p(ATTACK) * 0.001 * self.sr)).exp();
        let release = 1.0 - (-1.0 / (p(RELEASE) * 0.001 * self.sr)).exp();
        let hold = p(HOLD) * 0.001 * self.sr;
        // What it listens to falls away over 5 ms: longer than half a wave of anything above 100 Hz
        let fall = (-1.0 / (0.005 * self.sr)).exp();
        let flip = self.params[FLIP] >= 0.5;
        let listen = self.params[KEY_LISTEN] >= 0.5;
        let hp_hz = p(KEY_HIGH_PASS);
        let hp = if hp_hz > KEY_HP_OFF * 1.001 { Some(SvfCoef::new(hp_hz, self.sr, std::f32::consts::SQRT_2)) } else { None };
        if hp.is_none() {
            self.key_hp = [Svf::default(); 2];
        }
        let key = block.sidechain.unwrap_or(block.input);
        for i in 0..block.frames() {
            let (mut kl, mut kr) = (key[0][i], key[1][i]);
            if let Some(c) = &hp {
                kl = self.key_hp[0].tick(c, kl).hp;
                kr = self.key_hp[1].tick(c, kr).hp;
            }
            let now = kl.abs().max(kr.abs());
            // (A sample that isn't a number counts as silence: it mustn't stick in the follower)
            let now = if now.is_finite() { now } else { 0.0 };
            self.level = flush(now.max(self.level * fall));
            if self.level >= opens_at {
                self.open = true;
                self.since = 0.0;
            } else if self.level >= shuts_at && self.open {
                self.since = 0.0;
            } else if self.open {
                self.since += 1.0;
                if self.since > hold {
                    self.open = false;
                }
            }
            let to = if self.open != flip { 1.0 } else { floor };
            let c = if to > self.gain { attack } else { release };
            self.gain = flush(self.gain + (to - self.gain) * c);
            if listen {
                block.output[0][i] = kl;
                block.output[1][i] = kr;
            } else {
                block.output[0][i] = block.input[0][i] * self.gain;
                block.output[1][i] = block.input[1][i] * self.gain;
            }
        }
    }

    fn settle(&mut self) {
        // Straight to where the new settings put it (not swelling in from the old sound's gain)
        let p = |i: usize| value(i, self.params[i]);
        let floor = if p(RANGE) >= RANGE_MAX - 0.05 { 0.0 } else { 10f32.powf(-p(RANGE) / 20.0) };
        self.gain = if self.open != (self.params[FLIP] >= 0.5) { 1.0 } else { floor };
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

fledge_wasm::export!(Gate);

#[cfg(test)]
mod tests;
