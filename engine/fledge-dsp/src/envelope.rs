//! Envelopes.

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
    /// The most its decay and sustain go to (a note carried into a new sound at the level it had,
    /// see carry); none for a note struck
    top: f32,
}

impl Default for Env {
    fn default() -> Self {
        Env { stage: Stage::Idle, value: 0.0, a: 0.0, d: 0.0, s: 1.0, r: 0.0, top: f32::INFINITY }
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
            self.top = f32::INFINITY;
        } else if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }
    /// Gated on, from `value` (a note carried into a new sound): still rising (`rising`), it goes
    /// on up as the new attack does; past its attack, it falls to the new sustain level if that is
    /// lower and never rises above `value`.
    pub fn carry(&mut self, value: f32, rising: bool) {
        self.value = value;
        if rising {
            self.stage = Stage::Attack;
            self.top = f32::INFINITY;
        } else {
            self.stage = Stage::Decay;
            self.top = value;
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
                let s = self.s.min(self.top);
                self.value += (s - self.value) * self.d;
                if (self.value - s).abs() < 1e-4 {
                    self.value = s;
                    self.stage = Stage::Sustain;
                }
            }
            // (Glides to a changed sustain level at the decay's pace, rather than jumping)
            Stage::Sustain => self.value += (self.s.min(self.top) - self.value) * self.d,
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
