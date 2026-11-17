use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Gate {
    let mut g = Gate::new(SR);
    for &(i, x) in sets {
        g.set(i, normal(i, x));
    }
    g
}

/// Run `ms` of a 1 kHz sine at `amp` through it (keyed by a 200 Hz sine at `key`, if given); the
/// output's level over the last 10 ms as a gain on the input, in dB (-200 for silence).
fn run(g: &mut Gate, amp: f32, key: Option<f32>, ms: f32) -> f32 {
    let total = (ms * 0.001 * SR) as usize;
    let tail = (0.010 * SR) as usize;
    let (mut e_in, mut e_out) = (0.0f64, 0.0f64);
    let mut n = 0;
    while n < total {
        let frames = 128.min(total - n);
        let x: Vec<f32> = (0..frames).map(|i| amp * (TAU * 1000.0 * (n + i) as f32 / SR).sin()).collect();
        let k: Vec<f32> = (0..frames).map(|i| key.unwrap_or(0.0) * (TAU * 200.0 * (n + i) as f32 / SR).sin()).collect();
        let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
        g.process(&mut Block { input: [&x, &x], sidechain: key.map(|_| [&k[..], &k[..]]), output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert_eq!(l, r, "one gain for both channels");
        for i in 0..frames {
            if n + i >= total.saturating_sub(tail) {
                e_in += (x[i] as f64).powi(2);
                e_out += (l[i] as f64).powi(2);
            }
        }
        n += frames;
    }
    if e_out <= 0.0 {
        -200.0
    } else {
        (10.0 * (e_out / e_in).log10()) as f32
    }
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.25, 0.5, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    let g = Gate::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| g.param_display(i)).collect();
    assert_eq!(shown, ["-40.0 dB", "Shut", "1.0 ms", "30 ms", "120 ms", "3.0 dB", "Off", "Off", "Off"]);
    assert_eq!(with(&[(RANGE, 20.0)]).param_display(RANGE), "20.0 dB");
}

#[test]
fn loud_sound_passes_and_quiet_sound_is_shut_out() {
    // -6 dBFS, over the -40 dB threshold: through untouched
    let mut g = with(&[]);
    assert!(run(&mut g, 0.5, None, 200.0).abs() < 0.01);
    assert!(g.is_open());
    // -60 dBFS, under it: shut (silence, at the full range)
    let mut g = with(&[]);
    assert!(run(&mut g, 0.001, None, 200.0) < -100.0);
    assert!(!g.is_open());
    // With a range of 20 dB it's turned down by that, not shut
    let quiet = run(&mut with(&[(RANGE, 20.0)]), 0.001, None, 500.0);
    assert!((quiet + 20.0).abs() < 0.1, "{quiet} dB");
}

#[test]
fn it_opens_fast_holds_and_then_shuts_in_the_time_set() {
    let mut g = with(&[(ATTACK, 1.0), (HOLD, 50.0), (RELEASE, 100.0)]);
    // Open within a few milliseconds of the sound starting
    let after = run(&mut g, 0.5, None, 20.0);
    assert!(after > -0.1, "{after} dB from 10 to 20 ms in");
    // The sound stops (well, drops under the threshold): through the hold it stays open...
    let held = run(&mut g, 0.0005, None, 40.0);
    assert!(held > -0.1 && g.is_open(), "{held} dB, 40 ms into the hold");
    // ...then shuts at the release time. (What it listens to takes about 22 ms to fall from
    // -6 dBFS to under the threshold, and the hold runs from there: so 155 ms after the sound
    // stopped it has been shutting for about 80 ms, and is about 55 % of the way down)
    let shutting = run(&mut g, 0.0005, None, 115.0);
    assert!(!g.is_open());
    assert!(shutting < -6.0 && shutting > -8.0, "{shutting} dB");
    assert!(run(&mut g, 0.0005, None, 2000.0) < -100.0);
}

#[test]
fn hysteresis_keeps_a_sound_near_the_threshold_from_chattering() {
    // A sound that opens it, then sits 2 dB under the threshold: with 3 dB of hysteresis it stays open
    let just_under = 10f32.powf(-42.0 / 20.0);
    let mut g = with(&[(HOLD, 0.0)]);
    run(&mut g, 0.5, None, 50.0);
    assert!(run(&mut g, just_under, None, 500.0) > -0.1);
    // With none it shuts
    let mut g = with(&[(HOLD, 0.0), (HYSTERESIS, 0.0)]);
    run(&mut g, 0.5, None, 50.0);
    assert!(run(&mut g, just_under, None, 1500.0) < -60.0);
    // And a sound that never reached the threshold doesn't open it, hysteresis or not
    assert!(run(&mut with(&[]), just_under, None, 500.0) < -100.0);
}

#[test]
fn a_low_note_does_not_open_and_shut_with_its_own_wave() {
    // 60 Hz at -20 dBFS, no hold: the follower rides over the wave's zero crossings
    let mut g = with(&[(HOLD, 0.0), (HYSTERESIS, 0.0), (THRESHOLD, -30.0)]);
    let (mut least, mut n) = (1.0f32, 0usize);
    for _ in 0..200 {
        let x: Vec<f32> = (0..128).map(|i| 0.1 * (TAU * 60.0 * (n + i) as f32 / SR).sin()).collect();
        let (mut l, mut r) = (vec![0.0; 128], vec![0.0; 128]);
        g.process(&mut Block { input: [&x, &x], sidechain: None, output: [&mut l, &mut r] });
        n += 128;
        if n > 4800 {
            least = least.min(g.gain());
        }
    }
    assert!(least > 0.98, "the gain fell to {least}");
}

#[test]
fn a_sidechain_chops_one_sound_to_another() {
    // A loud pad under a silent sidechain: shut. Under a loud one: through
    let mut g = with(&[(THRESHOLD, -30.0)]);
    assert!(run(&mut g, 0.5, Some(0.0), 300.0) < -100.0);
    assert!(run(&mut g, 0.5, Some(0.5), 100.0).abs() < 0.05);
    assert!(run(&mut g, 0.5, Some(0.0), 3000.0) < -100.0);
    // A quiet pad opens with the sidechain too: its own level doesn't matter
    assert!(run(&mut with(&[(THRESHOLD, -30.0)]), 0.001, Some(0.5), 100.0).abs() < 0.05);
    // The key's high-pass takes the 200 Hz key out of what it listens to
    assert!(run(&mut with(&[(THRESHOLD, -30.0), (KEY_HIGH_PASS, 1000.0)]), 0.5, Some(0.05), 300.0) < -100.0);
}

#[test]
fn flipped_it_shuts_under_the_other_track() {
    let mut g = with(&[(THRESHOLD, -30.0), (FLIP, 1.0), (ATTACK, 5.0), (RELEASE, 20.0), (HOLD, 0.0)]);
    assert!(run(&mut g, 0.5, Some(0.0), 300.0).abs() < 0.05, "open while the other is silent");
    assert!(g.is_open());
    assert!(run(&mut g, 0.5, Some(0.5), 500.0) < -100.0, "shut while it sounds");
    assert!(!g.is_open());
    assert!(run(&mut g, 0.5, Some(0.0), 300.0).abs() < 0.05);
}

#[test]
fn the_same_at_every_sample_rate_and_whatever_the_block_size() {
    // How far it has shut 60 ms after a sound ends, at each rate
    let at = |sr: f32| {
        let mut g = Gate::new(sr);
        g.set(HOLD, normal(HOLD, 10.0));
        let mut gains = Vec::new();
        for (amp, ms) in [(0.5f32, 50.0f32), (0.0, 60.0)] {
            let total = (ms * 0.001 * sr) as usize;
            let x: Vec<f32> = (0..total).map(|i| amp * (TAU * 1000.0 * i as f32 / sr).sin()).collect();
            for chunk in x.chunks(128) {
                let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
                g.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
            }
            gains.push(g.gain());
        }
        gains
    };
    let base = at(48000.0);
    for sr in [32000.0, 44100.0, 96000.0] {
        for (a, b) in at(sr).iter().zip(&base) {
            assert!((a - b).abs() < 0.02, "{sr} Hz: {a} against {b}");
        }
    }
    let x: Vec<f32> = (0..9600).map(|i| if (i / 1200) % 2 == 0 { 0.4 * (TAU * 300.0 * i as f32 / SR).sin() } else { 0.0 }).collect();
    let render = |size: usize| {
        let mut g = with(&[(KEY_HIGH_PASS, 100.0)]);
        let mut out = Vec::new();
        for chunk in x.chunks(size) {
            let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
            g.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
            out.extend(l);
        }
        out
    };
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
}

#[test]
fn key_listen_presets_and_broken_samples() {
    let mut g = with(&[]);
    g.set(KEY_LISTEN, 1.0);
    let (x, k) = (vec![0.5f32; 64], vec![0.25f32; 64]);
    let (mut l, mut r) = (vec![0.0; 64], vec![0.0; 64]);
    g.process(&mut Block { input: [&x, &x], sidechain: Some([&k, &k]), output: [&mut l, &mut r] });
    assert!(l.iter().chain(&r).all(|v| *v == 0.25));
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut g = Gate::new(SR);
        g.set_program(i);
        assert_eq!(&g.params, values);
        assert_eq!(Gate::program_name(i), *name);
    }
    // A sample that isn't a number on the sidechain doesn't stick: the gate shuts again after it
    let mut g = with(&[(HOLD, 0.0), (RELEASE, 5.0)]);
    let bad = vec![f32::NAN; 64];
    g.process(&mut Block { input: [&x, &x], sidechain: Some([&bad, &bad]), output: [&mut l, &mut r] });
    assert!(run(&mut g, 0.5, Some(0.0), 500.0) < -100.0);
    // A switch of the whole sound goes straight to the new gain
    let mut g = with(&[]);
    run(&mut g, 0.5, None, 100.0);
    g.set(FLIP, 1.0);
    g.settle();
    assert_eq!(g.gain(), 0.0);
}
