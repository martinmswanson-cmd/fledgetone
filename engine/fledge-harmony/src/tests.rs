use super::*;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Harmony {
    let mut h = Harmony::new(SR);
    for &(i, x) in sets {
        h.set(i, normal(i, x));
    }
    h
}

/// How loud a voice-like sound's harmonic at `hz` is: falling away with pitch, with two
/// resonances (a sung "ah": about 700 and 1200 Hz) that belong to the voice, not the note.
fn vowel(hz: f32) -> f32 {
    let bump = |at: f32, wide: f32| (-(hz - at).powi(2) / (2.0 * wide * wide)).exp();
    (200.0 / hz.max(200.0)) * (0.15 + 2.0 * bump(700.0, 90.0) + 1.2 * bump(1200.0, 110.0))
}

/// A sung note: every harmonic of `hz` under 5 kHz, shaped by the vowel.
fn sung(hz: f32, n: usize, sr: f32) -> Vec<f32> {
    let count = (5000.0 / hz) as usize;
    (0..n).map(|i| (1..=count).map(|h| 0.1 * vowel(hz * h as f32) * (TAU * hz * h as f32 * i as f32 / sr + 0.7 * h as f32).sin()).sum()).collect()
}

fn run(h: &mut Harmony, x: &[f32], size: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut left, mut right) = (Vec::with_capacity(x.len()), Vec::with_capacity(x.len()));
    for chunk in x.chunks(size) {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        h.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        left.extend(l);
        right.extend(r);
    }
    (left, right)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt() as f32
}

/// How strong `hz` is in `x` (a sine and a cosine at it, over the whole stretch).
fn at_hz(x: &[f32], hz: f32, sr: f32) -> f32 {
    let (mut s, mut c) = (0.0f64, 0.0f64);
    for (i, v) in x.iter().enumerate() {
        let ph = (std::f64::consts::TAU * hz as f64 * i as f64) / sr as f64;
        s += *v as f64 * ph.sin();
        c += *v as f64 * ph.cos();
    }
    (2.0 * (s * s + c * c).sqrt() / x.len() as f64) as f32
}

/// The pitch of `x`: the lag at which it's most like itself, between 40 and 1200 Hz.
fn pitch(x: &[f32], sr: f32) -> f32 {
    let (lo, hi) = ((sr / 1200.0) as usize, (sr / 40.0) as usize);
    let n = x.len() - hi - 1;
    let alike = |lag: usize| {
        let (mut both, mut each) = (0.0f64, 0.0f64);
        for i in 0..n {
            both += x[i] as f64 * x[i + lag] as f64;
            each += (x[i] as f64).powi(2) + (x[i + lag] as f64).powi(2);
        }
        2.0 * both / each.max(1e-30)
    };
    let all: Vec<f64> = (0..=hi + 1).map(alike).collect();
    let top = (lo..=hi).filter(|&l| all[l] >= all[l - 1] && all[l] >= all[l + 1]).map(|l| all[l]).fold(0.0, f64::max);
    let lag = (lo..=hi).find(|&l| all[l] >= top * 0.95 && all[l] >= all[l - 1] && all[l] >= all[l + 1]).unwrap();
    let (a, b, c) = (all[lag - 1], all[lag], all[lag + 1]);
    sr / (lag as f32 + (0.5 * (a - c) / (a - 2.0 * b + c)) as f32)
}

/// The voices alone (no dry), one voice at `steps` in `scale`, over a line sung at `hz`: the
/// second half of a second of it.
fn harmony_of(hz: f32, sets: &[(usize, f32)]) -> Vec<f32> {
    let mut all = vec![(DRY, 0.0), (LEVEL_1, 1.0), (LEVEL_2, 0.0), (DETUNE, 0.0), (SPREAD, 0.0)];
    all.extend_from_slice(sets);
    let (l, _) = run(&mut with(&all), &sung(hz, 48000, SR), 128);
    l[24000..].to_vec()
}

fn cents(a: f32, b: f32) -> f32 {
    1200.0 * (a / b).log2()
}

