import type { InstrumentKey } from '../audio/engine';
import { frameSeconds, isDropFrame } from '../audio/timecode';

export type { InstrumentKey };

export interface TrackEq {
  /** -24 dB to +12 dB (shelf at 400Hz) */
  low: number;
  /** -24 dB to +12 dB (bell at 1.0kHz) */
  mid: number;
  /** -24 dB to +12 dB (shelf at 2.5kHz) */
  high: number;
}

/**
 * Per-track insert effects, in signal order: Distortion -> (EQ) -> Compressor -> Chorus.
 * The EQ lives on Track.eq. Each insert can be bypassed with `on`.
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
}

/** Effects for a new track: every insert present but bypassed. */
export function defaultTrackFx(): TrackFx {
  return {
    distortion: { on: false, amount: 0.3 },
    compressor: { on: false, threshold: -20, ratio: 4, makeup: 3 },
    chorus: { on: false, rate: 1.5, depth: 0.6, mix: 0.5 },
  };
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
  };
}

/** Shared return effects that every track's reverb / delay send feeds. */
export interface MasterFx {
  /** Reverb decay, 0.8 s to 6 s */
  reverbDecay: number;
  /** Delay time as a tempo subdivision ("4n", "8n", "8n.", "16n") */
  delayTime: string;
  /** 0 to 0.8 */
  delayFeedback: number;
}

export const DEFAULT_MASTER_FX: MasterFx = { reverbDecay: 2.4, delayTime: '8n', delayFeedback: 0.35 };

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
  /** Distortion / Compressor / Chorus inserts */
  fx: TrackFx;
  /** Post-fader send to master Reverb (0.0 to 1.0) */
  reverbSend: number;
  /** Post-fader send to master Delay (0.0 to 1.0) */
  delaySend: number;
  /** The Sampler instrument's sound, loaded from the user's computer */
  sample?: CustomSample;
}

export interface CustomSample {
  /** Original file name, for display */
  name: string;
  /** The audio file itself, as a data: URL (so it travels with the project) */
  dataUrl: string;
  /** The note that plays the sound at its original pitch */
  root: string;
}

export interface NoteEvent {
  id: string;
  note: string;
  /** Offset from the clip start, in bars (0.25 = beat 2 in 4/4). May be negative / beyond length after trims (hidden). */
  startOffset: number;
  duration: string;
  velocity: number;
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
}

export interface LoopRegion {
  inBar: number;
  outBar: number;
  enabled: boolean;
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
 * triplets ("8t", two thirds of an 8th), ticks ("80i") and transport time
 * "bars:quarters:sixteenths" (used for lengths drawn in the piano roll).
 */
export function durationToBars(duration: string): number {
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
