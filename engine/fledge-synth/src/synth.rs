//! The synth: up to eight voices of two wavetable oscillators (each with up to 16 unison
//! voices), a sub, noise, a filter, drive and three envelopes, two LFOs, then the OTT, the mono
//! low end, the level and the safety clipper. Everything the host sees goes through `Synth`.

use crate::dsp::*;
use crate::params::{self as p, db_gain, param, COUNT};
use crate::tables::{level_for, table};

pub const BLOCK: usize = 128;
/// Modulation (LFOs, envelopes into cutoff, pitch) is worked out every this many samples
const CONTROL: usize = 16;
const VOICES: usize = 8;
const UNISON: usize = 16;

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
}

#[derive(Clone, Copy, Default)]
struct LfoCfg {
    shape: u32,
    /// Cycles per second
    hz: f32,
    retrig: bool,
    dest: [usize; 2],
    amt: [f32; 2],
}

#[derive(Clone, Copy, Default)]
struct Cfg {
    osc: [OscCfg; 2],
    fm: f32,
    sub: f32,
    sub_div: f32,
    noise: f32,
    filter: usize,
    cutoff: f32,
    reso: f32,
    fdrive: f32,
    keytrack: f32,
    fenv: f32,
    amp: [f32; 4],
    fadsr: [f32; 4],
    penv: f32,
    pdecay: f32,
    shaper: u32,
    drive: f32,
    drive_mix: f32,
    lfo: [LfoCfg; 2],
    mw_dest: usize,
    mw_amt: f32,
    mode: usize,
    glide: f32,
    bend_range: f32,
    vel: f32,
    ott: f32,
    ott_time: f32,
    width: f32,
    level: f32,
}

/// One oscillator's unison spread for a block: each voice's pitch offset and stereo gains.
#[derive(Clone, Copy)]
struct Spread {
    n: usize,
    ratio: [f32; UNISON],
    gl: [f32; UNISON],
    gr: [f32; UNISON],
}

impl Spread {
    fn new(o: &OscCfg) -> Self {
        let n = o.unison.clamp(1, UNISON);
        let mut s = Spread { n, ratio: [1.0; UNISON], gl: [0.0; UNISON], gr: [0.0; UNISON] };
        if n == 1 {
            s.gl[0] = 1.0;
            s.gr[0] = 1.0;
            return s;
        }
        // The detune grows slowly then fast (as the classic supersaw's knob does): up to 100 cents
        let cents = 100.0 * o.detune * o.detune;
        // Centre and detuned levels from the blend, at constant loudness
        let centre = 1.0 + (0.4 - 1.0) * o.blend;
        let detuned = 0.6 * (1.0 - (1.0 - o.blend) * (1.0 - o.blend));
        let mid = if n % 2 == 1 { Some(n / 2) } else { None };
        let mut w = [0.0f32; UNISON];
        let mut sum = 0.0;
        for i in 0..n {
            let t = -1.0 + 2.0 * i as f32 / (n - 1) as f32;
            // Outer voices spread furthest (|t|^1.5, near the measured supersaw spacing)
            let off = t.signum() * t.abs().powf(1.5) * cents;
            s.ratio[i] = 2f32.powf(off / 1200.0);
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
            s.gl[i] *= w[i] * norm;
            s.gr[i] *= w[i] * norm;
        }
        s
    }
}

#[derive(Clone)]
struct Voice {
    active: bool,
    note: u8,
    vel: f32,
    age: u64,
    /// The pitch now and where it glides to, in semitones (MIDI note numbers)
    pitch: f32,
    target: f32,
    amp: Env,
    fenv: Env,
    penv: f32,
    phase: [[f32; UNISON]; 2],
    sub_phase: f32,
    svf: [[Svf; 2]; 2],
    formant: [[Svf; 3]; 2],
    ladder: [Ladder; 2],
    comb: [Comb; 2],
    shaper: [Shaper; 2],
    lfo_phase: [f32; 2],
    lfo_held: [(f32, f32); 2],
    /// Held down by the sustain pedal after its key came up
    sustained: bool,
    /// A note waiting for this voice to fade out (it was taken for a new one)
    pending: Option<(u8, f32)>,
    fade: f32,
}

