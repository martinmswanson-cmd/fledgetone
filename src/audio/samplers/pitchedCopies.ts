/**
 * Re-pitched copies of recordings, made ahead and kept, so a note that plays a recording at a
 * fixed other pitch (between two of an instrument's recordings, a Drum Rack pad tuned down, a
 * Multi Sampler key away from its sound's root, a Slicer key in Pitch mode) plays a copy at a
 * playback rate of exactly 1: read on whole frames, no interpolation of the browser's. The copy is
 * made with resampler.ts's windowed sinc (images at least 80 dB down, flat to 20 kHz), in a
 * Worker (resampleWorker.ts) so live playback never waits on one; where one can't start, here in
 * pieces between which the page gets on with other work. A bend, a vibrato or a glide still moves
 * the rate as it plays, from the copy nearest the note, so what's left to stretch is small.
 *
 * Kept per recording (held weakly) and per ratio, rate and slice, least recently used first out
 * past a cap (setCopyCap; samplerManager.ts counts them with the recordings); an export pins what
 * it planned until it's done (see TrackInstrument.prepare). Exports play only the copies they
 * planned, so a render comes out the same every time; live playback plays any copy it has, and
 * asks for the one a note missed so the next one has it.
 */
import { CopyCache } from './copyCache';
import { copyKernel, planCopy, resampleInto, type CopyPlan } from './resampler';
import ResampleWorker from './resampleWorker.ts?worker&inline';
import type { ResampleJob } from './resampleWorker';

/** A copy made: its buffer, the ratio it plays at (see planCopy) and its loop. */
export interface PitchedCopy {
  buffer: AudioBuffer;
  ratio: number;
  loop?: [number, number];
}

/** What a copy is to be. */
export interface CopyWish {
  /** How many times as fast it plays its source (above 1: higher) */
  ratio: number;
  /** The context's rate it plays in (an oversampled copy must be clean to this rate's Nyquist) */
  playRate: number;
  /** Its own sample rate: the source's (default), or the context's for a copy that will only play at rate 1 */
  outRate?: number;
  /** The highest frequency the source holds (default: its Nyquist; a recording decoded at twice the rate, its file's) */
  band?: number;
  /** The source's loop, seconds (moved with the copy, onto whole frames: see planCopy) */
  loop?: readonly [number, number];
  /** Only this stretch of the source, seconds (a Slicer's slice) */
  region?: readonly [number, number];
}

/** Copies further than this from their source (cents) aren't made: the old way is as good as any at two octaves. */
const MOST_CENTS = 2400;

/** The cents between a ratio and 1, to a hundredth (copies within that of each other are the same copy). */
const centsOf = (ratio: number) => Math.round(1200 * Math.log2(ratio) * 100);

/** The key a copy is kept under (see CopyWish). */
export function copyKey(source: AudioBuffer, wish: CopyWish): string {
  const out = wish.outRate ?? source.sampleRate;
  return `${centsOf(wish.ratio)}|${out}|${wish.playRate}${wish.region ? `|${wish.region[0]}-${wish.region[1]}` : ''}`;
}

/** Whether a copy at `ratio` is worth making: not the source itself, nor too far away. */
export function copyable(ratio: number): boolean {
  const c = centsOf(ratio);
  return Number.isFinite(c) && c !== 0 && Math.abs(c) <= MOST_CENTS * 100;
}

const cache = new CopyCache<AudioBuffer, PitchedCopy>(160e6);
/** Copies being made, by source and key. */
const making = new WeakMap<AudioBuffer, Map<string, Promise<PitchedCopy | undefined>>>();
/** Told of every copy made, before anything plays it (samplerManager.ts gives it its source's level outline, peak...) */
const derivers: Array<(source: AudioBuffer, copy: PitchedCopy, wish: CopyWish) => void> = [];

/** Call `fn` with every copy made, before it's handed out. */
export function onCopyMade(fn: (source: AudioBuffer, copy: PitchedCopy, wish: CopyWish) => void): void {
  derivers.push(fn);
}

/** How many bytes the copies may take while nothing pins them (least recently used go first past it). */
export function setCopyCap(bytes: number): void {
  cache.cap = bytes;
  cache.trim();
}

/** How many bytes the kept copies take. */
export const copyBytes = () => cache.bytes;

/** Let go of every copy not pinned (Clear memory); returns about how many bytes that frees. */
export const clearCopies = () => cache.clear();

/** The copy of `source` `wish` describes, if it's made. */
export function readyCopy(source: AudioBuffer, wish: CopyWish): PitchedCopy | undefined {
  return cache.get(source, copyKey(source, wish));
}

