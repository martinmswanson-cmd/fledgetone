use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;
const FRAME: usize = 2048;

fn with(sets: &[(usize, f32)]) -> Spectral {
    let mut s = Spectral::new(SR);
    for &(i, x) in sets {
        s.set(i, normal(i, x));
    }
    s
}

fn sine(hz: f32, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

fn noise(seed: u32, amp: f32, n: usize) -> Vec<f32> {
    let mut x = seed;
    (0..n).map(|_| { x = x.wrapping_mul(1664525).wrapping_add(1013904223); amp * ((x >> 8) as f32 / (1u32 << 23) as f32 - 1.0) }).collect()
}

fn run(s: &mut Spectral, x: &[f32], size: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for chunk in x.chunks(size) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        out.extend(l);
    }
    out
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt() as f32
}
fn db(a: f32, b: f32) -> f32 {
    20.0 * (a.max(1e-12) / b.max(1e-12)).log10()
}

/// How strong `hz` is in `x`, in dB against a full-level sine (a Hann window: neighbours don't leak in).
fn level(x: &[f32], hz: f32) -> f32 {
    let (mut s, mut c) = (0.0f64, 0.0f64);
    for (i, v) in x.iter().enumerate() {
        let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / x.len() as f64).cos();
        let ph = std::f64::consts::TAU * hz as f64 * i as f64 / SR as f64;
        s += *v as f64 * w * ph.sin();
        c += *v as f64 * w * ph.cos();
    }
    (20.0 * (4.0 * (s * s + c * c).sqrt() / x.len() as f64).max(1e-12).log10()) as f32
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for x in [-90.0, -60.0, -34.0, 0.0] {
        assert!((value(GATE, normal(GATE, x)) - x).abs() < 1e-3);
    }
    let s = Spectral::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| s.param_display(i)).collect();
    assert_eq!(shown, ["Off", "Off", "0 %", "0 %", "100 %"]);
    assert_eq!(with(&[(GATE, -60.0), (FREEZE, 1.0)]).param_display(GATE), "-60 dB");
    assert_eq!(Spectral::new(96000.0).delay(), 4096);
    assert_eq!(s.delay(), FRAME);
}

#[test]
fn with_nothing_set_the_sound_comes_out_as_it_went_in_one_frame_late() {
    // Taken apart and put back together: the same sound, 2048 samples on
    let x: Vec<f32> = noise(3, 0.3, 24000).iter().zip(sine(220.0, 0.3, 24000)).map(|(a, b)| a + b).collect();
    let out = run(&mut Spectral::new(SR), &x, 128);
    let worst = (2 * FRAME..24000).map(|i| (out[i] - x[i - FRAME]).abs()).fold(0.0, f32::max);
    assert!(worst < 2e-4, "off by {worst}");
    // At 0 % mix: the sound itself, exactly, the same frame late
    let dry = run(&mut with(&[(MIX, 0.0), (BLUR, 1.0)]), &x, 128);
    assert_eq!(dry[FRAME..], x[..24000 - FRAME]);
    // Half and half of the two is still the sound (they're in step)
    let half = run(&mut with(&[(MIX, 0.5)]), &x, 128);
    assert!((2 * FRAME..24000).all(|i| (half[i] - x[i - FRAME]).abs() < 2e-4));
}

