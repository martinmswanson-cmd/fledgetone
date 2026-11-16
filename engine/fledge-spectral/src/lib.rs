//! Fledge Spectral: work on a sound by its spectrum.
//!
//! The sound is cut into short overlapping frames, each taken apart into how loud and where in
//! its cycle every frequency is (a short-time Fourier transform), changed there, and put back
//! together. Four things can be done to it, alone or together:
//!
//! - **Gate**: frequencies quieter than a threshold are taken out, each on its own. Unlike an
//!   ordinary gate, hiss under a held note goes while the note stays.
//! - **Blur**: each frequency's loudness is smoothed over time, so the sound smears into a wash
//!   that lingers after it stops.
//! - **Smear**: each frequency's loudness is spread over its neighbours, so pitches lose their
//!   edges and turn breathy.
//! - **Freeze**: a switch. While it's on, the spectrum of that moment is held and goes on
//!   sounding, each frequency turning at the rate it had, for as long as it's held.
//!
//! Written from the textbook form (a phase vocoder's analysis and overlap-add resynthesis), not
//! from anyone's code. Taking a sound apart this way needs a whole frame of it first, so what
//! comes out is one frame late: 2048 samples up to 48 kHz (43 ms at 48 kHz), 4096 above. The dry
//! part of the Mix is held back by the same, so the two stay in step with each other.

use fledge_dsp::fft::fft;
use fledge_dsp::math::Rng;
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const FREEZE: usize = 0;
pub const GATE: usize = 1;
pub const BLUR: usize = 2;
pub const SMEAR: usize = 3;
pub const MIX: usize = 4;
pub const COUNT: usize = 5;

const NAMES: [&str; COUNT] = ["Freeze", "Gate", "Blur", "Smear", "Mix"];

/// The gate's lowest threshold: at it (the bottom of the slider) the gate is off
const GATE_OFF_DB: f32 = -90.0;
/// How far over the threshold a frequency is before it's let through whole (it fades in between)
const GATE_KNEE_DB: f32 = 6.0;
/// The longest the blur lingers (how long a frequency takes to fall about 9 dB)
const BLUR_MAX_S: f32 = 3.0;
/// The widest the smear spreads a frequency, either way, as a share of the frequencies there are
const SMEAR_MAX: f32 = 0.03;

/// A parameter's 0..1 as its own value: a switch, dB, a fraction.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        GATE => GATE_OFF_DB - GATE_OFF_DB * v,
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        GATE => ((x - GATE_OFF_DB) / -GATE_OFF_DB).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    std::array::from_fn(|i| normal(i, values[i]))
}

/// The settings a fresh one has: nothing done to the sound yet (it passes, one frame late).
pub fn defaults() -> [f32; COUNT] {
    settings([0.0, GATE_OFF_DB, 0.0, 0.0, 1.0])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("Freeze when switched on", settings([0.0, GATE_OFF_DB, 0.0, 0.0, 1.0])),
        ("Wash", settings([0.0, GATE_OFF_DB, 0.7, 0.0, 0.6])),
        ("Take out the hiss", settings([0.0, -60.0, 0.0, 0.0, 1.0])),
        ("Only the loud parts", settings([0.0, -34.0, 0.0, 0.0, 1.0])),
        ("Breath", settings([0.0, GATE_OFF_DB, 0.25, 0.6, 1.0])),
        ("Ghost", settings([0.0, -50.0, 0.85, 0.3, 1.0])),
    ]
}

/// One side's sound on its way through
struct Side {
    /// The last frame's worth of what came in (also the dry sound, a frame late), a ring
    input: Vec<f32>,
    /// What's on its way out: the frames, laid over each other, a ring
    output: Vec<f32>,
    /// Each frequency's loudness as it goes out, and where in its turn it is
    level: Vec<f32>,
    turn: Vec<f32>,
    /// Where it was a frame ago as it came in, and how far it turns each frame: what a frequency
    /// that is held, or lingering, goes on turning by
    before: Vec<f32>,
    step: Vec<f32>,
    /// The smear's own turns: the same every time the song plays
    random: Rng,
}

impl Side {
    fn new(size: usize, seed: u32) -> Side {
        let half = size / 2 + 1;
        Side { input: vec![0.0; size], output: vec![0.0; size], level: vec![0.0; half], turn: vec![0.0; half], before: vec![0.0; half], step: vec![0.0; half], random: Rng::new(seed) }
    }
}

