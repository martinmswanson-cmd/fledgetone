use super::*;
use std::f32::consts::TAU;

/// Run `seconds` of a sine at `amp` through `c` (keyed by a sine at `key_amp`, if given) and
/// return the output's level over the last tenth of a second, as a gain on the input in dB.
fn run(c: &mut Compressor, sr: f32, hz: f32, amp: f32, key_amp: Option<f32>, seconds: f32) -> f32 {
    let total = (seconds * sr) as usize;
    let tail = (0.1 * sr) as usize;
    let (mut sum_in, mut sum_out) = (0.0f64, 0.0f64);
    let mut n = 0;
    while n < total {
        let frames = 128.min(total - n);
        let x: Vec<f32> = (0..frames).map(|i| amp * (TAU * hz * (n + i) as f32 / sr).sin()).collect();
        let k: Vec<f32> = (0..frames).map(|i| key_amp.unwrap_or(0.0) * (TAU * 60.0 * (n + i) as f32 / sr).sin()).collect();
        let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
        let mut block = Block { input: [&x, &x], sidechain: key_amp.map(|_| [&k[..], &k[..]]), output: [&mut l, &mut r] };
        c.process(&mut block);
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert_eq!(l, r, "one gain for both channels");
        for i in 0..frames {
            if n + i >= total - tail {
                sum_in += (x[i] as f64).powi(2);
                sum_out += (l[i] as f64).powi(2);
            }
        }
        n += frames;
    }
    (10.0 * (sum_out / sum_in).log10()) as f32
}