/// Whether `x` is a voice at `want` Hz: it repeats at that pitch. A voice whose even harmonics are
/// much the loudest reads as repeating at twice its pitch; that counts if its first harmonic is
/// really there (against the second, a tenth or more of what the vowel makes it).
fn is_at(x: &[f32], want: f32, sr: f32) -> bool {
    let got = pitch(x, sr);
    let short = &x[..x.len().min((sr * 0.1) as usize)];
    let (first, second) = (at_hz(short, want, sr), at_hz(short, 2.0 * want, sr));
    let balance = (first / second.max(1e-9)) / (vowel(want) / vowel(2.0 * want));
    cents(got, want).abs() < 12.0 || (cents(got, 2.0 * want).abs() < 12.0 && balance > 0.1)
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for k in 0..12 {
        assert_eq!(value(KEY, normal(KEY, k as f32)), k as f32);
    }
    for s in 0..3 {
        assert_eq!(value(SCALE, normal(SCALE, s as f32)), s as f32);
    }
    for st in [-12.0, -3.0, 0.0, 2.0, 7.0, 12.0] {
        for i in [VOICE_1, VOICE_2, FORMANT] {
            assert_eq!(value(i, normal(i, st)), st);
        }
    }
    let h = Harmony::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| h.param_display(i)).collect();
    assert_eq!(shown, ["C", "Major", "+2 steps", "70 %", "+4 steps", "0 %", "100 %", "0 st", "50 %", "6 cents"]);
    let c = with(&[(SCALE, 2.0), (VOICE_1, -1.0), (VOICE_2, 0.0), (KEY, 10.0), (FORMANT, -3.0)]);
    assert_eq!([c.param_display(KEY), c.param_display(VOICE_1), c.param_display(VOICE_2), c.param_display(FORMANT)], ["B\u{266d}", "-1 st", "Unison", "-3 st"]);
    assert_eq!(with(&[(VOICE_1, 1.0)]).param_display(VOICE_1), "+1 step");
}

#[test]
fn intervals_follow_the_scale() {
    // C major: a third above C is E (4 semitones), above D is F (3), above E is G (3), above B is D (3)
    for (note, up) in [(60, 4), (62, 3), (64, 3), (65, 4), (67, 4), (69, 3), (71, 3)] {
        assert_eq!(interval_semitones(note, 2, 0, 0), up, "a third above {note}");
    }
    // Down a third from C is A; an octave is seven steps; unison is nothing
    assert_eq!(interval_semitones(60, -2, 0, 0), -3);
    assert_eq!(interval_semitones(64, 7, 0, 0), 12);
    assert_eq!(interval_semitones(64, -7, 0, 0), -12);
    assert_eq!(interval_semitones(67, 0, 0, 0), 0);
    // A minor (key 9): a third above A is C (3 semitones), above C is E (4)
    assert_eq!(interval_semitones(57, 2, 9, 1), 3);
    assert_eq!(interval_semitones(60, 2, 9, 1), 4);
    // Chromatic: steps are semitones
    assert_eq!(interval_semitones(61, 7, 0, 2), 7);
    assert_eq!(interval_semitones(61, -12, 0, 2), -12);
    // The scale's note nearest a pitch: C sharp in C major is C or D, whichever is nearer
    assert_eq!(nearest_in_scale(60.9, 0, 0), 60);
    assert_eq!(nearest_in_scale(61.2, 0, 0), 62);
    assert_eq!(nearest_in_scale(61.2, 0, 2), 61);
    assert_eq!(nearest_in_scale(63.6, 2, 0), 64);
}

#[test]
fn with_the_voices_down_the_line_passes_as_it_is() {
    let x = sung(220.0, 9600, SR);
    let (l, r) = run(&mut with(&[(LEVEL_1, 0.0), (LEVEL_2, 0.0)]), &x, 128);
    assert_eq!(l, x);
    assert_eq!(r, x);
    // Dry at half: half of it
    let (l, _) = run(&mut with(&[(LEVEL_1, 0.0), (DRY, 0.5)]), &x, 128);
    assert!(l.iter().zip(&x).all(|(a, b)| (a - b * 0.5).abs() < 1e-7));
}

#[test]
fn a_voice_comes_out_at_the_interval_asked_for() {
    for hz in [110.0, 220.0, 330.0] {
        for st in [-12.0, -5.0, 0.0, 4.0, 7.0, 12.0] {
            let out = harmony_of(hz, &[(SCALE, 2.0), (VOICE_1, st)]);
            let want = hz * 2f32.powf(st / 12.0);
            assert!(is_at(&out, want, SR), "{hz} Hz {st:+} st: {} Hz, wanted {want}", pitch(&out, SR));
            assert!(rms(&out) > 0.01, "{hz} Hz {st:+} st sounds");
        }
    }
}

