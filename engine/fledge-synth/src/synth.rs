//! The synth: up to eight voices of two wavetable oscillators (each with up to 16 unison voices,
//! a warp and a stack), a sub and noise, routed (through an optional pre-filter drive) into two
//! filters (side by side or one into the other) or straight out, then drive and a cabinet-style
//! tone. Four LFOs (free with the song, restarting, one-shot envelopes or sustaining), three
//! envelopes, per-note random values, a stepped chaos source, four macros and a 16-slot matrix
//! (each slot with a curve and an optional "via" source scaling it) move it all. After the
//! voices: the multiband drive (lows kept clean), the OTT, the effects (EQ, chorus, phaser,
//! delay, reverb), the clean mono sub (mixed in here, after all that, unless an older sound
//! keeps it with the voices), the mono low end, the level and the safety clipper. Everything the
//! host sees goes through `Synth`.
//!
//! Random values are seeded, so a render repeats exactly; once the host says where in the song
//! it is (`set_position`), they're seeded from the song position and the note (a note's own
//! random values from its step within "Random repeat" and its place in a chord, not its pitch),
//! and the free LFOs and the chaos source follow the song position, so the live playback and an
//! export of the same notes match whatever was played before. With "Mono restart" a mono note
//! that doesn't join the last starts afresh (the last fading out on a spare voice), so a riff
//! that repeats repeats exactly; "Mono below" sets where the low end is kept in the middle.

use crate::dsp::*;
use crate::fx::{Effects, FxCfg, FxMods};
use crate::params::{self as p, db_gain, param, COUNT};
use crate::tables::{level_blend, level_for, table, Table};
use std::sync::Arc;

pub const BLOCK: usize = 128;
/// Modulation (LFOs, envelopes into cutoff, pitch) is worked out every this many samples
const CONTROL: usize = 16;
const NBLK: usize = BLOCK / CONTROL;
const VOICES: usize = 8;
const UNISON: usize = 16;
/// Room for every target and source (their lists' caps)
const NDEST: usize = 64;
const NSRC: usize = 32;

/// Sources, by their place in params::SOURCES
mod src {
    pub const LFO: usize = 1;
    pub const AMP: usize = 5;
    pub const FENV: usize = 6;
    pub const MENV: usize = 7;
    pub const VEL: usize = 8;
    pub const NOTE: usize = 9;
    pub const MW: usize = 10;
    pub const AT: usize = 11;
    pub const BEND: usize = 12;
    pub const RAND: usize = 13;
    pub const MACRO: usize = 14;
    pub const NRAND: usize = 18;
    pub const NRAND_BI: usize = 19;
    pub const CHAOS: usize = 20;
    pub const RELVEL: usize = 21;
    pub const PRESS: usize = 22;
}

/// Targets, by their place in params::DESTS
mod d {
    pub const CUT1: usize = 1;
    pub const RES1: usize = 2;
    pub const APOS: usize = 3;
    pub const BPOS: usize = 4;
    pub const PITCH: usize = 5;
    pub const VOL: usize = 6;
    pub const DRIVE: usize = 7;
    pub const FM: usize = 8;
    pub const PAN: usize = 9;
    pub const BPITCH: usize = 10;
    pub const SUB: usize = 11;
    pub const APITCH: usize = 12;
    pub const ALEVEL: usize = 13;
    pub const BLEVEL: usize = 14;
    pub const ADET: usize = 15;
    pub const BDET: usize = 16;
    pub const AWARP: usize = 17;
    pub const BWARP: usize = 18;
    pub const CUT2: usize = 19;
    pub const RES2: usize = 20;
    pub const NOISE: usize = 21;
    pub const FDRIVE: usize = 22;
    pub const DMIX: usize = 23;
    pub const LFO_RATE: usize = 24;
    pub const CHORUS: usize = 28;
    pub const PHASER: usize = 29;
    pub const DELAY: usize = 30;
    pub const REVERB: usize = 31;
    pub const WIDTH: usize = 32;
    pub const PRE_DRIVE: usize = 33;
    pub const CRUSH: usize = 34;
    pub const BAND_DRIVE: usize = 35;
}

/// The settings for one block, read from the parameters (in the engine's units).
#[derive(Clone, Copy, Default)]
struct OscCfg {
    on: bool,
    table: usize,
    pos: f32,
    /// Pitch offset in semitones (octave, semitone, fine)
    tune: f32,
    level: f32,
    unison: usize,
    detune: f32,
    blend: f32,
    width: f32,
    warp: u32,
    warp_amt: f32,
    phase: f32,
    rand: f32,
    stack: usize,
    pan: f32,
    route: usize,
}

#[derive(Clone, Copy, Default)]
struct LfoCfg {
    shape: u32,
    /// Cycles per second
    hz: f32,
    /// 0 free (shared by every note), 1 restarts with each note, 2 runs once per note, 3 runs
    /// to its sustain point while the key is down
    mode: usize,
    phase: f32,
    fade: f32,
    dest: [usize; 2],
    amt: [f32; 2],
    /// One value for every note (free, no fade in or delay): worked out once for the whole synth
    global: bool,
    /// In time with the song, and its length in beats
    synced: bool,
    beats: f32,
    retrig: usize,
    delay: f32,
    smooth: f32,
    keytrack: f32,
    sustain: f32,
}

/// A matrix slot: source, target, amount, curve, via; and whether it's worked out per note
/// (its source or via differs from note to note)
#[derive(Clone, Copy, Default)]
struct Slot {
    from: usize,
    to: usize,
    amt: f32,
    curve: usize,
    via: usize,
    note: bool,
}

/// One drive stage's settings
#[derive(Clone, Copy, Default)]
struct DriveCfg {
    kind: u32,
    db: f32,
    mix: f32,
    crush: f32,
    tone: f32,
}

#[derive(Clone, Copy, Default)]
struct FiltCfg {
    kind: usize,
    cutoff: f32,
    reso: f32,
    keytrack: f32,
    env: f32,
}

#[derive(Clone, Copy, Default)]
struct Cfg {
    osc: [OscCfg; 2],
    fm: f32,
    sub: f32,
    sub_div: f32,
    noise: f32,
    noise_route: usize,
    filt: [FiltCfg; 2],
    fdrive: f32,
    serial: bool,
    /// Filter 2 has something to do (something routed to it, or filter 1 into it)
    f2_used: bool,
    amp: [f32; 4],
    fadsr: [f32; 4],
    madsr: [f32; 4],
    penv: f32,
    pdecay: f32,
    shaper: u32,
    drive: f32,
    drive_mix: f32,
    drive_crush: f32,
    drive_tone: f32,
    pre: DriveCfg,
    band: DriveCfg,
    band_split: (f32, f32),
    band_high: f32,
    sub_after: bool,
    glide_legato: bool,
    glide_rate: bool,
    glide_linear: bool,
    penv_linear: bool,
    /// Mono and legato: a note that doesn't join the last starts afresh (see "Mono restart")
    mono_restart: bool,
    /// The side loses everything under this (Hz)
    mono_below: f32,
    /// A note's random values from its step and its place in a chord (lowest first), not its
    /// pitch (older sounds: from its pitch)
    random_by_step: bool,
    /// No step between the table's octave levels, and a note's random start from its step, not
    /// its pitch (older sounds: off)
    even_keys: bool,
    /// How much the unison's detune narrows above middle C (0..1)
    detune_key: f32,
    chaos_beats: f32,
    chaos_smooth: f32,
    /// Beats after which the random values come round again (0: never)
    random_cycle: f64,
    lfo: [LfoCfg; 4],
    drawn: [[f32; 16]; 2],
    smooth: [f32; 2],
    slots: [Slot; p::SLOTS_ALL],
    macros: [f32; 4],
    mode: usize,
    glide: f32,
    bend_range: f32,
    vel: f32,
    fx: FxCfg,
    ott: f32,
    ott_time: f32,
    width: f32,
    level: f32,
}

/// One oscillator's unison spread: each voice's pitch ratio and stereo gains.
#[derive(Clone, Copy)]
struct Spread {
    n: usize,
    ratio: [f32; UNISON],
    gl: [f32; UNISON],
    gr: [f32; UNISON],
    /// The highest ratio (the table level is chosen for it, so nothing aliases)
    top: f32,
}

impl Spread {
    /// `key`: the detune's scale for this note (1, or less above middle C: "Detune key tracking")
    fn new(o: &OscCfg, detune: f32, key: f32) -> Self {
        let n = o.unison.clamp(1, UNISON);
        let mut s = Spread { n, ratio: [1.0; UNISON], gl: [0.0; UNISON], gr: [0.0; UNISON], top: 1.0 };
        let (pl, pr) = ((1.0 - o.pan).sqrt(), (1.0 + o.pan).sqrt());
        if n == 1 {
            s.gl[0] = pl;
            s.gr[0] = pr;
            return s;
        }
        // The detune grows slowly then fast (as the classic supersaw's knob does): up to 100 cents
        let cents = 100.0 * detune * detune * key;
        // Centre and detuned levels from the blend, at constant loudness
        let centre = 1.0 + (0.4 - 1.0) * o.blend;
        let detuned = 0.6 * (1.0 - (1.0 - o.blend) * (1.0 - o.blend));
        let mid = if n % 2 == 1 { Some(n / 2) } else { None };
        let stack = p::STACK_STEPS[o.stack.min(p::STACK_STEPS.len() - 1)];
        let mut w = [0.0f32; UNISON];
        let mut sum = 0.0;
        for i in 0..n {
            let t = -1.0 + 2.0 * i as f32 / (n - 1) as f32;
            // Outer voices spread furthest (|t|^1.5, near the measured supersaw spacing)
            let off = t.signum() * t.abs().powf(1.5) * cents;
            // A stack puts voices in turn up an octave, a fifth, a chord's notes (the centre stays)
            // (The centre voice is the root: the others take the stack's notes in turn, from the
            // first one above the root, so an odd count loses none)
            let up = match mid {
                Some(m) if m == i => 0.0,
                Some(m) => stack[((if i < m { i } else { i - 1 }) + 1) % stack.len()],
                None => stack[i % stack.len()],
            };
            s.ratio[i] = 2f32.powf(off / 1200.0 + up / 12.0);
            s.top = s.top.max(s.ratio[i]);
            w[i] = match mid {
                Some(m) if m == i => centre,
                Some(_) => detuned,
                // An even count has no centre voice: all alike
                None => 1.0,
            };
            sum += w[i] * w[i];
            let pan = (t * o.width).clamp(-1.0, 1.0);
            s.gl[i] = (1.0 - pan).sqrt();
            s.gr[i] = (1.0 + pan).sqrt();
        }
        let norm = 1.0 / sum.max(1e-6).sqrt();
        for i in 0..n {
            s.gl[i] *= w[i] * norm * pl;
            s.gr[i] *= w[i] * norm * pr;
        }
        s
    }
}

// ---------- the filters ----------

/// One channel of one filter: every kind's state (only the chosen kind's moves).
#[derive(Clone)]
struct FiltState {
    svf: [Svf; 2],
    formant: [Svf; 3],
    ladder: Ladder,
    comb: Comb,
}

/// A filter's coefficients for a stretch of samples.
#[derive(Clone, Copy, Default)]
struct FiltCoef {
    kind: usize,
    a: SvfCoef,
    b: SvfCoef,
    g: f32,
    ladder_k: f32,
    period: f32,
    comb_fb: f32,
    fk: f32,
    form: [SvfCoef; 3],
    fq: f32,
}

impl FiltCoef {
    /// For filter `kind` at `cutoff` Hz, resonance 0..1; `vowel` 0..4 for the formant filter.
    fn new(kind: usize, cutoff: f32, reso: f32, vowel: f32, sr: f32) -> Self {
        let mut c = FiltCoef { kind, ..Default::default() };
        c.fk = 2.0 - 1.9 * reso;
        match kind {
            0 | 3 | 4 | 6 => c.a = SvfCoef::new(cutoff, sr, c.fk),
            1 | 5 => {
                c.a = SvfCoef::new(cutoff, sr, c.fk);
                c.b = SvfCoef::new(cutoff, sr, std::f32::consts::SQRT_2);
            }
            2 => {
                c.g = (std::f32::consts::PI * cutoff / sr).tan();
                c.ladder_k = reso * 3.7;
            }
            7 | 8 => {
                c.period = sr / cutoff;
                c.comb_fb = reso * 0.97;
            }
            9 => {
                let f = vowel_formants(vowel);
                c.fq = 0.35 - 0.28 * reso;
                c.form = [SvfCoef::new(f[0], sr, c.fq), SvfCoef::new(f[1], sr, c.fq), SvfCoef::new(f[2], sr, c.fq)];
            }
            _ => {}
        }
        c
    }
}

impl FiltState {
    fn new(sr: f32) -> Self {
        FiltState { svf: [Svf::default(); 2], formant: [Svf::default(); 3], ladder: Ladder::default(), comb: Comb::new(sr) }
    }
    fn reset(&mut self) {
        self.svf = [Svf::default(); 2];
        self.formant = [Svf::default(); 3];
        self.ladder.reset();
        self.comb.reset();
    }
    #[inline]
    fn tick(&mut self, c: &FiltCoef, x: f32) -> f32 {
        match c.kind {
            0 => self.svf[0].tick(&c.a, x).lp,
            1 => {
                let a = self.svf[0].tick(&c.a, x).lp;
                self.svf[1].tick(&c.b, a).lp
            }
            2 => self.ladder.tick(c.g, c.ladder_k, x) * (1.0 + c.ladder_k * 0.25),
            3 => self.svf[0].tick(&c.a, x).bp * c.fk,
            4 => self.svf[0].tick(&c.a, x).hp,
            5 => {
                let a = self.svf[0].tick(&c.a, x).hp;
                self.svf[1].tick(&c.b, a).hp
            }
            6 => {
                let o = self.svf[0].tick(&c.a, x);
                o.lp + o.hp
            }
            7 => self.comb.tick(x, c.period, c.comb_fb, false) * (1.0 - c.comb_fb * 0.6),
            8 => self.comb.tick(x, c.period, c.comb_fb, true) * (1.0 - c.comb_fb * 0.6),
            9 => {
                let f = &mut self.formant;
                (f[0].tick(&c.form[0], x).bp + f[1].tick(&c.form[1], x).bp * 0.7 + f[2].tick(&c.form[2], x).bp * 0.45) * c.fq * 1.8
            }
            _ => x,
        }
    }
}

/// The formant filter's vowel (0 oo .. 4 ee) for a cutoff: its place on the cutoff's range.
fn vowel_of(cutoff: f32) -> f32 {
    ((cutoff.max(20.0).ln() - 20f32.ln()) / (20000f32.ln() - 20f32.ln()) * 4.0).clamp(0.0, 4.0)
}

// ---------- warps ----------

/// How much faster a warp reads the cycle at its quickest (the table level allows for it).
fn warp_stretch(kind: u32, w: f32) -> f32 {
    match kind {
        1..=3 => 1.0 + 7.0 * w,
        4 => 0.5 / (0.5 - 0.45 * w),
        _ => 1.0,
    }
}

/// Where in the cycle to read for phase `ph` under warp `kind` at amount `w`.
#[inline]
pub(crate) fn warp_phase(kind: u32, w: f32, ph: f32) -> f32 {
    match kind {
        // Sync: the cycle restarts (1 + 7w) times per period
        1 => (ph * (1.0 + 7.0 * w)).fract(),
        // Bend: the cycle pulled late (+) or early (−), along a curve that keeps both ends
        2 => {
            let k = 1.0 + 7.0 * w;
            ph / (ph + k * (1.0 - ph))
        }
        3 => {
            let k = 1.0 / (1.0 + 7.0 * w);
            ph / (ph + k * (1.0 - ph))
        }
        // Squeeze: the first half of the cycle squeezed into less and less of the period
        4 => {
            let c = 0.5 - 0.45 * w;
            if ph < c {
                0.5 * ph / c
            } else {
                0.5 + 0.5 * (ph - c) / (1.0 - c)
            }
        }
        // Mirror: the second half reads the first half backwards
        5 => {
            let m = if ph < 0.5 { ph } else { 1.0 - ph };
            ph + (m - ph) * w
        }
        // Quantize: the phase in steps (lo-fi)
        6 => {
            let steps = 4.0 + 60.0 * (1.0 - w) * (1.0 - w);
            (ph * steps).floor() / steps
        }
        _ => ph,
    }
}

