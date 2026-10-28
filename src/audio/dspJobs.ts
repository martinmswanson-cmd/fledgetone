/**
 * The heavy sound edits, as jobs that can run anywhere: a time-stretch (timeStretch.ts), a warp
 * along markers, a re-pitch (pitchShift.ts), a mangle (mangle.ts) and a tune (hardTune.ts). Each
 * takes plain channels and gives plain channels back, so dspRun.ts can hand them to a Worker and
 * get exactly what running them here gives. Plain arrays, so Node can unit-test it.
 */
import { stretchChannels, warpChannels, type StretchPiece } from './timeStretch';
import { pitchShiftChannels } from './pitchShift';
import { mangle, type MangleOp } from './mangle';
import { hardTuneChannels, type HardTuneSettings } from './hardTune';

export type DspJob =
  | { kind: 'stretch'; ratio: number }
  | { kind: 'warp'; pieces: StretchPiece[] }
  | { kind: 'pitch'; semitones: number }
  | { kind: 'mangle'; op: MangleOp }
  | { kind: 'tune'; settings: HardTuneSettings };

/** `job` done to `channels` (at `sampleRate`): the new channels. */
export function runDspJob(job: DspJob, channels: Float32Array[], sampleRate: number): Float32Array[] {
  switch (job.kind) {
    case 'stretch':
      return stretchChannels(channels, job.ratio, sampleRate);
    case 'warp':
      return warpChannels(channels, job.pieces, sampleRate);
    case 'pitch':
      return pitchShiftChannels(channels, job.semitones, sampleRate);
    case 'mangle':
      return mangle(channels, job.op, sampleRate);
    case 'tune':
      return hardTuneChannels(channels, sampleRate, job.settings).channels;
  }
}
