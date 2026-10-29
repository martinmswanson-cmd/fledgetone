/**
 * Rendering a stretch of a song to hear or measure it, from a snapshot of the song rather than
 * the store (so a suggested version of the song renders the same way as the song itself): the
 * render options the Mix check, the before-and-after of a suggestion and an agent's listen all
 * share (renderOptionsFor), the render itself (renderRange: through the master section, with the
 * recordings live playback has, exactly the bars asked for), and its measurement (measureRender:
 * integrated and loudest-3-seconds loudness, true peak, crest and the balance across the
 * spectrum). No store here: callers pass the song.
 */
import { audibleTracks, channelsOf, renderArrangement, type RenderOptions, type RenderProgress } from './exportWav';
import { createLoudnessAnalyser } from './loudness';
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from './mixAnalysis';
import type { MasterStats } from './effects/masterAfter';
import type { Clip, MasterFx, MasterSettings, Track } from '../store/timelineTypes';
import type { TempoPoint } from './tempoMap';
import type { IntensityCurve } from '../store/intensity';

/** The parts of a song a render needs. */
export interface ListenSnapshot {
  tracks: Track[];
  clips: Clip[];
  bpm: number;
  tempoPoints?: TempoPoint[];
  swing: number;
  masterFx: MasterFx;
  master?: MasterSettings;
  intensity?: { value: number; curves: Record<string, IntensityCurve> };
}

/** The bars [from, to) of `song` as the export renders them, for the app's own ears (recordings as live playback has them). */
export function renderOptionsFor(song: ListenSnapshot, fromBar: number, toBar: number, signal?: AbortSignal): RenderOptions {
  return {
    // (measured or played here, not saved: the recordings as live playback has them)
    recordings: 'playback',
    tracks: song.tracks,
    clips: song.clips,
    bpm: song.bpm,
    tempoPoints: song.tempoPoints,
    swing: song.swing,
    startBar: fromBar,
    endBar: toBar,
    masterFx: song.masterFx,
    master: song.master,
    ending: 'exact',
    sampleRate: 44100,
    markers: [],
    intensity: song.intensity,
    signal,
  };
}

/** Where the music ends: the last clip of a track that sounds (at least bar 2). */
export function musicEnd(song: Pick<ListenSnapshot, 'tracks' | 'clips'>): number {
  const ids = new Set(audibleTracks(song.tracks).map((t) => t.id));
  return Math.max(2, ...song.clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
}

/** Render bars [from, to) of `song` through the master section. `onMasterStats` hears what the master did. */
export function renderRange(
  song: ListenSnapshot,
  fromBar: number,
  toBar: number,
  opts: { signal?: AbortSignal; progress?: RenderProgress; onMasterStats?: (s: MasterStats) => void } = {}
): Promise<AudioBuffer> {
  return renderArrangement({ ...renderOptionsFor(song, fromBar, toBar, opts.signal), ...(opts.onMasterStats ? { onMasterStats: opts.onMasterStats } : {}) }, opts.progress);
}

/** What a render measures. Silence (or under 0.4 s) has no loudness or balance: -Infinity and no regions. */
export interface RenderMeasure {
  seconds: number;
  lufs: number;
  shortTermMaxLufs: number;
  truePeakDbtp: number;
  crestDb: number;
  /** Each part of the spectrum against the whole, dB. */
  regions: Array<{ name: string; db: number }>;
}

/**
 * Measure a render: loudness (BS.1770, fed a tenth of a second at a time so the loudest 3 seconds
 * can be read on the way, yielding now and then so the page stays live), true peak, crest and the
 * balance. Rejects with the signal's reason if aborted.
 */
export async function measureRender(audio: AudioBuffer, signal?: AbortSignal): Promise<RenderMeasure> {
  const channels = channelsOf(audio).slice(0, 2);
  const left = channels[0];
  const right = channels[1] ?? new Float32Array(left.length);
  const rate = audio.sampleRate;
  const analyser = createLoudnessAnalyser(rate);
  const hop = Math.max(1, Math.round(rate / 10));
  let shortTermMax = -Infinity;
  for (let i = 0; i < left.length; i += hop) {
    const n = Math.min(hop, left.length - i);
    analyser.feed(left.subarray(i, i + n), right.subarray(i, i + n), n);
    const now = analyser.read().shortTerm;
    if (now > shortTermMax) shortTermMax = now;
    // (about every 5 seconds of audio, let the page breathe)
    if ((i / hop) % 50 === 49) {
      await new Promise((r) => setTimeout(r, 0));
      signal?.throwIfAborted();
    }
  }
  const reading = analyser.read();
  let peak = 0;
  let sum = 0;
  for (const ch of channels)
    for (const v of ch) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
  const seconds = left.length / rate;
  let regions: RenderMeasure['regions'] = [];
  if (peak > 0 && seconds >= 0.4) {
    const spectrum = bandSpectrum(channels, rate);
    const bands = totalBands(spectrum);
    const total = sumDb(bands);
    if (Number.isFinite(total)) regions = REGIONS.map((x) => ({ name: x.name, db: Math.round((levelBetween(spectrum, bands, x.lo, x.hi) - total) * 10) / 10 }));
  }
  return {
    seconds,
    lufs: reading.integrated,
    shortTermMaxLufs: shortTermMax,
    truePeakDbtp: reading.truePeakMax,
    crestDb: peak > 0 ? 20 * Math.log10(peak) - 10 * Math.log10(sum / Math.max(1, channels.length * left.length)) : -Infinity,
    regions,
  };
}
