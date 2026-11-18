use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;
/// At 120 BPM a beat is half a second: 24000 samples
const BEAT: usize = 24000;

fn with(sets: &[(usize, f32)]) -> Shape {
    let mut s = Shape::new(SR);
    s.set_tempo(120.0);
    s.set_position(0.0);
    for &(i, x) in sets {
        s.set(i, normal(i, x));
    }
    s
}

fn tone(hz: f32, amp: f32, samples: usize) -> Vec<f32> {
    (0..samples).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

fn run(s: &mut Shape, x: &[f32], block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ol, mut or) = (Vec::new(), Vec::new());
    for chunk in x.chunks(block) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        ol.extend(l);
        or.extend(r);
    }
    (ol, or)
}

/// The level of `x` around sample `at` (over 10 ms), as a gain on a sine of `amp`, dB.
fn gain_at(x: &[f32], at: usize, amp: f32) -> f32 {
    let w = &x[at.saturating_sub(240)..(at + 240).min(x.len())];
    let rms = (w.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / w.len() as f64).sqrt() as f32;
    20.0 * (rms / (amp / 2f32.sqrt())).max(1e-6).log10()
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    for (k, name) in SHAPES.iter().enumerate() {
        assert_eq!(with(&[(SHAPE, k as f32)]).param_display(SHAPE), *name);
    }
    for (k, name) in RATES.iter().enumerate() {
        assert_eq!(with(&[(RATE, k as f32)]).param_display(RATE), *name);
    }
    for (k, name) in TARGETS.iter().enumerate() {
        assert_eq!(with(&[(TARGET, k as f32)]).param_display(TARGET), *name);
    }
    assert_eq!(Shape::new(SR).param_display(DEPTH), "70 %");
}

#[test]
fn every_shape_stays_between_shut_and_open() {
    for kind in 0..SHAPES.len() {
        for step in 0..=1000 {
            let h = shape(kind, step as f32 / 1000.0);
            assert!((0.0..=1.0).contains(&h), "{} at {step}", SHAPES[kind]);
        }
    }
    assert_eq!(shape(0, 0.0), 0.0);
    assert_eq!(shape(0, 0.8), 1.0);
    assert_eq!((shape(1, 0.0), shape(2, 0.0), shape(3, 0.5)), (1.0, 0.0, 1.0));
    assert_eq!((shape(4, 0.2), shape(4, 0.7)), (1.0, 0.0));
    assert_eq!((shape(6, 0.1), shape(6, 0.9)), (1.0, 0.0));
}

#[test]
fn a_duck_on_the_volume_pumps_on_every_beat() {
    let x = tone(440.0, 0.5, BEAT * 4);
    let (y, r) = run(&mut with(&[(DEPTH, 1.0), (SMOOTH, 0.0)]), &x, 128);
    assert_eq!(y, r);
    for beat in 1..4 {
        let (down, up) = (gain_at(&y, beat * BEAT + 600, 0.5), gain_at(&y, beat * BEAT + BEAT * 9 / 10, 0.5));
        assert!(down < -20.0, "just after beat {beat} it's down: {down} dB");
        assert!(up.abs() < 0.2, "before the next it's back: {up} dB");
    }
    let (half, _) = run(&mut with(&[(DEPTH, 0.5), (SMOOTH, 0.0)]), &x, 128);
    assert!((gain_at(&half, BEAT + 300, 0.5) + 6.0).abs() < 1.0, "half the depth is half the way down");
}

#[test]
fn at_no_depth_the_sound_is_untouched_whatever_it_moves() {
    let x = tone(440.0, 0.5, BEAT);
    for target in [VOLUME, LOW_PASS, HIGH_PASS, PAN] {
        let (l, r) = run(&mut with(&[(TARGET, target as f32), (DEPTH, 0.0)]), &x, 128);
        assert_eq!(l, x, "{}", TARGETS[target]);
        assert_eq!(r, x);
    }
}

