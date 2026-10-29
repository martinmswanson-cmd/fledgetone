/**
 * The heavy sound edits, as jobs that can run anywhere: a time-stretch (timeStretch.ts), a warp
 * along markers, a re-pitch (pitchShift.ts), a mangle (mangle.ts) and a tune (hardTune.ts). Each
 * takes plain channels and gives plain channels back, so dspRun.ts can hand them to a Worker and
 * get exactly what running them here gives.
 *
 * A stretch or warp can be `quick` (WSOLA only: a stand-in, at the right speed and pitch, made in
 * a moment while the real one is made) and can name its sound (`key`: the sound and its rate),
 * so how the sound was heard (analyseForStretch, which doesn't depend on the speed) is kept, a
 * few at a time, and the next speed of the same sound skips straight to the stretch. Plain arrays,
 * so Node can unit-test it.
 */
import { analyseForStretch, stretchChannels, warpChannels, wsolaChannels, wsolaPieces, type StretchAnalysis, type StretchPiece } from './timeStretch';
import { pitchShiftChannels } from './pitchShift';
import { mangle, type MangleOp } from './mangle';
import { hardTuneChannels, type HardTuneSettings } from './hardTune';
import type { PitchFrame } from './vocalTune';

export type DspJob =
  | { kind: 'stretch'; ratio: number; quick?: boolean; key?: string }
  | { kind: 'warp'; pieces: StretchPiece[]; quick?: boolean; key?: string }
  | { kind: 'pitch'; semitones: number }
  | { kind: 'mangle'; op: MangleOp }
  | { kind: 'tune'; settings: HardTuneSettings };

export interface DspResult {
  channels: Float32Array[];
  /** A tune's analysis, for drawing: the pitch found, frame by frame, and the change made */
  frames?: PitchFrame[];
  shift?: number[];
}

/** How sounds were heard, by key, newest last; kept within about this much memory. */
const analyses = new Map<string, StretchAnalysis>();
const ANALYSIS_BYTES = 96 * 1024 * 1024;
const sizeOf = (a: StretchAnalysis) => a.split.bytes + 16 * a.hits.length + 256;

function analysisFor(key: string | undefined, channels: Float32Array[], sampleRate: number): StretchAnalysis {
  const hit = key ? analyses.get(key) : undefined;
  if (hit && key) {
    analyses.delete(key);
    analyses.set(key, hit);
    return hit;
  }
  const made = analyseForStretch(channels, sampleRate);
  if (key) {
    analyses.set(key, made);
    let total = 0;
    for (const a of analyses.values()) total += sizeOf(a);
    for (const [k, a] of analyses) {
      if (total <= ANALYSIS_BYTES || k === key) break;
      analyses.delete(k);
      total -= sizeOf(a);
    }
  }
  return made;
}

/** `job` done to `channels` (at `sampleRate`), which it may use up: the new channels. */
export function runDspJob(job: DspJob, channels: Float32Array[], sampleRate: number): DspResult {
  switch (job.kind) {
    case 'stretch':
      if (job.quick) return { channels: wsolaChannels(channels, job.ratio, sampleRate) };
      return { channels: stretchChannels(channels, job.ratio, sampleRate, analysisFor(job.key, channels, sampleRate), true) };
    case 'warp': {
      const pieces = job.pieces.filter((p) => p.to > p.from && p.outTo > p.outFrom);
      if (job.quick) return { channels: pieces.length ? wsolaPieces(channels, pieces, sampleRate) : channels.map(() => new Float32Array(0)) };
      return { channels: warpChannels(channels, job.pieces, sampleRate, analysisFor(job.key, channels, sampleRate), true) };
    }
    case 'pitch':
      return { channels: pitchShiftChannels(channels, job.semitones, sampleRate) };
    case 'mangle':
      return { channels: mangle(channels, job.op, sampleRate) };
    case 'tune': {
      const r = hardTuneChannels(channels, sampleRate, job.settings);
      return { channels: r.channels, frames: r.frames, shift: r.shift };
    }
  }
}
