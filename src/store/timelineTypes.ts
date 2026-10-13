/**
 * The project's data types (Track, Clip, NoteEvent, the insert settings, automation, markers,
 * master settings and the rest) with their defaults, limits and small helpers (snapping,
 * durations, frame grids). Everything the store, the engine and the project file share.
 */
import { barToSeconds, secondsToBar, type TempoPoint } from '../audio/tempoMap';
import type { InstrumentKey } from '../audio/engine';
import type { SynthPatch } from './synthPatch';
import { frameSeconds, isDropFrame } from '../audio/timecode';

export type { InstrumentKey };

/** Song length limit: 400 bars is 5+ minutes even at 240 BPM (about 13 minutes at 120 BPM). */
export const TOTAL_BARS = 400;

export interface TrackEq {
  /** -24 dB to +12 dB (shelf at 400Hz) */
  low: number;
  /** -24 dB to +12 dB (bell at 1.0kHz) */
  mid: number;
  /** -24 dB to +12 dB (shelf at 2.5kHz) */
  high: number;
}

/** The Filter insert's response: low-pass, high-pass or band-pass. */
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

/** How steeply the Filter cuts: 12 dB per octave (one biquad) or 24 (two in series). */
export const FILTER_SLOPES = [12, 24] as const;
export type FilterSlope = (typeof FILTER_SLOPES)[number];

/** What makes the Pump duck: every kick drum note (C1 on a sounding drum kit), every beat, every 8th, or every note of one track (`source`). */
export const PUMP_TRIGGERS = ['kick', 'beat', 'eighth', 'track'] as const;
export type PumpTrigger = (typeof PUMP_TRIGGERS)[number];

/**
 * Per-track insert effects, in signal order: Distortion -> (EQ) -> Compressor -> Chorus -> Filter
 * -> Pump. The EQ lives on Track.eq. Each insert can be bypassed with `on`.
 */
export interface TrackFx {
  distortion: {
    on: boolean;
    /** 0 to 1 */
    amount: number;
  };
  compressor: {
    on: boolean;
    /** -60 dB to 0 dB */
    threshold: number;
    /** 1:1 to 20:1 */
    ratio: number;
    /** 0 dB to +18 dB of gain after compression */
    makeup: number;
  };
  chorus: {
    on: boolean;
    /** LFO rate, 0.1 Hz to 8 Hz */
    rate: number;
    /** 0 to 1 */
    depth: number;
    /** wet mix, 0 to 1 */
    mix: number;
  };
  filter: {
    on: boolean;
    type: FilterType;
    /** Cutoff (centre for band-pass), 20 Hz to 20 kHz */
    cutoff: number;
    /** Resonance as a Q, 0.5 to 15 (0.71 is flat: no peak at the cutoff) */
    resonance: number;
    slope: FilterSlope;
  };
  /** Sidechain-style ducking in time with the music. */
  pump: {
    on: boolean;
    /** How far the volume ducks at each trigger, 0 to 1 */
    depth: number;
    /** How long it takes to swell back to full volume, 50 ms to 600 ms */
    release: number;
    trigger: PumpTrigger;
    /** The track whose notes it ducks to (trigger 'track') */
    source?: string;
  };
  /** Lo-fi: bit crushing, a darker top and tape wow. */
  lofi: {
    on: boolean;
    /** 0 (16-bit, clean) to 1 (3-bit, gritty) */
    crush: number;
    /** Low-pass, 1 kHz to 20 kHz */
    tone: number;
    /** Tape wow (slow pitch wobble), 0 to 1 */
    wow: number;
    /** Wet mix, 0 to 1 */
    mix: number;
  };
  /** Trance gate / stutter: the volume chopped in time with the song. */
  gate: {
    on: boolean;
    rate: GateRate;
    /** How far it closes, 0 to 1 (1 = silent between chops) */
    depth: number;
    /** How much of each step it stays open, 0.1 to 0.95 */
    length: number;
  };
  /**
   * Delay: echoes at a note value of the song's tempo, fed back into themselves, darkened by a
   * tone filter, optionally bouncing left and right. Mostly heard on a return track, at full mix.
   */
  echo: {
    on: boolean;
    time: EchoTime;
    /** 0 to 0.9 */
    feedback: number;
    /** Low-pass on the echoes, ECHO_TONE_MIN to ECHO_TONE_MAX Hz */
    tone: number;
    pingPong: boolean;
    /** Wet mix, 0 to 1 */
    mix: number;
  };
  /** Reverb: a room / hall / plate tail of its own (unlike the shared master reverb). */
  reverb: {
    on: boolean;
    /** Tail length to -60 dB, REVERB_DECAY_MIN to REVERB_DECAY_MAX s */
    decay: number;
    /** ms before the tail starts, 0 to 200 */
    preDelay: number;
    /** Low-pass on the tail, ECHO_TONE_MIN to ECHO_TONE_MAX Hz (darker is warmer) */
    tone: number;
    /** Wet mix, 0 to 1 */
    mix: number;
  };
  /** Parametric EQ: up to PEQ_MAX_BANDS bands of any shape, drawn and dragged on a graph. */
  peq: {
    on: boolean;
    bands: PeqBand[];
  };
  /**
   * Multiband compressor: the sound split into low, mid and high bands at two crossovers, each
   * band compressed on its own, then put back together.
   */
  mbc: {
    on: boolean;
    /** Crossovers, Hz: low/mid and mid/high */
    lowFreq: number;
    highFreq: number;
    /** Shared timing, seconds */
    attack: number;
    release: number;
    bands: [MbcBand, MbcBand, MbcBand];
  };
  /**
   * Human feel: every note played a little differently, as a player would. Each amount is 0 to 1.
   * The variation is worked out from the note itself, so a note sounds the same every time the
   * song plays (and in an export), but no two notes are quite alike.
   */
  human: {
    on: boolean;
    /** Notes early or late, up to about 15 ms */
    timing: number;
    /** Notes softer or harder, up to about 30% */
    dynamics: number;
    /** Notes a touch sharp or flat, up to about 12 cents (pitched instruments only) */
    pitch: number;
  };
}

