//! Tests for the per-note movement work: LFO trigger modes, delay, smooth and key tracking; the
//! new sources (note random, chaos, release velocity, note pressure) and their seeding; the
//! 16-slot matrix with curves and via; the drive placements and their levels; the clean sub
//! after the effects; glide and the pitch envelope's curves.

use super::*;

const SR: f32 = 48000.0;

fn set(s: &mut Synth, name: &str, value: f32) {
    let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
    s.params[i] = param(i).kind.normal(value);
}

fn grab(s: &mut Synth, blocks: usize) -> [Vec<f32>; 2] {
    let mut out = [vec![], vec![]];
    for _ in 0..blocks {
        s.process(BLOCK);
        out[0].extend_from_slice(&s.out[0]);
        out[1].extend_from_slice(&s.out[1]);
    }
    out
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

fn db(x: f32) -> f32 {
    20.0 * x.max(1e-9).log10()
}

/// A plain sine (oscillator A on the sine, no filter, no B), loud enough to measure.
fn sine_synth() -> Synth {
    let mut s = Synth::new(SR);
    set(&mut s, "A position", 0.0);
    set(&mut s, "B on", 0.0);
    set(&mut s, "Filter type", 10.0);
    set(&mut s, "Level", 0.0);
    s
}

/// The value LFO `k` gives voice 0 now (its phase read the way the engine reads it).
fn voice_lfo(s: &Synth, k: usize) -> f32 {
    let cfg = s.cfg();
    let v = &s.voices[0];
    let ph = if cfg.lfo[k].mode >= 2 { v.lfo_phase[k].min(0.9999) } else { v.lfo_phase[k] };
    lfo_value(&cfg, k, ph, v.lfo_held[k])
}

// ---------- LFO trigger modes ----------

#[test]
fn a_free_lfo_follows_the_song_position_whatever_played_before() {
    // Live: the synth has been running a while, with other notes. Export: a fresh one. Both are
    // told the same song position, then play the same notes: they sound the same
    let make = || {
        let mut s = Synth::new(SR);
        s.set_tempo(140.0);
        set(&mut s, "LFO 1 shape", 5.0);
        set(&mut s, "LFO 1 mode", 0.0);
        set(&mut s, "LFO 1 rate (sync)", 10.0); // 1/8
        set(&mut s, "LFO 1 target 1", 1.0);
        set(&mut s, "LFO 1 amount 1", 0.7);
        set(&mut s, "LFO 2 shape", 6.0); // steps: random levels from the song position
        set(&mut s, "LFO 2 mode", 0.0);
        set(&mut s, "LFO 2 rate (sync)", 13.0);
        set(&mut s, "LFO 2 target 1", 3.0);
        set(&mut s, "LFO 2 amount 1", 0.5);
        set(&mut s, "Noise level", -20.0);
        set(&mut s, "Mod 1 source", 18.0); // note random -> A position
        set(&mut s, "Mod 1 target", 3.0);
        set(&mut s, "Mod 1 amount", 0.6);
        set(&mut s, "Mod 2 source", 20.0); // chaos -> cutoff
        set(&mut s, "Mod 2 target", 1.0);
        set(&mut s, "Mod 2 amount", 0.4);
        s
    };
    let mut live = make();
    live.midi(0x90, 40, 90);
    grab(&mut live, 333);
    live.midi(0x80, 40, 0);
    grab(&mut live, 400);
    // (An export's fresh synth runs a moment before the song starts: its level settles)
    let mut export = make();
    grab(&mut export, 200);
    let play = |s: &mut Synth| {
        let mut out = vec![];
        for (i, n) in [36u8, 43, 48, 36].iter().enumerate() {
            s.set_position(8.0 + i as f64 * 0.5);
            s.midi(0x90, *n, 100);
            out.extend(grab(s, 70)[0].iter().copied());
            s.midi(0x80, *n, 0);
            out.extend(grab(s, 10)[0].iter().copied());
        }
        out
    };
    let (a, b) = (play(&mut live), play(&mut export));
    // (After the first note's 3 ms: anything still ringing from before has faded)
    let worst = a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max);
    assert!(worst < 1e-4, "live and export differ by {worst}");
    // And an export repeats exactly
    let mut again = make();
    grab(&mut again, 200);
    assert_eq!(play(&mut again), b);
}

