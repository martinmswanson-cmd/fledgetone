/**
 * Tempo, key and tuning of a sound for the hearing report, and its pitch classes along time. It reads
 * the middle at the rate the sample analysis wants, with that file's own detectors. Plain maths on
 * samples, no Web Audio, so Node can test it.
 */
import { ANALYSIS_RATE, chromaOf, detectAudioKey, detectTempo, forAnalysis } from '../sampleAnalysis';
import type { Pitch } from './types';

const round2 = (x: number) => Math.round(x * 100) / 100;
const zeros = () => new Array<number>(12).fill(0);

/** The channels cut to their shortest length. */
function trimmed(channels: readonly Float32Array[]): Float32Array[] {
  let n = Infinity;
  for (const c of channels) n = Math.min(n, c.length);
  if (!Number.isFinite(n)) n = 0;
  return channels.map((c) => c.subarray(0, n));
}

/** Tempo, key, tuning and pitch classes of the middle of some sound; `known.bpm` stands in for detecting the tempo. */
export function pitchOf(channels: readonly Float32Array[], sampleRate: number, known?: { bpm?: number }): Pitch {
  const x = forAnalysis(trimmed(channels), sampleRate);
  const guess = known?.bpm === undefined ? detectTempo(x, ANALYSIS_RATE) : null;
  const tempo =
    known?.bpm !== undefined
      ? { bpm: known.bpm, confidence: 1, alternative: known.bpm }
      : guess
        ? { bpm: Math.round(guess.bpm * 10) / 10, confidence: round2(guess.confidence), alternative: Math.round(guess.alternative * 10) / 10 }
        : null;
  const found = detectAudioKey(x, ANALYSIS_RATE);
  return {
    tempo,
    tempoKnown: known?.bpm !== undefined,
    key: found ? { name: found.key.name, confidence: round2(found.confidence), runnerUp: found.runnerUp.name } : null,
    tuningCents: found ? Math.round(found.cents) : null,
    chroma: found ? found.chroma.map(round2) : zeros(),
  };
}

/** The pitch classes of each step of the middle, C first, each normalised to its strongest. */
export function chromaAlong(channels: readonly Float32Array[], sampleRate: number, stepSeconds: number): number[][] {
  const cut = trimmed(channels);
  const length = cut[0]?.length ?? 0;
  const step = Math.max(1, Math.round(stepSeconds * sampleRate));
  const out: number[][] = [];
  for (let at = 0; at + step <= length || (at === 0 && length > 0); at += step) {
    const x = forAnalysis(cut.map((c) => c.subarray(at, at + step)), sampleRate);
    const { chroma } = chromaOf(x, ANALYSIS_RATE);
    out.push(chroma.map(round2));
  }
  return out;
}
