//! Fledge DSP: the building blocks Fledgetone's plugins are made of. Filters, oversampling,
//! antialiased shapers, envelopes, LFO shapes, a delay line, a multiband compressor, an FFT and
//! band-limited wavetables. No dependencies; the same code builds natively and to WebAssembly.
//!
//! Everything here is deterministic: the same input gives the same output, at any block size.

pub mod bank;
pub mod delay;
pub mod dynamics;
pub mod envelope;
pub mod fft;
pub mod filter;
pub mod lfo;
pub mod math;
pub mod oversample;
pub mod shaper;
pub mod wavetable;

#[cfg(test)]
mod tests;