#[test]
fn a_free_synced_lfo_keeps_its_old_phase_until_the_host_gives_a_position() {
    // (Old songs, and hosts that never say: as before, from where the synth started)
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    set(&mut s, "LFO 1 mode", 0.0);
    set(&mut s, "LFO 1 rate (sync)", 7.0); // 1/4: one cycle per 0.5 s
    grab(&mut s, 94); // ~0.25 s
    assert!((s.lfo_phase[0] - 0.5).abs() < 0.01, "{}", s.lfo_phase[0]);
    s.set_position(10.25); // a quarter of a beat in
    s.process(16);
    assert!((s.lfo_phase[0] - (0.25 + 16.0 / 24000.0)).abs() < 0.01, "{}", s.lfo_phase[0]);
}

#[test]
fn retrig_restarts_the_lfo_with_each_note() {
    let mut s = Synth::new(SR);
    set(&mut s, "Voices", 1.0);
    set(&mut s, "LFO 1 mode", 1.0);
    set(&mut s, "LFO 1 sync", 0.0);
    set(&mut s, "LFO 1 rate (Hz)", 3.0);
    set(&mut s, "LFO 1 phase", 0.25);
    s.midi(0x90, 48, 100);
    grab(&mut s, 50);
    assert!(s.voices[0].lfo_phase[0] > 0.5);
    s.midi(0x90, 50, 100);
    assert!((s.voices[0].lfo_phase[0] - 0.25).abs() < 1e-6);
}

#[test]
fn an_envelope_lfo_runs_once_and_holds_its_end() {
    let mut s = Synth::new(SR);
    set(&mut s, "LFO 1 shape", 2.0); // saw up: -1 to 1
    set(&mut s, "LFO 1 mode", 2.0);
    set(&mut s, "LFO 1 sync", 0.0);
    set(&mut s, "LFO 1 rate (Hz)", 4.0);
    s.midi(0x90, 48, 100);
    grab(&mut s, 50); // 0.13 s: about half way
    let mid = voice_lfo(&s, 0);
    assert!(mid > -0.5 && mid < 0.5, "{mid}");
    grab(&mut s, 400); // a second: long done
    assert!(voice_lfo(&s, 0) > 0.99);
    grab(&mut s, 100);
    assert!(voice_lfo(&s, 0) > 0.99, "it holds");
}

#[test]
fn a_sustain_env_lfo_holds_at_its_point_until_the_key_comes_up() {
    let mut s = Synth::new(SR);
    set(&mut s, "LFO 1 shape", 2.0);
    set(&mut s, "LFO 1 mode", 3.0);
    set(&mut s, "LFO 1 sync", 0.0);
    set(&mut s, "LFO 1 rate (Hz)", 4.0);
    set(&mut s, "LFO 1 sustain point", 0.4);
    set(&mut s, "Amp release", 2.0);
    s.midi(0x90, 48, 100);
    grab(&mut s, 400);
    assert!((s.voices[0].lfo_phase[0] - 0.4).abs() < 1e-6, "held at {}", s.voices[0].lfo_phase[0]);
    s.midi(0x80, 48, 0);
    grab(&mut s, 50); // 0.13 s: on its way to the end
    assert!(s.voices[0].lfo_phase[0] > 0.6);
    grab(&mut s, 200);
    assert!(voice_lfo(&s, 0) > 0.99, "finished");
}

#[test]
fn the_retrigger_setting_decides_what_a_mono_note_does_to_the_lfo() {
    // A legato line: the second note joins the first (its key still down)
    let phase_after = |mode: f32, retrig: f32, joined: bool| {
        let mut s = Synth::new(SR);
        set(&mut s, "Voices", mode);
        set(&mut s, "LFO 1 mode", 1.0);
        set(&mut s, "LFO 1 sync", 0.0);
        set(&mut s, "LFO 1 rate (Hz)", 2.0);
        set(&mut s, "LFO 1 retrigger", retrig);
        set(&mut s, "Amp release", 1.0);
        s.midi(0x90, 48, 100);
        grab(&mut s, 60);
        if !joined {
            s.midi(0x80, 48, 0);
            grab(&mut s, 2);
        }
        s.midi(0x90, 50, 100);
        s.voices[0].lfo_phase[0]
    };
    // As the voices: mono restarts, legato carries on
    assert!(phase_after(1.0, 0.0, true) < 1e-6);
    assert!(phase_after(2.0, 0.0, true) > 0.2);
    // Always: even a joined legato note restarts it
    assert!(phase_after(2.0, 1.0, true) < 1e-6);
    // Legato continues: joined notes carry on (mono too), a note after a gap restarts
    assert!(phase_after(1.0, 2.0, true) > 0.2);
    assert!(phase_after(1.0, 2.0, false) < 1e-6);
    // Never: it runs on while the voice sounds, gap or not
    assert!(phase_after(1.0, 3.0, false) > 0.2);
}