#[test]
fn it_follows_the_rate_and_where_it_starts() {
    let x = tone(440.0, 0.5, BEAT * 4);
    // Every half beat (1/8): down at each
    let (y, _) = run(&mut with(&[(RATE, 5.0), (DEPTH, 1.0), (SMOOTH, 0.0)]), &x, 128);
    assert!(gain_at(&y, BEAT + BEAT / 2 + 300, 0.5) < -20.0 && gain_at(&y, BEAT + 300, 0.5) < -20.0);
    // Starting half way along: down in the middle of the beat, up on it
    let (z, _) = run(&mut with(&[(OFFSET, 0.5), (DEPTH, 1.0), (SMOOTH, 0.0)]), &x, 128);
    assert!(gain_at(&z, BEAT + BEAT / 2 + 600, 0.5) < -20.0 && gain_at(&z, 2 * BEAT + BEAT * 4 / 10, 0.5) > -1.0);
}

#[test]
fn it_follows_the_songs_position_and_tempo() {
    let x = tone(440.0, 0.5, BEAT);
    // Told it's half way through a beat, it is half way through its shape
    let mut s = with(&[(SHAPE, 1.0), (DEPTH, 1.0), (SMOOTH, 0.0)]);
    s.set_position(8.5);
    let (y, _) = run(&mut s, &x, 128);
    assert!((gain_at(&y, 240, 0.5) + 6.0).abs() < 0.5, "a fall, half way down: {}", gain_at(&y, 240, 0.5));
    // Stopped (a position under 0), it runs on rather than freezing
    let mut s = with(&[(DEPTH, 1.0), (SMOOTH, 0.0)]);
    s.set_position(-1.0);
    let (z, _) = run(&mut s, &tone(440.0, 0.5, BEAT * 2), 128);
    assert!(gain_at(&z, BEAT + 600, 0.5) < -20.0);
    // At twice the tempo a beat is half as long
    let mut s = with(&[(DEPTH, 1.0), (SMOOTH, 0.0)]);
    s.set_tempo(240.0);
    let (w, _) = run(&mut s, &tone(440.0, 0.5, BEAT * 2), 128);
    assert!(gain_at(&w, BEAT / 2 + 600, 0.5) < -20.0);
}

#[test]
fn a_low_pass_closes_and_a_high_pass_thins() {
    // A gate: open for the first half of each beat, shut for the second
    let high = tone(8000.0, 0.5, BEAT * 2);
    let (y, _) = run(&mut with(&[(TARGET, 1.0), (SHAPE, 4.0), (DEPTH, 1.0), (SMOOTH, 0.2)]), &high, 128);
    assert!(gain_at(&y, BEAT + BEAT / 4, 0.5) > -1.5, "open, 8 kHz passes: {}", gain_at(&y, BEAT + BEAT / 4, 0.5));
    assert!(gain_at(&y, BEAT + BEAT * 3 / 4, 0.5) < -40.0, "shut, it's gone");
    let low = tone(100.0, 0.5, BEAT * 2);
    let (z, _) = run(&mut with(&[(TARGET, 2.0), (SHAPE, 4.0), (DEPTH, 1.0), (SMOOTH, 0.2)]), &low, 128);
    assert!(gain_at(&z, BEAT + BEAT / 4, 0.5) > -1.0 && gain_at(&z, BEAT + BEAT * 3 / 4, 0.5) < -40.0);
    // The low-pass leaves a low note alone all the way through
    let (lo, _) = run(&mut with(&[(TARGET, 1.0), (SHAPE, 4.0), (DEPTH, 1.0), (SMOOTH, 0.2)]), &low, 128);
    assert!(gain_at(&lo, BEAT + BEAT * 3 / 4, 0.5) > -1.5);
}

