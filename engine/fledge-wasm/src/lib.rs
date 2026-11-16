//! Turns any `fledge_plugin::Plugin` into the WebAssembly module Fledgetone's plugin host loads:
//! the `bb_*` interface of scripts/plugins/bbplug.h (plain C functions over handles, parameters
//! as 0..1, buffers in the module's own memory).
//!
//! A module is a "family" of one or more plugins. In the plugin's crate (built as a `cdylib`):
//!
//! ```ignore
//! fledge_wasm::export!(MySynth, MyEffect);
//! ```
//!
//! That exports everything in bbplug.h, and these, which a host may call if they're there:
//!
//! - `bb_tempo(h, bpm)` and `bb_position(h, beats)`: the song's tempo and where it is;
//! - `bb_legacy(h, count)`: an older saved sound with `count` values was just loaded;
//! - `bb_settle(h)`: the whole sound was just switched with the output faded out;
//! - `bb_sidechain(h, connected)`: whether a sidechain is connected now (its sound goes in
//!   buffers 4 and 5 before each `bb_process`); returns 1 if the plugin listens to one;
//! - `bb_state(h)` and `bb_state_bytes(h)`: the plugin's state (where it is, and how long), to
//!   hand back through `bb_alloc` and `bb_load`.
//!
//! The same code runs natively (the tests below drive a `Host` directly).

use fledge_plugin::{Block, Info, Plugin, BLOCK};
use std::any::Any;
use std::ffi::{c_char, CString};

/// A plugin behind a handle, whatever its type.
trait Slot {
    fn param_count(&self) -> usize;
    fn param_name(&self, i: usize) -> &'static str;
    fn param_display(&self, i: usize) -> String;
    fn get(&self, i: usize) -> f32;
    fn set(&mut self, i: usize, v: f32);
    fn process(&mut self, block: &mut Block);
    fn midi(&mut self, status: u8, d1: u8, d2: u8);
    fn set_tempo(&mut self, bpm: f32);
    fn set_position(&mut self, beats: f64);
    fn legacy(&mut self, count: usize);
    fn settle(&mut self);
    fn program_count(&self) -> usize;
    fn program_name(&self, i: usize) -> &'static str;
    fn set_program(&mut self, i: usize);
    fn save(&self) -> Vec<u8>;
    fn load(&mut self, state: &[u8]) -> bool;
    fn sidechain(&self) -> bool;
    fn any_mut(&mut self) -> &mut dyn Any;
}

impl<P: Plugin> Slot for P {
    fn param_count(&self) -> usize {
        P::param_count()
    }
    fn param_name(&self, i: usize) -> &'static str {
        P::param_name(i)
    }
    fn param_display(&self, i: usize) -> String {
        Plugin::param_display(self, i)
    }
    fn get(&self, i: usize) -> f32 {
        Plugin::get(self, i)
    }
    fn set(&mut self, i: usize, v: f32) {
        Plugin::set(self, i, v)
    }
    fn process(&mut self, block: &mut Block) {
        Plugin::process(self, block)
    }
    fn midi(&mut self, status: u8, d1: u8, d2: u8) {
        Plugin::midi(self, status, d1, d2)
    }
    fn set_tempo(&mut self, bpm: f32) {
        Plugin::set_tempo(self, bpm)
    }
    fn set_position(&mut self, beats: f64) {
        Plugin::set_position(self, beats)
    }
    fn legacy(&mut self, count: usize) {
        Plugin::legacy(self, count)
    }
    fn settle(&mut self) {
        Plugin::settle(self)
    }
    fn program_count(&self) -> usize {
        P::program_count()
    }
    fn program_name(&self, i: usize) -> &'static str {
        P::program_name(i)
    }
    fn set_program(&mut self, i: usize) {
        Plugin::set_program(self, i)
    }
    fn save(&self) -> Vec<u8> {
        Plugin::save(self)
    }
    fn load(&mut self, state: &[u8]) -> bool {
        Plugin::load(self, state)
    }
    fn sidechain(&self) -> bool {
        P::info().sidechain
    }
    fn any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

fn make<P: Plugin>(sample_rate: f32) -> Box<dyn Slot> {
    Box::new(P::new(sample_rate))
}

/// One plugin of a family, as `export!` lists it.
pub struct Entry {
    info: fn() -> Info,
    param_count: fn() -> usize,
    make: fn(f32) -> Box<dyn Slot>,
}

impl Entry {
    pub const fn of<P: Plugin>() -> Entry {
        Entry { info: P::info, param_count: P::param_count, make: make::<P> }
    }
}

