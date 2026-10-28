//! Tests for the drive stages' timing: at twice the rate a shape comes out a few samples late, so
//! whatever is mixed with it, or switched to and from it, has to be just as late.

use super::*;

const SR: f32 = 48000.0;

fn set(s: &mut Synth, name: &str, value: f32) {
    let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
    s.params[i] = param(i).kind.normal(value);
}

/// The band drive's level for a quiet sine at `hz` against what went in, dB (near clean: Soft at
/// 0 dB), its highs getting `high_amt` of the drive
fn band_level(hz: f32, high_amt: f32) -> f64 {
    let lo = SvfCoef::new(150.0, SR, std::f32::consts::SQRT_2);
    let hi = SvfCoef::new(2500.0, SR, std::f32::consts::SQRT_2);
    let dn = DriveNow::new(1, 0.0, 1.0, 0.5).level_kept(SR);
    let mut st = Band::default();
    let mut sum = 0.0f64;
    for i in 0..48000 {
        if i % CONTROL == 0 {
            st.plan(&dn, high_amt);
        }
        let x = 0.01 * (2.0 * std::f32::consts::PI * hz * i as f32 / SR).sin();
        let y = st.tick(&lo, &hi, None, x);
        if i >= 9600 {
            sum += (y * y) as f64;
        }
    }
    10.0 * (sum / 38400.0 / 0.00005).log10()
}

/// The highs mixed part way: clean highs (on time) and driven ones (a few samples late) combed,
/// 10 dB down at 5 kHz at half, before they were mixed in their stage
#[test]
fn the_band_drive_highs_amount_doesnt_comb() {
    for amt in [1.0, 0.5, 0.25] {
        let mut line = String::new();
        let mut worst: f64 = 0.0;
        for hz in [100.0, 150.0, 300.0, 1000.0, 2500.0, 4000.0, 5000.0, 6000.0, 8000.0, 10000.0, 12000.0, 16000.0] {
            let l = band_level(hz, amt);
            line += &format!(" {hz}:{l:+.2}");
            worst = worst.max(l.abs());
        }
        println!("highs {amt}:{line}");
        assert!(worst < 0.3, "highs {amt}:{line}");
    }
}

/// The largest step from one sample to the next of a sine note's left side (an A, driven lightly)
/// over 400 blocks, `toggle` called with each block's number first (it may change parameters)
fn max_step(toggle: &dyn Fn(&mut Synth, usize)) -> f32 {
    let mut s = Synth::new(SR);
    set(&mut s, "Filter type", 10.0);
    set(&mut s, "Drive type", 1.0);
    set(&mut s, "Drive", 0.0);
    set(&mut s, "Drive mix", 1.0);
    s.midi(0x90, 69, 100);
    let mut last = 0.0f32;
    let mut most = 0.0f32;
    for b in 0..400 {
        toggle(&mut s, b);
        s.process(BLOCK);
        for &x in &s.out[0][..BLOCK] {
            if b >= 40 {
                most = most.max((x - last).abs());
            }
            last = x;
        }
    }
    most
}

/// Switched between running (a few samples late) and left out mid-note, a stage jumped 11 to 22
/// times the note's own largest step
#[test]
fn switching_the_drive_mid_note_doesnt_click() {
    let normal = max_step(&|_, _| {});
    // Drive type off and on again while the note sounds
    let kind = max_step(&|s, b| set(s, "Drive type", if (b / 7) % 2 == 0 { 1.0 } else { 0.0 }));
    // The mix down to nothing and back (as a modulation can take it)
    let mix = max_step(&|s, b| set(s, "Drive mix", if (b / 5) % 2 == 0 { 1.0 } else { 0.0 }));
    // Off when the note starts, turned on mid-note (and off and on again); mixed out when the note
    // starts, mixed in mid-note
    let late = max_step(&|s, b| set(s, "Drive type", if b >= 60 && (b / 7) % 2 == 1 { 1.0 } else { 0.0 }));
    let late_mix = max_step(&|s, b| set(s, "Drive mix", if b >= 50 && (b / 5) % 2 == 0 { 1.0 } else { 0.0 }));
    // The band drive switched in and out, and its highs amount moved
    let band = max_step(&|s, b| {
        set(s, "Band drive type", if (b / 9) % 2 == 1 { 1.0 } else { 0.0 });
        set(s, "Band high amount", if (b / 4) % 2 == 1 { 0.25 } else { 1.0 });
    });
    let late_band = max_step(&|s, b| set(s, "Band drive type", if b >= 60 { 1.0 } else { 0.0 }));
    // From a shape to a crush and back
    let crush = max_step(&|s, b| set(s, "Drive type", if (b / 6) % 2 == 1 { 7.0 } else { 1.0 }));
    let cases = [
        ("type switched", kind),
        ("mix switched", mix),
        ("turned on mid-note", late),
        ("mixed in mid-note", late_mix),
        ("band drive switched", band),
        ("band drive turned on", late_band),
        ("shape to crush", crush),
    ];
    for (what, step) in cases {
        println!("{what}: {:.2}x the largest step without", step / normal);
    }
    for (what, step) in cases {
        assert!(step < 1.2 * normal, "{what}: {step} against {normal}");
    }
}
