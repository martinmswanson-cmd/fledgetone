//! Fledge Shape: a shape that repeats in time with the song.
//!
//! Pick a shape (a duck, a fall, a rise, a gate, a trance gate's pattern, stairs, a bounce), how
//! often it repeats (from four bars to a 32nd), and what it moves: the volume, a low-pass or a
//! high-pass filter, or the pan. A duck on the volume every quarter note is the pump of a
//! sidechained kick with no kick needed; a fall on the low-pass every bar is a filter sweep; the
//! trance gate chops a pad into a rhythm; a triangle on the pan swings a sound from side to side.
//!
//! It follows the song's position (the host tells it the tempo and the beat), so the shape lands
//! on the same beats every time the song plays, live or exported; while the song is stopped it
//! runs on from where it was. Written from those plain parts, not from anyone's code. No added
//! delay.

use fledge_dsp::filter::{Svf, SvfCoef};
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const TARGET: usize = 0;
pub const SHAPE: usize = 1;
pub const RATE: usize = 2;
pub const DEPTH: usize = 3;
pub const SMOOTH: usize = 4;
pub const OFFSET: usize = 5;
pub const COUNT: usize = 6;

const NAMES: [&str; COUNT] = ["Moves", "Shape", "Every", "Depth", "Smooth", "Starts at"];

pub const TARGETS: [&str; 4] = ["Volume", "Low-pass", "High-pass", "Pan"];
pub const VOLUME: usize = 0;
pub const LOW_PASS: usize = 1;
pub const HIGH_PASS: usize = 2;
pub const PAN: usize = 3;
pub const SHAPES: [&str; 8] = ["Duck", "Fall", "Rise", "Triangle", "Gate", "Trance gate", "Stairs", "Bounce"];
pub const RATES: [&str; 10] = ["4 bars", "2 bars", "1 bar", "1/2", "1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
/// Each rate's length in beats (a bar counted as four: the host doesn't say the meter)
const RATE_BEATS: [f64; 10] = [16.0, 8.0, 4.0, 2.0, 1.0, 0.5, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125];
/// The trance gate: sixteen steps, open or shut
const TRANCE: [u8; 16] = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
const MIN_BPM: f32 = 20.0;
/// The filter is worked out again this often, in samples (the same whatever the block size)
const EVERY: usize = 16;
/// The longest the Smooth takes
const SMOOTH_MAX_S: f32 = 0.05;

/// A shape's height (0 shut or down, 1 open or untouched) at `phase` of its cycle, 0 to 1.
pub fn shape(kind: usize, phase: f32) -> f32 {
    let ph = phase.clamp(0.0, 1.0);
    match kind {
        // Down at once, back up by seven tenths of the way (a kick's pump)
        0 => {
            let x = (ph / 0.7).min(1.0);
            x * x * (3.0 - 2.0 * x)
        }
        1 => 1.0 - ph,
        2 => ph,
        3 => 1.0 - (2.0 * ph - 1.0).abs(),
        4 => (ph < 0.5) as u8 as f32,
        5 => {
            let step = (ph * 16.0).min(15.999);
            ((TRANCE[step as usize] == 1) && step.fract() < 0.7) as u8 as f32
        }
        6 => 1.0 - (ph * 4.0).min(3.999).floor() / 3.0,
        _ => (std::f32::consts::PI * 3.0 * ph).cos().abs() * (1.0 - ph),
    }
}

/// A parameter's 0..1 as its own value: a choice's number, or a fraction.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        TARGET => (v * (TARGETS.len() - 1) as f32).round(),
        SHAPE => (v * (SHAPES.len() - 1) as f32).round(),
        RATE => (v * (RATES.len() - 1) as f32).round(),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        TARGET => (x / (TARGETS.len() - 1) as f32).clamp(0.0, 1.0),
        SHAPE => (x / (SHAPES.len() - 1) as f32).clamp(0.0, 1.0),
        RATE => (x / (RATES.len() - 1) as f32).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    let mut v = [0.0; COUNT];
    for (i, x) in values.into_iter().enumerate() {
        v[i] = normal(i, x);
    }
    v
}

/// The settings a fresh one has: the volume ducking every quarter note, by 70 %.
pub fn defaults() -> [f32; COUNT] {
    settings([0.0, 0.0, 4.0, 0.7, 0.2, 0.0])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 8] {
    [
        ("Pump on every beat", settings([0.0, 0.0, 4.0, 0.8, 0.2, 0.0])),
        ("Pump on the off-beat", settings([0.0, 0.0, 4.0, 0.8, 0.2, 0.5])),
        ("Trance gate", settings([0.0, 5.0, 2.0, 1.0, 0.1, 0.0])),
        ("Chop in 16ths", settings([0.0, 4.0, 7.0, 1.0, 0.1, 0.0])),
        ("Filter falls every bar", settings([1.0, 1.0, 2.0, 0.8, 0.3, 0.0])),
        ("Filter opens over four bars", settings([1.0, 2.0, 0.0, 0.9, 0.3, 0.0])),
        ("Thin, then full, every half bar", settings([2.0, 2.0, 3.0, 0.7, 0.3, 0.0])),
        ("Side to side", settings([3.0, 3.0, 2.0, 1.0, 0.5, 0.0])),
    ]
}

