import type { InstrumentKey } from '../audio/engine';

export type { InstrumentKey };

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
