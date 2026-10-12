/**
 * Spectrum readouts: the sound's frequency bands (0 to 1 each, lows first) drawn as LED bars or
 * as a cyberpunk scene that moves with the music. The same drawings are used live (the
 * visualizer in the Mixer tab) and in the MP4 video export, so a video looks like the app.
 *
 * The look: near-black screens, neon magenta, purple, cyan and yellow (lows to highs wherever a
 * colour stands for a frequency), additive glow, scanlines, a HUD frame with live readouts, and
 * a glitch on hard bass hits.
 *
 * Each style draws into a rectangle of a 2D canvas (in the canvas's own pixels, no transform),
 * given the bands, the time in seconds and a `memory` object it keeps things in between frames
 * (falling peaks, the terrain's history, the rain's streams).
 */

export type SkinId = 'bars' | 'city' | 'terrain' | 'hud' | 'rain' | 'holo';

export const SPECTRUM_SKINS: ReadonlyArray<{ id: SkinId; name: string; blurb: string }> = [
  { id: 'bars', name: 'LED bars', blurb: 'Segmented bars in cyan, magenta and yellow, with falling peaks' },
  { id: 'city', name: 'Neon city', blurb: 'A rainy skyline: each tower rises with its part of the sound and its windows light up' },
  { id: 'terrain', name: 'Grid terrain', blurb: 'The spectrum scrolls into the distance as a neon wireframe landscape' },
  { id: 'hud', name: 'Radar HUD', blurb: 'The spectrum round a sweeping radar, with blips and readouts' },
  { id: 'rain', name: 'Data rain', blurb: 'Streams of glyphs that fall faster and brighter where the sound is loud' },
  { id: 'holo', name: 'Holo pigeons', blurb: 'The workshop pigeons as flickering holograms, glitching on the beat' },
];

export const isSkin = (v: unknown): v is SkinId => SPECTRUM_SKINS.some((s) => s.id === v);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SkinMemory = Record<string, unknown>;

