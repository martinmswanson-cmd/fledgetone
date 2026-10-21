//! The synth's own effects, after the voices: EQ, chorus, phaser or flanger, delay and reverb.
//! They're part of a preset (a pad's reverb, a lead's delay) and run only when switched on.
//! Written from the textbook forms (the RBJ cookbook biquads, a feedback delay network reverb
//! with a Hadamard mixing matrix), not from anyone's code.

use crate::dsp::{fast_tanh, flush};
use std::f32::consts::PI;

// ---------- EQ ----------

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

// ---------- a delay line ----------

#[derive(Clone)]
pub struct Line {
    buf: Vec<f32>,
    w: usize,
}

impl Line {
    pub fn new(len: usize) -> Self {
        Line { buf: vec![0.0; len.max(4)], w: 0 }
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
    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
    }
}

/// One step of a one-pole low pass with coefficient `c` (0..1).
#[inline]
fn lp(state: &mut f32, x: f32, c: f32) -> f32 {
    *state = flush(*state + (x - *state) * c);
    *state
}

fn one_pole(f: f32, sr: f32) -> f32 {
    1.0 - (-2.0 * PI * f / sr).exp()
}

// ---------- settings ----------

/// The effects' settings for one block (in the engine's units).
#[derive(Clone, Copy, Default)]
pub struct FxCfg {
    pub eq: bool,
    pub eq_low: (f32, f32),
    pub eq_mid: (f32, f32),
    pub eq_high: (f32, f32),
    pub chorus: bool,
    pub chorus_rate: f32,
    pub chorus_depth: f32,
    pub chorus_mix: f32,
    pub phaser: bool,
    pub flanger: bool,
    pub phaser_rate: f32,
    pub phaser_depth: f32,
    pub phaser_fb: f32,
    pub phaser_mix: f32,
    pub delay: bool,
    /// Seconds
    pub delay_time: f32,
    pub delay_fb: f32,
    pub delay_pingpong: bool,
    pub delay_tone: f32,
    pub delay_mix: f32,
    pub reverb: bool,
    pub reverb_size: f32,
    pub reverb_decay: f32,
    pub reverb_tone: f32,
    pub reverb_pre: f32,
    pub reverb_mix: f32,
}

/// Mixes moved by modulation this stretch of samples (added to the settings' own).
#[derive(Clone, Copy, Default)]
pub struct FxMods {
    pub chorus: f32,
    pub phaser: f32,
    pub delay: f32,
    pub reverb: f32,
}

const REVERB_LINES: usize = 8;
/// The reverb's line lengths at its smallest, in ms (no two share a factor, so echoes don't stack)
const REVERB_MS: [f32; REVERB_LINES] = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.3, 73.1];
const DIFFUSE_MS: [f32; 4] = [4.7, 3.6, 12.7, 9.3];

pub struct Effects {
    sr: f32,
    eq: [[Biquad; 3]; 2],
    eq_key: [f32; 6],
    chorus: [Line; 2],
    chorus_phase: f32,
    phaser_ap: [[f32; 6]; 2],
    phaser_last: [f32; 2],
    phaser_phase: f32,
    flanger: [Line; 2],
    delay: [Line; 2],
    delay_now: f32,
    /// The reverb's size and pre-delay (samples) as they glide to their settings
    size_now: f32,
    pre_now: f32,
    delay_lp: [f32; 2],
    pre: Line,
    diffuse: [Line; 4],
    lines: [Line; REVERB_LINES],
    damp: [f32; REVERB_LINES],
    reverb_mod: f32,
    was_on: [bool; 4],
    /// The phaser unit was a flanger last block
    was_flanger: bool,
    /// The EQ ran last block
    was_eq: bool,
}

