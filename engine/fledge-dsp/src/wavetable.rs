//! Wavetables: a row of single-cycle frames that a position morphs through, band-limited per
//! octave.
//!
//! Each frame is kept at several "levels", one per octave: level k has only harmonics 1 to
//! 1024 >> k, so a note reads the level whose top harmonic stays under half the sample rate and
//! doesn't alias (a mipmap: the standard way wavetable synths do it). Frames are given as spectra
//! (each harmonic's amplitude and phase), or as one finely sampled cycle analysed by FFT, and each
//! level is the inverse FFT of the spectrum cut at its top harmonic, made the first time it's read.

use crate::fft::fft;
use std::f64::consts::PI;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// Frames per table (Position steps through them, blending neighbours)
pub const FRAMES: usize = 32;
/// The most harmonics a frame has (level 0)
pub const TOP: usize = 1024;
/// Levels: harmonics 1024, 512, ... 1
pub const LEVELS: usize = 11;
/// Samples a level keeps per period of its top harmonic (see synthesize_level)
const TABLE_OVERSAMPLE: usize = 32;
/// Samples in the high-resolution cycle analysed for the time-domain tables
const ANALYSE: usize = 4096;

pub struct Level {
    /// Samples per cycle (a power of two)
    pub size: usize,
    /// FRAMES cycles of `size + 1` samples each, the last repeating the first, so a read never wraps
    pub data: Vec<f32>,
}

impl Level {
    /// The sample at `phase` (0..1) of the frame at `pos` (0..1).
    #[inline]
    pub fn read(&self, pos: f32, phase: f32) -> f32 {
        let fp = pos.clamp(0.0, 1.0) * (FRAMES - 1) as f32;
        let f0 = (fp as usize).min(FRAMES - 2);
        let ft = fp - f0 as f32;
        let x = phase * self.size as f32;
        let i = (x as usize).min(self.size - 1);
        let t = x - i as f32;
        let stride = self.size + 1;
        let a = &self.data[f0 * stride + i..];
        let b = &self.data[(f0 + 1) * stride + i..];
        let sa = a[0] + (a[1] - a[0]) * t;
        let sb = b[0] + (b[1] - b[0]) * t;
        sa + (sb - sa) * ft
    }

    /// As `read`, fading `w` (0..1) of the way to `next` (the next level up; only read when `w`
    /// is over 0, so it can be None then).
    #[inline]
    pub fn read_blend(&self, next: Option<&Level>, w: f32, pos: f32, phase: f32) -> f32 {
        let a = self.read(pos, phase);
        match next {
            Some(n) if w > 0.0 => a + (n.read(pos, phase) - a) * w,
            _ => a,
        }
    }
}

/// A wavetable: its frames' spectra, and each level made from them the first time a note needs
/// it. A note reads one or two levels; the four richest are the biggest (4096 samples a cycle)
/// and only the lowest notes read them, so a table first used by a lead or a chord makes a
/// fraction of the work and memory of all eleven. Level 0 is always made first: every level is
/// scaled by its frames' loudness there.
pub struct Table {
    levels: [OnceLock<Level>; LEVELS],
    /// Each frame's gain, from level 0 (see `gains`)
    gains: OnceLock<[f32; FRAMES]>,
    /// The frames' spectra, until every level is made
    spectra: Mutex<Option<Arc<Vec<Spectrum>>>>,
}

impl Table {
    fn new(spectra: Vec<Spectrum>) -> Table {
        Table { levels: [const { OnceLock::new() }; LEVELS], gains: OnceLock::new(), spectra: Mutex::new(Some(Arc::new(spectra))) }
    }

    /// Level `k` (made now if it hasn't been).
    #[inline]
    pub fn level(&self, k: usize) -> &Level {
        let k = k.min(LEVELS - 1);
        if let Some(lv) = self.levels[k].get() {
            return lv;
        }
        self.make(k)
    }

    /// Level `k` if it's made already.
    #[inline]
    pub fn level_if_made(&self, k: usize) -> Option<&Level> {
        self.levels[k.min(LEVELS - 1)].get()
    }