const N = {
  magenta: '#ff2bd6',
  purple: '#a855f7',
  cyan: '#22d3ee',
  yellow: '#facc15',
  red: '#ef4444',
  text: '#e4e4e7',
  muted: '#9ca3af',
};
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// ---------- helpers ----------

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (h: string, a: number) => `rgba(${rgb(h).join(',')},${a})`;
function mix(a: string, b: string, f: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * Math.max(0, Math.min(1, f))).toString(16).padStart(2, '0')).join('')}`;
}

const FREQ = [N.magenta, N.purple, N.cyan, N.yellow];
/** The colour standing for a frequency (0 lows to 1 highs). */
function freqColor(u: number): string {
  const x = Math.max(0, Math.min(1, u)) * (FREQ.length - 1);
  const i = Math.min(FREQ.length - 2, Math.floor(x));
  return mix(FREQ[i], FREQ[i + 1], x - i);
}

/** A repeatable pseudo-random number in 0..1 for the given seeds. */
function rand(a: number, b = 0, c = 0): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** The average of bands `from` to `to` (fractions of the range, 0 to 1). */
function level(bands: ArrayLike<number>, from: number, to: number): number {
  const n = bands.length;
  const a = Math.max(0, Math.min(n - 1, Math.floor(from * n)));
  const b = Math.max(a + 1, Math.min(n, Math.ceil(to * n)));
  let sum = 0;
  for (let i = a; i < b; i++) sum += bands[i];
  return sum / (b - a);
}

/** A number that eases towards `target` between frames (fast up, slower down), kept in memory. */
function eased(memory: SkinMemory, key: string, target: number, up = 0.6, down = 0.15): number {
  const prev = (memory[key] as number | undefined) ?? target;
  const next = prev + (target - prev) * (target > prev ? up : down);
  memory[key] = next;
  return next;
}

/** Seconds since the last frame (0 on the first), for things that move in time. Call once a frame. */
function frameTime(memory: SkinMemory, t: number): number {
  const last = memory.lastT as number | undefined;
  memory.lastT = t;
  return last === undefined ? 0 : Math.max(0, Math.min(0.1, t - last));
}

function poly(points: ReadonlyArray<readonly [number, number]>, close = true): Path2D {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  if (close) p.closePath();
  return p;
}

/** A glowing line, its glow added on (lighter), so crossings burn brighter. */
function neon(g: CanvasRenderingContext2D, p: Path2D, color: string, w: number, glow = 1) {
  const a = g.globalAlpha;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  if (glow > 0) {
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a * 0.08 * glow;
    g.lineWidth = w * 6;
    g.stroke(p);
    g.globalAlpha = a * 0.2 * glow;
    g.lineWidth = w * 2.6;
    g.stroke(p);
    g.globalCompositeOperation = op;
  }
  g.globalAlpha = a;
  g.lineWidth = w;
  g.stroke(p);
}

/** A soft pool of light, added on. */
function pool(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, alpha: number) {
  if (alpha <= 0.01 || rx <= 0) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.translate(x, y);
  g.scale(1, Math.max(0.01, ry / rx));
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba(color, Math.min(1, alpha)));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

const fontPx = (r: Rect) => Math.round(Math.max(9, Math.min(14, r.h * 0.04)));

function formatHz(hz: number): string {
  return hz < 1000 ? `${Math.round(hz)}Hz` : `${(hz / 1000).toFixed(hz < 10000 ? 1 : 0)}kHz`;
}

/** The loudest band's frequency. */
function peakHz(bands: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i] > bands[best]) best = i;
  return 30 * (16000 / 30) ** ((best + 0.5) / bands.length);
}

/**
 * The HUD on top of every style: scanlines, corner brackets, a label, the loudest frequency and
 * a level meter, and a glitch (a few rows torn sideways, tinted) on hard bass hits.
 */
function overlay(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory, label: string) {
  // Glitch first, so the HUD stays steady over it
  const bass = level(bands, 0, 0.12);
  const prev = (memory.gBass as number | undefined) ?? bass;
  memory.gBass = bass;
  if (bass - prev > 0.14 && t - ((memory.glitchAt as number | undefined) ?? -1) > 0.3) memory.glitchAt = t;
  const glitchAt = (memory.glitchAt as number | undefined) ?? -9;
  const since = t - glitchAt;
  if (since >= 0 && since < 0.12) {
    const seed = Math.floor(glitchAt * 1000);
    for (let i = 0; i < 4; i++) {
      const h = Math.max(2, Math.round(rand(seed, i, 1) * r.h * 0.07));
      const y = Math.round(r.y + rand(seed, i) * (r.h - h));
      const dx = Math.round((rand(seed, i, 2) - 0.5) * r.w * 0.08);
      g.drawImage(g.canvas, r.x, y, r.w, h, r.x + dx, y, r.w, h);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(i % 2 ? N.cyan : N.magenta, 0.12);
      g.fillRect(r.x, y, r.w, h);
      g.restore();
    }
  }
  // Scanlines
  const line = Math.max(1, Math.round(r.h / 220));
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = r.y; y < r.y + r.h; y += line * 3) g.fillRect(r.x, y, r.w, line);
  // Corner brackets
  const L = Math.min(r.w, r.h) * 0.06;
  const m = Math.max(4, L * 0.25);
  const corners = new Path2D();
  for (const [x, y, sx, sy] of [
    [r.x + m, r.y + m, 1, 1],
    [r.x + r.w - m, r.y + m, -1, 1],
    [r.x + m, r.y + r.h - m, 1, -1],
    [r.x + r.w - m, r.y + r.h - m, -1, -1],
  ]) {
    corners.moveTo(x, y + sy * L);
    corners.lineTo(x, y);
    corners.lineTo(x + sx * L, y);
  }
  g.globalAlpha = 0.75;
  neon(g, corners, N.cyan, Math.max(1, r.h / 300), 0.6);
  g.globalAlpha = 1;
  // Label, the loudest frequency, the level
  const fs = fontPx(r);
  g.font = `500 ${fs}px ${MONO}`;
  g.textBaseline = 'top';
  g.fillStyle = rgba(N.cyan, 0.85);
  g.fillText(`▸ ${label}`, r.x + m + fs * 0.4, r.y + m + fs * 0.3);
  const loud = eased(memory, 'hudLoud', level(bands, 0, 1), 0.5, 0.1);
  const cells = 10;
  const cw = fs * 0.45;
  const right = r.x + r.w - m - fs * 0.4;
  g.textAlign = 'right';
  g.fillStyle = rgba(N.magenta, 0.9);
  g.fillText(`PK ${formatHz(peakHz(bands))}`, right - cells * cw - fs * 0.6, r.y + m + fs * 0.3);
  for (let i = 0; i < cells; i++) {
    g.fillStyle = i < loud * cells * 1.3 ? (i > 7 ? N.yellow : N.magenta) : 'rgba(255,255,255,0.1)';
    g.fillRect(right - (cells - i) * cw, r.y + m + fs * 0.4, cw * 0.7, fs * 0.75);
  }
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
}

// ---------- LED bars ----------

const FREQ_LABELS: ReadonlyArray<[number, string]> = [
  [100, '100'],
  [1000, '1k'],
  [10000, '10k'],
];
const freqX = (hz: number) => Math.log(hz / 30) / Math.log(16000 / 30);

function bars(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const dt = frameTime(memory, t);
  g.fillStyle = '#06060b';
  g.fillRect(r.x, r.y, r.w, r.h);
  const n = bands.length;
  const fs = fontPx(r);
  const top = r.y + fs * 2.6;
  const bottom = r.y + r.h - fs * 2;
  const col = r.w / n;
  const gap = Math.max(1, col * 0.22);
  const segH = Math.max(2, Math.min(6, (bottom - top) / 34));
  const segGap = Math.max(1, segH * 0.5);
  const rows = Math.max(4, Math.floor((bottom - top) / (segH + segGap)));
  const peaks = ((memory.peaks as number[] | undefined) ??= []);
  const colorAt = (frac: number) => (frac < 0.55 ? N.cyan : frac < 0.82 ? N.magenta : N.yellow);
  for (let b = 0; b < n; b++) {
    const lit = bands[b] * rows;
    const x = r.x + b * col + gap / 2;
    const bw = col - gap;
    for (let s = 0; s < rows; s++) {
      const y = bottom - (s + 1) * (segH + segGap) + segGap;
      if (s < lit) {
        g.fillStyle = colorAt(s / rows);
        g.globalAlpha = s + 1 > lit ? 0.4 + 0.6 * (lit - s) : 0.92;
      } else {
        g.fillStyle = '#15151f';
        g.globalAlpha = 1;
      }
      g.fillRect(x, y, bw, segH);
    }
    g.globalAlpha = 1;
    if (lit >= 1) pool(g, x + bw / 2, bottom - lit * (segH + segGap), bw * 1.6, segH * 3, colorAt(lit / rows), 0.4);
    // Peak hold, falling slowly
    const peak = Math.max(lit, (peaks[b] ?? 0) - dt * rows * 0.35);
    peaks[b] = peak;
    if (peak >= 1) {
      const s = Math.min(rows - 1, Math.floor(peak));
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.85;
      g.fillRect(x, bottom - (s + 1) * (segH + segGap) + segGap, bw, segH);
      g.globalAlpha = 1;
    }
  }
  // Floor line and frequency labels
  neon(g, poly([[r.x, bottom + 3], [r.x + r.w, bottom + 3]], false), N.cyan, 1, 0.5);
  g.font = `${fs}px ${MONO}`;
  g.textBaseline = 'bottom';
  g.textAlign = 'center';
  g.fillStyle = N.muted;
  for (const [hz, label] of FREQ_LABELS) g.fillText(label, r.x + freqX(hz) * r.w, r.y + r.h - fs * 0.3);
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
  overlay(g, r, bands, t, memory, 'SPECTRUM.LED');
}

// ---------- Neon city ----------

function city(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const u = Math.max(0.6, r.h / 300);
  const ground = r.y + r.h * 0.8;
  // Sky, with the city's glow on the horizon
  const sky = g.createLinearGradient(0, r.y, 0, ground);
  sky.addColorStop(0, '#05040a');
  sky.addColorStop(1, '#1c0a2e');
  g.fillStyle = sky;
  g.fillRect(r.x, r.y, r.w, ground - r.y);
  pool(g, r.x + r.w / 2, ground, r.w * 0.6, r.h * 0.4, N.magenta, 0.22);
  // The far skyline: still, dark, a few windows
  for (let x = r.x, i = 0; x < r.x + r.w; i++) {
    const w = r.w * (0.025 + rand(i, 1) * 0.04);
    const h = r.h * (0.18 + rand(i, 2) * 0.32);
    g.fillStyle = '#140b24';
    g.fillRect(x, ground - h, w + 1, h);
    for (let k = 0; k < 4; k++) {
      if (rand(i, k, 3) > 0.5) continue;
      g.fillStyle = rgba(N.purple, 0.35);
      g.fillRect(x + rand(i, k, 4) * Math.max(0, w - 2 * u), ground - h + rand(i, k, 5) * h * 0.9, 1.5 * u, 2 * u);
    }
    x += w;
  }
  // The towers, one per slice of the spectrum
  const count = Math.max(10, Math.min(30, Math.floor(r.w / (36 * u))));
  const widths = Array.from({ length: count }, (_, k) => 0.6 + rand(k, 9) * 0.8);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = r.x;
  for (let k = 0; k < count; k++) {
    const bw = (widths[k] / total) * r.w;
    const u0 = k / count;
    const lv = eased(memory, `tw${k}`, level(bands, u0, u0 + 1 / count), 0.5, 0.12);
    const h = (ground - r.y - fontPx(r) * 3) * (0.18 + 0.72 * lv) * (0.78 + 0.22 * rand(k, 3));
    const top = ground - h;
    const tint = freqColor(u0 + 0.5 / count);
    const inset = bw * 0.08;
    const bx = x + inset;
    const w = bw - inset * 2;
    const body = g.createLinearGradient(bx, 0, bx + w, 0);
    body.addColorStop(0, '#0b0915');
    body.addColorStop(1, '#171126');
    g.fillStyle = body;
    g.fillRect(bx, top, w, h);
    // Windows: more of them lit the louder its part of the sound, a few flickering
    const ww = 2.2 * u;
    const wh = 3 * u;
    const cols = Math.max(1, Math.floor((w - 4 * u) / (5 * u)));
    const rows = Math.max(0, Math.floor((h - 8 * u) / (7 * u)));
    const lit = 0.12 + lv * 0.75;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const roll = rand(k, i, j);
        if (roll > lit || rand(k, i * 31 + j, Math.floor(t * 3)) < 0.02) continue;
        g.fillStyle = rgba(roll < lit * 0.3 ? '#ffffff' : tint, 0.45 + 0.5 * rand(k, j, i));
        g.fillRect(bx + 2 * u + i * 5 * u + (5 * u - ww) / 2, top + 6 * u + j * 7 * u, ww, wh);
      }
    }
    // Rooftop edge in the tower's colour
    g.globalAlpha = 0.5 + lv * 0.5;
    neon(g, poly([[bx, top], [bx + w, top]], false), tint, Math.max(1, u), 0.8);
    g.globalAlpha = 1;
    // A vertical neon sign on some
    if (rand(k, 5) > 0.6 && h > 40 * u) {
      const sx = bx + w * (0.15 + rand(k, 6) * 0.5);
      const sy = top + h * 0.12;
      const sh = h * (0.25 + rand(k, 7) * 0.2);
      g.globalAlpha = 0.35 + lv * 0.65;
      neon(g, poly([[sx, sy], [sx, sy + sh]], false), rand(k, 8) > 0.5 ? N.magenta : N.cyan, Math.max(1.5, 2.2 * u), 1);
      g.globalAlpha = 1;
    }
    // An antenna with a blinking light on others
    if (rand(k, 4) > 0.55) {
      const ax = bx + w * 0.5;
      g.fillStyle = '#2a2140';
      g.fillRect(ax - 0.5 * u, top - 12 * u, u, 12 * u);
      if (Math.sin(t * 3 + k * 1.7) > 0.3) pool(g, ax, top - 12 * u, 6 * u, 6 * u, N.red, 0.9);
    }
    x += bw;
  }
  // The street: the city reflected in the wet road, and a neon kerb
  const refH = r.y + r.h - ground;
  g.fillStyle = '#05040a';
  g.fillRect(r.x, ground, r.w, refH);
  g.save();
  g.globalAlpha = 0.28;
  g.translate(0, ground * 2);
  g.scale(1, -1);
  g.drawImage(g.canvas, r.x, ground - refH, r.w, refH, r.x, ground - refH, r.w, refH);
  g.restore();
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(5,4,10,0.55)';
    g.fillRect(r.x, ground + refH * (0.15 + i * 0.15), r.w, refH * 0.05);
  }
  neon(g, poly([[r.x, ground], [r.x + r.w, ground]], false), N.magenta, Math.max(1, u), 0.9);
  // Rain
  g.strokeStyle = 'rgba(160,210,255,0.16)';
  g.lineWidth = Math.max(1, u * 0.7);
  g.beginPath();
  const drops = Math.floor(r.w / (9 * u));
  const len = 14 * u;
  for (let i = 0; i < drops; i++) {
    const y = r.y - len + ((t * (0.9 + rand(i, 2) * 0.5) + rand(i, 1)) % 1) * (r.h + len);
    const dx = r.x + rand(i, 3) * r.w - (y - r.y) * 0.15;
    g.moveTo(dx, y);
    g.lineTo(dx - len * 0.15, y + len);
  }
  g.stroke();
  overlay(g, r, bands, t, memory, 'NEON.CITY');
}

// ---------- Grid terrain ----------

function terrain(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const horizon = r.y + r.h * 0.3;
  const sky = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  sky.addColorStop(0, '#04030a');
  sky.addColorStop(0.3, '#160826');
  sky.addColorStop(1, '#04030a');
  g.fillStyle = sky;
  g.fillRect(r.x, r.y, r.w, r.h);
  pool(g, r.x + r.w / 2, horizon, r.w * 0.55, r.h * 0.18, N.magenta, 0.35);
  // History: a new ridge twenty times a second
  const RATE = 20;
  const ROWS = 34;
  const rows = ((memory.rows as Float32Array[] | undefined) ??= []);
  let lastPush = (memory.lastPush as number | undefined) ?? -1;
  if (!rows.length || t - lastPush >= 1 / RATE || t < lastPush) {
    rows.unshift(Float32Array.from(bands as ArrayLike<number>));
    if (rows.length > ROWS) rows.length = ROWS;
    lastPush = t;
    memory.lastPush = t;
  }
  const glide = Math.max(0, Math.min(1, (t - lastPush) * RATE));
  const cx = r.x + r.w / 2;
  const near = r.y + r.h * 1.05;
  // Floor grid converging on the horizon
  g.strokeStyle = rgba(N.purple, 0.28);
  g.lineWidth = 1;
  g.beginPath();
  for (let k = -14; k <= 14; k++) {
    g.moveTo(cx, horizon);
    g.lineTo(cx + k * r.w * 0.18, near);
  }
  g.stroke();
  // Ridges, far to near, each hiding what's behind it
  const n = bands.length;
  const pts = 64;
  for (let a = rows.length - 1; a >= 0; a--) {
    const s = 1 / (1 + (a + glide) * 0.32);
    const y0 = horizon + (near - horizon) * s;
    const halfW = r.w * 0.75 * s;
    const amp = r.h * 0.5 * s;
    const row = rows[a];
    const line: Array<[number, number]> = [];
    for (let i = 0; i <= pts; i++) {
      const xN = (i / pts) * 2 - 1;
      // Lows in the middle, highs out to the sides
      const idx = Math.min(n - 1, Math.floor(Math.abs(xN) * n));
      const v = row[idx] ** 1.4 * (1 - Math.abs(xN) ** 3 * 0.5);
      line.push([cx + xN * halfW, y0 - v * amp]);
    }
    g.fillStyle = '#07040e';
    g.fill(poly([...line, [cx + halfW, y0 + 2], [cx - halfW, y0 + 2]]));
    const nearness = 1 - a / ROWS;
    g.globalAlpha = Math.min(1, 0.15 + nearness * 1.1);
    neon(g, poly(line, false), mix(N.purple, N.cyan, nearness ** 1.5), Math.max(1, s * 2.2), nearness);
    g.globalAlpha = 1;
  }
  neon(g, poly([[r.x, horizon], [r.x + r.w, horizon]], false), N.magenta, 1, 0.8);
  overlay(g, r, bands, t, memory, 'TERRAIN.SCAN');
}

// ---------- Radar HUD ----------

function hud(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  g.fillStyle = '#04070a';
  g.fillRect(r.x, r.y, r.w, r.h);
  const fs = fontPx(r);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.54;
  const R = Math.min(r.w * 0.3, r.h * 0.4);
  const cyanA = (a: number) => rgba(N.cyan, a);
  // Rings and crosshair
  g.lineWidth = 1;
  for (let k = 1; k <= 4; k++) {
    g.strokeStyle = cyanA(k === 4 ? 0.35 : 0.13);
    g.beginPath();
    g.arc(cx, cy, (R * 0.5 * k) / 4, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = cyanA(0.12);
  g.beginPath();
  g.moveTo(cx - R * 1.15, cy);
  g.lineTo(cx + R * 1.15, cy);
  g.moveTo(cx, cy - R * 1.15);
  g.lineTo(cx, cy + R * 1.15);
  g.stroke();
  // A slowly turning tick ring
  const ticks = new Path2D();
  const spin = t * 0.15;
  for (let k = 0; k < 72; k++) {
    const a = spin + (k / 72) * Math.PI * 2;
    const r0 = R * 1.04;
    const r1 = R * (k % 6 ? 1.08 : 1.13);
    ticks.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ticks.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  g.globalAlpha = 0.6;
  neon(g, ticks, N.cyan, 1, 0.3);
  g.globalAlpha = 1;
  // The spectrum as spokes: lows at the top, highs at the bottom, mirrored left and right
  const spokes = 120;
  const r0 = R * 0.56;
  const spokeW = Math.max(1.2, ((Math.PI * 2 * r0) / spokes) * 0.55);
  for (let k = 0; k < spokes; k++) {
    const f = k / spokes;
    const uu = f < 0.5 ? f * 2 : (1 - f) * 2;
    const lv = eased(memory, `sp${k}`, level(bands, uu * 0.98, uu * 0.98 + 0.02), 0.7, 0.2);
    const a = -Math.PI / 2 + f * Math.PI * 2;
    const len = R * 0.02 + lv * R * 0.42;
    const p = poly([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)]], false);
    neon(g, p, freqColor(uu), spokeW, 0.3 + lv * 0.7);
  }
  // The sweep and its fading trail
  const sweep = t * 1.4;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let j = 0; j < 24; j++) {
    g.fillStyle = cyanA(0.1 * (1 - j / 24));
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R * 0.5, sweep - (j + 1) * 0.035, sweep - j * 0.035);
    g.closePath();
    g.fill();
  }
  g.restore();
  neon(g, poly([[cx, cy], [cx + Math.cos(sweep) * R * 0.5, cy + Math.sin(sweep) * R * 0.5]], false), N.cyan, 1.5, 1);
  // Blips where the sweep crosses a loud part of the spectrum
  const blips = ((memory.blips as Array<{ a: number; d: number; born: number }> | undefined) ??= []);
  const at = (((sweep + Math.PI / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const f = at / (Math.PI * 2);
  const uu = f < 0.5 ? f * 2 : (1 - f) * 2;
  if (level(bands, uu * 0.95, uu * 0.95 + 0.05) > 0.5 && t - ((memory.blipAt as number | undefined) ?? -1) > 0.07) {
    blips.push({ a: sweep, d: R * (0.12 + rand(t * 100) * 0.34), born: t });
    memory.blipAt = t;
  }
  while (blips.length && (t - blips[0].born > 2 || t < blips[0].born)) blips.shift();
  for (const b of blips) {
    const age = (t - b.born) / 2;
    const bx = cx + Math.cos(b.a) * b.d;
    const by = cy + Math.sin(b.a) * b.d;
    pool(g, bx, by, R * 0.06, R * 0.06, N.magenta, 0.9 * (1 - age));
    g.fillStyle = rgba('#ffffff', 1 - age);
    g.fillRect(bx - 1.5, by - 1.5, 3, 3);
  }
  // Centre readout: the level as a number
  const loud = eased(memory, 'loud', level(bands, 0, 1), 0.4, 0.1);
  g.font = `700 ${Math.round(R * 0.16)}px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = N.text;
  g.fillText(String(Math.round(loud * 100)).padStart(3, '0'), cx, cy);
  g.font = `${Math.round(fs * 0.8)}px ${MONO}`;
  g.fillStyle = rgba(N.cyan, 0.7);
  g.fillText('LVL', cx, cy + R * 0.14);
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
  // Side panels, when there's room: band meters on the left, data on the right
  if (r.w > R * 4.2) {
    const px = r.x + r.w * 0.06;
    const top = cy - R * 0.6;
    const mh = R * 1.2;
    const meters: ReadonlyArray<readonly [string, number, number, string]> = [
      ['LOW', 0, 0.2, N.magenta],
      ['MID', 0.2, 0.6, N.purple],
      ['HIGH', 0.6, 1, N.cyan],
    ];
    meters.forEach(([name, a, b, color], i) => {
      const v = eased(memory, `side${i}`, level(bands, a, b), 0.6, 0.15);
      const mx = px + i * fs * 3.2;
      const cells = 16;
      for (let c = 0; c < cells; c++) {
        g.fillStyle = c < v * cells * 1.2 ? color : 'rgba(255,255,255,0.07)';
        g.fillRect(mx, top + mh - ((c + 1) * mh) / cells, fs * 1.6, mh / cells - 2);
      }
      g.font = `${Math.round(fs * 0.8)}px ${MONO}`;
      g.fillStyle = N.muted;
      g.fillText(name, mx, top + mh + fs * 1.2);
    });
    const dx = r.x + r.w * 0.76;
    g.font = `${Math.round(fs * 0.85)}px ${MONO}`;
    const lines = [
      `PEAK  ${formatHz(peakHz(bands))}`,
      `BASS  ${Math.round(level(bands, 0, 0.15) * 100)}%`,
      `TREB  ${Math.round(level(bands, 0.7, 1) * 100)}%`,
      `SWP   ${String(Math.round(((sweep * 180) / Math.PI) % 360)).padStart(3, '0')}°`,
      `0x${Math.floor(rand(Math.floor(t * 4)) * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`,
    ];
    lines.forEach((l, i) => {
      g.fillStyle = i === lines.length - 1 ? rgba(N.magenta, 0.7) : rgba(N.cyan, 0.85);
      g.fillText(l, dx, top + fs + i * fs * 1.7);
    });
  }
  overlay(g, r, bands, t, memory, 'RADAR.HUD');
}

