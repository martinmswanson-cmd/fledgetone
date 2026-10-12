import { create } from 'zustand';

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
  load: (file: File) => Promise<void>;
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

export const useVideoStore = create<VideoState>((set, get) => ({
  video: null,
  start: 0,
  thumbs: [],
  previewOpen: true,
  previewSize: 'medium',
  muted: true,
  loading: false,
  error: null,

  load: async (file) => {
    get().remove();
    const my = ++generation;
    set({ loading: true, error: null });
    const url = URL.createObjectURL(file);
    try {
      const el = await openVideo(url);
      const video: ReferenceVideo = { name: file.name, url, file, duration: el.duration, width: el.videoWidth, height: el.videoHeight };
      el.removeAttribute('src');
      el.load();
      if (my !== generation) return;
      set({ video, start: 0, thumbs: [], loading: false, previewOpen: true });
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
    set({ video: null, thumbs: [], start: 0, error: null });
  },
  setStart: (seconds) => set({ start: Math.max(-36000, Math.min(36000, seconds)) }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  setPreviewSize: (previewSize) => set({ previewSize }),
  setMuted: (muted) => set({ muted }),
}));