#[test]
fn a_delay_holds_the_lfo_back_then_it_rises() {
    let mut s = Synth::new(SR);
    set(&mut s, "LFO 1 mode", 1.0);
    set(&mut s, "LFO 1 sync", 0.0);
    set(&mut s, "LFO 1 rate (Hz)", 5.0);
    set(&mut s, "LFO 1 delay", 0.3);
    set(&mut s, "LFO 1 fade in", 0.1);
    set(&mut s, "LFO 1 target 1", 5.0); // pitch
    set(&mut s, "LFO 1 amount 1", 0.2);
    s.midi(0x90, 48, 100);
    grab(&mut s, 100); // 0.27 s
    assert_eq!(s.voices[0].lfo_phase[0], 0.0, "still waiting");
    grab(&mut s, 60);
    assert!(s.voices[0].lfo_phase[0] > 0.0, "running");
}

#[test]
fn smooth_rounds_off_a_square_lfo() {
    let worst_step = |smooth: f32| {
        let mut s = sine_synth();
        set(&mut s, "LFO 1 shape", 4.0);
        set(&mut s, "LFO 1 mode", 1.0);
        set(&mut s, "LFO 1 sync", 0.0);
        set(&mut s, "LFO 1 rate (Hz)", 4.0);
        set(&mut s, "LFO 1 smooth", smooth);
        set(&mut s, "LFO 1 target 1", 6.0); // volume
        set(&mut s, "LFO 1 amount 1", -1.0);
        s.midi(0x90, 69, 100);
        let mut worst: f32 = 0.0;
        let mut last = None;
        for _ in 0..800 {
            for _ in 0..8 {
                s.process(16);
            }
            let now = if smooth > 0.0 { s.voices[0].lfo_sm[0] } else { voice_lfo(&s, 0) };
            if let Some(l) = last {
                worst = worst.max((now - l as f32).abs());
            }
            last = Some(now);
        }
        worst
    };
    let (hard, soft) = (worst_step(0.0), worst_step(0.6));
    assert!(hard > 1.5 && soft < 0.5, "hard {hard}, smoothed {soft}");
}

#[test]
fn key_tracking_speeds_the_lfo_up_for_higher_notes() {
    let advance = |note: u8| {
        let mut s = Synth::new(SR);
        set(&mut s, "LFO 1 mode", 1.0);
        set(&mut s, "LFO 1 sync", 0.0);
        set(&mut s, "LFO 1 rate (Hz)", 1.0);
        set(&mut s, "LFO 1 key tracking", 1.0);
        s.midi(0x90, note, 100);
        grab(&mut s, 37);
        s.voices[0].lfo_phase[0]
    };
    let ratio = advance(72) / advance(60);
    assert!((ratio - 2.0).abs() < 0.02, "an octave up runs {ratio} times as fast");
}

#[test]
fn dotted_and_triplet_divisions_have_their_lengths() {
    for (name, beats) in [("1/32T", 1.0 / 12.0), ("1/32.", 0.1875), ("1 bar.", 6.0), ("1/1T", 8.0 / 3.0), ("1/8T", 1.0 / 3.0), ("1/16.", 0.375), ("1/64", 0.0625)] {
        let k = p::SYNC_NAMES.iter().position(|n| *n == name).unwrap();
        assert!((p::SYNC_BEATS[k] - beats).abs() < 1e-6, "{name}");
    }
    assert_eq!(p::SYNC_NAMES.len(), p::SYNC_BEATS.len());
    // A free LFO at 1/16T, 120 BPM: a cycle every 1/12 s
    let mut s = Synth::new(SR);
    s.set_tempo(120.0);
    set(&mut s, "LFO 1 mode", 0.0);
    set(&mut s, "LFO 1 rate (sync)", p::SYNC_NAMES.iter().position(|n| *n == "1/16T").unwrap() as f32);
    s.process(100);
    assert!((s.lfo_phase[0] - 100.0 / 4000.0).abs() < 1e-4, "{}", s.lfo_phase[0]);
}

