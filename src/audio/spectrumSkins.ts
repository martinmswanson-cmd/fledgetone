/**
 * Spectrum readouts with character: the sound's frequency bands (0 to 1 each, lows first) drawn
 * as LED bars, or as little creatures that move with the music. The same drawings are used live
 * (the visualizer in the Mixer tab) and in the MP4 video export, so a video looks like the app.
 *
 * They're drawn in the app's own look: a dark screen with a faint dot grid, the four accent
 * colours (purple, cyan, green, amber: lows to highs wherever a colour stands for a frequency),
 * glowing line work, and LED segments where something is a meter.
 *
 * Each skin draws into a rectangle of a 2D canvas, given the bands, the time in seconds and a
 * `memory` object it may keep things in between frames (a blink, a falling peak, a ripple).
 */

export type SkinId = 'bars' | 'crew' | 'mochi' | 'cat' | 'frog' | 'birds';

export const SPECTRUM_SKINS: ReadonlyArray<{ id: SkinId; name: string; blurb: string }> = [
  { id: 'bars', name: 'LED bars', blurb: 'Classic LED bars with falling peaks, lows on the left' },
  { id: 'crew', name: 'Gomo-Fu crew', blurb: 'A row of Bo and Slate: the louder their part of the sound, the taller they stand, and the meter round their middle lights up' },
  { id: 'mochi', name: 'Mochi Bo', blurb: 'One big Bo with the spectrum glowing round his head; he squashes on the bass' },
  { id: 'cat', name: 'Cat', blurb: 'Ear meters light on the highs, whiskers trace the spectrum, paws tap on the beat' },
  { id: 'frog', name: 'Frog', blurb: 'Sits on a lily pad ringed by the spectrum; throat puffs on the bass, fireflies on the highs' },
  { id: 'birds', name: 'Two pigeons', blurb: 'The workshop pigeons on a bar of light, bobbing their heads to the beat' },
];

export const isSkin = (v: unknown): v is SkinId => SPECTRUM_SKINS.some((s) => s.id === v);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SkinMemory = Record<string, unknown>;