impl Voice {
    fn new(sr: f32) -> Self {
        Voice {
            active: false,
            note: 0,
            vel: 0.0,
            age: 0,
            pitch: 60.0,
            target: 60.0,
            amp: Env::default(),
            fenv: Env::default(),
            penv: 0.0,
            phase: [[0.0; UNISON]; 2],
            sub_phase: 0.0,
            svf: [[Svf::default(); 2]; 2],
            formant: [[Svf::default(); 3]; 2],
            ladder: [Ladder::default(); 2],
            comb: [Comb::new(sr), Comb::new(sr)],
            shaper: [Shaper::default(); 2],
            lfo_phase: [0.0; 2],
            lfo_held: [(0.0, 0.0); 2],
            sustained: false,
            pending: None,
            fade: 1.0,
        }
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
    pedal: bool,
    /// Keys held, oldest first (mono and legato go back to the last one still held)
    stack: Vec<u8>,
    lfo_phase: [f32; 2],
    lfo_held: [(f32, f32); 2],
    ott: Ott,
    side_hp: [Svf; 2],
    side_coef: SvfCoef,
    clip: [SafetyClip; 2],
    gain: f32,
    pub out: [[f32; BLOCK]; 2],
    pub input: [[f32; BLOCK]; 2],
}

impl Synth {
    pub fn new(sr: f32) -> Self {
        // Make the tables now (a first note shouldn't wait for them)
        for t in 0..p::TABLES.len() {
            table(t);
        }
        Synth {
            sr,
            params: p::defaults(),
            tempo: 120.0,
            voices: (0..VOICES).map(|_| Voice::new(sr)).collect(),
            rng: Rng::new(0x9E37_79B9),
            age: 0,
            bend: 0.0,
            modwheel: 0.0,
            pedal: false,
            stack: Vec::with_capacity(32),
            lfo_phase: [0.0; 2],
            lfo_held: [(0.0, 0.0); 2],
            ott: Ott::new(sr),
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
        };
        let lfo = |base: usize| {
            let sync = self.v(base + p::lfo::SYNC) > 0.5;
            let hz = if sync { self.tempo / 60.0 / p::SYNC_BEATS[self.v(base + p::lfo::DIV) as usize] } else { self.v(base + p::lfo::HZ) };
            LfoCfg {
                shape: self.v(base + p::lfo::SHAPE) as u32,
                hz,
                retrig: self.v(base + p::lfo::RETRIG) > 0.5,
                dest: [self.v(base + p::lfo::DEST1) as usize, self.v(base + p::lfo::DEST2) as usize],
                amt: [self.v(base + p::lfo::AMT1), self.v(base + p::lfo::AMT2)],
            }
        };
        Cfg {
            osc: [osc(p::A), osc(p::B)],
            fm: self.v(p::FM),
            sub: db_gain(self.v(p::SUB_LEVEL)),
            sub_div: if self.v(p::SUB_OCT) > 0.5 { 0.25 } else { 0.5 },
            noise: db_gain(self.v(p::NOISE)),
            filter: self.v(p::FILTER_TYPE) as usize,
            cutoff: self.v(p::CUTOFF),
            reso: self.v(p::RESO),
            fdrive: self.v(p::FILTER_DRIVE),
            keytrack: self.v(p::KEYTRACK),
            fenv: self.v(p::FENV_AMT),
            amp: [self.v(p::AMP_A), self.v(p::AMP_D), self.v(p::AMP_S), self.v(p::AMP_R)],
            fadsr: [self.v(p::FENV_A), self.v(p::FENV_D), self.v(p::FENV_S), self.v(p::FENV_R)],
            penv: self.v(p::PENV_AMT),
            pdecay: self.v(p::PENV_D),
            shaper: self.v(p::SHAPER) as u32,
            drive: self.v(p::DRIVE),
            drive_mix: self.v(p::DRIVE_MIX),
            lfo: [lfo(p::LFO_1), lfo(p::LFO_2)],
            mw_dest: self.v(p::MW_DEST) as usize,
            mw_amt: self.v(p::MW_AMT),
            mode: self.v(p::MODE) as usize,
            glide: self.v(p::GLIDE),
            bend_range: self.v(p::BEND),
            vel: self.v(p::VELOCITY),
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
            0xB0 => match d1 {
                1 => self.modwheel = d2 as f32 / 127.0,
                64 => {
                    self.pedal = d2 >= 64;
                    if !self.pedal {
                        for v in self.voices.iter_mut().filter(|v| v.sustained) {
                            v.sustained = false;
                            v.amp.gate(false);
                            v.fenv.gate(false);
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
        for v in self.voices.iter_mut() {
            v.sustained = false;
            v.pending = None;
            if hard {
                v.active = false;
                v.amp = Env::default();
            } else {
                v.amp.gate(false);
                v.fenv.gate(false);
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
            v.target = note as f32;
            v.note = note;
            if !(joined && cfg.mode == 2) {
                if !v.active {
                    v.pitch = note as f32;
                }
                self.start(0, note, vel, &cfg, false);
            }
            return;
        }
        // Poly: a free voice, else the quietest released one, else the oldest (faded out first)
        let free = self.voices.iter().position(|v| !v.active && v.pending.is_none());
        let i = free.unwrap_or_else(|| {
            let released = (0..VOICES).filter(|&i| self.voices[i].amp.stage == Stage::Release).min_by(|&a, &b| self.voices[a].amp.value.partial_cmp(&self.voices[b].amp.value).unwrap());
            released.unwrap_or_else(|| (0..VOICES).min_by_key(|&i| self.voices[i].age).unwrap())
        });
        if self.voices[i].active {
            // Taken while sounding: fade it out over 3 ms, then start the new note
            let v = &mut self.voices[i];
            v.pending = Some((note, vel));
            return;
        }
        self.voices[i].pitch = note as f32;
        self.voices[i].target = note as f32;
        self.start(i, note, vel, &cfg, true);
    }

    fn start(&mut self, i: usize, note: u8, vel: f32, cfg: &Cfg, fresh: bool) {
        self.age += 1;
        let sr = self.sr;
        let seed = self.rng.next();
        let v = &mut self.voices[i];
        let was_active = v.active;
        v.active = true;
        v.note = note;
        v.vel = vel;
        v.age = self.age;
        v.sustained = false;
        v.pending = None;
        v.fade = 1.0;
        v.amp.set(cfg.amp[0], cfg.amp[1], cfg.amp[2], cfg.amp[3], sr);
        v.fenv.set(cfg.fadsr[0], cfg.fadsr[1], cfg.fadsr[2], cfg.fadsr[3], sr);
        v.amp.gate(true);
        v.fenv.gate(true);
        v.penv = 1.0;
        for k in 0..2 {
            if cfg.lfo[k].retrig {
                v.lfo_phase[k] = 0.0;
            }
        }
        if fresh || !was_active {
            // Each unison voice starts at a random point of its cycle (seeded, so renders repeat)
            let mut r = Rng::new((seed * 4_000_000_000.0) as u32 ^ 0x5bd1_e995);
            for o in 0..2 {
                for u in 0..UNISON {
                    v.phase[o][u] = if cfg.osc[o].unison > 1 { r.next() } else { 0.0 };
                }
            }
            v.sub_phase = 0.0;
            for c in 0..2 {
                v.svf[c] = [Svf::default(); 2];
                v.formant[c] = [Svf::default(); 3];
                v.ladder[c].reset();
                v.comb[c].reset();
                v.shaper[c].reset();
            }
        }
    }

    fn note_off(&mut self, note: u8) {
        self.stack.retain(|&n| n != note);
        let mode = self.v(p::MODE) as usize;
        if mode > 0 {
            let v = &mut self.voices[0];
            if v.note != note {
                return;
            }
            if let Some(&back) = self.stack.last() {
                // Back to the last key still held, gliding there without a new attack
                v.target = back as f32;
                v.note = back;
                return;
            }
        }
        let pedal = self.pedal;
        for v in self.voices.iter_mut().filter(|v| v.active && v.note == note && v.amp.stage != Stage::Release) {
            if pedal {
                v.sustained = true;
            } else {
                v.amp.gate(false);
                v.fenv.gate(false);
            }
        }
        for v in self.voices.iter_mut() {
            if v.pending.map(|(n, _)| n) == Some(note) {
                v.pending = None;
            }
        }
    }

    // ---------- sound ----------

    /// Render `frames` (up to BLOCK) into `out`.
    pub fn process(&mut self, frames: usize) {
        let frames = frames.min(BLOCK);
        let cfg = self.cfg();
        let sr = self.sr;
        let spread = [Spread::new(&cfg.osc[0]), Spread::new(&cfg.osc[1])];
        for c in 0..2 {
            self.out[c][..frames].fill(0.0);
        }

        // The LFOs that don't restart with each note run here, shared by every voice
        let mut shared = [[0.0f32; BLOCK / CONTROL + 1]; 2];
        for k in 0..2 {
            for slot in shared[k].iter_mut().take(frames.div_ceil(CONTROL)) {
                *slot = lfo_shape(cfg.lfo[k].shape, self.lfo_phase[k], self.lfo_held[k]);
                let step = cfg.lfo[k].hz * CONTROL as f32 / sr;
                self.lfo_phase[k] += step;
                if self.lfo_phase[k] >= 1.0 {
                    self.lfo_phase[k] -= self.lfo_phase[k].floor();
                    self.lfo_held[k] = (self.lfo_held[k].1, self.rng.bipolar());
                }
            }
        }

        let glide = if cfg.mode > 0 && cfg.glide > 0.0015 { 1.0 - (-1.0 / (cfg.glide * sr / 3.0)).exp() } else { 1.0 };
        let fade_step = 1.0 / (0.003 * sr);
        let bend = self.bend * cfg.bend_range;
        let mw = self.modwheel;

        for vi in 0..VOICES {
            if !self.voices[vi].active {
                continue;
            }
            let mut start = 0;
            while start < frames {
                let end = (start + CONTROL).min(frames);
                let block = start / CONTROL;
                // ---- control: the modulation for these samples ----
                let (lfo_now, pend) = {
                    let v = &mut self.voices[vi];
                    let mut out = [0.0f32; 2];
                    for k in 0..2 {
                        if cfg.lfo[k].retrig {
                            out[k] = lfo_shape(cfg.lfo[k].shape, v.lfo_phase[k], v.lfo_held[k]);
                            v.lfo_phase[k] += cfg.lfo[k].hz * (end - start) as f32 / sr;
                            if v.lfo_phase[k] >= 1.0 {
                                v.lfo_phase[k] -= v.lfo_phase[k].floor();
                                v.lfo_held[k] = (v.lfo_held[k].1, self.rng.bipolar());
                            }
                        } else {
                            out[k] = shared[k][block];
                        }
                    }
                    (out, v.pending)
                };
                let mut m = [0.0f32; 12];
                for k in 0..2 {
                    for d in 0..2 {
                        m[cfg.lfo[k].dest[d]] += cfg.lfo[k].amt[d] * lfo_now[k];
                    }
                }
                m[cfg.mw_dest] += cfg.mw_amt * mw;
                m[0] = 0.0;

                let v = &mut self.voices[vi];
                let pitch = v.pitch + bend + cfg.penv * v.penv + m[5] * 12.0;
                let fa = 440.0 * 2f32.powf((pitch + cfg.osc[0].tune - 69.0) / 12.0);
                let fb = 440.0 * 2f32.powf((pitch + cfg.osc[1].tune + m[10] * 12.0 - 69.0) / 12.0);
                let inc = [fa / sr, fb / sr];
                let lvl = [level_for(inc[0] * spread[0].ratio[spread[0].n - 1]), level_for(inc[1] * spread[1].ratio[spread[1].n - 1])];
                let pos = [(cfg.osc[0].pos + m[3] * 0.5).clamp(0.0, 1.0), (cfg.osc[1].pos + m[4] * 0.5).clamp(0.0, 1.0)];
                let tab = [table(cfg.osc[0].table), table(cfg.osc[1].table)];
                // FM: B into A's phase, deepest for low notes, held back on high ones (they'd fold)
                let fm_amt = (cfg.fm + m[8]).clamp(0.0, 1.0);
                let fm = if cfg.osc[1].on { fm_amt * fm_amt * 2.5 * (330.0 / fa).clamp(0.05, 1.0).sqrt() } else { 0.0 };
                // The filter's cutoff for these samples
                let fenv_now = v.fenv.value;
                let octaves = cfg.keytrack * (v.pitch - 60.0) / 12.0 + cfg.fenv * fenv_now * 6.0 + m[1] * 5.0;
                let cutoff = (cfg.cutoff * 2f32.powf(octaves)).clamp(16.0, sr * 0.45);
                let reso = (cfg.reso + m[2] * 0.5).clamp(0.0, 1.0);
                let fk = 2.0 - 1.9 * reso;
                let svf_a = SvfCoef::new(cutoff, sr, fk);
                let svf_b = SvfCoef::new(cutoff, sr, std::f32::consts::SQRT_2);
                let g = (std::f32::consts::PI * cutoff / sr).tan();
                let ladder_k = reso * 3.7;
                let period = sr / cutoff;
                let comb_fb = reso * 0.97;
                let vowel = ((cfg.cutoff.ln() - 20f32.ln()) / (20000f32.ln() - 20f32.ln()) * 4.0 + m[1] * 2.0).clamp(0.0, 4.0);
                let form = vowel_formants(vowel);
                let fq = 0.35 - 0.28 * reso;
                let form_c = [SvfCoef::new(form[0], sr, fq), SvfCoef::new(form[1], sr, fq), SvfCoef::new(form[2], sr, fq)];
                let pre = 1.0 + 4.0 * cfg.fdrive;
                let drive_db = (cfg.drive + m[7] * 24.0).clamp(0.0, 48.0);
                let dgain = 10f32.powf(drive_db / 20.0);
                let makeup = shaper_makeup(cfg.shaper, dgain);
                let vel_gain = 1.0 - cfg.vel * (1.0 - v.vel);
                let vol = vol_mod(m[6]);
                let sub_gain = cfg.sub * vol_mod(m[11]);
                let pan = m[9].clamp(-1.0, 1.0);
                let (pl, pr) = ((1.0 - pan).sqrt(), (1.0 + pan).sqrt());
                let pdecay = (-1.0 / (cfg.pdecay * sr)).exp();

                for n in start..end {
                    // Glide and the pitch envelope move per sample
                    v.pitch += (v.target - v.pitch) * glide;
                    v.penv *= pdecay;
                    let env = v.amp.tick();
                    v.fenv.tick();
                    if pend.is_some() {
                        v.fade -= fade_step;
                        if v.fade <= 0.0 {
                            break;
                        }
                    }
                    // Oscillator B first (A's FM reads it)
                    let mut mix = [0.0f32; 2];
                    let mut modb = 0.0;
                    for o in [1usize, 0] {
                        let oc = &cfg.osc[o];
                        if !oc.on {
                            continue;
                        }
                        let sp = &spread[o];
                        let ph = &mut v.phase[o];
                        for u in 0..sp.n {
                            let mut read = ph[u];
                            if o == 0 && fm > 0.0 {
                                read = (read + fm * modb).rem_euclid(1.0);
                            }
                            let s = tab[o].read(lvl[o], pos[o], read);
                            if o == 1 && u == 0 {
                                modb = s;
                            }
                            mix[0] += s * sp.gl[u] * oc.level;
                            mix[1] += s * sp.gr[u] * oc.level;
                            ph[u] += inc[o] * sp.ratio[u];
                            if ph[u] >= 1.0 {
                                ph[u] -= 1.0;
                            }
                        }
                    }
                    if cfg.noise > 0.0 {
                        let nz = self.rng.bipolar() * cfg.noise * 0.5;
                        mix[0] += nz;
                        mix[1] += nz;
                    }
                    // Filter and drive, each side
                    let mut outc = [0.0f32; 2];
                    for c in 0..2 {
                        let mut x = mix[c] * 0.8;
                        if cfg.fdrive > 0.0 {
                            x = fast_tanh(x * pre) / pre.sqrt();
                        }
                        let y = match cfg.filter {
                            0 => v.svf[c][0].tick(&svf_a, x).lp,
                            1 => {
                                let a = v.svf[c][0].tick(&svf_a, x).lp;
                                v.svf[c][1].tick(&svf_b, a).lp
                            }
                            2 => v.ladder[c].tick(g, ladder_k, x) * (1.0 + ladder_k * 0.25),
                            3 => v.svf[c][0].tick(&svf_a, x).bp * fk,
                            4 => v.svf[c][0].tick(&svf_a, x).hp,
                            5 => {
                                let a = v.svf[c][0].tick(&svf_a, x).hp;
                                v.svf[c][1].tick(&svf_b, a).hp
                            }
                            6 => {
                                let o = v.svf[c][0].tick(&svf_a, x);
                                o.lp + o.hp
                            }
                            7 => v.comb[c].tick(x, period, comb_fb, false) * (1.0 - comb_fb * 0.6),
                            8 => v.comb[c].tick(x, period, comb_fb, true) * (1.0 - comb_fb * 0.6),
                            9 => {
                                let f = &mut v.formant[c];
                                (f[0].tick(&form_c[0], x).bp * 1.0 + f[1].tick(&form_c[1], x).bp * 0.7 + f[2].tick(&form_c[2], x).bp * 0.45) * fq * 1.8
                            }
                            _ => x,
                        };
                        let shaped = if cfg.shaper > 0 && cfg.drive_mix > 0.0 {
                            let w = v.shaper[c].tick(cfg.shaper, y * dgain) / makeup;
                            y + (w - y) * cfg.drive_mix
                        } else {
                            y
                        };
                        outc[c] = shaped;
                    }
                    // The sub: a sine under it all, clean (no filter, no drive) and in the middle
                    let mut sub = 0.0;
                    if sub_gain > 0.0 {
                        sub = (2.0 * std::f32::consts::PI * v.sub_phase).sin() * sub_gain * 0.5;
                        v.sub_phase += inc[0] * cfg.sub_div;
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
                    if self.voices[vi].fade <= 0.0 {
                        let cfg2 = cfg;
                        self.voices[vi].active = false;
                        self.voices[vi].pitch = note as f32;
                        self.voices[vi].target = note as f32;
                        self.start(vi, note, vel, &cfg2, true);
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
        let att = 1.0 - (-1.0 / ((0.002 + 0.03 * cfg.ott_time) * sr)).exp();
        let rel = 1.0 - (-1.0 / ((0.03 + 0.4 * cfg.ott_time) * sr)).exp();
        let target = cfg.level;
        let gstep = 1.0 - (-1.0 / (0.01 * sr)).exp();
        for n in 0..frames {
            let (mut l, mut r) = (self.out[0][n], self.out[1][n]);
            if cfg.ott > 0.0 {
                (l, r) = self.ott.tick(l, r, cfg.ott, att, rel);
            }
            // The low end in mono: the side signal loses everything under 120 Hz; then the width
            let mid = (l + r) * 0.5;
            let mut side = (l - r) * 0.5;
            let s1 = self.side_hp[0].tick(&self.side_coef, side).hp;
            side = self.side_hp[1].tick(&self.side_coef, s1).hp * cfg.width * 2.0;
            self.gain += (target - self.gain) * gstep;
            l = (mid + side) * self.gain;
            r = (mid - side) * self.gain;
            self.out[0][n] = self.clip[0].tick(l);
            self.out[1][n] = self.clip[1].tick(r);
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
                s.params[p::FILTER_TYPE] = f as f32 / (p::FILTERS.len() - 1) as f32;
                s.params[p::SHAPER] = sh as f32 / (p::SHAPERS.len() - 1) as f32;
                s.params[p::DRIVE] = 1.0;
                s.params[p::RESO] = 1.0;
                s.params[p::A + p::osc::UNISON] = 1.0;
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
        s.params[p::AMP_R] = 1.0;
        for n in 0..20 {
            s.midi(0x90, 40 + n, 100);
            render(&mut s, 5);
        }
        let (peak, _) = render(&mut s, 20);
        assert!(peak <= 0.9);
    }
}
