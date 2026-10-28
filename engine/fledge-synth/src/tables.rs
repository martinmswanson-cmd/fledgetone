//! The wavetables: made here, from formulas (no one else's tables), when first used.
//!
//! A table is a row of single-cycle frames that the Position control morphs through. Each frame
//! is kept at several "levels", one per octave: level k has only harmonics 1 to 1024 >> k, so a
//! note reads the level whose top harmonic stays under half the sample rate and doesn't alias
//! (a mipmap: the standard way wavetable synths do it). Frames are built as spectra (each
//! harmonic's amplitude and phase), or as one finely sampled cycle analysed by FFT, and each
//! level is the inverse FFT of the spectrum cut at its top harmonic.

use std::f64::consts::PI;
use std::sync::OnceLock;

/// Frames per table (Position steps through them, blending neighbours)
pub const FRAMES: usize = 32;
/// The most harmonics a frame has (level 0)
const TOP: usize = 1024;
/// Levels: harmonics 1024, 512, ... 1
pub const LEVELS: usize = 11;
/// Samples a level keeps per period of its top harmonic (see from_spectra)
const TABLE_OVERSAMPLE: usize = 32;
/// Samples in the high-resolution cycle analysed for the time-domain tables
const ANALYSE: usize = 4096;

pub struct Level {
    /// Samples per cycle (a power of two)
    pub size: usize,
    /// FRAMES cycles of `size + 1` samples each, the last repeating the first, so a read never wraps
    pub data: Vec<f32>,
}

pub struct Table {
    pub levels: Vec<Level>,
}

impl Table {
    /// The sample at `phase` (0..1) of the frame at `pos` (0..1), from the level for a note
    /// advancing `inc` cycles per sample.
    #[inline]
    pub fn read(&self, level: usize, pos: f32, phase: f32) -> f32 {
        let lv = &self.levels[level];
        let fp = pos.clamp(0.0, 1.0) * (FRAMES - 1) as f32;
        let f0 = (fp as usize).min(FRAMES - 2);
        let ft = fp - f0 as f32;
        let x = phase * lv.size as f32;
        let i = (x as usize).min(lv.size - 1);
        let t = x - i as f32;
        let stride = lv.size + 1;
        let a = &lv.data[f0 * stride + i..];
        let b = &lv.data[(f0 + 1) * stride + i..];
        let sa = a[0] + (a[1] - a[0]) * t;
        let sb = b[0] + (b[1] - b[0]) * t;
        sa + (sb - sa) * ft
    }

    /// As `read`, fading `w` (0..1) of the way from `level` to the next level up.
    #[inline]
    pub fn read_blend(&self, level: usize, w: f32, pos: f32, phase: f32) -> f32 {
        let a = self.read(level, pos, phase);
        if w <= 0.0 {
            a
        } else {
            a + (self.read((level + 1).min(LEVELS - 1), pos, phase) - a) * w
        }
    }
}

/// The level whose harmonics all stay below half the sample rate for a note advancing `inc`
/// cycles per sample (the lowest-numbered such level is the richest).
#[inline]
pub fn level_for(inc: f32) -> usize {
    // Harmonic h is below Nyquist while h * inc < 0.5: level k has 1024 >> k harmonics
    let need = TOP as f32 * inc.abs() * 2.0;
    if need <= 1.0 {
        0
    } else {
        (need.log2().ceil() as usize).min(LEVELS - 1)
    }
}

/// As `level_for`, but with no step from one level to the next: the level whose harmonics reach
/// the highest without passing half the sample rate, and how far (0..1) to fade from it into the
/// next one up. Just past a change of octave the richer level still plays, its few harmonics over
/// half the sample rate folding back above `audible` Hz (where nobody hears them), and fades into
/// the next level by the time they'd fold lower; so the brightness moves smoothly with the pitch
/// (and with a glide) instead of losing its top octave of harmonics at once.
#[inline]
pub fn level_blend(inc: f32, sr: f32, audible: f32) -> (usize, f32) {
    let need = TOP as f32 * inc.abs() * 2.0;
    if need <= 1.0 {
        return (0, 0.0);
    }
    let x = need.log2();
    let k = x.floor();
    if k as usize >= LEVELS - 1 {
        return (LEVELS - 1, 0.0);
    }
    // How far over half the sample rate the richer level's top may reach (an octave at most)
    let zone = ((sr - audible) / (0.5 * sr)).max(1.0).log2().clamp(0.05, 1.0);
    let f = x - k;
    if f >= zone {
        (k as usize + 1, 0.0)
    } else {
        (k as usize, f / zone)
    }
}