#[test]
fn in_a_key_a_third_is_the_scales_own() {
    // C major: over A (220 Hz) a third above is C, 3 semitones; over C (261.6 Hz) it's E, 4
    for (hz, st) in [(220.0, 3.0), (261.63, 4.0), (293.66, 3.0)] {
        assert!(is_at(&harmony_of(hz, &[(SCALE, 0.0), (VOICE_1, 2.0)]), hz * 2f32.powf(st / 12.0), SR), "over {hz} Hz");
    }
    // A singer a little flat stays that much flat in the harmony (it follows the line, not a grid)
    let flat = 220.0 * 2f32.powf(-0.25 / 12.0);
    assert!(is_at(&harmony_of(flat, &[(SCALE, 0.0), (VOICE_1, 2.0)]), flat * 2f32.powf(3.0 / 12.0), SR));
    assert!(!is_at(&harmony_of(flat, &[(SCALE, 0.0), (VOICE_1, 2.0)]), 220.0 * 2f32.powf(3.5 / 12.0), SR));
    // In A minor the same line gets A minor's thirds: over B (246.9 Hz) it's D, 3 semitones
    assert!(is_at(&harmony_of(246.94, &[(KEY, 9.0), (SCALE, 1.0), (VOICE_1, 2.0)]), 246.94 * 2f32.powf(3.0 / 12.0), SR));
}

/// Which harmonic of a voice at `hz` is the loudest, as a frequency.
fn loudest(x: &[f32], hz: f32) -> f32 {
    (1..=(3000.0 / hz) as usize).map(|h| (at_hz(x, hz * h as f32, SR), hz * h as f32)).fold((0.0, 0.0), |m, v| if v.0 > m.0 { v } else { m }).1
}

#[test]
fn a_shifted_voice_keeps_its_character() {
    // The line's loudest harmonics are around its 700 Hz resonance. A fifth up, they still are
    // (played faster instead, as a tape sped up, the resonance would move to 1050 Hz)
    let hz = 175.0;
    let out = harmony_of(hz, &[(SCALE, 2.0), (VOICE_1, 7.0)]);
    let shifted = pitch(&out, SR);
    let peak = loudest(&out, shifted);
    assert!((peak - 700.0).abs() < 140.0, "the resonance is at {peak} Hz");
    // An octave down too
    let out = harmony_of(350.0, &[(SCALE, 2.0), (VOICE_1, -12.0)]);
    let peak = loudest(&out, pitch(&out, SR));
    assert!((peak - 700.0).abs() < 120.0, "an octave down: {peak} Hz");
    // Formant moves it on purpose: 7 semitones up, to about 1050 Hz, at the same pitch
    let out = harmony_of(hz, &[(SCALE, 2.0), (VOICE_1, 0.0), (FORMANT, 7.0)]);
    assert!(cents(pitch(&out, SR), hz).abs() < 12.0);
    let peak = loudest(&out, hz);
    assert!((peak - 1050.0).abs() < 200.0, "with the formant up: {peak} Hz");
}

#[test]
fn a_unison_voice_is_about_as_loud_as_the_line() {
    for hz in [110.0, 220.0, 440.0] {
        let line = sung(hz, 48000, SR);
        let out = harmony_of(hz, &[(SCALE, 2.0), (VOICE_1, 0.0)]);
        let db = 20.0 * (rms(&out) / rms(&line[24000..])).log10();
        assert!(db.abs() < 2.0, "{hz} Hz: {db} dB");
    }
}

