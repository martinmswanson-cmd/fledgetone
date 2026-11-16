//! Twice the sample rate and back, for anything that would alias at the base rate.

use crate::math::flush;

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
    /// As if `v` had come in for ever
    fn prime(&mut self, v: f32) {
        *self = AllPassChain {
            x: [v; 4],
            y: [v; 4],
        };
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
    /// As if `x` had come in for ever (started mid-sound, it doesn't rise from nothing)
    pub fn prime(&mut self, x: f32) {
        self.a.prime(x);
        self.b.prime(x);
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
    /// As if `x` had come in for ever
    pub fn prime(&mut self, x: f32) {
        self.a.prime(x);
        self.b.prime(x);
    }
}
