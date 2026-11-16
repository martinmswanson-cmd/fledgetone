//! Fledge Shifter: a frequency shifter.
//!
//! A pitch shifter multiplies every frequency by the same amount, so a note stays a note. A
//! frequency shifter *adds* the same number of hertz to every frequency: a note's overtones are no
//! longer whole multiples of it, and it turns from a note into something bell-like and metallic.
//! Shifted by a hertz or two and mixed with itself, it becomes a slow phasing that only ever
//! rises (or only falls); fed back through a delay, each echo is shifted again and the sound
//! spirals away.
//!
//! How: the sound is split into two copies a quarter turn apart at every frequency (a pair of
//! all-pass filter chains: a Hilbert transformer), which are multiplied by a sine and a cosine at
//! the shift and added, leaving only the upper or the lower sideband. The all-pass coefficients
//! are Olli Niemitalo's published design ("Hilbert transform", yehar.com); the rest is the
//! textbook single-sideband form, not anyone's code. No added delay to speak of (one sample).

use fledge_dsp::delay::Line;
use fledge_dsp::math::flush;
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const SHIFT: usize = 0;
pub const SPREAD: usize = 1;
pub const FEEDBACK: usize = 2;
pub const DELAY: usize = 3;
pub const MIX: usize = 4;
pub const COUNT: usize = 5;

const NAMES: [&str; COUNT] = ["Shift", "Spread", "Feedback", "Delay", "Mix"];

/// The furthest it shifts, either way
const SHIFT_MAX: f32 = 2000.0;
/// The most that is fed back
const FEEDBACK_MAX: f32 = 0.9;
const DELAY_MIN_MS: f32 = 1.0;
const DELAY_MAX_MS: f32 = 500.0;

/// A parameter's 0..1 as its own value: hertz, a fraction, milliseconds.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        // (Finer near the middle, where a hertz matters: the slider's cube)
        SHIFT => {
            let s = 2.0 * v - 1.0;
            SHIFT_MAX * s * s * s
        }
        FEEDBACK => FEEDBACK_MAX * v,
        DELAY => DELAY_MIN_MS * (DELAY_MAX_MS / DELAY_MIN_MS).powf(v),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        SHIFT => (0.5 + 0.5 * (x / SHIFT_MAX).clamp(-1.0, 1.0).cbrt()).clamp(0.0, 1.0),
        FEEDBACK => (x / FEEDBACK_MAX).clamp(0.0, 1.0),
        DELAY => ((x / DELAY_MIN_MS).ln() / (DELAY_MAX_MS / DELAY_MIN_MS).ln()).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    std::array::from_fn(|i| normal(i, values[i]))
}

/// The settings a fresh one has: up 100 Hz, both sides the same, no feedback, all shifted.
pub fn defaults() -> [f32; COUNT] {
    settings([100.0, 0.0, 0.0, 20.0, 1.0])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("Metallic", settings([100.0, 0.0, 0.0, 20.0, 1.0])),
        ("Endless phasing, rising", settings([0.4, 0.0, 0.0, 20.0, 0.5])),
        ("Endless phasing, falling", settings([-0.4, 0.0, 0.0, 20.0, 0.5])),
        ("Wide and uneasy", settings([6.0, 1.0, 0.0, 20.0, 1.0])),
        ("Spiralling echoes", settings([35.0, 0.5, 0.65, 180.0, 0.45])),
        ("Bell tones", settings([-340.0, 0.0, 0.3, 12.0, 1.0])),
    ]
}

/// The two all-pass chains' coefficients (each is squared in its section): through them a sound
/// comes out twice, the copies a quarter turn apart to within 0.7 of a degree from 0.002 to 0.498
/// of the sample rate (and within a degree down to 24 Hz at 48 kHz).
const AHEAD: [f64; 4] = [0.692_387_8, 0.936_065_432_295_9, 0.988_229_522_686_0, 0.998_748_845_273_7];
const BEHIND: [f64; 4] = [0.402_192_116_242_6, 0.856_171_088_242_0, 0.972_290_954_565_1, 0.995_288_479_127_8];

/// One all-pass section: y[n] = a² (x[n] + y[n-2]) - x[n-2]
#[derive(Clone, Copy, Default)]
struct Section {
    x: [f64; 2],
    y: [f64; 2],
}

