use super::*;
use fledge_dsp::math::Rng;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Smooth {
    let mut s = Smooth::new(SR);
    for &(i, x) in sets {
        s.set(i, normal(i, x));
    }
    s
}

/// Hiss with a sine of `amp` at `hz` ringing over it, `seconds` long.
fn ringing(hz: f32, amp: f32, seconds: f32) -> Vec<f32> {
    let mut rng = Rng::new(7);
    (0..(seconds * SR) as usize).map(|i| 0.02 * rng.bipolar() + amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

fn run(s: &mut Smooth, x: &[f32], block: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for chunk in x.chunks(block) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
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

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.25, 0.5, 0.75, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    let s = Smooth::new(SR);
    assert_eq!(s.param_display(DEPTH), "50 %");
    assert_eq!(s.param_display(THRESHOLD), "4.0 dB");
    assert_eq!(s.param_display(LOW), "60 Hz");
    assert_eq!(s.param_display(HIGH), "16.0 kHz");
    assert_eq!(s.param_display(LISTEN), "Off");
}

#[test]
fn a_frequency_that_rings_over_the_rest_is_turned_down() {
    let x = ringing(2000.0, 0.3, 2.0);
    let before = level_at(&x, 2000.0);
    let y = run(&mut with(&[]), &x, 128);
    let after = level_at(&y, 2000.0);
    assert!(before - after > 6.0, "the ringing is down by {} dB", before - after);
    let deeper = run(&mut with(&[(DEPTH, 1.0)]), &x, 128);
    assert!(after - level_at(&deeper, 2000.0) > 4.0, "more depth takes more");
}

#[test]
fn a_sound_with_nothing_standing_out_is_left_alone() {
    let mut rng = Rng::new(3);
    let x: Vec<f32> = (0..96000).map(|_| 0.2 * rng.bipolar()).collect();
    let mut s = with(&[]);
    let y = run(&mut s, &x, 128);
    let (e_in, e_out): (f64, f64) = (x[48000..].iter().map(|v| (*v as f64).powi(2)).sum(), y[48000..].iter().map(|v| (*v as f64).powi(2)).sum());
    assert!((10.0 * (e_out / e_in).log10()).abs() < 1.0, "hiss changes by {} dB", 10.0 * (e_out / e_in).log10());
}

#[test]
fn only_inside_its_range_and_only_what_stands_out() {
    let x = ringing(2000.0, 0.3, 2.0);
    let y = run(&mut with(&[(LOW, 4000.0)]), &x, 128);
    assert!((level_at(&x, 2000.0) - level_at(&y, 2000.0)).abs() < 0.5, "outside From..To it's untouched");
    let high_bar = run(&mut with(&[(THRESHOLD, 18.0), (DEPTH, 0.5)]), &x, 128);
    let low_bar = run(&mut with(&[(THRESHOLD, 0.0), (DEPTH, 0.5)]), &x, 128);
    assert!(level_at(&high_bar, 2000.0) > level_at(&low_bar, 2000.0) + 3.0, "a higher bar takes less");
}

#[test]
fn at_no_depth_the_sound_passes_exactly() {
    let x = ringing(2000.0, 0.3, 0.5);
    assert_eq!(run(&mut with(&[(DEPTH, 0.0)]), &x, 128), x);
}

#[test]
fn it_lets_go_when_the_ringing_stops() {
    let mut x = ringing(2000.0, 0.3, 1.0);
    let mut rng = Rng::new(9);
    x.extend((0..96000).map(|_| 0.02 * rng.bipolar()));
    let mut s = with(&[]);
    run(&mut s, &x[..48000], 128);
    assert!((0..BANDS).any(|b| s.cut(b) > 3.0));
    run(&mut s, &x[48000..], 128);
    assert!((0..BANDS).all(|b| s.cut(b) < 1.5), "two seconds on, every band is back (but for the flutter hiss gives): {:?}", (0..BANDS).map(|b| s.cut(b)).fold(0.0, f32::max));
}

#[test]
fn the_same_whatever_the_block_size() {
    let x = ringing(700.0, 0.3, 0.6);
    let a = run(&mut with(&[]), &x, 128);
    let b = run(&mut with(&[]), &x, 37);
    assert_eq!(a, b);
}

#[test]
fn listening_plays_what_was_removed() {
    let x = ringing(2000.0, 0.3, 1.0);
    let y = run(&mut with(&[]), &x, 128);
    let d = run(&mut with(&[(LISTEN, 1.0)]), &x, 128);
    for i in 0..x.len() {
        assert!((x[i] - y[i] - d[i]).abs() < 1e-5);
    }
    assert!(level_at(&d, 2000.0) > level_at(&d, 500.0) + 20.0, "what's removed is the ringing");
}

#[test]
fn silence_and_broken_samples_stay_quiet() {
    let mut s = with(&[]);
    assert!(run(&mut s, &vec![0.0; 4800], 128).iter().all(|v| *v == 0.0));
    let mut x = ringing(2000.0, 0.3, 0.2);
    x[100] = f32::NAN;
    x[101] = f32::INFINITY;
    let mut s = with(&[]);
    let mut out = Vec::new();
    for chunk in x.chunks(128) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        out.extend(l);
    }
    assert!(out[4800..].iter().all(|v| v.is_finite()), "it recovers after a broken sample");
}

#[test]
fn every_preset_is_within_range_and_named() {
    assert_eq!(Smooth::program_count(), presets().len());
    for (i, (name, values)) in presets().iter().enumerate() {
        assert_eq!(Smooth::program_name(i), *name);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut s = Smooth::new(SR);
        s.set_program(i);
        assert_eq!(s.params, *values);
    }
}

#[test]
fn how_much_it_takes() {
    // (Printed with --nocapture: the numbers the README quotes)
    let x = ringing(2000.0, 0.3, 2.0);
    for depth in [0.25, 0.5, 1.0] {
        let y = run(&mut with(&[(DEPTH, depth)]), &x, 128);
        println!("depth {depth}: the ringing down {:.1} dB, 500 Hz {:+.2} dB", level_at(&x, 2000.0) - level_at(&y, 2000.0), level_at(&y, 500.0) - level_at(&x, 500.0));
    }
    let mut rng = Rng::new(3);
    let hiss: Vec<f32> = (0..96000).map(|_| 0.2 * rng.bipolar()).collect();
    for attack in [1.0, 10.0, 100.0] {
        let mut s = with(&[(ATTACK, attack)]);
        let mut deepest = 0.0f32;
        for chunk in hiss.chunks(128) {
            run(&mut s, chunk, 128);
            deepest = (0..BANDS).map(|b| s.cut(b)).fold(deepest, f32::max);
        }
        println!("on hiss alone, attack {attack} ms: the deepest cut at any moment is {deepest:.2} dB");
        assert!(deepest < 2.5);
    }
    // How soon it catches a ringing that starts
    for attack in [1.0, 30.0] {
        let mut s = with(&[(ATTACK, attack), (DEPTH, 1.0)]);
        let x = ringing(1000.0, 0.3, 0.1);
        let mut at = vec![];
        for (i, chunk) in x.chunks(960).enumerate() {
            run(&mut s, chunk, 128);
            if [0, 1, 3].contains(&i) {
                at.push((0..BANDS).map(|b| s.cut(b)).fold(0.0, f32::max));
            }
        }
        println!("attack {attack} ms: {:.1} dB cut after 20 ms, {:.1} after 40 ms, {:.1} after 80 ms", at[0], at[1], at[2]);
    }
}
