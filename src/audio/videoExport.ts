import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import { drawSpectrum, type SkinId, type SkinMemory } from './spectrumSkins';
import { openVideo, seekVideo } from '../store/videoStore';
import fledgetoneLogo from '../assets/fledgetone.png';
import { drawShowcase, type ShowcaseLook } from './showcaseDraw';
import type { ShowcaseData } from '../store/showcase';

/**
 * A song as an MP4 video, for YouTube, socials or a game's trailer: the rendered mix as its sound,
 * and a visualizer as its picture (the project's name, a spectrum that moves with the music, the
 * whole song's waveform with a playhead, the section it's in, the time). Encoded faster than real
 * time with the browser's own encoders (WebCodecs) and put into an MP4 by Mediabunny.
 *
 * H.264 video and AAC sound play everywhere; browsers without those encoders (Chromium builds
 * without the licensed codecs, Firefox on some systems) fall back to VP9 or AV1 video and Opus
 * sound, which browsers, VLC and YouTube play but some older players don't.
 *
 * Two shapes: widescreen (1920×1080, YouTube) and portrait (1080×1920, TikTok, Shorts, Reels), at
 * 30 or 60 frames a second (60: the scrolling notes move smoothly). Either picture is drawn in
 * design units (1280×720 or 720×1280) on a canvas scaled to the video.
 *
 * Made to survive a social site's own re-encoding: a high bitrate, and a background with a fine
 * grain baked in (drawn once), so its dark gradient can't break into bands or blocks.
 * Showcase draws the song's notes on a scrolling piano roll instead of the spectrum (showcaseDraw.ts).
 */

export type VideoShape = 'wide' | 'tall';
/** The video's size in pixels, per shape */
export const VIDEO_SIZES: Record<VideoShape, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, tall: { w: 1080, h: 1920 } };
export type VideoFps = 30 | 60;
export const VIDEO_FPS: VideoFps = 30;
/** Design units per shape (the canvas is scaled from these to the video's size) */
const DESIGN: Record<VideoShape, { w: number; h: number }> = { wide: { w: 1280, h: 720 }, tall: { w: 720, h: 1280 } };
/** Bits a second per frame rate, at 1080p (a site re-encodes it, so it starts from plenty) */
const BITRATE: Record<VideoFps, number> = { 30: 16e6, 60: 24e6 };

/**
 * What's drawn around the picture (each can be left out; the picture grows into the room). The
 * small "made with fledgetone.com" mark at the bottom is always there.
 */
export interface VideoMarks {
  /** The logo and the title */
  title: boolean;
  /** The line under the title */
  subtitle: boolean;
  /** The section the playhead is in, from the markers */
  sections: boolean;
  /** The time, played and in all */
  time: boolean;
  /** The whole song's waveform with a playhead */
  waveform: boolean;
}
export const DEFAULT_VIDEO_MARKS: VideoMarks = { title: true, subtitle: true, sections: true, time: true, waveform: true };

export interface VideoSection {
  /** Seconds from the start of the video. */
  at: number;
  name: string;
}

export interface VideoOptions {
  /** The sound, at 48 kHz (Opus needs it; AAC is happy with it too). */
  channels: Float32Array[];
  sampleRate: number;
  title: string;
  subtitle: string;
  /** Marker names, shown while the playhead is past them. */
  sections: VideoSection[];
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /**
   * The picture from a video instead of the visualizer: `offset` is the video's time at the
   * export's start. Before and after the video, the frame is black.
   */
  footage?: { url: string; offset: number };
  /** How the spectrum is drawn (spectrumSkins.ts): LED bars (the default), or a character. */
  skin?: SkinId;
  /** Widescreen (the default) or portrait */
  shape?: VideoShape;
  /** The song's notes: draws the Showcase piano roll in place of the spectrum */
  showcase?: ShowcaseData;
  /** How Showcase lays out the tracks and lights the notes it hits */
  showcaseLook?: ShowcaseLook;
  /** Frames a second (30 if not given) */
  fps?: VideoFps;
  /** What's drawn around the picture (all of it if not given) */
  marks?: VideoMarks;
}

/** True where this browser can make a video at all (WebCodecs in a secure page). */
export const canExportVideo = (): boolean => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