struct Instance {
    slot: Box<dyn Slot>,
    /// Input left and right, output left and right, sidechain left and right
    buffers: [[f32; BLOCK]; 6],
    /// The host has a sidechain connected (it fills buffers 4 and 5)
    sidechain: bool,
    program: i32,
    /// The text handed out last (kept until the next one is asked for)
    text: CString,
    /// The state handed out last
    state: Vec<u8>,
}

/// The plugins a host has made, by handle (1, 2, ...; 0 is no plugin).
pub struct Host {
    instances: Vec<Option<Box<Instance>>>,
    info: Option<CString>,
    /// Space handed to the host by `alloc`, until it's freed
    allocs: Vec<Vec<u8>>,
}

fn json_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A plugin as the host's catalog reads it: {"name","category","about","instrument","params","tags"},
/// and "sidechain": true for one that listens to a sidechain.
pub fn info_json(info: &Info, params: usize) -> String {
    let tags: Vec<String> = info.tags.iter().map(|t| json_text(t)).collect();
    format!(
        "{{\"name\":{},\"category\":{},\"about\":{},\"instrument\":{},\"params\":{}{},\"tags\":[{}]}}",
        json_text(info.name),
        json_text(info.category),
        json_text(info.about),
        info.instrument,
        params,
        if info.sidechain { ",\"sidechain\":true" } else { "" },
        tags.join(",")
    )
}

impl Default for Host {
    fn default() -> Self {
        Host::new()
    }
}

impl Host {
    pub const fn new() -> Host {
        Host { instances: Vec::new(), info: None, allocs: Vec::new() }
    }

    fn get(&mut self, h: i32) -> Option<&mut Instance> {
        self.instances.get_mut((h as usize).wrapping_sub(1)).and_then(|x| x.as_deref_mut())
    }

    fn hand(inst: &mut Instance, s: &str) -> *const c_char {
        inst.text = CString::new(s.replace('\0', "")).unwrap_or_default();
        inst.text.as_ptr()
    }

    /// The plugin behind `h`, if it's a `P` (for a family's own exports beyond the interface).
    pub fn plugin<P: Plugin>(&mut self, h: i32) -> Option<&mut P> {
        self.get(h).and_then(|x| x.slot.any_mut().downcast_mut::<P>())
    }

    pub fn info(&mut self, entries: &[Entry], index: i32) -> *const c_char {
        let Some(e) = entries.get(index as usize) else { return std::ptr::null() };
        self.info = CString::new(info_json(&(e.info)(), (e.param_count)())).ok();
        self.info.as_ref().map_or(std::ptr::null(), |c| c.as_ptr())
    }

    pub fn create(&mut self, entries: &[Entry], index: i32, sample_rate: f32) -> i32 {
        let Some(e) = entries.get(index as usize) else { return 0 };
        let inst = Box::new(Instance { slot: (e.make)(sample_rate), buffers: [[0.0; BLOCK]; 6], sidechain: false, program: -1, text: CString::default(), state: Vec::new() });
        if let Some(i) = self.instances.iter().position(|x| x.is_none()) {
            self.instances[i] = Some(inst);
            return i as i32 + 1;
        }
        self.instances.push(Some(inst));
        self.instances.len() as i32
    }

    pub fn destroy(&mut self, h: i32) {
        if let Some(slot) = self.instances.get_mut((h as usize).wrapping_sub(1)) {
            *slot = None;
        }
    }

    pub fn params(&mut self, h: i32) -> i32 {
        self.get(h).map_or(0, |x| x.slot.param_count() as i32)
    }

    pub fn param(&mut self, h: i32, i: i32) -> f32 {
        match self.get(h) {
            Some(x) if i >= 0 && (i as usize) < x.slot.param_count() => x.slot.get(i as usize),
            _ => 0.0,
        }
    }

    /// Set a parameter: anything that isn't a number is ignored, the rest is kept to 0..1.
    pub fn set_param(&mut self, h: i32, i: i32, v: f32) {
        if let Some(x) = self.get(h) {
            if i >= 0 && (i as usize) < x.slot.param_count() && v.is_finite() {
                x.slot.set(i as usize, v.clamp(0.0, 1.0));
            }
        }
    }

    pub fn param_name(&mut self, h: i32, i: i32) -> *const c_char {
        match self.get(h) {
            Some(x) if i >= 0 && (i as usize) < x.slot.param_count() => {
                let s = x.slot.param_name(i as usize);
                Host::hand(x, s)
            }
            _ => std::ptr::null(),
        }
    }

