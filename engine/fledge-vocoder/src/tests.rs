use super::*;
use fledge_dsp::fft::fft;
use fledge_dsp::math::Rng;
use std::f32::consts::TAU;

const SR: f32 = 48000.0;

fn with(sets: &[(usize, f32)]) -> Vocoder {
    let mut v = Vocoder::new(SR);
    for &(i, x) in sets {
        v.set(i, normal(i, x));
    }
    v
}

fn noise(seed: u32, amp: f32, n: usize) -> Vec<f32> {
    let mut r = Rng::new(seed);
    (0..n).map(|_| amp * r.bipolar()).collect()
}
fn sine(hz: f32, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (TAU * hz * i as f32 / SR).sin()).collect()
}

/// The carrier through the vocoder under the voice (None: no sidechain), in blocks of `size`.
fn run(v: &mut Vocoder, carrier: &[f32], voice: Option<&[f32]>, size: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(carrier.len());
    for (b, chunk) in carrier.chunks(size).enumerate() {
        let (mut l, mut r) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        let key = voice.map(|k| &k[b * size..b * size + chunk.len()]);
        v.process(&mut Block { input: [chunk, chunk], sidechain: key.map(|k| [k, k]), output: [&mut l, &mut r] });
        assert!(l.iter().chain(&r).all(|x| x.is_finite()));
        assert_eq!(l, r);
        out.extend(l);
    }
    out
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() as f32
}
fn db(a: f32, b: f32) -> f32 {
    20.0 * (a.max(1e-12) / b.max(1e-12)).log10()
}

/// The share of a sound's energy between `lo` and `hi` Hz (over its last 16384 samples).
fn share(x: &[f32], lo: f32, hi: f32) -> f32 {
    let n = 16384;
    let from = x.len() - n;
    let mut re: Vec<f64> = (0..n).map(|i| x[from + i] as f64 * (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos())).collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im, false);
    let (mut inside, mut all) = (0.0, 0.0);
    for k in 1..n / 2 {
        let p = re[k] * re[k] + im[k] * im[k];
        let hz = k as f32 * SR / n as f32;
        all += p;
        if hz >= lo && hz <= hi {
            inside += p;
        }
    }
    (inside / all.max(1e-30)) as f32
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for bands in BAND_CHOICES {
        assert_eq!(value(BANDS, normal(BANDS, bands as f32)), bands as f32);
    }
    for i in [RESPONSE, SIBILANCE, MIX, LEVEL] {
        for v in [0.0, 0.25, 0.5, 1.0] {
            assert!((normal(i, value(i, v)) - v).abs() < 1e-4, "parameter {i} at {v}");
        }
    }
    for st in [-12.0, -5.0, 0.0, 7.0, 12.0] {
        assert_eq!(value(FORMANT, normal(FORMANT, st)), st);
    }
    let v = Vocoder::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| v.param_display(i)).collect();
    assert_eq!(shown, ["16", "25 ms", "0 st", "20 %", "100 %", "+0.0 dB"]);
    assert_eq!(with(&[(FORMANT, 5.0)]).param_display(FORMANT), "+5 st");
}

#[test]
fn with_no_voice_the_track_passes_as_it_is() {
    let carrier = noise(1, 0.3, 4800);
    assert_eq!(run(&mut with(&[]), &carrier, None, 128), carrier);
}

#[test]
fn a_silent_voice_gives_silence_and_a_voice_brings_the_carrier_in() {
    let carrier = noise(1, 0.25, 48000);
    let silent = vec![0.0; 48000];
    assert!(rms(&run(&mut with(&[(SIBILANCE, 0.0)]), &carrier, Some(&silent), 128)) < 1e-6);
    // A full voice (noise in every band) over a full carrier: about the carrier's level back
    let voice = noise(2, 0.25, 48000);
    let out = run(&mut with(&[(SIBILANCE, 0.0)]), &carrier, Some(&voice), 128);
    let level = db(rms(&out[24000..]), rms(&carrier));
    assert!(level < -5.0 && level > -11.0, "{level} dB against the carrier");
    // The level follows the voice's: 12 dB quieter, 12 dB quieter out
    let quiet: Vec<f32> = voice.iter().map(|x| x * 0.25).collect();
    let soft = run(&mut with(&[(SIBILANCE, 0.0)]), &carrier, Some(&quiet), 128);
    assert!((db(rms(&soft[24000..]), rms(&out[24000..])) + 12.0).abs() < 0.5);
}

#[test]
fn the_carrier_sounds_only_where_the_voice_does() {
    // A voice that is one tone at 1 kHz, over a carrier of noise: what comes out is the noise
    // around 1 kHz, the rest shut
    let carrier = noise(3, 0.25, 48000);
    let voice = sine(1000.0, 0.5, 48000);
    // (8 bands are an octave apart, so the tone opens the two it sits between: 700 and 1400 Hz)
    for (bands, lo, hi) in [(8.0, 450.0, 2200.0), (16.0, 600.0, 1700.0), (32.0, 600.0, 1700.0)] {
        let out = run(&mut with(&[(BANDS, bands), (SIBILANCE, 0.0)]), &carrier, Some(&voice), 128);
        let near = share(&out, lo, hi);
        assert!(near > 0.9, "{bands} bands: {near} of it from {lo} to {hi} Hz");
    }
    // More bands, a narrower slice
    let narrow = |bands: f32| share(&run(&mut with(&[(BANDS, bands), (SIBILANCE, 0.0)]), &carrier, Some(&voice), 128), 850.0, 1180.0);
    assert!(narrow(32.0) > narrow(8.0) + 0.2, "{} against {}", narrow(32.0), narrow(8.0));
}