/// The amplitude warps: fold (a triangle wave folder) and ring (times the other oscillator).
#[inline]
pub(crate) fn warp_amp(kind: u32, w: f32, s: f32, other: f32) -> f32 {
    match kind {
        7 if w > 0.0 => {
            let y = s * (1.0 + 5.0 * w);
            4.0 * (((y - 1.0) * 0.25).rem_euclid(1.0) - 0.5).abs() - 1.0
        }
        8 => s * ((1.0 - w) + w * other * 1.4),
        _ => s,
    }
}

// ---------- LFOs ----------

/// LFO `k`'s value at `phase` (0..1).
fn lfo_value(cfg: &Cfg, k: usize, phase: f32, held: (f32, f32)) -> f32 {
    let shape = cfg.lfo[k].shape;
    if shape >= p::LFO_DRAWN {
        let which = ((shape - p::LFO_DRAWN) as usize).min(1);
        return drawn(&cfg.drawn[which], cfg.smooth[which], phase);
    }
    if shape == 8 {
        // Pump: down at the start of each cycle, then back up quickly (the sidechain duck)
        let e = (1.0 - (-8.0 * phase).exp()) / (1.0 - (-8.0f32).exp());
        return 2.0 * e - 1.0;
    }
    lfo_shape(shape, phase, held)
}

/// A drawn shape's value at `phase`: 16 steps, each sliding into the next over the last `smooth`
/// of its length (0: hard steps, 1: a smooth curve).
fn drawn(steps: &[f32; 16], smooth: f32, phase: f32) -> f32 {
    let x = phase.clamp(0.0, 0.99999) * 16.0;
    let i = x as usize;
    let t = x - i as f32;
    let a = steps[i];
    if smooth <= 0.001 {
        return a;
    }
    let b = steps[(i + 1) % 16];
    let u = ((t - (1.0 - smooth)) / smooth).clamp(0.0, 1.0);
    a + (b - a) * u * u * (3.0 - 2.0 * u)
}

/// Whether source `s` differs from note to note (else it's the whole synth's: free LFOs without a
/// delay or fade in, the mod wheel, aftertouch, bend, the macros, chaos).
fn note_source(lfo: &[LfoCfg; 4], s: usize) -> bool {
    match s {
        1..=4 => !lfo[s - src::LFO].global,
        src::AMP | src::FENV | src::MENV | src::VEL | src::NOTE | src::RAND | src::NRAND | src::NRAND_BI | src::RELVEL | src::PRESS => true,
        _ => false,
    }
}

/// A matrix slot's curve on its source (either way from 0, so a bipolar source keeps its middle).
#[inline]
fn curve(kind: usize, x: f32) -> f32 {
    let a = x.abs().min(1.0);
    let y = match kind {
        1 => a * a,
        2 => 1.0 - (1.0 - a) * (1.0 - a),
        3 => a * a * (3.0 - 2.0 * a),
        _ => return x,
    };
    y.copysign(x)
}

/// Add every route (each LFO's two targets, the matrix) from `s` into `m`: the whole synth's
/// (`notes` false: `s` holds its sources) or a note's (`notes` true: `s` holds the whole synth's
/// sources and the note's), each route in the one that fits it, so each counts once.
fn route(cfg: &Cfg, s: &[f32; NSRC], m: &mut [f32; NDEST], notes: bool) {
    for k in 0..4 {
        if cfg.lfo[k].global == notes {
            continue;
        }
        let v = s[src::LFO + k];
        if v != 0.0 {
            for t in 0..2 {
                m[cfg.lfo[k].dest[t]] += cfg.lfo[k].amt[t] * v;
            }
        }
    }
    for sl in &cfg.slots {
        if sl.from > 0 && sl.to > 0 && sl.note == notes {
            let mut x = curve(sl.curve, s[sl.from]);
            if sl.via > 0 {
                x *= s[sl.via];
            }
            m[sl.to] += sl.amt * x;
        }
    }
    m[0] = 0.0;
}

/// A well-mixed hash of `x` as 0..1 (the seeded random values: the same input, the same value).
#[inline]
pub(crate) fn hash01(x: u64) -> f32 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 40) as f32 / (1u64 << 24) as f32
}
#[inline]
fn hash_bi(x: u64) -> f32 {
    hash01(x) * 2.0 - 1.0
}
/// A song position (beats) as a whole number of ticks (960 a beat), for seeding.
#[inline]
fn ticks(beats: f64) -> u64 {
    (beats.max(0.0) * 960.0).round() as u64
}

/// One drive stage: the shape (antialiased), or a crush (bits or rate), with its makeup gain so
/// that the level stays put as the drive rises, mixed with the clean sound.
#[derive(Clone, Copy, Default)]
struct Drive {
    shaper: Shaper,
    held: f32,
    count: f32,
    /// The level in and out (mean squares), for the stages that keep their level by ear
    ein: f32,
    eout: f32,
}

/// A stage's numbers for a stretch of samples
#[derive(Clone, Copy, Default)]
struct DriveNow {
    kind: u32,
    gain: f32,
    makeup: f32,
    mix: f32,
    /// Bitcrush: levels each side of 0; downsample: samples held
    step: f32,
    /// Above 0: the stage never comes out louder than it went in (its level followed at this
    /// pace), whatever the shape does to a quiet part (the pre-filter and band drives)
    follow: f32,
}

impl DriveNow {
    fn new(kind: u32, db: f32, mix: f32, crush: f32) -> Self {
        let gain = 10f32.powf(db.clamp(0.0, 48.0) / 20.0);
        let crushing = kind == p::CRUSH_BITS || kind == p::CRUSH_RATE;
        let makeup = shaper_makeup(if crushing { 3 } else { kind }, gain);
        let c = crush.clamp(0.0, 1.0);
        let step = if kind == p::CRUSH_BITS { 2f32.powf(15.0 - 13.0 * c) } else { 1.0 + 47.0 * c * c };
        DriveNow { kind, gain, makeup, mix: mix.clamp(0.0, 1.0), step, follow: 0.0 }
    }
    /// The same, never louder than what goes in
    fn level_kept(mut self, sr: f32) -> Self {
        self.follow = 1.0 - (-1.0 / (0.03 * sr)).exp();
        self
    }
    #[inline]
    fn on(&self) -> bool {
        self.kind > 0 && self.mix > 0.0
    }
}

impl Drive {
    #[inline]
    fn tick(&mut self, d: &DriveNow, x: f32) -> f32 {
        let w = match d.kind {
            p::CRUSH_BITS => {
                let y = (x * d.gain).clamp(-1.0, 1.0);
                (y * d.step).round() / d.step / d.makeup
            }
            p::CRUSH_RATE => {
                self.count += 1.0;
                if self.count >= d.step {
                    self.count -= d.step;
                    self.held = (x * d.gain).clamp(-1.0, 1.0);
                }
                self.held / d.makeup
            }
            _ => self.shaper.tick(d.kind, x * d.gain) / d.makeup,
        };
        let y = x + (w - x) * d.mix;
        if d.follow > 0.0 {
            self.ein += (x * x - self.ein) * d.follow;
            self.eout += (y * y - self.eout) * d.follow;
            // (After a while of silence it starts afresh: what played before leaves nothing)
            if self.ein < 1e-14 && self.eout < 1e-14 {
                self.ein = 0.0;
                self.eout = 0.0;
            }
            if self.eout > self.ein {
                return y * ((self.ein + 1e-12) / self.eout).sqrt();
            }
        }
        y
    }
    fn reset(&mut self) {
        *self = Drive::default();
    }
}

/// A cabinet-style tone after a drive: the lows and the fizz taken off, a little mid push. `tone`
/// 0 leaves it out, 1 is the darkest.
#[derive(Clone, Copy, Default)]
struct Cab {
    hp: Svf,
    lp: Svf,
    lp2: Svf,
}

#[derive(Clone, Copy, Default)]
struct CabNow {
    hp: SvfCoef,
    lp: SvfCoef,
    mix: f32,
    push: f32,
}

impl CabNow {
    fn new(tone: f32, sr: f32) -> Self {
        let t = tone.clamp(0.0, 1.0);
        CabNow {
            hp: SvfCoef::new(70.0 + 60.0 * t, sr, std::f32::consts::SQRT_2),
            lp: SvfCoef::new((7500.0 * 0.32f32.powf(t)).min(sr * 0.45), sr, 1.1),
            mix: (2.0 * t).min(1.0),
            push: 0.35 * t,
        }
    }
}

impl Cab {
    #[inline]
    fn tick(&mut self, c: &CabNow, x: f32) -> f32 {
        let h = self.hp.tick(&c.hp, x).hp;
        let o = self.lp.tick(&c.lp, h);
        let y = self.lp2.tick(&c.lp, o.lp).lp + o.bp * c.push;
        x + (y - x) * c.mix
    }
}

/// The multiband drive, one side: lows (clean), mids and highs (driven), split by
/// Linkwitz-Riley crossovers (the lows through the upper split's all-pass too), so undriven the
/// three add back up flat.
#[derive(Clone, Copy, Default)]
struct Band {
    /// The low split: its first stage, then the low pass and high pass of what it gives
    lo: [Svf; 3],
    /// The high split, on what's above the low one
    hi: [Svf; 3],
    /// The lows' all-pass at the high split
    ap: Svf,
    drive: [Drive; 2],
    cab: Cab,
}

impl Band {
    /// Lows, mids, highs of `x`
    #[inline]
    fn split(&mut self, lo: &SvfCoef, hi: &SvfCoef, x: f32) -> (f32, f32, f32) {
        let a = self.lo[0].tick(lo, x);
        let low = self.lo[1].tick(lo, a.lp).lp;
        let up = self.lo[2].tick(lo, a.hp).hp;
        let b = self.hi[0].tick(hi, up);
        let mid = self.hi[1].tick(hi, b.lp).lp;
        let high = self.hi[2].tick(hi, b.hp).hp;
        let p = self.ap.tick(hi, low);
        (p.lp + p.hp - std::f32::consts::SQRT_2 * p.bp, mid, high)
    }
}

#[derive(Clone)]
struct Voice {
    active: bool,
    note: u8,
    vel: f32,
    age: u64,
    /// The pitch now and where it glides to, in semitones (MIDI note numbers), and how far off it
    /// still is
    pitch: f32,
    target: f32,
    glide: f32,
    amp: Env,
    fenv: Env,
    menv: Env,
    penv: f32,
    phase: [[f32; UNISON]; 2],
    sub_phase: f32,
    /// Filter 1 and 2, left and right
    filt: [[FiltState; 2]; 2],
    lfo_phase: [f32; 4],
    lfo_held: [(f32, f32); 4],
    /// Seconds since the note started (for the LFOs' fade in)
    time: f32,
    /// This note's random source value (-1..1)
    rand: f32,
    /// The note-random sources (0..1 and -1..1), new at each note-on
    nrand: f32,
    nrand_bi: f32,
    /// Where in the song the note that set them was struck
    nrand_at: f64,
    /// How fast its key came up (0 until then), and its key's pressure
    rel_vel: f32,
    pressure: f32,
    /// Each note LFO's smoothed value (NaN: not yet started)
    lfo_sm: [f32; 4],
    /// The glide as this note started it: per-sample pull (exponential) or step (linear), when
    /// the glide isn't the classic one worked out from the knob each block
    glide_k: f32,
    glide_step: f32,
    /// The pre-filter drive into filter 1 (left, right) and filter 2 (left, right)
    pre: [Drive; 4],
    post: [Drive; 2],
    cab: [Cab; 2],
    /// Oscillator A's last sample, before its warp (oscillator B's ring warp reads it)
    last_a: f32,
    /// Held down by the sustain pedal after its key came up
    sustained: bool,
    /// A note waiting for this voice to fade out (it was taken for a new one)
    pending: Option<(u8, f32)>,
    /// The waiting note's key already came up (a short note): it plays, then ends at once
    pending_up: bool,
    /// Samples left of a very short note started after its key came up: it plays this long,
    /// then lets go (or the pedal holds it)
    short_left: u32,
    fade: f32,
    /// Fading out over 3 ms, then done: a mono note's last one, as a new note starts afresh
    dying: bool,
    /// The velocity's gain as it eases to a new note's (a retrigger never steps it); below 0
    /// until the voice's first sample
    gain_now: f32,
    /// The level heard when a retrigger started (envelope, fade and gain): while the gain eases
    /// down, the new note never plays louder than this or than its own level
    carry: f32,
}

impl Voice {
    fn new(sr: f32) -> Self {
        let fs = || [FiltState::new(sr), FiltState::new(sr)];
        Voice {
            active: false,
            note: 0,
            vel: 0.0,
            age: 0,
            pitch: 60.0,
            target: 60.0,
            glide: 0.0,
            amp: Env::default(),
            fenv: Env::default(),
            menv: Env::default(),
            penv: 0.0,
            phase: [[0.0; UNISON]; 2],
            sub_phase: 0.0,
            filt: [fs(), fs()],
            lfo_phase: [0.0; 4],
            lfo_held: [(0.0, 0.0); 4],
            time: 0.0,
            rand: 0.0,
            nrand: 0.0,
            nrand_bi: 0.0,
            nrand_at: f64::NAN,
            rel_vel: 0.0,
            pressure: 0.0,
            lfo_sm: [f32::NAN; 4],
            glide_k: 1.0,
            glide_step: 0.0,
            pre: [Drive::default(); 4],
            post: [Drive::default(); 2],
            cab: [Cab::default(); 2],
            last_a: 0.0,
            sustained: false,
            pending: None,
            pending_up: false,
            short_left: 0,
            fade: 1.0,
            dying: false,
            gain_now: -1.0,
            carry: 0.0,
        }
    }
    fn release(&mut self) {
        self.amp.gate(false);
        self.fenv.gate(false);
        self.menv.gate(false);
    }
}

pub struct Synth {
    sr: f32,
    pub params: [f32; COUNT],
    tempo: f32,
    voices: Vec<Voice>,
    rng: Rng,
    age: u64,
    bend: f32,
    modwheel: f32,
    aftertouch: f32,
    pedal: bool,
    /// Keys held, oldest first (mono and legato go back to the last one still held)
    stack: Vec<u8>,
    /// How many times each key is down (a note struck twice, before its first note-off, twice)
    down: [u8; 128],
    lfo_phase: [f32; 4],
    lfo_held: [(f32, f32); 4],
    /// Where each free LFO was last read (with its phase offset)
    lfo_read: [f32; 4],
    /// The LFO rate targets as last worked out (they take effect a block later)
    lfo_rate_mod: [f32; 4],
    ott: Ott,
    ott_on: bool,
    fx: Effects,
    side_hp: [Svf; 2],
    dc: [DcBlock; 2],
    side_coef: SvfCoef,
    /// The frequency side_coef was made for
    side_f: f32,
    clip: [SafetyClip; 2],
    gain: f32,
    /// Where in the song it is (beats, and seconds), counted on from the host's last word
    song_beats: f64,
    song_secs: f64,
    /// The host has said where in the song it is: random values and free LFOs follow the song
    anchored: bool,
    /// The free LFOs' smoothed values (NaN: not started)
    lfo_sm: [f32; 4],
    /// Where in the song each key was last struck (a note that waits for its voice still gets
    /// the random values of when it was played)
    struck: [f64; 128],
    /// Each key's place among the notes struck at the same moment (a chord's notes 0, 1, 2...
    /// from the lowest, whatever order they came in), and the last moment notes were struck,
    /// with the keys struck then
    struck_k: [u8; 128],
    strike: (f64, u128),
    band: [Band; 2],
    /// The clean sub, mixed in after the effects
    sub_bus: [f32; BLOCK],
    pub out: [[f32; BLOCK]; 2],
    pub input: [[f32; BLOCK]; 2],
    /// The table made from a sound, for oscillators set to "User table"
    user: Option<Arc<Table>>,
}

impl Synth {
    pub fn new(sr: f32) -> Self {
        // The tables are made when a sound first uses one (a few ms each), not all at once here:
        // this runs on the audio thread, and making all sixteen would hold it up
        let mut rng = Rng::new(0x9E37_79B9);
        // Free Steps and Drift LFOs are random from their first cycle
        let lfo_held: [(f32, f32); 4] = std::array::from_fn(|_| (rng.bipolar(), rng.bipolar()));
        Synth {
            sr,
            params: p::defaults(),
            tempo: 120.0,
            voices: (0..VOICES).map(|_| Voice::new(sr)).collect(),
            rng,
            age: 0,
            bend: 0.0,
            modwheel: 0.0,
            aftertouch: 0.0,
            pedal: false,
            stack: Vec::with_capacity(32),
            down: [0; 128],
            lfo_phase: [0.0; 4],
            lfo_held,
            lfo_read: [0.0; 4],
            lfo_rate_mod: [0.0; 4],
            ott: Ott::new(sr),
            ott_on: false,
            fx: Effects::new(sr),
            side_hp: [Svf::default(); 2],
            dc: [DcBlock::default(); 2],
            side_coef: SvfCoef::new(120.0, sr, std::f32::consts::SQRT_2),
            side_f: 120.0,
            clip: [SafetyClip::default(); 2],
            gain: 0.0,
            song_beats: 0.0,
            song_secs: 0.0,
            anchored: false,
            lfo_sm: [f32::NAN; 4],
            struck: [0.0; 128],
            struck_k: [0; 128],
            strike: (f64::NAN, 0),
            band: [Band::default(); 2],
            sub_bus: [0.0; BLOCK],
            out: [[0.0; BLOCK]; 2],
            input: [[0.0; BLOCK]; 2],
            user: None,
        }
    }