/** H.264 High, Main, then Baseline (level 4.2: 1080p at 60 fps), then VP9, then AV1 */
const VIDEO_CODECS = [
  { codec: 'avc1.64002a', mux: 'avc' },
  { codec: 'avc1.4d002a', mux: 'avc' },
  { codec: 'avc1.42002a', mux: 'avc' },
  { codec: 'vp09.00.41.08', mux: 'vp9' },
  { codec: 'av01.0.09M.08', mux: 'av1' },
] as const;
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
] as const;

async function pickCodecs(sampleRate: number, width: number, height: number, fps: VideoFps) {
  let video: (typeof VIDEO_CODECS)[number] | undefined;
  for (const c of VIDEO_CODECS) {
    const ok = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: BITRATE[fps], framerate: fps }).catch(() => null);
    if (ok?.supported) {
      video = c;
      break;
    }
  }
  let audio: (typeof AUDIO_CODECS)[number] | undefined;
  for (const c of AUDIO_CODECS) {
    const ok = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate, numberOfChannels: 2, bitrate: 192000 }).catch(() => null);
    if (ok?.supported) {
      audio = c;
      break;
    }
  }
  if (!video || !audio) throw new Error("this browser can't encode video: try Chrome or Edge");
  return { video, audio };
}

/** In-place radix-2 FFT (re, im of length a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const BANDS = 64;
const FFT_SIZE = 2048;

/** A spectrum analyser over the mono mix: BANDS log-spaced bands from 30 Hz to 16 kHz, in 0..1, smoothed like a meter. */
function createSpectrum(mono: Float32Array, sampleRate: number, fps: number) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const window = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const edges = Array.from({ length: BANDS + 1 }, (_, b) => Math.round((30 * Math.pow(16000 / 30, b / BANDS) * FFT_SIZE) / sampleRate));
  const levels = new Float32Array(BANDS);
  // A full-scale sine comes out of the windowed FFT at this magnitude: dividing by it gives dBFS
  const fullScale = window.reduce((sum, w) => sum + w, 0) / 2;
  // How much of the old level stays each frame as a bar falls: the same speed at any frame rate
  const hold = Math.pow(0.82, 30 / fps);
  return (seconds: number): Float32Array => {
    const end = Math.round(seconds * sampleRate);
    for (let i = 0; i < FFT_SIZE; i++) {
      const at = end - FFT_SIZE + i;
      re[i] = at >= 0 && at < mono.length ? mono[at] * window[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let power = 0;
      const lo = Math.max(1, edges[b]);
      const hi = Math.max(lo + 1, edges[b + 1]);
      for (let k = lo; k < hi; k++) power = Math.max(power, re[k] * re[k] + im[k] * im[k]);
      // dBFS, with a gentle tilt so the highs (quieter in music) still move
      const db = 10 * Math.log10(power / (fullScale * fullScale) + 1e-12) + 3 * Math.log2((b + 1) / 8);
      const target = Math.max(0, Math.min(1, (db + 70) / 62));
      // Rise fast, fall slowly
      levels[b] = target > levels[b] ? target : levels[b] * hold + target * (1 - hold);
    }
    return levels;
  };
}

/** Peak of every column of the whole song, for the waveform strip. */
function overview(mono: Float32Array, columns: number): Float32Array {
  const out = new Float32Array(columns);
  const per = mono.length / columns;
  let max = 1e-9;
  for (let c = 0; c < columns; c++) {
    let p = 0;
    for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per); i++) p = Math.max(p, Math.abs(mono[i]));
    out[c] = p;
    max = Math.max(max, p);
  }
  for (let c = 0; c < columns; c++) out[c] /= max;
  return out;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The background, drawn once: a dark gradient with a grain of a level or so on each pixel (fixed,
 * so it costs the encoder nothing after the first frame), which hides the gradient's steps.
 */
