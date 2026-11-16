use super::*;

const SR: f32 = 48000.0;
/// A 16th note at 120 BPM, in samples
const SIXTEENTH: usize = 6000;

fn with(sets: &[(usize, f32)]) -> Repeat {
    let mut r = Repeat::new(SR);
    for &(i, x) in sets {
        r.set(i, normal(i, x));
    }
    r
}

/// A sound whose every sample says where it is: a slow ramp with a fast wave on it.
fn sound(n: usize) -> Vec<f32> {
    (0..n).map(|i| 0.3 * (i as f32 * 0.01).sin() + 0.2 * ((i % 977) as f32 / 977.0 - 0.5)).collect()
}

fn run(r: &mut Repeat, x: &[f32], size: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for chunk in x.chunks(size) {
        let (mut l, mut rr) = (vec![0.0; chunk.len()], vec![0.0; chunk.len()]);
        r.process(&mut Block { input: [chunk, chunk], sidechain: None, output: [&mut l, &mut rr] });
        assert!(l.iter().all(|v| v.is_finite()));
        assert_eq!(l, rr);
        out.extend(l);
    }
    out
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

#[test]
fn values_and_their_settings_go_both_ways() {
    for (i, n) in [(EVERY, EVERY_BARS.len()), (FOR, FOR_BEATS.len()), (SLICE, SLICE_BEATS.len())] {
        for k in 0..n {
            assert_eq!(value(i, normal(i, k as f32)), k as f32, "parameter {i} choice {k}");
        }
    }
    for st in [-12.0, -1.0, 0.0, 5.0, 12.0] {
        assert_eq!(value(PITCH, normal(PITCH, st)), st);
    }
    assert!((value(GATE, normal(GATE, 0.5)) - 0.5).abs() < 1e-6);
    let r = Repeat::new(SR);
    let shown: Vec<String> = (0..COUNT).map(|i| r.param_display(i)).collect();
    assert_eq!(shown, ["Off", "Off", "1/4", "1/16", "100 %", "0 %", "0 st", "100 %", "100 %"]);
    assert_eq!(with(&[(EVERY, 3.0), (FOR, 3.0), (SLICE, 4.0), (PITCH, -3.0)]).param_display(SLICE), "1/16T");
}

#[test]
fn off_it_is_the_track_untouched() {
    let x = sound(24000);
    assert_eq!(run(&mut Repeat::new(SR), &x, 128), x);
}

#[test]
fn switched_on_it_plays_the_next_slice_again_and_again() {
    let x = sound(6 * SIXTEENTH);
    let mut r = Repeat::new(SR);
    r.set(REPEAT, 1.0);
    let out = run(&mut r, &x, 128);
    assert!(r.is_on());
    // The first slice is the track as it comes
    assert_eq!(out[..SIXTEENTH], x[..SIXTEENTH]);
    // Every slice after it is that first slice again (but for the 2 ms faded at each end)
    for k in 1..6 {
        for i in (200..SIXTEENTH - 200).step_by(97) {
            assert!((out[k * SIXTEENTH + i] - x[i]).abs() < 1e-5, "repeat {k} at {i}");
        }
        // ...and each ends at nothing and the next starts from nothing, so none clicks (the first
        // repeat comes in under the track fading out)
        assert!(out[(k + 1) * SIXTEENTH - 1].abs() < 0.02);
        assert!(k < 2 || out[k * SIXTEENTH].abs() < 1e-3);
    }
    // Switched off, the track is back within a few milliseconds
    r.set(REPEAT, 0.0);
    let after = run(&mut r, &x[..2400], 128);
    assert!(!r.is_on());
    assert_eq!(after[400..], x[400..2400]);
}

#[test]
fn the_slice_follows_the_tempo_and_the_setting() {
    // 8ths at 150 BPM: 0.2 s, 9600 samples
    let mut r = with(&[(SLICE, 1.0)]);
    r.set_tempo(150.0);
    r.set(REPEAT, 1.0);
    let x = sound(4 * 9600);
    let out = run(&mut r, &x, 128);
    for i in (300..9300).step_by(131) {
        assert!((out[2 * 9600 + i] - x[i]).abs() < 1e-5);
    }
}

#[test]
fn gate_decay_and_mix() {
    let x = sound(5 * SIXTEENTH);
    // Half a gate: the second half of each repeat is silent
    let mut r = with(&[(GATE, 0.5)]);
    r.set(REPEAT, 1.0);
    let out = run(&mut r, &x, 128);
    assert!(rms(&out[SIXTEENTH + 200..SIXTEENTH + 2800]) > 0.05);
    assert!(out[SIXTEENTH + 3100..2 * SIXTEENTH].iter().all(|v| *v == 0.0));
    // Decay 50 %: the first repeat is whole, the next half as loud, the next a quarter
    let mut r = with(&[(DECAY, 0.5)]);
    r.set(REPEAT, 1.0);
    let out = run(&mut r, &x, 128);
    for (k, gain) in [(1, 1.0f32), (2, 0.5), (3, 0.25)] {
        for i in (300..5700).step_by(211) {
            assert!((out[k * SIXTEENTH + i] - x[i] * gain).abs() < 1e-5, "repeat {k}");
        }
    }
    // Mix 50 %: half the track, half the repeats
    let mut r = with(&[(MIX, 0.5)]);
    r.set(REPEAT, 1.0);
    let out = run(&mut r, &x, 128);
    for i in (300..5700).step_by(211) {
        let at = 2 * SIXTEENTH + i;
        assert!((out[at] - 0.5 * (x[at] + x[i])).abs() < 1e-5);
    }
}

#[test]
fn pitch_plays_each_repeat_faster_or_slower_than_the_last() {
    // A plain tone, so its pitch can be read by counting its turns
    let x: Vec<f32> = (0..5 * SIXTEENTH).map(|i| (std::f32::consts::TAU * 400.0 * i as f32 / SR).sin()).collect();
    let turns = |s: &[f32]| s.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32;
    for (st, first, second) in [(12.0, 2.0, 4.0), (-12.0, 0.5, 0.25)] {
        let mut r = with(&[(PITCH, st)]);
        r.set(REPEAT, 1.0);
        let out = run(&mut r, &x, 128);
        let base = turns(&x[200..2600]);
        // (A repeat played faster runs out of kept sound sooner: its first part is read)
        let one = turns(&out[SIXTEENTH + 200..SIXTEENTH + 2600]);
        let two = turns(&out[2 * SIXTEENTH + 200..2 * SIXTEENTH + 2600]);
        assert!((one / base - first).abs() < 0.12 * first, "{st} st: the first repeat at {} times", one / base);
        assert!((two / base - second).abs() < 0.15 * second, "{st} st: the second at {} times", two / base);
    }
}

/// Play `bars` bars from the song's start at 120 BPM (a bar is 96000 samples), telling it the
/// position on every beat as the host does; the output.
fn play(r: &mut Repeat, x: &[f32], size: usize) -> Vec<f32> {
    let beat = 24000;
    let mut out = Vec::new();
    for (b, chunk) in x.chunks(beat).enumerate() {
        r.set_tempo(120.0);
        r.set_position(b as f64);
        out.extend(run(r, chunk, size));
    }
    out
}

#[test]
fn by_itself_it_fills_the_end_of_every_few_bars() {
    // Every 2 bars, for the last quarter note: 16ths
    let x = sound(4 * 96000);
    let out = play(&mut with(&[(EVERY, 2.0), (FOR, 1.0)]), &x, 128);
    let changed = |from: usize, to: usize| (from..to).step_by(53).filter(|&i| (out[i] - x[i]).abs() > 1e-4).count();
    // Nothing touched outside the fills (the last beat of bars 2 and 4)
    assert_eq!(changed(0, 7 * 24000), 0);
    assert_eq!(changed(8 * 24000, 15 * 24000), 0);
    // The beat after a fill is the track from its very first sample (its attack isn't faded in)
    assert_eq!(out[8 * 24000..8 * 24000 + 300], x[8 * 24000..8 * 24000 + 300]);
    // In a fill: the first 16th as it comes, then that 16th three more times
    for fill in [7 * 24000, 15 * 24000] {
        assert_eq!(out[fill..fill + SIXTEENTH], x[fill..fill + SIXTEENTH]);
        for k in 1..4 {
            for i in (200..5800).step_by(173) {
                assert!((out[fill + k * SIXTEENTH + i] - x[fill + i]).abs() < 1e-5, "repeat {k} of the fill at {fill}");
            }
        }
    }
    // Told where the song is only once, it counts the beats itself and still ends each fill on
    // the bar line to the sample (the next beat untouched from its first sample)
    let mut r = with(&[(EVERY, 1.0), (FOR, 1.0)]);
    r.set_tempo(120.0);
    r.set_position(0.0);
    let alone = run(&mut r, &x, 128);
    for bar in 1..4 {
        assert_eq!(alone[bar * 96000..bar * 96000 + 1000], x[bar * 96000..bar * 96000 + 1000], "bar {}", bar + 1);
        assert_ne!(alone[bar * 96000 - 6000..bar * 96000 - 5000], x[bar * 96000 - 6000..bar * 96000 - 5000]);
    }
    // The song stops mid-fill: the fill ends, and nothing more plays by itself until it starts again
    let mut r = with(&[(EVERY, 1.0), (FOR, 1.0)]);
    r.set_position(3.0);
    run(&mut r, &x[..12000], 128);
    assert!(r.is_on());
    r.set_position(-1.0);
    assert_eq!(run(&mut r, &x[..96000], 128)[400..], x[400..96000]);
    // With no position from the host (the song stopped, never played) it does nothing by itself
    assert_eq!(run(&mut with(&[(EVERY, 1.0)]), &x[..96000], 128), x[..96000]);
}

#[test]
fn chance_picks_the_same_fills_every_time() {
    let x = sound(16 * 96000);
    let fills = |chance: f32| {
        let out = play(&mut with(&[(EVERY, 1.0), (FOR, 1.0), (CHANCE, chance)]), &x, 128);
        (0..16).filter(|bar| (bar * 96000 + 3 * 24000 + SIXTEENTH + 500..bar * 96000 + 4 * 24000).step_by(101).any(|i| (out[i] - x[i]).abs() > 1e-4)).collect::<Vec<usize>>()
    };
    assert_eq!(fills(1.0).len(), 16);
    assert_eq!(fills(0.0).len(), 0);
    let half = fills(0.5);
    assert!(half.len() >= 4 && half.len() <= 12, "{} of 16", half.len());
    assert_eq!(half, fills(0.5));
    // More chance never takes a fill away
    assert!(half.iter().all(|b| fills(0.8).contains(b)));
    assert!((0..1000).filter(|n| takes_its_chance(*n, 0.3)).count().abs_diff(300) < 60);
}

#[test]
fn the_same_whatever_the_block_size_and_through_a_jump_in_the_song() {
    let x = sound(2 * 96000);
    let render = |size: usize| play(&mut with(&[(EVERY, 1.0), (FOR, 2.0), (SLICE, 5.0), (DECAY, 0.2), (PITCH, -2.0), (GATE, 0.7)]), &x, size);
    let whole = render(128);
    assert!(whole == render(128) && whole == render(1) && whole == render(37));
    // The song jumps back mid-fill (a loop): the fill ends, and the track comes back
    let mut r = with(&[(EVERY, 1.0), (FOR, 1.0)]);
    r.set_position(3.0);
    run(&mut r, &x[..12000], 128);
    assert!(r.is_on());
    r.set_position(0.0);
    let after = run(&mut r, &x[..4800], 128);
    assert!(!r.is_on());
    assert_eq!(after[400..], x[400..4800]);
}

#[test]
fn presets_play_and_a_slow_tempo_fits() {
    for (i, (name, values)) in presets().iter().enumerate() {
        assert!(!name.is_empty() && values.iter().all(|v| (0.0..=1.0).contains(v)), "{name}");
        let mut r = Repeat::new(SR);
        r.set_program(i);
        assert_eq!(&r.params, values);
        assert_eq!(Repeat::program_name(i), *name);
        let out = play(&mut r, &sound(8 * 96000), 128);
        assert!(rms(&out) > 0.05, "{name}");
    }
    // Quarter notes at 20 BPM (kept as 30): longer than anything else it's asked for
    let mut r = with(&[(SLICE, 0.0)]);
    r.set_tempo(20.0);
    r.set(REPEAT, 1.0);
    let x = sound(6 * 96000);
    let out = run(&mut r, &x, 128);
    for i in (500..90000).step_by(997) {
        assert!((out[96000 + i] - x[i]).abs() < 1e-5);
    }
}
