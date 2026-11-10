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
    // (Against its own level later: settled, Neuro's one voice gives way to the chord's three)
    assert!(loudest(&eased, at, 0.0, 20.0) > 1.8 * loudest(&eased, at, 100.0, 400.0), "the eased level's burst (the old way) is gone: test no longer shows it");
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

/// A chord held on `a`, switched to `b` at 0.5 s (with the host's settle), on to 3.3 s
fn held_long(a: [f32; COUNT], b: [f32; COUNT]) -> (Vec<f32>, usize) {
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    s.set_position(0.0);
    s.params = a;
    for k in [45u8, 52, 57] {
        s.midi(0x90, k, 100);
    }
    let at = (SR as usize / 2) / BLOCK * BLOCK;
    let mut out = vec![];
    while out.len() < SR as usize * 33 / 10 {
        if out.len() == at {
            s.params = b;
            s.settle();
        }
        s.process(BLOCK);
        out.extend_from_slice(&s.out[0][..BLOCK]);
    }
    (out, at)
}

/// The loudest 10 ms of a chord struck afresh on `a` at 0.5 s (where held_long switches: a free
/// LFO is where it was there), over 2.5 s
fn fresh_chord(a: [f32; COUNT]) -> f32 {
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    s.set_position(0.0);
    s.params = a;
    let at = (SR as usize / 2) / BLOCK * BLOCK;
    for _ in 0..at / BLOCK {
        s.process(BLOCK);
    }
    for k in [45u8, 52, 57] {
        s.midi(0x90, k, 100);
    }
    let mut out = vec![];
    while out.len() < SR as usize * 5 / 2 + 480 {
        s.process(BLOCK);
        out.extend_from_slice(&s.out[0][..BLOCK]);
    }
    loudest(&out, 0, 0.0, 2500.0)
}

#[test]
fn every_preset_chosen_on_a_held_chord_comes_in_no_louder_than_it_plays() {
    // A chord held on your own sound, then each preset, and back: the first 250 ms are never more
    // than 1 dB over the louder of the new sound settled (350 ms on) and a chord struck afresh on
    // it. Carried on, the held notes came in 2-6 dB over both: three notes on a one-voice preset
    // (808 slide, Hard Clip Stab), your own sound's full sustain under a preset whose pitch drop
    // had long run out (Downlifter), or at full level into a rise (Riser)
    let own = p::defaults();
    let own_fresh = fresh_chord(own);
    let mut worst = (0.0f32, "");
    for pr in PRESETS.iter() {
        let b = pr.values();
        let fresh = fresh_chord(b);
        for (to, f, name) in [(b, fresh, pr.name), (own, own_fresh, "back to your own sound")] {
            let from = if name == pr.name { own } else { b };
            let (x, at) = held_long(from, to);
            let first = loudest(&x, at, 0.0, 240.0);
            let settled = loudest(&x, at, 350.0, 2780.0);
            let db = 20.0 * (first / settled.max(f)).log10();
            if db > worst.0 {
                worst = (db, pr.name);
            }
            assert!(db <= 1.0, "{} ({name}): {first} in the first 250 ms against {settled} settled, {f} fresh: {db:.1} dB over", pr.name);
        }
    }
    eprintln!("loudest switch {:.2} dB over ({})", worst.0, worst.1);
}

#[test]
fn a_mono_preset_chosen_on_a_held_chord_keeps_only_the_last_note_and_back_only_it() {
    let slide = PRESETS.iter().position(|p| p.name == "Bass/808 slide").unwrap();
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    for k in [45u8, 52, 57] {
        s.midi(0x90, k, 100);
    }
    for _ in 0..100 {
        s.process(BLOCK);
    }
    assert_eq!(s.voices.iter().filter(|v| v.active).count(), 3);
    s.params = PRESETS[slide].values();
    s.settle();
    let on: Vec<u8> = s.voices.iter().filter(|v| v.active).map(|v| v.note).collect();
    assert_eq!(on, vec![57], "one voice, the last key's");
    // Back to your own sound (poly), as an undo: the one note sounding goes on; the keys the
    // one-voice sound had let go stay silent (struck again they came back out of nothing)
    let mut back = Synth::new(SR);
    back.set_tempo(120.0);
    for k in [45u8, 52, 57] {
        back.midi(0x90, k, 100);
    }
    back.process(BLOCK);
    back.params = PRESETS[slide].values();
    back.settle();
    back.process(BLOCK);
    back.params = p::defaults();
    back.settle();
    let notes: Vec<u8> = back.voices.iter().filter(|v| v.active).map(|v| v.note).collect();
    assert_eq!(notes, vec![57], "the note still sounding");
    // Letting go of it goes back to the next key still held, as a mono sound does
    s.midi(0x80, 57, 0);
    s.process(BLOCK);
    assert!(s.voices[0].active && s.voices[0].target == 52.0);
}

