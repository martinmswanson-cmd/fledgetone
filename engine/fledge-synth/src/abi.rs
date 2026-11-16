//! Fledge Synth as a plugin: the `Plugin` every host adapter runs, exported here as the interface
//! Fledgetone's plugin host calls (`fledge_wasm::export!`: scripts/plugins/bbplug.h, plus
//! `bb_tempo`, `bb_position`, `bb_legacy`, `bb_settle` and the others listed in fledge-wasm).
//! After those, the synth's own exports, which aren't part of the plugin interface: the user
//! table, a parameter's value in its own units, and the editor's picture of an oscillator.

use crate::params::{param, COUNT};
use crate::presets::PRESETS;
use crate::synth::Synth;
use fledge_plugin::{Block, Info, Plugin};
use fledge_wasm::host;

impl Plugin for Synth {
    fn info() -> Info {
        Info {
            name: "Fledge Synth",
            category: "Synth",
            about: "Fledgetone's own synthesizer for modern electronic music: two wavetable oscillators with up to 16 unison voices, FM, a clean mono sub, filters including comb and formant, antialiased drive before and after the filters and on the mids and highs, LFOs in time with the song or restarting with each note, per-note random and chaos sources, a 16-slot mod matrix and an OTT. Its presets are made for dubstep, bass music and leads, with basses that change with every note.",
            instrument: true,
            sidechain: false,
            tags: &["wavetable", "bass", "dubstep", "lead"],
        }
    }
    fn new(sample_rate: f32) -> Self {
        Synth::new(sample_rate.max(8000.0))
    }
    fn param_count() -> usize {
        COUNT
    }
    fn param_name(i: usize) -> &'static str {
        param(i).name
    }
    fn get(&self, i: usize) -> f32 {
        self.params[i]
    }
    fn set(&mut self, i: usize, value: f32) {
        self.params[i] = value;
    }
    fn param_display(&self, i: usize) -> String {
        param(i).kind.display(self.params[i])
    }
    fn process(&mut self, block: &mut Block) {
        let n = block.frames();
        Synth::process(self, n);
        block.output[0].copy_from_slice(&self.out[0][..n]);
        block.output[1].copy_from_slice(&self.out[1][..n]);
    }
    fn midi(&mut self, status: u8, data1: u8, data2: u8) {
        Synth::midi(self, status, data1, data2);
    }
    fn set_tempo(&mut self, bpm: f32) {
        Synth::set_tempo(self, bpm);
    }
    fn set_position(&mut self, beats: f64) {
        Synth::set_position(self, beats);
    }
    fn legacy(&mut self, count: usize) {
        Synth::legacy(self, count);
    }
    fn settle(&mut self) {
        Synth::settle(self);
    }
    fn program_count() -> usize {
        PRESETS.len()
    }
    fn program_name(i: usize) -> &'static str {
        PRESETS[i].name
    }
    fn set_program(&mut self, i: usize) {
        self.params = PRESETS[i].values();
    }
}

fledge_wasm::export!(Synth);

/// User tables on their way in, by plugin handle (fledge_table_buffer, then fledge_table_set)
static mut STAGING: Vec<(i32, Vec<f32>)> = Vec::new();

#[allow(static_mut_refs)]
fn staging() -> &'static mut Vec<(i32, Vec<f32>)> {
    // One audio thread calls in (the worklet), never two at once
    unsafe { &mut STAGING }
}

/// Room for a user table of `frames` cycles (USER_CYCLE samples each), to be written by the host
/// and then taken in by `fledge_table_set` (not part of the plugin interface). Null for too many.
#[no_mangle]
pub extern "C" fn fledge_table_buffer(h: i32, frames: i32) -> *mut f32 {
    staging().retain(|(k, _)| *k != h);
    if host().plugin::<Synth>(h).is_none() || frames <= 0 || frames as usize > crate::tables::USER_FRAMES_MAX {
        return std::ptr::null_mut();
    }
    staging().push((h, vec![0.0; frames as usize * crate::tables::USER_CYCLE]));
    staging().last_mut().map_or(std::ptr::null_mut(), |(_, v)| v.as_mut_ptr())
}

/// Make the user table from the `frames` cycles written to fledge_table_buffer (0: no user table,
/// "User table" plays "Basic shapes"). 1 if a table is in place now.
#[no_mangle]
pub extern "C" fn fledge_table_set(h: i32, frames: i32) -> i32 {
    let staged = staging().iter().position(|(k, _)| *k == h).map(|i| staging().swap_remove(i).1).unwrap_or_default();
    match host().plugin::<Synth>(h) {
        Some(synth) => {
            let t = if frames > 0 { crate::tables::user_table(&staged, frames as usize) } else { None };
            let ok = t.is_some();
            synth.set_user_table(t);
            ok as i32
        }
        None => 0,
    }
}

/// A parameter's own value (in its units: Hz, dB, a choice's number) as the 0..1 the plugin
/// interface sets (not part of it: the host making a sound by name).
#[no_mangle]
pub extern "C" fn fledge_normal(i: i32, v: f32) -> f32 {
    if i < 0 || i as usize >= COUNT {
        return 0.0;
    }
    param(i as usize).kind.normal(v)
}

static mut WAVE: [f32; 256] = [0.0; 256];
/// The user table the editor's picture draws (one for the page: the picture of the synth on show)
static mut PICTURE: Option<crate::tables::Table> = None;
static mut PICTURE_IN: Vec<f32> = Vec::new();

/// Room for the picture's user table (as fledge_table_buffer, for the main thread's copy).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn fledge_picture_buffer(frames: i32) -> *mut f32 {
    if frames <= 0 || frames as usize > crate::tables::USER_FRAMES_MAX {
        return std::ptr::null_mut();
    }
    unsafe {
        PICTURE_IN = vec![0.0; frames as usize * crate::tables::USER_CYCLE];
        PICTURE_IN.as_mut_ptr()
    }
}

/// Take in the picture's user table (0 frames: none).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn fledge_picture_set(frames: i32) -> i32 {
    unsafe {
        PICTURE = if frames > 0 { crate::tables::user_table(&PICTURE_IN, frames as usize) } else { None };
        PICTURE_IN = Vec::new();
        PICTURE.is_some() as i32
    }
}

/// One cycle of `table` at `pos` (0..1) under `warp` at `amount`, as 256 samples (for the
/// editor's picture of the oscillator; not part of the plugin interface).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn fledge_wave(table: i32, pos: f32, warp: i32, amount: f32) -> *const f32 {
    let i = table.max(0) as usize;
    // (The user table: the picture's, as fledge_picture_set took it in; else Basic shapes, as it plays)
    let t = if i == crate::params::USER_TABLE {
        unsafe { PICTURE.as_ref() }.unwrap_or_else(|| crate::tables::table(0))
    } else {
        crate::tables::table(i.min(crate::params::USER_TABLE - 1))
    };
    let (w, a) = (warp.max(0) as u32, amount.clamp(0.0, 1.0));
    #[allow(static_mut_refs)]
    let out = unsafe { &mut WAVE };
    for (i, x) in out.iter_mut().enumerate() {
        let ph = crate::synth::warp_phase(w, a, i as f32 / 256.0);
        // (The ring warp is drawn against a sine an octave up)
        let other = (4.0 * std::f32::consts::PI * i as f32 / 256.0).sin();
        *x = crate::synth::warp_amp(w, a, t.read(4, pos, ph), other);
    }
    out.as_ptr()
}