    pub fn param_display(&mut self, h: i32, i: i32) -> *const c_char {
        match self.get(h) {
            Some(x) if i >= 0 && (i as usize) < x.slot.param_count() => {
                let s = x.slot.param_display(i as usize);
                Host::hand(x, &s)
            }
            _ => std::ptr::null(),
        }
    }

    /// Buffers of BLOCK floats: 0, 1 the input; 2, 3 the output; 4, 5 the sidechain.
    pub fn buffer(&mut self, h: i32, which: i32) -> *mut f32 {
        match self.get(h) {
            // (As the interface always was: anything else is the right output)
            Some(x) => x.buffers[if (0..6).contains(&which) { which as usize } else { 3 }].as_mut_ptr(),
            None => std::ptr::null_mut(),
        }
    }

    pub fn process(&mut self, h: i32, frames: i32) {
        if let Some(x) = self.get(h) {
            let n = (frames.max(0) as usize).min(BLOCK);
            let [i0, i1, o0, o1, s0, s1] = &mut x.buffers;
            let sidechain: Option<[&[f32]; 2]> = if x.sidechain { Some([&s0[..n], &s1[..n]]) } else { None };
            let mut block = Block { input: [&i0[..n], &i1[..n]], sidechain, output: [&mut o0[..n], &mut o1[..n]] };
            x.slot.process(&mut block);
        }
    }

    pub fn midi(&mut self, h: i32, status: i32, d1: i32, d2: i32) {
        if let Some(x) = self.get(h) {
            x.slot.midi(status as u8, (d1 & 0x7f) as u8, (d2 & 0x7f) as u8);
        }
    }

    pub fn tempo(&mut self, h: i32, bpm: f32) {
        if let Some(x) = self.get(h) {
            x.slot.set_tempo(bpm);
        }
    }

    pub fn position(&mut self, h: i32, beats: f64) {
        if let Some(x) = self.get(h) {
            x.slot.set_position(beats);
        }
    }

    pub fn legacy(&mut self, h: i32, count: i32) {
        if let Some(x) = self.get(h) {
            x.slot.legacy(count.max(0) as usize);
        }
    }

    pub fn settle(&mut self, h: i32) {
        if let Some(x) = self.get(h) {
            x.slot.settle();
        }
    }

    /// The host says whether a sidechain is connected; 1 back if the plugin listens to one.
    pub fn sidechain(&mut self, h: i32, connected: i32) -> i32 {
        match self.get(h) {
            Some(x) => {
                let listens = x.slot.sidechain();
                x.sidechain = listens && connected != 0;
                if !x.sidechain {
                    x.buffers[4] = [0.0; BLOCK];
                    x.buffers[5] = [0.0; BLOCK];
                }
                listens as i32
            }
            None => 0,
        }
    }

    pub fn programs(&mut self, h: i32) -> i32 {
        self.get(h).map_or(0, |x| x.slot.program_count() as i32)
    }

    pub fn program_name(&mut self, h: i32, i: i32) -> *const c_char {
        match self.get(h) {
            Some(x) if i >= 0 && (i as usize) < x.slot.program_count() => {
                let s = x.slot.program_name(i as usize);
                Host::hand(x, s)
            }
            _ => std::ptr::null(),
        }
    }

    pub fn set_program(&mut self, h: i32, i: i32) {
        if let Some(x) = self.get(h) {
            if i >= 0 && (i as usize) < x.slot.program_count() {
                x.slot.set_program(i as usize);
                x.program = i;
            }
        }
    }

    pub fn program(&mut self, h: i32) -> i32 {
        self.get(h).map_or(-1, |x| x.program)
    }

    /// Space for the host to write `bytes` into (a state for `load`), until `free`.
    pub fn alloc(&mut self, bytes: i32) -> *mut u8 {
        if bytes <= 0 {
            return std::ptr::null_mut();
        }
        self.allocs.push(vec![0; bytes as usize]);
        self.allocs.last_mut().map_or(std::ptr::null_mut(), |v| v.as_mut_ptr())
    }

    pub fn free(&mut self, ptr: *mut u8) {
        self.allocs.retain(|v| !std::ptr::eq(v.as_ptr(), ptr));
    }

    /// Load a state written into space from `alloc` (only from there). 1 if the plugin took it.
    pub fn load(&mut self, h: i32, ptr: *const u8, bytes: i32) -> i32 {
        let Some(i) = self.allocs.iter().position(|v| v.as_ptr() == ptr && bytes >= 0 && bytes as usize <= v.len()) else { return 0 };
        let data = self.allocs[i][..bytes as usize].to_vec();
        self.get(h).map_or(0, |x| x.slot.load(&data) as i32)
    }