    /// Play `table` as the "User table" (None: none, so it plays "Basic shapes").
    pub fn set_user_table(&mut self, table: Option<Table>) {
        self.user = table.map(Arc::new);
    }

    /// Whether a user table is loaded.
    pub fn has_user_table(&self) -> bool {
        self.user.is_some()
    }

    pub fn set_tempo(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 1.0 {
            self.tempo = bpm;
        }
    }

    /// Where in the song it is now, in beats (quarter notes from the song's start). From then on
    /// the free LFOs and the chaos source follow the song, and random values are seeded from the
    /// song position and the note: playing the same notes from the same place gives the same
    /// sound, live or in an export.
    pub fn set_position(&mut self, beats: f64) {
        if !beats.is_finite() || beats < 0.0 {
            return;
        }
        self.song_beats = beats;
        self.song_secs = beats * 60.0 / self.tempo as f64;
        self.anchored = true;
    }

    /// An older saved sound with only its first `count` values has just been loaded: the
    /// parameters it didn't have are set as it sounded then.
    pub fn legacy(&mut self, count: usize) {
        p::legacy(&mut self.params, count);
    }

    fn v(&self, i: usize) -> f32 {
        param(i).kind.value(self.params[i])
    }

    fn cfg(&self) -> Cfg {
        let osc = |base: usize| OscCfg {
            on: self.v(base + p::osc::ON) > 0.5,
            table: self.v(base + p::osc::TABLE) as usize,
            pos: self.v(base + p::osc::POS),
            tune: self.v(base + p::osc::OCT) * 12.0 + self.v(base + p::osc::SEMI) + self.v(base + p::osc::FINE) / 100.0,
            level: db_gain(self.v(base + p::osc::LEVEL)),
            unison: self.v(base + p::osc::UNISON) as usize,
            detune: self.v(base + p::osc::DETUNE),
            blend: self.v(base + p::osc::BLEND),
            width: self.v(base + p::osc::WIDTH),
            warp: self.v(base + p::osc::WARP) as u32,
            warp_amt: self.v(base + p::osc::WARP_AMT),
            phase: self.v(base + p::osc::PHASE),
            rand: self.v(base + p::osc::RAND),
            stack: self.v(base + p::osc::STACK) as usize,
            pan: self.v(base + p::osc::PAN),
            route: self.v(base + p::osc::ROUTE) as usize,
        };
        let lfo = |k: usize| {
            let base = p::LFO_1 + k * p::LFO_LEN;
            let sync = self.v(base + p::lfo::SYNC) > 0.5;
            let hz = if sync { self.tempo / 60.0 / p::SYNC_BEATS[self.v(base + p::lfo::DIV) as usize] } else { self.v(base + p::lfo::HZ) };
            let mode = self.v(base + p::lfo::MODE) as usize;
            let fade = self.v(base + p::lfo::FADE);
            let more = p::LFO_MORE_1 + k * p::LFO_MORE_LEN;
            let delay = self.v(more + p::lfo::DELAY);
            LfoCfg {
                shape: self.v(base + p::lfo::SHAPE) as u32,
                hz,
                mode,
                phase: self.v(base + p::lfo::PHASE),
                fade,
                dest: [self.v(base + p::lfo::DEST1) as usize, self.v(base + p::lfo::DEST2) as usize],
                amt: [self.v(base + p::lfo::AMT1), self.v(base + p::lfo::AMT2)],
                global: mode == 0 && fade <= 0.0011 && delay <= 0.0,
                synced: sync,
                beats: p::SYNC_BEATS[self.v(base + p::lfo::DIV) as usize],
                retrig: self.v(more + p::lfo::RETRIG) as usize,
                delay,
                smooth: self.v(more + p::lfo::SMOOTH),
                keytrack: self.v(more + p::lfo::KEYTRACK),
                sustain: self.v(more + p::lfo::SUSTAIN),
            }
        };
        let filt = |kind: usize, cutoff: usize, reso: usize, key: usize, env: usize| FiltCfg {
            kind: self.v(kind) as usize,
            cutoff: self.v(cutoff),
            reso: self.v(reso),
            keytrack: self.v(key),
            env: self.v(env),
        };
        let shape = |w: usize| {
            let base = p::SHAPE_1 + w * p::SHAPE_LEN;
            let mut s = [0.0; 16];
            for (i, x) in s.iter_mut().enumerate() {
                *x = self.v(base + i);
            }
            (s, self.v(base + 16))
        };
        let (d1, s1) = shape(0);
        let (d2, s2) = shape(1);
        let lfos = [lfo(0), lfo(1), lfo(2), lfo(3)];
        let mut slots = [Slot::default(); p::SLOTS_ALL];
        for (i, slot) in slots.iter_mut().enumerate() {
            let base = p::slot_base(i);
            let more = p::slot_more(i);
            let (from, via) = (self.v(base) as usize, self.v(more + 1) as usize);
            *slot = Slot {
                from,
                to: self.v(base + 1) as usize,
                amt: self.v(base + 2),
                curve: self.v(more) as usize,
                via,
                note: note_source(&lfos, from) || (via > 0 && note_source(&lfos, via)),
            };
        }
        let stage = |kind: usize, db: usize, mix: usize, crush: usize, tone: Option<usize>| DriveCfg {
            kind: self.v(kind) as u32,
            db: self.v(db),
            mix: self.v(mix),
            crush: self.v(crush),
            tone: tone.map_or(0.0, |t| self.v(t)),
        };
        let o = [osc(p::A), osc(p::B)];
        let noise_route = self.v(p::NOISE_ROUTE) as usize;
        let serial = self.v(p::F2_SERIAL) > 0.5;
        let to_f2 = |r: usize| r == 1 || r == 2;
        let delay_sync = self.v(p::DELAY_ON + 1) > 0.5;
        let delay_time = if delay_sync { p::SYNC_BEATS[self.v(p::DELAY_ON + 2) as usize] * 60.0 / self.tempo } else { self.v(p::DELAY_ON + 3) / 1000.0 };
        let fx = FxCfg {
            eq: self.v(p::EQ_ON) > 0.5,
            eq_low: (self.v(p::EQ_ON + 2), self.v(p::EQ_ON + 1)),
            eq_mid: (self.v(p::EQ_ON + 4), self.v(p::EQ_ON + 3)),
            eq_high: (self.v(p::EQ_ON + 6), self.v(p::EQ_ON + 5)),
            chorus: self.v(p::CHORUS_ON) > 0.5,
            chorus_rate: self.v(p::CHORUS_ON + 1),
            chorus_depth: self.v(p::CHORUS_ON + 2),
            chorus_mix: self.v(p::CHORUS_ON + 3),
            chorus_spread: self.v(p::EVEN_KEYS) > 0.5,
            phaser: self.v(p::PHASER_ON) > 0.5,
            flanger: self.v(p::PHASER_ON + 1) > 0.5,
            phaser_rate: self.v(p::PHASER_ON + 2),
            phaser_depth: self.v(p::PHASER_ON + 3),
            phaser_fb: self.v(p::PHASER_ON + 4),
            phaser_mix: self.v(p::PHASER_ON + 5),
            delay: self.v(p::DELAY_ON) > 0.5,
            // (Past the 8 s line, halved until it fits: still on the beat)
            delay_time: {
                let mut t = delay_time;
                while t > 8.0 {
                    t *= 0.5;
                }
                t
            },
            delay_fb: self.v(p::DELAY_ON + 4),
            delay_pingpong: self.v(p::DELAY_ON + 5) > 0.5,
            delay_tone: self.v(p::DELAY_ON + 6),
            delay_mix: self.v(p::DELAY_ON + 7),
            reverb: self.v(p::REVERB_ON) > 0.5,
            reverb_size: self.v(p::REVERB_ON + 1),
            reverb_decay: self.v(p::REVERB_ON + 2),
            reverb_tone: self.v(p::REVERB_ON + 3),
            reverb_pre: self.v(p::REVERB_ON + 4),
            reverb_mix: self.v(p::REVERB_ON + 5),
        };
        Cfg {
            osc: o,
            fm: self.v(p::FM),
            sub: db_gain(self.v(p::SUB_LEVEL)),
            sub_div: if self.v(p::SUB_OCT) > 0.5 { 0.25 } else { 0.5 },
            noise: db_gain(self.v(p::NOISE)),
            noise_route,
            filt: [
                filt(p::FILTER_TYPE, p::CUTOFF, p::RESO, p::KEYTRACK, p::FENV_AMT),
                filt(p::F2_TYPE, p::F2_CUTOFF, p::F2_RESO, p::F2_KEYTRACK, p::F2_ENV),
            ],
            fdrive: self.v(p::FILTER_DRIVE),
            serial,
            f2_used: serial || (o[0].on && to_f2(o[0].route)) || (o[1].on && to_f2(o[1].route)) || to_f2(noise_route),
            amp: [self.v(p::AMP_A), self.v(p::AMP_D), self.v(p::AMP_S), self.v(p::AMP_R)],
            fadsr: [self.v(p::FENV_A), self.v(p::FENV_D), self.v(p::FENV_S), self.v(p::FENV_R)],
            madsr: [self.v(p::MENV_A), self.v(p::MENV_A + 1), self.v(p::MENV_A + 2), self.v(p::MENV_A + 3)],
            penv: self.v(p::PENV_AMT),
            pdecay: self.v(p::PENV_D),
            shaper: self.v(p::SHAPER) as u32,
            drive: self.v(p::DRIVE),
            drive_mix: self.v(p::DRIVE_MIX),
            drive_crush: self.v(p::DRIVE_CRUSH),
            drive_tone: self.v(p::DRIVE_TONE),
            pre: stage(p::PRE_SHAPER, p::PRE_DRIVE, p::PRE_MIX, p::PRE_CRUSH, None),
            band: stage(p::BAND_SHAPER, p::BAND_DRIVE, p::BAND_MIX, p::BAND_CRUSH, Some(p::BAND_TONE)),
            band_split: (self.v(p::BAND_LOW), self.v(p::BAND_HIGH)),
            band_high: self.v(p::BAND_HIGH_AMT),
            sub_after: self.v(p::SUB_PATH) > 0.5,
            glide_legato: self.v(p::GLIDE_MODE) > 0.5,
            glide_rate: self.v(p::GLIDE_RATE) > 0.5,
            glide_linear: self.v(p::GLIDE_CURVE) > 0.5,
            penv_linear: self.v(p::PENV_CURVE) > 0.5,
            mono_restart: self.v(p::MONO_RESTART) > 0.5,
            mono_below: self.v(p::MONO_BELOW),
            random_by_step: self.v(p::RANDOM_BY_STEP) > 0.5,
            even_keys: self.v(p::EVEN_KEYS) > 0.5,
            detune_key: self.v(p::DETUNE_KEY),
            chaos_beats: p::SYNC_BEATS[self.v(p::CHAOS_DIV) as usize],
            chaos_smooth: self.v(p::CHAOS_SMOOTH),
            random_cycle: p::RANDOM_CYCLE_BEATS[self.v(p::RANDOM_CYCLE) as usize],
            lfo: lfos,
            drawn: [d1, d2],
            smooth: [s1, s2],
            slots,
            macros: [self.v(p::MACRO_1), self.v(p::MACRO_1 + 1), self.v(p::MACRO_1 + 2), self.v(p::MACRO_1 + 3)],
            mode: self.v(p::MODE) as usize,
            glide: self.v(p::GLIDE),
            bend_range: self.v(p::BEND),
            vel: self.v(p::VELOCITY),
            fx,
            ott: self.v(p::OTT),
            ott_time: self.v(p::OTT_TIME),
            width: self.v(p::WIDTH),
            level: db_gain(self.v(p::LEVEL)),
        }
    }

    // ---------- notes ----------

    pub fn midi(&mut self, status: u8, d1: u8, d2: u8) {
        match status & 0xF0 {
            0x90 if d2 > 0 => self.note_on(d1, d2 as f32 / 127.0),
            0x80 => self.note_off(d1, d2 as f32 / 127.0),
            0x90 => self.note_off(d1, 0.0),
            0xE0 => {
                let v = ((d2 as i32) << 7 | d1 as i32) - 8192;
                self.bend = v as f32 / 8192.0;
            }
            0xD0 => self.aftertouch = d1 as f32 / 127.0,
            0xA0 => {
                self.aftertouch = d2 as f32 / 127.0;
                for v in self.voices.iter_mut().filter(|v| v.active && v.note == d1) {
                    v.pressure = d2 as f32 / 127.0;
                }
            }
            0xB0 => match d1 {
                1 => self.modwheel = d2 as f32 / 127.0,
                64 => {
                    self.pedal = d2 >= 64;
                    if !self.pedal {
                        for v in self.voices.iter_mut().filter(|v| v.sustained) {
                            v.sustained = false;
                            v.release();
                        }
                    }
                }
                120 | 123 => self.all_off(d1 == 120),
                _ => {}
            },
            _ => {}
        }
    }

    fn all_off(&mut self, hard: bool) {
        self.stack.clear();
        self.down = [0; 128];
        // (A stop mid-pedal mustn't leave the pedal down for the next playback)
        self.pedal = false;
        for v in self.voices.iter_mut() {
            v.sustained = false;
            v.pending = None;
            v.pending_up = false;
            v.short_left = 0;
            if hard {
                v.active = false;
                v.amp = Env::default();
            } else {
                v.release();
            }
        }
    }