// ---------- Data rain ----------

const GLYPHS = '0123456789ABCDEF<>/\\|=+*#%$@:;';

function rain(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const dt = frameTime(memory, t);
  g.fillStyle = '#030507';
  g.fillRect(r.x, r.y, r.w, r.h);
  const fs = Math.max(9, Math.min(18, Math.round(r.w / 42)));
  const cw = fs * 0.85;
  const cols = Math.max(8, Math.floor(r.w / cw));
  const rowsN = Math.ceil(r.h / fs);
  const heads = ((memory.heads as number[] | undefined) ??= []);
  while (heads.length < cols) heads.push(-rand(heads.length, 7) * rowsN);
  g.font = `500 ${fs}px ${MONO}`;
  g.textBaseline = 'top';
  const tops: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    const u = c / cols;
    const lv = eased(memory, `rc${c}`, level(bands, u, u + 1 / cols), 0.6, 0.15);
    const x = r.x + c * cw;
    // A faint column showing the level, under the streams
    const barH = lv * r.h * 0.85;
    const grad = g.createLinearGradient(0, r.y + r.h - barH, 0, r.y + r.h);
    grad.addColorStop(0, rgba(freqColor(u), 0.16));
    grad.addColorStop(1, rgba(freqColor(u), 0.02));
    g.fillStyle = grad;
    g.fillRect(x + 1, r.y + r.h - barH, cw - 2, barH);
    tops.push([x + cw / 2, r.y + r.h - barH]);
    // The stream: faster, longer and brighter where it's loud
    const trail = 5 + lv * 18;
    heads[c] += (3 + lv * 26) * dt;
    if (heads[c] - trail > rowsN) heads[c] = -rand(c, Math.floor(t)) * 8;
    const head = Math.floor(heads[c]);
    for (let j = 0; j < trail; j++) {
      const row = head - j;
      if (row < 0 || row >= rowsN) continue;
      const ch = GLYPHS[Math.floor(rand(c, row, Math.floor(t * 7 + c * 0.3)) * GLYPHS.length)];
      const a = (1 - j / trail) * (0.25 + 0.75 * lv);
      g.fillStyle = j === 0 ? rgba('#eafcff', Math.min(1, a + 0.3)) : rgba(j < 3 ? N.cyan : freqColor(u), a);
      g.fillText(ch, x + cw * 0.1, r.y + row * fs);
    }
    if (head >= 0 && head < rowsN && lv > 0.4) pool(g, x + cw / 2, r.y + head * fs + fs / 2, cw * 1.4, fs * 1.2, N.cyan, (lv - 0.4) * 0.7);
  }
  g.textBaseline = 'alphabetic';
  // The level line across the column tops
  neon(g, poly(tops, false), N.magenta, Math.max(1, fs * 0.12), 1);
  overlay(g, r, bands, t, memory, 'DATA.STREAM');
}

