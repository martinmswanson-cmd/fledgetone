//! The building blocks: filters, shapers, envelopes, LFOs, the OTT and the output clipper.
//! Written from the published methods (Zavalishin's "The Art of VA Filter Design" and Simper's
//! trapezoidal SVF for the filters, Parker, Zavalishin & Le Bivic's antiderivative
//! antialiasing for the shapers), not from anyone's code.

use std::f32::consts::PI;

/// Values this small are flushed to zero (WebAssembly can't set flush-to-zero, and denormals in
/// a filter's feedback are slow).
#[inline]
pub fn flush(x: f32) -> f32 {
    if x.abs() < 1e-20 {
        0.0
    } else {
        x
    }
}

/// A tiny seeded random generator (xorshift): the same song renders the same every time.
#[derive(Clone)]
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed.max(1))
    }
    #[inline]
    pub fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x >> 8) as f32 / (1u32 << 24) as f32
    }
    /// -1..1
    #[inline]
    pub fn bipolar(&mut self) -> f32 {
        self.next() * 2.0 - 1.0
    }
}

// ---------- the state-variable filter ----------

/// The trapezoidal (zero-delay-feedback) state-variable filter: stable when its cutoff moves at
/// audio rate, low pass, band pass and high pass from one core.
#[derive(Clone, Copy, Default)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
}

/// An SVF's coefficients (shared by the voices and channels that use them).
#[derive(Clone, Copy, Default)]
pub struct SvfCoef {
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,
}

impl SvfCoef {
    /// Moves `s` of the way along `d` (a difference of two coefficient sets): a cutoff gliding a
    /// step a sample between two settings
    #[inline]
    pub fn axpy(&mut self, d: &SvfCoef, s: f32) {
        self.k += d.k * s;
        self.a1 += d.a1 * s;
        self.a2 += d.a2 * s;
        self.a3 += d.a3 * s;
    }
    /// For `cutoff` Hz at `sr`, with damping `k` (2 is no resonance, 0 self-oscillates).
    pub fn new(cutoff: f32, sr: f32, k: f32) -> Self {
        let g = (PI * cutoff.clamp(10.0, sr * 0.49) / sr).tan();
        let a1 = 1.0 / (1.0 + g * (g + k));
        SvfCoef { k, a1, a2: g * a1, a3: g * g * a1 }
    }
}

pub struct SvfOut {
    pub lp: f32,
    pub bp: f32,
    pub hp: f32,
}

impl Svf {
    #[inline]
    pub fn tick(&mut self, c: &SvfCoef, x: f32) -> SvfOut {
        let v3 = x - self.ic2;
        let v1 = c.a1 * self.ic1 + c.a2 * v3;
        let v2 = self.ic2 + c.a2 * self.ic1 + c.a3 * v3;
        self.ic1 = flush(2.0 * v1 - self.ic1);
        self.ic2 = flush(2.0 * v2 - self.ic2);
        SvfOut { lp: v2, bp: v1, hp: x - c.k * v1 - v2 }
    }
    pub fn reset(&mut self) {
        *self = Svf::default();
    }
}

// ---------- the ladder ----------

/// A four-pole ladder low pass in zero-delay-feedback form, with a saturating input: warmer and
/// thicker than the SVF, its resonance thinning the bass as a real ladder's does.
#[derive(Clone, Copy, Default)]
pub struct Ladder {
    s: [f32; 4],
}

impl Ladder {
    /// `g` from tan(pi fc / sr); `k` resonance 0..4 (4 oscillates).
    #[inline]
    pub fn tick(&mut self, g: f32, k: f32, x: f32) -> f32 {
        let gg = g / (1.0 + g);
        // The four one-poles' outputs as a linear function of the input: solve the feedback loop
        let g2 = gg * gg;
        let big_g = g2 * g2;
        let s_sum = self.s[0] * gg * gg * gg / (1.0 + g) + self.s[1] * gg * gg / (1.0 + g) + self.s[2] * gg / (1.0 + g) + self.s[3] / (1.0 + g);
        let u = (x - k * s_sum) / (1.0 + k * big_g);
        // Saturate what goes in (the transistor ladder's character), then run the poles
        let mut v = fast_tanh(u);
        for s in self.s.iter_mut() {
            let y = (v - *s) * gg + *s;
            *s = flush(2.0 * y - *s);
            v = y;
        }
        v
    }
    pub fn reset(&mut self) {
        self.s = [0.0; 4];
    }
}

