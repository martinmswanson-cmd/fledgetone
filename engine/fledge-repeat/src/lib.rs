//! Fledge Repeat: a beat repeat in time with the song.
//!
//! While it's on, it takes the slice of sound that comes in next (a 16th note, say), lets that
//! slice through as it's played, and then plays it again and again in place of the track: a
//! stutter, a drum roll, a glitch. Each repeat can be cut short (Gate), quieter than the last
//! (Decay) and lower or higher than the last (Pitch).
//!
//! It goes on two ways. **Repeat** is a switch: draw it in an automation lane or hold it. And
//! **Every** makes it go on by itself for the last stretch (**For**) of every bar, or every 2, 4
//! or 8 bars: a fill into the next phrase, as often as **Chance** says. Which times it goes on is
//! decided from the bar's number, so it is the same every time the song plays, live and exported.
//!
//! No added delay: nothing is held back, and the first slice is the track itself.

use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const REPEAT: usize = 0;
pub const EVERY: usize = 1;
pub const FOR: usize = 2;
pub const SLICE: usize = 3;
pub const GATE: usize = 4;
pub const DECAY: usize = 5;
pub const PITCH: usize = 6;
pub const CHANCE: usize = 7;
pub const MIX: usize = 8;
pub const COUNT: usize = 9;

const NAMES: [&str; COUNT] = ["Repeat", "Every", "For", "Slice", "Gate", "Decay", "Pitch", "Chance", "Mix"];

/// How often it goes on by itself, in bars (0: never)
pub const EVERY_BARS: [f32; 5] = [0.0, 1.0, 2.0, 4.0, 8.0];
const EVERY_TEXT: [&str; 5] = ["Off", "1 bar", "2 bars", "4 bars", "8 bars"];
/// How long it stays on then, in beats (quarter notes)
pub const FOR_BEATS: [f32; 5] = [0.5, 1.0, 2.0, 4.0, 8.0];
const FOR_TEXT: [&str; 5] = ["1/8", "1/4", "1/2", "1 bar", "2 bars"];
/// A slice's length, in beats
pub const SLICE_BEATS: [f32; 8] = [1.0, 0.5, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125, 1.0 / 12.0, 0.0625];
const SLICE_TEXT: [&str; 8] = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T", "1/64"];

/// Bars are counted as four beats (the position comes in beats; the host doesn't say the meter)
const BEATS_A_BAR: f64 = 4.0;
/// The slowest tempo a slice is kept for
const MIN_BPM: f32 = 30.0;
/// Each repeat fades in and out over this long, and the track back in when it goes off
const FADE_S: f32 = 0.002;

fn choice(v: f32, n: usize) -> usize {
    ((v * n as f32) as usize).min(n - 1)
}
fn choice_inv(i: usize, n: usize) -> f32 {
    (i.min(n - 1) as f32 + 0.5) / n as f32
}

/// A parameter's 0..1 as its own value: a choice's number, a fraction, semitones a repeat.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        EVERY => choice(v, EVERY_BARS.len()) as f32,
        FOR => choice(v, FOR_BEATS.len()) as f32,
        SLICE => choice(v, SLICE_BEATS.len()) as f32,
        GATE => 0.1 + 0.9 * v,
        PITCH => (-12.0 + 24.0 * v).round(),
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        EVERY => choice_inv(x as usize, EVERY_BARS.len()),
        FOR => choice_inv(x as usize, FOR_BEATS.len()),
        SLICE => choice_inv(x as usize, SLICE_BEATS.len()),
        GATE => ((x - 0.1) / 0.9).clamp(0.0, 1.0),
        PITCH => ((x + 12.0) / 24.0).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    std::array::from_fn(|i| normal(i, values[i]))
}

/// The settings a fresh one has: off, 16ths when it's switched on, every repeat whole and as loud.
pub fn defaults() -> [f32; COUNT] {
    settings([0.0, 0.0, 1.0, 3.0, 1.0, 0.0, 0.0, 1.0, 1.0])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("Stutter when switched on", settings([0.0, 0.0, 1.0, 3.0, 1.0, 0.0, 0.0, 1.0, 1.0])),
        ("Fill before every 4th bar", settings([0.0, 3.0, 1.0, 3.0, 0.9, 0.0, 0.0, 1.0, 1.0])),
        ("Roll into the next bar", settings([0.0, 1.0, 1.0, 5.0, 0.8, 0.0, 0.0, 1.0, 1.0])),
        ("Falling away", settings([0.0, 2.0, 2.0, 3.0, 0.7, 0.35, -1.0, 1.0, 1.0])),
        ("Rising glitch", settings([0.0, 2.0, 1.0, 5.0, 0.6, 0.1, 1.0, 1.0, 1.0])),
        ("Now and then", settings([0.0, 1.0, 0.0, 4.0, 0.8, 0.0, 0.0, 0.4, 1.0])),
    ]
}