/// A chord held (by its keys, or by the pedal after they came up) on `a` for `secs`, then `b`
/// chosen (with the host's settle): its level over the 100 ms before, and the loudest 10 ms over
/// the 2 s after
fn held_then(a: [f32; COUNT], b: [f32; COUNT], secs: f32, pedal: bool) -> (f32, f32) {
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    s.set_position(0.0);
    s.params = a;
    if pedal {
        s.midi(0xb0, 64, 127);
    }
    for k in [57u8, 60, 64] {
        s.midi(0x90, k, 100);
    }
    let mut out = vec![];
    let at = (SR * secs) as usize / BLOCK * BLOCK;
    while out.len() < at {
        if pedal && out.len() == BLOCK * 4 {
            for k in [57u8, 60, 64] {
                s.midi(0x80, k, 0);
            }
        }
        s.process(BLOCK);
        out.extend_from_slice(&s.out[0][..BLOCK]);
    }
    let before = rms(&out[at - SR as usize / 10..at]);
    s.params = b;
    s.settle();
    while out.len() < at + SR as usize * 2 {
        s.process(BLOCK);
        out.extend_from_slice(&s.out[0][..BLOCK]);
    }
    (before, loudest(&out, at, 0.0, 1990.0))
}

#[test]
fn a_held_chord_that_had_died_away_stays_silent_and_one_still_sounding_comes_in_no_louder() {
    let named = |n: &str| PRESETS.iter().find(|p| p.name == n).unwrap_or_else(|| panic!("{n}")).values();
    // Keys/Pluck, Keys/Stab, Keys/Glass Pluck held 4 s (by the keys, or the pedal) died away;
    // Pad/Warm strings or Pad/Silk Wash then struck the chord again from nothing (0.31 to 0.36)
    for from in ["Keys/Pluck", "Keys/Stab", "Keys/Glass Pluck"] {
        for to in ["Pad/Warm strings", "Pad/Silk Wash"] {
            for pedal in [false, true] {
                let (before, after) = held_then(named(from), named(to), 4.0, pedal);
                assert!(before < 1e-3 && after < 1e-3, "{from} to {to} (pedal {pedal}): {before} before, {after} after");
            }
        }
    }
    // Still sounding (held 4 s, the pads' slow attacks done): it goes on from the level it had
    // (1 dB over at most the louder of that and the same chord struck afresh on the new sound),
    // and plays on
    let fresh = |b: [f32; COUNT]| {
        let mut s = Synth::new(SR);
        s.set_tempo(120.0);
        s.set_position(0.0);
        s.params = b;
        for k in [57u8, 60, 64] {
            s.midi(0x90, k, 100);
        }
        let mut out = vec![];
        while out.len() < SR as usize * 4 {
            s.process(BLOCK);
            out.extend_from_slice(&s.out[0][..BLOCK]);
        }
        loudest(&out, 0, 0.0, 3990.0)
    };
    for from in ["Pad/Warm strings", "Pad/Silk Wash"] {
        for to in ["Keys/Pluck", "Pad/Warm strings", "Pad/Silk Wash", "Bass/808 slide"] {
            let f = fresh(named(to));
            for pedal in [false, true] {
                let (before, after) = held_then(named(from), named(to), 4.0, pedal);
                assert!(before > 1e-2, "{from} (pedal {pedal}): sounding, {before}");
                assert!(after <= 1.122 * before.max(f), "{from} to {to} (pedal {pedal}): {after} against {before} before, {f} fresh");
                assert!(after > 0.25 * before.min(f), "{from} to {to} (pedal {pedal}): plays on ({after})");
            }
        }
    }
}

#[test]
fn a_note_struck_a_moment_before_a_switch_keeps_sounding() {
    // Struck a few samples before the switch, its level still under -60 dB in its attack: it was
    // taken for one that had died away and stayed silent while held (Pad/Silk Wash up to 16
    // samples, a 10 s attack up to 128)
    let silk = PRESETS.iter().find(|p| p.name == "Pad/Silk Wash").unwrap().values();
    let mut slow = p::defaults();
    let attack = p::index_of("Amp attack").unwrap();
    slow[attack] = param(attack).kind.normal(10.0);
    for (from, to, name) in [(silk, silk, "Pad/Silk Wash"), (slow, slow, "a 10 s attack"), (p::defaults(), silk, "your own sound to Pad/Silk Wash")] {
        for k in [1usize, 8, 16, 64, 128, 256] {
            let mut s = Synth::new(SR);
            s.set_tempo(120.0);
            s.set_position(0.0);
            s.params = from;
            for _ in 0..4 {
                s.process(BLOCK);
            }
            s.midi(0x90, 57, 100);
            s.process(k);
            s.params = to;
            s.settle();
            assert!(s.voices.iter().any(|v| v.active && v.note == 57), "{name}, struck {k} samples before: kept");
            let mut out = vec![];
            while out.len() < SR as usize * 3 {
                s.process(BLOCK);
                out.extend_from_slice(&s.out[0][..BLOCK]);
            }
            assert!(rms(&out[out.len() - SR as usize / 10..]) > 1e-3, "{name}, struck {k} samples before: sounds");
        }
    }
}
