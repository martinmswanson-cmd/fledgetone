//! Fledge Harmony: harmony voices from one sung or played line.
//!
//! It follows the pitch of a single line (a voice, a lead, a bass: one note at a time) and adds
//! up to two more voices at intervals above or below it. In a key and scale, the intervals are
//! steps of that scale, so a "third above" is a major or a minor third as the scale has it at
//! each note, and the harmony stays in key. In Chromatic they are plain semitones.
//!
//! The added voices keep the character of the original: a voice shifted up does not turn into a
//! chipmunk. That is what pitch-synchronous overlap-add does (Moulines and Charpentier's
//! TD-PSOLA): the line is cut into grains two periods long, in step with its pitch, and the grains
//! are laid down again closer together (higher) or further apart (lower), each as it was, so the
//! resonances that make a voice sound like itself stay where they were. Formant then moves those
//! resonances on purpose, for a bigger or a smaller voice.
//!
//! Written from the published method, not from anyone's code. The pitch is found by a normalised
//! autocorrelation (McLeod and Wyvill). The added voices come a little behind the line (about two
//! and a half periods of its pitch: 12 ms at 200 Hz, 30 ms at 80 Hz), as singers standing beside
//! it would; the line itself passes at once. Where there is no clear single pitch (consonants,
//! breath, chords, silence) the added voices rest.

use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const KEY: usize = 0;
pub const SCALE: usize = 1;
pub const VOICE_1: usize = 2;
pub const LEVEL_1: usize = 3;
pub const VOICE_2: usize = 4;
pub const LEVEL_2: usize = 5;
pub const DRY: usize = 6;
pub const FORMANT: usize = 7;
pub const SPREAD: usize = 8;
pub const DETUNE: usize = 9;
pub const COUNT: usize = 10;

const NAMES: [&str; COUNT] = ["Key", "Scale", "Voice 1", "Voice 1 level", "Voice 2", "Voice 2 level", "Dry", "Formant", "Spread", "Detune"];
const KEY_TEXT: [&str; 12] = ["C", "C\u{266f}", "D", "E\u{266d}", "E", "F", "F\u{266f}", "G", "A\u{266d}", "A", "B\u{266d}", "B"];
const SCALE_TEXT: [&str; 3] = ["Major", "Minor", "Chromatic"];
/// The scales' notes, in semitones above the key note (Chromatic: every one)
const SCALES: [&[i32]; 3] = [&[0, 2, 4, 5, 7, 9, 11], &[0, 2, 3, 5, 7, 8, 10], &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
/// The widest interval, in steps either way
const STEPS: f32 = 12.0;

/// The lowest and highest pitch it follows
const LOW_HZ: f32 = 70.0;
const HIGH_HZ: f32 = 1000.0;
/// How alike to itself, a period on, the line must be to count as one clear note
const CLEAR: f32 = 0.8;

fn choice(v: f32, n: usize) -> usize {
    ((v * n as f32) as usize).min(n - 1)
}
fn choice_inv(i: usize, n: usize) -> f32 {
    (i.min(n - 1) as f32 + 0.5) / n as f32
}

/// A parameter's 0..1 as its own value: a choice's number, steps, a fraction, semitones, cents.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        KEY => choice(v, 12) as f32,
        SCALE => choice(v, 3) as f32,
        VOICE_1 | VOICE_2 | FORMANT => (-STEPS + 2.0 * STEPS * v).round(),
        DETUNE => 30.0 * v,
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        KEY => choice_inv(x as usize, 12),
        SCALE => choice_inv(x as usize, 3),
        VOICE_1 | VOICE_2 | FORMANT => ((x + STEPS) / (2.0 * STEPS)).clamp(0.0, 1.0),
        DETUNE => (x / 30.0).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    std::array::from_fn(|i| normal(i, values[i]))
}

/// The settings a fresh one has: C major, one voice a third above.
pub fn defaults() -> [f32; COUNT] {
    settings([0.0, 0.0, 2.0, 0.7, 4.0, 0.0, 1.0, 0.0, 0.5, 6.0])
}

