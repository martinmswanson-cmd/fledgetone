//! The interface Fledgetone's plugin host calls (scripts/plugins/bbplug.h): plain C functions
//! over handles, parameters as 0..1, buffers in this module's memory. Plus three that hosts
//! may call: `bb_tempo` (the song's tempo, for tempo-synced LFOs; else 120), `bb_position`
//! (where in the song it is, in beats: free LFOs, chaos and random values follow the song, so
//! live playback and an export match) and `bb_legacy` (an older saved sound with fewer values
//! was just loaded: the parameters it didn't have are set as it sounded then).

use crate::params::{param, COUNT};
use crate::presets::PRESETS;
use crate::synth::Synth;
use std::ffi::{c_char, CString};

struct Instance {
    synth: Synth,
    program: i32,
    /// Texts handed out (kept until the next call asks for another)
    text: CString,
}

static mut INSTANCES: Vec<Option<Box<Instance>>> = Vec::new();
static mut INFO: Option<CString> = None;

#[allow(static_mut_refs)]
fn instances() -> &'static mut Vec<Option<Box<Instance>>> {
    // One audio thread calls in (the worklet), never two at once
    unsafe { &mut INSTANCES }
}

fn get(h: i32) -> Option<&'static mut Instance> {
    instances().get_mut((h - 1) as usize).and_then(|x| x.as_deref_mut())
}

fn hand(inst: &mut Instance, s: String) -> *const c_char {
    inst.text = CString::new(s.replace('\0', "")).unwrap_or_default();
    inst.text.as_ptr()
}

#[no_mangle]
pub extern "C" fn bb_count() -> i32 {
    1
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn bb_info(_index: i32) -> *const c_char {
    let json = format!(
        "{{\"name\":\"Fledge Synth\",\"category\":\"Synth\",\"about\":\"Fledgetone's own synthesizer for modern electronic music: two wavetable oscillators with up to 16 unison voices, FM, a clean mono sub, filters including comb and formant, antialiased drive before and after the filters and on the mids and highs, LFOs in time with the song or restarting with each note, per-note random and chaos sources, a 16-slot mod matrix and an OTT. Its presets are made for dubstep, bass music and leads, with basses that change with every note.\",\"instrument\":true,\"params\":{},\"tags\":[\"wavetable\",\"bass\",\"dubstep\",\"lead\"]}}",
        COUNT
    );
    unsafe {
        INFO = CString::new(json).ok();
        INFO.as_ref().map_or(std::ptr::null(), |c| c.as_ptr())
    }
}

#[no_mangle]
pub extern "C" fn bb_create(_index: i32, sample_rate: f32) -> i32 {
    let inst = Box::new(Instance { synth: Synth::new(sample_rate.max(8000.0)), program: -1, text: CString::default() });
    let list = instances();
    if let Some(i) = list.iter().position(|x| x.is_none()) {
        list[i] = Some(inst);
        return i as i32 + 1;
    }
    list.push(Some(inst));
    list.len() as i32
}

#[no_mangle]
pub extern "C" fn bb_destroy(h: i32) {
    if let Some(slot) = instances().get_mut((h - 1) as usize) {
        *slot = None;
    }
}

#[no_mangle]
pub extern "C" fn bb_params(_h: i32) -> i32 {
    COUNT as i32
}

#[no_mangle]
pub extern "C" fn bb_get(h: i32, i: i32) -> f32 {
    get(h).and_then(|x| x.synth.params.get(i as usize).copied()).unwrap_or(0.0)
}

#[no_mangle]
pub extern "C" fn bb_set(h: i32, i: i32, v: f32) {
    if let Some(x) = get(h) {
        if let Some(p) = x.synth.params.get_mut(i as usize) {
            if v.is_finite() {
                *p = v.clamp(0.0, 1.0);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn bb_param_name(h: i32, i: i32) -> *const c_char {
    match get(h) {
        Some(x) if (i as usize) < COUNT => hand(x, param(i as usize).name.to_string()),
        _ => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn bb_param_display(h: i32, i: i32) -> *const c_char {
    match get(h) {
        Some(x) if (i as usize) < COUNT => {
            let s = param(i as usize).kind.display(x.synth.params[i as usize]);
            hand(x, s)
        }
        _ => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn bb_buffer(h: i32, which: i32) -> *mut f32 {
    match get(h) {
        Some(x) => match which {
            0 => x.synth.input[0].as_mut_ptr(),
            1 => x.synth.input[1].as_mut_ptr(),
            2 => x.synth.out[0].as_mut_ptr(),
            _ => x.synth.out[1].as_mut_ptr(),
        },
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn bb_process(h: i32, frames: i32) {
    if let Some(x) = get(h) {
        x.synth.process(frames.max(0) as usize);
    }
}

#[no_mangle]
pub extern "C" fn bb_midi(h: i32, status: i32, d1: i32, d2: i32) {
    if let Some(x) = get(h) {
        x.synth.midi(status as u8, (d1 & 0x7f) as u8, (d2 & 0x7f) as u8);
    }
}

#[no_mangle]
pub extern "C" fn bb_tempo(h: i32, bpm: f32) {
    if let Some(x) = get(h) {
        x.synth.set_tempo(bpm);
    }
}

#[no_mangle]
pub extern "C" fn bb_position(h: i32, beats: f64) {
    if let Some(x) = get(h) {
        x.synth.set_position(beats);
    }
}

#[no_mangle]
pub extern "C" fn bb_legacy(h: i32, count: i32) {
    if let Some(x) = get(h) {
        x.synth.legacy(count.max(0) as usize);
    }
}

#[no_mangle]
pub extern "C" fn bb_programs(_h: i32) -> i32 {
    PRESETS.len() as i32
}

#[no_mangle]
pub extern "C" fn bb_program_name(h: i32, i: i32) -> *const c_char {
    match (get(h), PRESETS.get(i as usize)) {
        (Some(x), Some(p)) => hand(x, p.name.to_string()),
        _ => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn bb_set_program(h: i32, i: i32) {
    if let (Some(x), Some(p)) = (get(h), PRESETS.get(i as usize)) {
        x.synth.params = p.values();
        x.program = i;
    }
}

#[no_mangle]
pub extern "C" fn bb_get_program(h: i32) -> i32 {
    get(h).map_or(-1, |x| x.program)
}

static mut WAVE: [f32; 256] = [0.0; 256];

/// One cycle of `table` at `pos` (0..1) under `warp` at `amount`, as 256 samples (for the
/// editor's picture of the oscillator; not part of the plugin interface).
#[no_mangle]
pub extern "C" fn fledge_wave(table: i32, pos: f32, warp: i32, amount: f32) -> *const f32 {
    let t = crate::tables::table((table.max(0) as usize).min(crate::params::TABLES.len() - 1));
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
