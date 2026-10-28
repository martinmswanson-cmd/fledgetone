//! Tests for "Even keyboard" and "Detune key tracking": a sound stays itself from the lowest notes
//! to the highest (no step in brightness where the wavetable changes octave, a note's random start
//! from its step, not its pitch, the unison's beating not racing on high notes), and older sounds
//! keep what they had.

use super::*;
use crate::analysis::balance;

const SR: f32 = 48000.0;

fn set(s: &mut Synth, name: &str, value: f32) {
    let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
    s.params[i] = param(i).kind.normal(value);
}

/// A bare saw: one voice, no filter, no drive, no sub, nothing on B.
fn saw(even: bool) -> Synth {
    let mut s = Synth::new(SR);
    set(&mut s, "A position", 2.0 / 3.0);
    set(&mut s, "B on", 0.0);
    set(&mut s, "Filter type", p::FILTER_OFF as f32);
    set(&mut s, "Even keyboard", if even { 1.0 } else { 0.0 });
    s
}

/// The air (8 to 20 kHz against everything, dB) of a held note `cents` above F#4.
fn air(even: bool, cents: f32) -> f64 {
    let mut s = saw(even);
    set(&mut s, "A fine", cents);
    s.midi(0x90, 66, 100);
    let (mut l, mut r) = (vec![], vec![]);
    for i in 0..(SR as usize / 2 / BLOCK) {
        s.process(BLOCK);
        if i >= 20 {
            l.extend_from_slice(&s.out[0][..BLOCK]);
            r.extend_from_slice(&s.out[1][..BLOCK]);
        }
    }
    balance(&l, &r, SR).bands[5]
}

/// Up from F#4 in 5-cent steps through 375 Hz, where a single saw's table goes from 64 harmonics to
/// 32: the old way its top octave of harmonics goes at once (several dB of air from one step to
/// the next); "Even keyboard" fades it over a few semitones, never more than a little per step
#[test]
fn no_step_where_the_table_changes_octave() {
    let steps: Vec<f32> = (-10..=20).map(|k| k as f32 * 5.0).collect();
    let worst = |even: bool| {
        let a: Vec<f64> = steps.iter().map(|&c| air(even, c)).collect();
        a.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max)
    };
    let (old, even) = (worst(false), worst(true));
    eprintln!("largest air step between 5-cent neighbours: {old:.2} dB stepped, {even:.2} dB even");
    assert!(old > 2.0, "the old step: {old:.2} dB");
    assert!(even < 0.6, "the largest step with Even keyboard: {even:.2} dB (old {old:.2})");
}

/// A glide across the change of level is as smooth: no sample-to-sample jump in the air of a slow
/// glide (170 ms frames, 43 ms apart)
#[test]
fn a_glide_through_the_level_change_has_no_step() {
    let frames = |even: bool| {
        let mut s = saw(even);
        set(&mut s, "Voices", 1.0);
        set(&mut s, "Glide", 2.0);
        s.midi(0x90, 62, 100);
        for _ in 0..40 {
            s.process(BLOCK);
        }
        s.midi(0x90, 70, 100);
        let (mut l, mut r) = (vec![], vec![]);
        for _ in 0..(SR as usize * 2 / BLOCK) {
            s.process(BLOCK);
            l.extend_from_slice(&s.out[0][..BLOCK]);
            r.extend_from_slice(&s.out[1][..BLOCK]);
        }
        // 8192-sample stretches every 2048: their air
        let mut v = vec![];
        let mut at = 0;
        while at + 8192 <= l.len() {
            v.push(balance(&l[at..at + 8192], &r[at..at + 8192], SR).bands[5]);
            at += 2048;
        }
        v.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max)
    };
    let (old, even) = (frames(false), frames(true));
    eprintln!("largest air step in the glide: {old:.2} dB stepped, {even:.2} dB even");
    assert!(old > 0.6 && even < old / 3.0, "old {old:.2} dB, even {even:.2} dB");
}

/// With "Even keyboard" a note's random start (its unison phases) follows its step, so neighbouring
/// notes struck at the same place start alike; older sounds draw them from the pitch
#[test]
fn a_notes_random_start_follows_its_step_not_its_pitch() {
    let start = |even: bool, note: u8, at: f64| {
        let mut s = saw(even);
        set(&mut s, "A unison", 5.0);
        s.set_position(at);
        s.midi(0x90, note, 100);
        s.voices.iter().find(|v| v.active).unwrap().phase[0]
    };
    assert_eq!(start(true, 48, 1.0), start(true, 49, 1.0));
    assert_ne!(start(true, 48, 1.0), start(true, 48, 1.25), "another step starts otherwise");
    assert_ne!(start(false, 48, 1.0), start(false, 49, 1.0), "older sounds: by pitch");
}

/// The detune narrows above middle C as far as "Detune key tracking" says: at 100 % the unison's
/// beating (Hz) three octaves up is as slow as at middle C; at 0 the cents stay, the beating eight
/// times as fast; under middle C nothing changes
#[test]
fn the_detune_narrows_above_middle_c() {
    let spread_hz = |track: f32, note: u8| {
        let mut s = saw(true);
        set(&mut s, "A unison", 7.0);
        set(&mut s, "A detune", 0.4);
        set(&mut s, "Detune key tracking", track);
        let cfg = s.cfg();
        let key = if cfg.detune_key > 0.0 && note as f32 > 60.0 { 2f32.powf(-cfg.detune_key * (note as f32 - 60.0) / 12.0) } else { 1.0 };
        let sp = Spread::new(&cfg.osc[0], cfg.osc[0].detune, key);
        let f = 440.0 * 2f32.powf((note as f32 - 69.0) / 12.0);
        (sp.ratio[sp.n - 1] - sp.ratio[0]) * f
    };
    let c4 = spread_hz(1.0, 60);
    assert!((spread_hz(1.0, 96) / c4 - 1.0).abs() < 0.02, "{} vs {c4}", spread_hz(1.0, 96));
    assert!((spread_hz(0.0, 96) / spread_hz(0.0, 60) - 8.0).abs() < 0.1);
    assert!((spread_hz(0.5, 96) / c4 - 8f32.sqrt()).abs() < 0.05);
    assert_eq!(spread_hz(0.5, 48), spread_hz(0.0, 48));
}

/// A sound saved before "Even keyboard" and "Detune key tracking" loads with both off, as it was;
/// a new sound has them on
#[test]
fn older_sounds_keep_their_stepped_tables_and_cents() {
    let mut s = Synth::new(SR);
    assert_eq!(s.cfg().even_keys, true);
    assert!((s.cfg().detune_key - 0.5).abs() < 1e-6);
    s.legacy(p::COUNT_V2);
    assert_eq!(s.cfg().even_keys, false);
    assert_eq!(s.cfg().detune_key, 0.0);
    assert!(s.cfg().fx.chorus_spread == false);
}