    fn note_on(&mut self, note: u8, vel: f32) {
        self.down[note as usize & 127] = self.down[note as usize & 127].saturating_add(1);
        self.stack.retain(|&n| n != note);
        if self.stack.len() < 32 {
            self.stack.push(note);
        }
        let cfg = self.cfg();
        self.struck[note as usize & 127] = self.song_beats;
        self.chord_place(note, &cfg);
        if self.anchored {
            // Random values from where in the song this note is, and which note (not from what
            // played before): the same notes from the same place sound the same, live or exported
            // (Within the random cycle, when there is one: a riff that repeats sounds the same)
            let at = if cfg.random_cycle > 0.0 { self.song_beats.rem_euclid(cfg.random_cycle) } else { self.song_beats };
            // ("Even keyboard": its place in a chord struck at once, not its pitch, so a riff on
            // other notes starts each step as it did, and neighbouring notes alike)
            let which = if cfg.even_keys { self.struck_k[note as usize & 127] } else { note };
            self.rng = Rng::new((hash01(ticks(at) << 8 ^ which as u64 ^ 0x5eed_0000_0000) * 4_294_967_000.0) as u32);
        }
        if cfg.mode > 0 {
            // Mono and legato: one voice; legato keeps the envelopes going between joined notes
            let sr = self.sr;
            let (nr, nb) = self.note_random(note, &cfg);
            let v = &mut self.voices[0];
            let joined = v.active && v.amp.stage != Stage::Release && v.amp.stage != Stage::Idle;
            v.glide = v.pitch - note as f32;
            // (Glide only between joined notes: a note after a gap starts on its pitch)
            if cfg.glide_legato && !joined {
                v.pitch = note as f32;
                v.glide = 0.0;
            }
            set_glide(v, &cfg, sr);
            v.target = note as f32;
            v.note = note;
            // A new note: new random values, even when it joins the last (legato)
            v.nrand = nr;
            v.nrand_bi = nb;
            v.nrand_at = self.struck[note as usize & 127];
            v.rel_vel = 0.0;
            // A key is down now: lifting the pedal mustn't end it
            v.sustained = false;
            // (Nor anything poly left waiting on this voice: a taken note, a short note's timer)
            v.pending = None;
            v.pending_up = false;
            v.short_left = 0;
            if !(joined && cfg.mode == 2) {
                if !v.active {
                    v.pitch = note as f32;
                    v.glide = 0.0;
                }
                if cfg.mono_restart && !joined && v.active {
                    // (An LFO set never to restart runs on through it, as ever)
                    let kept = (v.lfo_phase, v.lfo_held, v.lfo_sm);
                    self.retire_mono();
                    self.start(0, note, vel, &cfg, false, joined);
                    let v = &mut self.voices[0];
                    for k in 0..4 {
                        if cfg.lfo[k].mode > 0 && cfg.lfo[k].retrig == 3 {
                            v.lfo_phase[k] = kept.0[k];
                            v.lfo_held[k] = kept.1[k];
                            v.lfo_sm[k] = kept.2[k];
                        }
                    }
                } else {
                    self.start(0, note, vel, &cfg, false, joined);
                }
            } else {
                // A joined legato note: LFOs set to restart on every note do
                let v = &mut self.voices[0];
                for k in 0..4 {
                    if cfg.lfo[k].mode > 0 && cfg.lfo[k].retrig == 1 {
                        v.lfo_phase[k] = cfg.lfo[k].phase;
                    }
                }
            }
            return;
        }
        // Poly: the same note struck again while it rings on (pedal held, or letting go) plays
        // again on its own voice: copies in step would stack up far louder. It goes the way a
        // taken voice does (a 3 ms fade, then a fresh start), so a new velocity or random value
        // never jumps in on a ringing note
        // (Struck again while it waits for its voice: it still waits there, the key down again)
        if let Some(i) = (0..VOICES).find(|&i| self.voices[i].pending.map(|(n, _)| n) == Some(note)) {
            self.voices[i].pending = Some((note, vel));
            self.voices[i].pending_up = false;
            return;
        }
        if let Some(i) = (0..VOICES).find(|&i| {
            let v = &self.voices[i];
            v.active && v.note == note && v.pending.is_none() && (v.sustained || v.amp.stage == Stage::Release || v.short_left > 0)
        }) {
            self.voices[i].pending = Some((note, vel));
            return;
        }
        // Else a free voice, else the quietest released one, else the oldest (faded out first)
        let free = self.voices.iter().position(|v| !v.active && v.pending.is_none());
        // (A voice already taken for a note waiting to start isn't taken again: each note of a
        // chord played over full voices gets its own)
        let open = |i: &usize| self.voices[*i].pending.is_none();
        let i = free.unwrap_or_else(|| {
            // (Notes the pedal holds after their key came up count as let go: a key still down
            // is the last to be taken)
            let released = (0..VOICES).filter(open).filter(|&i| self.voices[i].amp.stage == Stage::Release || self.voices[i].sustained || self.voices[i].short_left > 0).min_by(|&a, &b| self.voices[a].amp.value.partial_cmp(&self.voices[b].amp.value).unwrap());
            released.or_else(|| (0..VOICES).filter(open).min_by_key(|&i| self.voices[i].age)).unwrap_or_else(|| (0..VOICES).min_by_key(|&i| self.voices[i].age).unwrap())
        });
        if self.voices[i].active {
            // Taken while sounding: fade it out over 3 ms, then start the new note (its key is
            // down, whatever the note it replaces was doing)
            self.voices[i].pending = Some((note, vel));
            self.voices[i].pending_up = false;
            return;
        }
        self.voices[i].pitch = note as f32;
        self.voices[i].target = note as f32;
        self.voices[i].glide = 0.0;
        self.start(i, note, vel, &cfg, true, false);
    }

    /// Mono restart: the mono voice's last note (still letting go) moves to a spare voice and fades
    /// out there over 3 ms, and the mono voice is left free for the new note to start afresh on
    /// (its pitch and glide kept, so a glide still glides).
    fn retire_mono(&mut self) {
        let spare = (1..VOICES).find(|&i| !self.voices[i].active && self.voices[i].pending.is_none()).or_else(|| {
            // (Else the quietest one letting go, or no fade at all: never a voice still held)
            (1..VOICES).filter(|&i| self.voices[i].pending.is_none() && (self.voices[i].amp.stage == Stage::Release || self.voices[i].dying)).min_by(|&a, &b| self.voices[a].amp.value.partial_cmp(&self.voices[b].amp.value).unwrap())
        });
        if let Some(j) = spare {
            let mut old = self.voices[0].clone();
            old.release();
            old.sustained = false;
            old.short_left = 0;
            old.dying = true;
            self.voices[j] = old;
        }
        self.voices[0].active = false;
    }

    /// `note` has just been struck: its place among the notes struck at this moment (a chord's,
    /// 0, 1, 2... from the lowest), and so the places of the others, which move up when a lower
    /// note comes after them. Their voices started at this moment (no sound yet between them)
    /// take their new places' random values, so a chord sounds the same whatever order its
    /// notes came in.
    fn chord_place(&mut self, note: u8, cfg: &Cfg) {
        let bit = 1u128 << (note & 127);
        self.strike = if self.strike.0 == self.song_beats { (self.song_beats, self.strike.1 | bit) } else { (self.song_beats, bit) };
        let keys = self.strike.1;
        let mut k = 0u8;
        for n in 0..128usize {
            if keys >> n & 1 == 1 {
                self.struck_k[n] = k;
                k = k.saturating_add(1);
            }
        }
        if !cfg.random_by_step {
            return;
        }
        let now = self.song_beats;
        for i in 0..VOICES {
            let v = &self.voices[i];
            if v.active && v.pending.is_none() && v.nrand_at == now && keys >> (v.note & 127) & 1 == 1 {
                let (nr, nb) = self.note_random(v.note, cfg);
                let v = &mut self.voices[i];
                v.nrand = nr;
                v.nrand_bi = nb;
            }
        }
    }

    /// The note-random values (0..1 and -1..1) for `note` played now: seeded from the song
    /// position (within the random cycle) and the note's place in a chord struck at once
    /// (lowest first), not its pitch, so they repeat in every render of the same notes, and a
    /// riff that comes round on other notes (the next chord's root) has each step sound as it
    /// did. (Older sounds, before "Random by step": from the position and the pitch, as then.)
    fn note_random(&self, note: u8, cfg: &Cfg) -> (f32, f32) {
        let at = self.struck[note as usize & 127];
        let at = if cfg.random_cycle > 0.0 { at.rem_euclid(cfg.random_cycle) } else { at };
        let which = if cfg.random_by_step { self.struck_k[note as usize & 127] } else { note };
        let key = ticks(at) << 8 ^ which as u64;
        (hash01(key ^ 0x0a11_0000_0000_0000), hash_bi(key ^ 0x0b22_0000_0000_0000))
    }

    /// Start note `note` on voice `i`. `fresh`: a voice of its own (poly); `joined`: a mono note
    /// played while the last one was still held.
    fn start(&mut self, i: usize, note: u8, vel: f32, cfg: &Cfg, fresh: bool, joined: bool) {
        self.age += 1;
        let sr = self.sr;
        let seed = self.rng.next();
        let rand = self.rng.bipolar();
        // Fresh random levels for the LFOs that start with the note (Steps and Drift are random
        // from the note's first cycle, and in One shot, which never wraps to draw new ones)
        let held: [(f32, f32); 4] = std::array::from_fn(|_| (self.rng.bipolar(), self.rng.bipolar()));
        let (nr, nb) = self.note_random(note, cfg);
        let v = &mut self.voices[i];
        let was_active = v.active;
        v.nrand = nr;
        v.nrand_bi = nb;
        v.nrand_at = self.struck[note as usize & 127];
        v.rel_vel = 0.0;
        v.pressure = 0.0;
        v.active = true;
        v.note = note;
        v.vel = vel;
        v.age = self.age;
        v.sustained = false;
        v.pending = None;
        v.pending_up = false;
        v.short_left = 0;
        v.dying = false;
        // (A retrigger of a sounding voice, mono say, carries on from its level and fade)
        if fresh || !was_active {
            v.fade = 1.0;
        }
        // (The velocity's gain eases from the level that is heard; from a silent tail it snaps,
        // as a new note's does)
        v.carry = if fresh || !was_active { 0.0 } else { v.amp.value * v.fade * v.gain_now.max(0.0) };
        if fresh || !was_active || v.carry < 1e-4 {
            v.gain_now = -1.0;
        }
        v.time = 0.0;
        v.rand = rand;
        if fresh || !was_active {
            // A new note's envelopes start from nothing (not the level of the note the voice had)
            v.amp.value = 0.0;
            v.fenv.value = 0.0;
            v.menv.value = 0.0;
        }
        v.amp.set(cfg.amp[0], cfg.amp[1], cfg.amp[2], cfg.amp[3], sr);
        v.fenv.set(cfg.fadsr[0], cfg.fadsr[1], cfg.fadsr[2], cfg.fadsr[3], sr);
        v.menv.set(cfg.madsr[0], cfg.madsr[1], cfg.madsr[2], cfg.madsr[3], sr);
        v.amp.gate(true);
        v.fenv.gate(true);
        v.menv.gate(true);
        v.penv = 1.0;
        for k in 0..4 {
            let l = &cfg.lfo[k];
            // (Mono and legato: as its retrigger says. A voice starting from silence always starts it)
            let restart = fresh
                || !was_active
                || match l.retrig {
                    2 => !joined,
                    3 => false,
                    _ => true,
                };
            if l.mode > 0 && restart {
                v.lfo_phase[k] = l.phase;
                v.lfo_held[k] = held[k];
            }
            if fresh || !was_active {
                v.lfo_sm[k] = f32::NAN;
            }
        }
        if fresh || !was_active {
            // Each oscillator starts at its phase, plus as much randomness as asked; unison
            // voices each start at a random point of their cycle (seeded, so renders repeat)
            let mut r = Rng::new((seed * 4_000_000_000.0) as u32 ^ 0x5bd1_e995);
            for o in 0..2 {
                let oc = &cfg.osc[o];
                let start = oc.phase + oc.rand * r.next();
                for u in 0..UNISON {
                    let spread = if oc.unison > 1 { r.next() } else { 0.0 };
                    v.phase[o][u] = (start + spread).fract();
                }
            }
            v.sub_phase = 0.0;
            v.last_a = 0.0;
            for f in 0..2 {
                for c in 0..2 {
                    v.filt[f][c].reset();
                }
            }
            for c in 0..2 {
                v.post[c].reset();
                v.pre[c].reset();
                v.pre[c + 2].reset();
                v.cab[c] = Cab::default();
            }
        }
    }

    fn note_off(&mut self, note: u8, rel_vel: f32) {
        let k = note as usize & 127;
        for v in self.voices.iter_mut().filter(|v| v.active && v.note == note) {
            v.rel_vel = rel_vel;
        }
        self.down[k] = self.down[k].saturating_sub(1);
        // (Another strike of this key still down: only one of its notes ends)
        let others_down = self.down[k] > 0;
        let mode = self.v(p::MODE) as usize;
        // (Mono and legato: the key is still down, so its note plays on, and stays in the stack)
        if mode > 0 && others_down {
            return;
        }
        self.stack.retain(|&n| n != note);
        // Mono and legato: back to the last key still held, gliding there without a new attack
        // (only the mono voice; voices left from playing in poly still end as usual)
        let mut glided = false;
        if mode > 0 && self.voices[0].note == note {
            if let Some(&back) = self.stack.last() {
                let cfg = self.cfg();
                let sr = self.sr;
                let v = &mut self.voices[0];
                v.glide = v.pitch - back as f32;
                set_glide(v, &cfg, sr);
                v.target = back as f32;
                v.note = back;
                glided = true;
            }
        }
        let pedal = self.pedal;
        // (Poly: one note-off ends one note, the oldest of that pitch still held, so a second,
        // overlapping note of the same pitch plays on to its own end)
        if mode == 0 && others_down {
            // (No more of its notes sounding than strikes still down, one lost to a steal or a
            // restrike merged into one voice: they all play on)
            let sounding = self.voices.iter().filter(|v| v.active && v.note == note && v.amp.stage != Stage::Release && !v.sustained && v.pending.is_none() && v.short_left == 0).count()
                + self.voices.iter().filter(|v| v.pending.map(|(n, _)| n) == Some(note) && !v.pending_up).count();
            if sounding <= self.down[k] as usize {
                return;
            }
            let held = (0..VOICES)
                .filter(|&i| {
                    let v = &self.voices[i];
                    v.active && v.note == note && v.amp.stage != Stage::Release && !v.sustained && v.pending.is_none() && v.short_left == 0
                })
                .min_by_key(|&i| self.voices[i].age);
            if let Some(i) = held {
                let v = &mut self.voices[i];
                if pedal {
                    v.sustained = true;
                } else {
                    v.release();
                }
                return;
            }
        }
        for (i, v) in self.voices.iter_mut().enumerate() {
            if !v.active || v.note != note || v.amp.stage == Stage::Release || (i == 0 && glided) {
                continue;
            }
            if pedal {
                v.sustained = true;
            } else {
                v.release();
            }
        }
        for v in self.voices.iter_mut() {
            if v.pending.map(|(n, _)| n) == Some(note) {
                // The note waiting for this voice ended before it began (a very short note): it
                // still sounds, and ends (or is held by the pedal) as soon as it starts
                v.pending_up = true;
            }
        }
    }

    // ---------- sound ----------

