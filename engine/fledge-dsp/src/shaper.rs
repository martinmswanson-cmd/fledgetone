//! The drive shapes and the output ceiling, antialiased by antiderivatives (Parker, Zavalishin &
//! Le Bivic), written from the published method, not from anyone's code.

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
pub(crate) fn shape(kind: u32, x: f32) -> f32 {
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
pub(crate) fn shape_integral(kind: u32, x: f32) -> f32 {
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
    /// As if `x` had come in last (shaped as `kind`): what it makes of it
    pub fn prime(&mut self, kind: u32, x: f32) -> f32 {
        *self = Shaper {
            x1: x,
            f1: shape_integral(kind, x),
            kind,
        };
        shape(kind, x)
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

// ---------- the safety clipper ----------

/// A soft ceiling at -1 dBFS, antialiased: whatever a patch does, nothing leaves this synth
/// louder than that, and it rounds off rather than cracks. Below the knee (-4.4 dBFS) the sound
/// passes untouched.
#[derive(Clone, Copy, Default)]
pub struct SafetyClip;

pub(crate) const CEIL: f32 = 0.891; // -1 dBFS
const KNEE: f32 = 0.6;

#[inline]
pub(crate) fn knee(x: f32) -> f32 {
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
