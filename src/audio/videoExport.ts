import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import { drawSpectrum, type SkinId, type SkinMemory } from './spectrumSkins';
import { openVideo, seekVideo } from '../store/videoStore';
import boLogo from '../assets/bo.svg';

/**
 * A song as an MP4 video, for YouTube, socials or a game's trailer: the rendered mix as its sound,
 * and a visualizer as its picture (the project's name, a spectrum that moves with the music, the
 * whole song's waveform with a playhead, the section it's in, the time). Encoded faster than real
 * time with the browser's own encoders (WebCodecs) and put into an MP4 by Mediabunny.
 *
 * H.264 video and AAC sound play everywhere; browsers without those encoders (Chromium builds
 * without the licensed codecs, Firefox on some systems) fall back to VP9 or AV1 video and Opus
 * sound, which browsers, VLC and YouTube play but some older players don't.
 */

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;

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
}

/** True where this browser can make a video at all (WebCodecs in a secure page). */
export const canExportVideo = (): boolean => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

const VIDEO_CODECS = [
  { codec: 'avc1.640028', mux: 'avc' },
  { codec: 'avc1.4d0028', mux: 'avc' },
  { codec: 'avc1.42001f', mux: 'avc' },
  { codec: 'vp09.00.31.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
] as const;
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
] as const;

async function pickCodecs(sampleRate: number) {
  let video: (typeof VIDEO_CODECS)[number] | undefined;
  for (const c of VIDEO_CODECS) {
    const ok = await VideoEncoder.isConfigSupported({ codec: c.codec, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, bitrate: 6e6, framerate: VIDEO_FPS }).catch(() => null);
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
function createSpectrum(mono: Float32Array, sampleRate: number) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const window = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const edges = Array.from({ length: BANDS + 1 }, (_, b) => Math.round((30 * Math.pow(16000 / 30, b / BANDS) * FFT_SIZE) / sampleRate));
  const levels = new Float32Array(BANDS);
  // A full-scale sine comes out of the windowed FFT at this magnitude: dividing by it gives dBFS
  const fullScale = window.reduce((sum, w) => sum + w, 0) / 2;
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
      levels[b] = target > levels[b] ? target : levels[b] * 0.82 + target * 0.18;
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
  const { video, audio } = await pickCodecs(sampleRate);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoTrack = new EncodedVideoPacketSource(video.mux);
  const audioTrack = new EncodedAudioPacketSource(audio.mux);
  output.addVideoTrack(videoTrack, { frameRate: VIDEO_FPS });
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
  videoEncoder.configure({ codec: video.codec, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, bitrate: 6e6, framerate: VIDEO_FPS, ...(video.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}) });
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      audioWrites = audioWrites.then(() => audioTrack.add(packet, meta)).catch((e) => void (failure ??= e));
    },
    error: (e) => (failure = e),
  });
  audioEncoder.configure({ codec: audio.codec, sampleRate, numberOfChannels: 2, bitrate: 192000 });

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
  const spectrum = createSpectrum(mono, sampleRate);
  const W = VIDEO_WIDTH;
  const H = VIDEO_HEIGHT;
  const stripX = 80;
  const stripW = W - 160;
  const wave = overview(mono, stripW / 2);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const logo = await loadImage(boLogo);
  const background = g.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, '#16161a');
  background.addColorStop(1, '#0c0c0e');
  const total = Math.ceil(seconds * VIDEO_FPS);
  const footage = opts.footage ? await openVideo(opts.footage.url) : null;
  const skinMemory: SkinMemory = {};

  const encodeFrame = async (f: number, t: number) => {
    const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / VIDEO_FPS) });
    videoEncoder.encode(frame, { keyFrame: f % (VIDEO_FPS * 2) === 0 });
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
    const t = f / VIDEO_FPS;
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
    g.fillStyle = background;
    g.fillRect(0, 0, W, H);

    // Title block
    if (logo) g.drawImage(logo, stripX, 64, 72, 72);
    g.fillStyle = '#e4e4e7';
    g.font = '600 44px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText(opts.title, stripX + 96, 108, stripW - 96);
    g.fillStyle = '#9ca3af';
    g.font = '400 22px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(opts.subtitle, stripX + 96, 140, stripW - 96);

    // Spectrum: LED bars or one of the characters (spectrumSkins.ts), as in the Mixer
    drawSpectrum(g, opts.skin ?? 'bars', { x: stripX, y: 170, w: stripW, h: 360 }, spectrum(t), t, skinMemory);

    // Waveform of the whole song, with the playhead
    const waveY = 590;
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

    // Section and time
    const section = [...opts.sections].reverse().find((s) => s.at <= t + 1e-6);
    g.font = '600 20px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillStyle = '#f59e0b';
    if (section) g.fillText(section.name.toUpperCase(), stripX, 660);
    g.fillStyle = '#9ca3af';
    g.font = '400 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    const time = `${clock(t)} / ${clock(seconds)}`;
    g.fillText(time, stripX + stripW - g.measureText(time).width, 660);

    await encodeFrame(f, t);
  }
  if (footage) {
    footage.removeAttribute('src');
    footage.load();
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
}
