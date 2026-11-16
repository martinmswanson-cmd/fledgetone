//! Small things everything else uses: denormal flushing, a fast tanh, a seeded random generator.

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

/// tanh, close enough for audio (a Padé approximant, clamped).
#[inline]
pub fn fast_tanh(x: f32) -> f32 {
    let x = x.clamp(-4.0, 4.0);
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
