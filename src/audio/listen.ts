/**
 * Rendering a stretch of a song to hear or measure it, from a snapshot of the song rather than
 * the store (so a suggested version of the song renders the same way as the song itself): the
 * render options the Mix check, the before-and-after of a suggestion and an agent's listen all
 * share (renderOptionsFor), the render itself (renderRange: through the master section, with the
 * recordings live playback has, exactly the bars asked for, notes held over from before
 * included; renderLoop: the same made to play looped, its end crossfaded into what leads into
 * its start), and its measurement (measureRender:
 * integrated and loudest-3-seconds loudness, true peak, crest and the balance across the
 * spectrum), and the same bars track by track (renderRangeStems: each track's stem, as the Mix
 * check renders them). No store here: callers pass the song.
 */
import { audibleTracks, channelsOf, renderArrangement, renderStems, stemTracks, type RenderOptions, type RenderProgress } from './exportWav';
import { createLoudnessAnalyser, shortTermWindowFull } from './loudness';
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from './mixAnalysis';
import type { MasterStats } from './effects/masterAfter';
import type { Clip, MasterFx, MasterSettings, Track } from '../store/timelineTypes';
import { barToSeconds, type MeterMap, type TempoPoint } from './tempoMap';
import { LOOP_FADE_SECONDS, loopChannels, preRollStart, restartHeldNotes } from './auditionMath';
import type { IntensityCurve } from '../store/intensity';

/** The parts of a song a render needs. */
export interface ListenSnapshot {
  tracks: Track[];
  clips: Clip[];
  bpm: number;
  tempoPoints?: TempoPoint[];
  /** The song's meter (absent: the studio's; see RenderOptions.meter) */
  meter?: MeterMap;
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
    ...(song.meter ? { meter: song.meter } : {}),
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

/** `audio` without its first `frames` frames. */
function trimStart(audio: AudioBuffer, frames: number): AudioBuffer {
  if (frames <= 0) return audio;
  const out = new AudioBuffer({ numberOfChannels: audio.numberOfChannels, length: Math.max(1, audio.length - frames), sampleRate: audio.sampleRate });
  for (let c = 0; c < audio.numberOfChannels; c++) out.copyToChannel(audio.getChannelData(c).subarray(frames), c);
  return out;
}

/**
 * Render bars [from, to) of `song` through the master section, as they sound in the song: from a
 * run-in (preRollStart; notes held from before it begin again at its start: restartHeldNotes) so
 * notes held over from before are heard, then trimmed to start exactly at `fromBar`. `onMasterStats` hears what the master did.
 */
export async function renderRange(
  song: ListenSnapshot,
  fromBar: number,
  toBar: number,
  opts: { signal?: AbortSignal; progress?: RenderProgress; onMasterStats?: (s: MasterStats) => void } = {}
): Promise<AudioBuffer> {
  const start = preRollStart(song, fromBar);
  // (notes held from before the run-in begin again at its start, for what's left of them)
  const from = start < fromBar ? { ...song, clips: restartHeldNotes(song.clips, start, fromBar) } : song;
  // (what the master section did is counted from fromBar: the run-in isn't heard)
  const audio = await renderArrangement({ ...renderOptionsFor(from, start, toBar, opts.signal), ...(opts.onMasterStats ? { onMasterStats: opts.onMasterStats, masterStatsFromBar: fromBar } : {}) }, opts.progress);
  if (start >= fromBar) return audio;
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  return trimStart(audio, Math.round((barToSeconds(fromBar, tempo) - barToSeconds(start, tempo)) * audio.sampleRate));
}

/**
 * Render bars [from, to) of `song` as renderRange does, made to be played looped (the before and
 * after of a suggestion): its end crossfades into the music leading into its start (loopChannels),
 * so going round doesn't click where a note is held over the start.
 */
export async function renderLoop(song: ListenSnapshot, fromBar: number, toBar: number, opts: { signal?: AbortSignal; progress?: RenderProgress } = {}): Promise<AudioBuffer> {
  const start = preRollStart(song, fromBar);
  const from = start < fromBar ? { ...song, clips: restartHeldNotes(song.clips, start, fromBar) } : song;
  // (no 5 ms fade at the end: the crossfade takes its place)
  const audio = await renderArrangement({ ...renderOptionsFor(from, start, toBar, opts.signal), noEndFade: true }, opts.progress);
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  const trim = start < fromBar ? Math.round((barToSeconds(fromBar, tempo) - barToSeconds(start, tempo)) * audio.sampleRate) : 0;
  const channels = loopChannels(channelsOf(audio), trim, LOOP_FADE_SECONDS * audio.sampleRate);
  const out = new AudioBuffer({ numberOfChannels: channels.length, length: Math.max(1, channels[0].length), sampleRate: audio.sampleRate });
  channels.forEach((c, i) => out.copyToChannel(c, i));
  return out;
}

/**
 * Render bars [from, to) of `song` track by track: each sounding track's stem (its strip, sends and
 * the shared reverb and delay, without the master section, as the Mix check renders them), from
 * the same run-in as renderRange and trimmed the same way. `onStem` gets each one in turn, in the
 * order of the tracks; returns the tracks rendered (those with a clip in the bars, or held into them).
 */
export async function renderRangeStems(
  song: ListenSnapshot,
  fromBar: number,
  toBar: number,
  onStem: (track: Track, channels: Float32Array[], sampleRate: number) => void | Promise<void>,
  opts: { signal?: AbortSignal; progress?: (fraction: number, track: Track) => void } = {}
): Promise<Track[]> {
  const start = preRollStart(song, fromBar);
  const from = start < fromBar ? { ...song, clips: restartHeldNotes(song.clips, start, fromBar) } : song;
  const render: RenderOptions = { ...renderOptionsFor(from, start, toBar, opts.signal), bypassMaster: true };
  const tracks = stemTracks(render);
  if (!tracks.length) return [];
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  const rate = render.sampleRate ?? 44100;
  const trim = start < fromBar ? Math.round((barToSeconds(fromBar, tempo) - barToSeconds(start, tempo)) * rate) : 0;
  const pending = [...tracks];
  await renderStems(
    render,
    16,
    (f, stem) => opts.progress?.(f, stem.track),
    async (channels, sampleRate) => {
      // (called once per stem, in order, after every stem has rendered)
      const track = pending.shift()!;
      await onStem(track, trim > 0 ? channels.map((c) => c.subarray(Math.min(trim, c.length - 1))) : channels, sampleRate);
      return new Blob();
    }
  );
  return tracks;
}

/** What a render measures. Silence (or under 0.4 s) has no loudness or balance: -Infinity and no regions. */
export interface RenderMeasure {
  seconds: number;
  lufs: number;
  /** The loudest whole 3 seconds (-Infinity: silent), or null for audio shorter than 3 seconds. */
  shortTermMaxLufs: number | null;
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
  // (null until a whole 3 seconds have been fed: fewer would overstate audio that starts loud)
  let shortTermMax: number | null = null;
  for (let i = 0; i < left.length; i += hop) {
    const n = Math.min(hop, left.length - i);
    analyser.feed(left.subarray(i, i + n), right.subarray(i, i + n), n);
    if (shortTermWindowFull(i + n, rate)) {
      const now = analyser.read().shortTerm;
      if (shortTermMax === null || now > shortTermMax) shortTermMax = now;
    }
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