static TABLES: [OnceLock<Table>; 16] = [const { OnceLock::new() }; 16];

/// Table `i` (made the first time it's asked for).
pub fn table(i: usize) -> &'static Table {
    let i = i.min(TABLES.len() - 1);
    TABLES[i].get_or_init(|| build(i))
}

/// A spectrum: (cosine, sine) amplitude per harmonic, index 0 unused (no DC).
type Spectrum = Vec<(f64, f64)>;

fn build(which: usize) -> Table {
    let spectra: Vec<Spectrum> = (0..FRAMES).map(|f| frame_spectrum(which, f as f64 / (FRAMES - 1) as f64)).collect();
    from_spectra(&spectra)
}

/// A table from FRAMES spectra: each frame band-limited into every level, then levelled.
fn from_spectra(spectra: &[Spectrum]) -> Table {
    let mut levels = Vec::with_capacity(LEVELS);
    for k in 0..LEVELS {
        let cap = TOP >> k;
        // Enough samples for linear reads to be clean: 32 per period of the top harmonic (64 at
        // least, 4096 at most). With only 4, the linear reads' images of the top harmonics folded
        // back as fizz about 40 dB under the note (a saw from C4 to C6); with 32, 75 dB or more
        let size = (cap * TABLE_OVERSAMPLE).clamp(64, 4096);
        let mut data = vec![0f32; FRAMES * (size + 1)];
        // Two frames at a time (one inverse FFT makes both: see synthesize_pair)
        for f in (0..FRAMES).step_by(2) {
            let (a, b) = synthesize_pair(&spectra[f], &spectra[f + 1], cap.min(size / 2 - 1), size);
            for (g, cycle) in [(f, a), (f + 1, b)] {
                let out = &mut data[g * (size + 1)..(g + 1) * (size + 1)];
                out[..size].copy_from_slice(&cycle);
                out[size] = cycle[0];
            }
        }
        levels.push(Level { size, data });
    }
    // Every frame of every level is scaled by its level-0 frame's loudness, so a level change
    // (a note moving octave) doesn't change the level, and frames are a steady loudness apart
    for f in 0..FRAMES {
        let l0 = &levels[0];
        let stride = l0.size + 1;
        let frame = &l0.data[f * stride..f * stride + l0.size];
        let rms = (frame.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>() / l0.size as f64).sqrt();
        let peak = frame.iter().fold(0f32, |m, x| m.max(x.abs())) as f64;
        // Aim for the RMS of a full-scale sine (0.707) at 0.5, but never past a peak of 1
        let g = if rms > 1e-9 { (0.5 / rms).min(1.0 / peak.max(1e-9)) } else { 0.0 } as f32;
        for lv in levels.iter_mut() {
            let s = lv.size + 1;
            for x in &mut lv.data[f * s..(f + 1) * s] {
                *x *= g;
            }
        }
    }
    Table { levels }
}

/// Samples in each cycle of a user table, as the host hands them in
pub const USER_CYCLE: usize = 2048;
/// The most cycles a user table may have (they're spread over the FRAMES positions)
pub const USER_FRAMES_MAX: usize = 64;

/// A user table (made from a sound, see src/audio/plugins/userTable.ts): `frames` single cycles
/// of USER_CYCLE samples each, one after another, the first at Position 0 and the last at 100%.
/// Each is analysed into its harmonics (up to 1024; no DC), the FRAMES positions are filled by
/// blending the nearest two, and the table is band-limited into the levels and levelled frame by
/// frame like the built-in ones. None if there are no frames, too many, or too few samples.
pub fn user_table(cycles: &[f32], frames: usize) -> Option<Table> {
    if frames == 0 || frames > USER_FRAMES_MAX || cycles.len() < frames * USER_CYCLE {
        return None;
    }
    let given: Vec<Spectrum> = (0..frames).map(|f| cycle_spectrum(&cycles[f * USER_CYCLE..(f + 1) * USER_CYCLE])).collect();
    let spectra: Vec<Spectrum> = (0..FRAMES)
        .map(|k| {
            if frames == 1 {
                return given[0].clone();
            }
            let x = k as f64 / (FRAMES - 1) as f64 * (frames - 1) as f64;
            let i = (x.floor() as usize).min(frames - 2);
            mix(&given[i], &given[i + 1], x - i as f64)
        })
        .collect();
    Some(from_spectra(&spectra))
}