/// The presets: a name and its settings (the key is left at C: set it to the song's).
pub fn presets() -> [(&'static str, [f32; COUNT]); 6] {
    [
        ("A third above", settings([0.0, 0.0, 2.0, 0.7, 4.0, 0.0, 1.0, 0.0, 0.5, 6.0])),
        ("Third and fifth above", settings([0.0, 0.0, 2.0, 0.65, 4.0, 0.55, 1.0, 0.0, 0.7, 6.0])),
        ("A third above, a fourth below", settings([0.0, 0.0, 2.0, 0.65, -3.0, 0.6, 1.0, 0.0, 0.7, 6.0])),
        ("Octave below", settings([0.0, 2.0, -12.0, 0.7, 12.0, 0.0, 1.0, 0.0, 0.0, 4.0])),
        ("Octaves above and below", settings([0.0, 2.0, 12.0, 0.5, -12.0, 0.6, 1.0, 0.0, 0.6, 5.0])),
        ("Thicker double", settings([0.0, 2.0, 0.0, 0.7, 0.0, 0.7, 1.0, -2.0, 1.0, 14.0])),
    ]
}

/// The note of `scale` in `key` nearest to `midi` (a pitch as a MIDI note, fractions and all).
pub fn nearest_in_scale(midi: f32, key: i32, scale: usize) -> i32 {
    let notes = SCALES[scale.min(2)];
    let around = midi.round() as i32;
    let mut best = around;
    let mut off = f32::MAX;
    for n in around - 6..=around + 6 {
        if notes.contains(&(n - key).rem_euclid(12)) && (n as f32 - midi).abs() < off {
            off = (n as f32 - midi).abs();
            best = n;
        }
    }
    best
}

/// The note `steps` steps of the scale from `note` (a note of the scale), in semitones from it.
pub fn interval_semitones(note: i32, steps: i32, key: i32, scale: usize) -> i32 {
    let notes = SCALES[scale.min(2)];
    let n = notes.len() as i32;
    let from = (note - key).rem_euclid(12);
    let degree = notes.iter().position(|x| *x == from).unwrap_or(0) as i32;
    let to = degree + steps;
    notes[to.rem_euclid(n) as usize] + 12 * to.div_euclid(n) - from
}

/// One added voice: where its next grain goes, and how fast it is to be played
#[derive(Clone, Copy, Default)]
struct Voice {
    /// When its next grain starts (in samples since the plugin was made)
    next: f64,
}

pub struct Harmony {
    sr: f32,
    pub params: [f32; COUNT],
    /// The line as it came in (both channels added), kept for a while: a ring
    line: Vec<f32>,
    /// Samples taken in so far
    now: u64,
    /// The added voices' sound on its way out, left and right: rings the grains are laid into
    out: [Vec<f32>; 2],
    /// The pitch now: the period in samples (0: no clear note), and the scale note it's held to
    period: f32,
    held: Option<i32>,
    /// A point the grains are cut in step with: one of the line's periods starts here
    anchor: f64,
    voices: [Voice; 2],
    /// Samples until the pitch is looked for again, and how often that is
    until: usize,
    hop: usize,
    /// Scratch for the pitch finder: the line at a lower rate, and how alike it is at each lag
    slow: Vec<f32>,
    alike: Vec<f32>,
}

impl Harmony {
    /// The pitch it hears now, in Hz (0 for none): for a display.
    pub fn pitch_hz(&self) -> f32 {
        if self.period > 0.0 {
            self.sr / self.period
        } else {
            0.0
        }
    }

    #[inline]
    fn line_at(&self, at: f64) -> f32 {
        // Between two samples: a line from one to the other
        let mask = self.line.len() - 1;
        let k = at.floor();
        let t = (at - k) as f32;
        let i = k as i64 as usize;
        let (a, b) = (self.line[i & mask], self.line[(i + 1) & mask]);
        a + (b - a) * t
    }

    /// Find the line's period from its last stretch (0 if it isn't one clear note).
    fn find_period(&mut self) -> f32 {
        // At about 16 kHz: enough for a pitch to a few cents, a ninth of the work
        let step = ((self.sr / 16000.0).floor() as usize).max(1);
        let rate = self.sr / step as f32;
        let n = self.slow.len();
        let mask = self.line.len() - 1;
        if (self.now as usize) < n * step {
            return 0.0;
        }
        let from = self.now as usize - n * step;
        let mut mean = 0.0;
        for i in 0..n {
            let mut s = 0.0;
            for k in 0..step {
                s += self.line[(from + i * step + k) & mask];
            }
            self.slow[i] = s / step as f32;
            mean += self.slow[i];
        }
        mean /= n as f32;
        let mut energy = 0.0;
        for x in &mut self.slow {
            *x -= mean;
            energy += *x * *x;
        }
        // Under about -55 dBFS there's nothing to follow
        let loud = energy / n as f32;
        if loud.is_nan() || loud <= 3e-6 {
            return 0.0;
        }
        let low = ((rate / HIGH_HZ) as usize).max(2);
        let high = ((rate / LOW_HZ) as usize + 1).min(n / 2);
        for lag in 0..=high + 1 {
            let (mut both, mut each) = (0.0f32, 0.0f32);
            for i in 0..n - lag {
                let (a, b) = (self.slow[i], self.slow[i + lag]);
                both += a * b;
                each += a * a + b * b;
            }
            self.alike[lag] = if each > 0.0 { 2.0 * both / each } else { 0.0 };
        }
        // Past the first dip under zero, the peaks are whole periods; the first nearly as high as
        // the highest is one period (not two, and not a strong overtone's)
        let mut start = 1;
        while start <= high && self.alike[start] > 0.0 {
            start += 1;
        }
        let start = start.max(low);
        let mut best = 0.0f32;
        for lag in start..=high {
            if self.alike[lag] > best && self.alike[lag] >= self.alike[lag - 1] && self.alike[lag] >= self.alike[lag + 1] {
                best = self.alike[lag];
            }
        }
        if best < CLEAR {
            return 0.0;
        }
        for lag in start..=high {
            let (a, b, c) = (self.alike[lag - 1], self.alike[lag], self.alike[lag + 1]);
            if b < best * 0.93 || b < a || b < c {
                continue;
            }
            let bend = a - 2.0 * b + c;
            let offset = if bend < 0.0 { 0.5 * (a - c) / bend } else { 0.0 };
            return (lag as f32 + offset) * step as f32;
        }
        0.0
    }

    /// Lay one grain of the line into the way out: the two periods around the period start nearest
    /// to `around`, beginning at `at`, played at `formant` times its speed, at these levels.
    fn lay_grain(&mut self, at: f64, around: f64, formant: f64, left: f32, right: f32) {
        let period = self.period as f64;
        let centre = self.anchor + ((around - self.anchor) / period).round() * period;
        self.anchor = centre;
        // Half the grain's length on its way out: a period, shorter or longer by the formant shift
        let half = period / formant;
        let mask = self.out[0].len() - 1;
        let first = at.ceil();
        let count = (2.0 * half).floor() as usize;
        for j in 0..count {
            let t = first + j as f64;
            // From -1 to 1 across the grain
            let x = (t - at) / half - 1.0;
            if x >= 1.0 {
                break;
            }
            let window = 0.5 + 0.5 * (std::f64::consts::PI * x).cos();
            let sample = self.line_at(centre + x * half * formant) * window as f32;
            let i = t as u64 as usize & mask;
            self.out[0][i] += sample * left;
            self.out[1][i] += sample * right;
        }
    }
}

impl Plugin for Harmony {
    fn info() -> Info {
        Info {
            name: "Fledge Harmony",
            category: "Effects",
            about: "Harmony voices from one sung or played line: it follows the pitch of a voice or a lead (one note at a time) and adds up to two voices above or below it, in the song's key, so a \"third above\" stays in the scale at every note. The added voices keep the original's character (a voice shifted up doesn't turn into a chipmunk); Formant changes it on purpose, for a bigger or smaller voice. Set Key and Scale to the song's. The added voices come a few milliseconds behind the line and rest where it has no clear pitch.",
            instrument: false,
            sidechain: false,
            transport: false,
            tags: &["harmony", "harmoniser", "pitch shift", "vocal", "formant", "double"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(8000.0);
        let ring = ((sr * 0.25) as usize).next_power_of_two();
        let slow_rate = sr / ((sr / 16000.0).floor().max(1.0));
        // About 45 ms of the line to find its pitch in: three periods of the lowest note
        let window = (slow_rate * 0.045) as usize;
        Harmony {
            sr,
            params: defaults(),
            line: vec![0.0; ring],
            now: 0,
            out: [vec![0.0; ring], vec![0.0; ring]],
            period: 0.0,
            held: None,
            anchor: 0.0,
            voices: [Voice::default(); 2],
            until: 0,
            // The pitch is looked for about 94 times a second
            hop: ((sr / 93.75) as usize).max(32),
            slow: vec![0.0; window],
            alike: vec![0.0; window / 2 + 3],
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
        let chromatic = value(SCALE, self.params[SCALE]) as usize == 2;
        match i {
            KEY => KEY_TEXT[x as usize].to_string(),
            SCALE => SCALE_TEXT[x as usize].to_string(),
            VOICE_1 | VOICE_2 if x == 0.0 => "Unison".to_string(),
            VOICE_1 | VOICE_2 if chromatic => format!("{x:+.0} st"),
            VOICE_1 | VOICE_2 => format!("{x:+.0} {}", if x.abs() == 1.0 { "step" } else { "steps" }),
            FORMANT if x == 0.0 => "0 st".to_string(),
            FORMANT => format!("{x:+.0} st"),
            DETUNE => format!("{x:.0} cents"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let params = self.params;
        let p = |i: usize| value(i, params[i]);
        let (key, scale) = (p(KEY) as i32, p(SCALE) as usize);
        let steps = [p(VOICE_1) as i32, p(VOICE_2) as i32];
        let levels = [p(LEVEL_1), p(LEVEL_2)];
        let dry = p(DRY);
        let formant = 2f64.powf(p(FORMANT) as f64 / 12.0);
        let spread = p(SPREAD);
        // (One voice a little sharp, the other a little flat: two singers, not one doubled)
        let detune = [p(DETUNE), -p(DETUNE)];
        let (line_mask, out_mask) = (self.line.len() - 1, self.out[0].len() - 1);
        for i in 0..block.frames() {
            let (l, r) = (block.input[0][i], block.input[1][i]);
            let mono = 0.5 * (l + r);
            let at = self.now as usize;
            self.line[at & line_mask] = if mono.is_finite() { mono } else { 0.0 };
            self.now += 1;
            if self.until == 0 {
                self.until = self.hop;
                let was = self.period;
                self.period = self.find_period();
                if self.period > 0.0 {
                    // The scale note it's nearest to, held until the pitch has plainly moved on
                    // (a wide vibrato or a slide doesn't flick the harmony between two notes)
                    let midi = 69.0 + 12.0 * (self.sr / self.period / 440.0).log2();
                    let near = nearest_in_scale(midi, key, scale);
                    self.held = match self.held {
                        Some(h) if h != near && (midi - h as f32).abs() < (midi - near as f32).abs() + 0.35 && SCALES[scale].contains(&(h - key).rem_euclid(12)) => Some(h),
                        _ => Some(near),
                    };
                    if was <= 0.0 {
                        // A note begins: the voices start from here
                        let t = self.now as f64;
                        self.anchor = t - 1.5 * self.period as f64;
                        self.voices = [Voice { next: t }; 2];
                    }
                } else {
                    self.held = None;
                }
            }
            self.until -= 1;
            if let (true, Some(note)) = (self.period > 0.0, self.held) {
                let t = (self.now - 1) as f64;
                let period = self.period as f64;
                for v in 0..2 {
                    if self.voices[v].next > t {
                        continue;
                    }
                    let semitones = interval_semitones(note, steps[v], key, scale) as f64 + detune[v] as f64 / 100.0;
                    let ratio = 2f64.powf(semitones / 12.0);
                    let start = self.voices[v].next;
                    self.voices[v].next = start + period / ratio;
                    if levels[v] <= 0.0 {
                        continue;
                    }
                    // Voice 1 to the left, voice 2 to the right, as far as Spread says
                    let pan = if v == 0 { -spread } else { spread };
                    let (gl, gr) = ((1.0 - pan.max(0.0)), (1.0 + pan.min(0.0)));
                    // (More grains a second when higher, fewer when lower: evened out)
                    let level = levels[v] * ((formant / ratio).sqrt() as f32);
                    // The latest grain that has all come in: the period start nearest a period
                    // and a half back is at most two periods back, and the grain ends a period
                    // after it
                    self.lay_grain(start, t - 1.5 * period - 2.0, formant, level * gl, level * gr);
                }
            }
            let o = at & out_mask;
            block.output[0][i] = l * dry + self.out[0][o];
            block.output[1][i] = r * dry + self.out[1][o];
            self.out[0][o] = 0.0;
            self.out[1][o] = 0.0;
        }
    }

    fn program_count() -> usize {
        presets().len()
    }

    fn program_name(i: usize) -> &'static str {
        presets()[i].0
    }

    fn set_program(&mut self, i: usize) {
        // (A preset keeps the key that is set: it's the song's, not the preset's)
        let key = self.params[KEY];
        self.params = presets()[i].1;
        self.params[KEY] = key;
    }
}

fledge_wasm::export!(Harmony);

#[cfg(test)]
mod tests;