// ---------- Holo pigeons ----------

/** The faceted pigeon (facing right, feet at 0,0, about 1 tall): its points and triangles. */
const P = {
  ht: [0.2, -1.0], hf: [0.31, -0.96], hb: [0.04, -0.93], bt: [0.36, -0.9], bp: [0.47, -0.86], bb: [0.34, -0.85], ch: [0.27, -0.8],
  nf: [0.31, -0.64], nb: [-0.03, -0.74], cs: [0.33, -0.44], bl: [0.2, -0.24], vt: [-0.05, -0.22], bk: [-0.12, -0.6], mb: [0.1, -0.46],
  wl: [-0.2, -0.28], wt: [-0.42, -0.3], tt: [-0.58, -0.2], tb: [-0.5, -0.12],
} as const;
type PKey = keyof typeof P;
const HEAD = new Set<PKey>(['ht', 'hf', 'hb', 'bt', 'bp', 'bb', 'ch']);
/** Triangles, how bright each facet is, and whether it's the neck (the magenta sheen). */
const FACETS: ReadonlyArray<readonly [PKey, PKey, PKey, number, boolean]> = [
  ['tt', 'wt', 'wl', 0.2, false],
  ['wl', 'tt', 'tb', 0.12, false],
  ['wl', 'tb', 'vt', 0.25, false],
  ['bk', 'wl', 'wt', 0.3, false],
  ['bk', 'vt', 'wl', 0.38, false],
  ['nb', 'mb', 'bk', 0.5, false],
  ['bk', 'mb', 'vt', 0.42, false],
  ['mb', 'cs', 'bl', 0.62, false],
  ['mb', 'bl', 'vt', 0.45, false],
  ['nb', 'nf', 'mb', 0.55, true],
  ['nf', 'cs', 'mb', 0.5, true],
  ['hb', 'ch', 'nb', 0.6, true],
  ['ch', 'nf', 'nb', 0.7, true],
  ['ht', 'hf', 'hb', 0.75, false],
  ['hf', 'ch', 'hb', 0.55, false],
  ['hf', 'bt', 'ch', 0.65, false],
  ['bt', 'bp', 'bb', 0.9, false],
];