// ---------- sources ----------

#[test]
fn note_random_is_new_each_note_in_range_and_repeats_in_every_render() {
    let run = || {
        let mut s = Synth::new(SR);
        let mut seen = vec![];
        for i in 0..12u8 {
            s.set_position(i as f64 * 0.25);
            s.midi(0x90, 40 + (i % 3), 100);
            // (A key struck again while its last note rings waits 3 ms for its voice)
            grab(&mut s, 3);
            let v = s.voices.iter().filter(|v| v.active && v.note == 40 + (i % 3)).max_by_key(|v| v.age).unwrap();
            seen.push((v.nrand, v.nrand_bi));
            s.midi(0x80, 40 + (i % 3), 0);
        }
        seen
    };
    let a = run();
    assert_eq!(a, run(), "the same in every render");
    assert!(a.iter().all(|&(u, b)| (0.0..=1.0).contains(&u) && (-1.0..=1.0).contains(&b)));
    let distinct = a.iter().map(|x| (x.0 * 1e6) as i64).collect::<std::collections::HashSet<_>>().len();
    assert!(distinct >= 11, "only {distinct} different values");
    let spread = a.iter().map(|x| x.1).fold(f32::MIN, f32::max) - a.iter().map(|x| x.1).fold(f32::MAX, f32::min);
    assert!(spread > 1.0, "bipolar spread {spread}");
}

#[test]
fn chaos_steps_at_its_rate_and_follows_the_song() {
    let levels = |start: f64| {
        let mut s = Synth::new(SR);
        s.set_tempo(120.0);
        set(&mut s, "Chaos rate (sync)", 13.0); // 1/16: 0.125 s at 120
        set(&mut s, "Random repeat", 0.0);
        s.set_position(start);
        let mut out = vec![];
        for _ in 0..(SR as usize / 16) {
            s.process(16);
            out.push(chaos_at(&s.cfg(), s.song_beats));
        }
        out
    };
    let a = levels(4.0);
    // Held across each step, a new level each step: 8 steps a second
    let changes = a.windows(2).filter(|w| w[0] != w[1]).count();
    assert!((7..=8).contains(&changes), "{changes} changes in a second");
    assert_eq!(a, levels(4.0));
    assert_ne!(a, levels(20.0));
}

#[test]
fn random_values_come_round_again_each_cycle() {
    // A riff that repeats each bar gets the same note-random values and chaos at the same places
    let mut s = Synth::new(SR);
    let at = |s: &mut Synth, beats: f64, note: u8| {
        s.set_position(beats);
        s.midi(0x90, note, 100);
        let r = s.note_random(note, &s.cfg());
        s.midi(0x80, note, 0);
        r
    };
    set(&mut s, "Random repeat", 1.0); // 1 bar
    assert_eq!(at(&mut s, 1.5, 40), at(&mut s, 5.5, 40));
    assert_ne!(at(&mut s, 1.5, 40), at(&mut s, 1.75, 40));
    assert_ne!(at(&mut s, 1.5, 40), at(&mut s, 1.5, 41));
    let cfg = s.cfg();
    assert_eq!(chaos_at(&cfg, 2.3), chaos_at(&cfg, 6.3));
    set(&mut s, "Random repeat", 0.0); // never
    assert_ne!(at(&mut s, 1.5, 40), at(&mut s, 5.5, 40));
    let cfg = s.cfg();
    assert_ne!(chaos_at(&cfg, 2.3), chaos_at(&cfg, 6.3));
}

#[test]
fn release_velocity_and_note_pressure_reach_their_note() {
    let mut s = Synth::new(SR);
    s.midi(0x90, 60, 100);
    s.midi(0x90, 64, 100);
    s.midi(0xA0, 64, 90);
    grab(&mut s, 2);
    let v64 = s.voices.iter().find(|v| v.note == 64).unwrap();
    let v60 = s.voices.iter().find(|v| v.note == 60).unwrap();
    assert!((v64.pressure - 90.0 / 127.0).abs() < 1e-6 && v60.pressure == 0.0);
    s.midi(0x80, 60, 64);
    let v60 = s.voices.iter().find(|v| v.note == 60).unwrap();
    assert!((v60.rel_vel - 64.0 / 127.0).abs() < 1e-6);
}