/// tanh, close enough for audio (a Padé approximant, clamped).
#[inline]
pub fn fast_tanh(x: f32) -> f32 {
    let x = x.clamp(-4.0, 4.0);
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

// ---------- the comb ----------

/// A comb filter tuned to a pitch: the delay is one period, and feedback rings it. Positive
/// feedback sounds every harmonic; negative reads half a period (only odd harmonics, hollow).
/// The feedback is saturated inside the loop, so a high resonance can't run away and boom.
#[derive(Clone)]
pub struct Comb {
    buf: Vec<f32>,
    w: usize,
    damp: f32,
    /// The loop's low pass coefficient: a 7 kHz corner at any sample rate (0.6 at 48 kHz)
    k: f32,
}

impl Comb {
    pub fn new(sr: f32) -> Self {
        // Room for a period of 20 Hz
        Comb { buf: vec![0.0; (sr / 20.0) as usize + 4], w: 0, damp: 0.0, k: 1.0 - (-2.0 * PI * 7000.0 / sr).exp() }
    }
    #[inline]
    pub fn tick(&mut self, x: f32, period: f32, fb: f32, negative: bool) -> f32 {
        let n = self.buf.len();
        // The damping low pass in the loop delays it a little too: take that off, so the comb
        // rings at the pitch it's tuned to (not flat, more so for high notes)
        let raw = if negative { period * 0.5 } else { period };
        let w = 2.0 * PI / period.max(2.0);
        let a = 1.0 - self.k;
        let lag = (a * w.sin()).atan2(1.0 - a * w.cos()) / w;
        let d = (raw - lag).clamp(2.0, (n - 3) as f32);
        let rp = self.w as f32 + n as f32 - d;
        let i = rp as usize;
        let t = rp - i as f32;
        let a = self.buf[i % n];
        let b = self.buf[(i + 1) % n];
        let delayed = a + (b - a) * t;
        // A gentle low pass in the loop (each trip round loses a little top, as real ones do)
        self.damp += (delayed - self.damp) * self.k;
        let back = if negative { -self.damp } else { self.damp };
        let y = x + fb * back;
        self.buf[self.w] = flush(fast_tanh(y * 0.8) * 1.25);
        self.w = (self.w + 1) % n;
        y
    }
    pub fn reset(&mut self) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
        self.damp = 0.0;
    }
}

// ---------- the formant filter ----------

/// Vowel formants (Hz), oo-oh-ah-eh-ee: the formant filter morphs through them.
const VOWELS: [[f32; 3]; 5] = [[300.0, 870.0, 2240.0], [500.0, 1000.0, 2400.0], [730.0, 1090.0, 2440.0], [530.0, 1840.0, 2480.0], [270.0, 2290.0, 3010.0]];

/// The three formant frequencies for `vowel` (0 oo .. 4 ee, in between blends).
pub fn vowel_formants(vowel: f32) -> [f32; 3] {
    let x = vowel.clamp(0.0, 4.0);
    let i = (x as usize).min(3);
    let t = x - i as f32;
    let mut out = [0.0; 3];
    for k in 0..3 {
        out[k] = VOWELS[i][k] * (VOWELS[i + 1][k] / VOWELS[i][k]).powf(t);
    }
    out
}

// ---------- twice the sample rate ----------

/// A half-band low-pass as two chains of first-order all-passes (the polyphase IIR form), made for
/// 90 dB of rejection with its passband up to 0.21 of the doubled rate (20 kHz at 48 kHz): the
/// coefficients come from the elliptic design (attenuation 90 dB, transition 0.04). Each chain
/// runs at the base rate, so going up or down costs four first-order all-passes a chain.
const HALF_BAND: [f32; 8] = [0.040_633_46, 0.150_505_13, 0.300_757_06, 0.460_774_5, 0.609_524_3, 0.738_503_84, 0.849_223_8, 0.949_742_8];

