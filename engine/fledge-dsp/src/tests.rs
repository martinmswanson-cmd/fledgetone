//! Tests of the filters, the shapers, the output ceiling and the OTT.

use crate::dynamics::*;
use crate::filter::*;
use crate::shaper::*;
use std::f32::consts::PI;

#[test]
fn svf_low_pass_passes_bass_and_cuts_treble() {
    let sr = 48000.0;
    let c = SvfCoef::new(500.0, sr, 1.414);
    let level = |f: f32| {
        let mut s = Svf::default();
        let mut peak: f32 = 0.0;
        for n in 0..48000 {
            let y = s.tick(&c, (2.0 * PI * f * n as f32 / sr).sin()).lp;
            if n > 24000 {
                peak = peak.max(y.abs());
            }
        }
        peak
    };
    assert!(level(50.0) > 0.95);
    assert!(level(8000.0) < 0.01);
}

#[test]
fn comb_with_high_feedback_stays_bounded() {
    let mut c = Comb::new(48000.0);
    let mut peak: f32 = 0.0;
    for n in 0..96000 {
        let x = if n < 100 { 1.0 } else { 0.0 };
        peak = peak.max(c.tick(x, 109.0, 0.99, false).abs());
    }
    assert!(peak < 4.0, "comb peaked at {peak}");
}

#[test]
fn shaper_integral_matches_shape() {
    for kind in 1..=6 {
        for i in -30..30 {
            let x = i as f32 * 0.1;
            let h = 1e-2;
            let d = (shape_integral(kind, x + h) - shape_integral(kind, x - h)) / (2.0 * h);
            assert!((d - shape(kind, x)).abs() < 0.02, "kind {kind} at {x}: {d} vs {}", shape(kind, x));
        }
    }
}

#[test]
fn safety_clip_never_passes_the_ceiling() {
    for amp in [8.0, 100.0, 1000.0, 1e5] {
        let mut c = SafetyClip::default();
        for i in 0..10000 {
            let x = (i as f32 * 0.01).sin() * amp;
            assert!(c.tick(x).abs() <= 0.9, "amplitude {amp}");
        }
    }
}

#[test]
fn comb_rings_at_its_pitch() {
    for (hz, neg) in [(440.0f32, false), (2000.0, false), (1000.0, true)] {
        let sr = 48000.0;
        // (Comb − too: half a period, fed back upside down, peaks at the pitch and its odd harmonics)
        let peak_at = hz;
        // Where the comb answers loudest, within a semitone: its resonance
        let gain = |f: f32| {
            let mut c = Comb::new(sr);
            let mut peak: f32 = 0.0;
            for i in 0..24000 {
                let y = c.tick((2.0 * PI * f * i as f32 / sr).sin() * 0.01, sr / hz, 0.9, neg);
                if i > 12000 {
                    peak = peak.max(y.abs());
                }
            }
            peak
        };
        let best: i32 = (-100..=100).step_by(2).max_by(|&a, &b| gain(peak_at * 2f32.powf(a as f32 / 1200.0)).partial_cmp(&gain(peak_at * 2f32.powf(b as f32 / 1200.0))).unwrap()).unwrap();
        assert!(best.abs() <= 8, "{hz} Hz (negative {neg}): resonates {best} cents off");
    }
}

#[test]
fn the_comb_sounds_the_same_at_any_sample_rate() {
    let gain = |sr: f32| {
        let mut c = Comb::new(sr);
        let f = 261.6 * 20.0;
        let mut peak: f32 = 0.0;
        for i in 0..(sr as usize) {
            let y = c.tick((2.0 * PI * f * i as f32 / sr).sin() * 0.01, sr / 261.6, 0.97, false);
            if i > sr as usize / 2 {
                peak = peak.max(y.abs());
            }
        }
        20.0 * (peak / 0.01).log10()
    };
    let (a, b) = (gain(48000.0), gain(96000.0));
    assert!((a - b).abs() < 1.5, "48 kHz {a} dB, 96 kHz {b} dB");
}


#[test]
fn quiet_sound_passes_the_ceiling_and_drive_untouched() {
    for sr in [44100.0f32, 96000.0] {
        let mut c = SafetyClip::default();
        let mut peak: f32 = 0.0;
        for i in 0..4800 {
            let x = 0.3 * (2.0 * PI * 15000.0 * i as f32 / sr).sin();
            let y = c.tick(x);
            if i > 100 {
                peak = peak.max((y - x).abs());
            }
        }
        assert!(peak < 1e-5, "{sr}: changed by {peak}");
    }
}