// ---------- the matrix ----------

#[test]
fn matrix_curves_bend_the_source_and_keep_its_ends() {
    for k in 0..4 {
        assert_eq!(curve(k, 0.0), 0.0);
        assert!((curve(k, 1.0) - 1.0).abs() < 1e-6);
        assert!((curve(k, -1.0) + 1.0).abs() < 1e-6);
        assert!((curve(k, -0.3) + curve(k, 0.3)).abs() < 1e-6, "either way alike");
    }
    assert_eq!(curve(0, 0.5), 0.5);
    assert!(curve(1, 0.5) < 0.3, "exponential starts slowly");
    assert!(curve(2, 0.5) > 0.7, "logarithmic starts fast");
    assert!(curve(3, 0.25) < 0.25 && curve(3, 0.75) > 0.75, "S-curve");
}

#[test]
fn every_one_of_the_16_slots_works_and_via_scales_the_amount() {
    let level = |slot: usize, via: Option<(f32, f32)>, vel: u8| {
        let mut s = Synth::new(SR);
        set(&mut s, "Filter type", 0.0);
        set(&mut s, "Cutoff", 100.0);
        set(&mut s, "Key tracking", 0.0);
        set(&mut s, &format!("Mod {slot} source"), 14.0); // Macro 1
        set(&mut s, &format!("Mod {slot} target"), 1.0);
        set(&mut s, &format!("Mod {slot} amount"), 1.0);
        set(&mut s, "Macro 1", 1.0);
        if let Some((src_v, _)) = via {
            set(&mut s, &format!("Mod {slot} via"), src_v);
        }
        s.midi(0x90, 60, vel);
        rms(&grab(&mut s, 100)[0])
    };
    let closed = {
        let mut s = Synth::new(SR);
        set(&mut s, "Filter type", 0.0);
        set(&mut s, "Cutoff", 100.0);
        set(&mut s, "Key tracking", 0.0);
        s.midi(0x90, 60, 100);
        rms(&grab(&mut s, 100)[0])
    };
    for slot in 1..=16 {
        assert!(level(slot, None, 100) > closed * 3.0, "slot {slot}");
    }
    // Via velocity (a note's source): a soft note opens it far less than a hard one
    let (soft, hard) = (level(12, Some((8.0, 0.0)), 10), level(12, Some((8.0, 0.0)), 127));
    assert!(hard > soft * 2.0, "soft {soft}, hard {hard}");
    // Via a macro at 0: nothing moves
    let mut s = Synth::new(SR);
    set(&mut s, "Filter type", 0.0);
    set(&mut s, "Cutoff", 100.0);
    set(&mut s, "Key tracking", 0.0);
    set(&mut s, "Mod 9 source", 8.0);
    set(&mut s, "Mod 9 target", 1.0);
    set(&mut s, "Mod 9 amount", 1.0);
    set(&mut s, "Mod 9 via", 15.0);
    s.midi(0x90, 60, 100);
    let off = rms(&grab(&mut s, 100)[0]);
    assert!((db(off) - db(closed)).abs() < 0.5, "{off} vs {closed}");
}

// ---------- drive ----------