#[derive(Clone, Copy, Default)]
struct AllPassChain {
    x: [f32; 4],
    y: [f32; 4],
}

impl AllPassChain {
    #[inline]
    fn tick(&mut self, odd: usize, mut v: f32) -> f32 {
        for i in 0..4 {
            let c = HALF_BAND[2 * i + odd];
            let y = flush(c * (v - self.y[i]) + self.x[i]);
            self.x[i] = v;
            self.y[i] = y;
            v = y;
        }
        v
    }
}

/// One sample in, the two of it at twice the rate out (no images above the passband)
#[derive(Clone, Copy, Default)]
pub struct Up2 {
    a: AllPassChain,
    b: AllPassChain,
}

impl Up2 {
    #[inline]
    pub fn tick(&mut self, x: f32) -> [f32; 2] {
        [self.a.tick(0, x), self.b.tick(1, x)]
    }
}

/// Two samples at twice the rate in, one out (what was above the passband filtered off first)
#[derive(Clone, Copy, Default)]
pub struct Down2 {
    a: AllPassChain,
    b: AllPassChain,
}

impl Down2 {
    #[inline]
    pub fn tick(&mut self, x: [f32; 2]) -> f32 {
        0.5 * (self.a.tick(0, x[1]) + self.b.tick(1, x[0]))
    }
}

// ---------- the shapers ----------

/// The drive shapes, with antiderivative antialiasing: each sample uses the shape's integral
/// across the step from the last sample, which takes most of the aliasing out of hard shapes.
#[derive(Clone, Copy, Default)]
pub struct Shaper {
    x1: f32,
    f1: f32,
    /// The shape used last sample (another one needs its own integral there)
    kind: u32,
}

#[inline]
fn shape(kind: u32, x: f32) -> f32 {
    match kind {
        1 => x.tanh(),
        2 => {
            // Warm: a cubic soft clip
            if x.abs() < 1.0 {
                x - x * x * x / 3.0
            } else {
                x.signum() * 2.0 / 3.0
            }
        }
        3 => x.clamp(-1.0, 1.0),
        4 => x.sin(),
        5 => (x + 0.35).tanh() - 0.336_376,
        // Tube: the top half rounds off as Soft does, the bottom half later and softer (lopsided:
        // even harmonics, as a valve stage)
        6 => {
            if x >= 0.0 {
                x.tanh()
            } else {
                (0.6 * x).tanh() / 0.6
            }
        }
        _ => x,
    }
}

/// The antiderivative of `shape` (for the antialiasing).
#[inline]
fn shape_integral(kind: u32, x: f32) -> f32 {
    match kind {
        1 => log_cosh(x),
        2 => {
            if x.abs() < 1.0 {
                x * x / 2.0 - x * x * x * x / 12.0
            } else {
                5.0 / 12.0 + 2.0 / 3.0 * (x.abs() - 1.0)
            }
        }
        3 => {
            if x.abs() <= 1.0 {
                x * x / 2.0
            } else {
                x.abs() - 0.5
            }
        }
        4 => -x.cos(),
        5 => log_cosh(x + 0.35) - 0.336_376 * x,
        6 => {
            if x >= 0.0 {
                log_cosh(x)
            } else {
                log_cosh(0.6 * x) / 0.36
            }
        }
        _ => x * x / 2.0,
    }
}

#[inline]
fn log_cosh(x: f32) -> f32 {
    let a = x.abs();
    // ln(cosh x) = |x| + ln(1 + e^-2|x|) - ln 2, steady for large x
    a + (1.0 + (-2.0 * a).exp()).ln() - std::f32::consts::LN_2
}