/** The app's colours (tailwind.config.js). */
const C = {
  ink: '#0c0c0e',
  panel: '#1a1a1e',
  panelLight: '#222228',
  border: '#2a2a30',
  borderLight: '#3a3a44',
  text: '#e4e4e7',
  muted: '#9ca3af',
  cyan: '#06b6d4',
  green: '#10b981',
  amber: '#f59e0b',
  purple: '#a855f7',
  red: '#ef4444',
  pink: '#f472b6',
};
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// ---------- helpers ----------

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (h: string, a: number) => `rgba(${rgb(h).join(',')},${a})`;
function mix(a: string, b: string, f: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

const FREQ = [C.purple, C.cyan, C.green, C.amber];
/** The colour standing for a frequency (0 lows to 1 highs). */
function freqColor(u: number): string {
  const x = Math.max(0, Math.min(1, u)) * (FREQ.length - 1);
  const i = Math.min(FREQ.length - 2, Math.floor(x));
  return mix(FREQ[i], FREQ[i + 1], x - i);
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

/** Seconds since the last frame (0 on the first), for things that decay in time. */
function frameTime(memory: SkinMemory, t: number): number {
  const last = memory.lastT as number | undefined;
  memory.lastT = t;
  return last === undefined ? 0 : Math.max(0, Math.min(0.1, t - last));
}

/** A blink now and then, different for each `seed`. */
const blinking = (t: number, seed: number) => (t * 0.55 + seed * 0.37) % 4.3 < 0.13;

function ell(x: number, y: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
  return p;
}

function poly(points: ReadonlyArray<readonly [number, number]>, close = true): Path2D {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  if (close) p.closePath();
  return p;
}

function fill(g: CanvasRenderingContext2D, p: Path2D, color: string | CanvasGradient, alpha = 1) {
  const a = g.globalAlpha;
  g.globalAlpha = a * alpha;
  g.fillStyle = color;
  g.fill(p);
  g.globalAlpha = a;
}

/** A glowing line: a wide faint stroke, a narrower brighter one, then the line itself. */
function neon(g: CanvasRenderingContext2D, p: Path2D, color: string, w: number, glow = 1) {
  const a = g.globalAlpha;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  if (glow > 0) {
    g.globalAlpha = a * 0.1 * glow;
    g.lineWidth = w * 5;
    g.stroke(p);
    g.globalAlpha = a * 0.25 * glow;
    g.lineWidth = w * 2.4;
    g.stroke(p);
  }
  g.globalAlpha = a;
  g.lineWidth = w;
  g.stroke(p);
}

/** A soft pool of light. */
function pool(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, alpha: number) {
  if (alpha <= 0.01 || rx <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(1, Math.max(0.01, ry / rx));
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba(color, Math.min(1, alpha)));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

/** The screen behind: a faint dot grid. */
function dotGrid(g: CanvasRenderingContext2D, r: Rect) {
  const step = Math.max(14, Math.min(r.w, r.h) / 12);
  const s = Math.max(1, step * 0.07);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let y = r.y + step / 2; y < r.y + r.h; y += step) for (let x = r.x + step / 2; x < r.x + r.w; x += step) g.fillRect(x - s / 2, y - s / 2, s, s);
}

/** A row of LED dots along the floor, each lit by its part of the spectrum. */
function floorStrip(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, bands: ArrayLike<number>, dot: number) {
  const n = Math.max(8, Math.floor((x1 - x0) / (dot * 2.4)));
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const lv = level(bands, u - 0.5 / n, u + 0.5 / n);
    const x = x0 + u * (x1 - x0);
    const color = freqColor(u);
    if (lv > 0.45) pool(g, x, y, dot * 2.2, dot * 2.2, color, (lv - 0.45) * 0.8);
    g.globalAlpha = 0.15 + lv * 0.85;
    g.fillStyle = color;
    g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    g.globalAlpha = 1;
  }
}

/** A pair of eyes: whites, dark pupils with a highlight (a glowing line when blinking). */
function eyes(g: CanvasRenderingContext2D, cx: number, cy: number, spread: number, r: number, look: { x: number; y: number }, blink: boolean, w: number, ring: string | null, lid: string) {
  for (const sx of [-1, 1]) {
    const ex = cx + sx * spread;
    if (blink) {
      neon(g, poly([[ex - r, cy], [ex + r, cy]], false), lid, w * 1.1, 0.5);
      continue;
    }
    const white = ell(ex, cy, r, r);
    fill(g, white, '#f4f4f5');
    if (ring) {
      g.lineWidth = w * 0.8;
      g.strokeStyle = ring;
      g.stroke(white);
    }
    const px = ex + look.x * r * 0.35;
    const py = cy + look.y * r * 0.35;
    fill(g, ell(px, py, r * 0.52, r * 0.52), C.ink);
    fill(g, ell(px - r * 0.2, py - r * 0.22, r * 0.15, r * 0.15), '#ffffff');
  }
}

/**
 * The band round a Gomo-Fu body as a meter: the whole band dim, the lit part solid and glowing,
 * with fine ticks between segments. `lit(index)` says whether segment `index` (left to right) is on.
 */
function bandMeter(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, width: number, segs: number, on: string, off: string, lit: (index: number) => boolean) {
  const a0 = 0.06 * Math.PI;
  const a1 = 0.94 * Math.PI;
  const arc = (from: number, to: number) => {
    const p = new Path2D();
    p.ellipse(cx, cy, rx, ry, 0, from, to);
    return p;
  };
  g.lineCap = 'butt';
  g.lineWidth = width;
  g.strokeStyle = off;
  g.stroke(arc(a0, a1));
  for (let s = 0; s < segs; s++) {
    const index = segs - 1 - s; // the arc runs right to left
    if (!lit(index)) continue;
    const seg = arc(a0 + ((a1 - a0) * s) / segs, a0 + ((a1 - a0) * (s + 1)) / segs);
    g.globalAlpha = 0.3;
    g.lineWidth = width * 1.8;
    g.strokeStyle = on;
    g.stroke(seg);
    g.globalAlpha = 1;
    g.lineWidth = width;
    g.stroke(seg);
  }
  // Ticks between segments
  g.strokeStyle = 'rgba(12,12,14,0.35)';
  g.lineWidth = Math.max(0.75, width * 0.08);
  for (let s = 1; s < segs; s++) {
    const a = a0 + ((a1 - a0) * s) / segs;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const nx = Math.cos(a) * ry;
    const ny = Math.sin(a) * rx;
    const nl = Math.hypot(nx, ny) || 1;
    g.beginPath();
    g.moveTo(x - (nx / nl) * width * 0.5, y - (ny / nl) * width * 0.5);
    g.lineTo(x + (nx / nl) * width * 0.5, y + (ny / nl) * width * 0.5);
    g.stroke();
  }
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
  const n = bands.length;
  const labelH = Math.max(10, Math.min(16, r.h * 0.07));
  const top = r.y + 2;
  const bottom = r.y + r.h - labelH - 4;
  const col = r.w / n;
  const gap = Math.max(1, col * 0.2);
  const segH = Math.max(2, Math.min(7, (bottom - top) / 36));
  const segGap = Math.max(1, segH * 0.45);
  const rows = Math.max(4, Math.floor((bottom - top) / (segH + segGap)));
  const peaks = ((memory.peaks as number[] | undefined) ??= []);
  for (let b = 0; b < n; b++) {
    const lit = bands[b] * rows;
    const x = r.x + b * col + gap / 2;
    const bw = col - gap;
    for (let s = 0; s < rows; s++) {
      const y = bottom - (s + 1) * (segH + segGap) + segGap;
      const frac = s / rows;
      if (s < lit) {
        g.fillStyle = frac < 0.62 ? C.green : frac < 0.86 ? C.amber : C.red;
        g.globalAlpha = s + 1 > lit ? 0.45 + 0.55 * (lit - s) : 1;
      } else {
        g.fillStyle = C.panelLight;
        g.globalAlpha = 1;
      }
      g.fillRect(x, y, bw, segH);
    }
    g.globalAlpha = 1;
    // The top of each column glows a little
    if (lit >= 1) pool(g, x + bw / 2, bottom - lit * (segH + segGap), bw * 1.4, segH * 2.5, lit / rows < 0.62 ? C.green : lit / rows < 0.86 ? C.amber : C.red, 0.35);
    // Peak hold: a cyan segment that falls slowly
    const peak = Math.max(lit, (peaks[b] ?? 0) - dt * rows * 0.35);
    peaks[b] = peak;
    if (peak >= 1) {
      const s = Math.min(rows - 1, Math.floor(peak));
      const y = bottom - (s + 1) * (segH + segGap) + segGap;
      g.fillStyle = C.cyan;
      g.fillRect(x, y, bw, segH);
    }
  }
  // Frequency labels
  g.font = `${Math.round(labelH * 0.8)}px ${MONO}`;
  g.textBaseline = 'bottom';
  g.textAlign = 'center';
  g.fillStyle = C.muted;
  for (const [hz, label] of FREQ_LABELS) {
    const x = r.x + freqX(hz) * r.w;
    g.fillRect(x - 0.5, bottom + 2, 1, 3);
    g.fillText(label, x, r.y + r.h);
  }
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
}

// ---------- Gomo-Fu crew ----------

const BO = { top: '#f4f4f5', bottom: '#b4b6c2', edge: C.cyan, glow: 0.6, band: C.cyan, off: '#8fa3b8', legs: '#d4d4d8', ring: C.ink as string | null, lid: C.ink };
const SLATE = { top: '#3b3448', bottom: '#1d1925', edge: C.purple, glow: 0.9, band: C.amber, off: '#5a4a3a', legs: '#8b6cd8', ring: null, lid: C.text };

/** One Gomo-Fu guy standing on the ground at `fx`, legs as long as `legLen`, with a meter round his middle. */
function guy(g: CanvasRenderingContext2D, fx: number, ground: number, size: number, legLen: number, S: typeof BO, squash: number, look: { x: number; y: number }, blink: boolean, lv: number) {
  const w = Math.max(1.2, size * 0.035);
  const rx = (size / 2) * (1 + squash * 0.12);
  const ry = size * 0.33 * (1 - squash * 0.12);
  const hipY = ground - legLen;
  const cy = hipY - ry * 0.45;
  pool(g, fx, ground, size * 0.6, size * 0.12, S.band, 0.1 + lv * 0.5);
  // Legs and feet
  for (const sx of [-1, 1]) {
    const hx = fx + sx * rx * 0.34;
    const kneeOut = Math.max(0, size * 0.42 - legLen) * 0.35;
    const leg = poly([[hx, hipY], [hx + sx * kneeOut, hipY + legLen / 2], [hx, ground - size * 0.05]], false);
    neon(g, leg, S.legs, size * 0.09, S === SLATE ? 0.5 : 0);
    const foot = ell(hx + sx * size * 0.03, ground - size * 0.04, size * 0.11, size * 0.055);
    fill(g, foot, C.ink);
    neon(g, foot, S.edge, w * 0.6, 0);
  }
  // Body
  const body = ell(fx, cy, rx, ry);
  const shade = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  shade.addColorStop(0, S.top);
  shade.addColorStop(1, S.bottom);
  fill(g, body, shade);
  g.save();
  g.clip(body);
  // The band round his middle is a meter: it lights from left to right with his part of the sound
  const segs = 7;
  bandMeter(g, fx, cy + ry * 0.05, rx * 1.02, ry * 0.62, ry * 0.24, segs, S.band, S.off, (i) => i < lv * segs * 1.15);
  // A shine on top
  fill(g, ell(fx - rx * 0.32, cy - ry * 0.52, rx * 0.3, ry * 0.15, -0.25), '#ffffff', S === BO ? 0.7 : 0.1);
  g.restore();
  neon(g, body, S.edge, w, S.glow);
  eyes(g, fx, cy - ry * 0.12, rx * 0.3, rx * 0.2, look, blink, w, S.ring, S.lid);
}

function crew(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  dotGrid(g, r);
  const count = Math.max(4, Math.min(12, Math.round(r.w / 95)));
  const slot = r.w / count;
  const size = Math.min(slot * 0.8, r.h * 0.42);
  const ground = r.y + r.h - size * 0.24;
  g.fillStyle = C.borderLight;
  g.fillRect(r.x, ground, r.w, 1);
  floorStrip(g, r.x + slot * 0.25, r.x + r.w - slot * 0.25, ground + size * 0.13, bands, Math.max(2, size * 0.045));
  const reach = Math.max(0, ground - r.y - size * 0.8);
  for (let i = 0; i < count; i++) {
    const lv = eased(memory, `crew${i}`, level(bands, i / count, (i + 1) / count));
    const jump = eased(memory, `crewv${i}`, lv, 0.9, 0.08);
    const squash = Math.max(-1, Math.min(1, (jump - lv) * 6));
    const legLen = size * 0.16 + lv * Math.min(size * 1.1, reach);
    const look = { x: Math.sin(t * 0.8 + i) * 0.6, y: -lv * 0.8 };
    const S = i % 2 ? SLATE : BO;
    const fx = r.x + slot * (i + 0.5);
    // Peak marker: a little diamond that floats at the highest he's stood, then sinks
    const peak = eased(memory, `crewp${i}`, lv, 1, 0.025);
    const peakY = ground - (size * 0.16 + peak * Math.min(size * 1.1, reach)) - size * 0.52 - size * 0.1;
    const d = size * 0.055;
    const diamond = poly([[fx, peakY - d], [fx + d, peakY], [fx, peakY + d], [fx - d, peakY]]);
    pool(g, fx, peakY, d * 3, d * 3, S.band, 0.35);
    fill(g, diamond, S.band);
    guy(g, fx, ground, size, legLen, S, squash, look, blinking(t, i), lv);
  }
}

// ---------- Mochi Bo ----------

function mochi(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  dotGrid(g, r);
  const bass = eased(memory, 'bass', level(bands, 0, 0.18));
  const highs = eased(memory, 'highs', level(bands, 0.6, 1));
  const loud = eased(memory, 'loud', level(bands, 0, 1), 0.5, 0.1);
  const size = Math.min(r.w * 0.5, r.h * 0.95);
  const cx = r.x + r.w / 2;
  const ground = r.y + r.h - size * 0.16;
  const rx = (size / 2) * (1 + bass * 0.14);
  const ry = size * 0.33 * (1 - bass * 0.1);
  const cy = ground - size * 0.05 - ry;
  const w = Math.max(1.5, size * 0.022);
  // Floor: a pool of light that swells on the bass, and the LED strip
  pool(g, cx, ground, size * 0.75, size * 0.1, C.cyan, 0.15 + bass * 0.45);
  floorStrip(g, r.x + r.w * 0.12, r.x + r.w * 0.88, ground + size * 0.1, bands, Math.max(2, size * 0.025));
  for (const sx of [-1, 1]) {
    fill(g, ell(cx + sx * rx * 0.45, ground - size * 0.03, size * 0.1, size * 0.045), '#2e3440');
  }
  // The spectrum round his head: lows at the sides, highs on his crown
  const points = 96;
  const raw: number[] = [];
  for (let k = 0; k < points; k++) {
    const up = -Math.sin((k / points) * Math.PI * 2);
    raw.push(up > 0 ? eased(memory, `m${k}`, level(bands, up * 0.94, up * 0.94 + 0.06), 0.6, 0.2) * Math.min(1, up * 3) : 0);
  }
  const lift = raw.slice();
  for (let pass = 0; pass < 3; pass++) {
    const prev = lift.slice();
    for (let k = 0; k < points; k++) lift[k] = (prev[(k + points - 1) % points] + prev[k] * 2 + prev[(k + 1) % points]) / 4;
  }
  const outline = lift.map((lv, k) => {
    const a = (k / points) * Math.PI * 2;
    const wobble = 1 + lv * 0.07 + Math.sin(t * 3 + k * 0.5) * 0.004;
    return { x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble };
  });
  for (let k = 1; k < points; k += 2) {
    const a = (k / points) * Math.PI * 2;
    const up = -Math.sin(a);
    if (up < 0.1) continue;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const o = outline[k];
    const start = size * 0.06;
    const len = size * 0.015 + raw[k] * size * 0.26;
    const tick = poly([[o.x + dx * start, o.y + dy * start], [o.x + dx * (start + len), o.y + dy * (start + len)]], false);
    neon(g, tick, freqColor(up * 0.94 + 0.03), Math.max(2, size * 0.03), 0.3 + raw[k] * 0.7);
  }
  // Body
  const body = new Path2D();
  const mid = (i: number) => {
    const p = outline[i % points];
    const q = outline[(i + 1) % points];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  };
  const start = mid(points - 1);
  body.moveTo(start.x, start.y);
  for (let k = 0; k < points; k++) {
    const m = mid(k);
    body.quadraticCurveTo(outline[k].x, outline[k].y, m.x, m.y);
  }
  body.closePath();
  const shade = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  shade.addColorStop(0, '#f4f4f5');
  shade.addColorStop(1, '#aeb0bd');
  fill(g, body, shade);
  g.save();
  g.clip(body);
  // His band is a meter that lights from the middle out with the loudness
  const segs = 13;
  bandMeter(g, cx, cy + ry * 0.08, rx * 1.02, ry * 0.6, ry * 0.22, segs, C.cyan, '#8fa3b8', (i) => Math.abs(i - (segs - 1) / 2) / (segs / 2) < loud * 1.5);
  fill(g, ell(cx - rx * 0.35, cy - ry * 0.55, rx * 0.28, ry * 0.13, -0.2), '#ffffff', 0.75);
  g.restore();
  neon(g, body, C.cyan, w, 0.8);
  // Eyes widen on the highs; he blushes when it's loud
  const er = rx * (0.15 + highs * 0.05);
  eyes(g, cx, cy - ry * 0.15, rx * 0.3, er, { x: Math.sin(t * 0.6) * 0.5, y: -0.2 - highs * 0.5 }, blinking(t, 1), w, C.ink, C.ink);
  for (const sx of [-1, 1]) pool(g, cx + sx * rx * 0.55, cy + ry * 0.12, rx * 0.16, ry * 0.1, C.pink, Math.min(0.8, loud * 1.2));
}

// ---------- Cat ----------

function cat(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  dotGrid(g, r);
  const bass = eased(memory, 'bass', level(bands, 0, 0.15), 0.7, 0.2);
  const mids = eased(memory, 'mids', level(bands, 0.2, 0.6));
  const highs = eased(memory, 'highs', level(bands, 0.65, 1));
  const size = Math.min(r.w * 0.44, r.h * 0.72);
  const cx = r.x + r.w / 2;
  const ground = r.y + r.h - size * 0.12;
  const R = size * 0.38;
  const cy = ground - R * 1.15;
  const w = Math.max(1.5, size * 0.018);
  const fur = C.amber;
  g.fillStyle = C.borderLight;
  g.fillRect(r.x, ground, r.w, 1);
  floorStrip(g, r.x + r.w * 0.08, r.x + r.w * 0.92, ground + size * 0.07, bands, Math.max(2, size * 0.022));
  pool(g, cx, ground, size * 0.6, size * 0.08, fur, 0.12 + bass * 0.3);
  // Ears, each an LED meter of the highs
  for (const sx of [-1, 1]) {
    const tip = R * (1 + highs * 0.35);
    const twitch = Math.sin(t * 9 + sx) * highs * 0.05;
    const base1: [number, number] = [cx + sx * R * 0.22, cy - R * 0.72];
    const base2: [number, number] = [cx + sx * R * 0.95, cy - R * 0.25];
    const apex: [number, number] = [cx + sx * R * (0.78 + twitch), cy - R * 0.4 - tip];
    const ear = poly([base1, apex, base2]);
    fill(g, ear, C.panel);
    g.save();
    g.clip(ear);
    const rows = 6;
    const lit = Math.min(1, highs * 1.6) * rows;
    for (let s = 0; s < rows; s++) {
      const f0 = s / rows;
      const y = (base1[1] + base2[1]) / 2 + (apex[1] - (base1[1] + base2[1]) / 2) * (f0 + 0.1);
      const h = Math.abs(apex[1] - (base1[1] + base2[1]) / 2) / rows;
      g.fillStyle = s < lit ? C.pink : C.panelLight;
      g.globalAlpha = s < lit ? 0.9 : 1;
      g.fillRect(cx - R * 1.2, y - h * 0.7, R * 2.4, h * 0.55);
    }
    g.globalAlpha = 1;
    g.restore();
    neon(g, ear, fur, w, 0.8);
  }
  // Head
  const head = ell(cx, cy, R * 1.05, R * 0.9);
  const shade = g.createLinearGradient(0, cy - R, 0, cy + R);
  shade.addColorStop(0, '#2a2530');
  shade.addColorStop(1, C.panel);
  fill(g, head, shade);
  g.save();
  g.clip(head);
  for (const dx of [-0.22, 0, 0.22]) neon(g, poly([[cx + dx * R, cy - R * 0.92], [cx + dx * R, cy - R * 0.68]], false), fur, w * 1.1, 0.3);
  fill(g, ell(cx, cy + R * 0.36, R * 0.5, R * 0.34), '#3a3340', 0.9);
  g.restore();
  neon(g, head, fur, w, 0.8);
  // Eyes: green, narrow when it's quiet, round when the mids are busy
  const open = 0.3 + Math.min(1, mids * 1.6) * 0.7;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * R * 0.4;
    const ey = cy - R * 0.08;
    if (blinking(t, 3)) {
      const lid = new Path2D();
      lid.arc(ex, ey - R * 0.05, R * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
      neon(g, lid, C.green, w, 0.6);
      continue;
    }
    const eye = ell(ex, ey, R * 0.16, R * 0.17 * open);
    pool(g, ex, ey, R * 0.32, R * 0.32 * open, C.green, 0.35);
    fill(g, eye, C.green);
    fill(g, ell(ex + Math.sin(t * 0.7) * R * 0.03, ey, R * 0.045, R * 0.14 * open), C.ink);
    fill(g, ell(ex - R * 0.06, ey - R * 0.06 * open, R * 0.035, R * 0.035), '#ffffff');
  }
  // Nose, and a mouth that opens on the bass
  fill(g, poly([[cx - R * 0.08, cy + R * 0.2], [cx + R * 0.08, cy + R * 0.2], [cx, cy + R * 0.29]]), C.pink);
  const mouth = bass * R * 0.24;
  if (mouth > R * 0.05) {
    const m = ell(cx, cy + R * 0.43, R * 0.13, mouth);
    fill(g, m, '#2a0a12');
    fill(g, ell(cx, cy + R * 0.43 + mouth * 0.5, R * 0.08, mouth * 0.35), C.pink, 0.9);
    neon(g, m, C.red, w * 0.7, 0.6);
  } else {
    const smile = new Path2D();
    smile.arc(cx - R * 0.08, cy + R * 0.3, R * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
    smile.moveTo(cx + R * 0.08 + R * 0.08 * Math.cos(0.1 * Math.PI), cy + R * 0.3 + R * 0.08 * Math.sin(0.1 * Math.PI));
    smile.arc(cx + R * 0.08, cy + R * 0.3, R * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
    neon(g, smile, fur, w * 0.8, 0.3);
  }
  // Whiskers: each one a trace of its slice of the spectrum
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const i = sx < 0 ? k : 5 - k;
      const x0 = cx + sx * R * 0.42;
      const y0 = cy + R * 0.32 + (k - 1) * R * 0.09;
      const len = R * 1.15;
      const ang = (k - 1) * 0.16;
      const pts: Array<[number, number]> = [];
      const steps = 24;
      for (let j = 0; j <= steps; j++) {
        const f = j / steps;
        const lv = level(bands, (i + f) / 6 - 0.02, (i + f) / 6 + 0.02);
        const wig = Math.sin(f * Math.PI * 5 - t * 8 + i) * lv * R * 0.05 * f;
        pts.push([x0 + sx * Math.cos(ang) * len * f, y0 + Math.sin(ang) * len * f * 0.6 + wig]);
      }
      neon(g, poly(pts, false), C.text, w * 0.5, 0.3 + level(bands, i / 6, (i + 1) / 6) * 0.6);
    }
  }
  // Paws on the floor: the left taps on the bass, the right on the mids
  ([[-1, bass], [1, mids]] as const).forEach(([sx, lv]) => {
    const lift = Math.max(0, lv - 0.3) * R * 0.35;
    const px = cx + sx * R * 0.45;
    const paw = new Path2D();
    paw.ellipse(px, ground - lift - R * 0.02, R * 0.2, R * 0.13, 0, Math.PI, 0);
    paw.closePath();
    fill(g, paw, C.panel);
    neon(g, paw, fur, w, 0.6);
    for (const tx of [-1, 0, 1]) fill(g, ell(px + tx * R * 0.07, ground - lift - R * 0.08, R * 0.02, R * 0.03), fur, 0.8);
  });
}

// ---------- Frog ----------

function frog(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  dotGrid(g, r);
  const bass = eased(memory, 'bass', level(bands, 0, 0.15), 0.7, 0.18);
  const mids = level(bands, 0.15, 0.6);
  const highs = eased(memory, 'highs', level(bands, 0.6, 1));
  const size = Math.min(r.w * 0.4, r.h * 0.8);
  const cx = r.x + r.w / 2;
  const pondY = r.y + r.h - size * 0.32;
  const w = Math.max(1.5, size * 0.02);
  const skin = C.green;
  // Fireflies: brighter with the highs
  for (let i = 0; i < 6; i++) {
    const fx = cx + Math.sin(t * (0.3 + i * 0.07) + i * 2.1) * r.w * 0.42;
    const fy = r.y + r.h * (0.18 + 0.4 * (0.5 + 0.5 * Math.sin(t * (0.4 + i * 0.05) + i * 1.3)));
    const a = (0.15 + highs * 0.85) * (0.6 + 0.4 * Math.sin(t * 5 + i * 3));
    pool(g, fx, fy, size * 0.06, size * 0.06, C.amber, a * 0.8);
    fill(g, ell(fx, fy, Math.max(1, size * 0.008), Math.max(1, size * 0.008)), '#fde68a', a);
  }
  // Ripples: a new one on each push of the mids
  const ripples = ((memory.ripples as Array<{ born: number; strength: number }>) ??= []);
  const lastMid = (memory.lastMid as number | undefined) ?? 0;
  if (mids - lastMid > 0.08 && (!ripples.length || t - ripples[ripples.length - 1].born > 0.25)) ripples.push({ born: t, strength: mids });
  memory.lastMid = mids;
  while (ripples.length && t - ripples[0].born > 2.5) ripples.shift();
  for (const rp of ripples) {
    const age = (t - rp.born) / 2.5;
    g.globalAlpha = (1 - age) * 0.6 * (0.4 + rp.strength);
    neon(g, ell(cx, pondY, size * (0.75 + age * 1.6), size * (0.15 + age * 0.32)), C.cyan, Math.max(1, w * 0.6), 0.6);
    g.globalAlpha = 1;
  }
  // The lily pad, ringed by the spectrum: lows at the front, highs round the back
  const padRx = size * 0.72;
  const padRy = size * 0.16;
  const ticks = 72;
  for (let k = 0; k < ticks; k++) {
    const a = (k / ticks) * Math.PI * 2;
    const u = Math.abs((((a / (Math.PI * 2) - 0.25 + 1) % 1) * 2) - 1);
    const lv = eased(memory, `pad${k}`, level(bands, u * 0.96, u * 0.96 + 0.04), 0.6, 0.2);
    const dx = Math.cos(a);
    const dy = Math.sin(a) * 0.45;
    const nl = Math.hypot(dx, dy);
    const x0 = cx + Math.cos(a) * padRx * 1.04;
    const y0 = pondY + Math.sin(a) * padRy * 1.04;
    const len = size * 0.015 + lv * size * 0.22;
    neon(g, poly([[x0, y0], [x0 + (dx / nl) * len, y0 + (dy / nl) * len]], false), freqColor(u), Math.max(1.2, size * 0.012), 0.4 + lv);
  }
  const pad = new Path2D();
  pad.ellipse(cx, pondY, padRx, padRy, 0, 1.58 * Math.PI, 3.42 * Math.PI);
  pad.lineTo(cx, pondY);
  pad.closePath();
  fill(g, pad, '#0e2a20');
  neon(g, pad, skin, w * 0.8, 0.5);
  // Body
  const bodyY = pondY - size * 0.26;
  const body = ell(cx, bodyY, size * 0.4, size * 0.29);
  const shade = g.createLinearGradient(0, bodyY - size * 0.3, 0, bodyY + size * 0.3);
  shade.addColorStop(0, '#15402f');
  shade.addColorStop(1, '#0c2219');
  // Eye bumps, behind the body's outline
  const pop = highs * size * 0.12;
  for (const sx of [-1, 1]) {
    const bump = ell(cx + sx * size * 0.21, bodyY - size * 0.2 - pop * 0.5, size * 0.13, size * 0.11 + pop * 0.5);
    fill(g, bump, '#15402f');
    neon(g, bump, skin, w, 0.7);
  }
  fill(g, body, shade);
  fill(g, ell(cx, bodyY + size * 0.1, size * 0.26, size * 0.15), '#1a4d3a', 0.7);
  neon(g, body, skin, w, 0.8);
  // Throat: a glowing bubble that puffs on the bass
  const ty = bodyY + size * 0.13;
  const throat = ell(cx, ty, size * (0.07 + bass * 0.1), size * (0.045 + bass * 0.07));
  pool(g, cx, ty, size * (0.12 + bass * 0.16), size * (0.08 + bass * 0.1), C.amber, 0.1 + bass * 0.35);
  fill(g, throat, '#fde68a', 0.12 + bass * 0.3);
  neon(g, throat, '#fde68a', w * 0.5, 0.3 + bass * 0.7);
  // Eyes pop up on the highs
  for (const sx of [-1, 1]) {
    const ex = cx + sx * size * 0.21;
    const ey = bodyY - size * 0.22 - pop;
    if (blinking(t, 5)) neon(g, poly([[ex - size * 0.07, ey], [ex + size * 0.07, ey]], false), skin, w, 0.6);
    else {
      fill(g, ell(ex, ey, size * 0.075, size * 0.075), '#f4f4f5');
      fill(g, ell(ex, ey + size * 0.01, size * 0.045, size * 0.04 + highs * size * 0.02), C.ink);
      fill(g, ell(ex - size * 0.02, ey - size * 0.015, size * 0.014, size * 0.014), '#ffffff');
    }
  }
  // Smile and cheeks
  const smile = new Path2D();
  smile.arc(cx, bodyY - size * 0.12, size * 0.2, 0.25 * Math.PI, 0.75 * Math.PI);
  neon(g, smile, skin, w, 0.5);
  for (const sx of [-1, 1]) pool(g, cx + sx * size * 0.24, bodyY - size * 0.02, size * 0.06, size * 0.035, C.pink, 0.6);
  // Front feet
  for (const sx of [-1, 1]) {
    const foot = ell(cx + sx * size * 0.3, pondY - size * 0.04, size * 0.09, size * 0.035);
    fill(g, foot, '#15402f');
    neon(g, foot, skin, w * 0.8, 0.4);
  }
}

// ---------- Two pigeons ----------

/** The faceted pigeon (facing right, feet at 0,0, about 1 tall): its points, and its triangles with their shades. */
const P = {
  ht: [0.2, -1.0], hf: [0.31, -0.96], hb: [0.04, -0.93], bt: [0.36, -0.9], bp: [0.47, -0.86], bb: [0.34, -0.85], ch: [0.27, -0.8],
  nf: [0.31, -0.64], nb: [-0.03, -0.74], cs: [0.33, -0.44], bl: [0.2, -0.24], vt: [-0.05, -0.22], bk: [-0.12, -0.6], mb: [0.1, -0.46],
  wl: [-0.2, -0.28], wt: [-0.42, -0.3], tt: [-0.58, -0.2], tb: [-0.5, -0.12],
} as const;
type PKey = keyof typeof P;
const HEAD = new Set<PKey>(['ht', 'hf', 'hb', 'bt', 'bp', 'bb', 'ch']);
/** Triangles: three points and a shade ('n1'... are the neck's sheen, worked out each frame). */
const FACETS: ReadonlyArray<[PKey, PKey, PKey, string]> = [
  ['tt', 'wt', 'wl', '#4a4e5b'],
  ['wl', 'tt', 'tb', '#3c3f4a'],
  ['wl', 'tb', 'vt', '#545866'],
  ['bk', 'wl', 'wt', '#5f6473'],
  ['bk', 'vt', 'wl', '#6b7182'],
  ['nb', 'mb', 'bk', '#8a90a1'],
  ['bk', 'mb', 'vt', '#767c8d'],
  ['mb', 'cs', 'bl', '#9ca2b2'],
  ['mb', 'bl', 'vt', '#7f8596'],
  ['nb', 'nf', 'mb', 'n3'],
  ['nf', 'cs', 'mb', 'n4'],
  ['hb', 'ch', 'nb', 'n1'],
  ['ch', 'nf', 'nb', 'n2'],
  ['ht', 'hf', 'hb', '#a9aebe'],
  ['hf', 'ch', 'hb', '#8f95a6'],
  ['hf', 'bt', 'ch', '#9aa0b1'],
  ['bt', 'bp', 'bb', '#d4d6de'],
];

function polyPigeon(g: CanvasRenderingContext2D, x: number, y: number, size: number, facing: 1 | -1, bob: number, sheen: number, sing: number, blink: boolean) {
  const at = (k: PKey): [number, number] => {
    const [px, py] = P[k];
    const hx = HEAD.has(k) ? bob * 0.07 : 0;
    const hy = HEAD.has(k) ? bob * 0.03 : 0;
    return [x + (px + hx) * size * facing, y + (py + hy) * size];
  };
  const neckA = mix('#38b48a', '#9b6ad6', sheen);
  const neckB = mix('#9b6ad6', '#2fa3a0', sheen);
  const shades: Record<string, string> = { n1: neckA, n2: neckB, n3: mix(neckA, '#7d8394', 0.4), n4: mix(neckB, '#8a90a1', 0.5) };
  // Legs
  const legs = new Path2D();
  for (const lx of [0.04, 0.15]) {
    legs.moveTo(x + lx * size * facing, y - 0.24 * size);
    legs.lineTo(x + (lx - 0.02) * size * facing, y);
    legs.moveTo(x + (lx - 0.07) * size * facing, y);
    legs.lineTo(x + (lx + 0.06) * size * facing, y);
  }
  g.lineWidth = Math.max(1, size * 0.025);
  g.lineCap = 'round';
  g.strokeStyle = '#d98a95';
  g.stroke(legs);
  for (const [a, b, c, shade] of FACETS) {
    const tri = poly([at(a), at(b), at(c)]);
    const color = shades[shade] ?? shade;
    g.fillStyle = color;
    g.fill(tri);
    // Same colour stroke so the facets meet without hairline gaps
    g.lineWidth = 0.75;
    g.strokeStyle = color;
    g.lineJoin = 'round';
    g.stroke(tri);
  }
  // Wing bars
  const bars = new Path2D();
  for (const [x0, y0, x1, y1] of [[-0.06, -0.5, -0.28, -0.38], [-0.1, -0.42, -0.32, -0.31]]) {
    bars.moveTo(x + x0 * size * facing, y + y0 * size);
    bars.lineTo(x + x1 * size * facing, y + y1 * size);
  }
  g.lineWidth = Math.max(1.2, size * 0.03);
  g.strokeStyle = '#2b2d35';
  g.stroke(bars);
  // Beak opens when it sings
  if (sing > 0.3) {
    const [bx, by] = at('bb');
    const [px] = at('bp');
    fill(g, poly([[bx, by], [px, by + sing * size * 0.05], [bx - 0.03 * size * facing, by + 0.02 * size]]), '#c9ccd6');
  }
  // Eye: orange with a dark centre
  const ex = x + (0.23 + bob * 0.07) * size * facing;
  const ey = y + (-0.91 + bob * 0.03) * size;
  if (blink) neon(g, poly([[ex - size * 0.025, ey], [ex + size * 0.025, ey]], false), '#2b2d35', Math.max(1, size * 0.015), 0);
  else {
    fill(g, ell(ex, ey, size * 0.028, size * 0.028), '#f59e0b');
    fill(g, ell(ex, ey, size * 0.013, size * 0.013), C.ink);
  }
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
]
const SPRITE_COLORS: Record<string, string> = { h: '#80869a', k: '#23252d', l: '#b4b9c7', g: '#8e94a5', d: '#4b4f5c', b: '#c9ccd6', e: '#f59e0b', f: '#d98a95' };

function pixelPigeon(g: CanvasRenderingContext2D, x: number, y: number, size: number, facing: 1 | -1, bob: number, sheen: number, sing: number, blink: boolean) {
  const px = Math.max(1, Math.round(size / 16));
  const w = SPRITE[0].length * px;
  const h = SPRITE.length * px;
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h);
  const headShift = Math.round(bob * 1.5);
  const colors: Record<string, string> = { ...SPRITE_COLORS, n: mix('#38b48a', '#9b6ad6', sheen), p: mix('#9b6ad6', '#2fa3a0', sheen) };
  SPRITE.forEach((row, ry) => {
    const shift = ry <= 4 ? headShift : 0;
    for (let cx = 0; cx < row.length; cx++) {
      let ch = row[cx];
      if (ch === '.') continue;
      if (ch === 'e' && blink) ch = 'h';
      g.fillStyle = colors[ch] ?? '#ff00ff';
      // Facing left is how the sprite is drawn; facing right mirrors it
      const col = facing === -1 ? cx - shift : row.length - 1 - cx + shift;
      g.fillRect(left + col * px, top + ry * px, px, px);
    }
  });
  if (sing > 0.4) {
    g.fillStyle = SPRITE_COLORS.b;
    // Open beak: a pixel under the beak
    const col = facing === -1 ? 1 - headShift : SPRITE[0].length - 2 + headShift;
    g.fillRect(left + col * px, top + 3 * px, px, px);
  }
}