#[test]
fn every_drive_placement_and_mode_stays_finite_level_and_under_the_ceiling() {
    let clean = {
        let mut s = Synth::new(SR);
        for n in [36, 48, 55] {
            s.midi(0x90, n, 110);
        }
        rms(&grab(&mut s, 150)[0])
    };
    let mut report = vec![];
    for placement in ["Pre drive", "Drive", "Band drive"] {
        for kind in 1..p::SHAPERS.len() {
            for amount in [12.0, 36.0] {
                let mut s = Synth::new(SR);
                set(&mut s, &format!("{placement} type"), kind as f32);
                set(&mut s, placement, amount);
                if placement == "Drive" {
                    set(&mut s, "Drive tone", 0.5);
                } else if placement == "Band drive" {
                    set(&mut s, "Band drive tone", 0.5);
                }
                for n in [36, 48, 55] {
                    s.midi(0x90, n, 110);
                }
                let out = grab(&mut s, 150);
                let peak = out[0].iter().chain(out[1].iter()).fold(0.0f32, |m, x| if x.is_finite() { m.max(x.abs()) } else { f32::INFINITY });
                let change = db(rms(&out[0])) - db(clean);
                assert!(peak <= 0.9, "{placement} {} at {amount}: peak {peak}", p::SHAPERS[kind]);
                // (Level-matched: louder by no more than 6 dB, however hard it's driven)
                // (Some get quieter: a fold hit hard is mostly fizz, which the filters take off)
                assert!(change < 6.0 && change > -20.0, "{placement} {} at {amount} dB: {change:+.1} dB", p::SHAPERS[kind]);
                report.push(format!("{placement} {} {amount}: {change:+.1} dB", p::SHAPERS[kind]));
            }
        }
    }
    eprintln!("{}", report.join("\n"));
}

#[test]
fn the_band_drive_keeps_the_lows_clean() {
    // A 55 Hz sine through the band drive at full: still a clean sine (no harmonics to speak of),
    // at its level
    let out = |kind: f32| {
        let mut s = sine_synth();
        set(&mut s, "Band drive type", kind);
        set(&mut s, "Band drive", 36.0);
        s.midi(0x90, 33, 100);
        grab(&mut s, 100);
        grab(&mut s, 375)[0].clone()
    };
    let (dry, wet) = (out(0.0), out(3.0));
    let distortion = |x: &[f32]| {
        // What's left once the 55 Hz sine is fitted out
        let w = 2.0 * std::f64::consts::PI * 55.0 / SR as f64;
        let (mut a, mut b) = (0.0f64, 0.0f64);
        for (i, &v) in x.iter().enumerate() {
            a += v as f64 * (w * i as f64).sin();
            b += v as f64 * (w * i as f64).cos();
        }
        let (a, b) = (2.0 * a / x.len() as f64, 2.0 * b / x.len() as f64);
        let rest: Vec<f32> = x.iter().enumerate().map(|(i, &v)| v - (a * (w * i as f64).sin() + b * (w * i as f64).cos()) as f32).collect();
        db(rms(&rest)) - db(rms(x))
    };
    assert!(distortion(&wet) < -40.0, "the lows were driven: {:.1} dB of distortion", distortion(&wet));
    assert!((db(rms(&wet)) - db(rms(&dry))).abs() < 0.3, "{} vs {}", rms(&wet), rms(&dry));
    // While a bright sound's mids and highs are driven
    let saw = |kind: f32| {
        let mut s = Synth::new(SR);
        set(&mut s, "Band drive type", kind);
        set(&mut s, "Band drive", 30.0);
        s.midi(0x90, 57, 100);
        grab(&mut s, 50);
        grab(&mut s, 100)[0].clone()
    };
    let (a, b) = (saw(0.0), saw(4.0));
    let d: Vec<f32> = a.iter().zip(b.iter()).map(|(x, y)| x - y).collect();
    assert!(db(rms(&d)) - db(rms(&a)) > -10.0, "the mids should change");
}

#[test]
fn the_crushers_crush() {
    let run = |kind: u32, crush: f32| {
        let d = DriveNow::new(kind, 6.0, 1.0, crush);
        let mut st = Drive::default();
        (0..4800).map(|i| st.tick(&d, 0.5 * (i as f32 * 0.013).sin())).collect::<Vec<f32>>()
    };
    let levels = |x: &[f32]| {
        let mut v: Vec<i64> = x.iter().map(|v| (v * 1e6) as i64).collect();
        v.sort();
        v.dedup();
        v.len()
    };
    // Full crush: 2 bits each side of 0
    assert!(levels(&run(p::CRUSH_BITS, 1.0)) <= 9, "{}", levels(&run(p::CRUSH_BITS, 1.0)));
    assert!(levels(&run(p::CRUSH_BITS, 0.0)) > 1000);
    // Downsampling holds each value for many samples
    let x = run(p::CRUSH_RATE, 1.0);
    let held = x.windows(2).filter(|w| w[0] == w[1]).count();
    assert!(held > x.len() * 9 / 10, "{held} held of {}", x.len());
    // Both stay level and inside the range
    for k in [p::CRUSH_BITS, p::CRUSH_RATE] {
        for c in [0.0, 0.5, 1.0] {
            let y = run(k, c);
            assert!(y.iter().all(|v| v.abs() <= 1.0));
            assert!(rms(&y) > 0.15 && rms(&y) < 0.6, "{k} {c}: {}", rms(&y));
        }
    }
}