impl Shaper {
    #[inline]
    pub fn tick(&mut self, kind: u32, x: f32) -> f32 {
        // First-order ADAA: the shape's average across the step from the last sample. (Antialiasing
        // only the part the shape adds would leave the straight part half a sample early, and with
        // the drive's gain in front that mismatch is loud)
        if kind != self.kind {
            // Another shape: its own integral at the last sample (else a one-sample spike)
            self.kind = kind;
            self.f1 = shape_integral(kind, self.x1);
        }
        let f = shape_integral(kind, x);
        let dx = x - self.x1;
        let y = if dx.abs() < 1e-4 { shape(kind, 0.5 * (x + self.x1)) } else { (f - self.f1) / dx };
        self.x1 = x;
        self.f1 = f;
        y
    }
    pub fn reset(&mut self) {
        *self = Shaper::default();
    }
}

/// How much `kind` turns up a quiet signal at `gain`: dividing by it keeps the loudness steady as
/// the drive rises (more grit, not more level).
pub fn shaper_makeup(kind: u32, gain: f32) -> f32 {
    let probe = 0.3;
    // (Fold doesn't keep rising: measured through it, the makeup would swing with the drive.
    // Its peak level is what matters)
    let y = if kind == 4 { (probe * gain).min(1.0) } else { shape(kind, probe * gain).abs().max(1e-6) };
    // An RMS-ish match is closer than a peak match for driven sounds: blend toward the gain
    (y / probe).max(0.25)
}

// ---------- envelopes ----------

#[derive(Clone, Copy, PartialEq)]
pub enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

/// An ADSR with analog-like curves: the attack rises toward a point past full (so it ends
/// briskly), the decay and release fall exponentially.
#[derive(Clone, Copy)]
pub struct Env {
    pub stage: Stage,
    pub value: f32,
    a: f32,
    d: f32,
    s: f32,
    r: f32,
}

impl Default for Env {
    fn default() -> Self {
        Env { stage: Stage::Idle, value: 0.0, a: 0.0, d: 0.0, s: 1.0, r: 0.0 }
    }
}

/// The per-sample coefficient of an exponential that gets ~99.3 % of the way in `secs`.
#[inline]
fn rate(secs: f32, sr: f32) -> f32 {
    1.0 - (-5.0 / (secs.max(0.0005) * sr)).exp()
}