impl Section {
    #[inline]
    fn tick(&mut self, a: f64, x: f64) -> f64 {
        let y = a * a * (x + self.y[1]) - self.x[1];
        self.x = [x, self.x[0]];
        self.y = [if y.abs() < 1e-30 { 0.0 } else { y }, self.y[0]];
        y
    }
}

/// A sound as two copies a quarter turn apart (a Hilbert transformer).
#[derive(Clone, Copy, Default)]
struct Quarter {
    ahead: [Section; 4],
    behind: [Section; 4],
    /// The first chain's output a sample ago (it runs one sample behind the other)
    held: f64,
}

impl Quarter {
    #[inline]
    fn tick(&mut self, x: f64) -> (f64, f64) {
        let mut a = x;
        let mut b = x;
        for k in 0..4 {
            a = self.ahead[k].tick(AHEAD[k], a);
            b = self.behind[k].tick(BEHIND[k], b);
        }
        let out = (self.held, b);
        self.held = a;
        out
    }
}

pub struct Shifter {
    sr: f32,
    pub params: [f32; COUNT],
    quarter: [Quarter; 2],
    /// Where each side's sine and cosine are in their turn (0..1)
    phase: [f64; 2],
    /// What is fed back: each side's shifted sound, delayed
    echo: [Line; 2],
    /// The settings as they are now (they ease to where they're set: no zip, no click)
    shift: f32,
    delay: f32,
    mix: f32,
    fresh: bool,
}

impl Plugin for Shifter {
    fn info() -> Info {
        Info {
            name: "Fledge Shifter",
            category: "Effects",
            about: "A frequency shifter: every frequency is moved by the same number of hertz (a pitch shifter multiplies them), so a note's overtones go out of tune with it and it turns bell-like and metallic. A hertz or less, mixed half and half, is a phasing that only ever rises or falls; Spread shifts the right side the other way; Feedback through the Delay shifts each echo again, spiralling up or down.",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["frequency shifter", "shift", "phasing", "barber pole", "metallic", "bell"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        let room = (DELAY_MAX_MS * 0.001 * sr) as usize + 8;
        Shifter { sr, params: defaults(), quarter: [Quarter::default(); 2], phase: [0.0; 2], echo: [Line::new(room), Line::new(room)], shift: 0.0, delay: 0.0, mix: 1.0, fresh: true }
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
            SHIFT if x.abs() < 10.0 => format!("{x:+.2} Hz"),
            SHIFT if x.abs() < 100.0 => format!("{x:+.1} Hz"),
            SHIFT => format!("{x:+.0} Hz"),
            DELAY if x < 10.0 => format!("{x:.1} ms"),
            DELAY => format!("{x:.0} ms"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let (shift_to, delay_to, mix_to) = (p(SHIFT), p(DELAY) * 0.001 * self.sr, p(MIX));
        // The right side's shift against the left's: the same at 0 %, none at 50 %, opposite at 100 %
        let right = 1.0 - 2.0 * p(SPREAD);
        let feedback = p(FEEDBACK);
        if self.fresh {
            (self.shift, self.delay, self.mix, self.fresh) = (shift_to, delay_to, mix_to, false);
        }
        let ease = 1.0 - (-1.0 / (0.020 * self.sr)).exp();
        // (The delay moves slowly: a fast move would bend the echoes' pitch)
        let slow = 1.0 - (-1.0 / (0.150 * self.sr)).exp();
        for i in 0..block.frames() {
            self.shift += (shift_to - self.shift) * ease;
            self.delay += (delay_to - self.delay) * slow;
            self.mix += (mix_to - self.mix) * ease;
            for ch in 0..2 {
                let dry = block.input[ch][i];
                let back = self.echo[ch].read(self.delay);
                let (a, b) = self.quarter[ch].tick(dry as f64 + (feedback * back) as f64);
                let hz = self.shift as f64 * if ch == 0 { 1.0 } else { right as f64 };
                self.phase[ch] = (self.phase[ch] + hz / self.sr as f64).rem_euclid(1.0);
                let turn = std::f64::consts::TAU * self.phase[ch];
                // The upper sideband (the lower, for a shift down: the sine's sign turns with it)
                let wet = (a * turn.cos() + b * turn.sin()) as f32;
                // (Held within reason: a long feedback at a tiny shift adds up)
                self.echo[ch].push(flush(wet.clamp(-8.0, 8.0)));
                block.output[ch][i] = dry + (wet - dry) * self.mix;
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

fledge_wasm::export!(Shifter);

#[cfg(test)]
mod tests;