// ---------- the sub ----------

/// A sub-only patch (oscillators off) with heavy reverb, OTT and drive everywhere.
fn sub_patch(path: f32) -> Synth {
    let mut s = Synth::new(SR);
    set(&mut s, "A on", 0.0);
    set(&mut s, "B on", 0.0);
    set(&mut s, "Sub level", 0.0);
    set(&mut s, "Sub path", path);
    set(&mut s, "Reverb on", 1.0);
    set(&mut s, "Reverb mix", 1.0);
    set(&mut s, "Reverb decay", 8.0);
    set(&mut s, "Chorus on", 1.0);
    set(&mut s, "Chorus mix", 1.0);
    set(&mut s, "OTT", 1.0);
    set(&mut s, "Band drive type", 3.0);
    set(&mut s, "Band drive", 36.0);
    set(&mut s, "Band low split", 60.0);
    set(&mut s, "Drive type", 4.0);
    set(&mut s, "Drive", 36.0);
    set(&mut s, "Amp release", 0.01);
    set(&mut s, "Level", -6.0);
    s
}

#[test]
fn the_clean_sub_is_mixed_after_the_drive_ott_and_effects() {
    // A clean sine an octave under the note, in the middle, with nothing after it
    let mut s = sub_patch(1.0);
    s.midi(0x90, 57, 127);
    grab(&mut s, 100);
    let held = grab(&mut s, 100);
    let side = held[0].iter().zip(held[1].iter()).map(|(l, r)| (l - r).abs()).fold(0.0f32, f32::max);
    assert!(side < 1e-6, "the sub is mono ({side})");
    // Its level is the sub's own (0 dB sub at half scale, Level -6 dB), not the OTT's or the drive's
    let want = 0.5 / 2f32.sqrt() * 10f32.powf(-6.0 / 20.0);
    assert!((rms(&held[0]) - want).abs() / want < 0.02, "{} vs {want}", rms(&held[0]));
    // A pure sine: its second difference matches the sine's own
    let f = 110.0;
    let w = 2.0 * std::f32::consts::PI * f / SR;
    let d2 = held[0].windows(3).map(|x| (x[0] - 2.0 * x[1] + x[2] + w * w * x[1]).abs()).fold(0.0f32, f32::max);
    assert!(d2 < 1e-4, "not a clean sine: {d2}");
    // No reverb tail once it ends
    s.midi(0x80, 57, 0);
    grab(&mut s, 40);
    let tail = rms(&grab(&mut s, 40)[0]);
    assert!(tail < 1e-4, "tail {tail}");
    // The old way (with the voices) goes through them all: a long reverb tail
    let mut old = sub_patch(0.0);
    old.midi(0x90, 57, 100);
    grab(&mut old, 200);
    old.midi(0x80, 57, 0);
    grab(&mut old, 40);
    assert!(rms(&grab(&mut old, 40)[0]) > 1e-3);
}

#[test]
fn a_new_synth_puts_the_sub_after_the_effects_and_an_old_sound_keeps_it_with_the_voices() {
    let s = Synth::new(SR);
    assert!(s.cfg().sub_after);
    let mut old = Synth::new(SR);
    old.legacy(p::COUNT_V1);
    assert!(!old.cfg().sub_after);
    // A sound saved now (every value) is left as it is
    let mut now = Synth::new(SR);
    now.legacy(p::COUNT);
    assert!(now.cfg().sub_after);
}

// ---------- glide and the pitch envelope ----------