#[test]
fn changing_the_drive_shape_does_not_spike() {
    let mut s = Shaper::default();
    let mut worst: f32 = 0.0;
    for i in 0..4000 {
        let kind = if i < 2000 { 1 } else { 4 };
        let x = 0.05 * (i as f32 * 0.02).sin();
        worst = worst.max(s.tick(kind, x).abs());
    }
    assert!(worst < 0.1, "spiked to {worst}");
}

/// A band-limited saw (a few harmonics), the steepest thing the oscillators send.
fn saw(i: usize, hz: f32, sr: f32) -> f32 {
    (1..40).map(|k| (2.0 * PI * hz * k as f32 * i as f32 / sr).sin() / k as f32).sum::<f32>() * 0.55
}

#[test]
fn heavy_drive_on_a_saw_stays_level() {
    let sr = 48000.0;
    for kind in 1..=5u32 {
        for db in [24.0f32, 36.0, 48.0] {
            let gain = 10f32.powf(db / 20.0);
            let makeup = shaper_makeup(kind, gain);
            let mut s = Shaper::default();
            let peak = (0..9600).map(|i| (s.tick(kind, 0.5 * saw(i, 110.0, sr) * gain) / makeup).abs()).fold(0.0, f32::max);
            // (A clipping shape tops out at 1 before the makeup, the lopsided one at 1.34)
            assert!(peak * makeup < 1.4, "kind {kind} at {db} dB: peak {}", peak * makeup);
        }
    }
}

#[test]
fn fold_drive_keeps_its_level_as_the_drive_rises() {
    let sr = 48000.0;
    let level = |db: f32| {
        let gain = 10f32.powf(db / 20.0);
        let mut s = Shaper::default();
        let sum: f32 = (0..9600).map(|i| (s.tick(4, 0.3 * (2.0 * PI * 130.0 * i as f32 / sr).sin() * gain) / shaper_makeup(4, gain)).powi(2)).sum();
        10.0 * (sum / 9600.0).log10()
    };
    let levels: Vec<f32> = [12.0, 16.0, 18.0, 20.0, 22.0, 24.0, 30.0, 36.0].iter().map(|&d| level(d)).collect();
    let (lo, hi) = levels.iter().fold((f32::MAX, f32::MIN), |(a, b), &l| (a.min(l), b.max(l)));
    assert!(hi - lo < 6.0, "levels {levels:?}");
}

#[test]
fn sound_just_past_the_knee_stays_clean() {
    // What's left after taking out the sine: the knee's own rounding is tiny there
    let sr = 48000.0;
    for hz in [1000.0f32, 3000.0, 6000.0] {
        let mut c = SafetyClip::default();
        let (mut err, mut sig) = (0.0f32, 0.0f32);
        for i in 0..9600 {
            let x = 0.61 * (2.0 * PI * hz * i as f32 / sr).sin();
            let y = c.tick(x);
            if i > 100 {
                err += (y - knee(x)).powi(2);
                sig += x * x;
            }
        }
        let db = 10.0 * (err / sig).log10();
        assert!(db < -40.0, "{hz} Hz: {db} dB off the knee");
    }
}

#[test]
fn a_broken_sample_does_not_stick() {
    let mut c = SafetyClip::default();
    assert_eq!(c.tick(f32::NAN), 0.0);
    assert!(c.tick(0.3).is_finite() && c.tick(0.95).abs() < CEIL);
}

#[test]
fn the_safety_clip_keeps_the_sign_and_the_ceiling_on_any_jump() {
    let mut c = SafetyClip::default();
    for (a, b) in [(3.0f32, 0.6), (100.0, 0.5), (3.6, -0.4), (1e20, 0.2), (-50.0, 0.7)] {
        c.tick(a);
        let y = c.tick(b);
        assert!(y.signum() == b.signum() && y.abs() <= b.abs() && y.abs() < CEIL, "{a} -> {b}: {y}");
    }
    // Loud steady sound sits just under the ceiling (-1 dBFS)
    assert!(c.tick(5.0) > 0.88 && c.tick(5.0) <= CEIL);
}

