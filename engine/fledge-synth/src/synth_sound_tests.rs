//! Tests for "Mono restart" (a mono note that doesn't join the last starts afresh, so a riff that
//! repeats sounds the same each time round) and "Mono below" (the low end kept in the middle).

use super::*;

const SR: f32 = 48000.0;

fn set(s: &mut Synth, name: &str, value: f32) {
    let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
    s.params[i] = param(i).kind.normal(value);
}

/// A mono reese: two detuned saws, three unison voices each, a short release. At 120 BPM a 16th
/// is exactly 6000 samples, so each bar starts on the same sample of a block.
fn reese(restart: bool) -> Synth {
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    set(&mut s, "Voices", 1.0);
    set(&mut s, "A unison", 3.0);
    set(&mut s, "A detune", 0.3);
    set(&mut s, "B fine", 23.0);
    set(&mut s, "B unison", 3.0);
    set(&mut s, "Amp release", 0.08);
    set(&mut s, "Mono restart", if restart { 1.0 } else { 0.0 });
    s
}

/// One bar of 16ths (each 3/4 of its step), played `bars` times, the song position given with each
/// note as the host gives it: the left channel.
fn play_bars(s: &mut Synth, bars: usize) -> Vec<f32> {
    const NOTES: [u8; 16] = [41, 41, 53, 41, 44, 41, 48, 41, 41, 53, 51, 41, 46, 41, 39, 41];
    let six = 6000usize;
    let mut out = vec![];
    for b in 0..bars {
        for (i, &n) in NOTES.iter().enumerate() {
            let step = b * 16 + i;
            s.set_position(step as f64 / 4.0);
            s.midi(0x90, n, 100);
            let mut left = six * 3 / 4;
            let mut off = false;
            let mut done = 0;
            while done < six {
                if left == 0 && !off {
                    s.midi(0x80, n, 0);
                    off = true;
                }
                let n_here = if off { (six - done).min(BLOCK) } else { left.min(BLOCK) };
                s.process(n_here);
                out.extend_from_slice(&s.out[0][..n_here]);
                done += n_here;
                left = left.saturating_sub(n_here);
            }
        }
    }
    out
}

#[test]
fn a_mono_riff_that_repeats_each_bar_sounds_the_same_each_bar() {
    let bar = 16 * 6000;
    let diff = |restart: bool| {
        let x = play_bars(&mut reese(restart), 4);
        let (a, b) = (&x[2 * bar..3 * bar], &x[3 * bar..4 * bar]);
        let e: f32 = a.iter().zip(b).map(|(p, q)| (p - q).powi(2)).sum();
        let t: f32 = a.iter().map(|p| p * p).sum();
        e / t
    };
    // Restarting: the same, bar for bar; running on, the detuned saws beat across the bars
    assert!(diff(true) < 1e-6, "{}", diff(true));
    assert!(diff(false) > 0.05, "{}", diff(false));
}

#[test]
fn a_restarted_mono_note_fades_the_last_one_out_without_a_click() {
    // A sine: the step from one sample to the next shows a click
    let mut s = Synth::new(SR);
    set(&mut s, "A position", 0.0);
    set(&mut s, "B on", 0.0);
    set(&mut s, "Filter type", 10.0);
    set(&mut s, "Voices", 1.0);
    set(&mut s, "Amp release", 0.5);
    s.midi(0x90, 57, 127);
    let mut steady = 0.0f32;
    let mut prev = 0.0;
    for _ in 0..40 {
        s.process(BLOCK);
        for &x in &s.out[0][..BLOCK] {
            steady = steady.max((x - prev).abs());
            prev = x;
        }
    }
    s.midi(0x80, 57, 0);
    for _ in 0..2 {
        s.process(BLOCK);
        prev = s.out[0][BLOCK - 1];
    }
    // While the last note still rings, a new one starts afresh (a fifth up)
    s.midi(0x90, 64, 127);
    assert!(s.voices.iter().filter(|v| v.active).count() == 2, "the last note fades out on a voice of its own");
    let mut worst = 0.0f32;
    for _ in 0..20 {
        s.process(BLOCK);
        for &x in &s.out[0][..BLOCK] {
            worst = worst.max((x - prev).abs());
            prev = x;
        }
    }
    // (The new note's steady step is 1.5 times the old one's, a fifth up)
    assert!(worst < steady * 1.6, "{worst} against {steady}");
    // And the old one is gone, freeing its voice
    assert!(s.voices.iter().filter(|v| v.active).count() == 1);
}

