//! A bank of bands across the spectrum: how loud a sound is in each (`Bank`), and a bell filter
//! to turn each one down or up by (`Bell`). Together they treat a sound band by band with no
//! added delay: nothing is cut into frames, so what comes out is in step with what went in.

use crate::filter::{Svf, SvfCoef};
use crate::math::flush;

/// A bell (peaking) filter with its own width: `db` of gain at `f` Hz, `q` wide (the textbook
/// form, as in Robert Bristow-Johnson's cookbook). At 0 dB it passes the sound unchanged.
#[derive(Clone, Copy)]
pub struct Bell {
    // (In f64, coefficients and what it remembers both: a narrow bell low down at a high sample
    // rate has coefficients a hair from 1 and 2, and in f32 that hair is lost. 18 dB asked for at
    // 20 Hz came out as 9 at 192 kHz)
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Default for Bell {
    fn default() -> Self {
        Bell { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }
}

impl Bell {
    pub fn set(&mut self, f: f32, db: f32, q: f32, sr: f32) {
        let a = 10f64.powf(db as f64 / 40.0);
        let w = 2.0 * std::f64::consts::PI * (f.clamp(10.0, sr * 0.45) / sr) as f64;
        let alpha = w.sin() / (2.0 * q.max(0.05) as f64);
        let a0 = 1.0 + alpha / a;
        self.b0 = (1.0 + alpha * a) / a0;
        self.b1 = -2.0 * w.cos() / a0;
        self.b2 = (1.0 - alpha * a) / a0;
        self.a1 = self.b1;
        self.a2 = (1.0 - alpha / a) / a0;
    }
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        // (The transposed form: its coefficients can change while it runs without a jump)
        let x = x as f64;
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        // (What it remembers dies away to nothing rather than to numbers too small to be worth the time)
        if self.z1.abs() < 1e-30 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1e-30 {
            self.z2 = 0.0;
        }
        y as f32
    }
    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// How loud a stereo sound is in each of `count` bands spaced evenly by pitch from `lo` to `hi`
/// Hz: a band-pass each (two in a row, so a note in one band barely shows in the next but one),
/// its level followed (up at once, down over `fall` seconds).
pub struct Bank {
    /// Each band's centre, Hz
    pub hz: Vec<f32>,
    /// How wide a band is (a bell this wide at each centre just meets its neighbours)
    pub q: f32,
    coef: Vec<SvfCoef>,
    filters: Vec<[[Svf; 2]; 2]>,
    /// Each band's level now (1 is a full-level sine at its centre)
    pub level: Vec<f32>,
    fall: f32,
}

impl Bank {
    pub fn new(sr: f32, count: usize, lo: f32, hi: f32, fall: f32) -> Bank {
        let hi = hi.min(sr * 0.45);
        let step = (hi / lo).powf(1.0 / (count.max(2) - 1) as f32);
        let q = step.sqrt() / (step - 1.0);
        let hz: Vec<f32> = (0..count).map(|k| lo * step.powi(k as i32)).collect();
        let coef = hz.iter().map(|&f| SvfCoef::new(f, sr, 1.0 / q)).collect();
        Bank { hz, q, coef, filters: vec![[[Svf::default(); 2]; 2]; count], level: vec![0.0; count], fall: (-1.0 / (fall * sr)).exp() }
    }

    /// One stereo frame heard.
    #[inline]
    pub fn hear(&mut self, l: f32, r: f32) {
        // (A sample that isn't a number counts as silence: it mustn't stick in a filter)
        let (l, r) = (if l.is_finite() { l } else { 0.0 }, if r.is_finite() { r } else { 0.0 });
        let k = 1.0 / self.q;
        for b in 0..self.hz.len() {
            // (The band-pass is 1/k loud at its centre: times k, a sine there comes out as it went in)
            let c = &self.coef[b];
            let f = &mut self.filters[b];
            let (al, ar) = (f[0][0].tick(c, l).bp * k, f[1][0].tick(c, r).bp * k);
            let (yl, yr) = (f[0][1].tick(c, al).bp * k, f[1][1].tick(c, ar).bp * k);
            let now = yl.abs().max(yr.abs());
            self.level[b] = flush(now.max(self.level[b] * self.fall));
        }
    }

    /// A band's level in dB (-120 for silence).
    #[inline]
    pub fn db(&self, b: usize) -> f32 {
        20.0 * self.level[b].max(1e-6).log10()
    }

    pub fn reset(&mut self) {
        for f in &mut self.filters {
            *f = [[Svf::default(); 2]; 2];
        }
        self.level.fill(0.0);
    }
}

/// A bell on each of a bank's bands, each turned down by its own amount, eased so nothing jumps.
pub struct Cuts {
    hz: Vec<f32>,
    q: f32,
    sr: f32,
    /// How far each band is turned down now, dB (0 or more)
    pub cut: Vec<f32>,
    set: Vec<f32>,
    bells: Vec<[Bell; 2]>,
}

impl Cuts {
    /// Bells for `bank`'s bands.
    pub fn new(bank: &Bank, sr: f32) -> Cuts {
        let n = bank.hz.len();
        Cuts { hz: bank.hz.clone(), q: bank.q, sr, cut: vec![0.0; n], set: vec![0.0; n], bells: vec![[Bell::default(); 2]; n] }
    }

    /// Band `b`'s cut moves toward `to` dB: `attack` of the way if that's deeper, `release` if shallower.
    #[inline]
    pub fn ease(&mut self, b: usize, to: f32, attack: f32, release: f32) {
        let c = if to > self.cut[b] { attack } else { release };
        self.cut[b] += (to - self.cut[b]) * c;
        if self.cut[b] < 0.005 && to <= 0.0 {
            self.cut[b] = 0.0;
        }
        // (A bell is only worked out again once its cut has moved a twentieth of a dB)
        if (self.cut[b] - self.set[b]).abs() > 0.05 || (self.cut[b] == 0.0 && self.set[b] != 0.0) {
            self.set[b] = self.cut[b];
            let (f, db) = (self.hz[b], -self.cut[b]);
            for bell in &mut self.bells[b] {
                bell.set(f, db, self.q, self.sr);
            }
        }
    }

    /// One stereo frame through every bell.
    #[inline]
    pub fn tick(&mut self, mut l: f32, mut r: f32) -> (f32, f32) {
        for bell in &mut self.bells {
            l = bell[0].tick(l);
            r = bell[1].tick(r);
        }
        (l, r)
    }

    pub fn reset(&mut self) {
        self.cut.fill(0.0);
        self.set.fill(0.0);
        self.bells.fill([Bell::default(); 2]);
    }
}
