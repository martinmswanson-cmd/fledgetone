import { secondsBetween, type Tempo } from './tempoMap';
import type { Marker } from '../store/timelineTypes';

/**
 * Markers in an exported WAV, as cue points: a `cue ` chunk with each one's sample position and a
 * `LIST`/`adtl` chunk of `labl` names, the standard RIFF way to mark a WAV, which DAWs, audio
 * editors and game audio tools read as markers. No audio here, so Node can unit-test it.
 */

export interface WavCue {
  /** Sample frame from the start of the file */
  frame: number;
  name: string;
}

export interface CueRange {
  /** Markers from startBar to endBar make cues (one exactly at endBar only if `includeEnd`). */
  startBar: number;
  endBar: number;
  /** The song position at the file's first sample. */
  originBar: number;
  bpm: Tempo;
  sampleRate: number;
  /** The file's length: a cue must fall inside it. */
  frames: number;
  /** The file carries on past endBar (a ring-out tail), so a marker right at the end is in it. */
  includeEnd: boolean;
}

const EPS = 1e-6;

/** The markers in the range, as cue points in file order. */
export function markerCues(markers: readonly Marker[], range: CueRange): WavCue[] {
  const cues: WavCue[] = [];
  for (const m of markers) {
    if (m.bar < range.startBar - EPS) continue;
    if (range.includeEnd ? m.bar > range.endBar + EPS : m.bar >= range.endBar - EPS) continue;
    const frame = Math.max(0, Math.round(secondsBetween(range.originBar, m.bar, range.bpm) * range.sampleRate));
    if (frame < range.frames) cues.push({ frame, name: m.name });
  }
  return cues.sort((a, b) => a.frame - b.frame);
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * The `cue ` and `LIST`/`adtl` chunks for these cues, to follow the `data` chunk (nothing if
 * there are none). Each cue's position is given both as its play-order position and its sample
 * offset into the data chunk, since readers differ in which one they use. Names are UTF-8.
 */
export function cueChunks(cues: readonly WavCue[]): Uint8Array<ArrayBuffer> {
  if (!cues.length) return new Uint8Array(0);
  const labels = cues.map((c) => new TextEncoder().encode(c.name));
  const cueSize = 4 + 24 * cues.length;
  // Each labl: cue id + the name + a NUL, padded to an even length (the pad isn't counted in its size)
  const lablSizes = labels.map((l) => 4 + l.length + 1);
  const listSize = 4 + lablSizes.reduce((sum, n) => sum + 8 + n + (n & 1), 0);
  const bytes = new Uint8Array(8 + cueSize + 8 + listSize);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const text = (s: string) => {
    bytes.set(ascii(s), offset);
    offset += s.length;
  };
  const u32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };

  text('cue ');
  u32(cueSize);
  u32(cues.length);
  cues.forEach((cue, i) => {
    u32(i + 1); // cue point id, 1-based; the labl that names it uses the same id
    u32(cue.frame); // position in play order
    text('data');
    u32(0); // chunk start (no wave list)
    u32(0); // block start (uncompressed PCM)
    u32(cue.frame); // sample offset in the data chunk
  });

  text('LIST');
  u32(listSize);
  text('adtl');
  labels.forEach((label, i) => {
    text('labl');
    u32(lablSizes[i]);
    u32(i + 1);
    bytes.set(label, offset);
    offset += label.length + 1 + (lablSizes[i] & 1); // the NUL and pad are already zero
  });
  return bytes;
}

/**
 * A 'smpl' chunk marking one forward loop from frame `start` up to (not including) `end`: Godot,
 * samplers and most audio editors read it, and a game that plays the file loops that part after
 * playing what comes before it once.
 */
export function loopChunk(sampleRate: number, start: number, end: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + 36 + 24);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii('smpl'), 0);
  const u32 = (at: number, v: number) => view.setUint32(at, v >>> 0, true);
  u32(4, 36 + 24);
  u32(8, 0); // manufacturer
  u32(12, 0); // product
  u32(16, Math.round(1e9 / sampleRate)); // sample period, nanoseconds
  u32(20, 60); // MIDI unity note (C4)
  u32(24, 0); // pitch fraction
  u32(28, 0); // SMPTE format
  u32(32, 0); // SMPTE offset
  u32(36, 1); // one loop
  u32(40, 0); // no sampler data
  u32(44, 0); // loop id
  u32(48, 0); // forward loop
  u32(52, start);
  u32(56, Math.max(start, end - 1)); // the loop's last frame, inclusive (an empty loop: its start)
  u32(60, 0); // fraction
  u32(64, 0); // play count: forever
  return bytes;
}