    /// How many levels are made, and the bytes they hold.
    pub fn made(&self) -> (usize, usize) {
        let made: Vec<&Level> = self.levels.iter().filter_map(|l| l.get()).collect();
        (made.len(), made.iter().map(|l| l.data.len() * 4).sum())
    }

    #[cold]
    fn make(&self, k: usize) -> &Level {
        let gains = if k == 0 { None } else { Some(self.gains()) };
        let lv = self.levels[k].get_or_init(|| {
            let spectra = self.spectra.lock().unwrap_or_else(|e| e.into_inner()).clone().expect("spectra kept until every level is made");
            MADE.fetch_add(1, Ordering::Relaxed);
            let mut lv = synthesize_level(&spectra, k);
            match gains {
                Some(g) => scale(&mut lv, &g),
                None => {
                    let g = frame_gains(&lv);
                    scale(&mut lv, &g);
                    let _ = self.gains.set(g);
                }
            }
            lv
        });
        // The spectra keep only the harmonics the levels still to be made hold (none once every
        // level is made): level 0 is made first, so half of them go at once
        let mut kept = self.spectra.lock().unwrap_or_else(|e| e.into_inner());
        match self.levels.iter().position(|l| l.get().is_none()) {
            None => *kept = None,
            Some(richest) => {
                let need = (TOP >> richest) + 1;
                if let Some(sp) = kept.as_ref().filter(|sp| sp.iter().any(|f| f.len() > need)) {
                    *kept = Some(Arc::new(sp.iter().map(|f| f[..need.min(f.len())].to_vec()).collect()));
                }
            }
        }
        lv
    }

    /// Each frame's gain: level 0's loudness (its unscaled frames), as `frame_gains`.
    fn gains(&self) -> [f32; FRAMES] {
        if let Some(g) = self.gains.get() {
            return *g;
        }
        self.level(0);
        *self.gains.get().expect("level 0 sets the gains")
    }

    /// The sample at `phase` (0..1) of the frame at `pos` (0..1), from level `level`.
    #[inline]
    pub fn read(&self, level: usize, pos: f32, phase: f32) -> f32 {
        self.level(level).read(pos, phase)
    }

