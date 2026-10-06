import type { InstrumentKey } from '../audio/engine';

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
export type SnapGrid = '1/4' | '1/8' | '1/16' | 'off';

export interface LoopRegion {
  inBar: number;
  outBar: number;
  enabled: boolean;
}

export const SNAP_STEP_BARS: Record<SnapGrid, number> = {
  '1/4': 0.25,
  '1/8': 0.125,
  '1/16': 0.0625,
  off: 0,
};

/** Snap a 1-based bar position to the active grid. */
export function snapBar(bar: number, grid: SnapGrid): number {
  const step = SNAP_STEP_BARS[grid];
  if (!step) return bar;
  return Math.round((bar - 1) / step) * step + 1;
}

/** Smallest editable clip length for the active grid. */
export function minClipLength(grid: SnapGrid): number {
  return SNAP_STEP_BARS[grid] || 0.0625;
}

const DURATION_BARS: Record<string, number> = {
  '1n': 1,
  '2n': 0.5,
  '4n': 0.25,
  '8n': 0.125,
  '16n': 0.0625,
  '32n': 0.03125,
};

/**
 * Convert a Tone duration to bars (4/4). Handles notation ("8n"), dotted notation ("8n.")
 * and transport time "bars:quarters:sixteenths" (used for lengths drawn in the piano roll).
 */
export function durationToBars(duration: string): number {
  if (duration.includes(':')) {
    const [b = 0, q = 0, s = 0] = duration.split(':').map(Number);
    const bars = b + q / 4 + s / 16;
    return bars > 0 ? bars : 0.0625;
  }
  if (duration.endsWith('.')) return (DURATION_BARS[duration.slice(0, -1)] ?? 0.0625) * 1.5;
  return DURATION_BARS[duration] ?? 0.0625;
}

const NAMED_SIXTEENTHS: Record<number, string> = { 1: '16n', 2: '8n', 3: '8n.', 4: '4n', 6: '4n.', 8: '2n', 12: '2n.', 16: '1n' };

/** Inverse of durationToBars, rounded to whole 16ths: a named value when one fits, else "b:q:s". */
export function barsToDuration(bars: number): string {
  const sixteenths = Math.max(1, Math.round(bars * 16));
  const named = NAMED_SIXTEENTHS[sixteenths];
  if (named) return named;
  return `${Math.floor(sixteenths / 16)}:${Math.floor((sixteenths % 16) / 4)}:${sixteenths % 4}`;
}

let uidCounter = 0;
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}
