use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Heat {
    let mut h = Heat::new(SR);
    for &(i, x) in sets {
        h.set(i, normal(i, x));
    }
    h
}
const fn at(band: usize, what: usize) -> usize {
    BAND + band * 3 + what
}

fn tone(hz: f32, amp: f32, seconds: f32) -> Vec<f32> {
    (0..(seconds * SR) as usize).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

fn run(h: &mut Heat, x: &[f32], block: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for chunk in x.chunks(block) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        h.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert_eq!(l, r);
        out.extend(l);
    }
    out
}

/// How loud `hz` is in the last half of `x`, dB (a sine of 1 reads 0).
fn level_at(x: &[f32], hz: f32) -> f32 {
    let from = x.len() / 2;
    let (mut re, mut im) = (0.0f64, 0.0f64);
    for (i, &v) in x[from..].iter().enumerate() {
        let w = (TAU * hz * i as f32 / SR) as f64;
        re += v as f64 * w.cos();
        im += v as f64 * w.sin();
    }
    let n = (x.len() - from) as f64;
    (20.0 * (2.0 * (re * re + im * im).sqrt() / n).max(1e-9).log10()) as f32
}
fn rms_db(x: &[f32]) -> f32 {
    let half = &x[x.len() / 2..];
    (10.0 * (half.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / half.len() as f64).max(1e-18).log10()) as f32
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.5, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    for (k, name) in STYLES.iter().enumerate() {
        let h = with(&[(at(1, STYLE), k as f32)]);
        assert_eq!(h.param_display(at(1, STYLE)), *name);
    }
    let h = Heat::new(SR);
    assert_eq!(h.param_display(LOW_SPLIT), "200 Hz");
    assert_eq!(h.param_display(HIGH_SPLIT), "3.0 kHz");
    assert_eq!(h.param_display(at(0, DRIVE)), "12.0 dB");
    assert_eq!(h.param_display(OUTPUT), "+0.0 dB");
    assert_eq!(h.param_display(MIX), "100 %");
}

#[test]
fn clean_bands_add_back_to_the_sound_level_for_level() {
    for hz in [50.0, 200.0, 700.0, 3000.0, 9000.0] {
        let x = tone(hz, 0.5, 1.0);
        let y = run(&mut Heat::new(SR), &x, 128);
        assert!((rms_db(&y) - rms_db(&x)).abs() < 0.05, "{hz} Hz comes out {} dB different", rms_db(&y) - rms_db(&x));
        assert!(level_at(&y, hz * 3.0) < -90.0, "and nothing is added");
    }
}

#[test]
fn the_bands_add_back_wherever_the_crossovers_sit() {
    for (low, high) in [(200.0, 3000.0), (600.0, 1000.0), (800.0, 1200.0), (1000.0, 1000.0), (60.0, 12000.0)] {
        let mut worst = 0.0f32;
        for step in 0..40 {
            let hz = 100.0 * 1.12f32.powi(step);
            let x = tone(hz, 0.5, 0.5);
            let y = run(&mut with(&[(LOW_SPLIT, low), (HIGH_SPLIT, high)]), &x, 128);
            worst = worst.max((rms_db(&y) - rms_db(&x)).abs());
        }
        println!("crossovers at {low} and {high} Hz: the worst from flat between 100 Hz and 8 kHz is {worst:.2} dB");
        assert!(worst < 0.1, "{low} / {high}: {worst} dB");
    }
    // The upper crossover is shown as it's used: half an octave and more above the lower
    assert_eq!(with(&[(LOW_SPLIT, 1000.0), (HIGH_SPLIT, 1000.0)]).param_display(HIGH_SPLIT), "1.5 kHz");
}

#[test]
fn a_driven_band_keeps_its_top_end_and_the_mix_does_not_comb() {
    // A quiet high note through the highs on Soft with no drive: it should pass as it is
    for hz in [5000.0, 10000.0, 18000.0] {
        let x = tone(hz, 0.01, 0.5);
        let wet = run(&mut with(&[(at(2, STYLE), 1.0), (at(2, DRIVE), 0.0)]), &x, 128);
        let half = run(&mut with(&[(at(2, STYLE), 1.0), (at(2, DRIVE), 0.0), (MIX, 0.5)]), &x, 128);
        println!("{hz} Hz through a driven band: {:+.2} dB; at half mix {:+.2} dB", rms_db(&wet) - rms_db(&x), rms_db(&half) - rms_db(&x));
        assert!((rms_db(&wet) - rms_db(&x)).abs() < 2.0, "{hz} Hz");
        assert!((rms_db(&half) - rms_db(&x)).abs() < 1.5, "{hz} Hz at half mix");
    }
}

#[test]
fn a_clean_band_has_its_level_too() {
    let x = tone(1000.0, 0.3, 0.5);
    let y = run(&mut with(&[(at(1, LEVEL), -12.0)]), &x, 128);
    // (Not quite the whole 12 dB: a little of a 1 kHz note is in the bands either side)
    assert!((rms_db(&y) - rms_db(&x) + 12.0).abs() < 0.5, "{}", rms_db(&y) - rms_db(&x));
}