    /// Render `frames` (up to BLOCK) into `out`.
    pub fn process(&mut self, frames: usize) {
        let frames = frames.min(BLOCK);
        let cfg = self.cfg();
        let sr = self.sr;
        let nblk = frames.div_ceil(CONTROL).max(1);
        let spread = [Spread::new(&cfg.osc[0], cfg.osc[0].detune, 1.0), Spread::new(&cfg.osc[1], cfg.osc[1].detune, 1.0)];
        for c in 0..2 {
            self.out[c][..frames].fill(0.0);
        }
        let rate: [f32; 4] = std::array::from_fn(|k| cfg.lfo[k].hz * 2f32.powf(3.0 * self.lfo_rate_mod[k].clamp(-1.0, 1.0)));

        // Where in the song each stretch of CONTROL samples starts (beats, seconds)
        let beat_step = self.tempo as f64 / 60.0 / sr as f64;
        let (song_beats, song_secs) = (self.song_beats, self.song_secs);
        let beats_at = |b: usize| song_beats + (b * CONTROL) as f64 * beat_step;
        let secs_at = |b: usize| song_secs + (b * CONTROL) as f64 / sr as f64;

        // The free LFOs run here, shared by every note
        let mut shared = [[0.0f32; NBLK]; 4];
        for k in 0..4 {
            let l = &cfg.lfo[k];
            if l.mode != 0 {
                continue;
            }
            // (Once the host says where the song is, a free LFO's phase is read from the song
            // position: the same place in the song, the same point of its cycle. Not while
            // something moves its rate: then it runs on from where it is)
            let follow = self.anchored && self.lfo_rate_mod[k] == 0.0;
            for (b, slot) in shared[k].iter_mut().enumerate().take(nblk) {
                let n = frames.saturating_sub(b * CONTROL).min(CONTROL);
                if follow {
                    let cycles = if l.synced { beats_at(b) / l.beats as f64 } else { secs_at(b) * l.hz as f64 };
                    let x = cycles + l.phase as f64;
                    let ph = x.fract() as f32;
                    let cycle = x.floor() as i64 as u64;
                    let salt = (k as u64) << 60 ^ 0x1f0_0000_0000;
                    self.lfo_held[k] = (hash_bi(salt ^ cycle.wrapping_sub(1)), hash_bi(salt ^ cycle));
                    self.lfo_read[k] = ph;
                    *slot = lfo_value(&cfg, k, ph, self.lfo_held[k]);
                    self.lfo_phase[k] = (cycles + (n as f64 * if l.synced { beat_step / l.beats as f64 } else { l.hz as f64 / sr as f64 })).fract() as f32;
                } else {
                    let ph = (self.lfo_phase[k] + l.phase).fract();
                    // Steps and Drift move to their next level where the cycle (as read, with its
                    // phase offset) starts again, so they never jump mid-cycle
                    if ph < self.lfo_read[k] {
                        self.lfo_held[k] = (self.lfo_held[k].1, self.rng.bipolar());
                    }
                    self.lfo_read[k] = ph;
                    *slot = lfo_value(&cfg, k, ph, self.lfo_held[k]);
                    self.lfo_phase[k] = (self.lfo_phase[k] + rate[k] * n as f32 / sr).fract();
                }
                if l.smooth > 0.0 {
                    *slot = smooth_lfo(&mut self.lfo_sm[k], *slot, l.smooth, rate[k], n, sr);
                }
            }
        }
        // Chaos: a new random level each step of its division, read from the song position
        let mut chaos = [0.0f32; NBLK];
        for (b, c) in chaos.iter_mut().enumerate().take(nblk) {
            *c = chaos_at(&cfg, beats_at(b));
        }
        // The whole synth's modulation, each stretch of CONTROL samples (and its sources, which
        // the notes' routes read too)
        let mut gm = [[0.0f32; NDEST]; NBLK];
        let mut gs = [[0.0f32; NSRC]; NBLK];
        for (b, m) in gm.iter_mut().enumerate().take(nblk) {
            let s = &mut gs[b];
            for k in 0..4 {
                if cfg.lfo[k].global {
                    s[src::LFO + k] = shared[k][b];
                }
            }
            s[src::MW] = self.modwheel;
            s[src::AT] = self.aftertouch;
            s[src::BEND] = self.bend;
            for k in 0..4 {
                s[src::MACRO + k] = cfg.macros[k];
            }
            s[src::CHAOS] = chaos[b];
            route(&cfg, s, m, false);
            // A free LFO with a fade in is a note's source (each note fades it in its own time),
            // but the whole-synth targets (LFO rates, effect mixes, width) have no note: they
            // take it unfaded
            let mut faded = *s;
            let mut any = false;
            for k in 0..4 {
                if cfg.lfo[k].mode == 0 && !cfg.lfo[k].global {
                    faded[src::LFO + k] = shared[k][b];
                    any = true;
                }
            }
            if any {
                let mut extra = [0.0f32; NDEST];
                route(&cfg, &faded, &mut extra, true);
                for (t, (i, x)) in m.iter_mut().zip(extra.iter().enumerate()) {
                    if p::is_global_dest(i) {
                        *t += x;
                    }
                }
            }
        }
        for k in 0..4 {
            self.lfo_rate_mod[k] = gm[nblk - 1][d::LFO_RATE + k];
        }

        let glide = if cfg.mode > 0 && cfg.glide > 0.0015 { 1.0 - (-1.0 / (cfg.glide * sr / 3.0)).exp() } else { 1.0 };
        // (The classic glide: a constant time, exponential, from the knob as it is now. The others
        // were set by their note)
        let glide_classic = glide >= 1.0 || !(cfg.glide_rate || cfg.glide_linear);
        let fade_step = 1.0 / (0.003 * sr);
        let bend = self.bend * cfg.bend_range;
        let pdecay = (-1.0 / (cfg.pdecay * sr)).exp();
        let pstep = 1.0 / (cfg.pdecay * sr);
        let aftertouch = self.aftertouch;
        let cab_post = if cfg.drive_tone > 0.0 { Some(CabNow::new(cfg.drive_tone, sr)) } else { None };
        if cfg.sub_after {
            self.sub_bus[..frames].fill(0.0);
        }
        // (The user table, when there is one: a sound made into a table, see tables::user_table)
        let user = self.user.clone();
        let tab: [&Table; 2] = [0, 1].map(|o| {
            let i = cfg.osc[o].table;
            if i == p::USER_TABLE {
                user.as_deref().unwrap_or_else(|| table(0))
            } else {
                table(i)
            }
        });
        // White noise spreads over the whole band: scaled so the part we hear is as loud at any
        // sample rate (as now at 48 kHz)
        let noise_k = 0.5 * (sr / 48000.0).sqrt();
        // Envelope settings reach notes already playing (automation, a preset chosen mid-note)
        for v in self.voices.iter_mut().filter(|v| v.active) {
            v.amp.set(cfg.amp[0], cfg.amp[1], cfg.amp[2], cfg.amp[3], sr);
            v.fenv.set(cfg.fadsr[0], cfg.fadsr[1], cfg.fadsr[2], cfg.fadsr[3], sr);
            v.menv.set(cfg.madsr[0], cfg.madsr[1], cfg.madsr[2], cfg.madsr[3], sr);
        }

        for vi in 0..VOICES {
            if !self.voices[vi].active {
                continue;
            }
            let mut start = 0;
            while start < frames {
                let end = (start + CONTROL).min(frames);
                let blk = start / CONTROL;
                let n_here = (end - start) as f32;
                // ---- control: this note's modulation for these samples ----
                // (The whole synth's sources, and this note's)
                let mut s = gs[blk];
                {
                    let v = &mut self.voices[vi];
                    let held_key = v.amp.stage != Stage::Release;
                    for k in 0..4 {
                        let l = &cfg.lfo[k];
                        if l.global {
                            continue;
                        }
                        // (A delay holds it at its start, silent, until its time is up)
                        let waiting = l.delay > 0.0 && v.time < l.delay;
                        let val = if l.mode == 0 {
                            shared[k][blk]
                        } else {
                            let ph = if l.mode >= 2 { v.lfo_phase[k].min(0.9999) } else { v.lfo_phase[k] };
                            let val = lfo_value(&cfg, k, ph, v.lfo_held[k]);
                            let r = if l.keytrack > 0.0 { rate[k] * 2f32.powf(l.keytrack * (v.note as f32 - 60.0) / 12.0) } else { rate[k] };
                            if !waiting {
                                let was = v.lfo_phase[k];
                                v.lfo_phase[k] += r * n_here / sr;
                                if l.mode == 1 && v.lfo_phase[k] >= 1.0 {
                                    v.lfo_phase[k] -= v.lfo_phase[k].floor();
                                    v.lfo_held[k] = (v.lfo_held[k].1, self.rng.bipolar());
                                } else if l.mode == 2 {
                                    v.lfo_phase[k] = v.lfo_phase[k].min(1.0);
                                } else if l.mode == 3 {
                                    // Sustain env: holds at its sustain point while the key is down
                                    if held_key && was <= l.sustain && v.lfo_phase[k] > l.sustain {
                                        v.lfo_phase[k] = l.sustain;
                                    }
                                    v.lfo_phase[k] = v.lfo_phase[k].min(1.0);
                                }
                            }
                            val
                        };
                        let val = if l.smooth > 0.0 && l.mode > 0 { smooth_lfo(&mut v.lfo_sm[k], val, l.smooth, rate[k], n_here as usize, sr) } else { val };
                        let fade = if l.delay > 0.0 {
                            // (Fading in from the end of its delay: at least over 5 ms, never a step)
                            ((v.time - l.delay) / l.fade.max(0.005)).clamp(0.0, 1.0)
                        } else if l.fade > 0.0011 {
                            (v.time / l.fade).min(1.0)
                        } else {
                            1.0
                        };
                        s[src::LFO + k] = val * fade;
                    }
                    s[src::AMP] = v.amp.value;
                    s[src::FENV] = v.fenv.value;
                    s[src::MENV] = v.menv.value;
                    s[src::VEL] = v.vel;
                    s[src::NOTE] = ((v.pitch - 60.0) / 36.0).clamp(-1.0, 1.0);
                    s[src::RAND] = v.rand;
                    s[src::NRAND] = v.nrand;
                    s[src::NRAND_BI] = v.nrand_bi;
                    s[src::RELVEL] = v.rel_vel;
                    s[src::PRESS] = v.pressure.max(aftertouch);
                    v.time += n_here / sr;
                }
                let mut m = gm[blk];
                route(&cfg, &s, &mut m, true);
                let pend = self.voices[vi].pending;

                let v = &mut self.voices[vi];
                let pitch = v.pitch + bend + cfg.penv * v.penv + m[d::PITCH] * 12.0;
                let fa = 440.0 * 2f32.powf((pitch + cfg.osc[0].tune + m[d::APITCH] * 12.0 - 69.0) / 12.0);
                let fb = 440.0 * 2f32.powf((pitch + cfg.osc[1].tune + m[d::BPITCH] * 12.0 - 69.0) / 12.0);
                let inc = [fa / sr, fb / sr];
                // The sub follows the note itself (not oscillator A's tuning, which may be off)
                let sub_inc = 440.0 * 2f32.powf((pitch - 69.0) / 12.0) / sr * cfg.sub_div;
                // The detune narrows above middle C as far as "Detune key tracking" says (the
                // beating then speeds up less than the pitch does)
                let key = if cfg.detune_key > 0.0 && v.pitch > 60.0 { 2f32.powf(-cfg.detune_key * (v.pitch - 60.0) / 12.0) } else { 1.0 };
                let sp = [
                    if m[d::ADET] != 0.0 || key < 1.0 { Spread::new(&cfg.osc[0], (cfg.osc[0].detune + m[d::ADET]).clamp(0.0, 1.0), key) } else { spread[0] },
                    if m[d::BDET] != 0.0 || key < 1.0 { Spread::new(&cfg.osc[1], (cfg.osc[1].detune + m[d::BDET]).clamp(0.0, 1.0), key) } else { spread[1] },
                ];
                let warp = [(cfg.osc[0].warp_amt + m[d::AWARP]).clamp(0.0, 1.0), (cfg.osc[1].warp_amt + m[d::BWARP]).clamp(0.0, 1.0)];
                // The table level for each oscillator (and, "Even keyboard", how far into the next
                // one up it has faded)
                let level = |o: usize| {
                    let i = inc[o] * sp[o].top * warp_stretch(cfg.osc[o].warp, warp[o]);
                    if cfg.even_keys { level_blend(i, sr, 20000.0) } else { (level_for(i), 0.0) }
                };
                let (lvl, lw) = {
                    let (a, b) = (level(0), level(1));
                    ([a.0, b.0], [a.1, b.1])
                };
                let pos = [(cfg.osc[0].pos + m[d::APOS] * 0.5).clamp(0.0, 1.0), (cfg.osc[1].pos + m[d::BPOS] * 0.5).clamp(0.0, 1.0)];
                let gains = [cfg.osc[0].level * (1.0 + m[d::ALEVEL]).clamp(0.0, 2.0), cfg.osc[1].level * (1.0 + m[d::BLEVEL]).clamp(0.0, 2.0)];
                // FM: B into A's phase, deepest for low notes, held back on high ones (they'd fold)
                let fm_amt = (cfg.fm + m[d::FM]).clamp(0.0, 1.0);
                let fm = if cfg.osc[1].on { fm_amt * fm_amt * 2.5 * (330.0 / fa).clamp(0.05, 1.0).sqrt() } else { 0.0 };
                // The filters for these samples
                let fenv_now = v.fenv.value;
                let vpitch = v.pitch;
                let coef = |f: &FiltCfg, cut_m: f32, res_m: f32| {
                    let octaves = f.keytrack * (vpitch - 60.0) / 12.0 + f.env * fenv_now * 6.0 + cut_m * 5.0;
                    let cutoff = (f.cutoff * 2f32.powf(octaves)).clamp(16.0, sr * 0.45);
                    let reso = (f.reso + res_m * 0.5).clamp(0.0, 1.0);
                    // (The formant filter's vowel moves with the envelope too, not with the key)
                    let vowel = vowel_of(f.cutoff * 2f32.powf(f.env * fenv_now * 6.0 + cut_m * 5.0));
                    FiltCoef::new(f.kind, cutoff, reso, vowel, sr)
                };
                let c1 = coef(&cfg.filt[0], m[d::CUT1], m[d::RES1]);
                let c2 = if cfg.f2_used { coef(&cfg.filt[1], m[d::CUT2], m[d::RES2]) } else { FiltCoef::default() };
                let fdrive = (cfg.fdrive + m[d::FDRIVE]).clamp(0.0, 1.0);
                let fpre = 1.0 + 4.0 * fdrive;
                let drive_db = (cfg.drive + m[d::DRIVE] * 24.0).clamp(0.0, 48.0);
                let post = DriveNow::new(cfg.shaper, drive_db, cfg.drive_mix + m[d::DMIX], cfg.drive_crush + m[d::CRUSH]);
                let pre = if cfg.pre.kind > 0 {
                    DriveNow::new(cfg.pre.kind, cfg.pre.db + m[d::PRE_DRIVE] * 24.0, cfg.pre.mix, cfg.pre.crush + m[d::CRUSH]).level_kept(sr)
                } else {
                    DriveNow::default()
                };
                let vel_gain = 1.0 - cfg.vel * (1.0 - v.vel);
                let vol = vol_mod(m[d::VOL]);
                let sub_gain = cfg.sub * vol_mod(m[d::SUB]);
                let noise = cfg.noise * (1.0 + m[d::NOISE]).clamp(0.0, 2.0);
                let pan = m[d::PAN].clamp(-1.0, 1.0);
                let (pl, pr) = ((1.0 - pan).sqrt(), (1.0 + pan).sqrt());

                for n in start..end {
                    // Glide and the pitch envelope move per sample
                    // (Kept as a shrinking offset: small numbers keep their precision, so a long
                    // glide arrives in tune rather than stalling a few cents short)
                    if glide_classic {
                        v.glide *= 1.0 - glide;
                    } else if cfg.glide_linear {
                        v.glide = if v.glide.abs() <= v.glide_step { 0.0 } else { v.glide - v.glide_step.copysign(v.glide) };
                    } else {
                        v.glide *= 1.0 - v.glide_k;
                    }
                    v.pitch = v.target + v.glide;
                    if cfg.penv_linear {
                        v.penv = (v.penv - pstep).max(0.0);
                    } else {
                        v.penv *= pdecay;
                    }
                    let env = v.amp.tick();
                    v.fenv.tick();
                    v.menv.tick();
                    // The velocity's gain eases over about a millisecond; a part-faded voice no
                    // longer waiting for a note comes back up the same way
                    if v.gain_now < 0.0 {
                        v.gain_now = vel_gain;
                    }
                    v.gain_now += (vel_gain - v.gain_now) * fade_step * 3.0;
                    // (Only while a retrigger eases: a Velocity change on a held note eases as ever)
                    if v.carry > 0.0 && v.gain_now > vel_gain {
                        // (Easing down while the new attack climbs: no louder than was heard)
                        v.gain_now = v.gain_now.min((v.carry / (env * v.fade).max(1e-9)).max(vel_gain));
                    }
                    if v.gain_now <= vel_gain {
                        v.carry = 0.0;
                    }
                    if pend.is_none() && v.fade < 1.0 && v.amp.stage != Stage::Release {
                        v.fade = (v.fade + fade_step).min(1.0);
                    }
                    if pend.is_some() || v.dying {
                        v.fade -= fade_step;
                        if v.fade <= 0.0 {
                            break;
                        }
                    }
                    // Into filter 1, filter 2, or straight out; left and right
                    let mut bus = [[0.0f32; 2]; 3];
                    // Oscillator B first (A's FM and ring read it)
                    let mut modb = 0.0;
                    let mut first_a = 0.0;
                    for o in [1usize, 0] {
                        let oc = &cfg.osc[o];
                        if !oc.on {
                            continue;
                        }
                        let spr = &sp[o];
                        let other = if o == 0 { modb } else { v.last_a };
                        let ph = &mut v.phase[o];
                        let mut acc = [0.0f32; 2];
                        for u in 0..spr.n {
                            let mut read = warp_phase(oc.warp, warp[o], ph[u]);
                            if o == 0 && fm > 0.0 {
                                read = (read + fm * modb).rem_euclid(1.0);
                            }
                            let raw = tab[o].read_blend(lvl[o], lw[o], pos[o], read);
                            let smp = warp_amp(oc.warp, warp[o], raw, other);
                            if u == 0 {
                                if o == 1 {
                                    modb = smp;
                                } else {
                                    // (Before its own warp: two rings at once can't silence each other)
                                    first_a = raw;
                                }
                            }
                            acc[0] += smp * spr.gl[u];
                            acc[1] += smp * spr.gr[u];
                            ph[u] += inc[o] * spr.ratio[u];
                            if ph[u] >= 1.0 {
                                ph[u] -= ph[u].floor();
                            }
                        }
                        send(&mut bus, oc.route, acc[0] * gains[o], acc[1] * gains[o]);
                    }
                    v.last_a = first_a;
                    if noise > 0.0 {
                        let nz = self.rng.bipolar() * noise * noise_k;
                        send(&mut bus, cfg.noise_route, nz, nz);
                    }
                    // Filters and drive, each side
                    let mut outc = [0.0f32; 2];
                    for c in 0..2 {
                        let mut x1 = bus[0][c] * 0.8;
                        if fdrive > 0.0 {
                            x1 = fast_tanh(x1 * fpre) / fpre.sqrt();
                        }
                        let mut x2 = bus[1][c] * 0.8;
                        // The drive before the filters (what goes to each)
                        if pre.on() {
                            x1 = v.pre[c].tick(&pre, x1);
                            if cfg.f2_used {
                                // (Its own state: filter 2's input is another sound)
                                x2 = v.pre[c + 2].tick(&pre, x2);
                            }
                        }
                        let y1 = v.filt[0][c].tick(&c1, x1);
                        let filtered = if cfg.serial {
                            v.filt[1][c].tick(&c2, y1 + x2)
                        } else if cfg.f2_used {
                            y1 + v.filt[1][c].tick(&c2, x2)
                        } else {
                            y1
                        };
                        let y = filtered + bus[2][c] * 0.8;
                        outc[c] = if post.on() {
                            let w = v.post[c].tick(&post, y);
                            match &cab_post {
                                Some(cab) => v.cab[c].tick(cab, w),
                                None => w,
                            }
                        } else {
                            y
                        };
                    }
                    // The sub: a sine under it all, clean (no filter, no drive) and in the middle
                    let mut sub = 0.0;
                    if sub_gain > 0.0 {
                        sub = (2.0 * std::f32::consts::PI * v.sub_phase).sin() * sub_gain * 0.5;
                        v.sub_phase += sub_inc;
                        if v.sub_phase >= 1.0 {
                            v.sub_phase -= 1.0;
                        }
                    }
                    let a = env * v.gain_now * vol * v.fade;
                    if cfg.sub_after {
                        self.out[0][n] += outc[0] * pl * a;
                        self.out[1][n] += outc[1] * pr * a;
                        self.sub_bus[n] += sub * a;
                    } else {
                        self.out[0][n] += (outc[0] * pl + sub) * a;
                        self.out[1][n] += (outc[1] * pr + sub) * a;
                    }
                }
                // A very short note's time is up: it lets go, or the pedal holds it
                if self.voices[vi].short_left > 0 {
                    let seg = (end - start) as u32;
                    let v = &mut self.voices[vi];
                    if v.short_left <= seg {
                        v.short_left = 0;
                        if self.pedal {
                            v.sustained = true;
                        } else {
                            v.release();
                        }
                    } else {
                        v.short_left -= seg;
                    }
                }
                // A mono note's last one, faded out: done
                if self.voices[vi].dying && self.voices[vi].pending.is_none() && self.voices[vi].fade <= 0.0 {
                    self.voices[vi].active = false;
                    self.voices[vi].dying = false;
                    break;
                }
                // A voice taken for a new note: once faded out, the new note starts here
                if let Some((note, vel)) = self.voices[vi].pending {
                    // (Or its old note ended on its own before the fade did)
                    if self.voices[vi].fade <= 0.0 || self.voices[vi].amp.stage == Stage::Idle {
                        self.voices[vi].active = false;
                        self.voices[vi].pitch = note as f32;
                        self.voices[vi].target = note as f32;
                        self.voices[vi].glide = 0.0;
                        let up = self.voices[vi].pending_up;
                        self.start(vi, note, vel, &cfg, true, false);
                        if up {
                            // (As long as the fade it waited through: long enough to be heard)
                            self.voices[vi].short_left = ((0.003 * sr) as u32).max(CONTROL as u32);
                        }
                    }
                }
                if self.voices[vi].amp.stage == Stage::Idle {
                    self.voices[vi].active = false;
                    break;
                }
                start = end;
            }
        }

        // ---- the output stage ----
        if cfg.ott > 0.0 && !self.ott_on {
            self.ott.reset();
        }
        // The voices' DC out first (a lopsided drive or warp leaves an offset that thumps)
        let dc_r = 1.0 - 2.0 * std::f32::consts::PI * 5.0 / sr;
        for n in 0..frames {
            self.out[0][n] = self.dc[0].tick(self.out[0][n], dc_r);
            self.out[1][n] = self.dc[1].tick(self.out[1][n], dc_r);
        }
        // The multiband drive: lows clean, mids and highs driven
        if cfg.band.kind > 0 && cfg.band.mix > 0.0 {
            let lo = SvfCoef::new(cfg.band_split.0, sr, std::f32::consts::SQRT_2);
            let hi = SvfCoef::new(cfg.band_split.1.min(sr * 0.45), sr, std::f32::consts::SQRT_2);
            let cab = if cfg.band.tone > 0.0 { Some(CabNow::new(cfg.band.tone, sr)) } else { None };
            for b in 0..nblk {
                let dn = DriveNow::new(cfg.band.kind, cfg.band.db + gm[b][d::BAND_DRIVE] * 24.0, cfg.band.mix, cfg.band.crush).level_kept(sr);
                for n in b * CONTROL..((b + 1) * CONTROL).min(frames) {
                    for c in 0..2 {
                        let st = &mut self.band[c];
                        let (low, mid, high) = st.split(&lo, &hi, self.out[c][n]);
                        let dm = st.drive[0].tick(&dn, mid);
                        let dh = high + (st.drive[1].tick(&dn, high) - high) * cfg.band_high;
                        let up = match &cab {
                            Some(cb) => st.cab.tick(cb, dm + dh),
                            None => dm + dh,
                        };
                        self.out[c][n] = low + up;
                    }
                }
            }
        } else {
            self.band = [Band::default(); 2];
        }
        self.ott_on = cfg.ott > 0.0;
        if cfg.ott > 0.0 {
            let att = 1.0 - (-1.0 / ((0.002 + 0.03 * cfg.ott_time) * sr)).exp();
            let rel = 1.0 - (-1.0 / ((0.03 + 0.4 * cfg.ott_time) * sr)).exp();
            for n in 0..frames {
                let (l, r) = self.ott.tick(self.out[0][n], self.out[1][n], cfg.ott, att, rel);
                self.out[0][n] = l;
                self.out[1][n] = r;
            }
        }
        let mut mods = [FxMods::default(); NBLK];
        for (b, fm) in mods.iter_mut().enumerate().take(nblk) {
            *fm = FxMods { chorus: gm[b][d::CHORUS], phaser: gm[b][d::PHASER], delay: gm[b][d::DELAY], reverb: gm[b][d::REVERB] };
        }
        {
            let [l, r] = &mut self.out;
            self.fx.process(l, r, frames, &cfg.fx, &mods, CONTROL);
        }
        let target = cfg.level;
        let gstep = 1.0 - (-1.0 / (0.01 * sr)).exp();
        if cfg.mono_below != self.side_f {
            self.side_f = cfg.mono_below;
            self.side_coef = SvfCoef::new(cfg.mono_below.min(sr * 0.45), sr, std::f32::consts::SQRT_2);
        }
        for n in 0..frames {
            let (mut l, mut r) = (self.out[0][n], self.out[1][n]);
            // The low end in mono: the side signal loses everything under "Mono below" (120 Hz in
            // older sounds); then the width
            let width = (cfg.width + gm[n / CONTROL][d::WIDTH]).clamp(0.0, 1.0);
            // (The clean sub joins here, in the middle, after the drive, the OTT and the effects)
            let mid = if cfg.sub_after { (l + r) * 0.5 + self.sub_bus[n] } else { (l + r) * 0.5 };
            let mut side = (l - r) * 0.5;
            let s1 = self.side_hp[0].tick(&self.side_coef, side).hp;
            side = self.side_hp[1].tick(&self.side_coef, s1).hp * width * 2.0;
            self.gain += (target - self.gain) * gstep;
            l = (mid + side) * self.gain;
            r = (mid - side) * self.gain;
            self.out[0][n] = self.clip[0].tick(l);
            self.out[1][n] = self.clip[1].tick(r);
        }
        self.song_beats += frames as f64 * beat_step;
        self.song_secs += frames as f64 / sr as f64;
    }
}