impl Effects {
    pub fn new(sr: f32) -> Self {
        let ms = |m: f32| (m * 0.001 * sr) as usize + 4;
        Effects {
            sr,
            eq: [[Biquad::default(); 3]; 2],
            eq_key: [f32::NAN; 6],
            chorus: [Line::new(ms(40.0)), Line::new(ms(40.0))],
            chorus_phase: 0.0,
            phaser_ap: [[0.0; 6]; 2],
            phaser_last: [0.0; 2],
            phaser_phase: 0.0,
            flanger: [Line::new(ms(15.0)), Line::new(ms(15.0))],
            delay: [Line::new(ms(4000.0)), Line::new(ms(4000.0))],
            delay_now: 0.0,
            size_now: -1.0,
            pre_now: 0.0,
            delay_lp: [0.0; 2],
            pre: Line::new(ms(160.0)),
            diffuse: DIFFUSE_MS.map(|m| Line::new(ms(m * 2.2))),
            // (Room for the largest size plus the lines' slow wobble)
            lines: REVERB_MS.map(|m| Line::new(ms(m * 2.2) + (0.0013 * sr) as usize)),
            damp: [0.0; REVERB_LINES],
            reverb_mod: 0.0,
            was_on: [false; 4],
            was_flanger: false,
            was_eq: false,
        }
    }

    /// Run `frames` stereo samples in place; `mods` gives each stretch of `step` samples' mix
    /// modulation.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], frames: usize, c: &FxCfg, mods: &[FxMods], step: usize) {
        let sr = self.sr;
        // An effect switched back on starts clean (no old echoes)
        let on = [c.chorus, c.phaser, c.delay, c.reverb];
        if c.delay && !self.was_on[2] {
            self.delay.iter_mut().for_each(Line::clear);
            self.delay_now = c.delay_time * sr;
        }
        if c.reverb && !self.was_on[3] {
            self.pre.clear();
            self.diffuse.iter_mut().for_each(Line::clear);
            self.lines.iter_mut().for_each(Line::clear);
            self.damp = [0.0; REVERB_LINES];
            self.size_now = c.reverb_size;
            self.pre_now = (c.reverb_pre * 0.001 * sr).max(1.0);
        }
        if c.chorus && !self.was_on[0] {
            self.chorus.iter_mut().for_each(Line::clear);
        }
        // The phaser or the flanger, coming in (switched on, or the mode changed), starts clean
        let was_running = |flanger: bool| self.was_on[1] && self.was_flanger == flanger;
        if c.phaser && c.flanger && !was_running(true) {
            self.flanger.iter_mut().for_each(Line::clear);
        }
        if c.phaser && !c.flanger && !was_running(false) {
            self.phaser_ap = [[0.0; 6]; 2];
            self.phaser_last = [0.0; 2];
        }
        self.was_flanger = c.flanger;
        self.was_on = on;

        if c.eq && !self.was_eq {
            // Back on: no thump from where its filters were left
            self.eq = [[Biquad::default(); 3]; 2];
            self.eq_key = [f32::NAN; 6];
        }
        self.was_eq = c.eq;
        if c.eq {
            let key = [c.eq_low.0, c.eq_low.1, c.eq_mid.0, c.eq_mid.1, c.eq_high.0, c.eq_high.1];
            if key != self.eq_key {
                self.eq_key = key;
                for ch in 0..2 {
                    self.eq[ch][0].set(0, c.eq_low.0, c.eq_low.1, sr);
                    self.eq[ch][1].set(1, c.eq_mid.0, c.eq_mid.1, sr);
                    self.eq[ch][2].set(2, c.eq_high.0, c.eq_high.1, sr);
                }
            }
            for n in 0..frames {
                for (ch, x) in [&mut l[n], &mut r[n]].into_iter().enumerate() {
                    let mut y = *x;
                    for b in self.eq[ch].iter_mut() {
                        y = b.tick(y);
                    }
                    *x = y;
                }
            }
        }

        if c.chorus {
            let inc = c.chorus_rate / sr;
            let base = 0.012 * sr;
            let depth = (0.001 + 0.007 * c.chorus_depth) * sr;
            for n in 0..frames {
                let mix = (c.chorus_mix + mods[n / step].chorus).clamp(0.0, 1.0);
                let (x0, x1) = (l[n], r[n]);
                self.chorus[0].push(x0);
                self.chorus[1].push(x1);
                let mut w = [0.0f32; 2];
                for ch in 0..2 {
                    for k in 0..3 {
                        let ph = self.chorus_phase + k as f32 / 3.0 + ch as f32 * 0.25;
                        let d = base + depth * (0.5 + 0.5 * (2.0 * PI * ph).sin());
                        w[ch] += self.chorus[ch].read(d) / 3.0;
                    }
                }
                l[n] = x0 + (w[0] - x0) * mix;
                r[n] = x1 + (w[1] - x1) * mix;
                self.chorus_phase = (self.chorus_phase + inc).fract();
            }
        }