/** A pixel note, for the singing. */
const NOTE = ['..###', '..#.#', '..#..', '..#..', '###..', '###..'];

function birds(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const dt = frameTime(memory, t);
  dotGrid(g, r);
  const size = Math.min(r.h * 0.5, r.w * 0.27);
  const barH = Math.max(8, size * 0.16);
  const barY = r.y + r.h - barH - size * 0.2;
  const barX0 = r.x + r.w * 0.06;
  const barX1 = r.x + r.w * 0.94;
  // Behind them, the spectrum in chunky pixels
  const block = Math.max(4, Math.round(size * 0.075));
  const cols = Math.floor((barX1 - barX0) / block);
  const tall = Math.floor((barY - r.y - block) / block);
  for (let c = 0; c < cols; c++) {
    const u = c / cols;
    const lv = eased(memory, `px${c}`, level(bands, u, u + 1 / cols), 0.7, 0.18);
    const hgt = Math.round(lv * tall);
    for (let s = 0; s < hgt; s++) {
      g.fillStyle = s === hgt - 1 ? freqColor(u) : C.text;
      g.globalAlpha = s === hgt - 1 ? 0.8 : 0.045;
      g.fillRect(barX0 + c * block + 1, barY - (s + 1) * block, block - 2, block - 2);
    }
  }
  g.globalAlpha = 1;
  // The bar they stand on: light, with a prompt, a cursor and a little spectrum in it
  pool(g, (barX0 + barX1) / 2, barY + barH * 1.6, (barX1 - barX0) * 0.55, barH * 1.4, '#ffffff', 0.08);
  g.fillStyle = '#e4e4e7';
  g.fillRect(barX0, barY, barX1 - barX0, barH);
  g.fillStyle = C.ink;
  g.font = `700 ${Math.round(barH * 0.9)}px ${MONO}`;
  g.textBaseline = 'middle';
  g.fillText('>', barX0 + barH * 0.4, barY + barH / 2 + 1);
  const inner0 = barX0 + barH * 1.3;
  const inner1 = barX1 - barH * 1.4;
  const n = Math.max(8, Math.floor((inner1 - inner0) / Math.max(4, barH * 0.75)));
  const step = (inner1 - inner0) / n;
  for (let i = 0; i < n; i++) {
    const lv = level(bands, i / n, (i + 1) / n);
    const hh = Math.max(1, Math.round(lv * barH * 0.7));
    g.fillRect(inner0 + i * step, barY + barH * 0.85 - hh, Math.max(1, step * 0.7), hh);
  }
  if (t % 1 < 0.55) g.fillRect(inner1 + barH * 0.4, barY + barH * 0.2, barH * 0.45, barH * 0.6);
  g.textBaseline = 'alphabetic';

  // The pigeons: the faceted one on the left facing right, the pixel one on the right facing left
  const notes = ((memory.notes as Array<{ x: number; y: number; born: number; color: string }>) ??= []);
  const sheen = 0.5 + 0.5 * Math.sin(t * 1.3 + level(bands, 0.6, 1) * 4);
  ([[0.3, 1, 0, 0.35], [0.7, -1, 0.3, 1]] as const).forEach(([u, facing, from, to], i) => {
    // A head bob on each push of its part of the sound, easing back
    const lv = level(bands, from, to);
    const prev = (memory[`lv${i}`] as number | undefined) ?? lv;
    memory[`lv${i}`] = lv;
    let bob = (memory[`bob${i}`] as number | undefined) ?? 0;
    if (lv - prev > 0.05) bob = 1;
    bob *= Math.exp(-dt * 7);
    memory[`bob${i}`] = bob;
    const pace = Math.sin(t * 0.35 + i * 2) * size * 0.12;
    const x = r.x + u * r.w + pace;
    const sing = eased(memory, `sing${i}`, Math.min(1, lv * 1.6));
    pool(g, x, barY, size * 0.45, size * 0.06, '#000000', 0.5);
    if (i === 0) polyPigeon(g, x, barY, size, facing, bob, sheen, sing, blinking(t, 7));
    else pixelPigeon(g, x, barY, size, facing, bob, 1 - sheen, sing, blinking(t, 9));
    const last = (memory[`noteAt${i}`] as number | undefined) ?? -1;
    if (sing > 0.5 && t - last > 0.45) {
      notes.push({ x: x + facing * size * 0.5, y: barY - size * 1.05, born: t, color: i ? C.cyan : C.purple });
      memory[`noteAt${i}`] = t;
    }
  });
  while (notes.length && t - notes[0].born > 2) notes.shift();
  const npx = Math.max(1, Math.round(size / 28));
  for (const nt of notes) {
    const age = (t - nt.born) / 2;
    const nx = Math.round(nt.x + Math.sin(age * 8) * size * 0.08);
    const ny = Math.round(nt.y - age * r.h * 0.45);
    pool(g, nx + npx * 2.5, ny + npx * 3, npx * 6, npx * 6, nt.color, 0.4 * (1 - age));
    g.globalAlpha = 1 - age;
    g.fillStyle = nt.color;
    NOTE.forEach((row, ry) => {
      for (let cx = 0; cx < row.length; cx++) if (row[cx] === '#') g.fillRect(nx + cx * npx, ny + ry * npx, npx, npx);
    });
    g.globalAlpha = 1;
  }
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
    case 'crew':
      crew(g, rect, bands, t, memory);
      break;
    case 'mochi':
      mochi(g, rect, bands, t, memory);
      break;
    case 'cat':
      cat(g, rect, bands, t, memory);
      break;
    case 'frog':
      frog(g, rect, bands, t, memory);
      break;
    case 'birds':
      birds(g, rect, bands, t, memory);
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