#[test]
fn where_there_is_no_clear_note_the_voices_rest() {
    // Noise (a breath, an "s"), silence, and a sound too quiet to follow
    let mut seed = 9u32;
    let noise: Vec<f32> = (0..48000).map(|_| { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); (seed >> 8) as f32 / (1u32 << 23) as f32 - 1.0 }).map(|v| v * 0.2).collect();
    let sets = [(DRY, 0.0), (LEVEL_1, 1.0), (LEVEL_2, 1.0), (SCALE, 2.0)];
    assert!(rms(&run(&mut with(&sets), &noise, 128).0[12000..]) < 1e-4);
    assert!(rms(&run(&mut with(&sets), &vec![0.0; 24000], 128).0) == 0.0);
    let faint: Vec<f32> = sung(220.0, 24000, SR).iter().map(|v| v * 0.002).collect();
    assert!(rms(&run(&mut with(&sets), &faint, 128).0) == 0.0);
    // After a note ends, the voices stop within a tenth of a second, and start again with the next
    let mut h = with(&sets);
    assert!(h.pitch_hz() == 0.0);
    let (a, _) = run(&mut h, &sung(220.0, 24000, SR), 128);
    assert!((h.pitch_hz() / 220.0 - 1.0).abs() < 0.01);
    assert!(rms(&a[12000..]) > 0.01);
    let (b, _) = run(&mut h, &vec![0.0; 24000], 128);
    assert!(rms(&b[4800..]) < 1e-6 && h.pitch_hz() == 0.0);
    let (c, _) = run(&mut h, &sung(330.0, 24000, SR), 128);
    assert!(rms(&c[12000..]) > 0.01);
    // Samples that aren't numbers pass as they came (the host silences those) and don't stay in it
    let bad = vec![f32::NAN; 256];
    let (mut l, mut r) = (vec![0.0; 256], vec![0.0; 256]);
    h.process(&mut Block { input: [&bad, &bad], sidechain: None, output: [&mut l, &mut r] });
    let (d, _) = run(&mut h, &sung(220.0, 24000, SR), 128);
    assert!(rms(&d[12000..]) > 0.01);
}

#[test]
fn two_voices_spread_left_and_right() {
    let x = sung(220.0, 48000, SR);
    let (l, r) = run(&mut with(&[(DRY, 0.0), (SCALE, 2.0), (VOICE_1, 4.0), (LEVEL_1, 1.0), (VOICE_2, 7.0), (LEVEL_2, 1.0), (SPREAD, 1.0), (DETUNE, 0.0)]), &x, 128);
    // Voice 1 (a major third up) is on the left only, voice 2 (a fifth up) on the right only
    assert!(is_at(&l[24000..], 220.0 * 2f32.powf(4.0 / 12.0), SR) && !is_at(&l[24000..], 220.0 * 2f32.powf(7.0 / 12.0), SR));
    assert!(is_at(&r[24000..], 220.0 * 2f32.powf(7.0 / 12.0), SR) && !is_at(&r[24000..], 220.0 * 2f32.powf(4.0 / 12.0), SR));
    // With no spread both are in the middle
    let (l, r) = run(&mut with(&[(DRY, 0.0), (SCALE, 2.0), (LEVEL_2, 1.0), (SPREAD, 0.0)]), &x, 128);
    assert_eq!(l, r);
    // Detune sets the two a few cents either side of their notes
    let (l, r) = run(&mut with(&[(DRY, 0.0), (SCALE, 2.0), (VOICE_1, 0.0), (LEVEL_1, 1.0), (VOICE_2, 0.0), (LEVEL_2, 1.0), (SPREAD, 1.0), (DETUNE, 30.0)]), &x, 128);
    let (up, down) = (cents(pitch(&l[24000..], SR), 220.0), cents(pitch(&r[24000..], SR), 220.0));
    assert!(up > 15.0 && up < 45.0 && down < -15.0 && down > -45.0, "{up} and {down} cents");
}

#[test]
fn the_same_whatever_the_block_size_and_at_other_sample_rates() {
    let x = sung(196.0, 14400, SR);
    let render = |size: usize| run(&mut with(&[(VOICE_2, -3.0), (LEVEL_2, 0.6)]), &x, size).0;
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
    for sr in [32000.0, 44100.0, 96000.0] {
        let mut h = Harmony::new(sr);
        for (i, v) in [(DRY, 0.0), (LEVEL_1, 1.0), (SCALE, 2.0), (VOICE_1, 5.0), (DETUNE, 0.0)] {
            h.set(i, normal(i, v));
        }
        let (l, _) = run(&mut h, &sung(220.0, sr as usize, sr), 128);
        assert!(is_at(&l[sr as usize / 2..], 220.0 * 2f32.powf(5.0 / 12.0), sr), "{sr} Hz: {} Hz", pitch(&l[sr as usize / 2..], sr));
    }
}

#[test]
fn presets_play_and_keep_the_songs_key() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut h = with(&[(KEY, 7.0)]);
        h.set_program(i);
        assert_eq!(h.param_display(KEY), "G", "{name} keeps the key");
        assert_eq!(h.params[1..], values[1..]);
        assert_eq!(Harmony::program_name(i), *name);
        h.set(DRY, 0.0);
        let (l, r) = run(&mut h, &sung(196.0, 24000, SR), 128);
        assert!(rms(&l[12000..]) + rms(&r[12000..]) > 0.01, "{name} adds a voice");
    }
}