        if c.phaser {
            let inc = c.phaser_rate / sr;
            let fb = c.phaser_fb * 0.85;
            for n in 0..frames {
                let mix = (c.phaser_mix + mods[n / step].phaser).clamp(0.0, 1.0);
                let sweep = 0.5 - 0.5 * (2.0 * PI * self.phaser_phase).cos();
                self.phaser_phase = (self.phaser_phase + inc).fract();
                for ch in 0..2 {
                    // The right side a quarter cycle on: the sweep moves across the stereo field
                    let s = if ch == 0 { sweep } else { 0.5 - 0.5 * (2.0 * PI * (self.phaser_phase + 0.25)).cos() };
                    let x = if ch == 0 { l[n] } else { r[n] };
                    let wet = if c.flanger {
                        let d = (0.0003 + 0.006 * c.phaser_depth * s) * sr;
                        let line = &mut self.flanger[ch];
                        let back = line.read(d);
                        line.push(flush(fast_tanh(x + back * fb)));
                        0.5 * (x + back)
                    } else {
                        // (Kept under Nyquist: past it the all-pass turns unstable at low sample rates)
                        let f = (160.0 * 2f32.powf(s * c.phaser_depth * 5.5)).min(sr * 0.45);
                        let t = (PI * f / sr).tan();
                        let a = (t - 1.0) / (t + 1.0);
                        let mut y = x + self.phaser_last[ch] * fb;
                        for st in self.phaser_ap[ch].iter_mut() {
                            // First-order all-pass: y = a x + s; s = x - a y
                            let out = a * y + *st;
                            *st = flush(y - a * out);
                            y = out;
                        }
                        self.phaser_last[ch] = fast_tanh(y);
                        0.5 * (x + y)
                    };
                    let out = x + (wet - x) * mix;
                    if ch == 0 {
                        l[n] = out;
                    } else {
                        r[n] = out;
                    }
                }
            }
        }

        if c.delay {
            let target = (c.delay_time * sr).clamp(1.0, (self.delay[0].buf.len() - 4) as f32);
            let glide = 1.0 - (-1.0 / (0.05 * sr)).exp();
            let tone = one_pole(c.delay_tone, sr);
            let fb = c.delay_fb.min(0.95);
            for n in 0..frames {
                let mix = (c.delay_mix + mods[n / step].delay).clamp(0.0, 1.0);
                self.delay_now += (target - self.delay_now) * glide;
                let d0 = self.delay[0].read(self.delay_now);
                let d1 = self.delay[1].read(self.delay_now);
                let e0 = lp(&mut self.delay_lp[0], d0, tone);
                let e1 = lp(&mut self.delay_lp[1], d1, tone);
                if c.delay_pingpong {
                    // The input starts on the left and bounces across
                    let mono = 0.5 * (l[n] + r[n]);
                    self.delay[0].push(flush(fast_tanh(mono + e1 * fb)));
                    self.delay[1].push(flush(fast_tanh(e0 * fb)));
                } else {
                    self.delay[0].push(flush(fast_tanh(l[n] + e0 * fb)));
                    self.delay[1].push(flush(fast_tanh(r[n] + e1 * fb)));
                }
                // Echoes are added over the dry sound: mix 100% is full echoes, the dry kept
                l[n] += d0 * mix;
                r[n] += d1 * mix;
            }
        }