/// Send a sound to where `route` says: filter 1, filter 2, both (each a little less, so the two
/// together are as loud as one), or straight out.
#[inline]
fn send(bus: &mut [[f32; 2]; 3], route: usize, l: f32, r: f32) {
    match route {
        1 => {
            bus[1][0] += l;
            bus[1][1] += r;
        }
        2 => {
            const H: f32 = std::f32::consts::FRAC_1_SQRT_2;
            bus[0][0] += l * H;
            bus[0][1] += r * H;
            bus[1][0] += l * H;
            bus[1][1] += r * H;
        }
        3 => {
            bus[2][0] += l;
            bus[2][1] += r;
        }
        _ => {
            bus[0][0] += l;
            bus[0][1] += r;
        }
    }
}

/// The chaos source at song position `beats`: a random level per step of its division (steps
/// counted from the start of the random cycle, when there is one: they come round again), sliding
/// into the next over the last `chaos_smooth` of each step.
fn chaos_at(cfg: &Cfg, beats: f64) -> f32 {
    let steps_per_cycle = if cfg.random_cycle > 0.0 { (cfg.random_cycle / cfg.chaos_beats as f64).round().max(1.0) as u64 } else { u64::MAX };
    let x = beats / cfg.chaos_beats as f64;
    let step = (x.floor() as i64 as u64) % steps_per_cycle;
    let level = |s: u64| hash_bi(s ^ 0xc4a0_5000_0000_0000);
    let a = level(step);
    if cfg.chaos_smooth > 0.001 {
        let t = x.fract() as f32;
        let u = ((t - (1.0 - cfg.chaos_smooth)) / cfg.chaos_smooth).clamp(0.0, 1.0);
        a + (level((step + 1) % steps_per_cycle) - a) * u * u * (3.0 - 2.0 * u)
    } else {
        a
    }
}

/// An LFO's value smoothed: a lag of up to half its cycle (at Smooth 100 %), from `state` (NaN:
/// it starts at the value).
#[inline]
fn smooth_lfo(state: &mut f32, x: f32, smooth: f32, hz: f32, n: usize, sr: f32) -> f32 {
    if state.is_nan() {
        *state = x;
        return x;
    }
    let tau = (smooth * smooth * 0.5 / hz.max(0.01)).max(1e-4);
    let k = 1.0 - (-(n as f32) / (tau * sr)).exp();
    *state += (x - *state) * k;
    *state
}

/// Set how voice `v`'s glide (its `glide` offset) gets home, for the glides worked out per note:
/// a constant rate (the knob's time per octave) or a straight line.
fn set_glide(v: &mut Voice, cfg: &Cfg, sr: f32) {
    let secs = (if cfg.glide_rate { cfg.glide * v.glide.abs() / 12.0 } else { cfg.glide }).max(1e-4);
    v.glide_k = 1.0 - (-1.0 / (secs * sr / 3.0)).exp();
    v.glide_step = v.glide.abs() / (secs * sr);
}