/** The shapes a parametric EQ band can take. */
export const PEQ_TYPES = ['lowcut', 'lowshelf', 'bell', 'notch', 'highshelf', 'highcut'] as const;
export type PeqType = (typeof PEQ_TYPES)[number];
export interface PeqBand {
  on: boolean;
  type: PeqType;
  /** Hz, 20 to 20000 */
  freq: number;
  /** dB, -24 to +24 (bells and shelves) */
  gain: number;
  /** Width as Q, 0.1 to 18 (bells, notches and cuts; shelves have a fixed slope) */
  q: number;
}
export const PEQ_MAX_BANDS = 6;
export const PEQ_GAIN_MAX = 24;
export const PEQ_Q_MIN = 0.1;
export const PEQ_Q_MAX = 18;

export interface MbcBand {
  /** dB, -60 to 0 */
  threshold: number;
  /** 1 to 20 */
  ratio: number;
  /** Makeup gain, dB, -12 to +18 */
  gain: number;
  /** Bypass this band (it passes through uncompressed) */
  bypass?: boolean;
}

/** Gate speeds: one chop per note value (T = triplet). */
export const GATE_RATES = ['1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export type GateRate = (typeof GATE_RATES)[number];
/** A gate step in Transport ticks (192 per quarter note). */
export const GATE_TICKS: Record<GateRate, number> = { '1/8': 96, '1/8T': 64, '1/16': 48, '1/16T': 32, '1/32': 24 };
/** Delay insert times, as note values of the tempo (d = dotted, t = triplet). */
export const ECHO_TIMES = ['1/32', '1/16t', '1/16', '1/8t', '1/16d', '1/8', '1/4t', '1/8d', '1/4', '1/4d', '1/2'] as const;
export type EchoTime = (typeof ECHO_TIMES)[number];
/** Each one in quarter notes. */
export const ECHO_BEATS: Record<EchoTime, number> = { '1/32': 0.125, '1/16t': 1 / 6, '1/16': 0.25, '1/8t': 1 / 3, '1/16d': 0.375, '1/8': 0.5, '1/4t': 2 / 3, '1/8d': 0.75, '1/4': 1, '1/4d': 1.5, '1/2': 2 };
export const ECHO_TONE_MIN = 500;
export const ECHO_TONE_MAX = 20000;
export const ECHO_FEEDBACK_MAX = 0.9;
export const REVERB_DECAY_MIN = 0.3;
export const REVERB_DECAY_MAX = 12;
export const REVERB_PREDELAY_MAX = 200;
export const LOFI_TONE_MIN = 1000;
export const LOFI_TONE_MAX = 20000;

export const FILTER_CUTOFF_MIN = 20;
export const FILTER_CUTOFF_MAX = 20000;
export const FILTER_RESONANCE_MIN = 0.5;
export const FILTER_RESONANCE_MAX = 15;
export const PUMP_RELEASE_MIN = 50;
export const PUMP_RELEASE_MAX = 600;

/** Effects for a new track: every insert present but bypassed. */
export function defaultTrackFx(): TrackFx {
  return {
    distortion: { on: false, amount: 0.3 },
    compressor: { on: false, threshold: -20, ratio: 4, makeup: 3 },
    chorus: { on: false, rate: 1.5, depth: 0.6, mix: 0.5 },
    filter: { on: false, type: 'lowpass', cutoff: 1000, resonance: Math.SQRT1_2, slope: 24 },
    pump: { on: false, depth: 0.7, release: 300, trigger: 'kick' },
    lofi: { on: false, crush: 0.5, tone: 5000, wow: 0.3, mix: 1 },
    gate: { on: false, rate: '1/16', depth: 0.9, length: 0.5 },
    echo: { on: false, time: '1/8d', feedback: 0.4, tone: 6000, pingPong: true, mix: 0.35 },
    reverb: { on: false, decay: 2.2, preDelay: 20, tone: 9000, mix: 0.3 },
    human: { on: false, timing: 0.5, dynamics: 0.5, pitch: 0.5 },
    peq: { on: false, bands: defaultPeqBands() },
    mbc: {
      on: false,
      lowFreq: 200,
      highFreq: 3000,
      attack: 0.01,
      release: 0.15,
      bands: [
        { threshold: -24, ratio: 3, gain: 2 },
        { threshold: -20, ratio: 2.5, gain: 1 },
        { threshold: -22, ratio: 3, gain: 1.5 },
      ],
    },
  };
}

/** A parametric EQ's bands when it's first switched on: everything flat, ready to drag. */
export function defaultPeqBands(): PeqBand[] {
  return [
    { on: false, type: 'lowcut', freq: 40, gain: 0, q: Math.SQRT1_2 },
    { on: true, type: 'lowshelf', freq: 120, gain: 0, q: 0.7 },
    { on: true, type: 'bell', freq: 500, gain: 0, q: 1 },
    { on: true, type: 'bell', freq: 2500, gain: 0, q: 1 },
    { on: true, type: 'highshelf', freq: 8000, gain: 0, q: 0.7 },
    { on: false, type: 'highcut', freq: 18000, gain: 0, q: Math.SQRT1_2 },
  ];
}

/** Fill in any missing / out-of-range effect settings (older projects, hand-edited files). */
export function normalizeTrackFx(raw: unknown): TrackFx {
  const d = defaultTrackFx();
  const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const r = obj(raw);
  const dist = obj(r.distortion);
  const comp = obj(r.compressor);
  const cho = obj(r.chorus);
  const fil = obj(r.filter);
  const pum = obj(r.pump);
  const lof = obj(r.lofi);
  const gat = obj(r.gate);
  const ech = obj(r.echo);
  const rev = obj(r.reverb);
  const hum = obj(r.human);
  const peq = obj(r.peq);
  const mbc = obj(r.mbc);
  const oneOf = <T>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  return {
    distortion: { on: dist.on === true, amount: num(dist.amount, d.distortion.amount, 0, 1) },
    compressor: {
      on: comp.on === true,
      threshold: num(comp.threshold, d.compressor.threshold, -60, 0),
      ratio: num(comp.ratio, d.compressor.ratio, 1, 20),
      makeup: num(comp.makeup, d.compressor.makeup, 0, 18),
    },
    chorus: {
      on: cho.on === true,
      rate: num(cho.rate, d.chorus.rate, 0.1, 8),
      depth: num(cho.depth, d.chorus.depth, 0, 1),
      mix: num(cho.mix, d.chorus.mix, 0, 1),
    },
    filter: {
      on: fil.on === true,
      type: oneOf(fil.type, FILTER_TYPES, d.filter.type),
      cutoff: num(fil.cutoff, d.filter.cutoff, FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX),
      resonance: num(fil.resonance, d.filter.resonance, FILTER_RESONANCE_MIN, FILTER_RESONANCE_MAX),
      slope: oneOf(fil.slope, FILTER_SLOPES, d.filter.slope),
    },
    pump: {
      on: pum.on === true,
      depth: num(pum.depth, d.pump.depth, 0, 1),
      release: num(pum.release, d.pump.release, PUMP_RELEASE_MIN, PUMP_RELEASE_MAX),
      trigger: oneOf(pum.trigger, PUMP_TRIGGERS, d.pump.trigger),
      ...(typeof pum.source === 'string' ? { source: pum.source } : {}),
    },
    lofi: {
      on: lof.on === true,
      crush: num(lof.crush, d.lofi.crush, 0, 1),
      tone: num(lof.tone, d.lofi.tone, LOFI_TONE_MIN, LOFI_TONE_MAX),
      wow: num(lof.wow, d.lofi.wow, 0, 1),
      mix: num(lof.mix, d.lofi.mix, 0, 1),
    },
    gate: {
      on: gat.on === true,
      rate: oneOf(gat.rate, GATE_RATES, d.gate.rate),
      depth: num(gat.depth, d.gate.depth, 0, 1),
      length: num(gat.length, d.gate.length, 0.1, 0.95),
    },
    echo: {
      on: ech.on === true,
      time: oneOf(ech.time, ECHO_TIMES, d.echo.time),
      feedback: num(ech.feedback, d.echo.feedback, 0, ECHO_FEEDBACK_MAX),
      tone: num(ech.tone, d.echo.tone, ECHO_TONE_MIN, ECHO_TONE_MAX),
      pingPong: ech.pingPong !== false,
      mix: num(ech.mix, d.echo.mix, 0, 1),
    },
    reverb: {
      on: rev.on === true,
      decay: num(rev.decay, d.reverb.decay, REVERB_DECAY_MIN, REVERB_DECAY_MAX),
      preDelay: num(rev.preDelay, d.reverb.preDelay, 0, REVERB_PREDELAY_MAX),
      tone: num(rev.tone, d.reverb.tone, ECHO_TONE_MIN, ECHO_TONE_MAX),
      mix: num(rev.mix, d.reverb.mix, 0, 1),
    },
    human: {
      on: hum.on === true,
      timing: num(hum.timing, d.human.timing, 0, 1),
      dynamics: num(hum.dynamics, d.human.dynamics, 0, 1),
      pitch: num(hum.pitch, d.human.pitch, 0, 1),
    },
    peq: {
      on: peq.on === true,
      bands: Array.isArray(peq.bands)
        ? peq.bands.slice(0, PEQ_MAX_BANDS).map((raw) => {
            const b = obj(raw);
            return {
              on: b.on !== false,
              type: oneOf(b.type, PEQ_TYPES, 'bell' as PeqType),
              freq: num(b.freq, 1000, 20, 20000),
              gain: num(b.gain, 0, -PEQ_GAIN_MAX, PEQ_GAIN_MAX),
              q: num(b.q, 1, PEQ_Q_MIN, PEQ_Q_MAX),
            };
          })
        : d.peq.bands,
    },
    mbc: {
      on: mbc.on === true,
      lowFreq: num(mbc.lowFreq, d.mbc.lowFreq, 40, 1000),
      highFreq: num(mbc.highFreq, d.mbc.highFreq, 1000, 12000),
      attack: num(mbc.attack, d.mbc.attack, 0.001, 0.2),
      release: num(mbc.release, d.mbc.release, 0.02, 1),
      bands: d.mbc.bands.map((fallback, i) => {
        const b = obj(Array.isArray(mbc.bands) ? mbc.bands[i] : undefined);
        return {
          threshold: num(b.threshold, fallback.threshold, -60, 0),
          ratio: num(b.ratio, fallback.ratio, 1, 20),
          gain: num(b.gain, fallback.gain, -12, 18),
          ...(b.bypass === true ? { bypass: true } : {}),
        };
      }) as [MbcBand, MbcBand, MbcBand],
    },
  };
}

/** Shared return effects that every track's reverb / delay send feeds. */
export interface MasterFx {
  /** Reverb decay, 0.8 s to 12 s */
  reverbDecay: number;
  /** Delay time as a tempo subdivision ("4n", "8n", "8n.", "16n") */
  delayTime: string;
  /** 0 to 0.8 */
  delayFeedback: number;
}

export const DEFAULT_MASTER_FX: MasterFx = { reverbDecay: 2.4, delayTime: '8n', delayFeedback: 0.35 };

/**
 * The master section: the inserts between the master compressor and the limiter (see
 * engine.ts). Each can be bypassed with `on`, which takes it out of the chain entirely.
 */
export interface MasterSettings {
  /** OTT-style multiband compression (three bands, upward and downward): see effects/ott.ts. */
  ott: {
    on: boolean;
    /** How much each band is pushed towards its steady level, 0 to 1 (0 leaves the sound alone) */
    depth: number;
    /** How fast the bands react, 0 (snappy) to 1 (slow) */
    time: number;
    /** dB into the bands, -12 to +12 */
    inGain: number;
    /** dB after, -12 to +12 */
    outGain: number;
  };
  /** Stereo width by mid/side: 0 is mono, 1 unchanged, 2 twice as wide. */
  width: {
    on: boolean;
    /** 0 to 2 */
    amount: number;
    /** Keep everything below about 120 Hz in the middle, however wide the rest goes */
    monoBass: boolean;
  };
}

export const OTT_GAIN_MIN = -12;
export const OTT_GAIN_MAX = 12;
export const WIDTH_MAX = 2;

export function defaultMasterSettings(): MasterSettings {
  return {
    ott: { on: false, depth: 0.5, time: 0.3, inGain: 0, outGain: 0 },
    width: { on: false, amount: 1.3, monoBass: true },
  };
}

/** Fill in any missing / out-of-range master settings (older projects have none, hand-edited files). */
export function normalizeMasterSettings(raw: unknown): MasterSettings {
  const d = defaultMasterSettings();
  const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const r = obj(raw);
  const ott = obj(r.ott);
  const width = obj(r.width);
  return {
    ott: {
      on: ott.on === true,
      depth: num(ott.depth, d.ott.depth, 0, 1),
      time: num(ott.time, d.ott.time, 0, 1),
      inGain: num(ott.inGain, d.ott.inGain, OTT_GAIN_MIN, OTT_GAIN_MAX),
      outGain: num(ott.outGain, d.ott.outGain, OTT_GAIN_MIN, OTT_GAIN_MAX),
    },
    width: {
      on: width.on === true,
      amount: num(width.amount, d.width.amount, 0, WIDTH_MAX),
      // Absent means on, as for a new project
      monoBass: width.monoBass !== false,
    },
  };
}

/** True when two master settings would sound the same (so the engine and autosave can skip no-ops). */
export function sameMasterSettings(a: MasterSettings, b: MasterSettings): boolean {
  return (
    a.ott.on === b.ott.on &&
    a.ott.depth === b.ott.depth &&
    a.ott.time === b.ott.time &&
    a.ott.inGain === b.ott.inGain &&
    a.ott.outGain === b.ott.outGain &&
    a.width.on === b.width.on &&
    a.width.amount === b.width.amount &&
    a.width.monoBass === b.width.monoBass
  );
}

export interface Track {
  id: string;
  name: string;
  color: string;
  instrumentKey: InstrumentKey;
  isMuted: boolean;
  isSoloed: boolean;
  isArmed: boolean;
  /** -60 dB to +6 dB */
  volume: number;
  /** -1.0 (L) to 1.0 (R) */
  pan: number;
  /** 3-Band Parametric EQ insert */
  eq: TrackEq;
  /** Distortion / Compressor / Chorus / Filter / Pump inserts */
  fx: TrackFx;
  /** Post-fader send to master Reverb (0.0 to 1.0) */
  reverbSend: number;
  /** Post-fader send to master Delay (0.0 to 1.0) */
  delaySend: number;
  /** The Sampler instrument's sound, loaded from the user's computer */
  sample?: CustomSample;
  /** The Slicer instrument's sound and its slices (absent until a sound is loaded) */
  slicer?: SlicerSettings;
  /** The Synth Designer's settings (absent: the default patch) */
  synth?: SynthPatch;
  /** A Drum Rack's pads (absent: every pad empty) */
  rack?: DrumRack;
  /** A Multi Sampler's sounds and how they're laid across the keys (absent: none yet) */
  multi?: MultiSample;
  /** How settings change over the song: at most one lane per setting (older projects have none). */
  automation?: AutomationLane[];
  /** Rendered to audio to save CPU (see src/store/freeze.ts); absent when the track plays live. */
  frozen?: FrozenTrack;
  /** The stem group it belongs to for Intensity (see intensity.ts); none plays at full level */
  stemGroup?: string;
  /** A dialogue / SFX proxy: every other track dips by `depth` dB wherever it sounds (see duck.ts) */
  duckProxy?: { depth: number };
  /** The folder it's in (see folders.ts): every member carries the folder's settings; members sit together */
  folder?: TrackFolder;
  /** The bus track it plays into (see buses.ts); absent: straight to the master */
  output?: string;
  /** Sends to return tracks (see buses.ts), each at its own level */
  sends?: TrackSend[];
  /** Knobs and faders of a MIDI controller that move this track's settings (MIDI learn) */
  midiMap?: MidiMapping[];
  /** Set only on the copy of a track rendered into its freeze (never saved): its live settings stay out of the sound */
  freezing?: boolean;
  /** A Plugin track's instrument: a Web Audio Module loaded from its URL (see wamHost.ts) */
  plugin?: WamPlugin;
  /** Web Audio Module effects, in order, between the instrument and the track's own inserts */
  pluginFx?: WamPlugin[];
  /** Its clips in the clip launcher, one per scene at most (see launcher.ts) */
  slots?: LauncherSlot[];
  /**
   * Expressive playing (see samplerManager.ts): recorded instruments get darker as they get
   * softer, on a dB velocity curve, with a little per-note variation; synthesized drums follow
   * velocity in tone too. On for tracks made since it existed; older projects keep their sound.
   */
  expressive?: boolean;
}

/** What a clip launcher slot holds: a clip, without a place in the song. */
export type SlotClip = Pick<Clip, 'name' | 'lengthBars' | 'notes'> & Partial<Pick<Clip, 'wobble' | 'groove' | 'audio' | 'expression'>>;

/** A track's clip in the clip launcher, in scene (row) `scene` (0 is the first). */
export interface LauncherSlot {
  scene: number;
  clip: SlotClip;
}

/** A send from a track to a return track. */
/** A MIDI controller's knob or fader (its CC number) moving one of a track's settings, over the setting's whole range. */
export interface MidiMapping {
  cc: number;
  param: AutomationParam;
}

export interface TrackSend {
  /** The return track's id */
  to: string;
  /** 0 to 1 (as the reverb and delay sends) */
  level: number;
  /** Taken before the fader (the track's volume and mute don't change it); else after */
  pre?: boolean;
}

/** A Web Audio Module (WAM 2) plugin on a track, loaded from `url` with its saved settings. */
export interface WamPlugin {
  id: string;
  /** The plugin's module (its index.js), whose default export is the WebAudioModule */
  url: string;
  name: string;
  /** Its settings, as the plugin gives them (getState) */
  state?: unknown;
  /** Skipped: the sound passes it by */
  bypass?: boolean;
}

/** The reference video a project scores to (see videoStore): kept in the browser by `key`. */
export interface ProjectVideo {
  key: string;
  name: string;
  /** MIME type */
  type: string;
  /** Where it starts in the song, seconds */
  start: number;
  /** The file itself as a data: URL, in saved project files when it's small enough (see VIDEO_EMBED_MAX) */
  data?: string;
}
/** Videos up to this size travel inside saved project files; bigger ones stay in the browser. */
export const VIDEO_EMBED_MAX = 40 * 1024 * 1024;

/** A folder of tracks: a named, coloured group that folds away and mutes or solos together. */
export interface TrackFolder {
  id: string;
  name: string;
  color: string;
  /** Folded: its tracks' rows are hidden (they still play) */
  collapsed?: boolean;
}

/** Colours offered for tracks and folders. */
export const TRACK_COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#9ca3af'] as const;

/**
 * A track's instrument, inserts and EQ rendered to a sound in the sound library. While what it was
 * rendered from is unchanged (`fingerprint`), live playback plays the sound instead; volume, pan
 * and the sends stay live.
 */
export interface FrozenTrack {
  soundId: string;
  /** Where the sound starts on the timeline (the track's first clip). */
  startBar: number;
  /** The sound's length in seconds. */
  seconds: number;
  /** dB to play the sound at: it's stored normalized (so quiet tracks keep their detail), plus what playing it through the strip and bus again takes off. */
  gainDb: number;
  /** Hash of everything the render depended on. */
  fingerprint: string;
}

/**
 * The fixed track settings an automation lane can drive. The order is the lane picker's. The
 * Filter ones act on the track's Filter insert, the EQ ones on its 3-band EQ.
 */
export const AUTOMATION_PARAMS = [
  'volume',
  'pan',
  'filterCutoff',
  'filterResonance',
  'reverbSend',
  'delaySend',
  'eqLow',
  'eqMid',
  'eqHigh',
] as const;
export type BuiltinParam = (typeof AUTOMATION_PARAMS)[number];

/**
 * What an automation lane drives: a fixed setting, or
 *   `send:<return track id>`   the level of the track's send to a return,
 *   `fx:<insert>.<setting>`    a setting of one of its inserts (see FX_AUTOMATION in automation.ts),
 *   `plugin:<plugin id>:<parameter id>`   a parameter of one of its WAM plugins (0 to 1 of its range).
 */
export type AutomationParam = BuiltinParam | `send:${string}` | `fx:${string}` | `plugin:${string}`;

/** The insert settings a lane can drive, as `insert.setting`. */
export const FX_AUTOMATION_KEYS = [
  'distortion.amount',
  'compressor.threshold',
  'compressor.ratio',
  'compressor.makeup',
  'chorus.rate',
  'chorus.depth',
  'chorus.mix',
  'lofi.tone',
  'lofi.wow',
  'lofi.mix',
  'echo.feedback',
  'echo.tone',
  'echo.mix',
  'reverb.preDelay',
  'reverb.tone',
  'reverb.mix',
  'gate.depth',
  'gate.length',
  'pump.depth',
  'pump.release',
] as const;
export type FxAutomationKey = (typeof FX_AUTOMATION_KEYS)[number];

export function isAutomationParam(v: unknown): v is AutomationParam {
  if (typeof v !== 'string') return false;
  if (AUTOMATION_PARAMS.includes(v as BuiltinParam)) return true;
  if (v.startsWith('send:')) return v.length > 5;
  if (v.startsWith('fx:')) return FX_AUTOMATION_KEYS.includes(v.slice(3) as FxAutomationKey);
  return /^plugin:[^:]+:.+$/.test(v);
}

export interface AutomationPoint {
  /** Song position, 1-based like Clip.startBar */
  bar: number;
  /** Height in the lane, 0 (bottom) to 1 (top); see src/audio/automation.ts for what it means per setting */
  value: number;
  /**
   * The bend of the line from this point to the next, -1 to 1: 0 (or unset) is straight, above 0
   * starts slow and speeds up (a build), below 0 starts fast and settles (a fade that drops away).
   */
  curve?: number;
}

/**
 * How one track setting changes over the song. Points are kept in bar order; two may share a bar
 * (an instant jump). The value runs in a line (in lane height) from point to point, straight or bent by the point's `curve`,
 * holds the first point's value before it and the last one's after it. While a lane has points it
 * owns its setting: the track's own value for it comes back when the lane is emptied or removed.
 */
export interface AutomationLane {
  param: AutomationParam;
  points: AutomationPoint[];
}

export interface CustomSample {
  /** Original file name, for display */
  name: string;
  /** The sound in the browser's sound library (see soundLibrary.ts), where it is kept by content hash */
  soundId?: string;
  /**
   * The audio file itself, as a data: URL: how projects used to carry the sound inside the file.
   * Still played; a project that opens with one moves it into the library and keeps the id.
   */
  dataUrl?: string;
  /** The note that plays the sound at its original pitch */
  root: string;
}

/** What the browser's sound library knows of a sound file (see src/audio/soundLibrary.ts). */
export interface SoundMeta {
  /** Content hash */
  id: string;
  /** File name */
  name: string;
  /** MIME type of the file */
  type: string;
  /** File size in bytes */
  size: number;
  /** Length in seconds */
  seconds: number;
}

/** A sound as a project file carries it: its meta and the file's bytes in base64. */
export interface EmbeddedSound extends SoundMeta {
  data: string;
}

/**
 * How an audio clip plays its sound (a file in the sound library). The clip's length in bars is
 * its length in seconds at the project's tempo: a tempo change changes the bars, not the sound.
 */
export interface ClipAudio {
  soundId: string;
  /** Where in the sound the clip starts, in seconds (the left edge trims this) */
  offset: number;
  /** Clip gain in dB */
  gain: number;
  /** Fade in and out, in seconds, from the clip's edges */
  fadeIn: number;
  fadeOut: number;
  /**
   * Follow the song's tempo: the tempo the recording was made at. The clip is time-stretched (same
   * pitch) by the song's tempo over this, and keeps its length in bars when the tempo changes.
   * Unset: the recording plays as it is, and keeps its length in seconds.
   */
  stretchBpm?: number;
  /** Tuned (see vocalTune.ts): the sound it was tuned from, to go back to */
  tunedFrom?: string;
  /** Warp markers (see warp.ts), in the order of the sound: only heard while it follows the tempo */
  warp?: WarpMarker[];
  /** A gain envelope over the sound (points at moments of it, `src` seconds in), on top of the clip gain and fades */
  envelope?: GainPoint[];
  /** Reversed: the sound it was reversed from (the clip plays a reversed copy), to go back to */
  reversedFrom?: string;
}

/** One pad of a Drum Rack: a sound, and the effects it plays through (its own, not shared with the other pads). */
export interface RackPad {
  name: string;
  /** Its sound in the sound library (absent: an empty pad) */
  soundId?: string;
  /** Level, dB (-60 to +12) */
  gain: number;
  /** -1 (left) to 1 (right) */
  pan: number;
  /** Semitones, -24 to +24 */
  pitch: number;
  /** How long it rings before fading out, seconds (0: the whole sound) */
  decay: number;
  /** Low-pass and high-pass on the pad, Hz */
  lowpass: number;
  highpass: number;
  /** Saturation, 0 to 1 */
  drive: number;
  /** Choke group, 1 to 8 (0: none): a pad cuts off the others in its group, as a closed hat does an open one */
  choke: number;
  /** Plays backwards */
  reverse?: boolean;
}

/** A Drum Rack: 16 pads, pad i on MIDI note RACK_BASE_NOTE + i. */
export interface DrumRack {
  pads: RackPad[];
}
export const RACK_PADS = 16;
/** Pad 1's note: C2 (36), as on most pad controllers. */
export const RACK_BASE_NOTE = 36;

/** One sound of a Multi Sampler, played over a range of keys and velocities. */
export interface MultiZone {
  soundId: string;
  name: string;
  /** The key (MIDI) it plays at its own pitch */
  root: number;
  /** The keys it plays on (MIDI, inclusive) */
  lo: number;
  hi: number;
  /** The velocities it plays on (1 to 127, inclusive) */
  velLo: number;
  velHi: number;
}

/** A Multi Sampler: its sounds, and the shape every note plays with. */
export interface MultiSample {
  zones: MultiZone[];
  /** Seconds */
  attack: number;
  release: number;
}

/** A warp marker: the moment `src` seconds into a sound lands on beat `beat` of it (see warp.ts). */
export interface WarpMarker {
  src: number;
  beat: number;
}

/** A point of a clip's gain envelope: `db` at the moment `src` seconds into its sound. */
export interface GainPoint {
  src: number;
  db: number;
}
/** The envelope's range: at the bottom the clip is silent. */
export const ENVELOPE_DB_MIN = -60;
export const ENVELOPE_DB_MAX = 12;

export const STRETCH_BPM_MIN = 30;
export const STRETCH_BPM_MAX = 400;

export const AUDIO_GAIN_MIN = -24;
export const AUDIO_GAIN_MAX = 24;
/** Longest fade a project may hold (the handles stop at half the clip). */
export const AUDIO_FADE_MAX = 30;

/** How the Slicer cuts its sound: at the transients it finds, or into equal parts. */
export type SliceMode = 'auto' | 'equal';
export const SLICE_COUNTS = [4, 8, 16, 32] as const;
export type SliceCount = (typeof SLICE_COUNTS)[number];
/** Slice 1 plays on C3, slice 2 on C#3, and so on. */
export const SLICE_KEY_BASE = 48;
export const MAX_SLICES = 64;

/** The Slicer's sound and where it is cut. Slice i runs from slices[i] to slices[i + 1] (the last one to `end`). */
export interface SlicerSettings {
  soundId: string;
  /** File name, for display */
  name: string;
  /** The part of the sound that is sliced, in seconds */
  start: number;
  end: number;
  /** Slice start times in seconds, ascending, the first at `start` */
  slices: number[];
  mode: SliceMode;
  /** Equal: how many slices */
  count: SliceCount;
  /** Auto: 0 finds only the strongest transients, 1 the faintest */
  sensitivity: number;
  /** Pitch mode: every key plays the focused slice, transposed from the slice's own key */
  pitch: boolean;
  /** The slice the keyboard plays in Pitch mode (an index into `slices`) */
  focus: number;
}

export interface NoteEvent {
  id: string;
  note: string;
  /** Offset from the clip start, in bars (0.25 = beat 2 in 4/4). May be negative / beyond length after trims (hidden). */
  startOffset: number;
  duration: string;
  velocity: number;
  /** The note's own expression over its length (see noteExpression.ts), as an MPE keyboard plays it */
  expr?: NoteExpression;
}

/**
 * Per-note expression: each curve's points are `at` bars from the note's start. `bend` in
 * semitones (-24 to 24: a slide to another note, a vibrato drawn by hand); `pressure` 0 to 1 (how
 * hard the key is pressed: the note's level swells and fades with it; absent: steady).
 */
export interface NoteExpression {
  bend?: ExprPoint[];
  pressure?: ExprPoint[];
}

export interface Clip {
  id: string;
  trackId: string;
  name: string;
  /** 1-based bar position (1.0 = start of song) */
  startBar: number;
  lengthBars: number;
  notes: NoteEvent[];
  isSelected: boolean;
  /** How fast Wobble and Growl Bass notes wobble (absent: DEFAULT_WOBBLE). Other instruments ignore it. */
  wobble?: WobbleRate;
  /** The clip's own swing, in place of the song's (absent: the song's swing on 16ths) */
  groove?: ClipGroove;
  /** An audio clip: plays a sound file instead of notes (only on Audio tracks). */
  audio?: ClipAudio;
  /** Controller lanes over the clip: pitch bend, mod wheel, sustain pedal (see expression.ts) */
  expression?: ClipExpression;
  /** A take folder: the takes recorded over this clip's span (see takes.ts) */
  takes?: ClipTake[];
  /** Which take plays where (the comp), when there are takes */
  comp?: CompSegment[];
}

/**
 * A clip's own swing: the off-beat note of each pair on the `grid` (8ths or 16ths) plays late by
 * `swing` (0 straight, 0.5 a full triplet shuffle, up to 0.75 a hard dotted lilt).
 */
export interface ClipGroove {
  swing: number;
  grid: 8 | 16;
}
export const MAX_CLIP_SWING = 0.75;

/** One recorded take of a take folder: notes (a MIDI take) or a sound (a mic take), from the clip's start. */
export interface ClipTake {
  id: string;
  name: string;
  notes?: NoteEvent[];
  expression?: ClipExpression;
  audio?: ClipAudio;
}

/** From `at` bars into the clip (until the next segment), take number `take` plays. */
export interface CompSegment {
  at: number;
  take: number;
}

/** A controller lane's point: `at` bars from the clip's start. */
export interface ExprPoint {
  at: number;
  value: number;
}

/** A clip's controller lanes (absent: untouched): pitch bend in semitones, mod wheel 0..1, sustain 0 or 1. */
/**
 * A clip's controller lanes: pitch bend, mod wheel, sustain pedal, and any MIDI controller by
 * number (`cc74`: values 0 to 1).
 */
export type ClipExpression = Partial<Record<'bend' | 'mod' | 'sustain' | `cc${number}`, ExprPoint[]>>;

/**
 * Wobble rates, slowest first: one filter sweep per note value, restarted at the start of every
 * note so the wobble locks to the beat. "T" is a triplet (three in the time of two).
 */
export const WOBBLE_RATES = ['1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export type WobbleRate = (typeof WOBBLE_RATES)[number];
export const DEFAULT_WOBBLE: WobbleRate = '1/8';

/** One wobble in beats (quarter notes). */
export const WOBBLE_BEATS: Record<WobbleRate, number> = {
  '1/1': 4,
  '1/2': 2,
  '1/4': 1,
  '1/8': 1 / 2,
  '1/8T': 1 / 3,
  '1/16': 1 / 4,
  '1/16T': 1 / 6,
  '1/32': 1 / 8,
};

export function isWobbleRate(v: unknown): v is WobbleRate {
  return WOBBLE_RATES.includes(v as WobbleRate);
}

export type TimelineTool = 'select' | 'razor';
/** 'frame' snaps to video frames at the project's frame rate and tempo. */
export type SnapGrid = '1/4' | '1/8' | '1/16' | 'frame' | 'off';

/**
 * Timecode frame rates the timeline can count in. 23.976 and 29.97 are the NTSC video rates
 * (24 and 30 slowed by 1000/1001); 29.97 can also count in drop-frame.
 */
export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const DEFAULT_FRAME_RATE: FrameRate = 30;

export function isFrameRate(v: unknown): v is FrameRate {
  return FRAME_RATES.includes(v as FrameRate);
}

/** The timecode formats on offer, in menu order: every rate, plus 29.97 drop-frame after 29.97. */
export const TIMECODE_FORMATS: ReadonlyArray<{ fps: FrameRate; dropFrame: boolean }> = FRAME_RATES.flatMap(
  (fps): Array<{ fps: FrameRate; dropFrame: boolean }> =>
    fps === 29.97 ? [{ fps, dropFrame: false }, { fps, dropFrame: true }] : [{ fps, dropFrame: false }]
);

/** "29.97 fps", or "29.97 DF" for drop-frame. */
export function frameRateLabel(fps: number, dropFrame: boolean): string {
  return isDropFrame(fps, dropFrame) ? `${fps} DF` : `${fps} fps`;
}

/** What the time ruler counts in. */
export type RulerUnits = 'bars' | 'timecode';

/** Tempo and frame rate: what turns seconds and frames into bars. */
export interface GridTiming {
  bpm: number;
  fps: number;
  /** Tempo changes, so frame snapping steps through time along them */
  tempoPoints?: readonly TempoPoint[];
}

export interface LoopRegion {
  inBar: number;
  outBar: number;
  enabled: boolean;
}

/**
 * What holds a marker in place when the tempo changes: its bar (it stays with the music) or its
 * time (it stays at the same timecode, e.g. a hit point in a video).
 */
export type MarkerAnchor = 'bar' | 'time';

/** A named point on the timeline. Both positions are kept; the anchor says which one the other follows. */
/** What happens as the music switches between game states (see transitions.ts). */
export type TransitionKind = 'cut' | 'fill' | 'riser' | 'impact' | 'crossfade' | 'stinger';

/** How one state hands over to another: a transition matrix entry (see transitions.ts). */
export interface TransitionRule {
  kind: TransitionKind;
  /** When the switch happens: the next bar (default), the next beat, or at once */
  quantize?: 'bar' | 'beat' | 'now';
  /** A crossfade's length in beats */
  beats?: number;
  /** The stinger that bridges the gap (kind 'stinger') */
  stingerId?: string;
}

/** What a stinger is for (see stingers.ts). */
export type StingerKind = 'victory' | 'levelUp' | 'item' | 'checkpoint' | 'danger' | 'gameOver';

/** A short cue a game plays over its music (a win, an item found), in the song's key and tempo. */
export interface Stinger {
  id: string;
  name: string;
  kind: StingerKind;
  instrumentKey: InstrumentKey;
  /** Which of the kind's variations its notes came from */
  variation: number;
  notes: NoteEvent[];
  lengthBars: number;
}

export interface Marker {
  id: string;
  name: string;
  anchor: MarkerAnchor;
  /** 1-based bar position, like Clip.startBar */
  bar: number;
  /** Seconds from the start of bar 1 */
  seconds: number;
}

const NOTE_GRID_BARS: Record<Exclude<SnapGrid, 'frame'>, number> = {
  '1/4': 0.25,
  '1/8': 0.125,
  '1/16': 0.0625,
  off: 0,
};

/** One video frame in bars (4/4 at a constant tempo). 29.97 and 23.976 frames are 1001/1000 longer than 30 and 24. */
export function frameBars(timing: GridTiming): number {
  return (timing.bpm * frameSeconds(timing.fps)) / 240;
}

/** One step of the grid in bars, 0 when snapping is off. Frames count from the start of bar 1. */
export function snapStepBars(grid: SnapGrid, timing: GridTiming): number {
  return grid === 'frame' ? frameBars(timing) : NOTE_GRID_BARS[grid];
}

/** Snap a 1-based bar position to the active grid. */
export function snapBar(bar: number, grid: SnapGrid, timing: GridTiming): number {
  // Frames are steps of time: along tempo changes they're steps of seconds, not of bars
  if (grid === 'frame' && timing.tempoPoints?.length) {
    const tempo = { bpm: timing.bpm, points: timing.tempoPoints };
    const frame = frameSeconds(timing.fps);
    return secondsToBar(Math.round(barToSeconds(bar, tempo) / frame) * frame, tempo);
  }
  const step = snapStepBars(grid, timing);
  if (!step) return bar;
  return Math.round((bar - 1) / step) * step + 1;
}

/**
 * Smallest editable clip (and loop) length for the active grid. Never under a 16th, the store's
 * floor for trims: with Frame snap it's the fewest whole frames that make a 16th.
 */
export function minClipLength(grid: SnapGrid, timing: GridTiming): number {
  const step = snapStepBars(grid, timing);
  if (!step) return 0.0625;
  return grid === 'frame' ? Math.ceil(0.0625 / step - 1e-9) * step : step;
}

/** A bar count for display: up to 3 decimals, trailing zeros dropped (frame-snapped lengths are long floats). */
export function formatBarCount(bars: number): string {
  return String(Number(bars.toFixed(3)));
}

/** A tempo for display: up to 2 decimals, trailing zeros dropped ("115.2", "122"). */
export function formatBpm(bpm: number): string {
  return String(Number(bpm.toFixed(2)));
}

const DURATION_BARS: Record<string, number> = {
  '1n': 1,
  '2n': 0.5,
  '4n': 0.25,
  '8n': 0.125,
  '16n': 0.0625,
  '32n': 0.03125,
};

/** Transport ticks in a bar: Tone's 192 per quarter note, in 4/4. */
const TICKS_PER_BAR = 768;

/**
 * Convert a Tone duration to bars (4/4). Handles notation ("8n"), dotted notation ("8n."),
 * triplets ("8t", two thirds of an 8th), ticks ("80i"), whole bars ("1m", "2m": the starters and
 * stingers write long notes this way) and transport time "bars:quarters:sixteenths" (used for
 * lengths drawn in the piano roll).
 */
export function durationToBars(duration: string): number {
  if (/^\d+(\.\d+)?m$/.test(duration)) return Math.max(0.0625, parseFloat(duration));
  if (duration.includes(':')) {
    const [b = 0, q = 0, s = 0] = duration.split(':').map(Number);
    const bars = b + q / 4 + s / 16;
    return bars > 0 ? bars : 0.0625;
  }
  if (duration.endsWith('.')) return (DURATION_BARS[duration.slice(0, -1)] ?? 0.0625) * 1.5;
  if (duration.endsWith('t')) {
    const straight = DURATION_BARS[`${duration.slice(0, -1)}n`];
    return straight ? (straight * 2) / 3 : 0.0625;
  }
  if (/^\d+i$/.test(duration)) return Math.max(1, parseInt(duration, 10)) / TICKS_PER_BAR;
  return DURATION_BARS[duration] ?? 0.0625;
}

const NAMED_SIXTEENTHS: Record<number, string> = { 1: '16n', 2: '8n', 3: '8n.', 4: '4n', 6: '4n.', 8: '2n', 12: '2n.', 16: '1n' };
/** Lengths finer than a 16th that have a name: a 32nd and the triplets. */
const NAMED_TICKS: Record<number, string> = { 24: '32n', 32: '16t', 64: '8t', 128: '4t' };

/**
 * Inverse of durationToBars, to the nearest tick. Whole 16ths come out as before (a named value
 * when one fits, else "b:q:s"), so older versions of the app read them; finer lengths are a
 * 32nd or a triplet by name ("32n", "16t", "8t", "4t"), else a tick count ("80i").
 */
export function barsToDuration(bars: number): string {
  const ticks = Math.max(1, Math.round(bars * TICKS_PER_BAR));
  if (ticks % 48 === 0) {
    const sixteenths = ticks / 48;
    const named = NAMED_SIXTEENTHS[sixteenths];
    if (named) return named;
    return `${Math.floor(sixteenths / 16)}:${Math.floor((sixteenths % 16) / 4)}:${sixteenths % 4}`;
  }
  return NAMED_TICKS[ticks] ?? `${ticks}i`;
}

let uidCounter = 0;
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}