/** Let go of a copy now (an export's, once it's done with it), unless something still pins it. */
export function dropCopy(source: AudioBuffer, key: string): void {
  cache.delete(source, key);
}

/** How many copies are kept (for the memory readout and the checks). */
export const copyCount = () => cache.size;

/** Hold a copy (see makeCopy's `pin`) no longer. */
export function unpinCopy(source: AudioBuffer, key: string): void {
  cache.unpin(source, key);
}

/**
 * The copy of `source` that `wish` describes: kept, being made, or made now. `urgent`: an export
 * waits for it (made before live playback's background ones, on every core there is to spare);
 * `pin`: held until unpinCopy, whatever the cap. Undefined where no copy is worth making, or one
 * couldn't be.
 */
export function makeCopy(source: AudioBuffer, wish: CopyWish, urgent = false, pin = false): Promise<PitchedCopy | undefined> {
  if (!copyable(wish.ratio)) return Promise.resolve(undefined);
  const key = copyKey(source, wish);
  const have = cache.get(source, key);
  if (have) {
    if (pin) cache.pin(source, key);
    return Promise.resolve(have);
  }
  let row = making.get(source);
  if (!row) making.set(source, (row = new Map()));
  let p = row.get(key);
  if (!p) {
    const job = queue(source, wish, urgent);
    p = job.then(
      (copy) => {
        row!.delete(key);
        for (const d of derivers) d(source, copy, wish);
        cache.set(source, key, copy, copy.buffer.length * copy.buffer.numberOfChannels * 4);
        return copy;
      },
      (err) => {
        row!.delete(key);
        console.warn('A re-pitched copy of a recording could not be made:', err);
        return undefined;
      }
    );
    row.set(key, p);
  } else if (urgent) hurry(source, key);
  return p.then((copy) => {
    if (copy && pin && !cache.pin(source, key)) cache.set(source, key, copy, copy.buffer.length * copy.buffer.numberOfChannels * 4, 1);
    return copy;
  });
}

/** About how many bytes a copy `wish` describes of `source` takes. */
export function copySize(source: AudioBuffer, wish: CopyWish): number {
  const out = wish.outRate ?? source.sampleRate;
  const seconds = wish.region ? Math.max(0, Math.min(source.duration, wish.region[1]) - wish.region[0]) : source.duration;
  return Math.ceil((seconds * out) / Math.max(1e-6, wish.ratio)) * source.numberOfChannels * 4;
}

/**
 * One instrument's copies, as it plays in one context. Live playback (`offline` false) plays any
 * copy that's made and asks for one a note missed (that note plays as before: its recording
 * stretched as it plays); a render plays only the copies it made ready with `prepare`, each
 * pinned until `dispose`, so it sounds the same every time. `allow` says whether a render may
 * spend that many bytes more on a copy (its budget: see samplerManager.ts).
 */
export interface CopySet {
  /** The copy of `source` `wish` describes, to play now, or undefined (play the source stretched). */
  find: (source: AudioBuffer, wish: CopyWish) => PitchedCopy | undefined;
  /** Make the copy ready (a render waits for this before it plays). */
  prepare: (source: AudioBuffer, wish: CopyWish) => Promise<void>;
  /** A copy likely to be played soon (a pad just tuned): made in the background live, made ready in a render. */
  warm: (source: AudioBuffer, wish: CopyWish) => Promise<void>;
  /** Let go of the copies this set pinned. */
  dispose: () => void;
}

export function copySet(offline: boolean, allow: (source: AudioBuffer, key: string, bytes: number) => boolean = () => true): CopySet {
  const prepared = new Map<AudioBuffer, Map<string, PitchedCopy>>();
  const pins: Array<[AudioBuffer, string]> = [];
  let disposed = false;
  const prepare = async (source: AudioBuffer, wish: CopyWish) => {
    if (!copyable(wish.ratio)) return;
    const key = copyKey(source, wish);
    if (prepared.get(source)?.has(key)) return;
    if (offline && !allow(source, key, copySize(source, wish))) return;
    const copy = await makeCopy(source, wish, true, true);
    if (!copy) return;
    if (disposed) {
      cache.unpin(source, key);
      return;
    }
    pins.push([source, key]);
    let row = prepared.get(source);
    if (!row) prepared.set(source, (row = new Map()));
    row.set(key, copy);
  };
  return {
    find: (source, wish) => {
      if (!copyable(wish.ratio)) return undefined;
      const key = copyKey(source, wish);
      if (offline) return prepared.get(source)?.get(key);
      const have = cache.get(source, key);
      if (!have) void makeCopy(source, wish);
      return have;
    },
    prepare,
    warm: (source, wish) => (offline ? prepare(source, wish) : makeCopy(source, wish).then(() => undefined)),
    dispose: () => {
      disposed = true;
      for (const [source, key] of pins) cache.unpin(source, key);
      pins.length = 0;
      prepared.clear();
    },
  };
}