function wirePigeon(g: CanvasRenderingContext2D, x: number, y: number, size: number, facing: 1 | -1, bob: number, flicker: number) {
  const at = (k: PKey): [number, number] => {
    const [px, py] = P[k];
    const hx = HEAD.has(k) ? bob * 0.07 : 0;
    const hy = HEAD.has(k) ? bob * 0.03 : 0;
    return [x + (px + hx) * size * facing, y + (py + hy) * size];
  };
  const edges = new Path2D();
  const sheen = new Path2D();
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [a, b, c, light, neck] of FACETS) {
    const tri = poly([at(a), at(b), at(c)]);
    g.fillStyle = rgba(neck ? N.magenta : N.cyan, (0.05 + light * 0.22) * flicker);
    g.fill(tri);
    (neck ? sheen : edges).addPath(tri);
  }
  g.restore();
  const w = Math.max(0.8, size * 0.008);
  g.globalAlpha = 0.85 * flicker;
  neon(g, edges, N.cyan, w, 0.7);
  neon(g, sheen, N.magenta, w, 0.7);
  const legs = new Path2D();
  for (const lx of [0.04, 0.15]) {
    legs.moveTo(x + lx * size * facing, y - 0.24 * size);
    legs.lineTo(x + (lx - 0.02) * size * facing, y);
  }
  neon(g, legs, N.cyan, w * 1.2, 0.5);
  g.globalAlpha = 1;
  // Eye
  pool(g, x + (0.23 + bob * 0.07) * size * facing, y + (-0.91 + bob * 0.03) * size, size * 0.05, size * 0.05, N.yellow, 0.9 * flicker);
}

