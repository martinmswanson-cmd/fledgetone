use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> DynamicEq {
    let mut e = DynamicEq::new(SR);
    for &(i, x) in sets {
        e.set(i, normal(i, x));
    }
    e
}

fn tone(hz: f32, amp: f32, seconds: f32) -> Vec<f32> {
    (0..(seconds * SR) as usize).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

/// Through it: `l` and `r` in, both sides out.
fn run(e: &mut DynamicEq, l: &[f32], r: &[f32], block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ol, mut or) = (Vec::new(), Vec::new());
    for (a, b) in l.chunks(block).zip(r.chunks(block)) {
        let (mut yl, mut yr) = (vec![0.0; a.len()], vec![0.0; a.len()]);
        e.process(&mut Block { input: [a, b], sidechain: None, output: [&mut yl, &mut yr] });
        assert!(yl.iter().chain(&yr).all(|v| v.is_finite()));
        ol.extend(yl);
        or.extend(yr);
    }
    (ol, or)
}
fn mono(e: &mut DynamicEq, x: &[f32]) -> Vec<f32> {
    run(e, x, x, 128).0
}

fn rms_db(x: &[f32]) -> f32 {
    let half = &x[x.len() / 2..];
    (10.0 * (half.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / half.len() as f64).max(1e-18).log10()) as f32
}
/// How many dB `y` is over `x`.
fn over(y: &[f32], x: &[f32]) -> f32 {
    rms_db(y) - rms_db(x)
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.5, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    let e = DynamicEq::new(SR);
    assert_eq!(DynamicEq::param_name(at(2, MOVES)), "Band 3 moves by");
    assert_eq!(e.param_display(at(0, FREQ)), "100 Hz");
    assert_eq!(e.param_display(at(2, FREQ)), "2.50 kHz");
    assert_eq!(e.param_display(at(0, GAIN)), "+0.0 dB");
    assert_eq!(e.param_display(at(0, MOVES)), "Off");
    assert_eq!(e.param_display(at(0, CHANNEL)), "Stereo");
    assert_eq!(with(&[(at(1, CHANNEL), 2.0)]).param_display(at(1, CHANNEL)), "Side");
}

#[test]
fn flat_it_passes_the_sound() {
    let l = tone(440.0, 0.5, 0.5);
    let r = tone(660.0, 0.3, 0.5);
    let (yl, yr) = run(&mut DynamicEq::new(SR), &l, &r, 128);
    for i in 0..l.len() {
        assert!((yl[i] - l[i]).abs() < 1e-6 && (yr[i] - r[i]).abs() < 1e-6);
    }
}

#[test]
fn a_band_turns_its_frequency_and_leaves_the_rest() {
    let sets = [(at(1, FREQ), 1000.0), (at(1, GAIN), 6.0), (at(1, Q), 2.0)];
    let x = tone(1000.0, 0.2, 1.0);
    assert!((over(&mono(&mut with(&sets), &x), &x) - 6.0).abs() < 0.1);
    let far = tone(100.0, 0.2, 1.0);
    assert!(over(&mono(&mut with(&sets), &far), &far).abs() < 0.2);
    let x2 = tone(1000.0, 0.2, 1.0);
    let cut = [(at(1, FREQ), 1000.0), (at(1, GAIN), -12.0), (at(1, Q), 2.0), (OUTPUT, 6.0)];
    assert!((over(&mono(&mut with(&cut), &x2), &x2) + 6.0).abs() < 0.1, "and the output is a plain gain");
}

