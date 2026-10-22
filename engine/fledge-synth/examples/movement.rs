//! Every preset playing a 2-bar bass riff of 16ths at 140 BPM, measured for movement (see
//! src/analysis.rs) next to the reference tracks' ranges. `cargo run --release --example movement
//! [-- <folder to write WAVs into> [preset name filter]]`. The last two columns: how alike a riff
//! that repeats each bar (its first bar, six times at 145 BPM) is a bar apart, with the preset's
//! "Random repeat" and with it set to "Never".

use fledge_synth::analysis::movement;
use fledge_synth::params::index_of;
use fledge_synth::presets::{loop_render, riff_render, PRESETS};
use std::io::Write;

fn wav(path: &std::path::Path, l: &[f32], r: &[f32], sr: u32) {
    let mut f = std::fs::File::create(path).unwrap();
    let n = l.len() as u32;
    let mut h = vec![];
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + n * 4).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&sr.to_le_bytes());
    h.extend_from_slice(&(sr * 4).to_le_bytes());
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = args.get(1).map(std::path::PathBuf::from);
    let filter = args.get(2).cloned().unwrap_or_default();
    println!("{:28} {:>7} {:>6} {:>6} {:>7} {:>6} {:>6} {:>7} {:>7} {:>6} {:>6}", "preset", "jump", ">.25", ">.5", "1 rate", "ac1/8", "ac bar", "centr", "rms dB", "loop", "never");
    println!("{:28} {:>7} {:>6} {:>6} {:>7} {:>6} {:>6} {:>7} {:>7} {:>6}", "(references)", ".23-.61", "47-72%", "18-54", "9-39%", "~0", ".5-.8", "", "", ".5-.8");
    for p in PRESETS.iter().filter(|p| p.name.contains(&filter)) {
        let (l, r) = riff_render(p, 140.0);
        let mono: Vec<f32> = l.iter().zip(r.iter()).map(|(a, b)| 0.5 * (a + b)).collect();
        let m = movement(&mono, 48000.0, 140.0);
        let rms = (mono.iter().map(|x| x * x).sum::<f32>() / mono.len() as f32).sqrt();
        let looped = |never: bool| {
            let mut v = p.values();
            if never {
                v[index_of("Random repeat").unwrap()] = 0.0;
            }
            let (l, r) = loop_render(&v, 145.0, 6, true);
            let mono: Vec<f32> = l.iter().zip(r.iter()).map(|(a, b)| 0.5 * (a + b)).collect();
            movement(&mono, 48000.0, 145.0).ac_bar
        };
        println!(
            "{:28} {:7.2} {:5.0}% {:5.0}% {:6.0}% {:6.2} {:6.2} {:7.0} {:7.1} {:6.2} {:6.2}",
            p.name, m.jump, 100.0 * m.over_quarter, 100.0 * m.over_half, 100.0 * m.top_rate, m.ac_eighth, m.ac_bar, m.centroid, 20.0 * rms.log10(), looped(false), looped(true)
        );
        if let Some(d) = &dir {
            std::fs::create_dir_all(d).unwrap();
            wav(&d.join(format!("{}.wav", p.name.replace('/', "_").replace(' ', "_"))), &l, &r, 48000);
        }
    }
}
