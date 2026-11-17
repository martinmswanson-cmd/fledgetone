//! The synth's own wavetables: made here, from formulas (no one else's tables), when first used.
//! How a table is kept and read (frames, band-limited levels) is `fledge_dsp::wavetable`.

pub use fledge_dsp::wavetable::{level_blend, level_for, made_count, user_table, Level, Table, FRAMES, LEVELS, USER_CYCLE, USER_FRAMES_MAX};
use fledge_dsp::wavetable::{analyse, from_spectra, mix, note_made, saw, sine, sines, square, triangle, Spectrum, TOP};
use std::f64::consts::PI;
use std::sync::OnceLock;

static TABLES: [OnceLock<Table>; 16] = [const { OnceLock::new() }; 16];

/// Table `i` (made the first time it's asked for).
pub fn table(i: usize) -> &'static Table {
    let i = i.min(TABLES.len() - 1);
    TABLES[i].get_or_init(|| build(i))
}

fn build(which: usize) -> Table {
    note_made();
    let spectra: Vec<Spectrum> = (0..FRAMES).map(|f| frame_spectrum(which, f as f64 / (FRAMES - 1) as f64)).collect();
    from_spectra(spectra)
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

#[cfg(test)]
mod tests {
    use super::*;
    use fledge_dsp::fft::fft;

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
        let lv = t.level(6);
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
    fn a_table_makes_only_the_levels_read() {
        // A note around middle C reads level 3 or 4: level 0 (the gains) and those are made, not
        // the other big ones
        let t = build(2);
        assert_eq!(t.made().0, 0);
        let inc = 262.0 / 48000.0;
        let k = level_for(inc);
        t.read_blend(k, 0.0, 0.5, 0.25);
        assert_eq!(t.made().0, 2);
        assert!(t.level_if_made(0).is_some() && t.level_if_made(k).is_some() && t.level_if_made(1).is_none());
    }

    #[test]
    fn the_built_in_tables_are_made_the_same_every_time() {
        for which in [0usize, 5, 15] {
            let fresh = build(which);
            for k in [7usize, 3, 10, 0] {
                assert!(fresh.level(k).data == table(which).level(k).data, "table {which} level {k}");
            }
        }
    }
}
