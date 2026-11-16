use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Shifter {
    let mut s = Shifter::new(SR);
    for &(i, x) in sets {
        s.set(i, normal(i, x));
    }
    s
}

fn sine(hz: f32, amp: f32, n: usize, sr: f32) -> Vec<f32> {
    (0..n).map(|i| amp * (TAU * hz * i as f32 / sr).sin()).collect()
}

fn run(s: &mut Shifter, x: &[f32], size: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut left, mut right) = (Vec::with_capacity(x.len()), Vec::with_capacity(x.len()));
    for chunk in x.chunks(size) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        left.extend(l);
        right.extend(r);
    }
    (left, right)
}

/// How strong `hz` is in the second half of `x`, in dB against a full-level sine.
fn level(x: &[f32], hz: f32, sr: f32) -> f32 {
    let x = &x[x.len() / 2..];
    let (mut s, mut c) = (0.0f64, 0.0f64);
    for (i, v) in x.iter().enumerate() {
        // (A Hann window: a neighbour 100 Hz away doesn't leak in)
        let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / x.len() as f64).cos();
        let ph = std::f64::consts::TAU * hz as f64 * i as f64 / sr as f64;
        s += *v as f64 * w * ph.sin();
        c += *v as f64 * w * ph.cos();
    }
    (20.0 * (4.0 * (s * s + c * c).sqrt() / x.len() as f64).max(1e-12).log10()) as f32
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for hz in [-2000.0, -340.0, -0.4, 0.0, 1.0, 100.0, 2000.0] {
        assert!((value(SHIFT, normal(SHIFT, hz)) - hz).abs() < 0.01 + hz.abs() * 1e-4, "{hz} Hz");
    }
    for (i, x) in [(FEEDBACK, 0.5), (DELAY, 1.0), (DELAY, 180.0), (DELAY, 500.0), (MIX, 0.3), (SPREAD, 1.0)] {
        assert!((value(i, normal(i, x)) - x).abs() < x * 1e-4 + 1e-5, "parameter {i} at {x}");
    }
    let s = Shifter::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| s.param_display(i)).collect();
    assert_eq!(shown, ["+100 Hz", "0 %", "0 %", "20 ms", "100 %"]);
    assert_eq!(with(&[(SHIFT, -0.4)]).param_display(SHIFT), "-0.40 Hz");
    assert_eq!(with(&[(SHIFT, 35.0)]).param_display(SHIFT), "+35.0 Hz");
}

#[test]
fn every_frequency_moves_by_the_same_number_of_hertz() {
    // Up 100 Hz: 1 kHz comes out at 1.1 kHz, at the level it went in, and nothing is left at
    // 1 kHz or at 900 Hz (the other sideband)
    for (hz, shift) in [(1000.0, 100.0), (1000.0, -100.0), (220.0, 37.0), (5000.0, -1500.0), (12000.0, 2000.0), (150.0, 2000.0)] {
        let (out, _) = run(&mut with(&[(SHIFT, shift)]), &sine(hz, 0.5, 48000, SR), 128);
        let moved = level(&out, hz + shift, SR);
        assert!((moved + 6.02).abs() < 0.3, "{hz} Hz by {shift}: {moved} dB at {} Hz", hz + shift);
        assert!(level(&out, hz - shift, SR) < moved - 40.0, "{hz} Hz by {shift}: the other sideband is at {} dB", level(&out, hz - shift, SR));
        assert!(level(&out, hz, SR) < moved - 40.0, "{hz} Hz by {shift}: {} dB left where it was", level(&out, hz, SR));
    }
    // A note's overtones move by the same hertz, so they're no longer multiples of it: 200, 400,
    // 600 Hz up 50 become 250, 450, 650
    let note: Vec<f32> = (0..48000).map(|i| (1..=3).map(|h| 0.2 * (TAU * 200.0 * h as f32 * i as f32 / SR).sin()).sum()).collect();
    let (out, _) = run(&mut with(&[(SHIFT, 50.0)]), &note, 128);
    for hz in [250.0, 450.0, 650.0] {
        assert!((level(&out, hz, SR) + 13.98).abs() < 0.4, "{hz} Hz: {} dB", level(&out, hz, SR));
    }
    assert!(level(&out, 400.0, SR) < -55.0 && level(&out, 500.0, SR) < -55.0);
}

#[test]
fn it_works_down_to_the_low_notes() {
    // The quarter turn holds down to the lowest notes: a sub's other sideband is still well down
    for (hz, least) in [(100.0, 40.0), (60.0, 40.0), (40.0, 38.0)] {
        let (out, _) = run(&mut with(&[(SHIFT, 300.0)]), &sine(hz, 0.5, 96000, SR), 128);
        let apart = level(&out, hz + 300.0, SR) - level(&out, 300.0 - hz, SR);
        assert!(apart > least, "{hz} Hz: the sidebands are {apart} dB apart");
    }
}