impl Env {
    pub fn set(&mut self, a: f32, d: f32, s: f32, r: f32, sr: f32) {
        // The attack rises toward 1.25 and stops at 1: this coefficient gets there in `a` seconds
        self.a = 1.0 - (-(5f32.ln()) / (a.max(0.0003) * sr)).exp();
        self.d = rate(d, sr);
        self.s = s;
        self.r = rate(r, sr);
    }
    pub fn gate(&mut self, on: bool) {
        if on {
            self.stage = Stage::Attack;
        } else if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }
    #[inline]
    pub fn tick(&mut self) -> f32 {
        match self.stage {
            Stage::Attack => {
                self.value += (1.25 - self.value) * self.a;
                if self.value >= 1.0 {
                    self.value = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.value += (self.s - self.value) * self.d;
                if (self.value - self.s).abs() < 1e-4 {
                    self.value = self.s;
                    self.stage = Stage::Sustain;
                }
            }
            // (Glides to a changed sustain level at the decay's pace, rather than jumping)
            Stage::Sustain => self.value += (self.s - self.value) * self.d,
            Stage::Release => {
                self.value += (0.0 - self.value) * self.r;
                if self.value < 1e-5 {
                    self.value = 0.0;
                    self.stage = Stage::Idle;
                }
            }
            Stage::Idle => {}
        }
        self.value
    }
}

// ---------- LFOs ----------

/// An LFO shape at `phase` (0..1), -1..1. `held` is the Steps/Drift shapes' random state.
#[inline]
pub fn lfo_shape(kind: u32, phase: f32, held: (f32, f32)) -> f32 {
    match kind {
        0 => (2.0 * PI * phase).sin(),
        1 => 1.0 - 4.0 * (phase - 0.5).abs(),
        2 => 2.0 * phase - 1.0,
        3 => 1.0 - 2.0 * phase,
        4 => {
            if phase < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        // Wobble: a square with rounded corners (the dubstep wobble's shape)
        5 => {
            let s = (2.0 * PI * phase).sin();
            fast_tanh(s * 3.0) / fast_tanh(3.0)
        }
        // Steps: a new random level each cycle
        6 => held.1,
        // Drift: gliding from one random level to the next
        _ => {
            let t = phase * phase * (3.0 - 2.0 * phase);
            held.0 + (held.1 - held.0) * t
        }
    }
}

// ---------- OTT ----------

/// Three bands of compression both ways, as the OTT does: loud parts of each band are turned
/// down, quiet parts turned up (capped), which makes a sound dense and present.
pub struct Ott {
    split: [[Svf; 4]; 2],
    split2: [[Svf; 4]; 2],
    env: [f32; 3],
    lo: SvfCoef,
    hi: SvfCoef,
}

impl Ott {
    /// Forget everything (turned back on, it starts clean rather than with old sound).
    pub fn reset(&mut self) {
        self.split = [[Svf::default(); 4]; 2];
        self.split2 = [[Svf::default(); 4]; 2];
        self.env = [0.0; 3];
    }

    pub fn new(sr: f32) -> Self {
        Ott {
            split: [[Svf::default(); 4]; 2],
            split2: [[Svf::default(); 4]; 2],
            env: [0.0; 3],
            // Linkwitz-Riley crossovers at 120 Hz and 2.5 kHz: two Butterworth sections each
            lo: SvfCoef::new(120.0, sr, std::f32::consts::SQRT_2),
            hi: SvfCoef::new(2500.0, sr, std::f32::consts::SQRT_2),
        }
    }

    /// One stereo frame through the OTT at `depth` (0..1), with attack/release coefficients.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, depth: f32, att: f32, rel: f32) -> (f32, f32) {
        let mut bands = [[0.0f32; 3]; 2];
        for (c, x) in [l, r].into_iter().enumerate() {
            let a = self.split[c][0].tick(&self.lo, x);
            let low = self.split[c][1].tick(&self.lo, a.lp).lp;
            let b = self.split[c][2].tick(&self.lo, x);
            let rest = self.split[c][3].tick(&self.lo, b.hp).hp;
            let m = self.split2[c][0].tick(&self.hi, rest);
            let mid = self.split2[c][1].tick(&self.hi, m.lp).lp;
            let h = self.split2[c][2].tick(&self.hi, rest);
            let high = self.split2[c][3].tick(&self.hi, h.hp).hp;
            bands[c] = [low, mid, high];
        }
        let mut out = [0.0f32; 2];
        for k in 0..3 {
            let level = bands[0][k].abs().max(bands[1][k].abs());
            let coef = if level > self.env[k] { att } else { rel };
            self.env[k] = flush(self.env[k] + (level - self.env[k]) * coef);
            let db = 20.0 * self.env[k].max(1e-6).log10();
            // Down above -24 dB (ratio up to 4:1), up below -40 dB (up to +12 dB), nothing
            // under -70 dB (silence and noise stay down)
            let mut g = 0.0;
            if db > -24.0 {
                g -= (db + 24.0) * (1.0 - 1.0 / (1.0 + 3.0 * depth));
            } else if db < -40.0 {
                // (Tapering to nothing from -64 to -70 dB: a tail fading through doesn't step)
                g += ((-40.0 - db) * 0.6).min(12.0).min((db + 70.0) * 2.0).max(0.0) * depth;
            }
            // The low band is only turned down, never up: the sub stays steady
            if k == 0 && g > 0.0 {
                g = 0.0;
            }
            let gain = 10f32.powf(g / 20.0);
            out[0] += bands[0][k] * gain;
            out[1] += bands[1][k] * gain;
        }
        // Make up some of the level the downward side took away (OTT's own output gain)
        let makeup = 10f32.powf(depth * 5.0 / 20.0);
        (out[0] * makeup, out[1] * makeup)
    }
}

// ---------- the safety clipper ----------

/// A soft ceiling at -1 dBFS, antialiased: whatever a patch does, nothing leaves this synth
/// louder than that, and it rounds off rather than cracks. Below the knee (-4.4 dBFS) the sound
/// passes untouched.
#[derive(Clone, Copy, Default)]
pub struct SafetyClip;

const CEIL: f32 = 0.891; // -1 dBFS
const KNEE: f32 = 0.6;

#[inline]
fn knee(x: f32) -> f32 {
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        x.signum() * (KNEE + (CEIL - KNEE) * ((a - KNEE) / (CEIL - KNEE)).tanh())
    }
}