#[test]
fn a_joined_mono_note_still_runs_on() {
    let mut s = reese(true);
    s.midi(0x90, 41, 100);
    for _ in 0..10 {
        s.process(BLOCK);
    }
    let phase = s.voices[0].phase;
    s.midi(0x90, 44, 100);
    assert_eq!(s.voices[0].phase, phase, "a legato note keeps the oscillators' phases");
    assert_eq!(s.voices.iter().filter(|v| v.active).count(), 1);
}

#[test]
fn older_sounds_keep_running_on_and_their_120_hz_mono_bass() {
    let mut s = Synth::new(SR);
    s.legacy(p::COUNT_V1);
    assert_eq!(s.v(p::MONO_RESTART), 0.0);
    assert!((s.v(p::MONO_BELOW) - 120.0).abs() < 0.01);
    // (And sounds saved just before these two came, too)
    let mut s = Synth::new(SR);
    s.legacy(p::MONO_RESTART);
    assert_eq!(s.v(p::MONO_RESTART), 0.0);
    // A new sound: on, and 180 Hz
    let s = Synth::new(SR);
    assert_eq!(s.v(p::MONO_RESTART), 1.0);
    assert!((s.v(p::MONO_BELOW) - 180.0).abs() < 0.5);
}

#[test]
fn mono_below_keeps_a_wide_chords_low_notes_in_the_middle() {
    // A wide unison saw chord with notes at 98-196 Hz: the side under 150 Hz against the middle
    let side_low = |below: f32| {
        let mut s = Synth::new(SR);
        set(&mut s, "A unison", 8.0);
        set(&mut s, "A detune", 0.4);
        set(&mut s, "A width", 1.0);
        set(&mut s, "Width", 1.0);
        set(&mut s, "Chorus on", 1.0);
        set(&mut s, "Mono below", below);
        for n in [43u8, 47, 50, 55] {
            s.midi(0x90, n, 100);
        }
        let (mut l, mut r) = (vec![], vec![]);
        for _ in 0..(SR as usize * 2 / BLOCK) {
            s.process(BLOCK);
            l.extend_from_slice(&s.out[0][..BLOCK]);
            r.extend_from_slice(&s.out[1][..BLOCK]);
        }
        crate::analysis::balance(&l, &r, SR).side_low
    };
    let (old, new, pad) = (side_low(120.0), side_low(180.0), side_low(250.0));
    assert!(new < old - 6.0, "180 Hz {new:.1} dB, 120 Hz {old:.1} dB");
    assert!(pad < new - 3.0 && pad < -15.0, "250 Hz {pad:.1} dB");
}

#[test]
fn note_random_follows_the_step_not_the_pitch() {
    // A riff that comes round on the next chord's root: each step has the same random values as
    // it had a bar before; the notes of a chord struck together each have their own
    let mut s = Synth::new(SR);
    s.set_tempo(140.0);
    let cfg = s.cfg();
    let at = |s: &mut Synth, beats: f64, notes: &[u8]| -> Vec<(f32, f32)> {
        s.set_position(beats);
        notes.iter().map(|&n| {
            s.midi(0x90, n, 100);
            s.note_random(n, &cfg)
        }).collect()
    };
    let first = at(&mut s, 0.5, &[41]);
    let next = at(&mut s, 4.5, &[46]);
    assert_eq!(first, next, "the same step a bar later, on another note");
    let other = at(&mut s, 4.75, &[46]);
    assert_ne!(first, other, "another step");
    let chord = at(&mut s, 8.0, &[48, 52, 55]);
    assert!(chord[0] != chord[1] && chord[1] != chord[2] && chord[0] != chord[2], "{chord:?}");
    // The chord a bar later, on other notes: each place in it as before
    assert_eq!(at(&mut s, 12.0, &[53, 57, 60]), chord);
}
/// A sound made before "Random by step" with each note's random values moving its filter and
/// pitch: chords and a riff, two bars, poly then mono. A hash of every sample, both channels.
fn legacy_note_random_scene(make: &dyn Fn() -> Synth) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for mode in [0.0f32, 1.0] {
        let mut s = make();
        let set = |s: &mut Synth, name: &str, value: f32| {
            let i = p::index_of(name).unwrap();
            s.params[i] = param(i).kind.normal(value);
        };
        s.set_tempo(120.0);
        set(&mut s, "Voices", mode);
        set(&mut s, "Cutoff", 900.0);
        set(&mut s, "Random repeat", 1.0);
        set(&mut s, "Mod 1 source", 18.0);
        set(&mut s, "Mod 1 target", 1.0);
        set(&mut s, "Mod 1 amount", 0.8);
        set(&mut s, "Mod 2 source", 19.0);
        set(&mut s, "Mod 2 target", 5.0);
        set(&mut s, "Mod 2 amount", 0.2);
        let chords: [&[u8]; 4] = [&[48, 52, 55], &[41], &[53, 57, 60], &[46, 41]];
        for step in 0..16 {
            let notes = chords[step % 4];
            s.set_position(step as f64 / 2.0);
            for &n in notes {
                s.midi(0x90, n, 100);
            }
            // An 8th at 120 BPM is 12000 samples: held for 9000
            let mut done = 0;
            while done < 12000 {
                if done == 9000 {
                    for &n in notes {
                        s.midi(0x80, n, 0);
                    }
                }
                let len = (if done < 9000 { 9000 - done } else { 12000 - done }).min(BLOCK);
                s.process(len);
                for c in 0..2 {
                    for &x in &s.out[c][..len] {
                        h = (h ^ x.to_bits() as u64).wrapping_mul(0x100_0000_01b3);
                    }
                }
                done += len;
            }
        }
    }
    h
}