#[test]
fn frozen_it_holds_the_sound_of_that_moment() {
    // A chord sounds for a second; Freeze goes on and the chord stops: it goes on, as loud
    let notes = [523.25f32, 659.25, 783.99];
    let chord: Vec<f32> = (0..48000).map(|i| notes.iter().map(|hz| 0.15 * (TAU * hz * i as f32 / SR).sin()).sum()).collect();
    let mut s = Spectral::new(SR);
    let before = run(&mut s, &chord, 128);
    s.set(FREEZE, 1.0);
    let held = run(&mut s, &vec![0.0; 144000], 128);
    let was = rms(&before[24000..]);
    for from in [24000, 72000, 120000] {
        let now = &held[from..from + 24000];
        assert!(db(rms(now), was).abs() < 1.0, "{} s in: {} dB against the chord", from / 48000, db(rms(now), was));
        // The same three notes, each where it was
        for hz in notes {
            assert!((level(now, hz) + 16.5).abs() < 1.5, "{hz} Hz is at {} dB", level(now, hz));
        }
        assert!(level(now, 600.0) < -50.0);
    }
    // Let go, it stops within a frame or two
    s.set(FREEZE, 0.0);
    let after = run(&mut s, &vec![0.0; 24000], 128);
    assert!(rms(&after[3 * FRAME..]) < 1e-5);
    // A single note holds exactly, and so does a low, close chord (each note's skirt of
    // frequencies turns with its own peak, where its neighbour's overlaps it)
    for (hz, least) in [(261.63f32, -0.2), (1000.0, -0.1)] {
        let mut s = Spectral::new(SR);
        let before = run(&mut s, &sine(hz, 0.3, 48000), 128);
        s.set(FREEZE, 1.0);
        let held = run(&mut s, &vec![0.0; 48000], 128);
        assert!(db(rms(&held[24000..]), rms(&before[24000..])) > least);
    }
    let low: Vec<f32> = (0..48000).map(|i| [261.63f32, 329.63, 392.0].iter().map(|hz| 0.15 * (TAU * hz * i as f32 / SR).sin()).sum()).collect();
    let mut s = Spectral::new(SR);
    let before = run(&mut s, &low, 128);
    s.set(FREEZE, 1.0);
    let held = run(&mut s, &vec![0.0; 48000], 128);
    let off = db(rms(&held[24000..]), rms(&before[24000..]));
    assert!(off.abs() < 0.5, "a low close chord: {off} dB");
}

#[test]
fn frozen_it_takes_no_notice_of_what_comes_in() {
    let mut s = Spectral::new(SR);
    run(&mut s, &sine(440.0, 0.4, 24000), 128);
    s.set(FREEZE, 1.0);
    run(&mut s, &sine(440.0, 0.4, 4096), 128);
    let held = run(&mut s, &noise(5, 0.5, 48000), 128);
    assert!((level(&held[24000..], 440.0) + 7.96).abs() < 1.0);
    assert!(level(&held[24000..], 3000.0) < -60.0);
}

#[test]
fn the_gate_takes_out_what_is_quiet_and_keeps_what_is_loud() {
    // A note at -20 dB over hiss at about -60 dB: with the gate at -45 the hiss goes, the note stays
    let x: Vec<f32> = sine(1000.0, 0.1, 96000).iter().zip(noise(7, 0.003, 96000)).map(|(a, b)| a + b).collect();
    let plain = run(&mut Spectral::new(SR), &x, 128);
    let gated = run(&mut with(&[(GATE, -45.0)]), &x, 128);
    assert!((level(&gated[48000..], 1000.0) - level(&plain[48000..], 1000.0)).abs() < 0.3);
    // Away from the note the hiss is gone (as loud as it was at 3, 5 and 8 kHz, against after)
    for hz in [3000.0, 5000.0, 8000.0] {
        assert!(level(&gated[48000..], hz) < level(&plain[48000..], hz) - 40.0, "{hz} Hz: {} dB, was {}", level(&gated[48000..], hz), level(&plain[48000..], hz));
    }
    // What's left once the note is taken away (the hiss right beside it, and the little of the
    // note's own skirt the gate cut) is well under the hiss there was
    let left = |out: &[f32]| rms(&(48000..96000).map(|i| out[i] - 0.1 * (TAU * 1000.0 * (i - FRAME) as f32 / SR).sin()).collect::<Vec<f32>>());
    assert!(db(left(&gated), left(&plain)) < -10.0, "what's left is down {} dB", -db(left(&gated), left(&plain)));
    // A note under the threshold goes too; switched off, nothing does
    let quiet = run(&mut with(&[(GATE, -10.0)]), &x, 128);
    assert!(rms(&quiet[48000..]) < 1e-4);
    assert!(db(rms(&plain[48000..]), rms(&x[48000..])).abs() < 0.05);
}