pub struct Spectral {
    sr: f32,
    pub params: [f32; COUNT],
    /// A frame's length, and how far apart frames start (a quarter of it)
    size: usize,
    hop: usize,
    /// Where in the rings the next sample goes
    at: usize,
    /// Samples until the next frame
    until: usize,
    sides: [Side; 2],
    /// The frame's shape: it fades in and out, so frames laid over each other add up evenly
    window: Vec<f64>,
    /// Scratch for a frame's transform, for the smear, and for how far each frequency turned
    re: Vec<f64>,
    im: Vec<f64>,
    spread: Vec<f32>,
    turned: Vec<f32>,
    live: Vec<f32>,
    /// What makes up for the loudness the smear's scattering loses (as it was when a frame was
    /// last taken apart: a held frame keeps it)
    makeup: f32,
    /// The mix as it is now (it eases to its setting)
    mix: f32,
    fresh: bool,
}

impl Spectral {
    /// How many samples late the sound comes out: one frame.
    pub fn delay(&self) -> usize {
        self.size
    }

    /// Take one side's last frame apart, change it, and lay it into its way out.
    fn frame(&mut self, ch: usize, freeze: bool, gate_db: f32, blur: f32, smear: f32) {
        let (size, half) = (self.size, self.size / 2 + 1);
        let side = &mut self.sides[ch];
        if !freeze {
            // (Frames whose frequencies are scattered no longer add up as they did: about 6 dB is
            // lost at full smear, most of it by a quarter of the way for a sound of clear notes
            // and more gradually for a noisy one. This sits between the two, within about 3 dB)
            self.makeup = 10f32.powf(6.0 * (1.0 - (-smear / 0.25).exp()) / 20.0);
            for i in 0..size {
                self.re[i] = side.input[(self.at + i) % size] as f64 * self.window[i];
                self.im[i] = 0.0;
            }
            fft(&mut self.re, &mut self.im, false);
            // Each frequency's loudness: 1 is a sine at full level
            let scale = 4.0 / size as f64;
            // A frequency's loudness falls away over the blur's time; it rises at once
            let keep = if blur > 0.0 { (-(self.hop as f32) / (blur * blur * BLUR_MAX_S * self.sr)).exp() } else { 0.0 };
            let open = 10f32.powf(gate_db / 20.0);
            let whole = 10f32.powf((gate_db + GATE_KNEE_DB) / 20.0);
            for k in 0..half {
                let mut level = ((self.re[k] * self.re[k] + self.im[k] * self.im[k]).sqrt() * scale) as f32;
                let turn = self.im[k].atan2(self.re[k]) as f32;
                if gate_db > GATE_OFF_DB + 0.5 {
                    level *= ((level - open) / (whole - open)).clamp(0.0, 1.0);
                }
                self.live[k] = level;
                self.turned[k] = turn - side.before[k];
                side.before[k] = turn;
                side.turn[k] = if level >= side.level[k] * keep { turn } else { side.turn[k] + side.step[k] };
            }
            // A note shows as a peak with a skirt of quieter frequencies either side, all turning
            // together at the note's rate. Each frequency is given the turn of the peak it belongs
            // to (up to the dip between it and the next peak), so that held or lingering, a
            // note's skirt stays with it where another note's skirt overlaps
            let mut from = 0;
            while from < half {
                // The peak after `from`, and the dip after that peak
                let mut peak = from;
                while peak + 1 < half && self.live[peak + 1] >= self.live[peak] {
                    peak += 1;
                }
                let mut dip = peak;
                while dip + 1 < half && self.live[dip + 1] < self.live[dip] {
                    dip += 1;
                }
                for k in from..=dip {
                    // As it comes in, where it's at least as loud as what the blur still holds of
                    // it; else that goes on, falling away, turning as it last did (so a note
                    // lingers as that note)
                    let lingering = side.level[k] * keep;
                    if self.live[k] >= lingering {
                        side.level[k] = self.live[k];
                        side.step[k] = self.turned[peak];
                    } else {
                        side.level[k] = lingering;
                    }
                }
                from = dip + 1;
            }
            if smear > 0.0 {
                // Each frequency takes the average of those within the smear's width of it, in
                // power, so the sound stays as loud; and where in its turn each one is, is
                // scattered (more, the more smear), so the spread sound is breath rather than a buzz
                let width = ((smear * SMEAR_MAX * half as f32) as usize).max(1);
                let mut sum = 0.0f32;
                self.spread.clear();
                self.spread.extend(side.level.iter().map(|l| l * l));
                for k in 0..half.min(width) {
                    sum += self.spread[k];
                }
                for k in 0..half {
                    // (The window slides along: one comes in ahead, one drops out behind)
                    if k + width < half {
                        sum += self.spread[k + width];
                    }
                    if k > width {
                        sum -= self.spread[k - width - 1];
                    }
                    let count = (k + width).min(half - 1) - k.saturating_sub(width) + 1;
                    side.level[k] = (sum.max(0.0) / count as f32).sqrt();
                    side.turn[k] += smear * std::f32::consts::PI * side.random.bipolar();
                }
            }
        } else {
            // Held: each frequency as loud as it was, turned on by as much as it last turned
            for k in 0..half {
                side.turn[k] += side.step[k];
            }
        }
        // Put it back together: each frequency and its mirror image
        let scale = size as f64 / 4.0 * self.makeup as f64;
        for k in 0..half {
            let (level, turn) = (side.level[k] as f64 * scale, side.turn[k] as f64);
            self.re[k] = level * turn.cos();
            self.im[k] = level * turn.sin();
            if k > 0 && k < size / 2 {
                self.re[size - k] = self.re[k];
                self.im[size - k] = -self.im[k];
            }
        }
        fft(&mut self.re, &mut self.im, true);
        // (Four frames overlap everywhere, their shapes squared adding up to 1.5)
        let back = 1.0 / (1.5 * size as f64);
        for i in 0..size {
            side.output[(self.at + i) % size] += (self.re[i] * self.window[i] * back) as f32;
        }
    }
}