/// The harmonics of one cycle of USER_CYCLE samples (anything not a number counts as silence).
fn cycle_spectrum(cycle: &[f32]) -> Spectrum {
    let n = USER_CYCLE;
    let mut re: Vec<f64> = cycle[..n].iter().map(|&x| if x.is_finite() { x.clamp(-4.0, 4.0) as f64 } else { 0.0 }).collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im, false);
    let nf = n as f64;
    // (Harmonic n/2 sits on the Nyquist bin, with no phase of its own: left out)
    (0..=TOP).map(|h| if h == 0 || h >= n / 2 { (0.0, 0.0) } else { (2.0 * re[h] / nf, -2.0 * im[h] / nf) }).collect()
}

/// Lerp between two spectra (missing harmonics are zero).
fn mix(a: &Spectrum, b: &Spectrum, t: f64) -> Spectrum {
    let n = a.len().max(b.len());
    (0..n)
        .map(|h| {
            let x = a.get(h).copied().unwrap_or((0.0, 0.0));
            let y = b.get(h).copied().unwrap_or((0.0, 0.0));
            (x.0 + (y.0 - x.0) * t, x.1 + (y.1 - x.1) * t)
        })
        .collect()
}

/// A spectrum from amplitude-per-harmonic as sine terms (the usual form of saw, square...).
fn sines(amp: impl Fn(usize) -> f64) -> Spectrum {
    (0..=TOP).map(|h| if h == 0 { (0.0, 0.0) } else { (0.0, amp(h)) }).collect()
}

fn sine() -> Spectrum {
    sines(|h| if h == 1 { 1.0 } else { 0.0 })
}
fn saw() -> Spectrum {
    sines(|h| 2.0 / PI * if h % 2 == 1 { 1.0 } else { -1.0 } / h as f64)
}
fn square() -> Spectrum {
    sines(|h| if h % 2 == 1 { 4.0 / (PI * h as f64) } else { 0.0 })
}
fn triangle() -> Spectrum {
    sines(|h| if h % 2 == 1 { 8.0 / (PI * PI * (h * h) as f64) * if (h / 2) % 2 == 0 { 1.0 } else { -1.0 } } else { 0.0 })
}