        if c.reverb {
            if self.size_now < 0.0 {
                self.size_now = c.reverb_size;
            }
            // Size and pre-delay glide to a new setting over about 80 ms: a jump would move every
            // line's read point at once and click
            let glide = 1.0 - (-1.0 / (0.08 * sr)).exp();
            let pre_target = (c.reverb_pre * 0.001 * sr).max(1.0);
            let gains: [f32; REVERB_LINES] = REVERB_MS.map(|m| 10f32.powf(-3.0 * m * (0.45 + 1.75 * self.size_now) * 0.001 / c.reverb_decay.max(0.1)));
            let damp = one_pole(c.reverb_tone, sr);
            let modinc = 0.37 / sr;
            for n in 0..frames {
                self.size_now += (c.reverb_size - self.size_now) * glide;
                self.pre_now += (pre_target - self.pre_now) * glide;
                let scale = 0.45 + 1.75 * self.size_now;
                let lens: [f32; REVERB_LINES] = REVERB_MS.map(|m| m * scale * 0.001 * sr);
                let diff: [f32; 4] = DIFFUSE_MS.map(|m| m * (0.6 + 0.8 * self.size_now) * 0.001 * sr);
                let mix = (c.reverb_mix + mods[n / step].reverb).clamp(0.0, 1.0);
                self.pre.push(0.5 * (l[n] + r[n]));
                let mut x = self.pre.read(self.pre_now);
                // Four all-passes smear the input into a dense wash before the tank
                for (k, line) in self.diffuse.iter_mut().enumerate() {
                    let g = 0.62;
                    let delayed = line.read(diff[k]);
                    let v = x + g * delayed;
                    line.push(flush(v));
                    x = delayed - g * v;
                }
                // The lines read with a slow wobble (a little chorus: no metallic ringing)
                self.reverb_mod = (self.reverb_mod + modinc).fract();
                let wob = (2.0 * PI * self.reverb_mod).sin() * 0.0012 * sr;
                let mut o = [0.0f32; REVERB_LINES];
                for k in 0..REVERB_LINES {
                    let d = lens[k] + if k % 2 == 0 { wob } else { -wob };
                    o[k] = lp(&mut self.damp[k], self.lines[k].read(d), damp) * gains[k];
                }
                // Mix the lines with a Hadamard matrix (energy-preserving), feed back with the input
                let m = hadamard(o);
                for k in 0..REVERB_LINES {
                    self.lines[k].push(flush(m[k] + x * 0.35));
                }
                let wl = (o[0] + o[2] + o[4] + o[6]) * 0.6;
                let wr = (o[1] + o[3] + o[5] + o[7]) * 0.6;
                l[n] = l[n] * (1.0 - 0.5 * mix) + wl * mix;
                r[n] = r[n] * (1.0 - 0.5 * mix) + wr * mix;
            }
        }
    }
}

