//! The synth: up to eight voices of two wavetable oscillators (each with up to 16 unison voices,
//! a warp and a stack), a sub and noise, routed into two filters (side by side or one into the
//! other) or straight out, then drive. Four LFOs, three envelopes, four macros and an
//! eight-slot matrix move it all. After the voices: the OTT, the effects (EQ, chorus, phaser,
//! delay, reverb), the mono low end, the level and the safety clipper. Everything the host sees
//! goes through `Synth`.

use crate::dsp::*;
use crate::fx::{Effects, FxCfg, FxMods};
use crate::params::{self as p, db_gain, param, COUNT};
use crate::tables::{level_for, table};

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
    /// 0 free (shared by every note), 1 restarts with each note, 2 runs once per note
    mode: usize,
    phase: f32,
    fade: f32,
    dest: [usize; 2],
    amt: [f32; 2],
    /// One value for every note (free, no fade in): worked out once for the whole synth
    global: bool,
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
    lfo: [LfoCfg; 4],
    drawn: [[f32; 16]; 2],
    smooth: [f32; 2],
    slots: [(usize, usize, f32); p::SLOTS],
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
    fn new(o: &OscCfg, detune: f32) -> Self {
        let n = o.unison.clamp(1, UNISON);
        let mut s = Spread { n, ratio: [1.0; UNISON], gl: [0.0; UNISON], gr: [0.0; UNISON], top: 1.0 };
        let (pl, pr) = ((1.0 - o.pan).sqrt(), (1.0 + o.pan).sqrt());
        if n == 1 {
            s.gl[0] = pl;
            s.gr[0] = pr;
            return s;
        }
        // The detune grows slowly then fast (as the classic supersaw's knob does): up to 100 cents
        let cents = 100.0 * detune * detune;
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

/// Add every route (each LFO's two targets, the matrix) from `s` into `m`. Called once with the
/// whole synth's sources, and once per note with that note's, so each counts once.
fn route(cfg: &Cfg, s: &[f32; NSRC], m: &mut [f32; NDEST]) {
    for k in 0..4 {
        let v = s[src::LFO + k];
        if v != 0.0 {
            for t in 0..2 {
                m[cfg.lfo[k].dest[t]] += cfg.lfo[k].amt[t] * v;
            }
        }
    }
    for &(from, to, amt) in &cfg.slots {
        if from > 0 && to > 0 {
            m[to] += amt * s[from];
        }
    }
    m[0] = 0.0;
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
    shaper: [Shaper; 2],
    lfo_phase: [f32; 4],
    lfo_held: [(f32, f32); 4],
    /// Seconds since the note started (for the LFOs' fade in)
    time: f32,
    /// This note's random source value (-1..1)
    rand: f32,
    /// Oscillator A's last sample, before its warp (oscillator B's ring warp reads it)
    last_a: f32,
    /// Held down by the sustain pedal after its key came up
    sustained: bool,
    /// A note waiting for this voice to fade out (it was taken for a new one)
    pending: Option<(u8, f32)>,
    fade: f32,
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
            shaper: [Shaper::default(); 2],
            lfo_phase: [0.0; 4],
            lfo_held: [(0.0, 0.0); 4],
            time: 0.0,
            rand: 0.0,
            last_a: 0.0,
            sustained: false,
            pending: None,
            fade: 1.0,
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
    side_coef: SvfCoef,
    clip: [SafetyClip; 2],
    gain: f32,
    pub out: [[f32; BLOCK]; 2],
    pub input: [[f32; BLOCK]; 2],
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
            lfo_phase: [0.0; 4],
            lfo_held,
            lfo_read: [0.0; 4],
            lfo_rate_mod: [0.0; 4],
            ott: Ott::new(sr),
            ott_on: false,
            fx: Effects::new(sr),
            side_hp: [Svf::default(); 2],
            side_coef: SvfCoef::new(120.0, sr, std::f32::consts::SQRT_2),
            clip: [SafetyClip::default(); 2],
            gain: 0.0,
            out: [[0.0; BLOCK]; 2],
            input: [[0.0; BLOCK]; 2],
        }
    }

    pub fn set_tempo(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 1.0 {
            self.tempo = bpm;
        }
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
            LfoCfg {
                shape: self.v(base + p::lfo::SHAPE) as u32,
                hz,
                mode,
                phase: self.v(base + p::lfo::PHASE),
                fade,
                dest: [self.v(base + p::lfo::DEST1) as usize, self.v(base + p::lfo::DEST2) as usize],
                amt: [self.v(base + p::lfo::AMT1), self.v(base + p::lfo::AMT2)],
                global: mode == 0 && fade <= 0.0011,
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
        let mut slots = [(0, 0, 0.0); p::SLOTS];
        for (i, slot) in slots.iter_mut().enumerate() {
            let base = p::MATRIX_1 + i * 3;
            *slot = (self.v(base) as usize, self.v(base + 1) as usize, self.v(base + 2));
        }
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
            phaser: self.v(p::PHASER_ON) > 0.5,
            flanger: self.v(p::PHASER_ON + 1) > 0.5,
            phaser_rate: self.v(p::PHASER_ON + 2),
            phaser_depth: self.v(p::PHASER_ON + 3),
            phaser_fb: self.v(p::PHASER_ON + 4),
            phaser_mix: self.v(p::PHASER_ON + 5),
            delay: self.v(p::DELAY_ON) > 0.5,
            delay_time: delay_time.min(3.9),
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
            lfo: [lfo(0), lfo(1), lfo(2), lfo(3)],
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
            0x80 | 0x90 => self.note_off(d1),
            0xE0 => {
                let v = ((d2 as i32) << 7 | d1 as i32) - 8192;
                self.bend = v as f32 / 8192.0;
            }
            0xD0 => self.aftertouch = d1 as f32 / 127.0,
            0xA0 => self.aftertouch = d2 as f32 / 127.0,
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
        // (A stop mid-pedal mustn't leave the pedal down for the next playback)
        self.pedal = false;
        for v in self.voices.iter_mut() {
            v.sustained = false;
            v.pending = None;
            if hard {
                v.active = false;
                v.amp = Env::default();
            } else {
                v.release();
            }
        }
    }

    fn note_on(&mut self, note: u8, vel: f32) {
        self.stack.retain(|&n| n != note);
        if self.stack.len() < 32 {
            self.stack.push(note);
        }
        let cfg = self.cfg();
        if cfg.mode > 0 {
            // Mono and legato: one voice; legato keeps the envelopes going between joined notes
            let v = &mut self.voices[0];
            let joined = v.active && v.amp.stage != Stage::Release && v.amp.stage != Stage::Idle;
            v.glide = v.pitch - note as f32;
            v.target = note as f32;
            v.note = note;
            // A key is down now: lifting the pedal mustn't end it
            v.sustained = false;
            if !(joined && cfg.mode == 2) {
                if !v.active {
                    v.pitch = note as f32;
                    v.glide = 0.0;
                }
                self.start(0, note, vel, &cfg, false);
            }
            return;
        }
        // Poly: a free voice, else the quietest released one, else the oldest (faded out first)
        let free = self.voices.iter().position(|v| !v.active && v.pending.is_none());
        // (A voice already taken for a note waiting to start isn't taken again: each note of a
        // chord played over full voices gets its own)
        let open = |i: &usize| self.voices[*i].pending.is_none();
        let i = free.unwrap_or_else(|| {
            let released = (0..VOICES).filter(open).filter(|&i| self.voices[i].amp.stage == Stage::Release).min_by(|&a, &b| self.voices[a].amp.value.partial_cmp(&self.voices[b].amp.value).unwrap());
            released.or_else(|| (0..VOICES).filter(open).min_by_key(|&i| self.voices[i].age)).unwrap_or_else(|| (0..VOICES).min_by_key(|&i| self.voices[i].age).unwrap())
        });
        if self.voices[i].active {
            // Taken while sounding: fade it out over 3 ms, then start the new note
            self.voices[i].pending = Some((note, vel));
            return;
        }
        self.voices[i].pitch = note as f32;
        self.voices[i].target = note as f32;
        self.voices[i].glide = 0.0;
        self.start(i, note, vel, &cfg, true);
    }

    fn start(&mut self, i: usize, note: u8, vel: f32, cfg: &Cfg, fresh: bool) {
        self.age += 1;
        let sr = self.sr;
        let seed = self.rng.next();
        let rand = self.rng.bipolar();
        // Fresh random levels for the LFOs that start with the note (Steps and Drift are random
        // from the note's first cycle, and in One shot, which never wraps to draw new ones)
        let held: [(f32, f32); 4] = std::array::from_fn(|_| (self.rng.bipolar(), self.rng.bipolar()));
        let v = &mut self.voices[i];
        let was_active = v.active;
        v.active = true;
        v.note = note;
        v.vel = vel;
        v.age = self.age;
        v.sustained = false;
        v.pending = None;
        v.fade = 1.0;
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
            if cfg.lfo[k].mode > 0 {
                v.lfo_phase[k] = cfg.lfo[k].phase;
                v.lfo_held[k] = held[k];
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
                v.shaper[c].reset();
            }
        }
    }

    fn note_off(&mut self, note: u8) {
        self.stack.retain(|&n| n != note);
        let mode = self.v(p::MODE) as usize;
        // Mono and legato: back to the last key still held, gliding there without a new attack
        // (only the mono voice; voices left from playing in poly still end as usual)
        let mut glided = false;
        if mode > 0 && self.voices[0].note == note {
            if let Some(&back) = self.stack.last() {
                let v = &mut self.voices[0];
                v.glide = v.pitch - back as f32;
                v.target = back as f32;
                v.note = back;
                glided = true;
            }
        }
        let pedal = self.pedal;
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
                // The note waiting for this voice is over before it began: the voice it was taken
                // from is already fading, so let it finish going (not stay part-faded)
                v.pending = None;
                v.release();
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
        let spread = [Spread::new(&cfg.osc[0], cfg.osc[0].detune), Spread::new(&cfg.osc[1], cfg.osc[1].detune)];
        for c in 0..2 {
            self.out[c][..frames].fill(0.0);
        }
        let rate: [f32; 4] = std::array::from_fn(|k| cfg.lfo[k].hz * 2f32.powf(3.0 * self.lfo_rate_mod[k].clamp(-1.0, 1.0)));

        // The free LFOs run here, shared by every note
        let mut shared = [[0.0f32; NBLK]; 4];
        for k in 0..4 {
            if cfg.lfo[k].mode != 0 {
                continue;
            }
            for (b, slot) in shared[k].iter_mut().enumerate().take(nblk) {
                let ph = (self.lfo_phase[k] + cfg.lfo[k].phase).fract();
                // Steps and Drift move to their next level where the cycle (as read, with its
                // phase offset) starts again, so they never jump mid-cycle
                if ph < self.lfo_read[k] {
                    self.lfo_held[k] = (self.lfo_held[k].1, self.rng.bipolar());
                }
                self.lfo_read[k] = ph;
                *slot = lfo_value(&cfg, k, ph, self.lfo_held[k]);
                let n = frames.saturating_sub(b * CONTROL).min(CONTROL);
                self.lfo_phase[k] = (self.lfo_phase[k] + rate[k] * n as f32 / sr).fract();
            }
        }
        // The whole synth's modulation, each stretch of CONTROL samples
        let mut gm = [[0.0f32; NDEST]; NBLK];
        for (b, m) in gm.iter_mut().enumerate().take(nblk) {
            let mut s = [0.0f32; NSRC];
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
            route(&cfg, &s, m);
            // A free LFO with a fade in is a note's source (each note fades it in its own time),
            // but the whole-synth targets (LFO rates, effect mixes, width) have no note: they
            // take it unfaded
            let mut faded = [0.0f32; NSRC];
            let mut any = false;
            for k in 0..4 {
                if cfg.lfo[k].mode == 0 && !cfg.lfo[k].global {
                    faded[src::LFO + k] = shared[k][b];
                    any = true;
                }
            }
            if any {
                let mut extra = [0.0f32; NDEST];
                route(&cfg, &faded, &mut extra);
                for (t, x) in m.iter_mut().zip(extra.iter()).skip(p::GLOBAL_DESTS) {
                    *t += x;
                }
            }
        }
        for k in 0..4 {
            self.lfo_rate_mod[k] = gm[nblk - 1][d::LFO_RATE + k];
        }

        let glide = if cfg.mode > 0 && cfg.glide > 0.0015 { 1.0 - (-1.0 / (cfg.glide * sr / 3.0)).exp() } else { 1.0 };
        let fade_step = 1.0 / (0.003 * sr);
        let bend = self.bend * cfg.bend_range;
        let pdecay = (-1.0 / (cfg.pdecay * sr)).exp();
        let tab = [table(cfg.osc[0].table), table(cfg.osc[1].table)];
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
                let mut s = [0.0f32; NSRC];
                {
                    let v = &mut self.voices[vi];
                    for k in 0..4 {
                        let l = &cfg.lfo[k];
                        if l.global {
                            continue;
                        }
                        let val = if l.mode == 0 {
                            shared[k][blk]
                        } else {
                            let ph = if l.mode == 2 { v.lfo_phase[k].min(0.9999) } else { v.lfo_phase[k] };
                            let val = lfo_value(&cfg, k, ph, v.lfo_held[k]);
                            v.lfo_phase[k] += rate[k] * n_here / sr;
                            if l.mode == 1 && v.lfo_phase[k] >= 1.0 {
                                v.lfo_phase[k] -= v.lfo_phase[k].floor();
                                v.lfo_held[k] = (v.lfo_held[k].1, self.rng.bipolar());
                            } else if l.mode == 2 {
                                v.lfo_phase[k] = v.lfo_phase[k].min(1.0);
                            }
                            val
                        };
                        let fade = if l.fade > 0.0011 { (v.time / l.fade).min(1.0) } else { 1.0 };
                        s[src::LFO + k] = val * fade;
                    }
                    s[src::AMP] = v.amp.value;
                    s[src::FENV] = v.fenv.value;
                    s[src::MENV] = v.menv.value;
                    s[src::VEL] = v.vel;
                    s[src::NOTE] = ((v.pitch - 60.0) / 36.0).clamp(-1.0, 1.0);
                    s[src::RAND] = v.rand;
                    v.time += n_here / sr;
                }
                let mut m = gm[blk];
                route(&cfg, &s, &mut m);
                let pend = self.voices[vi].pending;

                let v = &mut self.voices[vi];
                let pitch = v.pitch + bend + cfg.penv * v.penv + m[d::PITCH] * 12.0;
                let fa = 440.0 * 2f32.powf((pitch + cfg.osc[0].tune + m[d::APITCH] * 12.0 - 69.0) / 12.0);
                let fb = 440.0 * 2f32.powf((pitch + cfg.osc[1].tune + m[d::BPITCH] * 12.0 - 69.0) / 12.0);
                let inc = [fa / sr, fb / sr];
                // The sub follows the note itself (not oscillator A's tuning, which may be off)
                let sub_inc = 440.0 * 2f32.powf((pitch - 69.0) / 12.0) / sr * cfg.sub_div;
                let sp = [
                    if m[d::ADET] != 0.0 { Spread::new(&cfg.osc[0], (cfg.osc[0].detune + m[d::ADET]).clamp(0.0, 1.0)) } else { spread[0] },
                    if m[d::BDET] != 0.0 { Spread::new(&cfg.osc[1], (cfg.osc[1].detune + m[d::BDET]).clamp(0.0, 1.0)) } else { spread[1] },
                ];
                let warp = [(cfg.osc[0].warp_amt + m[d::AWARP]).clamp(0.0, 1.0), (cfg.osc[1].warp_amt + m[d::BWARP]).clamp(0.0, 1.0)];
                let lvl = [
                    level_for(inc[0] * sp[0].top * warp_stretch(cfg.osc[0].warp, warp[0])),
                    level_for(inc[1] * sp[1].top * warp_stretch(cfg.osc[1].warp, warp[1])),
                ];
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
                let pre = 1.0 + 4.0 * fdrive;
                let drive_db = (cfg.drive + m[d::DRIVE] * 24.0).clamp(0.0, 48.0);
                let dgain = 10f32.powf(drive_db / 20.0);
                let makeup = shaper_makeup(cfg.shaper, dgain);
                let drive_mix = (cfg.drive_mix + m[d::DMIX]).clamp(0.0, 1.0);
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
                    v.glide *= 1.0 - glide;
                    v.pitch = v.target + v.glide;
                    v.penv *= pdecay;
                    let env = v.amp.tick();
                    v.fenv.tick();
                    v.menv.tick();
                    if pend.is_some() {
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
                            let raw = tab[o].read(lvl[o], pos[o], read);
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
                        let nz = self.rng.bipolar() * noise * 0.5;
                        send(&mut bus, cfg.noise_route, nz, nz);
                    }
                    // Filters and drive, each side
                    let mut outc = [0.0f32; 2];
                    for c in 0..2 {
                        let mut x1 = bus[0][c] * 0.8;
                        if fdrive > 0.0 {
                            x1 = fast_tanh(x1 * pre) / pre.sqrt();
                        }
                        let y1 = v.filt[0][c].tick(&c1, x1);
                        let filtered = if cfg.serial {
                            v.filt[1][c].tick(&c2, y1 + bus[1][c] * 0.8)
                        } else if cfg.f2_used {
                            y1 + v.filt[1][c].tick(&c2, bus[1][c] * 0.8)
                        } else {
                            y1
                        };
                        let y = filtered + bus[2][c] * 0.8;
                        outc[c] = if cfg.shaper > 0 && drive_mix > 0.0 {
                            let w = v.shaper[c].tick(cfg.shaper, y * dgain) / makeup;
                            y + (w - y) * drive_mix
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
                    let a = env * vel_gain * vol * v.fade;
                    self.out[0][n] += (outc[0] * pl + sub) * a;
                    self.out[1][n] += (outc[1] * pr + sub) * a;
                }
                // A voice taken for a new note: once faded out, the new note starts here
                if let Some((note, vel)) = self.voices[vi].pending {
                    // (Or its old note ended on its own before the fade did)
                    if self.voices[vi].fade <= 0.0 || self.voices[vi].amp.stage == Stage::Idle {
                        self.voices[vi].active = false;
                        self.voices[vi].pitch = note as f32;
                        self.voices[vi].target = note as f32;
                        self.voices[vi].glide = 0.0;
                        self.start(vi, note, vel, &cfg, true);
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
        for n in 0..frames {
            let (mut l, mut r) = (self.out[0][n], self.out[1][n]);
            // The low end in mono: the side signal loses everything under 120 Hz; then the width
            let width = (cfg.width + gm[n / CONTROL][d::WIDTH]).clamp(0.0, 1.0);
            let mid = (l + r) * 0.5;
            let mut side = (l - r) * 0.5;
            let s1 = self.side_hp[0].tick(&self.side_coef, side).hp;
            side = self.side_hp[1].tick(&self.side_coef, s1).hp * width * 2.0;
            self.gain += (target - self.gain) * gstep;
            l = (mid + side) * self.gain;
            r = (mid - side) * self.gain;
            self.out[0][n] = self.clip[0].tick(l);
            self.out[1][n] = self.clip[1].tick(r);
        }
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
            let sp = Spread::new(&o, 0.0);
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

}
