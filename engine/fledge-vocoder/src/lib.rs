//! Fledge Vocoder: a channel vocoder that takes its voice from a sidechain.
//!
//! The track it's on is the **carrier**: a synth chord, a pad, a saw bass, noise. The track picked
//! as its sidechain is the **voice** (the modulator): speech, singing, a drum loop. Both are split
//! into the same bands; how loud the voice is in each band sets how loud the carrier is in that
//! band, so the carrier's notes come out shaped like the voice's words: the talking synth.
//!
//! With no sidechain connected there's no voice to follow, and the track passes through as it is.
//!
//! Written from the textbook form (a bank of band-pass filters on each side, an envelope follower
//! on each of the voice's bands), not from anyone's code. No added delay.

use fledge_dsp::filter::{Svf, SvfCoef};
use fledge_dsp::math::flush;
use fledge_plugin::{Block, Info, Plugin};

/// The parameters, in order. New ones are only ever added at the end (see fledge-plugin).
pub const BANDS: usize = 0;
pub const RESPONSE: usize = 1;
pub const FORMANT: usize = 2;
pub const SIBILANCE: usize = 3;
pub const MIX: usize = 4;
pub const LEVEL: usize = 5;
pub const COUNT: usize = 6;

const NAMES: [&str; COUNT] = ["Bands", "Response", "Formant", "Sibilance", "Mix", "Level"];

/// How many bands can be chosen
pub const BAND_CHOICES: [usize; 5] = [8, 12, 16, 24, 32];
const MAX_BANDS: usize = 32;
/// The bands run from here...
const LOW_HZ: f32 = 90.0;
/// ...to here (or as high as the sample rate allows)
const HIGH_HZ: f32 = 11000.0;
/// The voice's consonants (above this) can be let straight through: see Sibilance
const SIBILANCE_HZ: f32 = 5000.0;
/// What brings a vocoded sound back toward the carrier's level (the bands' envelopes are far under
/// full level: a voice's loudness is spread over the bands). Set between two ends: a voice that is
/// noise in every band comes out about 8 dB under the carrier, one that is a single loud tone
/// brings its one band up by about 18 dB. Level trims the rest.
const MAKEUP: f32 = 20.0;

/// A parameter's 0..1 as its own value: a number of bands, milliseconds, semitones, a fraction, dB.
pub fn value(i: usize, v: f32) -> f32 {
    match i {
        BANDS => BAND_CHOICES[((v * BAND_CHOICES.len() as f32) as usize).min(BAND_CHOICES.len() - 1)] as f32,
        RESPONSE => 5.0 * 60f32.powf(v),
        FORMANT => (-12.0 + 24.0 * v).round(),
        LEVEL => -24.0 + 48.0 * v,
        _ => v,
    }
}

/// A parameter's own value as the 0..1 that sets it.
pub fn normal(i: usize, x: f32) -> f32 {
    match i {
        BANDS => {
            let at = BAND_CHOICES.iter().position(|b| *b as f32 >= x).unwrap_or(BAND_CHOICES.len() - 1);
            (at as f32 + 0.5) / BAND_CHOICES.len() as f32
        }
        RESPONSE => ((x / 5.0).ln() / 60f32.ln()).clamp(0.0, 1.0),
        FORMANT => ((x + 12.0) / 24.0).clamp(0.0, 1.0),
        LEVEL => ((x + 24.0) / 48.0).clamp(0.0, 1.0),
        _ => x.clamp(0.0, 1.0),
    }
}

/// Settings from their own values, in the parameters' order.
fn settings(values: [f32; COUNT]) -> [f32; COUNT] {
    std::array::from_fn(|i| normal(i, values[i]))
}

/// The settings a fresh vocoder has: 16 bands, 25 ms, the voice's consonants a little way in.
pub fn defaults() -> [f32; COUNT] {
    settings([16.0, 25.0, 0.0, 0.2, 1.0, 0.0])
}