/// The spectrum of frame `t` (0..1) of table `which`.
fn frame_spectrum(which: usize, t: f64) -> Spectrum {
    match which {
        // Basic shapes: sine, triangle, saw, square, morphing smoothly from one to the next
        0 => {
            let keys = [sine(), triangle(), saw(), square()];
            let x = t * 3.0;
            let i = (x.floor() as usize).min(2);
            mix(&keys[i], &keys[i + 1], x - i as f64)
        }
        // Pulse width: a square narrowing to a thin pulse (the classic PWM sweep)
        1 => {
            let w = 0.5 - 0.46 * t;
            // A pulse of width w: 2 sin(pi h w) / (pi h) at each harmonic, centred
            (0..=TOP)
                .map(|h| {
                    if h == 0 {
                        return (0.0, 0.0);
                    }
                    let a = 2.0 * (PI * h as f64 * w).sin() / (PI * h as f64);
                    let ph = -PI * h as f64 * w;
                    (a * ph.cos(), a * ph.sin())
                })
                .collect()
        }
        // Dark saw: a saw through a gentle low pass that opens across the table
        2 => {
            let fc = 1.5 * (400.0f64 / 1.5).powf(t);
            let s = saw();
            s.iter().enumerate().map(|(h, &(c, sn))| {
                let g = 1.0 / (1.0 + (h as f64 / fc).powi(2)).sqrt();
                (c * g, sn * g)
            }).collect()
        }
        // Vowels: a saw shaped by the formants of oo, oh, ah, eh, ee (as sung around 110 Hz)
        3 => {
            const V: [[f64; 3]; 5] = [[300.0, 870.0, 2240.0], [500.0, 1000.0, 2400.0], [730.0, 1090.0, 2440.0], [530.0, 1840.0, 2480.0], [270.0, 2290.0, 3010.0]];
            let x = t * 4.0;
            let i = (x.floor() as usize).min(3);
            let u = x - i as f64;
            let f: Vec<f64> = (0..3).map(|k| V[i][k] * (V[i + 1][k] / V[i][k]).powf(u)).collect();
            let f0 = 110.0;
            let s = saw();
            s.iter().enumerate().map(|(h, &(c, sn))| {
                let hz = h as f64 * f0;
                // Three resonant peaks, each about 1/8 octave wide, over a quiet floor
                let env = 0.06 + [1.0, 0.7, 0.45].iter().zip(&f).map(|(a, fk)| a / (1.0 + ((hz - fk) / (fk * 0.09)).powi(2))).sum::<f64>();
                (c * env, sn * env)
            }).collect()
        }
        // Harmonic sweep: from one harmonic to a buzzy stack of 64, the top ones fading in
        4 => {
            let n = 1.0 + t * 63.0;
            sines(|h| {
                let hf = h as f64;
                if hf > n.ceil() { 0.0 } else { (n - hf + 1.0).clamp(0.0, 1.0) / hf.sqrt() }
            })
        }
        // Growl FM: a sine phase-modulated by itself (1:1), the index rising from 0 to 7
        5 => analyse(|p| (2.0 * PI * p + 7.0 * t * t * (2.0 * PI * p).sin()).sin()),
        // Metal FM: a sine modulated at three times its pitch: bright, clangy, still in tune
        6 => analyse(|p| (2.0 * PI * p + 5.0 * t * (6.0 * PI * p).sin() + 0.4 * t * (2.0 * PI * p).sin()).sin()),
        // Fold: a sine driven into a wave folder harder and harder
        7 => analyse(|p| {
            let g = 1.0 + 7.0 * t;
            (g * (2.0 * PI * p).sin() * PI / 2.0).sin()
        }),
        // Sync sweep: a saw restarted by a master cycle, its own pitch climbing (the hard-sync lead)
        8 => {
            let r = 1.0 + 7.0 * t;
            analyse(|p| 2.0 * (p * r).fract() - 1.0)
        }
        // Organ: drawbars pulled out one by one, from a flute to the full organ
        9 => {
            const BARS: [(usize, f64); 8] = [(1, 1.0), (2, 0.8), (3, 0.6), (4, 0.6), (6, 0.45), (8, 0.4), (10, 0.3), (12, 0.25)];
            let pulled = 1.5 + t * 6.5;
            sines(|h| {
                BARS.iter().enumerate().filter(|(_, b)| b.0 == h).map(|(k, b)| b.1 * (pulled - k as f64).clamp(0.0, 1.0)).sum()
            })
        }
        // Octave stack: sines an octave apart joining in from the bottom up
        10 => {
            let n = 1.0 + t * 6.0;
            sines(|h| {
                if !h.is_power_of_two() {
                    return 0.0;
                }
                let k = h.trailing_zeros() as f64;
                (n - k).clamp(0.0, 1.0) / (1.0 + k).sqrt()
            })
        }
        // Digital: a saw in coarser and coarser steps (a cheap sampler's sound)
        11 => {
            let steps = (64.0 * (4.0f64 / 64.0).powf(t)).round().max(2.0);
            analyse(|p| 2.0 * ((p * steps).floor() / (steps - 1.0)) - 1.0)
        }
        // Resonant: a decaying cosine burst each cycle, its ring rising (the old phase-distortion
        // synths' resonant saw)
        12 => {
            let ring = 1.0 + t * 15.0;
            analyse(|p| (1.0 - p) * (2.0 * PI * p * ring).cos())
        }
        // Screech: a saw with one narrow, loud peak sweeping up through the harmonics
        13 => {
            let peak = 3.0 * (60.0f64 / 3.0).powf(t);
            let s = saw();
            s.iter().enumerate().map(|(h, &(c, sn))| {
                let g = 0.15 + 3.0 / (1.0 + ((h as f64 - peak) / (1.0 + peak * 0.06)).powi(2));
                (c * g, sn * g)
            }).collect()
        }
        // FM 1:2: a sine modulated an octave up: hollow and reedy to snarling
        14 => analyse(|p| (2.0 * PI * p + 6.0 * t * (4.0 * PI * p).sin()).sin()),
        // Random harmonics: four seeded random spectra, morphing one into the next
        _ => {
            let x = t * 3.0;
            let i = (x.floor() as usize).min(2);
            mix(&random_spectrum(i as u64), &random_spectrum(i as u64 + 1), x - i as f64)
        }
    }
}

