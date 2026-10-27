/**
 * Groove from audio, in the app: the groove of an audio clip of the song (grooveExtract.ts),
 * measured in a Worker (grooveExtractWorker.ts) so the page doesn't stall, as a feel the song's
 * note clips can play (grooveFeels.ts). The clip's start is where its bar is counted from (turned to
 * the song's bars after: a loop placed on beat 3 still lines up) and its tempo is
 * the recording's: the tempo it follows (stretchBpm), else the song's. Where a Worker can't start
 * it measures on this thread, after a pause for the page to paint.
 */
import { extractLater, type Grid } from './grooveExtract';
import ExtractWorker from './grooveExtractWorker.ts?worker&inline';
import { decodeSound } from './soundLibrary';
import { liveContext } from './liveContext';
import type { Clip } from '../store/timelineTypes';
import { rolesAtClipStart, type GrooveFeel, type GrooveMap, type GrooveRole } from '../store/grooveFeels';
import { getSongMeter } from './transport';

type Result = { roles: Partial<Record<GrooveRole, GrooveMap>>; grid: Grid; bars: number };

function measure(x: Float32Array, sr: number, guess: Grid, onProgress?: (f: number) => void): Promise<Result> {
  const inline = () => extractLater(x, sr, guess, onProgress).then((m): Result => ({ roles: m.roles, grid: m.grid, bars: m.bars }));
  if (typeof Worker === 'undefined') return inline();
  return new Promise<Result>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new ExtractWorker();
    } catch {
      resolve(inline());
      return;
    }
    worker.onmessage = (e: MessageEvent<{ progress?: number; result?: Result; error?: string }>) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      else {
        worker.terminate();
        if (e.data.result) resolve(e.data.result);
        else reject(new Error(e.data.error ?? 'The measurement failed'));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(inline());
    };
    const copy = x.slice();
    worker.postMessage({ x: copy, sr, guess }, [copy.buffer]);
  });
}

/** The longest stretch measured (seconds): a minute and a half is plenty of bars. */
const MAX_SECONDS = 90;

/**
 * The feel of audio clip `clip` at song tempo `songBpm`: undefined when it has too little to go
 * on (no clear hits). Its id is new each time ("user-..."), so a clip that carries it keeps it.
 */
export async function grooveFromAudioClip(clip: Clip, songBpm: number, name: string, onProgress?: (f: number) => void): Promise<GrooveFeel | undefined> {
  const audio = clip.audio;
  if (!audio) return undefined;
  const sr = liveContext.rawContext.sampleRate;
  const buffer = await decodeSound(audio.soundId, sr);
  const bpm = audio.stretchBpm ?? songBpm;
  const seconds = Math.min(MAX_SECONDS, (clip.lengthBars * 240) / bpm, buffer.duration - audio.offset);
  const from = Math.max(0, Math.floor(audio.offset * buffer.sampleRate));
  const n = Math.max(0, Math.floor(seconds * buffer.sampleRate));
  const x = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += ch[from + i] / buffer.numberOfChannels;
  }
  if (n < buffer.sampleRate * 4) return undefined;
  const m = await measure(x, buffer.sampleRate, { bpm, barStart: 0 }, onProgress);
  if (!Object.keys(m.roles).length) return undefined;
  return {
    id: `user-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name,
    about: `Measured from ${m.bars} bars of audio`,
    from: `${m.bars} bars at ${Math.round(m.grid.bpm)} BPM`,
    bpm: Math.round(m.grid.bpm * 10) / 10,
    roles: rolesAtClipStart(m.roles, clip.startBar, getSongMeter()),
  };
}