/// Whether the fill in stretch number `n` of the song plays, for a chance of `chance` (0..1): the
/// same answer for the same stretch every time.
pub fn takes_its_chance(n: i64, chance: f32) -> bool {
    if chance >= 1.0 {
        return true;
    }
    // (A hash of the stretch's number: spread evenly over 0..1)
    let mut x = (n as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0x2545_F491_4F6C_DD1D;
    x ^= x >> 33;
    x = x.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    x ^= x >> 33;
    ((x >> 40) as f32 / (1u64 << 24) as f32) < chance
}

pub struct Repeat {
    sr: f32,
    pub params: [f32; COUNT],
    tempo: f32,
    /// Where the song is, in beats, if the host has said (it then runs on at the tempo)
    beat: f64,
    anchored: bool,
    /// The slice being repeated: what came in from the moment it went on (two slices' worth, so a
    /// repeat played faster has sound to read), both channels
    kept: [Vec<f32>; 2],
    /// How much of it is filled
    filled: usize,
    /// It's on, and since when (samples), and how it came on
    on: bool,
    since: f64,
    by_switch: bool,
    /// The slice's length when it went on, in samples (it keeps that length until it goes off)
    slice: f64,
    /// How much of the repeats is heard now: 0 the track alone, 1 the repeats (eased, no clicks)
    wet: f32,
    /// The repeats' last sample, which fades away under the track when it goes off mid-repeat
    last: (f32, f32),
}

impl Repeat {
    /// Whether it's repeating now: for a light.
    pub fn is_on(&self) -> bool {
        self.on
    }

    fn slice_samples(&self) -> f64 {
        let beats = SLICE_BEATS[value(SLICE, self.params[SLICE]) as usize] as f64;
        beats * 60.0 / self.tempo.max(MIN_BPM) as f64 * self.sr as f64
    }

    /// Whether the song's position is inside a fill now, and if so how far into it (beats).
    fn in_a_fill(&self) -> Option<f64> {
        if !self.anchored {
            return None;
        }
        let every = EVERY_BARS[value(EVERY, self.params[EVERY]) as usize] as f64 * BEATS_A_BAR;
        if every <= 0.0 {
            return None;
        }
        let length = (FOR_BEATS[value(FOR, self.params[FOR]) as usize] as f64).min(every);
        // (The position is counted on a sample at a time between the host's beats, and lands a
        // hair short of a whole beat as often as on it: a hair is added, so a fill ends on the
        // bar line and not one sample into the next bar)
        let beat = self.beat + 1e-7;
        let stretch = (beat / every).floor();
        let into = beat - stretch * every - (every - length);
        (into >= 0.0 && takes_its_chance(stretch as i64, self.params[CHANCE])).then_some(into)
    }

    fn start(&mut self, by_switch: bool, already: f64) {
        self.on = true;
        self.by_switch = by_switch;
        self.slice = self.slice_samples().max(16.0);
        // (A fill found a moment late, after a jump in the song: its slices still fall on the grid)
        self.since = already;
        self.filled = 0;
    }
}

impl Plugin for Repeat {
    fn info() -> Info {
        Info {
            name: "Fledge Repeat",
            category: "Effects",
            about: "A beat repeat in time with the song: while it's on, the slice of sound that comes in next (a 16th note, say) plays again and again in place of the track. A stutter, a drum roll, a glitch. Switch it on with Repeat (draw it in an automation lane), or let Every do it by itself at the end of every bar or every few bars, as a fill into the next phrase. Gate cuts each repeat short, Decay fades them, Pitch moves each one up or down. No added delay.",
            instrument: false,
            sidechain: false,
            transport: true,
            tags: &["beat repeat", "stutter", "glitch", "roll", "fill", "tempo"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        // Room for two of the longest slices (a quarter note at the slowest tempo)
        let room = (2.0 * 60.0 / MIN_BPM * sr) as usize + 8;
        Repeat { sr, params: defaults(), tempo: 120.0, beat: 0.0, anchored: false, kept: [vec![0.0; room], vec![0.0; room]], filled: 0, on: false, since: 0.0, by_switch: false, slice: 1.0, wet: 0.0, last: (0.0, 0.0) }
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
            REPEAT => (if x >= 0.5 { "On" } else { "Off" }).to_string(),
            EVERY => EVERY_TEXT[x as usize].to_string(),
            FOR => FOR_TEXT[x as usize].to_string(),
            SLICE => SLICE_TEXT[x as usize].to_string(),
            PITCH if x == 0.0 => "0 st".to_string(),
            PITCH => format!("{x:+.0} st"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let switch = self.params[REPEAT] >= 0.5;
        let gate = value(GATE, self.params[GATE]);
        let decay = self.params[DECAY];
        // Each repeat plays this many times the speed of the last
        let step = 2f64.powf(value(PITCH, self.params[PITCH]) as f64 / 12.0);
        let mix = self.params[MIX];
        let beats_a_sample = self.tempo.max(MIN_BPM) as f64 / 60.0 / self.sr as f64;
        let fade = (FADE_S * self.sr).max(1.0) as f64;
        let ease = 1.0 / fade as f32;
        let room = self.kept[0].len();
        for i in 0..block.frames() {
            let (l, r) = (block.input[0][i], block.input[1][i]);
            // On and off: the switch, or the song reaching a fill
            let fill = if switch { None } else { self.in_a_fill() };
            if !self.on {
                if switch {
                    self.start(true, 0.0);
                } else if let Some(into) = fill {
                    self.start(false, into / beats_a_sample);
                }
            } else if (self.by_switch && !switch) || (!self.by_switch && fill.is_none()) {
                self.on = false;
                if switch {
                    self.start(true, 0.0);
                }
            }
            let mut out = (0.0f32, 0.0f32);
            let mut want = 0.0f32;
            if self.on {
                let number = (self.since / self.slice).floor();
                let within = self.since - number * self.slice;
                if number < 1.0 {
                    // The first slice is the track itself, kept as it passes
                    if self.filled < room {
                        self.kept[0][self.filled] = l;
                        self.kept[1][self.filled] = r;
                        self.filled += 1;
                    }
                } else {
                    // (What comes in goes on being kept through the second slice: a repeat played
                    // faster reads on into it)
                    if number < 2.0 && self.filled < room {
                        self.kept[0][self.filled] = l;
                        self.kept[1][self.filled] = r;
                        self.filled += 1;
                    }
                    let speed = step.powf(number);
                    let at = within * speed;
                    let (k, t) = (at.floor() as usize, (at - at.floor()) as f32);
                    let read = |ch: &Vec<f32>| if k + 1 < self.filled { ch[k] + (ch[k + 1] - ch[k]) * t } else { 0.0 };
                    // Each repeat fades in and out (down to nothing on its last sample), and stops at the gate
                    let sounding = self.slice * gate as f64;
                    let shape = if within >= sounding { 0.0 } else { (within / fade).min(1.0).min(((sounding - 1.0 - within) / fade).clamp(0.0, 1.0)) } as f32;
                    let level = shape * (1.0 - decay).powf(number as f32 - 1.0);
                    out = (read(&self.kept[0]) * level, read(&self.kept[1]) * level);
                    want = 1.0;
                }
                self.since += 1.0;
            }
            if want > 0.0 {
                // The repeats take over from the track over the fade
                self.wet = (self.wet + ease).min(1.0);
                self.last = out;
                let w = self.wet * mix;
                block.output[0][i] = l * (1.0 - w) + out.0 * w;
                block.output[1][i] = r * (1.0 - w) + out.1 * w;
            } else {
                // Off (or still in the first slice): the track at once and whole, so the beat
                // after a fill keeps its attack; a repeat cut off mid-way fades out under it
                // (one that had ended, as a fill's last does at the bar line, leaves nothing)
                self.wet = (self.wet - ease).max(0.0);
                let w = self.wet * mix;
                block.output[0][i] = l + self.last.0 * w;
                block.output[1][i] = r + self.last.1 * w;
                if self.wet == 0.0 {
                    self.last = (0.0, 0.0);
                }
            }
            if self.anchored {
                self.beat += beats_a_sample;
            }
        }
    }

    fn set_tempo(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 0.0 {
            self.tempo = bpm;
        }
    }

    fn set_position(&mut self, beats: f64) {
        if !beats.is_finite() {
            return;
        }
        // The song has stopped: nothing to follow, so no fills (the switch still works)
        if beats < 0.0 {
            self.anchored = false;
            if self.on && !self.by_switch {
                self.on = false;
            }
            return;
        }
        // The song has jumped (a loop, a click on the ruler): a fill that was playing ends there
        if self.anchored && (beats - self.beat).abs() > 0.02 && self.on && !self.by_switch {
            self.on = false;
        }
        self.beat = beats;
        self.anchored = true;
    }

    fn settle(&mut self) {
        self.wet = if self.on && self.since >= self.slice { 1.0 } else { 0.0 };
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

fledge_wasm::export!(Repeat);

#[cfg(test)]
mod tests;