/// A volume modulation: 0 and above leave it, -1 silences it (a tremolo or a wobble's gate).
#[inline]
fn vol_mod(m: f32) -> f32 {
    (1.0 + m.min(0.0)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(s: &mut Synth, blocks: usize) -> (f32, f32) {
        let mut peak: f32 = 0.0;
        let mut sum = 0.0f64;
        let mut count = 0usize;
        for _ in 0..blocks {
            s.process(BLOCK);
            for c in 0..2 {
                for &x in &s.out[c] {
                    assert!(x.is_finite());
                    peak = peak.max(x.abs());
                    sum += (x as f64) * (x as f64);
                    count += 1;
                }
            }
        }
        (peak, (sum / count as f64).sqrt() as f32)
    }

    /// Set parameter `name` to `value` in the engine's units.
    fn set(s: &mut Synth, name: &str, value: f32) {
        let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
        s.params[i] = param(i).kind.normal(value);
    }

    #[test]
    fn a_note_sounds_and_ends() {
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 48, 100);
        let (peak, rms) = render(&mut s, 200);
        assert!(peak > 0.05 && rms > 0.01, "peak {peak} rms {rms}");
        assert!(peak <= 0.9);
        s.midi(0x80, 48, 0);
        render(&mut s, 400);
        let (peak2, _) = render(&mut s, 10);
        assert!(peak2 < 1e-4, "still {peak2} after release");
    }

    #[test]
    fn every_filter_and_shaper_stays_finite_and_under_the_ceiling() {
        for f in 0..p::FILTERS.len() {
            for sh in 0..p::SHAPERS.len() {
                let mut s = Synth::new(48000.0);
                set(&mut s, "Filter type", f as f32);
                set(&mut s, "Drive type", sh as f32);
                set(&mut s, "Drive", 36.0);
                set(&mut s, "Resonance", 1.0);
                set(&mut s, "A unison", 16.0);
                for n in [36, 43, 48, 55, 60, 67, 72, 84] {
                    s.midi(0x90, n, 127);
                }
                let (peak, _) = render(&mut s, 100);
                assert!(peak <= 0.9, "filter {f} shaper {sh}: peak {peak}");
            }
        }
    }

    #[test]
    fn more_notes_than_voices_steal_without_clicks() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp release", 10.0);
        for n in 0..20 {
            s.midi(0x90, 40 + n, 100);
            render(&mut s, 5);
        }
        let (peak, _) = render(&mut s, 20);
        assert!(peak <= 0.9);
    }

    #[test]
    fn every_warp_and_stack_plays_cleanly() {
        for w in 0..p::WARPS.len() {
            for amt in [0.3, 1.0] {
                let mut s = Synth::new(48000.0);
                set(&mut s, "A warp", w as f32);
                set(&mut s, "A warp amount", amt);
                set(&mut s, "B warp", w as f32);
                set(&mut s, "B warp amount", amt);
                set(&mut s, "A unison", 5.0);
                set(&mut s, "A stack", (w % p::STACKS.len()) as f32);
                for n in [24, 48, 72, 96] {
                    s.midi(0x90, n, 127);
                }
                let (peak, rms) = render(&mut s, 60);
                assert!(peak <= 0.9 && rms > 1e-3, "warp {w} at {amt}: peak {peak} rms {rms}");
            }
        }
    }

    #[test]
    fn every_table_plays_across_the_keyboard() {
        for t in 0..p::TABLES.len() {
            for pos in [0.0, 0.5, 1.0] {
                let mut s = Synth::new(48000.0);
                set(&mut s, "A table", t as f32);
                set(&mut s, "A position", pos);
                set(&mut s, "B on", 0.0);
                for n in [21, 60, 108] {
                    s.midi(0x90, n, 100);
                }
                let (peak, rms) = render(&mut s, 40);
                assert!(peak <= 0.9 && rms > 1e-3, "table {t} at {pos}: peak {peak} rms {rms}");
            }
        }
    }

    /// Every sample of a render of `blocks` blocks (left then right per block).
    fn samples(s: &mut Synth, blocks: usize) -> Vec<f32> {
        let mut out = vec![];
        for _ in 0..blocks {
            s.process(BLOCK);
            out.extend_from_slice(&s.out[0]);
            out.extend_from_slice(&s.out[1]);
        }
        out
    }

    /// A user table of `frames` cycles, from a sine to a bright buzz.
    fn user_cycles(frames: usize) -> Vec<f32> {
        let n = crate::tables::USER_CYCLE;
        let mut v = vec![];
        for f in 0..frames {
            let k = 1.0 + 6.0 * f as f32 / frames.max(2) as f32;
            v.extend((0..n).map(|i| {
                let ph = 2.0 * std::f32::consts::PI * i as f32 / n as f32;
                (ph + k * ph.sin()).sin() * 0.6
            }));
        }
        v
    }

    #[test]
    fn the_user_table_plays_once_given_and_basic_shapes_until_then() {
        let play = |user: Option<usize>, table: f32| {
            let mut s = Synth::new(48000.0);
            if let Some(f) = user {
                s.set_user_table(crate::tables::user_table(&user_cycles(f), f));
                assert!(s.has_user_table());
            }
            set(&mut s, "A table", table);
            set(&mut s, "A position", 0.6);
            set(&mut s, "B on", 0.0);
            for n in [21, 45, 69, 108] {
                s.midi(0x90, n, 100);
            }
            samples(&mut s, 60)
        };
        let basic = play(None, 0.0);
        // No user table: "User table" is Basic shapes, sample for sample
        assert!(play(None, p::USER_TABLE as f32) == basic);
        // A user table: its own sound, safe across the keyboard
        let user = play(Some(8), p::USER_TABLE as f32);
        assert!(user != basic);
        let peak = user.iter().fold(0f32, |m, x| m.max(x.abs()));
        let rms = (user.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / user.len() as f64).sqrt();
        assert!(peak <= 0.9 && rms > 1e-3, "peak {peak} rms {rms}");
        // A table loaded but not chosen changes nothing
        assert!(play(Some(8), 0.0) == basic);
        // Taken away again: Basic shapes
        let mut s = Synth::new(48000.0);
        s.set_user_table(crate::tables::user_table(&user_cycles(4), 4));
        s.set_user_table(None);
        assert!(!s.has_user_table());
    }

    #[test]
    fn every_preset_sounds_the_same_with_a_user_table_loaded() {
        // (None of them chooses it: a table loaded on the side leaves them bit for bit)
        for pr in crate::presets::PRESETS.iter().step_by(5) {
            let run = |with: bool| {
                let mut s = Synth::new(48000.0);
                s.params = pr.values();
                if with {
                    s.set_user_table(crate::tables::user_table(&user_cycles(16), 16));
                }
                s.midi(0x90, 40, 110);
                s.midi(0x90, 64, 90);
                samples(&mut s, 40)
            };
            assert!(run(false) == run(true), "{}", pr.name);
        }
    }

    #[test]
    fn straight_out_skips_the_filter() {
        let level = |route: f32| {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Filter type", 0.0);
            set(&mut s, "Cutoff", 30.0);
            set(&mut s, "Key tracking", 0.0);
            set(&mut s, "B on", 0.0);
            set(&mut s, "A route", route);
            s.midi(0x90, 60, 100);
            render(&mut s, 100).1
        };
        assert!(level(3.0) > level(0.0) * 10.0, "{} vs {}", level(3.0), level(0.0));
    }

    #[test]
    fn a_macro_in_the_matrix_opens_the_filter() {
        let level = |macro_v: f32| {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Filter type", 0.0);
            set(&mut s, "Cutoff", 100.0);
            set(&mut s, "Key tracking", 0.0);
            set(&mut s, "Mod 3 source", 15.0); // Macro 2
            set(&mut s, "Mod 3 target", 1.0); // F1 cutoff
            set(&mut s, "Mod 3 amount", 1.0);
            set(&mut s, "Macro 2", macro_v);
            s.midi(0x90, 60, 100);
            render(&mut s, 100).1
        };
        assert!(level(1.0) > level(0.0) * 3.0);
    }

    #[test]
    fn a_pump_lfo_ducks_each_beat() {
        let mut s = Synth::new(48000.0);
        s.set_tempo(120.0);
        set(&mut s, "Amp attack", 0.003);
        set(&mut s, "LFO 2 shape", 8.0);
        set(&mut s, "LFO 2 rate (sync)", 7.0); // 1/4
        set(&mut s, "LFO 2 target 1", 6.0); // Volume
        set(&mut s, "LFO 2 amount 1", 1.0);
        s.midi(0x90, 60, 100);
        // At 120 BPM a beat is 0.5 s: quiet at its start, loud near its end
        let mut env = vec![];
        for _ in 0..375 {
            s.process(BLOCK);
            env.push(s.out[0].iter().map(|x| x * x).sum::<f32>());
        }
        let beat = 187; // blocks per beat
        let early: f32 = env[beat + 1..beat + 4].iter().sum();
        let late: f32 = env[beat + 120..beat + 123].iter().sum();
        assert!(late > early * 5.0, "early {early} late {late}");
    }

    #[test]
    fn drawn_shapes_follow_their_steps() {
        let mut steps = [0.0f32; 16];
        steps[3] = 1.0;
        assert_eq!(drawn(&steps, 0.0, 3.5 / 16.0), 1.0);
        assert_eq!(drawn(&steps, 0.0, 4.5 / 16.0), 0.0);
        let mid = drawn(&steps, 1.0, 3.5 / 16.0);
        assert!(mid > 0.2 && mid < 0.8, "{mid}");
    }

    #[test]
    fn effects_at_full_stay_under_the_ceiling() {
        let mut s = Synth::new(48000.0);
        for (name, v) in [
            ("EQ on", 1.0), ("EQ low", 12.0), ("EQ high", 12.0), ("Chorus on", 1.0), ("Chorus mix", 1.0), ("Phaser on", 1.0), ("Phaser feedback", 1.0), ("Phaser mix", 1.0),
            ("Delay on", 1.0), ("Delay feedback", 1.0), ("Delay mix", 1.0), ("Reverb on", 1.0), ("Reverb decay", 20.0), ("Reverb mix", 1.0), ("OTT", 1.0), ("Level", 6.0), ("A unison", 16.0),
        ] {
            set(&mut s, name, v);
        }
        for n in [36, 48, 60, 72] {
            s.midi(0x90, n, 127);
        }
        let (peak, _) = render(&mut s, 600);
        assert!(peak <= 0.9, "peak {peak}");
    }

    fn active(s: &Synth) -> usize {
        s.voices.iter().filter(|v| v.active).count()
    }

    #[test]
    fn switching_to_mono_with_notes_held_still_ends_them() {
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 60, 100);
        s.midi(0x90, 64, 100);
        render(&mut s, 5);
        set(&mut s, "Voices", 1.0);
        s.midi(0x80, 64, 0);
        s.midi(0x80, 60, 0);
        render(&mut s, 400);
        assert_eq!(active(&s), 0);
    }

    #[test]
    fn a_note_stealing_a_finished_voice_still_plays() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp release", 0.005);
        for n in 40..48 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 10);
        for n in 40..48 {
            s.midi(0x80, n, 0);
        }
        render(&mut s, 4);
        s.midi(0x90, 72, 100);
        render(&mut s, 20);
        let (_, rms) = render(&mut s, 20);
        assert!(rms > 1e-3, "the new note is silent ({rms})");
    }

    #[test]
    fn a_stolen_voice_never_stays_part_faded() {
        let mut s = Synth::new(48000.0);
        for n in 40..48 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 10);
        s.midi(0x90, 72, 100);
        s.process(64);
        s.midi(0x80, 72, 0);
        render(&mut s, 200);
        assert!(s.voices.iter().all(|v| !v.active || v.fade >= 1.0 || v.amp.stage == Stage::Release));
    }

    #[test]
    fn legato_pedal_up_keeps_the_held_key() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Voices", 2.0);
        s.midi(0x90, 60, 100);
        s.midi(0xB0, 64, 127);
        s.midi(0x80, 60, 0);
        s.midi(0x90, 62, 100);
        render(&mut s, 5);
        s.midi(0xB0, 64, 0);
        render(&mut s, 200);
        let (_, rms) = render(&mut s, 10);
        assert!(rms > 1e-3, "the held key went silent");
    }

    #[test]
    fn a_free_drift_lfo_with_a_phase_offset_never_jumps() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "LFO 1 shape", 7.0);
        set(&mut s, "LFO 1 mode", 0.0);
        set(&mut s, "LFO 1 sync", 0.0);
        set(&mut s, "LFO 1 rate (Hz)", 5.0);
        set(&mut s, "LFO 1 phase", 0.5);
        let cfg = s.cfg();
        let mut last: Option<f32> = None;
        let mut worst: f32 = 0.0;
        for _ in 0..2000 {
            s.process(BLOCK);
            let ph = (s.lfo_phase[0] + 0.5).fract();
            let v = lfo_value(&cfg, 0, ph, s.lfo_held[0]);
            if let Some(l) = last {
                worst = worst.max((v - l).abs());
            }
            last = Some(v);
        }
        assert!(worst < 0.2, "jumped by {worst}");
    }


    #[test]
    fn a_chord_over_full_voices_keeps_every_note() {
        let mut s = Synth::new(48000.0);
        for n in 40..48 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 10);
        for n in [72, 76, 79] {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 20);
        for n in [72u8, 76, 79] {
            assert!(s.voices.iter().any(|v| v.active && v.note == n), "{n} isn't playing");
        }
    }

    #[test]
    fn a_long_glide_arrives_in_tune() {
        for sr in [48000.0, 96000.0] {
            let mut s = Synth::new(sr);
            set(&mut s, "Voices", 1.0);
            set(&mut s, "Glide", 2.0);
            s.midi(0x90, 60, 100);
            render(&mut s, 2);
            s.midi(0x90, 84, 100);
            for _ in 0..(sr as usize * 20 / BLOCK) {
                s.process(BLOCK);
            }
            assert!((s.voices[0].pitch - 84.0).abs() < 0.005, "{sr}: ended at {}", s.voices[0].pitch);
        }
    }

    #[test]
    fn all_notes_off_lifts_the_pedal() {
        let mut s = Synth::new(48000.0);
        s.midi(0xB0, 64, 127);
        s.midi(0xB0, 123, 0);
        s.midi(0x90, 60, 100);
        render(&mut s, 5);
        s.midi(0x80, 60, 0);
        render(&mut s, 400);
        assert_eq!(active(&s), 0);
    }

    #[test]
    fn a_note_repeated_under_the_pedal_stays_at_one_notes_level() {
        let level = |times: usize| {
            let mut s = Synth::new(48000.0);
            s.midi(0xB0, 64, 127);
            for _ in 0..times {
                s.midi(0x90, 48, 100);
                render(&mut s, 20);
                s.midi(0x80, 48, 0);
            }
            (render(&mut s, 40).1, active(&s))
        };
        let (one, _) = level(1);
        let (eight, voices) = level(8);
        assert!(20.0 * (eight / one).log10() < 2.0 && voices == 1, "{one} vs {eight}, {voices} voices");
    }

    #[test]
    fn a_restrike_at_another_velocity_does_not_click() {
        // A bare sine (no filter), so any step in its level shows
        let d2 = |x: &[f32]| (2..x.len()).map(|n| (x[n] - 2.0 * x[n - 1] + x[n - 2]).abs()).fold(0.0f32, f32::max);
        for (v1, v2, pedal) in [(127u8, 10u8, true), (10, 127, true), (127, 10, false)] {
            let mut s = Synth::new(48000.0);
            set(&mut s, "B on", 0.0);
            set(&mut s, "Filter type", 10.0);
            set(&mut s, "Velocity", 1.0);
            set(&mut s, "Level", 0.0);
            set(&mut s, "Amp release", 2.0);
            if pedal {
                s.midi(0xB0, 64, 127);
            }
            let mut b = vec![];
            let run = |s: &mut Synth, blocks: usize, b: &mut Vec<f32>| {
                for _ in 0..blocks {
                    s.process(BLOCK);
                    b.extend_from_slice(&s.out[0]);
                }
            };
            s.midi(0x90, 45, v1);
            run(&mut s, 100, &mut b);
            s.midi(0x80, 45, 0);
            run(&mut s, 20, &mut b);
            let at = b.len();
            s.midi(0x90, 45, v2);
            run(&mut s, 4, &mut b);
            let after = d2(&b[at - 2..]);
            assert!(after < 0.02, "{v1} -> {v2} (pedal {pedal}): step {after}");
        }
    }

    #[test]
    fn a_very_short_restrike_still_sounds() {
        // A key down for under the 3 ms fade (a 1-tick MIDI note): with the pedal down the note
        // rings on; without it, it plays and ends as a short note
        for pedal in [true, false] {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Amp release", 2.0);
            if pedal {
                s.midi(0xB0, 64, 127);
            }
            s.midi(0x90, 45, 100);
            render(&mut s, 40);
            s.midi(0x80, 45, 0);
            render(&mut s, 40);
            let before = render(&mut s, 2).1;
            s.midi(0x90, 45, 100);
            s.process(64);
            s.midi(0x80, 45, 0);
            render(&mut s, 2);
            let after = render(&mut s, 4).1;
            if pedal {
                assert!(after > before * 0.8, "{before} before, {after} after");
            } else {
                // (The short note plays and lets go: nothing is left hanging part-faded)
                assert!(s.voices.iter().all(|v| v.pending.is_none() && (!v.active || v.amp.stage == Stage::Release)));
            }
        }
        // A short note that sounds at all: its envelope gets somewhere before it lets go
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 45, 100);
        render(&mut s, 40);
        s.midi(0x80, 45, 0);
        render(&mut s, 4);
        s.midi(0x90, 45, 100);
        s.process(64);
        s.midi(0x80, 45, 0);
        let mut top: f32 = 0.0;
        for _ in 0..8 {
            s.process(BLOCK);
            top = s.voices.iter().filter(|v| v.note == 45 && v.time < 0.05).fold(top, |m, v| m.max(v.amp.value));
        }
        assert!(top > 0.2, "short note reached {top}");
    }

    #[test]
    fn fast_repeats_under_the_pedal_stay_on_one_voice() {
        let mut s = Synth::new(48000.0);
        s.midi(0xB0, 64, 127);
        s.midi(0x90, 45, 100);
        render(&mut s, 20);
        s.midi(0x80, 45, 0);
        for _ in 0..8 {
            s.midi(0x90, 45, 100);
            s.process(48);
            s.midi(0x80, 45, 0);
        }
        render(&mut s, 10);
        let copies = s.voices.iter().filter(|v| v.active && v.note == 45 && v.amp.stage != Stage::Release).count();
        assert!(copies <= 1, "{copies} copies");
    }

    #[test]
    fn a_held_key_is_not_taken_while_pedal_held_notes_ring() {
        let mut s = Synth::new(48000.0);
        s.midi(0xB0, 64, 127);
        s.midi(0x90, 36, 100);
        for n in [60u8, 62, 64, 65, 67, 69, 71, 72] {
            s.midi(0x90, n, 100);
            render(&mut s, 4);
            s.midi(0x80, n, 0);
        }
        render(&mut s, 4);
        assert!(s.voices.iter().any(|v| v.active && v.note == 36 && !v.sustained && v.pending.is_none()));
    }

    #[test]
    fn a_note_taking_a_short_notes_place_is_held() {
        let mut s = Synth::new(48000.0);
        for n in 60..68u8 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 10);
        for n in 60..68u8 {
            s.midi(0x80, n, 0);
        }
        for n in 40..48u8 {
            s.midi(0x90, n, 100);
        }
        s.midi(0x80, 40, 0);
        s.midi(0x90, 52, 100);
        render(&mut s, 20);
        assert!(s.voices.iter().any(|v| v.active && v.note == 52 && v.amp.stage != Stage::Release));
    }

    #[test]
    fn a_mono_retrigger_at_another_velocity_does_not_click() {
        let d2 = |x: &[f32]| (2..x.len()).map(|n| (x[n] - 2.0 * x[n - 1] + x[n - 2]).abs()).fold(0.0f32, f32::max);
        let mut s = Synth::new(48000.0);
        set(&mut s, "B on", 0.0);
        set(&mut s, "Filter type", 10.0);
        set(&mut s, "Velocity", 1.0);
        set(&mut s, "Level", 0.0);
        set(&mut s, "Voices", 1.0);
        s.midi(0x90, 45, 127);
        render(&mut s, 100);
        let mut b = vec![];
        s.midi(0x90, 45, 10);
        for _ in 0..4 {
            s.process(BLOCK);
            b.extend_from_slice(&s.out[0]);
        }
        let step = d2(&b);
        assert!(step < 0.02, "step {step}");
    }

    #[test]
    fn a_mono_note_after_a_silent_tail_starts_at_its_own_velocity() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Voices", 1.0);
        set(&mut s, "Velocity", 1.0);
        set(&mut s, "Amp release", 0.5);
        s.midi(0x90, 57, 127);
        render(&mut s, 50);
        s.midi(0x80, 57, 0);
        render(&mut s, 375);
        s.midi(0x90, 57, 10);
        s.process(48);
        let v = &s.voices[0];
        let want = 1.0 - (1.0 - 10.0 / 127.0);
        assert!((v.gain_now - want).abs() < 0.05, "gain {} want {want}", v.gain_now);
    }

    fn r18_set(s: &mut Synth, name: &str, value: f32) {
        let i = p::index_of(name).unwrap_or_else(|| panic!("no {name}"));
        s.params[i] = param(i).kind.normal(value);
    }
    fn r18_d2(x: &[f32]) -> f32 { (2..x.len()).map(|n| (x[n] - 2.0 * x[n - 1] + x[n - 2]).abs()).fold(0.0f32, f32::max) }
    fn r18_mono(sus: f32) -> Synth {
        let mut s = Synth::new(48000.0);
        r18_set(&mut s, "B on", 0.0); r18_set(&mut s, "Filter type", 10.0); r18_set(&mut s, "Velocity", 1.0);
        r18_set(&mut s, "Level", 0.0); r18_set(&mut s, "Voices", 1.0);
        r18_set(&mut s, "Amp decay", 0.1); r18_set(&mut s, "Amp sustain", sus);
        s
    }
    fn r18_grab(s: &mut Synth, blocks: usize) -> Vec<f32> { let mut b = vec![]; for _ in 0..blocks { s.process(BLOCK); b.extend_from_slice(&s.out[0]); } b }

    /// A held pluck whose sustain sits just under 1 %: a louder mono retrigger snaps its gain
    /// (one-sample step) where at 1.01 % it eases. Slow attack so the attack itself adds no step.
    #[test]
    fn a_quiet_held_note_retriggers_without_a_step() {
        let step = |sus: f32| {
            let mut s = r18_mono(sus);
            s.midi(0x90, 45, 10);
            r18_grab(&mut s, 300);
            r18_set(&mut s, "Amp attack", 0.3);
            let pre = r18_grab(&mut s, 2);
            s.midi(0x90, 45, 127);
            let post = r18_grab(&mut s, 4);
            r18_d2(&[&pre[pre.len() - 4..], &post[..]].concat())
        };
        let (below, above) = (step(0.0099), step(0.0101));
        eprintln!("d2 at retrigger: sustain 0.99 % {below:.6}, 1.01 % {above:.6}");
        assert!(below < 3.0 * above, "snaps: {below} vs eased {above}");
    }

    /// A held quiet note (sustain 5 %) retriggered softer (vel 127 -> 10): the first ms plays the new
    /// attack at the OLD velocity, far louder than either note.
    #[test]
    fn a_softer_retrigger_never_blips_louder() {
        let mut s = r18_mono(0.05);
        s.midi(0x90, 45, 127);
        r18_grab(&mut s, 400);
        let old = r18_grab(&mut s, 4).iter().fold(0.0f32, |m, x| m.max(x.abs()));
        s.midi(0x90, 45, 10);
        let blip = r18_grab(&mut s, 2).iter().fold(0.0f32, |m, x| m.max(x.abs()));
        let mut f = r18_mono(0.05);
        r18_grab(&mut f, 400);
        f.midi(0x90, 45, 10);
        let fresh = r18_grab(&mut f, 2).iter().fold(0.0f32, |m, x| m.max(x.abs()));
        eprintln!("old note peak {old:.4}, new note alone {fresh:.4}, retrigger's first 5 ms {blip:.4}");
        assert!(blip < 1.12 * old.max(fresh), "blip {blip} over old {old} / new {fresh}");
    }

    /// Two overlapping notes of one pitch (a sequencer's overlap): the first one's end silences the
    /// second, though its key is still down.
    #[test]
    fn overlapping_notes_of_one_pitch_each_end_on_their_own() {
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 60, 100);
        r18_grab(&mut s, 100);
        s.midi(0x90, 60, 100);
        r18_grab(&mut s, 10);
        s.midi(0x80, 60, 0);
        r18_grab(&mut s, 150);
        let rms = { let b = r18_grab(&mut s, 10); (b.iter().map(|x| x * x).sum::<f32>() / b.len() as f32).sqrt() };
        assert!(rms > 1e-3, "second note silent while held: rms {rms}");
    }

    /// Delay synced to 2 bars at 120 bpm should echo at 4.0 s; it echoes at 3.9 s (4 bars: never).
    #[test]
    fn a_long_synced_delay_stays_in_time() {
        let mut s = Synth::new(48000.0);
        s.set_tempo(120.0);
        r18_set(&mut s, "Level", 0.0); r18_set(&mut s, "Amp release", 0.005);
        r18_set(&mut s, "Delay on", 1.0); r18_set(&mut s, "Delay sync", 1.0); r18_set(&mut s, "Delay time (sync)", 1.0);
        r18_set(&mut s, "Delay mix", 1.0); r18_set(&mut s, "Delay feedback", 0.0); r18_set(&mut s, "Delay ping-pong", 0.0);
        s.midi(0x90, 60, 127);
        let mut e = r18_grab(&mut s, 2);
        s.midi(0x80, 60, 0);
        e.extend(r18_grab(&mut s, 48000 * 6 / BLOCK));
        let at = (24000..e.len()).find(|&i| e[i].abs() > 0.01).unwrap() as f32 / 48000.0;
        assert!((at - 4.0).abs() < 0.01, "echo at {at} s, want 4 s");
    }

    #[test]
    fn a_mono_glide_back_leaves_nothing_stuck_after_switching_to_poly() {
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 62, 100);
        s.midi(0x90, 60, 100);
        render(&mut s, 10);
        s.midi(0x80, 62, 0);
        set(&mut s, "Voices", 1.0);
        s.midi(0x90, 63, 100);
        render(&mut s, 10);
        s.midi(0x80, 63, 0);
        render(&mut s, 10);
        set(&mut s, "Voices", 0.0);
        s.midi(0x80, 60, 0);
        render(&mut s, 400);
        assert_eq!(active(&s), 0);
    }

    #[test]
    fn a_short_note_never_takes_a_restrikes_note_off() {
        let mut s = Synth::new(48000.0);
        for n in 60..67u8 {
            s.midi(0x90, n, 100);
        }
        s.midi(0x90, 47, 100);
        render(&mut s, 10);
        s.midi(0x90, 47, 100);
        s.midi(0x90, 47, 100);
        s.midi(0x80, 47, 0);
        s.midi(0x80, 47, 0);
        s.process(32);
        s.midi(0x90, 47, 100);
        s.process(32);
        s.midi(0x80, 47, 0);
        s.midi(0x80, 47, 0);
        for n in 60..67u8 {
            s.midi(0x80, n, 0);
        }
        render(&mut s, 800);
        assert_eq!(active(&s), 0);
    }

    #[test]
    fn turning_up_velocity_on_a_held_soft_note_eases() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "B on", 0.0);
        set(&mut s, "Filter type", 10.0);
        set(&mut s, "Level", 0.0);
        set(&mut s, "Velocity", 0.0);
        s.midi(0x90, 45, 10);
        render(&mut s, 100);
        let mut last = s.out[0][BLOCK - 1];
        set(&mut s, "Velocity", 1.0);
        let mut worst: f32 = 0.0;
        for _ in 0..8 {
            s.process(BLOCK);
            for &x in &s.out[0] {
                worst = worst.max((x - last).abs());
                last = x;
            }
        }
        assert!(worst < 0.05, "jumped by {worst}");
    }

    #[test]
    fn a_key_struck_twice_plays_until_its_last_note_off() {
        // Poly, the two strikes merged into one voice by a restrike; then mono
        for mono in [false, true] {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Amp release", 0.3);
            if mono {
                set(&mut s, "Voices", 1.0);
            }
            s.midi(0x90, 60, 100);
            render(&mut s, 10);
            s.midi(0x80, 60, 0);
            render(&mut s, 2);
            s.midi(0x90, 60, 100);
            s.midi(0x90, 60, 100);
            render(&mut s, 20);
            s.midi(0x80, 60, 0);
            render(&mut s, 200);
            assert!(s.voices.iter().any(|v| v.active && v.note == 60 && v.amp.stage != Stage::Release), "mono {mono}");
            s.midi(0x80, 60, 0);
            render(&mut s, 400);
            assert_eq!(active(&s), 0, "mono {mono}");
        }
    }

    #[test]
    fn a_mono_key_struck_twice_keeps_its_place() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Voices", 1.0);
        s.midi(0x90, 60, 100);
        s.midi(0x90, 62, 100);
        s.midi(0x90, 60, 100);
        render(&mut s, 10);
        s.midi(0x80, 60, 0);
        render(&mut s, 50);
        assert_eq!(s.voices[0].note, 60);
    }

    #[test]
    fn switching_to_legato_drops_what_poly_left_waiting() {
        // A note waiting on voice 0 (it was taken), then Legato and a new key: the new key plays
        let mut s = Synth::new(48000.0);
        for n in 60..68u8 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 20);
        s.midi(0x90, 70, 100);
        set(&mut s, "Voices", 2.0);
        s.midi(0x90, 72, 100);
        render(&mut s, 20);
        assert_eq!(s.voices[0].note, 72);
        // A very short note's timer on voice 0, then Legato and a held key: it stays held
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp release", 0.2);
        s.midi(0x90, 60, 100);
        render(&mut s, 20);
        s.midi(0x80, 60, 0);
        s.process(BLOCK);
        s.midi(0x90, 60, 100);
        s.midi(0x80, 60, 0);
        render(&mut s, 2);
        set(&mut s, "Voices", 2.0);
        s.midi(0x90, 64, 100);
        render(&mut s, 40);
        assert!(s.voices[0].amp.stage != Stage::Release, "the held key was let go");
    }

    #[test]
    fn a_held_key_outlasts_a_short_note_when_voices_run_out() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp release", 0.3);
        for n in 60..67u8 {
            s.midi(0x90, n, 100);
            s.process(BLOCK);
        }
        s.midi(0x90, 70, 100);
        render(&mut s, 4);
        s.midi(0x80, 70, 0);
        s.process(BLOCK);
        s.midi(0x90, 70, 100);
        s.midi(0x80, 70, 0);
        for _ in 0..10 {
            if s.voices.iter().any(|v| v.short_left > 0) {
                break;
            }
            s.process(16);
        }
        s.midi(0x90, 72, 100);
        render(&mut s, 20);
        for n in 60..67u8 {
            assert!(s.voices.iter().any(|v| v.active && v.note == n && v.amp.stage != Stage::Release), "key {n} went silent");
        }
    }

    #[test]
    fn a_softer_mono_retrigger_of_a_part_faded_voice_does_not_click() {
        // Voice 0 taken for another note (fading), then Mono and a softer strike of its note
        let mut s = Synth::new(48000.0);
        set(&mut s, "B on", 0.0);
        set(&mut s, "Filter type", 10.0);
        set(&mut s, "Velocity", 1.0);
        set(&mut s, "Level", 0.0);
        s.midi(0x90, 45, 127);
        for n in 1..8u8 {
            s.process(1);
            s.midi(0x90, 57 + n, 1);
        }
        render(&mut s, 100);
        s.midi(0x90, 80, 1);
        s.process(48);
        let mut b = s.out[0][..48].to_vec();
        set(&mut s, "Voices", 1.0);
        s.midi(0x90, 45, 10);
        for _ in 0..4 {
            s.process(BLOCK);
            b.extend_from_slice(&s.out[0]);
        }
        let d2 = (2..b.len()).map(|n| (b[n] - 2.0 * b[n - 1] + b[n - 2]).abs()).fold(0.0f32, f32::max);
        assert!(d2 < 0.01, "step {d2}");
    }

    #[test]
    fn the_formant_filter_follows_the_filter_envelope() {
        let out = |env: f32| {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Filter type", 9.0);
            set(&mut s, "Cutoff", 300.0);
            set(&mut s, "Filter envelope", env);
            set(&mut s, "Filter sustain", 1.0);
            s.midi(0x90, 48, 100);
            render(&mut s, 50);
            s.out[0]
        };
        let (a, b) = (out(0.0), out(1.0));
        assert!(a.iter().zip(b.iter()).any(|(x, y)| (x - y).abs() > 1e-3));
    }

    #[test]
    fn a_shorter_release_reaches_a_held_note() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp release", 5.0);
        s.midi(0x90, 60, 100);
        render(&mut s, 20);
        set(&mut s, "Amp release", 0.01);
        render(&mut s, 1);
        s.midi(0x80, 60, 0);
        render(&mut s, 375);
        let (peak, _) = render(&mut s, 5);
        assert!(peak < 1e-3, "still {peak} a second later");
    }

    #[test]
    fn the_ott_starts_clean_when_turned_back_on() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "OTT", 0.5);
        set(&mut s, "Level", -6.0);
        s.midi(0x90, 36, 127);
        render(&mut s, 100);
        set(&mut s, "OTT", 0.0);
        s.midi(0x80, 36, 0);
        render(&mut s, 400);
        set(&mut s, "OTT", 0.5);
        let (peak, _) = render(&mut s, 10);
        assert!(peak < 1e-3, "popped to {peak}");
    }


    #[test]
    fn a_sustain_change_glides_on_a_held_note() {
        let mut s = Synth::new(48000.0);
        s.midi(0x90, 60, 100);
        render(&mut s, 200);
        set(&mut s, "Amp sustain", 0.1);
        s.process(1);
        assert!(s.voices[0].amp.value > 0.9, "jumped to {}", s.voices[0].amp.value);
        render(&mut s, 400);
        assert!((s.voices[0].amp.value - 0.1).abs() < 0.01);
    }

    #[test]
    fn steps_lfos_are_random_from_each_notes_first_cycle() {
        for mode in [1.0, 2.0] {
            let mut s = Synth::new(48000.0);
            set(&mut s, "LFO 1 shape", 6.0);
            set(&mut s, "LFO 1 sync", 0.0);
            set(&mut s, "LFO 1 rate (Hz)", 2.0);
            set(&mut s, "LFO 1 mode", mode);
            let mut seen = vec![];
            for n in 0..6 {
                s.midi(0x90, 60 + n, 100);
                render(&mut s, 2);
                let v = s.voices.iter().find(|v| v.active && v.note == 60 + n).unwrap();
                seen.push(v.lfo_held[0].1);
                s.midi(0x80, 60 + n, 0);
                render(&mut s, 100);
            }
            assert!(seen.iter().any(|&x| x != 0.0) && seen.windows(2).any(|w| w[0] != w[1]), "mode {mode}: {seen:?}");
        }
    }


    #[test]
    fn a_stolen_voice_starts_its_envelopes_from_nothing() {
        let mut s = Synth::new(48000.0);
        set(&mut s, "Amp attack", 2.0);
        for n in 40..48 {
            s.midi(0x90, n, 100);
        }
        render(&mut s, 1500);
        s.midi(0x90, 72, 100);
        render(&mut s, 4);
        let v = s.voices.iter().find(|v| v.active && v.note == 72).unwrap();
        assert!(v.amp.value < 0.05 && v.amp.stage == Stage::Attack, "started at {}", v.amp.value);
    }

    #[test]
    fn the_attack_takes_the_time_it_says() {
        for secs in [0.1f32, 1.0] {
            let mut e = Env::default();
            e.set(secs, 1.0, 1.0, 1.0, 48000.0);
            e.gate(true);
            let mut n = 0;
            while e.stage == Stage::Attack {
                e.tick();
                n += 1;
            }
            let took = n as f32 / 48000.0;
            assert!((took - secs).abs() < secs * 0.05, "{secs} s took {took}");
        }
    }

    #[test]
    fn the_sub_ignores_oscillator_a_tuning() {
        let pitch_of = |oct: f32| {
            let mut s = Synth::new(48000.0);
            set(&mut s, "Sub level", 0.0);
            set(&mut s, "A octave", oct);
            set(&mut s, "A on", 0.0);
            set(&mut s, "B on", 0.0);
            s.midi(0x90, 57, 100);
            render(&mut s, 50);
            // Count upward zero crossings over a second: the sub is alone
            let mut last = 0.0f32;
            let mut ups = 0;
            for _ in 0..375 {
                s.process(BLOCK);
                for &x in &s.out[0] {
                    if last <= 0.0 && x > 0.0 {
                        ups += 1;
                    }
                    last = x;
                }
            }
            ups
        };
        assert!((pitch_of(0.0) as i32 - 110).abs() <= 2);
        assert!((pitch_of(2.0) as i32 - 110).abs() <= 2);
    }


    #[test]
    fn a_free_steps_lfo_is_random_from_its_first_cycle() {
        let s = Synth::new(48000.0);
        assert!(s.lfo_held.iter().all(|h| h.0 != 0.0 && h.1 != 0.0));
    }


    #[test]
    fn stacks_keep_every_note_with_an_odd_unison() {
        let semis = |unison: usize, stack: usize| {
            let o = OscCfg { unison, stack, detune: 0.0, blend: 0.5, width: 0.5, ..Default::default() };
            let sp = Spread::new(&o, 0.0, 1.0);
            let mut v: Vec<i32> = (0..sp.n).map(|i| (12.0 * sp.ratio[i].log2()).round() as i32).collect();
            v.sort();
            v.dedup();
            v
        };
        assert_eq!(semis(3, 1), vec![0, 12]);
        assert_eq!(semis(3, 4), vec![0, 7, 12]);
        assert_eq!(semis(3, 5), vec![0, 4, 7]);
        assert_eq!(semis(5, 2), vec![0, 12, 24]);
    }


    #[test]
    fn noise_is_as_loud_at_any_sample_rate() {
        let level = |sr: f32| {
            let mut s = Synth::new(sr);
            set(&mut s, "A on", 0.0);
            set(&mut s, "B on", 0.0);
            set(&mut s, "Noise level", 0.0);
            set(&mut s, "Filter type", 1.0);
            set(&mut s, "Cutoff", 3000.0);
            set(&mut s, "Key tracking", 0.0);
            s.midi(0x90, 60, 100);
            render(&mut s, (sr as usize) / BLOCK);
            20.0 * render(&mut s, (sr as usize) / BLOCK).1.log10()
        };
        let (a, b) = (level(48000.0), level(96000.0));
        assert!((a - b).abs() < 0.7, "48 kHz {a} dB, 96 kHz {b} dB");
    }

}

#[cfg(test)]
#[path = "synth_movement_tests.rs"]
mod movement_tests;

#[cfg(test)]
#[path = "synth_sound_tests.rs"]
mod sound_tests;

#[cfg(test)]
#[path = "synth_range_tests.rs"]
mod range_tests;
