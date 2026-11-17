//! The `Plugin` trait: what every Fledgetone instrument and effect written in Rust implements.
//!
//! A plugin describes itself (`Info`), has parameters set as 0..1, processes stereo audio a block
//! at a time (with an optional sidechain), may take MIDI, may come with presets, and can save and
//! load its state. It knows nothing about who runs it: `fledge-wasm` turns any `Plugin` into the
//! WebAssembly module Fledgetone's plugin host loads, and a native wrapper can do the same for
//! another host.
//!
//! # Parameters are only ever added at the end
//!
//! A saved song stores a plugin's parameters by position. So a parameter never moves, never goes
//! and never changes what its values mean; a new one is added after the last. A sound saved before
//! a parameter existed is loaded with the values it had, and then `Plugin::legacy` is called with
//! how many that was: set the newer parameters there so the sound plays as it did when it was
//! saved (which may not be their defaults).
//!
//! # The same input gives the same output
//!
//! Live playback and an export must match sample for sample: no clocks, no thread-local or
//! unseeded random numbers. Anything that moves by itself (a free LFO, a random value) follows the
//! song position from `Plugin::set_position`.

/// The most frames in one block (a Web Audio render quantum).
pub const BLOCK: usize = 128;

/// What a plugin is, for the host's lists.
#[derive(Clone, Copy, Debug)]
pub struct Info {
    pub name: &'static str,
    /// The list it's shown under ("Synth", "Dynamics", "EQ"...)
    pub category: &'static str,
    /// A sentence or two on what it does
    pub about: &'static str,
    /// It plays notes (takes MIDI) rather than treating the sound it's given
    pub instrument: bool,
    /// It listens to a sidechain when one is connected (see `Block::sidechain`)
    pub sidechain: bool,
    /// An effect that follows the song (a beat repeat, a synced delay): the host tells it the
    /// tempo and the position on every beat, not only with notes as an instrument gets them
    pub transport: bool,
    /// Words a search finds it by
    pub tags: &'static [&'static str],
}