impl Plugin for Spectral {
    fn info() -> Info {
        Info {
            name: "Fledge Spectral",
            category: "Effects",
            about: "Works on a sound by its spectrum, each frequency on its own. Gate takes out what's quieter than a threshold (hiss under a held note goes, the note stays). Blur smooths each frequency over time, into a wash that lingers. Smear spreads each frequency over its neighbours, turning pitches breathy. Freeze is a switch: while it's on, the sound of that moment is held and goes on sounding. The sound comes out a frame late (43 ms at 48 kHz).",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["spectral", "freeze", "blur", "denoise", "gate", "smear", "wash"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        let size = if sr > 50000.0 { 4096 } else { 2048 };
        // A raised cosine: a note's loudness falls away fast to either side of it, so notes near
        // each other are kept apart
        let window = (0..size).map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / size as f64).cos()).collect();
        Spectral {
            sr,
            params: defaults(),
            size,
            hop: size / 4,
            at: 0,
            until: size / 4,
            sides: [Side::new(size, 0x5EED_0001), Side::new(size, 0x5EED_0002)],
            window,
            re: vec![0.0; size],
            im: vec![0.0; size],
            spread: Vec::with_capacity(size / 2 + 1),
            turned: vec![0.0; size / 2 + 1],
            live: vec![0.0; size / 2 + 1],
            makeup: 1.0,
            mix: 1.0,
            fresh: true,
        }
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
            FREEZE => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
            GATE if x <= GATE_OFF_DB + 0.5 => "Off".to_string(),
            GATE => format!("{x:.0} dB"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let p = |i: usize| value(i, self.params[i]);
        let (freeze, gate, blur, smear, mix_to) = (p(FREEZE) >= 0.5, p(GATE), p(BLUR), p(SMEAR), p(MIX));
        if self.fresh {
            (self.mix, self.fresh) = (mix_to, false);
        }
        let ease = 1.0 - (-1.0 / (0.010 * self.sr)).exp();
        for i in 0..block.frames() {
            self.mix += (mix_to - self.mix) * ease;
            for ch in 0..2 {
                let side = &mut self.sides[ch];
                // What came in a frame ago is the dry sound, in step with what comes out
                let dry = side.input[self.at];
                let x = block.input[ch][i];
                side.input[self.at] = if x.is_finite() { x } else { 0.0 };
                let wet = side.output[self.at];
                side.output[self.at] = 0.0;
                block.output[ch][i] = dry + (wet - dry) * self.mix;
            }
            self.at = (self.at + 1) % self.size;
            self.until -= 1;
            if self.until == 0 {
                self.until = self.hop;
                // (Frozen, the last frame taken apart before the switch is the one held)
                for ch in 0..2 {
                    self.frame(ch, freeze, gate, blur, smear);
                }
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

fledge_wasm::export!(Spectral);

#[cfg(test)]
mod tests;