pub struct Shape {
    sr: f32,
    pub params: [f32; COUNT],
    tempo: f32,
    /// Where the song is, in beats: told by the host, counted on between its tellings
    beat: f64,
    /// The shape's height as it is now (it eases there: the Smooth)
    height: f32,
    filters: [Svf; 2],
    coef: SvfCoef,
    until: usize,
    target: usize,
    fresh: bool,
}

impl Shape {
    /// The shape's height now, 0 to 1: for a display.
    pub fn height(&self) -> f32 {
        self.height
    }
}

impl Plugin for Shape {
    fn info() -> Info {
        Info {
            name: "Fledge Shape",
            category: "Modulation",
            about: "A shape that repeats in time with the song, moving the volume, a low-pass or high-pass filter, or the pan. Pick the shape (Duck, Fall, Rise, Triangle, Gate, Trance gate, Stairs, Bounce) and how often it repeats, from four bars to a 32nd. A Duck on the volume every quarter note is a sidechain pump with no kick needed; a Fall on the low-pass every bar is a sweep; the Trance gate chops a pad into a rhythm; a Triangle on the pan swings it side to side. Depth is how far it goes, Smooth rounds its corners, and \"Starts at\" slides it along the beat. It follows the song's position, so it lands the same every time. No added delay.",
            instrument: false,
            sidechain: false,
            transport: true,
            tags: &["pump", "volume shaper", "trance gate", "filter sweep", "auto pan", "tremolo", "lfo", "rhythm", "tempo"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        Shape { sr: sample_rate.max(8000.0), params: defaults(), tempo: 120.0, beat: 0.0, height: 1.0, filters: [Svf::default(); 2], coef: SvfCoef::default(), until: 0, target: 0, fresh: true }
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
            TARGET => TARGETS[x as usize].to_string(),
            SHAPE => SHAPES[x as usize].to_string(),
            RATE => RATES[x as usize].to_string(),
            SMOOTH => format!("{:.0} ms", 1.0 + x * SMOOTH_MAX_S * 1000.0),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let (target, kind) = (p(TARGET) as usize, p(SHAPE) as usize);
        let cycle = RATE_BEATS[p(RATE) as usize];
        let (depth, offset) = (p(DEPTH), p(OFFSET) as f64);
        // (Never less than a millisecond: a gate's edge mustn't click)
        let ease = 1.0 - (-1.0 / ((0.001 + p(SMOOTH) * SMOOTH_MAX_S) * self.sr)).exp();
        let beats_a_sample = self.tempo.max(MIN_BPM) as f64 / 60.0 / self.sr as f64;
        if target != self.target {
            self.target = target;
            self.filters = [Svf::default(); 2];
            self.until = 0;
        }
        let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
        for i in 0..block.frames() {
            // (A hair past the beat: counted a sample at a time it lands a hair short as often as on it)
            let phase = ((self.beat + 1e-7) / cycle + offset).fract() as f32;
            let to = 1.0 - depth * (1.0 - shape(kind, phase));
            if self.fresh {
                // The first sound through starts where the shape is, not easing in from open
                self.height = to;
                self.fresh = false;
            }
            self.height += (to - self.height) * ease;
            let h = self.height;
            let (l, r) = (clean(block.input[0][i]), clean(block.input[1][i]));
            let (yl, yr) = match target {
                VOLUME => (l * h, r * h),
                PAN => {
                    // Height 1 is hard right, 0 hard left, a half the middle: a side is only ever turned down
                    // (At no depth the shape's height stays at 1: that's the middle here, not the right)
                    let pos = if depth == 0.0 { 0.0 } else { (2.0 * (h - (1.0 - depth)) / depth - 1.0) * depth };
                    (l * (1.0 - pos).min(1.0), r * (1.0 + pos).min(1.0))
                }
                _ => {
                    if self.until == 0 {
                        // Fully open, the low-pass sits at 20 kHz and the high-pass at 20 Hz
                        let hz = if target == LOW_PASS { 200.0 * 100f32.powf(h) } else { 20.0 * 200f32.powf(1.0 - h) };
                        self.coef = SvfCoef::new(hz, self.sr, std::f32::consts::SQRT_2);
                        self.until = EVERY;
                    }
                    self.until -= 1;
                    let (a, b) = (self.filters[0].tick(&self.coef, l), self.filters[1].tick(&self.coef, r));
                    if target == LOW_PASS {
                        (a.lp, b.lp)
                    } else {
                        (a.hp, b.hp)
                    }
                }
            };
            block.output[0][i] = yl;
            block.output[1][i] = yr;
            self.beat += beats_a_sample;
        }
    }

    fn set_tempo(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 0.0 {
            self.tempo = bpm;
        }
    }

    fn set_position(&mut self, beats: f64) {
        // (Under 0: the song has stopped. It runs on from where it was, so it can still be heard)
        if beats.is_finite() && beats >= 0.0 {
            self.beat = beats;
        }
    }

    fn settle(&mut self) {
        self.filters = [Svf::default(); 2];
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

fledge_wasm::export!(Shape);

#[cfg(test)]
mod tests;
