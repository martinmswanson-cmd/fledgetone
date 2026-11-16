//! LFO shapes.

use crate::math::fast_tanh;
use std::f32::consts::PI;

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
