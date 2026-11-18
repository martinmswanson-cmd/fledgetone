//! Filters: the state-variable filter, the ladder, a pitched comb, vowel formants, shelving and
//! peak biquads, one-pole smoothing and a DC blocker. Written from the published methods
//! (Zavalishin's "The Art of VA Filter Design" and Simper's trapezoidal SVF, the RBJ cookbook
//! biquads), not from anyone's code.

use crate::math::{fast_tanh, flush};
use std::f32::consts::PI;

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
    /// Moves `s` of the way to `to` (0 stays, 1 arrives): coefficients gliding to a new setting
    /// over a few samples rather than stepping there
    #[inline]
    pub fn toward(&mut self, to: &SvfCoef, s: f32) {
        self.k += (to.k - self.k) * s;
        self.a1 += (to.a1 - self.a1) * s;
        self.a2 += (to.a2 - self.a2) * s;
        self.a3 += (to.a3 - self.a3) * s;
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

// ---------- shelves and peaks ----------

#[derive(Clone, Copy, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    /// 0 low shelf, 1 peak (Q 0.9), 2 high shelf, at `f` Hz with `db` of gain.
    pub fn set(&mut self, kind: u32, f: f32, db: f32, sr: f32) {
        let a = 10f32.powf(db / 40.0);
        let w = 2.0 * PI * f.clamp(10.0, sr * 0.45) / sr;
        let (cw, sw) = (w.cos(), w.sin());
        let (b0, b1, b2, a0, a1, a2);
        match kind {
            1 => {
                let alpha = sw / (2.0 * 0.9);
                b0 = 1.0 + alpha * a;
                b1 = -2.0 * cw;
                b2 = 1.0 - alpha * a;
                a0 = 1.0 + alpha / a;
                a1 = -2.0 * cw;
                a2 = 1.0 - alpha / a;
            }
            _ => {
                // Shelves with a slope of 1
                let alpha = sw / 2.0 * 2f32.sqrt();
                let sa = 2.0 * a.sqrt() * alpha;
                // (+1 makes the low shelf of these formulas, -1 the high)
                let s = if kind == 0 { 1.0 } else { -1.0 };
                b0 = a * ((a + 1.0) - s * (a - 1.0) * cw + sa);
                b1 = 2.0 * s * a * ((a - 1.0) - s * (a + 1.0) * cw);
                b2 = a * ((a + 1.0) - s * (a - 1.0) * cw - sa);
                a0 = (a + 1.0) + s * (a - 1.0) * cw + sa;
                a1 = -2.0 * s * ((a - 1.0) + s * (a + 1.0) * cw);
                a2 = (a + 1.0) + s * (a - 1.0) * cw - sa;
            }
        }
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = flush(self.b1 * x - self.a1 * y + self.z2);
        self.z2 = flush(self.b2 * x - self.a2 * y);
        y
    }
}

// ---------- one pole ----------

/// One step of a one-pole low pass with coefficient `c` (0..1).
#[inline]
pub fn lp(state: &mut f32, x: f32, c: f32) -> f32 {
    *state = flush(*state + (x - *state) * c);
    *state
}

/// The coefficient for `lp` that turns over at `f` Hz.
pub fn one_pole(f: f32, sr: f32) -> f32 {
    1.0 - (-2.0 * PI * f / sr).exp()
}

// ---------- DC ----------

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
