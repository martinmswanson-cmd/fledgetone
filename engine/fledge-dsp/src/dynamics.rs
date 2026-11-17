//! Dynamics: the three-band up-and-down compressor.

use crate::filter::{Svf, SvfCoef};
use crate::math::flush;

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

    /// One stereo frame split into its three bands.
    #[inline]
    fn split(&mut self, l: f32, r: f32) -> [[f32; 3]; 2] {
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
        bands
    }

    /// Band `k`'s level follows the sound (`bands`).
    #[inline]
    fn follow(&mut self, bands: &[[f32; 3]; 2], k: usize, att: f32, rel: f32) {
        let level = bands[0][k].abs().max(bands[1][k].abs());
        let coef = if level > self.env[k] { att } else { rel };
        self.env[k] = flush(self.env[k] + (level - self.env[k]) * coef);
    }

    /// One stereo frame heard while the OTT is off: its bands and their levels follow the sound,
    /// so turned on (a preset chosen mid-note, a lane), it starts where that sound is. From
    /// silence's levels it boosted the sound and under-compressed it until they caught up:
    /// louder than the setting plays, for as long as its attack.
    #[inline]
    pub fn track(&mut self, l: f32, r: f32, att: f32, rel: f32) {
        let bands = self.split(l, r);
        for k in 0..3 {
            self.follow(&bands, k, att, rel);
        }
    }

    /// One stereo frame through the OTT at `depth` (0..1), with attack/release coefficients.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32, depth: f32, att: f32, rel: f32) -> (f32, f32) {
        let bands = self.split(l, r);
        let mut out = [0.0f32; 2];
        for k in 0..3 {
            self.follow(&bands, k, att, rel);
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