fn with(sets: &[(usize, f32)]) -> Compressor {
    let mut c = Compressor::new(48000.0);
    for &(i, x) in sets {
        c.set(i, normal(i, x));
    }
    c
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for i in 0..COUNT {
        for v in [0.0, 0.25, 0.5, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    let c = Compressor::new(48000.0);
    let shown: Vec<String> = (0..COUNT).map(|i| c.param_display(i)).collect();
    assert_eq!(shown, ["-18.0 dB", "4.0:1", "10 ms", "120 ms", "6.0 dB", "0.0 dB", "Off", "100 %", "Off"]);
    assert_eq!(with(&[(ATTACK, 0.5), (KEY_HIGH_PASS, 150.0)]).param_display(ATTACK), "0.5 ms");
    assert_eq!(with(&[(KEY_HIGH_PASS, 150.0)]).param_display(KEY_HIGH_PASS), "150 Hz");
}

#[test]
fn the_gain_computer_follows_its_curve() {
    // Under the knee nothing; well over it, the ratio; and no step where the knee meets either
    assert_eq!(reduction_db(-40.0, -18.0, 4.0, 6.0), 0.0);
    assert!((reduction_db(-6.0, -18.0, 4.0, 6.0) - (-9.0)).abs() < 1e-4);
    for edge in [-21.0f32, -15.0] {
        let (a, b) = (reduction_db(edge - 1e-3, -18.0, 4.0, 6.0), reduction_db(edge + 1e-3, -18.0, 4.0, 6.0));
        assert!((a - b).abs() < 1e-2, "at {edge}: {a} then {b}");
    }
    // A hard knee turns at the threshold, and a ratio of 1 does nothing
    assert_eq!(reduction_db(-18.0, -18.0, 4.0, 0.0), 0.0);
    assert_eq!(reduction_db(0.0, -18.0, 1.0, 6.0), 0.0);
}

#[test]
fn quiet_sound_passes_and_loud_sound_comes_down_by_the_ratio() {
    let sr = 48000.0;
    // -40 dBFS, far under the threshold: untouched
    let quiet = run(&mut with(&[]), sr, 1000.0, 0.01, None, 1.0);
    assert!(quiet.abs() < 0.01, "{quiet} dB");
    // A sine peaking at -6 dBFS, 12 dB over: 4:1 leaves 3 dB over, so about 9 dB comes off (a
    // little less: the gain follows the wave's peaks and lets go between them)
    let loud = run(&mut with(&[(RELEASE, 2000.0)]), sr, 1000.0, 0.5, None, 3.0);
    assert!(loud < -8.0 && loud > -9.1, "{loud} dB");
    // Make-up gain puts it back, and at 0 % mix nothing changes
    let made_up = run(&mut with(&[(RELEASE, 2000.0), (MAKEUP, 9.0)]), sr, 1000.0, 0.5, None, 3.0);
    assert!((made_up - loud - 9.0).abs() < 0.05, "{made_up} dB");
    let dry = run(&mut with(&[(MIX, 0.0)]), sr, 1000.0, 0.5, None, 1.0);
    assert!(dry.abs() < 0.01, "{dry} dB");
}

#[test]
fn a_sidechain_ducks_a_sound_that_would_pass_by_itself() {
    let sr = 48000.0;
    // A quiet pad with a loud kick on the sidechain: it ducks; with a silent sidechain it doesn't
    let ducked = run(&mut with(&[(RELEASE, 2000.0)]), sr, 1000.0, 0.01, Some(0.5), 3.0);
    assert!(ducked < -8.0, "{ducked} dB");
    let open = run(&mut with(&[]), sr, 1000.0, 0.5, Some(0.0), 1.0);
    assert!(open.abs() < 0.01, "a loud sound under a silent sidechain: {open} dB");
    // The key's high-pass takes the 60 Hz key out of what it listens to
    let filtered = run(&mut with(&[(RELEASE, 2000.0), (KEY_HIGH_PASS, 1000.0)]), sr, 1000.0, 0.01, Some(0.5), 3.0);
    assert!(filtered > -0.5, "{filtered} dB");
}

#[test]
fn it_comes_on_and_lets_go_in_the_times_set() {
    let mut c = with(&[(ATTACK, 10.0), (RELEASE, 100.0), (KNEE, 0.0)]);
    // A steady level 12 dB over the threshold (as a square wave, so the level doesn't move)
    let frames = 128;
    let step = |c: &mut Compressor, amp: f32, blocks: usize| {
        for _ in 0..blocks {
            let x = vec![amp; frames];
            let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
            c.process(&mut Block { input: [&x, &x], sidechain: None, output: [&mut l, &mut r] });
        }
        c.reduction()
    };
    // After one attack time (3.75 blocks of 128 at 48 kHz: 480 samples), about 63 % of the 9 dB
    let after_attack = step(&mut c, 0.5, 4);
    assert!(after_attack < -5.3 && after_attack > -6.5, "{after_attack} dB after 10 ms");
    let settled = step(&mut c, 0.5, 400);
    assert!((settled + 9.03).abs() < 0.05, "{settled} dB");
    // One release time on (4800 samples: 37.5 blocks), about 63 % of it has gone
    let after_release = step(&mut c, 0.0, 38);
    assert!(after_release > -3.6 && after_release < -3.0, "{after_release} dB after 100 ms");
}

#[test]
fn the_same_at_every_sample_rate() {
    let at = |sr: f32| {
        let mut c = Compressor::new(sr);
        c.set(KEY_HIGH_PASS, normal(KEY_HIGH_PASS, 200.0));
        run(&mut c, sr, 1000.0, 0.5, None, 0.35)
    };
    let base = at(48000.0);
    for sr in [32000.0, 44100.0, 96000.0] {
        assert!((at(sr) - base).abs() < 0.1, "{sr} Hz: {} dB, 48 kHz: {base} dB", at(sr));
    }
}

#[test]
fn the_same_input_gives_the_same_output_whatever_the_block_size() {
    let sr = 48000.0;
    let x: Vec<f32> = (0..4800).map(|i| 0.7 * (TAU * 220.0 * i as f32 / sr).sin() * (1.0 - i as f32 / 4800.0)).collect();
    let render = |size: usize| {
        let mut c = with(&[(KEY_HIGH_PASS, 120.0), (MAKEUP, 6.0)]);
        let mut out = Vec::new();
        for chunk in x.chunks(size) {
            let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
            c.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
            out.extend(l);
        }
        out
    };
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
}

#[test]
fn key_listen_plays_what_it_listens_to() {
    let mut c = with(&[]);
    c.set(KEY_LISTEN, 1.0);
    let (x, k) = (vec![0.5f32; 64], vec![0.25f32; 64]);
    let (mut l, mut r) = (vec![0.0; 64], vec![0.0; 64]);
    c.process(&mut Block { input: [&x, &x], sidechain: Some([&k, &k]), output: [&mut l, &mut r] });
    assert!(l.iter().chain(&r).all(|v| *v == 0.25));
}

#[test]
fn presets_are_named_and_in_range_and_silence_stays_silent() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut c = Compressor::new(48000.0);
        c.set_program(i);
        assert_eq!(&c.params, values);
        assert_eq!(Compressor::program_name(i), *name);
        let z = vec![0.0f32; 128];
        let (mut l, mut r) = (vec![1.0; 128], vec![1.0; 128]);
        c.process(&mut Block { input: [&z, &z], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| *v == 0.0));
    }
    // A switch of the whole sound goes straight to the new make-up gain (no ramp from the old)
    let mut c = with(&[(THRESHOLD, 0.0)]);
    let x = vec![0.1f32; 128];
    let (mut l, mut r) = (vec![0.0; 128], vec![0.0; 128]);
    c.process(&mut Block { input: [&x, &x], sidechain: None, output: [&mut l, &mut r] });
    c.set(MAKEUP, normal(MAKEUP, 12.0));
    c.settle();
    c.process(&mut Block { input: [&x, &x], sidechain: None, output: [&mut l, &mut r] });
    assert!((l[0] - 0.1 * 10f32.powf(12.0 / 20.0)).abs() < 1e-4, "{}", l[0]);
}