/// A random but fixed spectrum (the same every time for `seed`), falling off like a saw.
fn random_spectrum(seed: u64) -> Spectrum {
    let mut x = 0x2545_F491_4F6C_DD1Du64 ^ (seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x >> 11) as f64 / (1u64 << 53) as f64
    };
    (0..=TOP)
        .map(|h| {
            if h == 0 || h > 200 {
                return (0.0, 0.0);
            }
            let a = next() / (h as f64).powf(0.8);
            let ph = next() * 2.0 * PI;
            (a * ph.cos(), a * ph.sin())
        })
        .collect()
}

/// The spectrum of one cycle given as a function of phase (0..1), finely sampled.
fn analyse(f: impl Fn(f64) -> f64) -> Spectrum {
    let mut re: Vec<f64> = (0..ANALYSE).map(|i| f(i as f64 / ANALYSE as f64)).collect();
    let mut im = vec![0.0; ANALYSE];
    fft(&mut re, &mut im, false);
    let n = ANALYSE as f64;
    // x(p) = sum c_h cos(2 pi h p) + s_h sin(2 pi h p): c_h = 2 Re/N, s_h = -2 Im/N
    (0..=TOP).map(|h| if h == 0 { (0.0, 0.0) } else { (2.0 * re[h] / n, -2.0 * im[h] / n) }).collect()
}

/// Two cycles of `size` samples, holding harmonics 1 to `cap` of `a` and of `b`. Both are real,
/// so `b` rides in the imaginary part of one inverse FFT and comes out there (half the work).
fn synthesize_pair(a: &Spectrum, b: &Spectrum, cap: usize, size: usize) -> (Vec<f32>, Vec<f32>) {
    let mut re = vec![0.0; size];
    let mut im = vec![0.0; size];
    let at = |spec: &Spectrum, h: usize| if h < spec.len() { spec[h] } else { (0.0, 0.0) };
    for h in 1..=cap.min(a.len().max(b.len()) - 1) {
        let ((ca, sa), (cb, sb)) = (at(a, h), at(b, h));
        // A's bins (c - i s) / 2 at h and (c + i s) / 2 at size - h, plus i times B's
        re[h] = (ca + sb) * 0.5;
        im[h] = (cb - sa) * 0.5;
        re[size - h] = (ca - sb) * 0.5;
        im[size - h] = (cb + sa) * 0.5;
    }
    fft(&mut re, &mut im, true);
    (re.iter().map(|&x| x as f32).collect(), im.iter().map(|&x| x as f32).collect())
}