// ---------- the work: in Workers, urgent first ----------

interface Task {
  source: AudioBuffer;
  key: string;
  wish: CopyWish;
  urgent: boolean;
  resolve: (copy: PitchedCopy) => void;
  reject: (err: unknown) => void;
}

const waiting: Task[] = [];
let busy = 0;
/** Workers idle and ready for the next job */
const idle: Worker[] = [];
let workersMade = 0;
let noWorkers = typeof Worker === 'undefined';
let nextId = 1;

/** How many copies are made at once: one for live playback's background (it shares the computer with the music), more for an export that waits. */
function lanes(urgent: boolean): number {
  const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1;
  return urgent ? Math.max(1, Math.min(4, cores - 1)) : 1;
}

function queue(source: AudioBuffer, wish: CopyWish, urgent: boolean): Promise<PitchedCopy> {
  return new Promise<PitchedCopy>((resolve, reject) => {
    waiting.push({ source, key: copyKey(source, wish), wish, urgent, resolve, reject });
    pump();
  });
}

/** An export now waits for a copy asked for in the background: it goes to the front. */
function hurry(source: AudioBuffer, key: string): void {
  const t = waiting.find((x) => x.source === source && x.key === key);
  if (t) t.urgent = true;
  pump();
}

function pump(): void {
  while (waiting.length) {
    const urgentNext = waiting.findIndex((t) => t.urgent);
    const i = urgentNext >= 0 ? urgentNext : 0;
    if (busy >= lanes(urgentNext >= 0)) return;
    const [task] = waiting.splice(i, 1);
    busy++;
    run(task).then(task.resolve, task.reject).finally(() => {
      busy--;
      pump();
    });
  }
}

/** Make one copy: in a Worker where one can start, else here in pieces. */
async function run(task: Task): Promise<PitchedCopy> {
  const { source, wish } = task;
  const outRate = wish.outRate ?? source.sampleRate;
  const plan = planCopy(wish.ratio, source.sampleRate, outRate, source.length, wish.loop, wish.region);
  const band = wish.band ?? source.sampleRate / 2;
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
  let out: Float32Array[] | null = null;
  if (!noWorkers) {
    try {
      out = await inWorker({ id: nextId++, channels: channels.map((c) => c.slice()), plan, ratio: plan.ratio, inRate: source.sampleRate, outRate, playRate: wish.playRate, band });
    } catch {
      out = null;
    }
  }
  if (!out) out = await inPieces(channels, plan, plan.ratio, source.sampleRate, outRate, wish.playRate, band);
  const buffer = new AudioBuffer({ numberOfChannels: out.length, length: plan.length, sampleRate: outRate });
  out.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return { buffer, ratio: plan.ratio, ...(plan.loop ? { loop: plan.loop } : {}) };
}

/** A copy made in a Worker (rejects if none can run: the caller makes it here instead). */
function inWorker(job: ResampleJob): Promise<Float32Array[]> {
  let worker = idle.pop();
  if (!worker) {
    try {
      worker = new ResampleWorker();
      workersMade++;
    } catch (err) {
      noWorkers = true;
      return Promise.reject(err);
    }
  }
  const w = worker;
  return new Promise<Float32Array[]>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ id: number; channels?: Float32Array[]; error?: string }>) => {
      if (e.data.id !== job.id) return;
      idle.push(w);
      if (e.data.channels) resolve(e.data.channels);
      else reject(new Error(e.data.error ?? 'resampling failed'));
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      workersMade--;
      // (a Worker that can't load its script: none will, so the rest are made here)
      noWorkers = true;
      reject(new Error('the resampling Worker failed'));
    };
    w.postMessage(job, job.channels.map((c) => c.buffer));
  });
}

/** Frames made between pauses when there's no Worker (about 10 ms of work). */
const PIECE = 8192;

/** A copy made here, a piece at a time, the page free between pieces. */
async function inPieces(channels: Float32Array[], plan: CopyPlan, ratio: number, inRate: number, outRate: number, playRate: number, band: number): Promise<Float32Array[]> {
  const kernel = copyKernel(ratio, inRate, outRate, playRate, band);
  const out = channels.map(() => new Float32Array(plan.length));
  for (let from = 0; from < plan.length; from += PIECE) {
    resampleInto(channels, plan, kernel, out, from, Math.min(plan.length, from + PIECE));
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** How many Workers are making copies (for the memory readout and tests). */
export const resampleWorkers = () => workersMade;
