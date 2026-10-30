/**
 * The mixdown an export makes, without the dialog around it: the render (renderArrangement), its
 * loudness, and, when asked, the match to a loudness target (a Loud master's push found afresh as
 * the render's master section runs, or the file turned up or down and limited: reachTarget), with
 * a ring-out cut where its tails die away once the file has its final level. The Export dialog and
 * the command line's renders (src/runtime/render.ts) both make their files this way, so a song
 * rendered either way comes out the same. No store here: callers pass the song.
 */
import { channelsOf, cutRingOut, renderArrangement, type RenderOptions, type RenderProgress } from './exportWav';
import { measureLoudness, type LoudnessReading } from './loudness';
import { reachTarget, type LoudnessTarget } from './loudnessTarget';
import type { LoudMatch } from './effects/loudMaster';
import type { MasterStats } from './effects/masterAfter';
import { safeFileName } from '../store/project';
import type { Track } from '../store/timelineTypes';

/** How loud a mixdown is made. */
export interface MixdownLoudness {
  /** Match a loudness target ("Match a loudness target" in the dialog). */
  normalize: boolean;
  target: LoudnessTarget;
  /** The song's Loud master is on: it reaches the target itself, by its push into the clipper and limiter. */
  loudMaster: boolean;
  /** The true-peak ceiling, dBTP (exportCeilingDbtp). */
  ceilingDbtp: number;
}

/** A rendered mixdown. */
export interface Mixdown {
  audio: AudioBuffer;
  /** Its loudness as it will be in the file (before any compressed format's trim). */
  reading: LoudnessReading;
  /** What a Loud master's match found (normalize with a Loud master only). */
  loudFound?: LoudMatch;
  /** What reaching the target took (normalize without a Loud master only). */
  reached?: { limitedDb: number; shortDb: number; capped: boolean };
  /** What the master section did (how hard its clipper and limiter worked). */
  stats?: MasterStats;
}

/**
 * Render a mixdown of `opts` as Export makes it, and measure its loudness. `onStep` hears the
 * steps after the render ('measuring', 'matching'), for a progress line.
 */
export async function renderMixdown(opts: RenderOptions, how: MixdownLoudness, onProgress?: RenderProgress, onStep?: (step: 'measuring' | 'matching') => void): Promise<Mixdown> {
  const loudMatch = how.loudMaster && how.normalize;
  let loudFound: LoudMatch | undefined;
  let stats: MasterStats | undefined;
  // A ring-out is cut where its tails die away once it has its final level (see keepRingOut)
  const mixOpts: RenderOptions = {
    ...opts,
    keepRingOut: how.normalize,
    ...(loudMatch ? { loudTargetLufs: how.target.lufs } : {}),
    onMasterStats: (m: MasterStats) => {
      stats = m;
      if (loudMatch) loudFound = m.loud ?? loudFound;
      opts.onMasterStats?.(m);
    },
  };
  let audio = await renderArrangement(mixOpts, onProgress);
  opts.signal?.throwIfAborted();
  onStep?.('measuring');
  let reading = await measureLoudness(channelsOf(audio), audio.sampleRate, opts.signal);
  let reached: Mixdown['reached'];
  if (how.normalize && loudMatch) {
    audio = cutRingOut(audio, mixOpts);
    reading = await measureLoudness(channelsOf(audio), audio.sampleRate, opts.signal);
  } else if (how.normalize) {
    onStep?.('matching');
    const r = await reachTarget(channelsOf(audio), audio.sampleRate, reading, how.target, opts.signal, how.ceilingDbtp, opts.ending === 'seamless');
    reading = r.reading;
    reached = { limitedDb: r.limitedDb, shortDb: r.shortDb, capped: r.capped };
    audio = cutRingOut(audio, mixOpts);
  }
  return { audio, reading, ...(loudFound ? { loudFound } : {}), ...(reached ? { reached } : {}), ...(stats ? { stats } : {}) };
}

/** "<base> - <track>.<ext>" per stem, numbered " 2", " 3"... where names repeat (ignoring case, as most file systems do). */
export function stemFileNames(base: string, tracks: readonly Pick<Track, 'name'>[], ext = 'wav'): string[] {
  const used = new Set<string>();
  return tracks.map((track) => {
    // Cleaned apart, so a long project name can't cut the track name off
    const stem = `${base} - ${safeFileName(track.name)}`;
    let name = stem;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} ${n}`;
    used.add(name.toLowerCase());
    return `${name}.${ext}`;
  });
}
