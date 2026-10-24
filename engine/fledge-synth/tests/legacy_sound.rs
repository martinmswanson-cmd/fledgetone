//! Every preset (and a fresh synth on its defaults, as an old saved sound without a preset loads)
//! sounds as it did before the per-note movement work: a riff of 16ths and a held chord are
//! rendered and summed up in short frames (left and right level, brightness, width), and compared
//! with the same numbers taken from the engine as it was (tests/data/legacy_sound.bin).
//!
//! The numbers were written by `write_legacy_sound` below, run on the engine before the change:
//! copy this file into that version's tests/ and run
//! `cargo test --release --test legacy_sound -- --ignored write_legacy_sound`.
//!
//! The same for the keyboard-range work (tests/data/range_sound.bin, every preset, the newer ones
//! too, written by `write_range_sound` on the engine before it): a sound saved before it, with
//! the values there were then, sounds as it did.

use fledge_synth::presets::PRESETS;
use fledge_synth::synth::{Synth, BLOCK};
use std::path::PathBuf;

const SR: f32 = 48000.0;
const FRAME: usize = 512;

fn data_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/legacy_sound.bin")
}

/// The same numbers for every preset (the newer ones too), taken from the engine before the
/// keyboard-range work: a sound saved then (with that many values) must sound as it did
fn range_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/range_sound.bin")
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
    write_cases(&data_path(), &cases());
}

#[test]
#[ignore]
fn write_range_sound() {
    write_cases(&range_path(), &cases());
}

fn write_cases(path: &std::path::Path, list: &[(String, Vec<f32>)]) {
    let mut bytes: Vec<u8> = vec![];
    let count = defaults().len() as u32;
    bytes.extend_from_slice(&count.to_le_bytes());
    bytes.extend_from_slice(&(list.len() as u32).to_le_bytes());
    for (name, values) in list {
        bytes.extend_from_slice(&(name.len() as u32).to_le_bytes());
        bytes.extend_from_slice(name.as_bytes());
        let f = fingerprint(values, 140.0);
        bytes.extend_from_slice(&(f.len() as u32).to_le_bytes());
        for x in f {
            bytes.extend_from_slice(&x.to_le_bytes());
        }
    }
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// The numbers measured before, by case name, and the parameter count then.
fn measured() -> (usize, Vec<(String, Vec<f32>)>) {
    measured_at(&data_path())
}

fn measured_at(path: &std::path::Path) -> (usize, Vec<(String, Vec<f32>)>) {
    let b = std::fs::read(path).unwrap_or_else(|_| panic!("{}", path.display()));
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
            // (A song saved then has the preset as it was before the keyboard-range work changed it)
            let p = PRESETS.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("{name} is gone"));
            p.values_before_range().to_vec()
        };
        compare(name, &values, want, &mut worst, &mut problems);
    }
    eprintln!("largest difference: {:.2e} ({})", worst.0, worst.1);
    assert!(problems.is_empty(), "{problems:#?}");
}

/// Every preset (the newer ones too) and a fresh synth, saved before the keyboard-range work
/// (with that many values) and loaded now, sounds as it did: the table levels step as they did,
/// a note's random start follows its pitch, the detune is the same in cents on every note, and
/// the presets have the filter key tracking they had
#[test]
fn every_sound_saved_before_the_keyboard_range_work_sounds_as_before() {
    let (old_count, before) = measured_at(&range_path());
    assert_eq!(old_count, fledge_synth::params::COUNT_V2);
    let mut worst = (0.0f32, String::new());
    let mut problems = vec![];
    for (name, want) in &before {
        let full: Vec<f32> = if name == "(defaults)" {
            Synth::new(SR).params.to_vec()
        } else {
            let p = PRESETS.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("{name} is gone"));
            p.values_before_range().to_vec()
        };
        // Saved with only the values there were then, loaded the way the host loads it
        let mut s = Synth::new(SR);
        s.params[..old_count].copy_from_slice(&full[..old_count]);
        s.legacy(old_count);
        let values = s.params.to_vec();
        compare(name, &values, want, &mut worst, &mut problems);
    }
    eprintln!("largest difference: {:.2e} ({})", worst.0, worst.1);
    assert!(problems.is_empty(), "{problems:#?}");
}

/// Render `values`, compare with the numbers measured before (within 0.1 % in every frame)
fn compare(name: &str, values: &[f32], want: &[f32], worst: &mut (f32, String), problems: &mut Vec<String>) {
    {
        let got = fingerprint(values, 140.0);
        assert_eq!(got.len(), want.len(), "{name}");
        // Within 0.01 dB in every frame (or below -100 dB)
        for (i, (g, w)) in got.iter().zip(want.iter()).enumerate() {
            let err = (g - w).abs() / w.abs().max(1e-5);
            if err > worst.0 {
                *worst = (err, format!("{name} frame {} feature {}", i / 4, i % 4));
            }
            if err > 1e-3 {
                problems.push(format!("{name}: frame {} feature {}: {w} before, {g} now", i / 4, i % 4));
                break;
            }
        }
    }
}