/// A sound saved before "Random by step" (fewer values) still gets each note's random values from
/// its step and its pitch: sample for sample as that version of the synth played it (the hash
/// was taken from the synth as it was then, with the same scene)
#[test]
fn older_sounds_keep_their_note_random_values_exactly() {
    let old = || {
        let mut s = Synth::new(SR);
        s.legacy(p::MONO_RESTART);
        s
    };
    assert_eq!(old().v(p::RANDOM_BY_STEP), 0.0);
    assert_eq!(legacy_note_random_scene(&old), 0x474b_db08_df5f_69a5);
    // (Sounds saved with "Mono restart" and "Mono below" but before this one, too)
    let mut s = Synth::new(SR);
    s.legacy(p::RANDOM_BY_STEP);
    assert_eq!(s.v(p::RANDOM_BY_STEP), 0.0);
    // The key as it was: the step and the pitch
    s.set_tempo(120.0);
    let cfg = s.cfg();
    s.set_position(2.5);
    s.midi(0x90, 52, 100);
    s.midi(0x90, 48, 100);
    let key = |n: u64| ticks(2.5) << 8 ^ n;
    for n in [52u8, 48] {
        assert_eq!(s.note_random(n, &cfg), (hash01(key(n as u64) ^ 0x0a11_0000_0000_0000), hash_bi(key(n as u64) ^ 0x0b22_0000_0000_0000)));
    }
    // A new sound moves by step (and so sounds otherwise in this scene)
    assert_eq!(Synth::new(SR).v(p::RANDOM_BY_STEP), 1.0);
    assert_ne!(legacy_note_random_scene(&|| Synth::new(SR)), 0x474b_db08_df5f_69a5);
}

/// A chord's notes take their places from the lowest up, whatever order they came in: the same
/// chord played in any order sounds the same, sample for sample
#[test]
fn a_chords_note_random_values_dont_follow_the_order_its_notes_came_in() {
    let render = |order: &[u8]| {
        let mut s = Synth::new(SR);
        s.set_tempo(120.0);
        set(&mut s, "Mod 1 source", 18.0);
        set(&mut s, "Mod 1 target", 1.0);
        set(&mut s, "Mod 1 amount", 0.8);
        set(&mut s, "Mod 2 source", 19.0);
        set(&mut s, "Mod 2 target", 5.0);
        set(&mut s, "Mod 2 amount", 0.2);
        set(&mut s, "Cutoff", 900.0);
        let mut out = vec![];
        for bar in 0..2 {
            s.set_position(bar as f64 * 2.0);
            for &n in order {
                s.midi(0x90, n, 100);
            }
            let cfg = s.cfg();
            let places: Vec<_> = [48u8, 52, 55].iter().map(|&n| s.note_random(n, &cfg)).collect();
            for _ in 0..200 {
                s.process(BLOCK);
                out.extend_from_slice(&s.out[0][..BLOCK]);
                out.extend_from_slice(&s.out[1][..BLOCK]);
            }
            for &n in order {
                s.midi(0x80, n, 0);
            }
            out.extend(places.iter().flat_map(|&(a, b)| [a, b]));
        }
        out
    };
    // (The voices add up in another order, so to rounding; the random values exactly)
    let up = render(&[48, 52, 55]);
    let (n, k) = (up.len(), up.len() - 6);
    for order in [[55u8, 48, 52], [52, 55, 48]] {
        let other = render(&order);
        assert_eq!(other.len(), n);
        assert_eq!(other[k..], up[k..], "{order:?}");
        let worst = (0..k).map(|i| (other[i] - up[i]).abs()).fold(0.0f32, f32::max);
        let peak = up[..k].iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(worst < peak * 1e-4, "{order:?}: {worst} of {peak}");
    }
}