#[test]
fn no_shift_is_the_sound_at_its_own_level() {
    // (Through the all-pass filters its waves are moved along, not changed in level)
    for hz in [80.0, 1000.0, 9000.0] {
        let (out, _) = run(&mut with(&[(SHIFT, 0.0)]), &sine(hz, 0.5, 48000, SR), 128);
        assert!((level(&out, hz, SR) + 6.02).abs() < 0.2, "{hz} Hz: {} dB", level(&out, hz, SR));
    }
    // At 0 % mix: the sound itself, exactly
    let x = sine(440.0, 0.5, 4800, SR);
    assert_eq!(run(&mut with(&[(MIX, 0.0)]), &x, 128).0, x);
}

#[test]
fn spread_shifts_the_right_side_the_other_way() {
    let x = sine(1000.0, 0.5, 48000, SR);
    let (l, r) = run(&mut with(&[(SHIFT, 100.0), (SPREAD, 1.0)]), &x, 128);
    assert!((level(&l, 1100.0, SR) + 6.02).abs() < 0.3 && (level(&r, 900.0, SR) + 6.02).abs() < 0.3);
    assert!(level(&r, 1100.0, SR) < -45.0 && level(&l, 900.0, SR) < -45.0);
    // Half way, the right side isn't shifted at all; at none, both sides are the same
    let (_, r) = run(&mut with(&[(SHIFT, 100.0), (SPREAD, 0.5)]), &x, 128);
    assert!((level(&r, 1000.0, SR) + 6.02).abs() < 0.3);
    let (l, r) = run(&mut with(&[(SHIFT, 100.0)]), &x, 128);
    assert_eq!(l, r);
}

#[test]
fn feedback_shifts_each_echo_again() {
    // A short burst of 1 kHz, up 100 Hz, fed back through 50 ms: echoes at 1.2, 1.3 kHz follow
    let mut x = sine(1000.0, 0.5, 48000, SR);
    x[1200..].iter_mut().for_each(|v| *v = 0.0);
    let (out, _) = run(&mut with(&[(SHIFT, 100.0), (FEEDBACK, 0.7), (DELAY, 50.0)]), &x, 128);
    let burst = |from: usize, hz: f32| level(&[&vec![0.0; 1200][..], &out[from..from + 1200]].concat(), hz, SR);
    // The burst itself comes out at 1.1 kHz; 50 ms on, at 1.2 kHz and 0.7 of the level (-3.1 dB)
    let (first, second, third) = (burst(0, 1100.0), burst(2400, 1200.0), burst(4800, 1300.0));
    assert!((second - first + 3.1).abs() < 0.5, "the second echo is {} dB under the first", first - second);
    assert!((third - second + 3.1).abs() < 0.5);
    assert!(burst(2400, 1100.0) < second - 25.0);
    // The most feedback at the smallest shift stays bounded and dies away
    let mut s = with(&[(SHIFT, 0.0), (FEEDBACK, 0.9), (DELAY, 1.0)]);
    let (loud, _) = run(&mut s, &sine(500.0, 1.0, 96000, SR), 128);
    assert!(loud.iter().all(|v| v.abs() < 12.0));
    let (after, _) = run(&mut s, &vec![0.0; 96000], 128);
    assert!(after[90000..].iter().all(|v| v.abs() < 1e-4));
}

#[test]
fn the_same_whatever_the_block_size_and_at_other_sample_rates() {
    let x: Vec<f32> = sine(330.0, 0.4, 9600, SR).iter().enumerate().map(|(i, v)| v * (1.0 - i as f32 / 9600.0)).collect();
    let render = |size: usize| run(&mut with(&[(SHIFT, 35.0), (SPREAD, 0.5), (FEEDBACK, 0.65), (DELAY, 30.0), (MIX, 0.45)]), &x, size);
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
    for sr in [32000.0, 44100.0, 96000.0] {
        let mut s = Shifter::new(sr);
        s.set(SHIFT, normal(SHIFT, 250.0));
        let (out, _) = run(&mut s, &sine(1000.0, 0.5, sr as usize, sr), 128);
        assert!((level(&out, 1250.0, sr) + 6.02).abs() < 0.3 && level(&out, 750.0, sr) < -46.0, "{sr} Hz");
    }
}

#[test]
fn presets_play_and_a_turned_knob_does_not_click() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut s = Shifter::new(SR);
        s.set_program(i);
        assert_eq!(&s.params, values);
        assert_eq!(Shifter::program_name(i), *name);
        let (out, _) = run(&mut s, &sine(440.0, 0.5, 24000, SR), 128);
        assert!(out[12000..].iter().any(|v| v.abs() > 0.05), "{name}");
    }
    // The mix thrown from 0 to 100 % mid-sound: no jump bigger than the sound's own steps
    let x = sine(200.0, 0.5, 9600, SR);
    let mut s = with(&[(MIX, 0.0), (SHIFT, 0.0)]);
    let (a, _) = run(&mut s, &x[..4800], 128);
    s.set(MIX, 1.0);
    let (b, _) = run(&mut s, &x[4800..], 128);
    let all = [a, b].concat();
    let step = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
    assert!(step < 0.03, "a step of {step}");
}
