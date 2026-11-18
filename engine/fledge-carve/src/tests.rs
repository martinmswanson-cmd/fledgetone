use super::*;
use fledge_dsp::math::Rng;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Carve {
    let mut c = Carve::new(SR);
    for &(i, x) in sets {
        c.set(i, normal(i, x));
    }
    c
}

/// This track: sines at 200 Hz, 1 kHz and 5 kHz, each at 0.2.
fn track(seconds: f32) -> Vec<f32> {
    (0..(seconds * SR) as usize).map(|i| [200.0, 1000.0, 5000.0].iter().map(|hz| 0.2 * (TAU * hz * i as f32 / SR).sin()).sum()).collect()
}
fn tone(hz: f32, amp: f32, seconds: f32) -> Vec<f32> {
    (0..(seconds * SR) as usize).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

fn run(c: &mut Carve, x: &[f32], key: Option<&[f32]>, block: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    let mut n = 0;
    for chunk in x.chunks(block) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        let k = key.map(|k| &k[n..n + chunk.len()]);
        c.process(&mut Block { input: [chunk, chunk], sidechain: k.map(|k| [k, k]), output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert_eq!(l, r);
        out.extend(l);
        n += chunk.len();
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

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.25, 0.5, 0.75, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    let c = Carve::new(SR);
    assert_eq!(c.param_display(AMOUNT), "8.0 dB");
    assert_eq!(c.param_display(THRESHOLD), "-40.0 dB");
    assert_eq!(c.param_display(HIGH), "16.0 kHz");
}

#[test]
fn it_turns_down_only_where_the_other_track_is() {
    let x = track(2.0);
    let key = tone(1000.0, 0.5, 2.0);
    let y = run(&mut with(&[]), &x, Some(&key), 128);
    let down = |hz: f32| level_at(&x, hz) - level_at(&y, hz);
    println!("with the other track at 1 kHz: 200 Hz down {:.2} dB, 1 kHz down {:.2} dB, 5 kHz down {:.2} dB", down(200.0), down(1000.0), down(5000.0));
    assert!(down(1000.0) > 6.0, "where the other track is: {} dB", down(1000.0));
    assert!(down(200.0).abs() < 0.5 && down(5000.0).abs() < 0.5, "elsewhere: {} and {} dB", down(200.0), down(5000.0));
}

#[test]
fn more_amount_takes_more_and_a_quiet_track_takes_nothing() {
    let x = track(2.0);
    let key = tone(1000.0, 0.5, 2.0);
    let a = run(&mut with(&[(AMOUNT, 4.0)]), &x, Some(&key), 128);
    let b = run(&mut with(&[(AMOUNT, 16.0)]), &x, Some(&key), 128);
    assert!(level_at(&a, 1000.0) - level_at(&b, 1000.0) > 8.0);
    let quiet = tone(1000.0, 0.001, 2.0);
    let c = run(&mut with(&[]), &x, Some(&quiet), 128);
    assert!((level_at(&x, 1000.0) - level_at(&c, 1000.0)).abs() < 0.2, "under the threshold nothing is taken");
}

#[test]
fn with_no_sidechain_the_sound_passes_exactly() {
    let x = track(0.5);
    assert_eq!(run(&mut with(&[]), &x, None, 128), x);
    let key = tone(1000.0, 0.5, 0.5);
    assert_eq!(run(&mut with(&[(AMOUNT, 0.0)]), &x, Some(&key), 128), x, "and at no amount");
}

#[test]
fn only_inside_its_range() {
    let x = track(2.0);
    let key = tone(1000.0, 0.5, 2.0);
    let y = run(&mut with(&[(LOW, 3000.0)]), &x, Some(&key), 128);
    assert!((level_at(&x, 1000.0) - level_at(&y, 1000.0)).abs() < 0.3);
}

#[test]
fn it_lets_go_when_the_other_track_stops_or_is_taken_away() {
    let x = track(3.0);
    let mut key = tone(1000.0, 0.5, 1.0);
    key.extend(vec![0.0; 96000]);
    let mut c = with(&[]);
    run(&mut c, &x[..48000], Some(&key[..48000]), 128);
    assert!((0..BANDS).any(|b| c.cut(b) > 4.0));
    run(&mut c, &x[48000..], Some(&key[48000..]), 128);
    assert!((0..BANDS).all(|b| c.cut(b) < 0.1), "two seconds after it stops");
    let mut c = with(&[]);
    run(&mut c, &x[..48000], Some(&key[..48000]), 128);
    run(&mut c, &x[48000..], None, 128);
    assert!((0..BANDS).all(|b| c.cut(b) < 0.1), "two seconds after it's disconnected");
}

#[test]
fn the_same_whatever_the_block_size() {
    let x = track(0.6);
    let key = tone(1000.0, 0.5, 0.6);
    assert_eq!(run(&mut with(&[]), &x, Some(&key), 128), run(&mut with(&[]), &x, Some(&key), 37));
}

#[test]
fn listening_plays_what_was_removed() {
    let x = track(1.0);
    let key = tone(1000.0, 0.5, 1.0);
    let y = run(&mut with(&[]), &x, Some(&key), 128);
    let d = run(&mut with(&[(LISTEN, 1.0)]), &x, Some(&key), 128);
    for i in 0..x.len() {
        assert!((x[i] - y[i] - d[i]).abs() < 1e-5);
    }
    assert!(level_at(&d, 1000.0) > level_at(&d, 200.0) + 8.0, "mostly where the other track is: {} against {}", level_at(&d, 1000.0), level_at(&d, 200.0));
}

#[test]
fn broken_samples_do_not_stick() {
    let mut x = track(0.4);
    let mut key = tone(1000.0, 0.5, 0.4);
    x[50] = f32::NAN;
    key[60] = f32::INFINITY;
    let mut c = with(&[]);
    let mut out = Vec::new();
    for (chunk, k) in x.chunks(128).zip(key.chunks(128)) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        c.process(&mut Block { input: [chunk, chunk], sidechain: Some([k, k]), output: [&mut l, &mut r] });
        out.extend(l);
    }
    assert!(out.iter().all(|v| v.is_finite()));
    let mut rng = Rng::new(1);
    assert!(rng.next().is_finite());
}

#[test]
fn every_preset_is_within_range_and_named() {
    assert_eq!(Carve::program_count(), presets().len());
    for (i, (name, values)) in presets().iter().enumerate() {
        assert_eq!(Carve::program_name(i), *name);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
    }
}