function grainedBackground(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#16161a');
  gradient.addColorStop(1, '#0c0c0e');
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
  const img = g.getImageData(0, 0, width, height);
  const d = img.data;
  // A small hash per pixel (the same every time): -1.5 to +1.5 levels, the same on each channel
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let h = Math.imul(p ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    const n = (((h >>> 0) % 1000) / 1000 - 0.5) * 3;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Render the video and return it as an MP4 Blob. */
export async function renderVideo(opts: VideoOptions): Promise<Blob> {
  const { channels, sampleRate, signal } = opts;
  const frames = channels[0].length;
  const seconds = frames / sampleRate;
  const shape = opts.shape ?? 'wide';
  const size = VIDEO_SIZES[shape];
  const fps = opts.fps ?? VIDEO_FPS;
  const { video, audio } = await pickCodecs(sampleRate, size.w, size.h, fps);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoTrack = new EncodedVideoPacketSource(video.mux);
  const audioTrack = new EncodedAudioPacketSource(audio.mux);
  output.addVideoTrack(videoTrack, { frameRate: fps });
  output.addAudioTrack(audioTrack);
  await output.start();
  let failure: unknown = null;
  // The encoders hand over packets as they finish them; each track's are written in turn (its own
  // queue, so one track waiting for the other to catch up never holds the other back)
  let videoWrites: Promise<void> = Promise.resolve();
  let audioWrites: Promise<void> = Promise.resolve();
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      videoWrites = videoWrites.then(() => videoTrack.add(packet, meta)).catch((e) => void (failure ??= e));
    },
    error: (e) => (failure = e),
  });
  videoEncoder.configure({ codec: video.codec, width: size.w, height: size.h, bitrate: BITRATE[fps], framerate: fps, latencyMode: 'quality', ...(video.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}) });
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      audioWrites = audioWrites.then(() => audioTrack.add(packet, meta)).catch((e) => void (failure ??= e));
    },
    error: (e) => (failure = e),
  });
  audioEncoder.configure({ codec: audio.codec, sampleRate, numberOfChannels: 2, bitrate: 192000 });

  // Whatever happens (a failure, a cancel), the encoders and the footage are let go of
  let footage: HTMLVideoElement | null = null;
  try {
    // The sound, in 0.1 s pieces
    const left = channels[0];
    const right = channels[1] ?? channels[0];
    const piece = Math.round(sampleRate / 10);
    for (let at = 0; at < frames; at += piece) {
      const n = Math.min(piece, frames - at);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(at, at + n));
      data.set(right.subarray(at, at + n), n);
      const chunk = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / sampleRate) * 1e6), data });
      audioEncoder.encode(chunk);
      chunk.close();
    }

    // The picture
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = (left[i] + right[i]) / 2;
    const spectrum = createSpectrum(mono, sampleRate, fps);
    const tall = shape === 'tall';
    const W = DESIGN[shape].w;
    const H = DESIGN[shape].h;
    const stripX = tall ? 48 : 80;
    const stripW = W - 2 * stripX;
    const wave = overview(mono, stripW / 2);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const g = canvas.getContext('2d')!;
    // Drawn in design units, scaled to the video's pixels
    g.setTransform(size.w / W, 0, 0, size.h / H, 0, 0);
    // Where things go: the title at the top, the picture in the middle, the waveform and time at the
    // bottom, and the mark under them. What's left out gives its room to the picture (a portrait
    // video keeps its top clear anyway: TikTok and Reels put their tabs there)
    const marks = opts.marks ?? DEFAULT_VIDEO_MARKS;
    const heading = marks.title || marks.subtitle;
    const footer = marks.sections || marks.time;
    const titleY = tall ? 150 : 64;
    const footY = H - 60;
    const waveY = footer ? footY - 70 : footY - 40;
    const pictureY = heading ? titleY + (tall ? 120 : 106) : tall ? titleY : 48;
    const pictureEnd = marks.waveform ? waveY - 50 : footer ? footY - 36 : footY - 12;
    const picture = { x: stripX, y: pictureY, w: stripW, h: pictureEnd - pictureY };
    const logo = await loadImage(fledgetoneLogo);
    const background = grainedBackground(size.w, size.h);
    const total = Math.ceil(seconds * fps);
    footage = opts.footage ? await openVideo(opts.footage.url) : null;
    const skinMemory: SkinMemory = {};

    const encodeFrame = async (f: number, t: number) => {
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      videoEncoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      // Don't run ahead of the encoder (memory), and let the page update its progress bar
      while (videoEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
      if (f % 15 === 0) {
        opts.onProgress?.(f / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    for (let f = 0; f < total; f++) {
      if (signal?.aborted) {
        videoEncoder.close();
        audioEncoder.close();
        signal.throwIfAborted();
      }
      if (failure) throw failure;
      const t = f / fps;
      if (footage && opts.footage) {
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        const vt = opts.footage.offset + t;
        if (vt >= 0 && vt < footage.duration) {
          await seekVideo(footage, vt);
          // Letterboxed to fit
          const scale = Math.min(W / footage.videoWidth, H / footage.videoHeight);
          const w = footage.videoWidth * scale;
          const h = footage.videoHeight * scale;
          g.drawImage(footage, (W - w) / 2, (H - h) / 2, w, h);
        }
        await encodeFrame(f, t);
        continue;
      }
      // (in pixels: the grain is one per pixel)
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(background, 0, 0);
      g.setTransform(size.w / W, 0, 0, size.h / H, 0, 0);

      // Title block (a subtitle on its own takes the title's place)
      g.textBaseline = 'alphabetic';
      if (heading) {
        if (logo) g.drawImage(logo, stripX, titleY, 72, 72);
        if (marks.title) {
          g.fillStyle = '#e4e4e7';
          g.font = `600 ${tall ? 38 : 44}px system-ui, -apple-system, Segoe UI, sans-serif`;
          g.fillText(opts.title, stripX + 96, titleY + 44, stripW - 96);
        }
        if (marks.subtitle) {
          g.fillStyle = '#9ca3af';
          g.font = '400 22px system-ui, -apple-system, Segoe UI, sans-serif';
          g.fillText(opts.subtitle, stripX + 96, titleY + (marks.title ? 76 : 44), stripW - 96);
        }
      }

      if (opts.showcase) {
        // The notes on a piano roll that scrolls past the playhead (showcaseDraw.ts)
        drawShowcase(g, opts.showcase, picture, t, { secondsShown: tall ? 4.5 : 8, headAt: tall ? 0.3 : 0.28, look: opts.showcaseLook });
      } else {
        // Spectrum: LED bars or one of the characters (spectrumSkins.ts), as in the Mixer
        drawSpectrum(g, opts.skin ?? 'bars', picture, spectrum(t), t, skinMemory);
      }

      // Waveform of the whole song, with the playhead
      if (marks.waveform) {
        const waveH = 56;
        const played = (t / seconds) * stripW;
        for (let c = 0; c < wave.length; c++) {
          const x = stripX + c * 2;
          const h = Math.max(1, wave[c] * waveH);
          g.fillStyle = x < stripX + played ? '#06b6d4' : '#3a3a44';
          g.fillRect(x, waveY - h / 2, 1.5, h);
        }
        g.fillStyle = '#f59e0b';
        g.fillRect(stripX + played - 1, waveY - waveH / 2 - 8, 2, waveH + 16);
      }

      // Section and time
      const section = marks.sections ? [...opts.sections].reverse().find((s) => s.at <= t + 1e-6) : undefined;
      g.font = '600 20px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillStyle = '#f59e0b';
      if (section) g.fillText(section.name.toUpperCase(), stripX, footY, stripW / 2);
      if (marks.time) {
        g.fillStyle = '#9ca3af';
        g.font = '400 20px ui-monospace, SFMono-Regular, Menlo, monospace';
        const time = `${clock(t)} / ${clock(seconds)}`;
        g.fillText(time, stripX + stripW - g.measureText(time).width, footY);
      }
      // Where it was made (portrait videos are shared on their own, away from any description)
      g.fillStyle = '#6b7280';
      g.font = '500 16px ui-monospace, SFMono-Regular, Menlo, monospace';
      const mark = 'made with fledgetone.com';
      g.fillText(mark, (W - g.measureText(mark).width) / 2, footY + 34);

      await encodeFrame(f, t);
    }
    await videoEncoder.flush();
    await audioEncoder.flush();
    await Promise.all([videoWrites, audioWrites]);
    if (failure) throw failure;
    videoEncoder.close();
    audioEncoder.close();
    await output.finalize();
    opts.onProgress?.(1);
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } finally {
    for (const encoder of [videoEncoder, audioEncoder]) if (encoder.state !== 'closed') encoder.close();
    if (footage) {
      footage.removeAttribute('src');
      footage.load();
    }
  }
}