/// An in-place radix-2 FFT (inverse without scaling: an inverse of a one-sided spectrum gives the
/// cycle directly).
fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = 2.0 * PI / len as f64 * if inverse { 1.0 } else { -1.0 };
        let (wr, wi) = (ang.cos(), ang.sin());
        let mut i = 0;
        while i < n {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (ar, ai) = (re[i + k], im[i + k]);
                let (br, bi) = (re[i + k + len / 2], im[i + k + len / 2]);
                let (tr, ti) = (br * cr - bi * ci, br * ci + bi * cr);
                re[i + k] = ar + tr;
                im[i + k] = ai + ti;
                re[i + k + len / 2] = ar - tr;
                im[i + k + len / 2] = ai - ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
            i += len;
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sine_frame_is_a_sine() {
        let t = table(0);
        // Frame 0 of the basic table is a sine: its peak at a quarter cycle
        let v = t.read(0, 0.0, 0.25);
        let peak = (0..1000).map(|i| t.read(0, 0.0, i as f32 / 1000.0).abs()).fold(0f32, f32::max);
        assert!((v - peak).abs() < 0.01, "quarter-cycle {v} vs peak {peak}");
    }

    /// A saw read as a note plays it (C5, at 48 kHz): what isn't one of its harmonics (the linear
    /// reads' images folding back) is over 70 dB under the note. (With 4 samples a period of the
    /// top harmonic it was 40 dB under)
    #[test]
    fn a_saw_read_at_a_high_note_has_next_to_no_fizz() {
        let (sr, f0) = (48000.0f64, 523.2511f64);
        let t = table(0);
        let inc = (f0 / sr) as f32;
        let level = level_for(inc);
        let pos = 2.0 / 3.0;
        let n = 1 << 15;
        let mut re: Vec<f64> = (0..n)
            .map(|i| {
                let ph = ((i as f64 * f0 / sr).fract()) as f32;
                // A 4-term Blackman-Harris window: its side lobes are far under what's measured
                let w = 2.0 * PI * i as f64 / n as f64;
                let win = 0.35875 - 0.48829 * w.cos() + 0.14128 * (2.0 * w).cos() - 0.01168 * (3.0 * w).cos();
                t.read(level, pos, ph) as f64 * win
            })
            .collect();
        let mut im = vec![0.0; n];
        fft(&mut re, &mut im, false);
        let bin = sr / n as f64;
        let (mut note, mut other) = (0.0, 0.0);
        for k in 1..n / 2 {
            let f = k as f64 * bin;
            let p = re[k] * re[k] + im[k] * im[k];
            let h = (f / f0).round();
            if (f - h * f0).abs() <= 6.0 * bin && h >= 1.0 {
                if h == 1.0 {
                    note += p;
                }
            } else if f < 20000.0 {
                other += p;
            }
        }
        let db = 10.0 * (other / note).log10();
        assert!(db < -70.0, "{db:.1} dB of fizz");
    }

    #[test]
    fn levels_hold_their_harmonics_only() {
        // A saw frame at level 6 (16 harmonics) has no energy at harmonic 40
        let t = table(0);
        let lv = &t.levels[6];
        let frame = (FRAMES - 1) * 2 / 3; // the saw
        let s = lv.size + 1;
        let mut re: Vec<f64> = lv.data[frame * s..frame * s + lv.size].iter().map(|&x| x as f64).collect();
        let mut im = vec![0.0; lv.size];
        fft(&mut re, &mut im, false);
        let mag = |h: usize| (re[h] * re[h] + im[h] * im[h]).sqrt();
        assert!(mag(1) > 1.0);
        assert!(mag(lv.size / 2 - 2) < 1e-6 * mag(1));
    }

    #[test]
    fn blended_levels_move_smoothly_and_fold_only_above_hearing() {
        let sr = 48000.0;
        let mut last: Option<f32> = None;
        // A fine sweep from 20 Hz to 10 kHz: the effective top harmonic (levels weighted by the
        // fade) never jumps, and whatever folds back lands above 20 kHz
        let mut f = 20.0f32;
        while f < 10000.0 {
            let inc = f / sr;
            let (k, w) = level_blend(inc, sr, 20000.0);
            let top = |k: usize| (TOP >> k.min(LEVELS - 1)) as f32 * f;
            let eff = top(k) * (1.0 - w) + top(k + 1) * w;
            if let Some(p) = last {
                assert!((eff / p).ln().abs() < 0.02, "{f} Hz: top {eff} after {p}");
            }
            last = Some(eff);
            // (The richer level, while it fades: its top folds back to sr - top)
            if w > 0.0 {
                assert!(sr - top(k) >= 19999.0, "{f} Hz folds to {}", sr - top(k));
            } else {
                assert!(top(k) <= sr * 0.5 * 1.0001 || k == LEVELS - 1, "{f} Hz: level {k}");
            }
            f *= 1.001;
        }
    }

    /// One cycle of `f` (phase 0..1) as USER_CYCLE samples.
    fn cycle(f: impl Fn(f64) -> f64) -> Vec<f32> {
        (0..USER_CYCLE).map(|i| f(i as f64 / USER_CYCLE as f64) as f32).collect()
    }

    #[test]
    fn a_user_table_of_one_sine_is_a_sine_at_every_position() {
        let t = user_table(&cycle(|p| 0.3 * (2.0 * PI * p).sin()), 1).unwrap();
        for pos in [0.0, 0.5, 1.0] {
            let peak = (0..1000).map(|i| t.read(0, pos, i as f32 / 1000.0).abs()).fold(0f32, f32::max);
            assert!((t.read(0, pos, 0.25) - peak).abs() < 0.01);
            // Levelled as the built-in tables are: a sine's RMS at 0.5
            assert!((peak - 0.5 * std::f32::consts::SQRT_2).abs() < 0.01, "peak {peak}");
        }
    }

    #[test]
    fn a_user_table_blends_its_frames_across_the_positions() {
        // Two frames: a sine, then a square; the middle is half of each
        let mut data = cycle(|p| (2.0 * PI * p).sin());
        data.extend(cycle(|p| if p < 0.5 { 0.8 } else { -0.8 }));
        let t = user_table(&data, 2).unwrap();
        let odd = |pos: f32| {
            let lv = &t.levels[0];
            let s = lv.size + 1;
            let f = (pos * (FRAMES - 1) as f32).round() as usize;
            let mut re: Vec<f64> = lv.data[f * s..f * s + lv.size].iter().map(|&x| x as f64).collect();
            let mut im = vec![0.0; lv.size];
            fft(&mut re, &mut im, false);
            let mag = |h: usize| (re[h] * re[h] + im[h] * im[h]).sqrt();
            mag(3) / mag(1)
        };
        assert!(odd(0.0) < 1e-3, "frame 0 is a sine");
        assert!((odd(1.0) - 1.0 / 3.0).abs() < 0.02, "the last frame is a square: {}", odd(1.0));
        assert!(odd(0.5) > 0.05 && odd(0.5) < 0.3, "the middle is between: {}", odd(0.5));
    }

    #[test]
    fn a_user_table_is_band_limited_per_level_and_has_no_dc() {
        // A saw with an offset: level 6 keeps 16 harmonics, none above; no DC anywhere
        let t = user_table(&cycle(|p| 0.2 + 2.0 * p - 1.0), 1).unwrap();
        for (k, lv) in t.levels.iter().enumerate() {
            let s = lv.size + 1;
            let mean = lv.data[..lv.size].iter().map(|&x| x as f64).sum::<f64>() / lv.size as f64;
            assert!(mean.abs() < 1e-4, "level {k} DC {mean}");
            assert!(lv.data[lv.size] == lv.data[0] && s == lv.size + 1);
        }
        let lv = &t.levels[6];
        let mut re: Vec<f64> = lv.data[..lv.size].iter().map(|&x| x as f64).collect();
        let mut im = vec![0.0; lv.size];
        fft(&mut re, &mut im, false);
        let mag = |h: usize| (re[h] * re[h] + im[h] * im[h]).sqrt();
        assert!(mag(16) > 1e-3 * mag(1) && mag(17) < 1e-6 * mag(1) && mag(40) < 1e-6 * mag(1));
    }

    #[test]
    fn bad_user_tables_are_refused_and_silence_stays_silent() {
        assert!(user_table(&[], 1).is_none());
        assert!(user_table(&vec![0.0; USER_CYCLE], 0).is_none());
        assert!(user_table(&vec![0.0; USER_CYCLE], 2).is_none());
        assert!(user_table(&vec![0.0; USER_CYCLE * (USER_FRAMES_MAX + 1)], USER_FRAMES_MAX + 1).is_none());
        let mut junk = vec![f32::NAN; USER_CYCLE];
        junk[3] = f32::INFINITY;
        let t = user_table(&junk, 1).unwrap();
        assert!(t.levels.iter().all(|lv| lv.data.iter().all(|x| *x == 0.0)));
    }

    #[test]
    fn building_the_built_in_tables_is_unchanged() {
        // (from_spectra was split out of build: a table built the old way, by hand, is the same)
        for which in [0usize, 5, 15] {
            let spectra: Vec<Spectrum> = (0..FRAMES).map(|f| frame_spectrum(which, f as f64 / (FRAMES - 1) as f64)).collect();
            let a = from_spectra(&spectra);
            let b = table(which);
            for (x, y) in a.levels.iter().zip(&b.levels) {
                assert!(x.data == y.data);
            }
        }
    }

    #[test]
    fn level_choice_keeps_harmonics_under_nyquist() {
        for &f in &[20.0f32, 110.0, 440.0, 2000.0, 8000.0] {
            let inc = f / 48000.0;
            let k = level_for(inc);
            let top = (TOP >> k) as f32;
            assert!(top * f <= 24000.0 * 1.01, "{f} Hz: level {k} reaches {} Hz", top * f);
        }
    }
}
