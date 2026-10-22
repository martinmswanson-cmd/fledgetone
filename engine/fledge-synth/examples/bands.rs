//! Every preset's band balance (src/analysis.rs `balance`): the bass riff of the `movement`
//! example (basses, leads, keys, FX) or a held four-note chord (pads and chords). Each band's level
//! against the total (dB), presence (4-8 kHz) and air (8 kHz+) against everything over 100 Hz, the
//! side against the middle under 150 Hz, and the tallest narrow peak over 1-12 kHz.
//! `cargo run --release --example bands [-- <preset name filter>]`.

use fledge_synth::analysis::balance;
use fledge_synth::presets::{chord_render, riff_render, PRESETS};

fn main() {
    let filter = std::env::args().nth(1).unwrap_or_default();
    println!("{:28} {:>6} {:>6} {:>6} {:>6} {:>6} {:>6} | {:>8} {:>7} {:>7} {:>5}", "preset (dB of total)", "sub", "low", "lowMid", "mid", "pres", "air", "pres>100", "air>100", "S/M<150", "peak");
    for p in PRESETS.iter().filter(|p| p.name.contains(&filter)) {
        let chordy = p.name.starts_with("Pad/") || p.name.starts_with("Chords/");
        let (l, r) = if chordy { chord_render(&p.values()) } else { riff_render(p, 140.0) };
        let b = balance(&l, &r, 48000.0);
        print!("{:28}", p.name);
        for x in b.bands {
            print!(" {x:6.1}");
        }
        println!(" | {:8.1} {:7.1} {:7.1} {:5.1}", b.presence, b.air, b.side_low.max(-99.0), b.peak);
    }
}
