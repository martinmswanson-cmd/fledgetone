//! Tests for switching the whole sound on held notes (a preset chosen, an undo putting settings
//! back): the new sound comes in at its own level, never as a burst louder than it settles at.
//! (The host fades the output out and in around the switch, see processor.ts; these are the
//! synth's own parts of it: the level going straight to the new one, unison voices added
//! mid-note not starting in step, the OTT turned on mid-note going on from the sound it followed.)

use super::*;
use crate::presets::PRESETS;

const SR: f32 = 48000.0;

fn set(s: &mut Synth, name: &str, value: f32) {
    let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
    s.params[i] = param(i).kind.normal(value);
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

/// A chord held from the start on `a`; `switch` changes it at 0.5 s (a whole block), with the
/// host's `settle` when asked. The left channel, and the sample the switch came at.
fn held(a: [f32; COUNT], switch: impl Fn(&mut Synth), settle: bool) -> (Vec<f32>, usize) {
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    s.params = a;
    for k in [45u8, 52, 57] {
        s.midi(0x90, k, 100);
    }
    let at = (SR as usize / 2) / BLOCK * BLOCK;
    let mut out = vec![];
    while out.len() < SR as usize {
        if out.len() == at {
            switch(&mut s);
            if settle {
                s.settle();
            }
        }
        s.process(BLOCK);
        out.extend_from_slice(&s.out[0][..BLOCK]);
    }
    (out, at)
}

/// The loudest 10 ms (in steps of 2.5 ms) between `from` and `to` ms after `at`
fn loudest(x: &[f32], at: usize, from: f32, to: f32) -> f32 {
    let mut ms = from;
    let mut most = 0.0f32;
    while ms < to {
        let i = at + (ms * SR / 1000.0) as usize;
        most = most.max(rms(&x[i..i + 480]));
        ms += 2.5;
    }
    most
}

#[test]
fn switching_back_to_a_quieter_level_has_no_burst_once_settled() {
    // Neuro sets its level high (-2 dB) and is quiet before it; your own sound is loud before its
    // level (-14 dB). Eased over 10 ms, the own sound played at Neuro's level for a moment
    let neuro = PRESETS.iter().position(|p| p.name == "Bass/Neuro").unwrap();
    let own = p::defaults();
    let (eased, at) = held(PRESETS[neuro].values(), |s| s.params = own, false);
    let (settled, _) = held(PRESETS[neuro].values(), |s| s.params = own, true);
    let level = loudest(&settled, at, 100.0, 400.0);
    assert!(loudest(&eased, at, 0.0, 20.0) > 1.8 * level, "the eased level's burst (the old way) is gone: test no longer shows it");
    let first = loudest(&settled, at, 0.0, 60.0);
    assert!(first <= 1.1 * level, "first 60 ms {first} against {level} settled");
}

#[test]
fn unison_voices_added_mid_note_do_not_start_in_step() {
    // One voice at the note's start, seven a moment later (a preset or a lane): the six new ones
    // started at the same point of their cycle and summed to a burst
    let mut a = p::defaults();
    {
        let mut s = Synth::new(SR);
        s.params = a;
        set(&mut s, "A unison", 1.0);
        set(&mut s, "A detune", 0.2);
        a = s.params;
    }
    let to7 = |s: &mut Synth| set(s, "A unison", 7.0);
    let (x, at) = held(a, to7, true);
    // As loud as a note started with seven voices
    let mut b = a;
    {
        let mut s = Synth::new(SR);
        s.params = b;
        to7(&mut s);
        b = s.params;
    }
    let (fresh, _) = held(b, |_| {}, false);
    let own = loudest(&fresh, at, -400.0, 400.0);
    let first = loudest(&x, at, 0.0, 200.0);
    assert!(first <= 1.15 * own, "seven voices joining: {first} against {own} for a note started with seven");
}

#[test]
fn the_ott_turned_on_mid_note_plays_as_if_it_had_been_on() {
    // Off, it follows the sound; turned on, it goes on from there, sample for sample as one that
    // was on all along. From silence's levels (reset) it boosted the sound for a moment
    let mut on = Ott::new(SR);
    let mut off = Ott::new(SR);
    let mut reset = Ott::new(SR);
    let (att, rel) = (1.0 - (-1.0f32 / (0.01 * SR)).exp(), 1.0 - (-1.0f32 / (0.2 * SR)).exp());
    let x = |i: usize| 0.1 * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / SR).sin() + 0.05 * (2.0 * std::f32::consts::PI * 3300.0 * i as f32 / SR).sin();
    let (mut most, mut most_reset) = (0.0f32, 0.0f32);
    for i in 0..48000 {
        let (a, _) = on.tick(x(i), x(i), 0.6, att, rel);
        if i < 24000 {
            off.track(x(i), x(i), att, rel);
        } else {
            let (b, _) = off.tick(x(i), x(i), 0.6, att, rel);
            let (c, _) = reset.tick(x(i), x(i), 0.6, att, rel);
            most = most.max((a - b).abs());
            most_reset = most_reset.max((a - c).abs());
        }
    }
    assert_eq!(most, 0.0, "turned on after following the sound, it plays as one on all along");
    assert!(most_reset > 0.05, "(from silence it differs: {most_reset})");
}

#[test]
fn a_preset_with_the_ott_chosen_mid_note_is_never_louder_than_before_or_after() {
    // Your own sound (no OTT) to Gated (OTT, its level high): the OTT started from silence's
    // levels and the first 60 ms came out about a quarter louder than either sound
    let gated = PRESETS.iter().position(|p| p.name == "Chords/Gated").unwrap();
    let b = PRESETS[gated].values();
    let (x, at) = held(p::defaults(), |s| s.params = b, true);
    let before = loudest(&x, at, -400.0, -10.0);
    let after = loudest(&x, at, 100.0, 400.0);
    let first = loudest(&x, at, 0.0, 60.0);
    assert!(first <= 1.1 * before.max(after), "first 60 ms {first} against {before} before, {after} after");
}

#[test]
fn a_note_of_one_voice_plays_as_before() {
    // Its one voice and every random draw after are unchanged (the spare voices draw on their own)
    let mut s = Synth::new(SR);
    s.midi(0x90, 57, 100);
    let mut sum = 0.0f64;
    for _ in 0..40 {
        s.process(BLOCK);
        sum += s.out[0][..BLOCK].iter().map(|&v| v as f64 * v as f64).sum::<f64>();
    }
    assert!(sum > 0.0);
    assert_eq!(s.voices[0].phase[0][1..].iter().filter(|&&ph| ph == s.voices[0].phase[0][1]).count(), 1, "the spare voices' points differ");
}