#[test]
fn a_band_switched_to_clean_and_back_starts_clean() {
    let mut h = with(&[(at(0, STYLE), 3.0), (at(0, DRIVE), 24.0)]);
    run(&mut h, &tone(60.0, 0.8, 0.5), 128);
    h.set(at(0, STYLE), normal(at(0, STYLE), 0.0));
    run(&mut h, &vec![0.0; 96000], 128);
    h.set(at(0, STYLE), normal(at(0, STYLE), 3.0));
    let y = run(&mut h, &vec![0.0; 4800], 128);
    let peak = y.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(peak < 1e-4, "silence in, and {peak} came out");
}

#[test]
fn a_band_is_distorted_alone() {
    // 100 Hz (lows) and 1 kHz (mids) together, only the lows driven
    let x: Vec<f32> = tone(100.0, 0.4, 2.0).iter().zip(tone(1000.0, 0.4, 2.0)).map(|(a, b)| a + b).collect();
    let y = run(&mut with(&[(at(0, STYLE), 3.0), (at(0, DRIVE), 24.0)]), &x, 128);
    println!("lows driven hard: 300 Hz at {:.1} dB, 3 kHz at {:.1} dB, 800 Hz at {:.1} dB", level_at(&y, 300.0), level_at(&y, 3000.0), level_at(&y, 800.0));
    assert!(level_at(&y, 300.0) > -30.0, "the low note has its third harmonic");
    assert!(level_at(&y, 3000.0) < -70.0, "the mid note has none");
    // (800 Hz is 1 kHz less twice 100 Hz: what the two would make if they were distorted together)
    assert!(level_at(&y, 800.0) < -60.0, "and the two notes don't beat against each other");
    assert!((level_at(&y, 1000.0) - level_at(&x, 1000.0)).abs() < 0.2);
}

#[test]
fn more_drive_is_more_grit_not_much_more_level() {
    let x = tone(1000.0, 0.3, 1.0);
    for style in 1..STYLES.len() {
        let gentle = run(&mut with(&[(at(1, STYLE), style as f32), (at(1, DRIVE), 6.0)]), &x, 128);
        let hard = run(&mut with(&[(at(1, STYLE), style as f32), (at(1, DRIVE), 30.0)]), &x, 128);
        let third = |y: &[f32]| level_at(y, 3000.0).max(level_at(y, 2000.0));
        println!("{}: at 6 dB of drive {:+.1} dB and harmonics at {:.0} dB; at 30 dB {:+.1} dB and {:.0} dB", STYLES[style], rms_db(&gentle) - rms_db(&x), third(&gentle), rms_db(&hard) - rms_db(&x), third(&hard));
        assert!(third(&hard) > third(&gentle) + 6.0, "{}", STYLES[style]);
        assert!((rms_db(&hard) - rms_db(&x)).abs() < 9.0, "{} stays within 9 dB of the sound's level", STYLES[style]);
    }
}

#[test]
fn level_mix_and_output_do_what_they_say() {
    let x = tone(1000.0, 0.3, 1.0);
    let driven = [(at(1, STYLE), 1.0), (at(1, DRIVE), 18.0)];
    let base = run(&mut with(&driven), &x, 128);
    let up = run(&mut with(&[driven[0], driven[1], (at(1, LEVEL), 6.0)]), &x, 128);
    assert!((rms_db(&up) - rms_db(&base) - 6.0).abs() < 0.1);
    let out = run(&mut with(&[driven[0], driven[1], (OUTPUT, -6.0)]), &x, 128);
    assert!((rms_db(&out) - rms_db(&base) + 6.0).abs() < 0.1);
    let dry = run(&mut with(&[driven[0], driven[1], (MIX, 0.0)]), &x, 128);
    let clean = run(&mut Heat::new(SR), &x, 128);
    assert_eq!(dry, clean, "no mix is the clean sound");
}

#[test]
fn the_same_whatever_the_block_size() {
    let x = tone(300.0, 0.5, 0.5);
    let sets = [(at(0, STYLE), 6.0), (at(1, STYLE), 4.0), (at(2, STYLE), 5.0), (at(1, DRIVE), 20.0)];
    assert_eq!(run(&mut with(&sets), &x, 128), run(&mut with(&sets), &x, 37));
}

#[test]
fn silence_stays_silent_and_broken_samples_do_not_stick() {
    for style in 1..STYLES.len() {
        let y = run(&mut with(&[(at(0, STYLE), style as f32), (at(1, STYLE), style as f32), (at(2, STYLE), style as f32)]), &vec![0.0; 9600], 128);
        assert!(y[4800..].iter().all(|v| v.abs() < 1e-4), "{} leaves no hum", STYLES[style]);
    }
    let mut x = tone(500.0, 0.5, 0.3);
    x[40] = f32::NAN;
    let mut h = with(&[(at(1, STYLE), 3.0)]);
    let mut out = Vec::new();
    for chunk in x.chunks(128) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        h.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        out.extend(l);
    }
    assert!(out.iter().all(|v| v.is_finite()));
}

#[test]
fn every_preset_is_within_range_and_named() {
    assert_eq!(Heat::program_count(), presets().len());
    for (i, (name, values)) in presets().iter().enumerate() {
        assert_eq!(Heat::program_name(i), *name);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut h = Heat::new(SR);
        h.set_program(i);
        let y = run(&mut h, &tone(440.0, 0.4, 0.3), 128);
        assert!(y.iter().all(|v| v.abs() < 2.0), "{name}");
    }
}