/** The pixel pigeon, facing left (as in the logo); rows 0 to 4 are its head. */
const SPRITE = [
  '...kkkk...........',
  '..khhhhk..........',
  '.bkehhhhk.........',
  '..khhhhhk.........',
  '...khnnk..........',
  '...knnppk.........',
  '..knpppngkkk......',
  '.kgnpngggggkkk....',
  '.kggggggggdggkk...',
  '.klggggggdggddgk..',
  '.kllgggggddgdddgkk',
  '..kllgggggggddddkk',
  '...kllllggggkkkkk.',
  '....kkkkkkkk......',
  '......f...f.......',
  '.....ff..ff.......',
];
/** How bright each kind of pixel is in the hologram. */
const SPRITE_LIGHT: Record<string, number> = { k: 1, h: 0.45, l: 0.6, g: 0.35, d: 0.18, b: 0.8, e: 1, f: 0.5, n: 0.7, p: 0.7 };

function holoPixelPigeon(g: CanvasRenderingContext2D, x: number, y: number, size: number, facing: 1 | -1, bob: number, flicker: number) {
  const px = Math.max(2, Math.round(size / 18));
  const left = Math.round(x - (SPRITE[0].length * px) / 2);
  const top = Math.round(y - SPRITE.length * px);
  const headShift = Math.round(bob * 1.5);
  g.save();
  g.globalCompositeOperation = 'lighter';
  SPRITE.forEach((row, ry) => {
    const shift = ry <= 4 ? headShift : 0;
    for (let cx = 0; cx < row.length; cx++) {
      const ch = row[cx];
      if (ch === '.') continue;
      const col = facing === -1 ? cx - shift : row.length - 1 - cx + shift;
      const color = ch === 'e' ? N.yellow : ch === 'k' || ch === 'n' || ch === 'p' ? N.cyan : N.magenta;
      g.fillStyle = rgba(color, SPRITE_LIGHT[ch] * flicker);
      // Scanline gaps: each pixel is drawn a little short
      g.fillRect(left + col * px, top + ry * px, px - 0.5, Math.max(1, px * 0.7));
    }
  });
  g.restore();
}

