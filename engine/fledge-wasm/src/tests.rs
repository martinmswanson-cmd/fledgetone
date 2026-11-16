//! The adapter driven as the plugin host drives it, on two small plugins.

use super::*;
use std::ffi::CStr;

/// An instrument: a sine per held note, with a level and two presets
struct Beep {
    sr: f32,
    level: f32,
    note: Option<u8>,
    phase: f32,
    tempo: f32,
}

impl Plugin for Beep {
    fn info() -> Info {
        Info { name: "Beep", category: "Synth", about: "A \"sine\"\nper note.", instrument: true, sidechain: false, tags: &["sine", "test"] }
    }
    fn new(sample_rate: f32) -> Self {
        Beep { sr: sample_rate, level: 0.5, note: None, phase: 0.0, tempo: 120.0 }
    }
    fn param_count() -> usize {
        1
    }
    fn param_name(_i: usize) -> &'static str {
        "Level"
    }
    fn get(&self, _i: usize) -> f32 {
        self.level
    }
    fn set(&mut self, _i: usize, value: f32) {
        self.level = value;
    }
    fn param_display(&self, _i: usize) -> String {
        format!("{:.1} dB", 20.0 * self.level.max(1e-6).log10())
    }
    fn process(&mut self, block: &mut Block) {
        for i in 0..block.frames() {
            let x = match self.note {
                Some(n) => {
                    self.phase = (self.phase + 440.0 * 2f32.powf((n as f32 - 69.0) / 12.0) / self.sr).fract();
                    (self.phase * std::f32::consts::TAU).sin() * self.level
                }
                None => 0.0,
            };
            block.output[0][i] = x;
            block.output[1][i] = x;
        }
    }
    fn midi(&mut self, status: u8, d1: u8, d2: u8) {
        match status & 0xf0 {
            0x90 if d2 > 0 => self.note = Some(d1),
            0x80 | 0x90 => self.note = None,
            _ => {}
        }
    }
    fn set_tempo(&mut self, bpm: f32) {
        self.tempo = bpm;
    }
    fn program_count() -> usize {
        2
    }
    fn program_name(i: usize) -> &'static str {
        ["Soft", "Loud"][i]
    }
    fn set_program(&mut self, i: usize) {
        self.level = [0.1, 0.9][i];
    }
}

/// An effect that listens to a sidechain: it turns its input down by the sidechain's level (by
/// its own input's when nothing is connected)
struct Duck {
    amount: f32,
}

impl Plugin for Duck {
    fn info() -> Info {
        Info { name: "Duck", category: "Dynamics", about: "Ducks under the sidechain.", instrument: false, sidechain: true, tags: &[] }
    }
    fn new(_sample_rate: f32) -> Self {
        Duck { amount: 1.0 }
    }
    fn param_count() -> usize {
        1
    }
    fn param_name(_i: usize) -> &'static str {
        "Amount"
    }
    fn get(&self, _i: usize) -> f32 {
        self.amount
    }
    fn set(&mut self, _i: usize, value: f32) {
        self.amount = value;
    }
    fn process(&mut self, block: &mut Block) {
        for ch in 0..2 {
            let key = block.sidechain.map_or(block.input[ch], |s| s[ch]);
            for i in 0..block.frames() {
                block.output[ch][i] = block.input[ch][i] * (1.0 - self.amount * key[i].abs().min(1.0));
            }
        }
    }
}

static FAMILY: &[Entry] = &[Entry::of::<Beep>(), Entry::of::<Duck>()];

fn text(p: *const c_char) -> String {
    assert!(!p.is_null());
    unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_string()
}

fn buffer(host: &mut Host, h: i32, which: i32) -> &'static mut [f32] {
    unsafe { std::slice::from_raw_parts_mut(host.buffer(h, which), BLOCK) }
}

