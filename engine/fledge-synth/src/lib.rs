//! Fledge Synth: Fledgetone's own synthesizer, for modern electronic music. The same Rust runs
//! in the browser (as WebAssembly, through the plugin host's bb_* interface in `abi`) and as a
//! native library (a desktop app, tests, the render harness).

pub mod abi;
pub mod analysis;
pub mod dsp;
pub mod fx;
pub mod params;
pub mod presets;
pub mod synth;
pub mod tables;