/// The presets: a name and its settings.
pub fn presets() -> [(&'static str, [f32; COUNT]); 5] {
    [
        ("Talking synth", settings([16.0, 25.0, 0.0, 0.2, 1.0, 0.0])),
        ("Clear words", settings([32.0, 15.0, 0.0, 0.5, 1.0, 0.0])),
        ("Old robot", settings([8.0, 60.0, 0.0, 0.0, 1.0, 0.0])),
        ("Giant", settings([16.0, 40.0, -5.0, 0.1, 1.0, 0.0])),
        ("Small voice", settings([24.0, 20.0, 5.0, 0.3, 1.0, 0.0])),
    ]
}

/// A band-pass of two sections in a row: unity at its centre, steep to either side.
#[derive(Clone, Copy, Default)]
struct Band {
    a: Svf,
    b: Svf,
}

impl Band {
    #[inline]
    fn tick(&mut self, c: &SvfCoef, k: f32, x: f32) -> f32 {
        let once = self.a.tick(c, x).bp * k;
        self.b.tick(c, once).bp * k
    }
}

pub struct Vocoder {
    sr: f32,
    pub params: [f32; COUNT],
    /// The bands in use, and what they were worked out for (band count, formant shift)
    count: usize,
    made_for: (usize, f32),
    voice_coef: [SvfCoef; MAX_BANDS],
    carrier_coef: [SvfCoef; MAX_BANDS],
    /// Each filter's damping: the bands' width
    k: f32,
    voice: [Band; MAX_BANDS],
    carrier: [[Band; MAX_BANDS]; 2],
    /// How loud the voice is in each band now
    env: [f32; MAX_BANDS],
    sibilance: [Svf; 2],
    /// Mix and level as they are now (they ease to their settings)
    mix: f32,
    level: f32,
    fresh: bool,
}

impl Vocoder {
    fn make_bands(&mut self, count: usize, formant: f32) {
        if self.made_for == (count, formant) {
            return;
        }
        let top = HIGH_HZ.min(self.sr * 0.4);
        // Each band's centre is this many times the last one's
        let step = (top / LOW_HZ).powf(1.0 / (count - 1) as f32);
        // Wide enough that neighbours meet about 3 dB down: no holes between the bands
        self.k = step.sqrt() - 1.0 / step.sqrt();
        let shift = 2f32.powf(formant / 12.0);
        for b in 0..count {
            let hz = LOW_HZ * step.powi(b as i32);
            self.voice_coef[b] = SvfCoef::new(hz, self.sr, self.k);
            self.carrier_coef[b] = SvfCoef::new((hz * shift).min(self.sr * 0.45), self.sr, self.k);
        }
        // Bands that have just come in start clean
        if count != self.count {
            self.voice = [Band::default(); MAX_BANDS];
            self.carrier = [[Band::default(); MAX_BANDS]; 2];
            self.env = [0.0; MAX_BANDS];
        }
        self.count = count;
        self.made_for = (count, formant);
    }

    /// How loud the voice is in each band now (for a display): the bands in use.
    pub fn bands(&self) -> &[f32] {
        &self.env[..self.count]
    }
}

impl Plugin for Vocoder {
    fn info() -> Info {
        Info {
            name: "Fledge Vocoder",
            category: "Effects",
            about: "A vocoder that takes its voice from another track: put it on a synth, a pad or a saw bass (the carrier), pick the track with speech, singing or drums under \"Sidechain from\" (the voice), and the synth's notes come out shaped like the voice's words. 8 to 32 bands, a formant shift for bigger and smaller voices, and the voice's own consonants let through for clear words. With no sidechain the track passes through as it is.",
            instrument: false,
            sidechain: true,
            transport: false,
            tags: &["vocoder", "sidechain", "voice", "robot", "talking synth"],
        }
    }

    fn new(sample_rate: f32) -> Self {
        let mut v = Vocoder {
            sr: sample_rate.max(8000.0),
            params: defaults(),
            count: 0,
            made_for: (0, 0.0),
            voice_coef: [SvfCoef::default(); MAX_BANDS],
            carrier_coef: [SvfCoef::default(); MAX_BANDS],
            k: 1.0,
            voice: [Band::default(); MAX_BANDS],
            carrier: [[Band::default(); MAX_BANDS]; 2],
            env: [0.0; MAX_BANDS],
            sibilance: [Svf::default(); 2],
            mix: 1.0,
            level: 1.0,
            fresh: true,
        };
        v.make_bands(16, 0.0);
        v
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
            BANDS => format!("{x:.0}"),
            RESPONSE => format!("{x:.0} ms"),
            FORMANT if x == 0.0 => "0 st".to_string(),
            FORMANT => format!("{x:+.0} st"),
            LEVEL => format!("{x:+.1} dB"),
            _ => format!("{:.0} %", x * 100.0),
        }
    }

    fn process(&mut self, block: &mut Block) {
        let params = self.params;
        let p = |i: usize| value(i, params[i]);
        let n = block.frames();
        let Some(voice) = block.sidechain else {
            // No voice to follow: the track as it is
            block.output[0].copy_from_slice(block.input[0]);
            block.output[1].copy_from_slice(block.input[1]);
            self.fresh = true;
            return;
        };
        self.make_bands(p(BANDS) as usize, p(FORMANT));
        let (mix_to, level_to) = (p(MIX), 10f32.powf(p(LEVEL) / 20.0));
        if self.fresh {
            (self.mix, self.level, self.fresh) = (mix_to, level_to, false);
        }
        let ease = 1.0 - (-1.0 / (0.010 * self.sr)).exp();
        // Each band's level comes up in 2 ms and falls away over the Response time
        let up = 1.0 - (-1.0 / (0.002 * self.sr)).exp();
        let down = 1.0 - (-1.0 / (p(RESPONSE) * 0.001 * self.sr)).exp();
        let sibilance = p(SIBILANCE);
        let hp = SvfCoef::new(SIBILANCE_HZ.min(self.sr * 0.4), self.sr, std::f32::consts::SQRT_2);
        let (count, k) = (self.count, self.k);
        for i in 0..n {
            let v = 0.5 * (voice[0][i] + voice[1][i]);
            let v = if v.is_finite() { v } else { 0.0 };
            let (cl, cr) = (block.input[0][i], block.input[1][i]);
            let (mut l, mut r) = (0.0, 0.0);
            for b in 0..count {
                let heard = self.voice[b].tick(&self.voice_coef[b], k, v).abs();
                let c = if heard > self.env[b] { up } else { down };
                self.env[b] = flush(self.env[b] + (heard - self.env[b]) * c);
                l += self.carrier[0][b].tick(&self.carrier_coef[b], k, cl) * self.env[b];
                r += self.carrier[1][b].tick(&self.carrier_coef[b], k, cr) * self.env[b];
            }
            // The voice's own consonants (s, t, k: noise above 5 kHz that a synth's notes can't make)
            let (sl, sr) = (self.sibilance[0].tick(&hp, voice[0][i]).hp, self.sibilance[1].tick(&hp, voice[1][i]).hp);
            self.mix += (mix_to - self.mix) * ease;
            self.level += (level_to - self.level) * ease;
            let wet_l = (l * MAKEUP + if sl.is_finite() { sl * sibilance } else { 0.0 }) * self.level;
            let wet_r = (r * MAKEUP + if sr.is_finite() { sr * sibilance } else { 0.0 }) * self.level;
            block.output[0][i] = cl + (wet_l - cl) * self.mix;
            block.output[1][i] = cr + (wet_r - cr) * self.mix;
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

fledge_wasm::export!(Vocoder);

#[cfg(test)]
mod tests;
