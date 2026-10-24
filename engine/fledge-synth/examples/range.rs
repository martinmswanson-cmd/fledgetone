//! Every preset across its keyboard range (presets::keyboard_range): one note at a time,
//! chromatically, measured (analysis::note_shape) for its tone in harmonics, loudness, sub, width
//! and envelope, so a preset that turns into another instrument from the bottom to the top shows.
//! `cargo run --release --example range [-- table <csv> [preset name filter]]` writes a row per
//! note and prints each preset's spread and its largest jump between neighbouring notes;
//! `cargo run --release --example range -- scale <preset name> <wav> [lowest note] [octaves]`
//! writes a major scale up the range as a WAV.

use fledge_synth::analysis::{note_shape, NoteShape};
use fledge_synth::presets::{keyboard_range, note_render, PRESETS};
use fledge_synth::synth::{Synth, BLOCK};
use std::io::Write;

const SR: f32 = 48000.0;
const VEL: u8 = 102; // 0.8

fn wav(path: &str, l: &[f32], r: &[f32]) {
    let mut f = std::fs::File::create(path).unwrap();
    let n = l.len() as u32;
    let mut h = vec![];
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + n * 4).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&(SR as u32).to_le_bytes());
    h.extend_from_slice(&(SR as u32 * 4).to_le_bytes());
    h.extend_from_slice(&4u16.to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&(n * 4).to_le_bytes());
    for i in 0..l.len() {
        for x in [l[i], r[i]] {
            h.extend_from_slice(&((x.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
    }
    f.write_all(&h).unwrap();
}

/// How long a preset's note is held, and the stretch of it measured (s): pads, FX swell in
fn timing(name: &str) -> (f32, f32) {
    if name.starts_with("Pad/") || name.starts_with("FX/") {
        (2.0, 0.8)
    } else {
        (0.6, 0.05)
    }
}

pub struct Row {
    pub note: u8,
    pub shape: NoteShape,
    pub attack_ms: f64,
    pub decay_db: f64,
}

fn measure(values: &[f32; fledge_synth::params::COUNT], name: &str, note: u8) -> Row {
    let (hold, from) = timing(name);
    // Four takes, struck on each beat of a bar (each its own random start), their power averaged
    let takes: Vec<(Vec<f32>, Vec<f32>)> = (0..4).map(|k| note_render(values, note, VEL, hold, k as f64)).collect();
    let (a, b) = ((from * SR) as usize, (hold * SR) as usize);
    let f0 = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
    let parts: Vec<(&[f32], &[f32])> = takes.iter().map(|(l, r)| (&l[a..b], &r[a..b])).collect();
    let shape = note_shape(&parts, SR, f0);
    let (l, r) = &takes[0];
    // The envelope: 5 ms RMS frames over the held part
    let fr = (0.005 * SR) as usize;
    let env: Vec<f64> = (0..b / fr).map(|k| ((k * fr)..((k + 1) * fr)).map(|i| (l[i] * l[i] + r[i] * r[i]) as f64).sum::<f64>() / (2 * fr) as f64).map(|x| x.sqrt()).collect();
    let peak = env.iter().cloned().fold(0.0, f64::max).max(1e-12);
    let at = env.iter().position(|&x| x >= 0.9 * peak).unwrap_or(0);
    let last = *env.last().unwrap_or(&0.0);
    Row { note, shape, attack_ms: (at + 1) as f64 * 5.0, decay_db: 20.0 * (last.max(1e-12) / peak).log10() }
}

fn name_of(n: u8) -> String {
    const N: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    format!("{}{}", N[n as usize % 12], n as i32 / 12 - 1)
}

/// The largest step between neighbours that isn't the trend: each step against the median of
/// the steps around it. (value, between which notes)
fn worst_jump(xs: &[f64], notes: &[u8]) -> (f64, String) {
    let d: Vec<f64> = xs.windows(2).map(|w| w[1] - w[0]).collect();
    let mut best = (0.0, String::new());
    for i in 0..d.len() {
        let mut around: Vec<f64> = (i.saturating_sub(3)..(i + 4).min(d.len())).filter(|&j| j != i).map(|j| d[j]).collect();
        around.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let med = if around.is_empty() { 0.0 } else { around[around.len() / 2] };
        let off = (d[i] - med).abs();
        if off > best.0 {
            best = (off, format!("{}-{}", name_of(notes[i]), name_of(notes[i + 1])));
        }
    }
    best
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("scale") => scale(&args[2], &args[3], args.get(4).and_then(|s| s.parse().ok()), args.get(5).and_then(|s| s.parse().ok()).unwrap_or(3)),
        Some("table") => table(args.get(2).cloned(), args.get(3).cloned().unwrap_or_default()),
        _ => table(None, String::new()),
    }
}

fn table(csv: Option<String>, filter: String) {
    let mut out = csv.map(|p| std::fs::File::create(p).unwrap());
    if let Some(f) = &mut out {
        write!(f, "preset,note,f0,centroid,slope,lufs,sub,width,attack_ms,decay_db,rms,centroid8").unwrap();
        for h in 1..=30 {
            write!(f, ",h{h}").unwrap();
        }
        writeln!(f).unwrap();
    }
    println!(
        "{:28} {:>7} | {:>12} {:>12} {:>12} | {:>10} {:>10} {:>10}",
        "preset (low..high)", "notes", "centroid h", "slope dB/oct", "LUFS", "jump cent", "jump slope", "jump LUFS"
    );
    let chosen: Vec<_> = PRESETS.iter().filter(|p| p.name.contains(&filter)).collect();
    // (Four at a time)
    let all: Vec<Vec<Row>> = std::thread::scope(|sc| {
        let jobs: Vec<_> = (0..4)
            .map(|t| {
                let chosen = &chosen;
                sc.spawn(move || chosen.iter().enumerate().filter(|(i, _)| i % 4 == t).map(|(i, p)| {
                    let values = p.values();
                    let (lo, hi) = keyboard_range(p.name);
                    (i, (lo..=hi).map(|n| measure(&values, p.name, n)).collect::<Vec<Row>>())
                }).collect::<Vec<_>>())
            })
            .collect();
        let mut got: Vec<(usize, Vec<Row>)> = jobs.into_iter().flat_map(|j| j.join().unwrap()).collect();
        got.sort_by_key(|g| g.0);
        got.into_iter().map(|g| g.1).collect()
    });
    for (p, rows) in chosen.iter().zip(all) {
        let (lo, hi) = keyboard_range(p.name);
        if let Some(f) = &mut out {
            for r in &rows {
                let s = &r.shape;
                write!(f, "{},{},{:.2},{:.3},{:.2},{:.2},{:.2},{:.2},{:.0},{:.2},{:.2},{:.3}", p.name, r.note, s.f0, s.centroid, s.slope, s.lufs, s.sub, s.width, r.attack_ms, r.decay_db, s.rms, s.centroid8).unwrap();
                for h in s.harm {
                    write!(f, ",{h:.1}").unwrap();
                }
                writeln!(f).unwrap();
            }
        }
        let notes: Vec<u8> = rows.iter().map(|r| r.note).collect();
        // (Centroid jumps in octaves: a doubling is as big low as high)
        let cent: Vec<f64> = rows.iter().map(|r| r.shape.centroid.max(1e-3).log2()).collect();
        let slope: Vec<f64> = rows.iter().map(|r| r.shape.slope).collect();
        let lufs: Vec<f64> = rows.iter().map(|r| r.shape.lufs).collect();
        let (jc, jcw) = worst_jump(&cent, &notes);
        let (js, jsw) = worst_jump(&slope, &notes);
        let (jl, jlw) = worst_jump(&lufs, &notes);
        let f = |xs: &[f64]| format!("{:5.1}..{:<5.1}", xs[0], xs[xs.len() - 1]);
        let raw: Vec<f64> = rows.iter().map(|r| r.shape.centroid).collect();
        println!(
            "{:28} {:>3}-{:<3} | {} {} {} | {:4.2} {:5} {:4.1} {:5} {:4.1} {:5}",
            p.name, name_of(lo), name_of(hi), f(&raw), f(&slope), f(&lufs), jc, jcw, js, jsw, jl, jlw
        );
    }
}

fn scale(name: &str, path: &str, low: Option<u8>, octaves: u8) {
    let p = PRESETS.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("no preset {name}"));
    let lo = low.unwrap_or(keyboard_range(name).0);
    let mut notes = vec![];
    for o in 0..octaves {
        for st in [0u8, 2, 4, 5, 7, 9, 11] {
            notes.push(lo + 12 * o + st);
        }
    }
    notes.push(lo + 12 * octaves);
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    s.params = p.values();
    for _ in 0..40 {
        s.process(BLOCK);
    }
    let pads = name.starts_with("Pad/") || name.starts_with("FX/");
    let step = if pads { 0.75 } else { 0.25 };
    let (mut l, mut r) = (vec![], vec![]);
    let total = ((notes.len() as f32 * step + 1.5) * SR) as usize;
    let mut t = 0usize;
    let mut k = 0usize;
    let mut on: Option<u8> = None;
    while t < total {
        // Each note held 85 % of its step
        let i = (t as f32 / SR / step) as usize;
        let within = t as f32 / SR - i as f32 * step;
        if within >= step * 0.85 {
            if let Some(n) = on.take() {
                s.midi(0x80, n, 0);
            }
        } else if i == k && k < notes.len() {
            s.set_position(i as f64 * step as f64 * 2.0);
            s.midi(0x90, notes[k], VEL);
            on = Some(notes[k]);
            k += 1;
        }
        let n = 32.min(total - t).min(BLOCK);
        s.process(n);
        l.extend_from_slice(&s.out[0][..n]);
        r.extend_from_slice(&s.out[1][..n]);
        t += n;
    }
    wav(path, &l, &r);
}