#[test]
fn a_moving_band_turns_only_while_its_range_is_loud() {
    let sets = [(at(3, FREQ), 6500.0), (at(3, Q), 2.0), (at(3, MOVES), -10.0), (at(3, THRESHOLD), -30.0)];
    let quiet = tone(6500.0, 0.003, 1.0);
    let loud = tone(6500.0, 0.5, 1.0);
    let (q, l) = (over(&mono(&mut with(&sets), &quiet), &quiet), over(&mono(&mut with(&sets), &loud), &loud));
    println!("a band that moves by -10 dB over -30 dB: a sound at -50 dB changes {q:+.2} dB, one at -6 dB {l:+.2} dB");
    assert!(q.abs() < 0.2, "under the threshold: {q} dB");
    assert!((l + 10.0).abs() < 0.5, "well over it: {l} dB");
    // Loud somewhere else doesn't set it off
    let elsewhere: Vec<f32> = tone(200.0, 0.5, 1.0).iter().zip(&quiet).map(|(a, b)| a + b).collect();
    let mut e = with(&sets);
    mono(&mut e, &elsewhere);
    assert!(e.moved(3).abs() < 0.5, "a loud bass note doesn't move a band at 6.5 kHz: {}", e.moved(3));
    // And it can open instead
    let up = [(at(3, FREQ), 6500.0), (at(3, Q), 2.0), (at(3, MOVES), 6.0), (at(3, THRESHOLD), -30.0)];
    assert!((over(&mono(&mut with(&up), &loud), &loud) - 6.0).abs() < 0.5);
}

#[test]
fn it_eases_back_when_the_sound_falls() {
    let sets = [(at(3, FREQ), 6500.0), (at(3, MOVES), -10.0), (at(3, THRESHOLD), -30.0)];
    let mut e = with(&sets);
    mono(&mut e, &tone(6500.0, 0.5, 0.5));
    assert!(e.moved(3) < -8.0);
    mono(&mut e, &vec![0.0; 48000]);
    assert!(e.moved(3).abs() < 0.1, "a second of silence later: {}", e.moved(3));
}

#[test]
fn a_band_can_work_on_the_middle_or_the_sides_alone() {
    let x = tone(1000.0, 0.3, 1.0);
    let flipped: Vec<f32> = x.iter().map(|v| -v).collect();
    for (channel, on_middle, on_sides) in [(0.0, 6.0, 6.0), (1.0, 6.0, 0.0), (2.0, 0.0, 6.0)] {
        let sets = [(at(1, FREQ), 1000.0), (at(1, GAIN), 6.0), (at(1, CHANNEL), channel)];
        // The same on both sides is all middle; opposite on the two sides is all side
        let (ml, mr) = run(&mut with(&sets), &x, &x, 128);
        let (sl, sr) = run(&mut with(&sets), &x, &flipped, 128);
        assert!((over(&ml, &x) - on_middle).abs() < 0.1 && (over(&mr, &x) - on_middle).abs() < 0.1, "{}: the middle", CHANNELS[channel as usize]);
        assert!((over(&sl, &x) - on_sides).abs() < 0.1 && (over(&sr, &x) - on_sides).abs() < 0.1, "{}: the sides", CHANNELS[channel as usize]);
    }
}

#[test]
fn the_same_whatever_the_block_size() {
    let x = tone(6500.0, 0.4, 0.4);
    let sets = [(at(3, FREQ), 6500.0), (at(3, MOVES), -10.0), (at(0, GAIN), 4.0), (at(1, CHANNEL), 2.0), (at(1, GAIN), -6.0)];
    assert_eq!(run(&mut with(&sets), &x, &x, 128), run(&mut with(&sets), &x, &x, 37));
}

#[test]
fn broken_samples_do_not_stick() {
    let mut x = tone(1000.0, 0.4, 0.3);
    x[30] = f32::NAN;
    x[31] = f32::NEG_INFINITY;
    let mut e = with(&[(at(1, FREQ), 1000.0), (at(1, GAIN), 6.0), (at(1, MOVES), -6.0)]);
    let mut out = Vec::new();
    for chunk in x.chunks(128) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        e.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        out.extend(l);
    }
    assert!(out.iter().all(|v| v.is_finite()));
}

#[test]
fn every_preset_is_within_range_and_named() {
    assert_eq!(DynamicEq::program_count(), presets().len());
    for (i, (name, values)) in presets().iter().enumerate() {
        assert_eq!(DynamicEq::program_name(i), *name);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
    }
    // "Bass in the middle" takes the lows off the sides and leaves the middle's
    let mut e = DynamicEq::new(SR);
    e.set_program(4);
    let x = tone(60.0, 0.3, 1.0);
    let flipped: Vec<f32> = x.iter().map(|v| -v).collect();
    assert!(over(&run(&mut e, &x, &flipped, 128).0, &x) < -10.0);
    let mut e = DynamicEq::new(SR);
    e.set_program(4);
    assert!(over(&run(&mut e, &x, &x, 128).0, &x).abs() < 0.1);
}