#[test]
fn the_formant_shift_moves_where_the_carrier_sounds() {
    let carrier = noise(3, 0.25, 48000);
    let voice = sine(1000.0, 0.5, 48000);
    let out = |st: f32| run(&mut with(&[(BANDS, 32.0), (FORMANT, st), (SIBILANCE, 0.0)]), &carrier, Some(&voice), 128);
    // An octave up: the 1 kHz of the voice opens the carrier around 2 kHz; an octave down, 500 Hz
    assert!(share(&out(12.0), 1500.0, 2700.0) > 0.85);
    assert!(share(&out(-12.0), 370.0, 680.0) > 0.85);
    assert!(share(&out(0.0), 1500.0, 2700.0) < 0.1);
}

#[test]
fn the_response_sets_how_long_a_band_rings_on() {
    // The voice stops: 50 ms later a slow response still lets the carrier through, a fast one doesn't
    let carrier = noise(4, 0.25, 12000);
    let mut voice = sine(1000.0, 0.5, 12000);
    voice[7200..].iter_mut().for_each(|x| *x = 0.0);
    let after = |ms: f32| {
        let out = run(&mut with(&[(RESPONSE, ms), (SIBILANCE, 0.0)]), &carrier, Some(&voice), 128);
        db(rms(&out[9600..10080]), rms(&out[6000..7200]))
    };
    assert!(after(5.0) < -40.0, "{} dB", after(5.0));
    assert!(after(300.0) > -6.0, "{} dB", after(300.0));
}

#[test]
fn sibilance_lets_the_voices_own_highs_through() {
    // An "s": noise up high in the voice, over a carrier with nothing up there (a low tone)
    let carrier = sine(110.0, 0.3, 24000);
    let hiss: Vec<f32> = {
        let raw = noise(5, 0.3, 24000);
        // (Rough high-pass: the difference of neighbours)
        (0..raw.len()).map(|i| if i == 0 { 0.0 } else { 0.5 * (raw[i] - raw[i - 1]) }).collect()
    };
    let top = |amount: f32| {
        let out = run(&mut with(&[(SIBILANCE, amount)]), &carrier, Some(&hiss), 128);
        rms(&out[12000..]) * share(&out, 5000.0, 20000.0).sqrt()
    };
    assert!(top(1.0) > 0.05, "{}", top(1.0));
    assert!(top(0.0) < top(1.0) * 0.1, "{} against {}", top(0.0), top(1.0));
}

#[test]
fn mix_and_level() {
    let carrier = noise(6, 0.25, 24000);
    let voice = noise(7, 0.25, 24000);
    // At 0 % the carrier alone
    let dry = run(&mut with(&[(MIX, 0.0)]), &carrier, Some(&voice), 128);
    assert!(dry.iter().zip(&carrier).all(|(a, b)| (a - b).abs() < 1e-6));
    let base = run(&mut with(&[]), &carrier, Some(&voice), 128);
    let up = run(&mut with(&[(LEVEL, 6.0)]), &carrier, Some(&voice), 128);
    assert!((db(rms(&up[12000..]), rms(&base[12000..])) - 6.0).abs() < 0.05);
}

#[test]
fn the_same_whatever_the_block_size_and_much_the_same_at_every_rate() {
    let carrier = noise(8, 0.25, 9600);
    let voice: Vec<f32> = sine(700.0, 0.4, 9600).iter().enumerate().map(|(i, x)| if (i / 1600) % 2 == 0 { *x } else { 0.0 }).collect();
    let render = |size: usize| run(&mut with(&[(FORMANT, 3.0)]), &carrier, Some(&voice), size);
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
    // A tone for a voice over a carrier of a note's harmonics (neither depends on the rate, as
    // noise does): the same level out at each rate
    let at = |sr: f32| {
        let mut v = Vocoder::new(sr);
        v.set(SIBILANCE, 0.0);
        let n = sr as usize;
        let c: Vec<f32> = (0..n).map(|i| (1..=40).map(|h| 0.2 / h as f32 * (TAU * 110.0 * h as f32 * i as f32 / sr).sin()).sum()).collect();
        let m: Vec<f32> = (0..n).map(|i| 0.5 * (TAU * 1000.0 * i as f32 / sr).sin()).collect();
        let out = run(&mut v, &c, Some(&m), 128);
        db(rms(&out[n / 2..]), rms(&c))
    };
    let base = at(48000.0);
    for sr in [44100.0, 96000.0] {
        assert!((at(sr) - base).abs() < 1.0, "{sr} Hz: {} dB, 48 kHz: {base} dB", at(sr));
    }
    assert!(at(32000.0).is_finite());
}

#[test]
fn presets_and_a_broken_voice() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut v = Vocoder::new(SR);
        v.set_program(i);
        assert_eq!(&v.params, values);
        assert_eq!(Vocoder::program_name(i), *name);
        let out = run(&mut v, &noise(11, 0.25, 4800), Some(&noise(12, 0.25, 4800)), 128);
        assert!(rms(&out) > 0.01, "{name} plays");
    }
    // A voice that isn't numbers plays nothing and leaves nothing stuck
    let mut v = with(&[]);
    let carrier = noise(13, 0.25, 4800);
    run(&mut v, &carrier, Some(&vec![f32::NAN; 4800]), 128);
    let after = run(&mut v, &noise(13, 0.25, 48000), Some(&vec![0.0; 48000]), 128);
    assert!(rms(&after[24000..]) < 1e-6);
    assert_eq!(v.bands().len(), 16);
}