/// An 8-point fast Walsh-Hadamard transform, scaled to keep energy.
#[inline]
fn hadamard(mut x: [f32; 8]) -> [f32; 8] {
    let mut h = 1;
    while h < 8 {
        let mut i = 0;
        while i < 8 {
            for j in i..i + h {
                let (a, b) = (x[j], x[j + h]);
                x[j] = a + b;
                x[j + h] = a - b;
            }
            i += h * 2;
        }
        h *= 2;
    }
    let s = 1.0 / 8f32.sqrt();
    x.map(|v| v * s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> FxCfg {
        FxCfg {
            eq: true,
            eq_low: (120.0, 6.0),
            eq_mid: (1000.0, -6.0),
            eq_high: (6000.0, 6.0),
            chorus: true,
            chorus_rate: 0.6,
            chorus_depth: 1.0,
            chorus_mix: 0.5,
            phaser: true,
            flanger: false,
            phaser_rate: 0.5,
            phaser_depth: 1.0,
            phaser_fb: 1.0,
            phaser_mix: 1.0,
            delay: true,
            delay_time: 0.3,
            delay_fb: 1.0,
            delay_pingpong: true,
            delay_tone: 20000.0,
            delay_mix: 1.0,
            reverb: true,
            reverb_size: 1.0,
            reverb_decay: 20.0,
            reverb_tone: 20000.0,
            reverb_pre: 50.0,
            reverb_mix: 1.0,
        }
    }

    #[test]
    fn everything_at_full_stays_bounded_and_dies_away() {
        // (Low sample rates too: the phaser's sweep reaches past their Nyquist)
        for (flanger, sr) in [(false, 48000.0), (true, 48000.0), (false, 8000.0), (false, 11025.0), (true, 8000.0)] {
            let mut fx = Effects::new(sr);
            let mut c = cfg();
            c.flanger = flanger;
            c.reverb_decay = 4.0;
            let mods = [FxMods::default(); 8];
            let mut peak: f32 = 0.0;
            for b in 0..3000 {
                let mut l = [0.0f32; 128];
                let mut r = [0.0f32; 128];
                if b < 20 {
                    for (i, x) in l.iter_mut().enumerate() {
                        *x = (i as f32 * 0.07).sin() * 0.5;
                    }
                    r.copy_from_slice(&l);
                }
                fx.process(&mut l, &mut r, 128, &c, &mods, 16);
                for x in l.iter().chain(r.iter()) {
                    assert!(x.is_finite());
                    peak = peak.max(x.abs());
                }
            }
            assert!(peak < 8.0, "peak {peak}");
        }
    }

    #[test]
    fn reverb_tail_falls_by_its_decay() {
        let mut fx = Effects::new(48000.0);
        let mut c = FxCfg { reverb: true, reverb_size: 0.6, reverb_decay: 1.0, reverb_tone: 20000.0, reverb_pre: 0.0, reverb_mix: 1.0, ..Default::default() };
        c.eq = false;
        let mods = [FxMods::default(); 8];
        let mut energy = vec![];
        for b in 0..1500 {
            let mut l = [0.0f32; 128];
            let mut r = [0.0f32; 128];
            if b == 0 {
                l[0] = 1.0;
                r[0] = 1.0;
            }
            fx.process(&mut l, &mut r, 128, &c, &mods, 16);
            energy.push(l.iter().map(|x| x * x).sum::<f32>());
        }
        // 1 s decay: about 60 dB down after a second; well down after two
        let at = |s: f32| {
            let b = (s * 48000.0 / 128.0) as usize;
            energy[b..b + 40].iter().sum::<f32>()
        };
        let drop = 10.0 * (at(0.2) / at(1.2)).log10();
        assert!(drop > 35.0 && drop < 90.0, "dropped {drop} dB in a second");
    }

    fn gain_at(c: &FxCfg, hz: f32) -> f32 {
        let mut fx = Effects::new(48000.0);
        let mods = [FxMods::default(); 8];
        let mut peak: f32 = 0.0;
        for b in 0..400 {
            let mut l = [0.0f32; 128];
            for (i, x) in l.iter_mut().enumerate() {
                *x = (2.0 * PI * hz * (b * 128 + i) as f32 / 48000.0).sin() * 0.1;
            }
            let mut r = l;
            fx.process(&mut l, &mut r, 128, c, &mods, 16);
            if b > 300 {
                peak = l.iter().fold(peak, |m, x| m.max(x.abs()));
            }
        }
        20.0 * (peak / 0.1).log10()
    }

    #[test]
    fn eq_shelves_boost_their_own_ends() {
        let low = FxCfg { eq: true, eq_low: (120.0, 12.0), eq_mid: (1000.0, 0.0), eq_high: (6000.0, 0.0), ..Default::default() };
        assert!(gain_at(&low, 40.0) > 10.0 && gain_at(&low, 2000.0) < 1.0);
        let high = FxCfg { eq: true, eq_low: (120.0, 0.0), eq_mid: (1000.0, 0.0), eq_high: (6000.0, 12.0), ..Default::default() };
        assert!(gain_at(&high, 15000.0) > 10.0 && gain_at(&high, 200.0) < 1.0);
    }

    #[test]
    fn chorus_and_flanger_switched_back_on_play_no_old_sound() {
        for flanger in [false, true] {
            let mut fx = Effects::new(48000.0);
            let mods = [FxMods::default(); 8];
            let on = FxCfg { chorus: !flanger, chorus_rate: 0.5, chorus_depth: 1.0, chorus_mix: 1.0, phaser: flanger, flanger, phaser_rate: 0.5, phaser_depth: 1.0, phaser_fb: 1.0, phaser_mix: 1.0, ..Default::default() };
            let off = FxCfg::default();
            for _ in 0..50 {
                let mut l = [0.5f32; 128];
                let mut r = [0.5f32; 128];
                fx.process(&mut l, &mut r, 128, &on, &mods, 16);
            }
            for _ in 0..50 {
                let mut l = [0.0f32; 128];
                let mut r = [0.0f32; 128];
                fx.process(&mut l, &mut r, 128, &off, &mods, 16);
            }
            let mut l = [0.0f32; 128];
            let mut r = [0.0f32; 128];
            fx.process(&mut l, &mut r, 128, &on, &mods, 16);
            assert!(l.iter().all(|x| x.abs() < 1e-6), "flanger {flanger}: old sound came back");
        }
    }


    #[test]
    fn flanger_after_a_mode_switch_plays_no_old_sound() {
        let mut fx = Effects::new(48000.0);
        let mods = [FxMods::default(); 8];
        let fl = FxCfg { phaser: true, flanger: true, phaser_rate: 0.5, phaser_depth: 1.0, phaser_fb: 1.0, phaser_mix: 1.0, ..Default::default() };
        let ph = FxCfg { flanger: false, ..fl };
        for (c, x, blocks) in [(&fl, 0.5f32, 50), (&ph, 0.0, 50)] {
            for _ in 0..blocks {
                let mut l = [x; 128];
                let mut r = [x; 128];
                fx.process(&mut l, &mut r, 128, c, &mods, 16);
            }
        }
        let mut l = [0.0f32; 128];
        let mut r = [0.0f32; 128];
        fx.process(&mut l, &mut r, 128, &fl, &mods, 16);
        assert!(l.iter().all(|x| x.abs() < 1e-6));
    }


    #[test]
    fn eq_switched_back_on_starts_clean() {
        let mut fx = Effects::new(48000.0);
        let mods = [FxMods::default(); 8];
        let on = FxCfg { eq: true, eq_low: (120.0, 12.0), eq_mid: (1000.0, 12.0), eq_high: (6000.0, 12.0), ..Default::default() };
        let off = FxCfg::default();
        for b in 0..50 {
            let mut l = [0.0f32; 128];
            for (i, x) in l.iter_mut().enumerate() {
                *x = (2.0 * PI * 60.0 * (b * 128 + i) as f32 / 48000.0).sin() * 0.8;
            }
            let mut r = l;
            fx.process(&mut l, &mut r, 128, &on, &mods, 16);
        }
        for _ in 0..50 {
            let mut l = [0.0f32; 128];
            let mut r = [0.0f32; 128];
            fx.process(&mut l, &mut r, 128, &off, &mods, 16);
        }
        let mut l = [0.0f32; 128];
        let mut r = [0.0f32; 128];
        fx.process(&mut l, &mut r, 128, &on, &mods, 16);
        assert!(l.iter().all(|x| x.abs() < 1e-6));
    }


    #[test]
    fn moving_the_reverb_size_does_not_click() {
        let mut fx = Effects::new(48000.0);
        let mods = [FxMods::default(); 8];
        let mut c = FxCfg { reverb: true, reverb_size: 0.6, reverb_decay: 2.0, reverb_tone: 20000.0, reverb_pre: 10.0, reverb_mix: 1.0, ..Default::default() };
        let mut t = 0usize;
        let mut last = 0.0f32;
        let mut run = |fx: &mut Effects, c: &FxCfg, blocks: usize| {
            let mut worst: f32 = 0.0;
            for _ in 0..blocks {
                let mut l = [0.0f32; 128];
                for x in l.iter_mut() {
                    *x = (2.0 * PI * 220.0 * t as f32 / 48000.0).sin() * 0.3;
                    t += 1;
                }
                let mut r = l;
                fx.process(&mut l, &mut r, 128, c, &mods, 16);
                for &y in &l {
                    worst = worst.max((y - last).abs());
                    last = y;
                }
            }
            worst
        };
        let steady = run(&mut fx, &c, 400);
        // One step (a knob turned), then a sweep over two seconds (automation)
        c.reverb_size = 0.61;
        let step = run(&mut fx, &c, 100);
        let mut sweep: f32 = 0.0;
        for k in 0..750 {
            c.reverb_size = 0.61 + 0.3 * k as f32 / 750.0;
            sweep = sweep.max(run(&mut fx, &c, 1));
        }
        assert!(step < steady * 1.5 && sweep < steady * 2.0, "steady {steady}, step {step}, sweep {sweep}");
    }

}