#[test]
fn legato_only_glide_skips_notes_after_a_gap() {
    let pitch_after = |mode: f32, joined: bool| {
        let mut s = Synth::new(SR);
        set(&mut s, "Voices", 1.0);
        set(&mut s, "Glide", 0.5);
        set(&mut s, "Glide mode", mode);
        set(&mut s, "Amp release", 1.0);
        s.midi(0x90, 48, 100);
        grab(&mut s, 20);
        if !joined {
            s.midi(0x80, 48, 0);
            grab(&mut s, 2);
        }
        s.midi(0x90, 60, 100);
        grab(&mut s, 2);
        s.voices[0].pitch
    };
    assert!(pitch_after(0.0, false) < 55.0, "always: glides from the last note");
    assert!(pitch_after(1.0, false) > 59.99, "legato only: a note after a gap starts on its pitch");
    assert!(pitch_after(1.0, true) < 55.0, "legato only: joined notes glide");
}

#[test]
fn constant_rate_glides_take_longer_over_a_wider_interval_and_linear_ones_arrive_on_time() {
    let time_to = |interval: u8, rate: f32, linear: f32| {
        let mut s = Synth::new(SR);
        set(&mut s, "Voices", 2.0);
        set(&mut s, "Glide", 0.2);
        set(&mut s, "Glide rate", rate);
        set(&mut s, "Glide curve", linear);
        s.midi(0x90, 48, 100);
        grab(&mut s, 2);
        s.midi(0x90, 48 + interval, 100);
        let mut n = 0;
        while (s.voices[0].pitch - (48 + interval) as f32).abs() > 0.01 && n < 48000 {
            s.process(16);
            n += 16;
        }
        n as f32 / SR
    };
    let (two, twelve) = (time_to(2, 1.0, 1.0), time_to(12, 1.0, 1.0));
    assert!((twelve - 0.2).abs() < 0.01, "an octave at 0.2 s per octave took {twelve}");
    assert!((two - 0.2 / 6.0).abs() < 0.01, "a tone took {two}");
    // Constant time: the same whatever the interval
    let (a, b) = (time_to(2, 0.0, 1.0), time_to(12, 0.0, 1.0));
    assert!((a - 0.2).abs() < 0.01 && (b - 0.2).abs() < 0.01, "{a} {b}");
}

#[test]
fn a_linear_pitch_envelope_dives_to_the_note_in_its_time() {
    // +12 st down to the note over 100 ms: the pitch dive
    let mut s = Synth::new(SR);
    set(&mut s, "Pitch envelope", 12.0);
    set(&mut s, "Pitch decay", 0.1);
    set(&mut s, "Pitch envelope curve", 1.0);
    s.midi(0x90, 48, 100);
    s.process(BLOCK);
    let v = &s.voices[0];
    assert!(v.penv > 0.95, "starts at the top ({})", v.penv);
    let mut n = BLOCK;
    while s.voices[0].penv > 0.0 && n < 48000 {
        s.process(16);
        n += 16;
    }
    let took = n as f32 / SR;
    assert!((took - 0.1).abs() < 0.002, "took {took}");
    // And the mod envelope into pitch through the matrix (the preset-ready way): +12 st at full
    let mut s = Synth::new(SR);
    set(&mut s, "Mod 1 source", 7.0);
    set(&mut s, "Mod 1 target", 5.0);
    set(&mut s, "Mod 1 amount", 1.0);
    s.midi(0x90, 48, 100);
    s.process(64);
    let cfg = s.cfg();
    let mut m = [0.0; NDEST];
    let mut src_now = [0.0; NSRC];
    src_now[src::MENV] = s.voices[0].menv.value;
    route(&cfg, &src_now, &mut m, true);
    assert!(m[d::PITCH] * 12.0 > 10.0, "{} st", m[d::PITCH] * 12.0);
}

// ---------- seeding ----------

#[test]
fn an_unanchored_render_repeats_exactly() {
    let run = || {
        let mut s = Synth::new(SR);
        set(&mut s, "Noise level", -12.0);
        set(&mut s, "LFO 1 shape", 6.0);
        set(&mut s, "LFO 1 target 1", 1.0);
        set(&mut s, "LFO 1 amount 1", 0.5);
        set(&mut s, "Mod 1 source", 19.0);
        set(&mut s, "Mod 1 target", 3.0);
        set(&mut s, "Mod 1 amount", 1.0);
        let mut out = vec![];
        for n in [36u8, 40, 43] {
            s.midi(0x90, n, 100);
            out.extend(grab(&mut s, 30)[0].clone());
            s.midi(0x80, n, 0);
        }
        out
    };
    assert_eq!(run(), run());
}
