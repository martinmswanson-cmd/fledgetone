/**
 * The sound report of the hearing work: gathers the seven measured groups (tone, texture, movement,
 * dynamics, attack, stereo, pitch), the faults and the sound over time (one reading a second) into
 * one report with its plain-word lines. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { createLoudnessAnalyser } from '../loudness';
import { bandSpectrum } from '../mixAnalysis';
import { attackOf } from './attack';
import { dynamicsOf } from './dynamics';
import { faultsOf } from './faults';
import { movementOf } from './movement';
import { chromaAlong, pitchOf } from './pitch';
import { stereoOf } from './stereo';
import { textureOf } from './texture';
import { toneOf } from './tone';
import { HEARING_VERSIONS, type Along, type Place, type SoundReport } from './types';
import { soundWords } from './words';

export interface HearOptions {
  engine: string;
  tempoBpm?: number;
  place?: (seconds: number) => Place;
}

/** Shorter than this, a sound is too short for the tone, texture, movement, stereo and pitch groups. */
const MIN_SECONDS = 0.4;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** `channels` as they are, or, when a float file holds NaN or Infinity, copies with those samples set to 0. */
function cleaned(channels: readonly Float32Array[]): Float32Array[] {
  return channels.map((c) => {
    let bad = false;
    for (let i = 0; i < c.length; i++) {
      if (!Number.isFinite(c[i])) {
        bad = true;
        break;
      }
    }
    if (!bad) return c;
    const copy = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) copy[i] = Number.isFinite(c[i]) ? c[i] : 0;
    return copy;
  });
}

/** The integrated loudness of `part`, 0.1 LUFS; null when it is too short or too quiet to measure (as dynamicsOf reads it). */
function integratedLufs(part: readonly Float32Array[], sampleRate: number): number | null {
  const analyser = createLoudnessAnalyser(sampleRate);
  const left = part[0];
  analyser.feed(left, part[1] ?? new Float32Array(left.length), left.length);
  const lufs = analyser.read().integrated;
  return Number.isFinite(lufs) ? round1(lufs) : null;
}

const emptyAlong = (): Along => ({ stepSeconds: 1, freqs: [], mid: [], side: [], lufs: [], chroma: [] });

/** The sound over time: the spectra of middle and sides, the loudness and the pitch classes of each whole or part second. */
function alongOf(channels: readonly Float32Array[], sampleRate: number): Along {
  const length = channels[0].length;
  const step = sampleRate;
  const half = 2 ** (1 / 12);
  const along = emptyAlong();
  let keep = 0;
  for (let at = 0; at < length; at += step) {
    const part = channels.map((c) => c.subarray(at, Math.min(length, at + step)));
    const spectrum = bandSpectrum(part, sampleRate);
    if (at === 0) {
      keep = spectrum.freqs.filter((f) => f * half <= (sampleRate / 2) * 1.0001).length;
      along.freqs = spectrum.freqs.slice(0, keep);
    }
    along.mid.push(spectrum.mid.slice(0, keep).map(round1));
    along.side.push(channels.length > 1 ? spectrum.side.slice(0, keep).map(round1) : []);
    along.lufs.push(integratedLufs(part, sampleRate));
  }
  along.chroma = chromaAlong(channels, sampleRate, 1);
  return along;
}

/** Everything the hearing work can say of `channels` (one or two; more are ignored). */
export function hearSound(channels: readonly Float32Array[], sampleRate: number, opts: HearOptions): SoundReport {
  const heard = cleaned(channels.slice(0, 2));
  const length = heard[0]?.length ?? 0;
  const head = {
    versions: { ...HEARING_VERSIONS },
    engine: opts.engine,
    settings: { sampleRate },
    seconds: round2(length / sampleRate),
    channels: (heard.length >= 2 ? 2 : 1) as 1 | 2,
  };
  const silent = !heard.some((c) => c.some((v) => v !== 0));
  if (silent) {
    const report = { ...head, silent: true, faults: [], along: emptyAlong() };
    return { ...report, words: ['It is silent.'] };
  }

  const faults = faultsOf(heard, sampleRate).map((f) => (f.seconds === null ? f : { ...f, at: opts.place ? opts.place(f.seconds) : { seconds: f.seconds } }));
  const { shortTerm: _shortTerm, ...dynamics } = dynamicsOf(heard, sampleRate);
  const report: Omit<SoundReport, 'words'> = { ...head, silent: false, dynamics, attack: attackOf(heard, sampleRate), faults, along: emptyAlong() };

  if (length / sampleRate >= MIN_SECONDS) {
    const tone = toneOf(heard, sampleRate);
    report.tone = tone;
    report.texture = textureOf(heard, sampleRate);
    report.movement = movementOf(heard, sampleRate, opts.tempoBpm);
    const stereo = stereoOf(heard, sampleRate, tone.spectrum);
    if (stereo) report.stereo = stereo;
    report.pitch = pitchOf(heard, sampleRate, opts.tempoBpm === undefined ? undefined : { bpm: opts.tempoBpm });
    report.along = alongOf(heard, sampleRate);
  }
  return { ...report, words: soundWords(report) };
}