    /// As `read`, fading `w` (0..1) of the way from `level` to the next level up.
    #[inline]
    pub fn read_blend(&self, level: usize, w: f32, pos: f32, phase: f32) -> f32 {
        let next = if w > 0.0 { Some(self.level((level + 1).min(LEVELS - 1))) } else { None };
        self.level(level).read_blend(next, w, pos, phase)
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

/// How many times a table's spectra or one of its levels has been made (so the synth can tell
/// whether a call has made anything: see Synth::process)
static MADE: AtomicUsize = AtomicUsize::new(0);

/// See MADE.
pub fn made_count() -> usize {
    MADE.load(Ordering::Relaxed)
}

/// Counts something made outside this module (a table's spectra) in `made_count`.
pub fn note_made() {
    MADE.fetch_add(1, Ordering::Relaxed);
}

/// A spectrum: (cosine, sine) amplitude per harmonic, index 0 unused (no DC).
pub type Spectrum = Vec<(f64, f64)>;

/// A table from FRAMES spectra: each frame band-limited into every level (when first read), and
/// levelled.
pub fn from_spectra(spectra: Vec<Spectrum>) -> Table {
    assert_eq!(spectra.len(), FRAMES, "a table has FRAMES spectra");
    Table::new(spectra)
}

/// Level `k` of FRAMES spectra, not yet levelled.
fn synthesize_level(spectra: &[Spectrum], k: usize) -> Level {
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
    Level { size, data }
}

/// Every frame of every level is scaled by its level-0 frame's loudness, so a level change (a
/// note moving octave) doesn't change the level, and frames are a steady loudness apart: the
/// gain for each frame, from level 0 as synthesized.
fn frame_gains(l0: &Level) -> [f32; FRAMES] {
    std::array::from_fn(|f| {
        let stride = l0.size + 1;
        let frame = &l0.data[f * stride..f * stride + l0.size];
        let rms = (frame.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>() / l0.size as f64).sqrt();
        let peak = frame.iter().fold(0f32, |m, x| m.max(x.abs())) as f64;
        // Aim for the RMS of a full-scale sine (0.707) at 0.5, but never past a peak of 1
        (if rms > 1e-9 { (0.5 / rms).min(1.0 / peak.max(1e-9)) } else { 0.0 }) as f32
    })
}

fn scale(lv: &mut Level, gains: &[f32; FRAMES]) {
    let s = lv.size + 1;
    for (f, g) in gains.iter().enumerate() {
        for x in &mut lv.data[f * s..(f + 1) * s] {
            *x *= *g;
        }
    }
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
    Some(from_spectra(spectra))
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
pub fn mix(a: &Spectrum, b: &Spectrum, t: f64) -> Spectrum {
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
pub fn sines(amp: impl Fn(usize) -> f64) -> Spectrum {
    (0..=TOP).map(|h| if h == 0 { (0.0, 0.0) } else { (0.0, amp(h)) }).collect()
}

/// A sine: the first harmonic alone.
pub fn sine() -> Spectrum {
    sines(|h| if h == 1 { 1.0 } else { 0.0 })
}
/// A saw.
pub fn saw() -> Spectrum {
    sines(|h| 2.0 / PI * if h % 2 == 1 { 1.0 } else { -1.0 } / h as f64)
}
/// A square.
pub fn square() -> Spectrum {
    sines(|h| if h % 2 == 1 { 4.0 / (PI * h as f64) } else { 0.0 })
}
/// A triangle.
pub fn triangle() -> Spectrum {
    sines(|h| if h % 2 == 1 { 8.0 / (PI * PI * (h * h) as f64) * if (h / 2) % 2 == 0 { 1.0 } else { -1.0 } } else { 0.0 })
}

/// The spectrum of one cycle given as a function of phase (0..1), finely sampled.
pub fn analyse(f: impl Fn(f64) -> f64) -> Spectrum {
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

#[cfg(test)]
mod tests {
    use super::*;

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
            let lv = t.level(0);
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
        for (k, lv) in (0..LEVELS).map(|k| (k, t.level(k))) {
            let s = lv.size + 1;
            let mean = lv.data[..lv.size].iter().map(|&x| x as f64).sum::<f64>() / lv.size as f64;
            assert!(mean.abs() < 1e-4, "level {k} DC {mean}");
            assert!(lv.data[lv.size] == lv.data[0] && s == lv.size + 1);
        }
        let lv = t.level(6);
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
        assert!((0..LEVELS).all(|k| t.level(k).data.iter().all(|x| *x == 0.0)));
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

    #[test]
    fn a_table_made_a_level_at_a_time_is_the_one_made_all_at_once() {
        // (In any order: each level is its spectra's, scaled by level 0's gains)
        let shapes = [sine(), triangle(), saw(), square(), analyse(|p| (2.0 * PI * p).sin().powi(3) + 0.3 * p)];
        for a in 0..shapes.len() - 1 {
            let spectra: Vec<Spectrum> = (0..FRAMES).map(|f| mix(&shapes[a], &shapes[a + 1], f as f64 / (FRAMES - 1) as f64)).collect();
            let mut levels: Vec<Level> = (0..LEVELS).map(|k| synthesize_level(&spectra, k)).collect();
            let g = frame_gains(&levels[0]);
            for lv in levels.iter_mut() {
                scale(lv, &g);
            }
            let fresh = from_spectra(spectra);
            for k in [7usize, 3, 10, 0, 1, 2, 4, 5, 6, 8, 9] {
                assert!(fresh.level(k).data == levels[k].data, "shapes {a} level {k}");
            }
            assert_eq!(fresh.made().0, LEVELS);
            assert!(fresh.spectra.lock().unwrap().is_none(), "the spectra go once every level is made");
        }
    }
}