function holo(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const dt = frameTime(memory, t);
  g.fillStyle = '#05050a';
  g.fillRect(r.x, r.y, r.w, r.h);
  const floorY = r.y + r.h * 0.84;
  const cx = r.x + r.w / 2;
  // Behind: the spectrum as faint panels of light
  const n = 32;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const lv = eased(memory, `hp${i}`, level(bands, u0, u0 + 1 / n), 0.6, 0.15);
    const h = lv * (floorY - r.y) * 0.9;
    const grad = g.createLinearGradient(0, floorY - h, 0, floorY);
    grad.addColorStop(0, rgba(freqColor(u0), 0.22));
    grad.addColorStop(1, rgba(freqColor(u0), 0.02));
    g.fillStyle = grad;
    g.fillRect(r.x + (i / n) * r.w + 2, floorY - h, r.w / n - 4, h);
  }
  // Floor grid, moving toward us
  g.strokeStyle = rgba(N.purple, 0.35);
  g.lineWidth = 1;
  g.beginPath();
  for (let k = -12; k <= 12; k++) {
    g.moveTo(cx + k * r.w * 0.04, floorY);
    g.lineTo(cx + k * r.w * 0.14, r.y + r.h);
  }
  const scroll = (t * 0.8) % 1;
  for (let j = 0; j < 6; j++) {
    const y = floorY + ((j + scroll) / 6) ** 2 * (r.y + r.h - floorY);
    g.moveTo(r.x, y);
    g.lineTo(r.x + r.w, y);
  }
  g.stroke();
  neon(g, poly([[r.x, floorY], [r.x + r.w, floorY]], false), N.magenta, 1, 0.8);
  // The two projections
  const size = Math.min(r.h * 0.55, r.w * 0.22);
  const fs = fontPx(r);
  const units: ReadonlyArray<readonly [number, 1 | -1, number, number, string]> = [
    [0.3, 1, 0, 0.35, 'PGN-01'],
    [0.7, -1, 0.3, 1, 'PGN-02'],
  ];
  units.forEach(([u, facing, from, to, name], i) => {
    // A head bob on each push of its part of the sound, easing back
    const lv = level(bands, from, to);
    const prev = (memory[`lv${i}`] as number | undefined) ?? lv;
    memory[`lv${i}`] = lv;
    let bob = (memory[`bob${i}`] as number | undefined) ?? 0;
    if (lv - prev > 0.05) bob = 1;
    bob *= Math.exp(-dt * 7);
    memory[`bob${i}`] = bob;
    const x = r.x + u * r.w;
    // Projector pad and its beam
    const padRx = size * 0.42;
    const padRy = size * 0.08;
    const beam = g.createLinearGradient(0, floorY, 0, floorY - size * 1.2);
    beam.addColorStop(0, rgba(N.cyan, 0.16 + lv * 0.2));
    beam.addColorStop(1, rgba(N.cyan, 0));
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = beam;
    g.fill(poly([[x - padRx, floorY], [x - padRx * 1.3, floorY - size * 1.2], [x + padRx * 1.3, floorY - size * 1.2], [x + padRx, floorY]]));
    g.restore();
    const pad = new Path2D();
    pad.ellipse(x, floorY, padRx, padRy, 0, 0, Math.PI * 2);
    neon(g, pad, N.cyan, 1.5, 0.8 + lv);
    const ring = new Path2D();
    ring.ellipse(x, floorY, padRx * (1.1 + lv * 0.5), padRy * (1.1 + lv * 0.5), 0, 0, Math.PI * 2);
    g.globalAlpha = 0.5 * (1 - lv * 0.5);
    neon(g, ring, N.magenta, 1, 0.6);
    g.globalAlpha = 1;
    // The hologram: flickering, torn sideways on the beat
    const flicker = Math.max(0.2, 0.7 + 0.3 * rand(Math.floor(t * 24), i) - (rand(Math.floor(t * 6), i, 3) > 0.94 ? 0.4 : 0));
    const jitter = bob > 0.6 ? (rand(Math.floor(t * 30), i, 5) - 0.5) * size * 0.08 : 0;
    const feetY = floorY - padRy * 0.3;
    if (i === 0) wirePigeon(g, x + jitter, feetY, size, facing, bob, flicker);
    else holoPixelPigeon(g, x + jitter, feetY, size, facing, bob, flicker);
    // A tag with its level
    g.font = `${Math.round(fs * 0.85)}px ${MONO}`;
    const out = -facing;
    const tx = x + out * size * 0.5;
    const ty = floorY - size * 1.05;
    g.strokeStyle = rgba(N.cyan, 0.5);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + out * size * 0.15, floorY - size * 0.8);
    g.lineTo(tx, ty);
    g.lineTo(tx + out * fs * 6, ty);
    g.stroke();
    g.fillStyle = rgba(N.cyan, 0.9);
    g.textAlign = out === 1 ? 'left' : 'right';
    g.fillText(`${name} ${String(Math.round(lv * 100)).padStart(3, '0')}%`, tx, ty - fs * 0.4);
    g.textAlign = 'start';
  });
  overlay(g, r, bands, t, memory, 'HOLO.PROJ');
}