#[test]
fn blur_lingers_after_the_sound_stops() {
    let mut x = sine(500.0, 0.3, 96000);
    x[24000..].iter_mut().for_each(|v| *v = 0.0);
    // Half a second after the sound stops (and the frame it's late by)
    let later = |blur: f32| rms(&run(&mut with(&[(BLUR, blur)]), &x, 128)[24000 + FRAME + 24000..24000 + FRAME + 28800]);
    assert!(later(0.0) < 1e-5);
    let (some, most) = (later(0.5), later(1.0));
    let full = 0.3 / 2f32.sqrt();
    // At half, it falls about 9 dB in 0.75 s: 6 dB or so down half a second on. At full, 9 dB in
    // 3 s: still within 2.5 dB
    assert!(db(some, full) < -4.0 && db(some, full) > -9.0, "{} dB at half", db(some, full));
    assert!(db(most, full) > -2.5, "{} dB at full", db(most, full));
    // ...and what lingers is the note itself, not a noise in its place
    let out = run(&mut with(&[(BLUR, 1.0)]), &x, 128);
    let tail = &out[24000 + FRAME + 24000..24000 + FRAME + 48000];
    assert!(level(tail, 500.0) > -14.0 && level(tail, 700.0) < -60.0, "{} dB at 500 Hz, {} at 700", level(tail, 500.0), level(tail, 700.0));
    // While the sound plays it's as loud as it was
    let during = run(&mut with(&[(BLUR, 1.0)]), &x, 128);
    assert!(db(rms(&during[12000..24000]), rms(&x[12000..24000])).abs() < 0.5);
}

#[test]
fn smear_spreads_a_pitch_over_its_neighbours() {
    let x = sine(2000.0, 0.3, 48000);
    let plain = run(&mut Spectral::new(SR), &x, 128);
    let smeared = run(&mut with(&[(SMEAR, 1.0)]), &x, 128);
    // Nothing 300 Hz from the pitch without it; plenty with
    assert!(level(&plain[24000..], 2300.0) < -80.0);
    assert!(level(&smeared[24000..], 2300.0) > -60.0, "{} dB at 2.3 kHz", level(&smeared[24000..], 2300.0));
    assert!(level(&smeared[24000..], 2000.0) < level(&plain[24000..], 2000.0) - 6.0, "the pitch itself is less plain");
    // ...but not far away, and the sound is about as loud as it was
    assert!(level(&smeared[24000..], 4000.0) < -80.0);
    assert!(db(rms(&smeared[24000..]), rms(&plain[24000..])).abs() < 1.5, "{} dB", db(rms(&smeared[24000..]), rms(&plain[24000..])));
    let half = run(&mut with(&[(SMEAR, 0.5)]), &x, 128);
    assert!(db(rms(&half[24000..]), rms(&plain[24000..])).abs() < 2.5, "at half: {} dB", db(rms(&half[24000..]), rms(&plain[24000..])));
}

#[test]
fn the_same_whatever_the_block_size_and_at_other_sample_rates() {
    let x: Vec<f32> = noise(11, 0.2, 9600).iter().zip(sine(330.0, 0.3, 9600)).map(|(a, b)| a + b).collect();
    let render = |size: usize| {
        let mut s = with(&[(GATE, -50.0), (BLUR, 0.6), (SMEAR, 0.3), (MIX, 0.8)]);
        let mut out = run(&mut s, &x[..4800], size);
        s.set(FREEZE, 1.0);
        out.extend(run(&mut s, &x[4800..], size));
        out
    };
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
    for sr in [32000.0, 44100.0, 96000.0] {
        let mut s = Spectral::new(sr);
        let n = sr as usize;
        let x: Vec<f32> = (0..n).map(|i| 0.3 * (TAU * 440.0 * i as f32 / sr).sin()).collect();
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        for (k, chunk) in x.chunks(128).enumerate() {
            s.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l[k * 128..k * 128 + chunk.len()], &mut r[k * 128..k * 128 + chunk.len()]] });
        }
        let d = s.delay();
        let worst = (2 * d..n).map(|i| (l[i] - x[i - d]).abs()).fold(0.0, f32::max);
        assert!(worst < 2e-4, "{sr} Hz: off by {worst}");
    }
}

#[test]
fn presets_play_and_broken_samples_do_not_stay() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut s = Spectral::new(SR);
        s.set_program(i);
        assert_eq!(&s.params, values);
        assert_eq!(Spectral::program_name(i), *name);
        let out = run(&mut s, &sine(440.0, 0.3, 24000), 128);
        assert!(rms(&out[12000..]) > 0.05, "{name}");
    }
    let mut s = with(&[(BLUR, 1.0)]);
    let bad = vec![f32::NAN; 256];
    let (mut l, mut r) = (vec![0.0; 256], vec![0.0; 256]);
    s.process(&mut Block { input: [&bad, &bad], sidechain: None, output: [&mut l, &mut r] });
    let out = run(&mut s, &sine(440.0, 0.3, 24000), 128);
    assert!(out.iter().all(|v| v.is_finite()) && rms(&out[12000..]) > 0.05);
}



