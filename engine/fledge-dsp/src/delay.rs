//! A delay line read between samples.

#[derive(Clone)]
pub struct Line {
    buf: Vec<f32>,
    w: usize,
}

impl Line {
    pub fn new(len: usize) -> Self {
        Line { buf: vec![0.0; len.max(4)], w: 0 }
    }
    /// How many samples the line holds.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.buf.len()
    }
    #[inline]
    pub fn push(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w = (self.w + 1) % self.buf.len();
    }
    /// The sample `d` samples ago (fractional, linear), the one just pushed being 1 ago.
    #[inline]
    pub fn read(&self, d: f32) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(1.0, (n - 2) as f32);
        let rp = self.w as f32 + n as f32 - d;
        let i = rp as usize;
        let t = rp - i as f32;
        let a = self.buf[i % n];
        let b = self.buf[(i + 1) % n];
        a + (b - a) * t
    }
    /// The same, read through a 4-point Hermite curve: for a line whose length keeps moving (the
    /// chorus, the flanger), where a straight line between samples dulls the highs by a different
    /// amount every sample, which came out as a grainy hiss over bright sounds
    #[inline]
    pub fn read_cubic(&self, d: f32) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(2.0, (n - 3) as f32);
        let rp = self.w as f32 + n as f32 - d;
        let i = rp as usize;
        let t = rp - i as f32;
        let (xm, x0, x1, x2) = (self.buf[(i + n - 1) % n], self.buf[i % n], self.buf[(i + 1) % n], self.buf[(i + 2) % n]);
        let c1 = 0.5 * (x1 - xm);
        let c2 = xm - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
        let c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
        ((c3 * t + c2) * t + c1) * t + x0
    }
    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// A bright tone read from a line between samples, as the chorus and the flanger read it: the
    /// Hermite read is far closer to the tone itself than a straight line between samples
    #[test]
    fn a_moving_read_stays_close_to_the_tone() {
        let (sr, hz) = (48000.0f32, 10000.0f32);
        let mut line = Line::new(4800);
        let (mut cubic, mut straight, mut all) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..20000 {
            line.push((2.0 * PI * hz * i as f32 / sr).sin());
            if i > 1000 {
                // A delay sweeping across fractions of a sample, as a chorus's does
                let d = 200.0 + 50.0 * (i as f32 * 0.001).sin();
                let want = (2.0 * PI * hz * (i as f32 + 1.0 - d) / sr).sin() as f64;
                cubic += (line.read_cubic(d) as f64 - want).powi(2);
                straight += (line.read(d) as f64 - want).powi(2);
                all += want * want;
            }
        }
        let (c, s) = (10.0 * (cubic / all).log10(), 10.0 * (straight / all).log10());
        assert!(c < -24.0 && c < s - 10.0, "cubic {c:.1} dB, straight {s:.1} dB");
    }
}