/// One block of stereo audio: `input` and `output` (and `sidechain`, when there is one) are all
/// the same length, `BLOCK` frames at most.
pub struct Block<'a> {
    /// The sound to treat (silence for an instrument)
    pub input: [&'a [f32]; 2],
    /// Another track's sound, to follow rather than to treat (a compressor's key, a vocoder's
    /// voice). None when nothing is connected: the plugin follows its own input then.
    pub sidechain: Option<[&'a [f32]; 2]>,
    /// Where the result goes (every frame must be written)
    pub output: [&'a mut [f32]; 2],
}

impl Block<'_> {
    /// How many frames this block holds.
    #[inline]
    pub fn frames(&self) -> usize {
        self.output[0].len()
    }
}

/// An instrument or an effect. See the crate's documentation for the two rules every plugin
/// keeps: parameters are only ever added at the end, and the same input gives the same output.
pub trait Plugin: 'static {
    fn info() -> Info;

    /// A fresh plugin at `sample_rate` Hz, its parameters at their defaults.
    fn new(sample_rate: f32) -> Self;

    /// How many parameters it has. Only ever grows from one version to the next.
    fn param_count() -> usize;

    /// Parameter `i`'s name (`i` is below `param_count`).
    fn param_name(i: usize) -> &'static str;

    /// Parameter `i` as 0..1.
    fn get(&self, i: usize) -> f32;

    /// Set parameter `i` to `value` (0..1, already checked to be a number in that range).
    fn set(&mut self, i: usize, value: f32);

    /// Parameter `i`'s value as it's shown ("-3.0 dB", "Saw"). A percentage unless overridden.
    fn param_display(&self, i: usize) -> String {
        format!("{:.0} %", self.get(i) * 100.0)
    }

    /// Process one block.
    fn process(&mut self, block: &mut Block);

    /// A MIDI message (instruments; an effect may ignore it).
    fn midi(&mut self, _status: u8, _data1: u8, _data2: u8) {}

    /// The song's tempo (120 until told otherwise).
    fn set_tempo(&mut self, _bpm: f32) {}

    /// Where the song is, in beats, at the start of the next block. Under 0: the song has stopped,
    /// and there is no position to follow until the next one comes.
    fn set_position(&mut self, _beats: f64) {}

    /// An older saved sound with only its first `count` parameters was just loaded: set the ones
    /// added since as it sounded then.
    fn legacy(&mut self, _count: usize) {}

    /// The host has just switched the whole sound (a preset, an undo) while it held the output
    /// faded out: whatever eases toward a setting should go straight to it.
    fn settle(&mut self) {}

    /// How many presets it comes with.
    fn program_count() -> usize {
        0
    }

    /// Preset `i`'s name (`i` is below `program_count`).
    fn program_name(_i: usize) -> &'static str {
        ""
    }

    /// Set the parameters to preset `i`'s (`i` is below `program_count`).
    fn set_program(&mut self, _i: usize) {}

    /// Its state, to be handed back to `load`. The parameters, unless the plugin holds more than
    /// those (then override both; keep what `load` took before readable for ever).
    fn save(&self) -> Vec<u8> {
        (0..Self::param_count()).flat_map(|i| self.get(i).to_le_bytes()).collect()
    }

    /// Take a state `save` made, in this version or an older one. False (and nothing changed) if
    /// it isn't one.
    fn load(&mut self, state: &[u8]) -> bool {
        if state.is_empty() || state.len() % 4 != 0 {
            return false;
        }
        let values: Vec<f32> = state.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        if values.iter().any(|v| !v.is_finite()) {
            return false;
        }
        let n = values.len().min(Self::param_count());
        for (i, v) in values[..n].iter().enumerate() {
            self.set(i, v.clamp(0.0, 1.0));
        }
        if n < Self::param_count() {
            self.legacy(n);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A gain with a second parameter added later (a polarity switch), which older sounds
    /// didn't have
    struct Gain {
        values: [f32; 2],
    }

    impl Plugin for Gain {
        fn info() -> Info {
            Info { name: "Gain", category: "Utility", about: "Turns it up or down.", instrument: false, sidechain: false, transport: false, tags: &[] }
        }
        fn new(_sample_rate: f32) -> Self {
            Gain { values: [0.5, 1.0] }
        }
        fn param_count() -> usize {
            2
        }
        fn param_name(i: usize) -> &'static str {
            ["Gain", "Polarity"][i]
        }
        fn get(&self, i: usize) -> f32 {
            self.values[i]
        }
        fn set(&mut self, i: usize, value: f32) {
            self.values[i] = value;
        }
        fn process(&mut self, block: &mut Block) {
            let g = self.values[0] * 2.0 * if self.values[1] < 0.5 { 1.0 } else { -1.0 };
            for ch in 0..2 {
                for (o, i) in block.output[ch].iter_mut().zip(block.input[ch]) {
                    *o = i * g;
                }
            }
        }
        fn legacy(&mut self, count: usize) {
            // Before the polarity switch, nothing was flipped
            if count < 2 {
                self.values[1] = 0.0;
            }
        }
    }

    #[test]
    fn a_saved_state_loads_back() {
        let mut a = Gain::new(48000.0);
        a.set(0, 0.25);
        a.set(1, 0.0);
        let mut b = Gain::new(48000.0);
        assert!(b.load(&a.save()));
        assert_eq!(b.values, [0.25, 0.0]);
        assert_eq!(a.param_display(0), "25 %");
    }

    #[test]
    fn an_older_state_keeps_its_sound() {
        // Saved when there was only the gain: the polarity is as it was then, not its default
        let mut g = Gain::new(48000.0);
        assert!(g.load(&0.75f32.to_le_bytes()));
        assert_eq!(g.values, [0.75, 0.0]);
        // A newer version's state (more values than this one has): the ones it knows
        let newer: Vec<u8> = [0.1f32, 1.0, 0.9].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert!(g.load(&newer));
        assert_eq!(g.values, [0.1, 1.0]);
    }

    #[test]
    fn what_is_not_a_state_is_refused_and_changes_nothing() {
        let mut g = Gain::new(48000.0);
        assert!(!g.load(&[]));
        assert!(!g.load(&[1, 2, 3]));
        assert!(!g.load(&f32::NAN.to_le_bytes()));
        assert_eq!(g.values, [0.5, 1.0]);
        // Out of range is brought into it
        assert!(g.load(&7.0f32.to_le_bytes()));
        assert_eq!(g.values[0], 1.0);
    }

    #[test]
    fn a_block_knows_its_length() {
        let (l, r) = ([0.5f32; 64], [-0.5f32; 64]);
        let (mut ol, mut or) = ([0f32; 64], [0f32; 64]);
        let mut block = Block { input: [&l, &r], sidechain: None, output: [&mut ol, &mut or] };
        assert_eq!(block.frames(), 64);
        let mut g = Gain::new(48000.0);
        g.process(&mut block);
        assert!(ol.iter().all(|x| *x == -0.5) && or.iter().all(|x| *x == 0.5));
    }
}
