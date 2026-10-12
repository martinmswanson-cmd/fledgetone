import { create } from 'zustand';
import type { ProjectVideo } from './timelineTypes';
import { VIDEO_EMBED_MAX } from './timelineTypes';
import { readBlob, storeBlob } from '../audio/soundLibrary';
import { frameDifference, pickCuts } from './sceneCuts';
import { speechSpans, voiceLevels, type Span } from './dialogue';

/**
 * A reference video to score to (gameplay, a trailer, a cutscene): shown in a preview window that
 * follows the playhead and as a lane of thumbnails under the ruler, and usable as the picture of
 * a video export. It lives in this session only (a video is far too big for the autosave): the
 * project keeps working without it.
 */
export interface ReferenceVideo {
  name: string;
  /** An object URL for the file */
  url: string;
  file: File;
  /** Seconds */
  duration: number;
  width: number;
  height: number;
}

export interface Thumb {
  /** Seconds into the video */
  at: number;
  url: string;
}

interface VideoState {
  video: ReferenceVideo | null;
  /** Song time (seconds from bar 1) where the video's first frame is */
  start: number;
  /** Thumbnails every THUMB_STEP seconds, filled in as they're drawn */
  thumbs: Thumb[];
  previewOpen: boolean;
  previewSize: 'small' | 'medium' | 'large';
  /** The video's own sound in the preview (never in exports unless asked) */
  muted: boolean;
  loading: boolean;
  error: string | null;
  /** Where the loaded video is kept in this browser (see keyOf), so the project can find it again */
  key: string | null;
  /** A project's video that isn't in this browser (opened elsewhere): load it again to score to it */
  missing: { name: string; start: number } | null;
  load: (file: File, opts?: { start?: number; key?: string; stored?: boolean }) => Promise<void>;
  /** Bring back a project's video: from this browser, or from the project file itself. */
  restore: (ref: ProjectVideo) => Promise<void>;
  remove: () => void;
  setStart: (seconds: number) => void;
  setPreviewOpen: (open: boolean) => void;
  setPreviewSize: (size: VideoState['previewSize']) => void;
  setMuted: (muted: boolean) => void;
}

/** Seconds between thumbnails (the lane shows as many of them as fit). */
export const THUMB_STEP = 1;
const THUMB_HEIGHT = 40;
/** Longer videos get sparser thumbnails, so drawing them stays quick. */
const MAX_THUMBS = 400;

export const isVideoFile = (file: File) => file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);

/** Wait for an element event once (or an error). */
const once = (el: HTMLVideoElement, event: string) =>
  new Promise<void>((resolve, reject) => {
    const ok = () => {
      el.removeEventListener('error', bad);
      resolve();
    };
    const bad = () => {
      el.removeEventListener(event, ok);
      reject(new Error("this browser can't play that video (try an MP4 or WebM)"));
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });

/** A video element on `url`, loaded far enough to know its size and length. */
export async function openVideo(url: string): Promise<HTMLVideoElement> {
  const el = document.createElement('video');
  el.muted = true;
  el.preload = 'auto';
  el.playsInline = true;
  el.src = url;
  await once(el, 'loadedmetadata');
  return el;
}

/** Show the frame at `seconds` (resolves once it's there to draw). */
export async function seekVideo(el: HTMLVideoElement, seconds: number): Promise<void> {
  const t = Math.max(0, Math.min(el.duration - 0.001, seconds));
  if (Math.abs(el.currentTime - t) < 1e-4 && el.readyState >= 2) return;
  const seeked = once(el, 'seeked');
  el.currentTime = t;
  await seeked;
}

/** Frames are compared this small: enough to see a cut, quick to read. */
const CUT_W = 48;
const CUT_H = 27;
/** Seconds between the frames looked at first (a cut is then found to the frame between them). */
const CUT_STEP = 0.125;

/**
 * Find the hard cuts in a video: frames every CUT_STEP seconds are compared (see sceneCuts.ts),
 * and each cut found is narrowed down to the frame it happens on (to 1/480 s). Resolves with the cut
 * times in seconds from the video's start; `onProgress` hears 0 to 1. Stops early (with what it
 * has) when `signal` aborts.
 */
export async function findSceneCuts(url: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<number[]> {
  const el = await openVideo(url);
  const canvas = document.createElement('canvas');
  canvas.width = CUT_W;
  canvas.height = CUT_H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const frameAt = async (t: number) => {
    await seekVideo(el, t);
    g.drawImage(el, 0, 0, CUT_W, CUT_H);
    return g.getImageData(0, 0, CUT_W, CUT_H).data;
  };
  try {
    const duration = el.duration;
    const times: number[] = [];
    for (let t = 0; t < duration - 0.02; t += CUT_STEP) times.push(t);
    const frames: Uint8ClampedArray[] = [];
    const diffs: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) break;
      frames.push(await frameAt(times[i]));
      if (i > 0) diffs.push(frameDifference(frames[i - 1], frames[i]));
      if (i > 1) frames[i - 2] = new Uint8ClampedArray(0); // only the last two are needed
      onProgress?.((0.85 * i) / times.length);
    }
    const steps = pickCuts(diffs, times);
    const cuts: number[] = [];
    for (const [n, i] of steps.entries()) {
      if (signal?.aborted) break;
      // Narrow it down: keep the half whose ends differ more
      let lo = times[i];
      let hi = times[i + 1];
      let a = await frameAt(lo);
      let b = await frameAt(hi);
      while (hi - lo > 1 / 480) {
        const mid = (lo + hi) / 2;
        const m = await frameAt(mid);
        if (frameDifference(a, m) >= frameDifference(m, b)) {
          hi = mid;
          b = m;
        } else {
          lo = mid;
          a = m;
        }
      }
      cuts.push(hi);
      onProgress?.(0.85 + (0.15 * (n + 1)) / steps.length);
    }
    onProgress?.(1);
    return cuts;
  } finally {
    el.removeAttribute('src');
    el.load();
  }
}

