//! Every preset (and a fresh synth on its defaults, as an old saved sound without a preset loads)
//! sounds as it did before the per-note movement work: a riff of 16ths and a held chord are
//! rendered and summed up in short frames (left and right level, brightness, width), and compared
//! with the same numbers taken from the engine as it was (tests/data/legacy_sound.bin).
//!
//! The numbers were written by `write_legacy_sound` below, run on the engine before the change:
//! copy this file into that version's tests/ and run
//! `cargo test --release --test legacy_sound -- --ignored write_legacy_sound`.

use fledge_synth::presets::PRESETS;
use fledge_synth::synth::{Synth, BLOCK};
use std::path::PathBuf;

const SR: f32 = 48000.0;
const FRAME: usize = 512;

fn data_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/legacy_sound.bin")
}

/// The riff: (start in 16ths, length in 16ths, note, velocity). Two bars of 16ths at 140 BPM with
/// rests, repeats and jumps, then a held chord.
fn riff() -> Vec<(f32, f32, u8, u8)> {
    let notes = [36u8, 36, 48, 36, 39, 36, 43, 36, 36, 48, 46, 36, 41, 36, 34, 36];
    let mut out = vec![];
    for bar in 0..2 {
        for (i, &n) in notes.iter().enumerate() {
            if (bar == 1 && i == 5) || i == 11 {
                continue; // rests
            }
            let len = if i % 4 == 3 { 1.5 } else { 0.75 };
            out.push(((bar * 16 + i) as f32, len, n, 70 + ((i * 37) % 57) as u8));
        }
    }
    for n in [48u8, 55, 60, 63] {
        out.push((32.0, 8.0, n, 100));
    }
    out
}

/// Render `values` playing the riff; per frame: RMS left, RMS right, RMS of the mid's first
/// difference (brightness), RMS of the side.
pub fn fingerprint(values: &[f32], tempo: f32) -> Vec<f32> {
    let mut s = Synth::new(SR);
    s.set_tempo(tempo);
    for (i, v) in values.iter().enumerate() {
        if i < s.params.len() {
            s.params[i] = *v;
        }
    }
    let sixteenth = 60.0 / tempo / 4.0;
    let mut events: Vec<(usize, u8, u8, u8)> = vec![];
    for (at, len, n, vel) in riff() {
        events.push(((at * sixteenth * SR) as usize, 0x90, n, vel));
        events.push((((at + len) * sixteenth * SR) as usize, 0x80, n, 0));
    }
    events.sort_by_key(|e| (e.0, e.1 == 0x90));
    let total = ((40.0 * sixteenth + 0.8) * SR) as usize / FRAME * FRAME;
    let mut out = vec![];
    let mut acc = [0.0f64; 4];
    let mut prev = 0.0f32;
    let mut k = 0;
    let mut t = 0;
    while t < total {
        while k < events.len() && events[k].0 <= t {
            s.midi(events[k].1, events[k].2, events[k].3);
            k += 1;
        }
        let next = if k < events.len() { events[k].0.min(total) } else { total };
        let n = (next - t).clamp(1, BLOCK);
        s.process(n);
        for j in 0..n {
            let (l, r) = (s.out[0][j], s.out[1][j]);
            let mid = 0.5 * (l + r);
            acc[0] += (l * l) as f64;
            acc[1] += (r * r) as f64;
            acc[2] += ((mid - prev) * (mid - prev)) as f64;
            acc[3] += (0.25 * (l - r) * (l - r)) as f64;
            prev = mid;
            if (t + j + 1) % FRAME == 0 {
                for a in acc.iter_mut() {
                    out.push((*a / FRAME as f64).sqrt() as f32);
                    *a = 0.0;
                }
            }
        }
        t += n;
    }
    out
}

fn defaults() -> Vec<f32> {
    let mut s = Synth::new(SR);
    let _ = &mut s;
    s.params.to_vec()
}

/// What was measured: (name, numbers), "(defaults)" first.
fn cases() -> Vec<(String, Vec<f32>)> {
    let mut v = vec![("(defaults)".to_string(), defaults())];
    for p in PRESETS {
        v.push((p.name.to_string(), p.values().to_vec()));
    }
    v
}

#[test]
#[ignore]
fn write_legacy_sound() {
    let mut bytes: Vec<u8> = vec![];
    let list = cases();
    let count = defaults().len() as u32;
    bytes.extend_from_slice(&count.to_le_bytes());
    bytes.extend_from_slice(&(list.len() as u32).to_le_bytes());
    for (name, values) in &list {
        bytes.extend_from_slice(&(name.len() as u32).to_le_bytes());
        bytes.extend_from_slice(name.as_bytes());
        let f = fingerprint(values, 140.0);
        bytes.extend_from_slice(&(f.len() as u32).to_le_bytes());
        for x in f {
            bytes.extend_from_slice(&x.to_le_bytes());
        }
    }
    std::fs::create_dir_all(data_path().parent().unwrap()).unwrap();
    std::fs::write(data_path(), bytes).unwrap();
}

/// The numbers measured before, by case name, and the parameter count then.
fn measured() -> (usize, Vec<(String, Vec<f32>)>) {
    let b = std::fs::read(data_path()).expect("tests/data/legacy_sound.bin");
    let u = |at: &mut usize| {
        let v = u32::from_le_bytes(b[*at..*at + 4].try_into().unwrap()) as usize;
        *at += 4;
        v
    };
    let mut at = 0;
    let count = u(&mut at);
    let cases = u(&mut at);
    let mut out = vec![];
    for _ in 0..cases {
        let n = u(&mut at);
        let name = String::from_utf8(b[at..at + n].to_vec()).unwrap();
        at += n;
        let len = u(&mut at);
        let f = (0..len).map(|i| f32::from_le_bytes(b[at + 4 * i..at + 4 * i + 4].try_into().unwrap())).collect();
        at += 4 * len;
        out.push((name, f));
    }
    (count, out)
}

#[test]
fn every_old_preset_and_old_saved_sound_sounds_as_before() {
    let (old_count, before) = measured();
    assert_eq!(old_count, fledge_synth::params::COUNT_V1);
    let mut worst = (0.0f32, String::new());
    let mut problems = vec![];
    for (name, want) in &before {
        let values: Vec<f32> = if name == "(defaults)" {
            // An old saved sound without a preset: the defaults, as an old file has them, loaded
            // the way the host loads one (only its values, then the old ones' settings)
            let mut s = Synth::new(SR);
            let old: Vec<f32> = s.params[..old_count].to_vec();
            s.params[..old_count].copy_from_slice(&old);
            s.legacy(old_count);
            s.params.to_vec()
        } else {
            let p = PRESETS.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("{name} is gone"));
            p.values().to_vec()
        };
        let got = fingerprint(&values, 140.0);
        assert_eq!(got.len(), want.len(), "{name}");
        // Within 0.01 dB in every frame (or below -100 dB)
        for (i, (g, w)) in got.iter().zip(want.iter()).enumerate() {
            let err = (g - w).abs() / w.abs().max(1e-5);
            if err > worst.0 {
                worst = (err, format!("{name} frame {} feature {}", i / 4, i % 4));
            }
            if err > 1e-3 {
                problems.push(format!("{name}: frame {} feature {}: {w} before, {g} now", i / 4, i % 4));
                break;
            }
        }
    }
    eprintln!("largest difference: {:.2e} ({})", worst.0, worst.1);
    assert!(problems.is_empty(), "{problems:#?}");
}