impl SafetyClip {
    /// The knee as it is, sample by sample. It's the last guard, so it stays simple: exact below
    /// the knee, never past the ceiling, never the wrong sign, whatever comes in. (Antialiasing
    /// it shifted the sound half a sample against the part below the knee, and flipped the sign
    /// on big steps; the knee is gentle enough that the little it aliases stays far down)
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        // (A broken sample is silent)
        if !x.is_finite() {
            return 0.0;
        }
        knee(x)
    }
}

/// Takes out DC (a one-pole high-pass at about 5 Hz): a lopsided drive or warp leaves an offset
/// that thumps as notes start and stop.
#[derive(Clone, Copy, Default)]
pub struct DcBlock {
    x1: f32,
    y1: f32,
}

impl DcBlock {
    #[inline]
    pub fn tick(&mut self, x: f32, r: f32) -> f32 {
        // (A broken sample is silent, and never sticks)
        if !x.is_finite() {
            *self = DcBlock::default();
            return 0.0;
        }
        let y = flush(x - self.x1 + r * self.y1);
        self.x1 = x;
        self.y1 = y;
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svf_low_pass_passes_bass_and_cuts_treble() {
        let sr = 48000.0;
        let c = SvfCoef::new(500.0, sr, 1.414);
        let level = |f: f32| {
            let mut s = Svf::default();
            let mut peak: f32 = 0.0;
            for n in 0..48000 {
                let y = s.tick(&c, (2.0 * PI * f * n as f32 / sr).sin()).lp;
                if n > 24000 {
                    peak = peak.max(y.abs());
                }
            }
            peak
        };
        assert!(level(50.0) > 0.95);
        assert!(level(8000.0) < 0.01);
    }

    #[test]
    fn comb_with_high_feedback_stays_bounded() {
        let mut c = Comb::new(48000.0);
        let mut peak: f32 = 0.0;
        for n in 0..96000 {
            let x = if n < 100 { 1.0 } else { 0.0 };
            peak = peak.max(c.tick(x, 109.0, 0.99, false).abs());
        }
        assert!(peak < 4.0, "comb peaked at {peak}");
    }

    #[test]
    fn shaper_integral_matches_shape() {
        for kind in 1..=6 {
            for i in -30..30 {
                let x = i as f32 * 0.1;
                let h = 1e-2;
                let d = (shape_integral(kind, x + h) - shape_integral(kind, x - h)) / (2.0 * h);
                assert!((d - shape(kind, x)).abs() < 0.02, "kind {kind} at {x}: {d} vs {}", shape(kind, x));
            }
        }
    }

    #[test]
    fn safety_clip_never_passes_the_ceiling() {
        for amp in [8.0, 100.0, 1000.0, 1e5] {
            let mut c = SafetyClip::default();
            for i in 0..10000 {
                let x = (i as f32 * 0.01).sin() * amp;
                assert!(c.tick(x).abs() <= 0.9, "amplitude {amp}");
            }
        }
    }

    #[test]
    fn comb_rings_at_its_pitch() {
        for (hz, neg) in [(440.0f32, false), (2000.0, false), (1000.0, true)] {
            let sr = 48000.0;
            // (Comb − too: half a period, fed back upside down, peaks at the pitch and its odd harmonics)
            let peak_at = hz;
            // Where the comb answers loudest, within a semitone: its resonance
            let gain = |f: f32| {
                let mut c = Comb::new(sr);
                let mut peak: f32 = 0.0;
                for i in 0..24000 {
                    let y = c.tick((2.0 * PI * f * i as f32 / sr).sin() * 0.01, sr / hz, 0.9, neg);
                    if i > 12000 {
                        peak = peak.max(y.abs());
                    }
                }
                peak
            };
            let best: i32 = (-100..=100).step_by(2).max_by(|&a, &b| gain(peak_at * 2f32.powf(a as f32 / 1200.0)).partial_cmp(&gain(peak_at * 2f32.powf(b as f32 / 1200.0))).unwrap()).unwrap();
            assert!(best.abs() <= 8, "{hz} Hz (negative {neg}): resonates {best} cents off");
        }
    }

    #[test]
    fn the_comb_sounds_the_same_at_any_sample_rate() {
        let gain = |sr: f32| {
            let mut c = Comb::new(sr);
            let f = 261.6 * 20.0;
            let mut peak: f32 = 0.0;
            for i in 0..(sr as usize) {
                let y = c.tick((2.0 * PI * f * i as f32 / sr).sin() * 0.01, sr / 261.6, 0.97, false);
                if i > sr as usize / 2 {
                    peak = peak.max(y.abs());
                }
            }
            20.0 * (peak / 0.01).log10()
        };
        let (a, b) = (gain(48000.0), gain(96000.0));
        assert!((a - b).abs() < 1.5, "48 kHz {a} dB, 96 kHz {b} dB");
    }


    #[test]
    fn quiet_sound_passes_the_ceiling_and_drive_untouched() {
        for sr in [44100.0f32, 96000.0] {
            let mut c = SafetyClip::default();
            let mut peak: f32 = 0.0;
            for i in 0..4800 {
                let x = 0.3 * (2.0 * PI * 15000.0 * i as f32 / sr).sin();
                let y = c.tick(x);
                if i > 100 {
                    peak = peak.max((y - x).abs());
                }
            }
            assert!(peak < 1e-5, "{sr}: changed by {peak}");
        }
    }

    #[test]
    fn changing_the_drive_shape_does_not_spike() {
        let mut s = Shaper::default();
        let mut worst: f32 = 0.0;
        for i in 0..4000 {
            let kind = if i < 2000 { 1 } else { 4 };
            let x = 0.05 * (i as f32 * 0.02).sin();
            worst = worst.max(s.tick(kind, x).abs());
        }
        assert!(worst < 0.1, "spiked to {worst}");
    }

    /// A band-limited saw (a few harmonics), the steepest thing the oscillators send.
    fn saw(i: usize, hz: f32, sr: f32) -> f32 {
        (1..40).map(|k| (2.0 * PI * hz * k as f32 * i as f32 / sr).sin() / k as f32).sum::<f32>() * 0.55
    }

    #[test]
    fn heavy_drive_on_a_saw_stays_level() {
        let sr = 48000.0;
        for kind in 1..=5u32 {
            for db in [24.0f32, 36.0, 48.0] {
                let gain = 10f32.powf(db / 20.0);
                let makeup = shaper_makeup(kind, gain);
                let mut s = Shaper::default();
                let peak = (0..9600).map(|i| (s.tick(kind, 0.5 * saw(i, 110.0, sr) * gain) / makeup).abs()).fold(0.0, f32::max);
                // (A clipping shape tops out at 1 before the makeup, the lopsided one at 1.34)
                assert!(peak * makeup < 1.4, "kind {kind} at {db} dB: peak {}", peak * makeup);
            }
        }
    }

    #[test]
    fn fold_drive_keeps_its_level_as_the_drive_rises() {
        let sr = 48000.0;
        let level = |db: f32| {
            let gain = 10f32.powf(db / 20.0);
            let mut s = Shaper::default();
            let sum: f32 = (0..9600).map(|i| (s.tick(4, 0.3 * (2.0 * PI * 130.0 * i as f32 / sr).sin() * gain) / shaper_makeup(4, gain)).powi(2)).sum();
            10.0 * (sum / 9600.0).log10()
        };
        let levels: Vec<f32> = [12.0, 16.0, 18.0, 20.0, 22.0, 24.0, 30.0, 36.0].iter().map(|&d| level(d)).collect();
        let (lo, hi) = levels.iter().fold((f32::MAX, f32::MIN), |(a, b), &l| (a.min(l), b.max(l)));
        assert!(hi - lo < 6.0, "levels {levels:?}");
    }

    #[test]
    fn sound_just_past_the_knee_stays_clean() {
        // What's left after taking out the sine: the knee's own rounding is tiny there
        let sr = 48000.0;
        for hz in [1000.0f32, 3000.0, 6000.0] {
            let mut c = SafetyClip::default();
            let (mut err, mut sig) = (0.0f32, 0.0f32);
            for i in 0..9600 {
                let x = 0.61 * (2.0 * PI * hz * i as f32 / sr).sin();
                let y = c.tick(x);
                if i > 100 {
                    err += (y - knee(x)).powi(2);
                    sig += x * x;
                }
            }
            let db = 10.0 * (err / sig).log10();
            assert!(db < -40.0, "{hz} Hz: {db} dB off the knee");
        }
    }

    #[test]
    fn a_broken_sample_does_not_stick() {
        let mut c = SafetyClip::default();
        assert_eq!(c.tick(f32::NAN), 0.0);
        assert!(c.tick(0.3).is_finite() && c.tick(0.95).abs() < CEIL);
    }

    #[test]
    fn the_safety_clip_keeps_the_sign_and_the_ceiling_on_any_jump() {
        let mut c = SafetyClip::default();
        for (a, b) in [(3.0f32, 0.6), (100.0, 0.5), (3.6, -0.4), (1e20, 0.2), (-50.0, 0.7)] {
            c.tick(a);
            let y = c.tick(b);
            assert!(y.signum() == b.signum() && y.abs() <= b.abs() && y.abs() < CEIL, "{a} -> {b}: {y}");
        }
        // Loud steady sound sits just under the ceiling (-1 dBFS)
        assert!(c.tick(5.0) > 0.88 && c.tick(5.0) <= CEIL);
    }

    #[test]
    fn ott_lift_fades_out_without_a_step() {
        // A tone fading out slowly: the OTT's gain never jumps from one moment to the next
        let sr: f32 = 48000.0;
        let mut o = Ott::new(sr);
        let (att, rel) = (1.0 - (-1.0 / (0.005 * sr)).exp(), 1.0 - (-1.0 / (0.1 * sr)).exp());
        let mut last = f32::NAN;
        let mut worst: f32 = 0.0;
        for w in 0..300 {
            let amp = 10f32.powf((-50.0 - w as f32 * 0.1) / 20.0);
            let mut sum = 0.0f32;
            for i in 0..480 {
                let x = amp * (2.0 * PI * 1000.0 * (w * 480 + i) as f32 / sr).sin();
                let (l, _) = o.tick(x, x, 1.0, att, rel);
                sum += l * l;
            }
            let db = 10.0 * (sum / 480.0).log10() - 20.0 * amp.log10();
            if w > 20 && last.is_finite() {
                worst = worst.max((db - last).abs());
            }
            last = db;
        }
        assert!(worst < 2.0, "gain stepped by {worst} dB");
    }

    #[test]
    fn dc_goes_and_bass_stays() {
        let sr = 48000.0;
        let r = 1.0 - 2.0 * PI * 5.0 / sr;
        let mut d = DcBlock::default();
        let (mut dc, mut peak) = (0.0f32, 0.0f32);
        for i in 0..96000 {
            let y = d.tick(0.3 + 0.2 * (2.0 * PI * 40.0 * i as f32 / sr).sin(), r);
            if i > 48000 {
                dc += y;
                peak = peak.max(y.abs());
            }
        }
        assert!((dc / 48000.0).abs() < 0.002 && peak > 0.195, "dc {} peak {peak}", dc / 48000.0);
    }

    #[test]
    fn loud_steep_sound_rounds_off_below_the_ceiling() {
        let sr = 48000.0;
        for amp in [1.0f32, 1.5] {
            let mut c = SafetyClip::default();
            let pinned = (0..48000).filter(|&i| c.tick(amp * saw(i, 110.0, sr)).abs() >= CEIL - 1e-4).count();
            assert!(pinned == 0, "amp {amp}: {pinned} samples on the ceiling");
        }
    }

}