/** Draw `bands` (0 to 1, lows first) in `skin` into `rect`. */
export function drawSpectrum(g: CanvasRenderingContext2D, skin: SkinId, rect: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory): void {
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  switch (skin) {
    case 'bars':
      bars(g, rect, bands, t, memory);
      break;
    case 'city':
      city(g, rect, bands, t, memory);
      break;
    case 'terrain':
      terrain(g, rect, bands, t, memory);
      break;
    case 'hud':
      hud(g, rect, bands, t, memory);
      break;
    case 'rain':
      rain(g, rect, bands, t, memory);
      break;
    case 'holo':
      holo(g, rect, bands, t, memory);
      break;
  }
  g.restore();
}

/**
 * Bands (0 to 1, `count` of them, log-spaced 30 Hz to 16 kHz) from an analyser's dB-per-bin
 * reading, with a gentle tilt so the highs (quieter in music) still move, rising fast and falling slowly.
 */
export function bandsFromBins(db: Float32Array, bins: number, sampleRate: number, out: Float32Array): Float32Array {
  const count = out.length;
  const nyquist = sampleRate / 2;
  for (let b = 0; b < count; b++) {
    const lo = Math.max(1, Math.floor(((30 * (16000 / 30) ** (b / count)) / nyquist) * bins));
    const hi = Math.max(lo + 1, Math.floor(((30 * (16000 / 30) ** ((b + 1) / count)) / nyquist) * bins));
    let peak = -Infinity;
    for (let k = lo; k < Math.min(hi, bins); k++) peak = Math.max(peak, db[k]);
    const level = Math.max(0, Math.min(1, (peak + 3 * Math.log2((b + 1) / 8) + 85) / 62));
    out[b] = level > out[b] ? level : out[b] * 0.82 + level * 0.18;
  }
  return out;
}