#[test]
fn the_pan_swings_from_side_to_side_and_never_turns_a_side_up() {
    let x = tone(440.0, 0.5, BEAT * 8);
    // A triangle every bar (four beats): left at the bar line, right in the middle of the bar
    let (l, r) = run(&mut with(&[(TARGET, 3.0), (SHAPE, 3.0), (RATE, 2.0), (DEPTH, 1.0), (SMOOTH, 0.0)]), &x, 128);
    let bar = 4 * BEAT;
    assert!(gain_at(&l, bar + 600, 0.5) > -0.5 && gain_at(&r, bar + 600, 0.5) < -25.0, "at the bar line: left");
    assert!(gain_at(&r, bar + bar / 2, 0.5) > -0.5 && gain_at(&l, bar + bar / 2, 0.5) < -25.0, "half way: right");
    assert!((gain_at(&l, bar + bar / 4, 0.5)).abs() < 0.5 && (gain_at(&r, bar + bar / 4, 0.5)).abs() < 0.5, "a quarter way: the middle, both whole");
    assert!(l.iter().chain(&r).all(|v| v.abs() <= 0.5 + 1e-4));
}

#[test]
fn the_same_whatever_the_block_size() {
    let x = tone(440.0, 0.5, BEAT);
    for target in 0..TARGETS.len() {
        let sets = [(TARGET, target as f32), (SHAPE, 5.0), (RATE, 2.0), (DEPTH, 0.9)];
        assert_eq!(run(&mut with(&sets), &x, 128), run(&mut with(&sets), &x, 37), "{}", TARGETS[target]);
    }
}

#[test]
fn broken_samples_do_not_stick_and_presets_are_in_range() {
    let mut x = tone(440.0, 0.5, 9600);
    x[20] = f32::NAN;
    let mut s = with(&[(TARGET, 1.0)]);
    let mut out = Vec::new();
    for chunk in x.chunks(128) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        out.extend(l);
    }
    assert!(out.iter().all(|v| v.is_finite()));
    assert_eq!(Shape::program_count(), presets().len());
    for (i, (name, values)) in presets().iter().enumerate() {
        assert_eq!(Shape::program_name(i), *name);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
    }
}

#[test]
fn moving_the_depth_never_flips_a_side_or_jumps() {
    // Hard left (a triangle on the pan at the bar line, full depth), then the depth pulled down
    let x = vec![0.5f32; 4800];
    for to in [0.05, 0.0] {
        let mut s = with(&[(TARGET, 3.0), (SHAPE, 3.0), (RATE, 0.0), (DEPTH, 1.0), (SMOOTH, 1.0)]);
        let (_, r0) = run(&mut s, &x[..960], 128);
        assert!(r0[959].abs() < 0.01, "hard left to begin with");
        s.set(DEPTH, to);
        let (l, r) = run(&mut s, &x, 128);
        let lowest = r.iter().fold(f32::MAX, |m, v| m.min(*v));
        let jump = r.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
        assert!(lowest >= -1e-6, "depth to {to}: the right side went to {lowest}");
        assert!(jump < 0.01, "depth to {to}: the right side jumped by {jump} in one sample");
        assert!(l.iter().chain(&r).all(|v| *v <= 0.5 + 1e-6));
        if to == 0.0 {
            assert!((r[4799] - 0.5).abs() < 0.01, "at no depth it ends in the middle");
        }
    }
}

#[test]
fn a_filter_snapping_shut_does_not_ring_louder_than_the_sound() {
    let mut rng = fledge_dsp::math::Rng::new(5);
    let x: Vec<f32> = (0..BEAT * 4).map(|_| 0.5 * rng.bipolar()).collect();
    for rate in [44100.0, 48000.0] {
        for target in [1.0, 2.0] {
            let mut s = Shape::new(rate);
            s.set_tempo(128.0);
            s.set_position(0.0);
            for (i, v) in [(TARGET, target), (SHAPE, 4.0), (RATE, 7.0), (DEPTH, 1.0), (SMOOTH, 0.0)] {
                s.set(i, normal(i, v));
            }
            let (l, _) = run(&mut s, &x, 128);
            let peak = l.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            println!("{} at {rate} Hz, a 16th gate with no smoothing on noise peaking at 0.5: the output peaks at {peak:.2}", TARGETS[target as usize]);
            // (A filter can pass a peak a little over the sound's own; stepped shut, it rang to 1.2)
            assert!(peak < 0.9, "{}", TARGETS[target as usize]);
        }
    }
}