    /// The plugin's state: where it is (until the next call for this plugin)...
    pub fn state(&mut self, h: i32) -> *const u8 {
        match self.get(h) {
            Some(x) => {
                x.state = x.slot.save();
                x.state.as_ptr()
            }
            None => std::ptr::null(),
        }
    }

    /// ...and how many bytes the state `state` last handed out is.
    pub fn state_bytes(&mut self, h: i32) -> i32 {
        self.get(h).map_or(0, |x| x.state.len() as i32)
    }
}

static mut HOST: Host = Host::new();

/// The module's own host: what `export!`'s functions call into.
#[allow(static_mut_refs)]
pub fn host() -> &'static mut Host {
    // One audio thread calls in (the worklet), never two at once
    unsafe { &mut HOST }
}

/// Export the plugin interface for a family of these plugins (in the order given: a plugin's
/// index is saved in songs, so new ones go at the end).
#[macro_export]
macro_rules! export {
    ($($plugin:ty),+ $(,)?) => {
        const _: () = {
            use std::ffi::c_char;
            use $crate::host;
            static ENTRIES: &[$crate::Entry] = &[$($crate::Entry::of::<$plugin>()),+];

            #[no_mangle]
            pub extern "C" fn bb_count() -> i32 {
                ENTRIES.len() as i32
            }
            #[no_mangle]
            pub extern "C" fn bb_info(index: i32) -> *const c_char {
                host().info(ENTRIES, index)
            }
            #[no_mangle]
            pub extern "C" fn bb_create(index: i32, sample_rate: f32) -> i32 {
                host().create(ENTRIES, index, sample_rate)
            }
            #[no_mangle]
            pub extern "C" fn bb_destroy(h: i32) {
                host().destroy(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_params(h: i32) -> i32 {
                host().params(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_get(h: i32, i: i32) -> f32 {
                host().param(h, i)
            }
            #[no_mangle]
            pub extern "C" fn bb_set(h: i32, i: i32, v: f32) {
                host().set_param(h, i, v)
            }
            #[no_mangle]
            pub extern "C" fn bb_param_name(h: i32, i: i32) -> *const c_char {
                host().param_name(h, i)
            }
            #[no_mangle]
            pub extern "C" fn bb_param_display(h: i32, i: i32) -> *const c_char {
                host().param_display(h, i)
            }
            #[no_mangle]
            pub extern "C" fn bb_buffer(h: i32, which: i32) -> *mut f32 {
                host().buffer(h, which)
            }
            #[no_mangle]
            pub extern "C" fn bb_process(h: i32, frames: i32) {
                host().process(h, frames)
            }
            #[no_mangle]
            pub extern "C" fn bb_midi(h: i32, status: i32, d1: i32, d2: i32) {
                host().midi(h, status, d1, d2)
            }
            #[no_mangle]
            pub extern "C" fn bb_tempo(h: i32, bpm: f32) {
                host().tempo(h, bpm)
            }
            #[no_mangle]
            pub extern "C" fn bb_position(h: i32, beats: f64) {
                host().position(h, beats)
            }
            #[no_mangle]
            pub extern "C" fn bb_legacy(h: i32, count: i32) {
                host().legacy(h, count)
            }
            #[no_mangle]
            pub extern "C" fn bb_settle(h: i32) {
                host().settle(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_sidechain(h: i32, connected: i32) -> i32 {
                host().sidechain(h, connected)
            }
            #[no_mangle]
            pub extern "C" fn bb_programs(h: i32) -> i32 {
                host().programs(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_program_name(h: i32, i: i32) -> *const c_char {
                host().program_name(h, i)
            }
            #[no_mangle]
            pub extern "C" fn bb_set_program(h: i32, i: i32) {
                host().set_program(h, i)
            }
            #[no_mangle]
            pub extern "C" fn bb_get_program(h: i32) -> i32 {
                host().program(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_alloc(bytes: i32) -> *mut u8 {
                host().alloc(bytes)
            }
            #[no_mangle]
            pub extern "C" fn bb_free(ptr: *mut u8) {
                host().free(ptr)
            }
            #[no_mangle]
            pub extern "C" fn bb_load(h: i32, ptr: *const u8, bytes: i32) -> i32 {
                host().load(h, ptr, bytes)
            }
            #[no_mangle]
            pub extern "C" fn bb_state(h: i32) -> *const u8 {
                host().state(h)
            }
            #[no_mangle]
            pub extern "C" fn bb_state_bytes(h: i32) -> i32 {
                host().state_bytes(h)
            }
        };
    };
}

#[cfg(test)]
mod tests;