#[test]
fn a_family_describes_its_plugins() {
    let mut host = Host::new();
    assert_eq!(text(host.info(FAMILY, 0)), r#"{"name":"Beep","category":"Synth","about":"A \"sine\"\nper note.","instrument":true,"params":1,"tags":["sine","test"]}"#);
    assert_eq!(text(host.info(FAMILY, 1)), r#"{"name":"Duck","category":"Dynamics","about":"Ducks under the sidechain.","instrument":false,"params":1,"sidechain":true,"tags":[]}"#);
    assert!(host.info(FAMILY, 2).is_null() && host.info(FAMILY, -1).is_null());
    assert_eq!(host.create(FAMILY, 2, 48000.0), 0);
}

#[test]
fn handles_are_reused_and_a_gone_plugin_answers_nothing() {
    let mut host = Host::new();
    let (a, b) = (host.create(FAMILY, 0, 48000.0), host.create(FAMILY, 1, 48000.0));
    assert_eq!((a, b), (1, 2));
    host.destroy(a);
    assert_eq!(host.params(a), 0);
    assert_eq!(host.param(a, 0), 0.0);
    assert!(host.buffer(a, 2).is_null() && host.param_name(a, 0).is_null());
    host.process(a, 128);
    host.set_param(a, 0, 1.0);
    assert_eq!(host.create(FAMILY, 0, 48000.0), 1);
    for h in [0, -1, 99, i32::MIN] {
        assert_eq!(host.params(h), 0);
        host.destroy(h);
    }
}

#[test]
fn parameters_are_kept_to_0_to_1_and_named() {
    let mut host = Host::new();
    let h = host.create(FAMILY, 0, 48000.0);
    assert_eq!(host.params(h), 1);
    assert_eq!(host.param(h, 0), 0.5);
    host.set_param(h, 0, 7.0);
    assert_eq!(host.param(h, 0), 1.0);
    host.set_param(h, 0, f32::NAN);
    host.set_param(h, 5, 0.2);
    host.set_param(h, -1, 0.2);
    assert_eq!(host.param(h, 0), 1.0);
    assert_eq!(host.param(h, 5), 0.0);
    assert_eq!(text(host.param_name(h, 0)), "Level");
    assert_eq!(text(host.param_display(h, 0)), "0.0 dB");
    assert!(host.param_name(h, 1).is_null() && host.param_display(h, -1).is_null());
}

#[test]
fn an_instrument_plays_its_notes_into_the_output() {
    let mut host = Host::new();
    let h = host.create(FAMILY, 0, 48000.0);
    host.process(h, 128);
    assert!(buffer(&mut host, h, 2).iter().all(|x| *x == 0.0));
    host.midi(h, 0x90, 69, 100);
    host.process(h, 64);
    let (l, r) = (buffer(&mut host, h, 2).to_vec(), buffer(&mut host, h, 3).to_vec());
    assert!(l[..64].iter().any(|x| x.abs() > 0.2) && l[..64] == r[..64]);
    // Only the frames asked for are written, and never more than a block
    assert!(l[64..].iter().all(|x| *x == 0.0));
    host.process(h, 100000);
    host.process(h, -5);
    host.midi(h, 0x80, 69, 0);
    host.process(h, 128);
    assert!(buffer(&mut host, h, 2).iter().all(|x| *x == 0.0));
    host.tempo(h, 90.0);
    assert_eq!(host.plugin::<Beep>(h).map(|b| b.tempo), Some(90.0));
    assert!(host.plugin::<Duck>(h).is_none());
}

#[test]
fn presets_are_chosen_by_number() {
    let mut host = Host::new();
    let h = host.create(FAMILY, 0, 48000.0);
    assert_eq!((host.programs(h), host.program(h)), (2, -1));
    assert_eq!(text(host.program_name(h, 1)), "Loud");
    host.set_program(h, 1);
    assert_eq!((host.program(h), host.param(h, 0)), (1, 0.9));
    host.set_program(h, 2);
    host.set_program(h, -1);
    assert_eq!((host.program(h), host.param(h, 0)), (1, 0.9));
    assert!(host.program_name(h, 2).is_null());
    let d = host.create(FAMILY, 1, 48000.0);
    assert_eq!(host.programs(d), 0);
}

#[test]
fn a_sidechain_is_heard_only_while_connected() {
    let mut host = Host::new();
    let (beep, duck) = (host.create(FAMILY, 0, 48000.0), host.create(FAMILY, 1, 48000.0));
    // An instrument doesn't listen to one
    assert_eq!(host.sidechain(beep, 1), 0);
    buffer(&mut host, duck, 0).fill(0.5);
    buffer(&mut host, duck, 1).fill(0.5);
    // Nothing connected: it follows its own input, whatever is left in the sidechain's buffers
    buffer(&mut host, duck, 4).fill(1.0);
    host.process(duck, 128);
    assert!(buffer(&mut host, duck, 2).iter().all(|x| *x == 0.25));
    assert_eq!(host.sidechain(duck, 1), 1);
    buffer(&mut host, duck, 4).fill(1.0);
    buffer(&mut host, duck, 5).fill(0.0);
    host.process(duck, 128);
    assert!(buffer(&mut host, duck, 2).iter().all(|x| *x == 0.0) && buffer(&mut host, duck, 3).iter().all(|x| *x == 0.5));
    // Taken away again: its buffers are cleared
    assert_eq!(host.sidechain(duck, 0), 1);
    assert!(buffer(&mut host, duck, 4).iter().all(|x| *x == 0.0));
    host.process(duck, 128);
    assert!(buffer(&mut host, duck, 2).iter().all(|x| *x == 0.25));
}

#[test]
fn a_state_goes_out_and_comes_back_through_the_modules_memory() {
    let mut host = Host::new();
    let a = host.create(FAMILY, 0, 48000.0);
    host.set_param(a, 0, 0.3);
    let p = host.state(a);
    let n = host.state_bytes(a);
    assert_eq!(n, 4);
    let saved = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
    let b = host.create(FAMILY, 0, 48000.0);
    let space = host.alloc(n);
    unsafe { std::slice::from_raw_parts_mut(space, n as usize) }.copy_from_slice(&saved);
    assert_eq!(host.load(b, space, n), 1);
    assert_eq!(host.param(b, 0), 0.3);
    // Not from alloc, longer than what was asked for, or freed already: refused
    assert_eq!(host.load(b, saved.as_ptr(), n), 0);
    assert_eq!(host.load(b, space, n + 1), 0);
    host.free(space);
    assert_eq!(host.load(b, space, n), 0);
    assert!(host.alloc(0).is_null() && host.alloc(-4).is_null());
    assert_eq!((host.state_bytes(99), host.load(99, space, 0)), (0, 0));
}