#[test]
fn ott_lift_fades_out_without_a_step() {
    // A tone fading out slowly: the OTT's gain never jumps from one moment to the next
    let sr: f32 = 48000.0;
    let mut o = Ott::new(sr);
    let (att, rel) = (1.0 - (-1.0 / (0.005 * sr)).exp(), 1.0 - (-1.0 / (0.1 * sr)).exp());
    let mut last = f32::NAN;
    let mut worst: f32 = 0.0;
    for w in 0..300 {
        let amp = 10f32.powf((-50.0 - w as f32 * 0.1) / 20.0);
        let mut sum = 0.0f32;
        for i in 0..480 {
            let x = amp * (2.0 * PI * 1000.0 * (w * 480 + i) as f32 / sr).sin();
            let (l, _) = o.tick(x, x, 1.0, att, rel);
            sum += l * l;
        }
        let db = 10.0 * (sum / 480.0).log10() - 20.0 * amp.log10();
        if w > 20 && last.is_finite() {
            worst = worst.max((db - last).abs());
        }
        last = db;
    }
    assert!(worst < 2.0, "gain stepped by {worst} dB");
}

#[test]
fn dc_goes_and_bass_stays() {
    let sr = 48000.0;
    let r = 1.0 - 2.0 * PI * 5.0 / sr;
    let mut d = DcBlock::default();
    let (mut dc, mut peak) = (0.0f32, 0.0f32);
    for i in 0..96000 {
        let y = d.tick(0.3 + 0.2 * (2.0 * PI * 40.0 * i as f32 / sr).sin(), r);
        if i > 48000 {
            dc += y;
            peak = peak.max(y.abs());
        }
    }
    assert!((dc / 48000.0).abs() < 0.002 && peak > 0.195, "dc {} peak {peak}", dc / 48000.0);
}

#[test]
fn loud_steep_sound_rounds_off_below_the_ceiling() {
    let sr = 48000.0;
    for amp in [1.0f32, 1.5] {
        let mut c = SafetyClip::default();
        let pinned = (0..48000).filter(|&i| c.tick(amp * saw(i, 110.0, sr)).abs() >= CEIL - 1e-4).count();
        assert!(pinned == 0, "amp {amp}: {pinned} samples on the ceiling");
    }
}

#[test]
fn a_bell_turns_its_frequency_and_leaves_the_rest() {
    use crate::bank::Bell;
    let sr = 48000.0;
    let gain = |hz: f32, db: f32| {
        let mut b = Bell::default();
        b.set(1000.0, db, 4.0, sr);
        let (mut e_in, mut e_out) = (0.0f64, 0.0f64);
        for i in 0..48000 {
            let x = (std::f32::consts::TAU * hz * i as f32 / sr).sin();
            let y = b.tick(x);
            if i > 24000 {
                e_in += (x * x) as f64;
                e_out += (y * y) as f64;
            }
        }
        10.0 * (e_out / e_in).log10()
    };
    assert!((gain(1000.0, -12.0) + 12.0).abs() < 0.1, "{}", gain(1000.0, -12.0));
    assert!((gain(1000.0, 6.0) - 6.0).abs() < 0.1);
    assert!(gain(100.0, -12.0).abs() < 0.2 && gain(8000.0, -12.0).abs() < 0.2, "far away it's untouched");
    assert!(gain(1000.0, 0.0).abs() < 1e-4 && gain(700.0, 0.0).abs() < 1e-4, "at 0 dB it does nothing");
}

#[test]
fn a_bank_hears_a_sine_in_its_own_band() {
    use crate::bank::Bank;
    let sr = 48000.0;
    let mut bank = Bank::new(sr, 28, 60.0, 16000.0, 0.02);
    let k = 14;
    let hz = bank.hz[k];
    for i in 0..24000 {
        let x = 0.5 * (std::f32::consts::TAU * hz * i as f32 / sr).sin();
        bank.hear(x, x);
    }
    assert!((bank.db(k) + 6.0).abs() < 0.5, "its own band reads the sine's level: {}", bank.db(k));
    assert!(bank.db(k - 4) < bank.db(k) - 12.0 && bank.db(k + 4) < bank.db(k) - 12.0, "bands away read much less");
    bank.hear(f32::NAN, 0.0);
    assert!(bank.level.iter().all(|v| v.is_finite()));
}