/**
 * Where people talk in a video's own sound (see dialogue.ts): seconds from the video's start.
 * Throws if the video has no sound the browser can read.
 */
export async function findDialogue(file: File): Promise<Span[]> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("this video has no sound the browser can read");
  }
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const x = audio.getChannelData(c);
    for (let i = 0; i < x.length; i++) mono[i] += x[i] / audio.numberOfChannels;
  }
  return speechSpans(voiceLevels(mono, audio.sampleRate));
}

let generation = 0;

async function drawThumbs(url: string, duration: number, myGeneration: number, add: (t: Thumb) => void) {
  const el = await openVideo(url);
  const step = Math.max(THUMB_STEP, duration / MAX_THUMBS);
  const width = Math.round((THUMB_HEIGHT * el.videoWidth) / Math.max(1, el.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = THUMB_HEIGHT * 2;
  const g = canvas.getContext('2d')!;
  for (let at = 0; at < duration; at += step) {
    if (myGeneration !== generation) return;
    await seekVideo(el, at);
    g.drawImage(el, 0, 0, canvas.width, canvas.height);
    add({ at, url: canvas.toDataURL('image/jpeg', 0.6) });
  }
  el.removeAttribute('src');
  el.load();
}

/** Where a video file is kept in this browser: by name, size and date, so the same file isn't kept twice. */
export const keyOf = (file: File): string => `video:${file.name}|${file.size}|${file.lastModified}`;

/** The loaded video as a project refers to it (without the file), or undefined. */
export function projectVideo(): ProjectVideo | undefined {
  const { video, key, start } = useVideoStore.getState();
  return video && key ? { key, name: video.name, type: video.file.type, start } : undefined;
}

/** The loaded video with the file inside it (as a data: URL) when it's small enough to travel in a project file. */
export async function projectVideoForFile(): Promise<ProjectVideo | undefined> {
  const ref = projectVideo();
  const file = useVideoStore.getState().video?.file;
  if (!ref || !file || file.size > VIDEO_EMBED_MAX) return ref;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { ...ref, data };
}

export const useVideoStore = create<VideoState>((set, get) => ({
  video: null,
  start: 0,
  thumbs: [],
  previewOpen: true,
  previewSize: 'medium',
  muted: true,
  loading: false,
  error: null,
  key: null,
  missing: null,

  load: async (file, opts = {}) => {
    // The project's missing video loaded again goes back where it was
    const missing = get().missing;
    const startAt = opts.start ?? (missing?.name === file.name ? missing.start : 0);
    get().remove();
    const my = ++generation;
    set({ loading: true, error: null, missing: null });
    const url = URL.createObjectURL(file);
    try {
      const el = await openVideo(url);
      const video: ReferenceVideo = { name: file.name, url, file, duration: el.duration, width: el.videoWidth, height: el.videoHeight };
      el.removeAttribute('src');
      el.load();
      if (my !== generation) return;
      const key = opts.key ?? keyOf(file);
      set({ video, start: startAt, thumbs: [], loading: false, previewOpen: true, key });
      // Kept in this browser, so the project brings it back after a reload
      if (!opts.stored) void storeBlob(key, file).catch(() => {});
      void drawThumbs(url, video.duration, my, (t) => my === generation && set((s) => ({ thumbs: [...s.thumbs, t] }))).catch(() => {});
    } catch (err) {
      URL.revokeObjectURL(url);
      if (my === generation) set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  remove: () => {
    generation++;
    const v = get().video;
    if (v) URL.revokeObjectURL(v.url);
    set({ video: null, thumbs: [], start: 0, error: null, key: null, missing: null });
  },
  restore: async (ref) => {
    if (get().key === ref.key) {
      set({ start: ref.start });
      return;
    }
    let blob = await readBlob(ref.key).catch(() => undefined);
    const stored = !!blob;
    if (!blob && ref.data) {
      try {
        blob = await (await fetch(ref.data)).blob();
      } catch {
        blob = undefined;
      }
    }
    if (!blob) {
      get().remove();
      set({ missing: { name: ref.name, start: ref.start } });
      return;
    }
    await get().load(new File([blob], ref.name, { type: ref.type || blob.type }), { start: ref.start, key: ref.key, stored });
  },
  setStart: (seconds) => set({ start: Math.max(-36000, Math.min(36000, seconds)) }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  setPreviewSize: (previewSize) => set({ previewSize }),
  setMuted: (muted) => set({ muted }),
}));
