/**
 * Spectrum readouts with character: the sound's frequency bands (0 to 1 each, lows first) drawn
 * as plain bars, or as little creatures that move with the music. The same drawings are used live
 * (the visualizer in the Mixer tab) and in the MP4 video export, so a video looks like the app.
 *
 * Each skin draws into a rectangle of a 2D canvas, given the bands, the time in seconds and a
 * `memory` object it may keep things in between frames (a blink, a falling note).
 */

export type SkinId = 'bars' | 'crew' | 'mochi' | 'cat' | 'frog' | 'birds';

export const SPECTRUM_SKINS: ReadonlyArray<{ id: SkinId; name: string; blurb: string }> = [
  { id: 'bars', name: 'Bars', blurb: 'Classic bars, lows on the left' },
  { id: 'crew', name: 'Gomo-Fu crew', blurb: 'A row of Bo and Slate: the louder their part of the sound, the taller they stand' },
  { id: 'mochi', name: 'Mochi Bo', blurb: 'One big Bo who wobbles to the spectrum and squashes on the bass' },
  { id: 'cat', name: 'Cat', blurb: 'Ears perk up on the highs, whiskers twitch on the mids, mouth opens on the bass' },
  { id: 'frog', name: 'Frog', blurb: 'Throat puffs on the bass, ripples on the mids, eyes pop on the highs' },
  { id: 'birds', name: 'Two birds', blurb: 'Two birds on a wire that shakes with the sound, singing notes when it gets loud' },
];

export const isSkin = (v: unknown): v is SkinId => SPECTRUM_SKINS.some((s) => s.id === v);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SkinMemory = Record<string, unknown>;

const INK = '#2b2140';
const BO = { body: '#fffaf0', shade: '#e3d3b4', band: '#3d9ee0', legs: '#e9dcc0' };
const SLATE = { body: '#2f2546', shade: '#1b1430', band: '#ffbe3b', legs: '#6a5d92' };

/** The average of bands `from` to `to` (fractions of the range, 0 to 1). */
function level(bands: ArrayLike<number>, from: number, to: number): number {
  const n = bands.length;
  const a = Math.max(0, Math.floor(from * n));
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

/** A blink now and then, different for each `seed`. */
const blinking = (t: number, seed: number) => (t * 0.55 + seed * 0.37) % 4.3 < 0.13;

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, ink = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (ink > 0) {
    g.lineWidth = ink;
    g.strokeStyle = INK;
    g.stroke();
  }
}

/** A pair of Gomo-Fu eyes: whites with ink pupils (lines when blinking). */
function eyes(g: CanvasRenderingContext2D, cx: number, cy: number, spread: number, r: number, look: { x: number; y: number }, blink: boolean, ink: number) {
  for (const sx of [-1, 1]) {
    const ex = cx + sx * spread;
    if (blink) {
      g.beginPath();
      g.moveTo(ex - r, cy);
      g.lineTo(ex + r, cy);
      g.lineWidth = ink * 1.2;
      g.strokeStyle = INK;
      g.lineCap = 'round';
      g.stroke();
      continue;
    }
    ellipse(g, ex, cy, r, r, '#ffffff', ink);
    ellipse(g, ex + look.x * r * 0.35, cy + look.y * r * 0.35, r * 0.5, r * 0.5, INK);
    ellipse(g, ex + look.x * r * 0.35 - r * 0.18, cy + look.y * r * 0.35 - r * 0.2, r * 0.14, r * 0.14, '#ffffff');
  }
}

// ---------- skins ----------

function bars(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>) {
  const n = bands.length;
  const gap = Math.max(1, r.w / n / 6);
  const bw = (r.w - gap * (n - 1)) / n;
  const floorH = r.h * 0.84;
  for (let b = 0; b < n; b++) {
    const h = Math.max(2, bands[b] * floorH);
    const x = r.x + b * (bw + gap);
    const hue = 190 - (b / n) * 40;
    g.fillStyle = `hsl(${hue} 85% ${50 + bands[b] * 15}%)`;
    g.fillRect(x, r.y + floorH - h, bw, h);
    g.fillStyle = `hsla(${hue} 85% 50% / 0.16)`;
    g.fillRect(x, r.y + floorH + 4, bw, h * 0.15);
  }
}

/** One Gomo-Fu guy standing on the ground at `fx`, legs as long as `legLen`. */
function guy(g: CanvasRenderingContext2D, fx: number, ground: number, size: number, legLen: number, c: typeof BO, squash: number, look: { x: number; y: number }, blink: boolean) {
  const ink = Math.max(1.2, size * 0.055);
  const rx = (size / 2) * (1 + squash * 0.12);
  const ry = size * 0.33 * (1 - squash * 0.12);
  const hipY = ground - legLen;
  const cy = hipY - ry * 0.45;
  // Legs and feet
  g.lineCap = 'round';
  for (const sx of [-1, 1]) {
    const hx = fx + sx * rx * 0.34;
    const kneeOut = Math.max(0, size * 0.42 - legLen) * 0.35;
    g.beginPath();
    g.moveTo(hx, hipY);
    g.lineTo(hx + sx * kneeOut, hipY + legLen / 2);
    g.lineTo(hx, ground - size * 0.05);
    g.lineWidth = size * 0.12 + ink * 2;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = size * 0.12;
    g.strokeStyle = c.legs;
    g.stroke();
    ellipse(g, hx + sx * size * 0.03, ground - size * 0.04, size * 0.11, size * 0.06, INK);
  }
  // Body (a soft rim of light so the dark one shows on a dark background), its shade, the band round the middle
  if (c === SLATE) {
    g.beginPath();
    g.ellipse(fx, cy, rx + ink * 1.4, ry + ink * 1.4, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(190, 175, 235, 0.35)';
    g.fill();
  }
  ellipse(g, fx, cy, rx, ry, c.body, ink);
  g.save();
  g.beginPath();
  g.ellipse(fx, cy, rx - ink / 2, ry - ink / 2, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, fx, cy + ry * 0.75, rx * 1.1, ry * 0.55, c.shade);
  g.beginPath();
  g.ellipse(fx, cy + ry * 0.05, rx * 1.02, ry * 0.62, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  g.lineWidth = ry * 0.24 + ink * 1.6;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = ry * 0.24;
  g.strokeStyle = c.band;
  g.stroke();
  g.restore();
  eyes(g, fx, cy - ry * 0.12, rx * 0.3, rx * 0.2, look, blink, ink * 0.8);
}

function crew(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const count = Math.max(4, Math.min(12, Math.round(r.w / 95)));
  const slot = r.w / count;
  const size = Math.min(slot * 0.82, r.h * 0.5);
  const ground = r.y + r.h - size * 0.08;
  // The ground they stand on
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(r.x, ground - 1, r.w, 2);
  for (let i = 0; i < count; i++) {
    const lv = eased(memory, `crew${i}`, level(bands, i / count, (i + 1) / count));
    const jump = eased(memory, `crewv${i}`, lv, 0.9, 0.08);
    const squash = Math.max(-1, Math.min(1, (jump - lv) * 6));
    const legLen = size * 0.16 + lv * Math.min(size * 1.1, r.h - size * 0.9);
    const look = { x: Math.sin(t * 0.8 + i) * 0.6, y: -lv * 0.8 };
    guy(g, r.x + slot * (i + 0.5), ground, size, legLen, i % 2 ? SLATE : BO, squash, look, blinking(t, i));
  }
}

function mochi(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const bass = eased(memory, 'bass', level(bands, 0, 0.18));
  const highs = eased(memory, 'highs', level(bands, 0.6, 1));
  const size = Math.min(r.w * 0.5, r.h * 1.15);
  const cx = r.x + r.w / 2;
  const ground = r.y + r.h - size * 0.04;
  const rx = (size / 2) * (1 + bass * 0.18);
  const ry = size * 0.33 * (1 - bass * 0.14);
  const cy = ground - size * 0.05 - ry;
  const ink = Math.max(1.5, size * 0.03);
  // Feet
  for (const sx of [-1, 1]) ellipse(g, cx + sx * rx * 0.45, ground - size * 0.03, size * 0.1, size * 0.05, INK);
  // The body's outline follows the spectrum: lows at the sides, highs on top
  const points = 96;
  const lift: number[] = [];
  for (let k = 0; k < points; k++) {
    // The top half moves: the sides with the lows, the crown with the highs
    const up = -Math.sin((k / points) * Math.PI * 2);
    lift.push(up > 0 ? eased(memory, `m${k}`, level(bands, up * 0.94, up * 0.94 + 0.06), 0.5, 0.2) * Math.min(1, up * 3) : 0);
  }
  // Smoothed round the loop so the outline stays soft, like dough rather than a saw
  for (let pass = 0; pass < 3; pass++) {
    const prev = lift.slice();
    for (let k = 0; k < points; k++) lift[k] = (prev[(k + points - 1) % points] + prev[k] * 2 + prev[(k + 1) % points]) / 4;
  }
  const outline = lift.map((lv, k) => {
    const a = (k / points) * Math.PI * 2;
    const wobble = 1 + lv * 0.16 + Math.sin(t * 3 + k * 0.5) * 0.004;
    return { x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble };
  });
  g.beginPath();
  const mid = (i: number) => {
    const p = outline[i % points];
    const q = outline[(i + 1) % points];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  };
  const start = mid(points - 1);
  g.moveTo(start.x, start.y);
  for (let k = 0; k < points; k++) {
    const m = mid(k);
    g.quadraticCurveTo(outline[k].x, outline[k].y, m.x, m.y);
  }
  g.closePath();
  g.fillStyle = BO.body;
  g.fill();
  g.lineWidth = ink;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
  g.save();
  g.clip();
  ellipse(g, cx, cy + ry * 0.8, rx * 1.1, ry * 0.5, BO.shade);
  g.beginPath();
  g.ellipse(cx, cy + ry * 0.08, rx * 1.02, ry * 0.6, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  g.lineWidth = ry * 0.2 + ink * 1.6;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = ry * 0.2;
  g.strokeStyle = BO.band;
  g.stroke();
  g.restore();
  // Eyes widen on the highs; a blush when it's loud
  const er = rx * (0.15 + highs * 0.05);
  eyes(g, cx, cy - ry * 0.15, rx * 0.3, er, { x: Math.sin(t * 0.6) * 0.5, y: -0.2 - highs * 0.5 }, blinking(t, 1), ink * 0.8);
  const loud = level(bands, 0, 1);
  g.globalAlpha = Math.min(0.6, loud * 0.9);
  for (const sx of [-1, 1]) ellipse(g, cx + sx * rx * 0.52, cy + ry * 0.12, rx * 0.11, ry * 0.08, '#ff8fab');
  g.globalAlpha = 1;
}

function cat(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const bass = eased(memory, 'bass', level(bands, 0, 0.15));
  const highs = eased(memory, 'highs', level(bands, 0.65, 1));
  const size = Math.min(r.w * 0.42, r.h * 0.95);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.58;
  const R = size * 0.4;
  const ink = Math.max(1.5, size * 0.025);
  const fur = '#f2a65a';
  const dark = '#c9783a';
  // Ears: perk up on the highs
  for (const sx of [-1, 1]) {
    const tip = R * (0.95 + highs * 0.55);
    const twitch = Math.sin(t * 9 + sx) * highs * 0.08;
    g.beginPath();
    g.moveTo(cx + sx * R * 0.25, cy - R * 0.75);
    g.lineTo(cx + sx * R * (0.75 + twitch), cy - R * 0.45 - tip);
    g.lineTo(cx + sx * R * 0.92, cy - R * 0.25);
    g.closePath();
    g.fillStyle = fur;
    g.fill();
    g.lineWidth = ink;
    g.strokeStyle = INK;
    g.lineJoin = 'round';
    g.stroke();
    g.beginPath();
    g.moveTo(cx + sx * R * 0.4, cy - R * 0.68);
    g.lineTo(cx + sx * R * (0.72 + twitch), cy - R * 0.45 - tip * 0.75);
    g.lineTo(cx + sx * R * 0.82, cy - R * 0.38);
    g.closePath();
    g.fillStyle = '#ffb3c1';
    g.fill();
  }
  // Head, stripes, muzzle
  ellipse(g, cx, cy, R * 1.05, R * 0.9, fur, ink);
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, R * 1.05 - ink / 2, R * 0.9 - ink / 2, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = dark;
  for (const dx of [-0.22, 0, 0.22]) g.fillRect(cx + dx * R - R * 0.05, cy - R, R * 0.1, R * 0.32);
  g.restore();
  ellipse(g, cx, cy + R * 0.35, R * 0.48, R * 0.32, '#fff4e6');
  // Eyes: narrow when it's quiet, round when it's loud
  const open = 0.25 + Math.min(1, level(bands, 0.2, 0.7) * 1.6) * 0.75;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * R * 0.38;
    const ey = cy - R * 0.08;
    if (blinking(t, 3)) {
      g.beginPath();
      g.arc(ex, ey, R * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      g.lineWidth = ink;
      g.strokeStyle = INK;
      g.stroke();
      continue;
    }
    ellipse(g, ex, ey, R * 0.15, R * 0.17 * open, '#c8f560', ink * 0.8);
    ellipse(g, ex, ey, R * 0.045, R * 0.14 * open, INK);
  }
  // Nose and mouth: opens on the bass
  g.beginPath();
  g.moveTo(cx - R * 0.07, cy + R * 0.2);
  g.lineTo(cx + R * 0.07, cy + R * 0.2);
  g.lineTo(cx, cy + R * 0.28);
  g.closePath();
  g.fillStyle = '#ff8fab';
  g.fill();
  const mouth = bass * R * 0.22;
  if (mouth > R * 0.04) ellipse(g, cx, cy + R * 0.42, R * 0.12, mouth, '#7a2840', ink * 0.7);
  else {
    g.beginPath();
    g.arc(cx - R * 0.08, cy + R * 0.3, R * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
    g.arc(cx + R * 0.08, cy + R * 0.3, R * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
    g.lineWidth = ink * 0.8;
    g.strokeStyle = INK;
    g.stroke();
  }
  // Whiskers: each one a slice of the spectrum
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const i = sx < 0 ? k : 5 - k;
      const lv = eased(memory, `w${i}`, level(bands, i / 6, (i + 1) / 6));
      const len = R * (0.5 + lv * 1.1);
      const ang = (k - 1) * 0.18 + Math.sin(t * 7 + i) * lv * 0.08;
      const x0 = cx + sx * R * 0.38;
      const y0 = cy + R * 0.32 + (k - 1) * R * 0.08;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + sx * Math.cos(ang) * len, y0 + Math.sin(ang) * len * 0.6);
      g.lineWidth = ink * 0.6;
      g.strokeStyle = '#fff4e6';
      g.stroke();
    }
  }
}

function frog(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const bass = eased(memory, 'bass', level(bands, 0, 0.15), 0.7, 0.18);
  const mids = level(bands, 0.15, 0.6);
  const highs = eased(memory, 'highs', level(bands, 0.6, 1));
  const size = Math.min(r.w * 0.38, r.h * 0.9);
  const cx = r.x + r.w / 2;
  const pondY = r.y + r.h * 0.84;
  const ink = Math.max(1.5, size * 0.025);
  // Ripples: a new one on each push of the mids, spreading across the pond
  const ripples = ((memory.ripples as Array<{ born: number; strength: number }>) ??= []);
  const lastMid = (memory.lastMid as number | undefined) ?? 0;
  if (mids - lastMid > 0.08 && (!ripples.length || t - ripples[ripples.length - 1].born > 0.25)) ripples.push({ born: t, strength: mids });
  memory.lastMid = mids;
  while (ripples.length && t - ripples[0].born > 2.5) ripples.shift();
  for (const rp of ripples) {
    const age = (t - rp.born) / 2.5;
    g.beginPath();
    g.ellipse(cx, pondY, size * (0.6 + age * 1.8), size * (0.12 + age * 0.35), 0, 0, Math.PI * 2);
    g.lineWidth = Math.max(1, ink * 0.8);
    g.strokeStyle = `rgba(120, 220, 255, ${(1 - age) * 0.5 * (0.5 + rp.strength)})`;
    g.stroke();
  }
  // Lily pad
  g.beginPath();
  g.ellipse(cx, pondY, size * 0.62, size * 0.13, 0, 0.1 * Math.PI, 2.05 * Math.PI);
  g.lineTo(cx, pondY);
  g.closePath();
  g.fillStyle = '#3aa65a';
  g.fill();
  g.lineWidth = ink;
  g.strokeStyle = INK;
  g.stroke();
  // Body
  const bodyY = pondY - size * 0.28;
  ellipse(g, cx, bodyY, size * 0.42, size * 0.3, '#7cd35a', ink);
  // Throat: puffs on the bass
  ellipse(g, cx, bodyY + size * 0.06, size * (0.16 + bass * 0.16), size * (0.1 + bass * 0.12), '#f6e7a8', ink * 0.8);
  // Head and eyes on top: pop up on the highs
  const pop = highs * size * 0.12;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * size * 0.22;
    const ey = bodyY - size * 0.24 - pop;
    ellipse(g, ex, ey + pop * 0.5, size * 0.12, size * 0.1 + pop * 0.5, '#7cd35a', ink);
    if (blinking(t, 5)) {
      g.beginPath();
      g.moveTo(ex - size * 0.07, ey);
      g.lineTo(ex + size * 0.07, ey);
      g.lineWidth = ink;
      g.strokeStyle = INK;
      g.stroke();
    } else {
      ellipse(g, ex, ey, size * 0.08, size * 0.08, '#ffffff', ink * 0.8);
      ellipse(g, ex, ey + size * 0.01, size * 0.045, size * 0.04 + highs * size * 0.02, INK);
    }
  }
  // Smile
  g.beginPath();
  g.arc(cx, bodyY - size * 0.1, size * 0.22, 0.2 * Math.PI, 0.8 * Math.PI);
  g.lineWidth = ink;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.stroke();
  // Front feet
  for (const sx of [-1, 1]) ellipse(g, cx + sx * size * 0.3, pondY - size * 0.05, size * 0.1, size * 0.04, '#7cd35a', ink * 0.8);
}

function bird(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, facing: 1 | -1, tilt: number, sing: number, blink: boolean) {
  const ink = Math.max(1.2, size * 0.06);
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(facing, 1);
  // Tail
  g.beginPath();
  g.moveTo(-size * 0.4, -size * 0.35);
  g.lineTo(-size * 0.85, -size * 0.55);
  g.lineTo(-size * 0.8, -size * 0.25);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = ink;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
  // Body and belly
  ellipse(g, 0, -size * 0.45, size * 0.5, size * 0.42, color, ink);
  ellipse(g, size * 0.08, -size * 0.32, size * 0.3, size * 0.22, '#fff4e6');
  // Beak: opens when it sings
  g.beginPath();
  g.moveTo(size * 0.44, -size * 0.6);
  g.lineTo(size * 0.75, -size * 0.55 - sing * size * 0.12);
  g.lineTo(size * 0.46, -size * 0.5);
  g.lineTo(size * 0.75, -size * 0.45 + sing * size * 0.12);
  g.lineTo(size * 0.44, -size * 0.42);
  g.closePath();
  g.fillStyle = '#ffbe3b';
  g.fill();
  g.lineWidth = ink * 0.8;
  g.stroke();
  // Eye
  if (blink) {
    g.beginPath();
    g.moveTo(size * 0.12, -size * 0.62);
    g.lineTo(size * 0.3, -size * 0.62);
    g.lineWidth = ink;
    g.stroke();
  } else ellipse(g, size * 0.22, -size * 0.62, size * 0.07, size * 0.08, INK);
  // Feet on the wire
  g.beginPath();
  g.moveTo(-size * 0.1, -size * 0.05);
  g.lineTo(-size * 0.1, 0);
  g.moveTo(size * 0.12, -size * 0.05);
  g.lineTo(size * 0.12, 0);
  g.lineWidth = ink;
  g.stroke();
  g.restore();
}

function birds(g: CanvasRenderingContext2D, r: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory) {
  const wireY = r.y + r.h * 0.72;
  const amp = r.h * 0.42;
  const n = 60;
  // The wire: each stretch shaken by its band, smoothed
  const ys: number[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const lv = eased(memory, `wire${k}`, level(bands, Math.max(0, u - 0.03), Math.min(1, u + 0.03)), 0.5, 0.2);
    const sag = Math.sin(u * Math.PI) * r.h * 0.06;
    ys.push(wireY + sag - lv * amp * Math.sin(u * Math.PI) ** 0.6 * (0.9 + 0.1 * Math.sin(t * 20 + k)));
  }
  for (let pass = 0; pass < 2; pass++) for (let k = 1; k < n; k++) ys[k] = (ys[k - 1] + 2 * ys[k] + ys[k + 1]) / 4;
  g.beginPath();
  ys.forEach((y, k) => (k ? g.lineTo(r.x + (k / n) * r.w, y) : g.moveTo(r.x, y)));
  g.lineWidth = Math.max(1.5, r.h * 0.012);
  g.strokeStyle = '#8b93a7';
  g.stroke();
  // Two birds, at a third and two thirds, riding the wire
  const loud = level(bands, 0, 1);
  const size = Math.min(r.h * 0.28, r.w * 0.09);
  const notes = ((memory.notes as Array<{ x: number; y: number; born: number; hue: number }>) ??= []);
  ([[1 / 3, BO.band, 1], [2 / 3, '#f59e0b', -1]] as const).forEach(([u, color, facing], i) => {
    const k = Math.round(u * n);
    // Leaning a little with the wire, never toppling
    const tilt = Math.max(-0.25, Math.min(0.25, Math.atan2(ys[k + 2] - ys[k - 2], (4 * r.w) / n) * 0.4));
    const y = (ys[k - 1] + ys[k] + ys[k + 1]) / 3;
    const sing = eased(memory, `sing${i}`, Math.min(1, level(bands, i ? 0.4 : 0.1, i ? 1 : 0.6) * 1.8));
    bird(g, r.x + u * r.w, y, size, color, facing, tilt, sing, blinking(t, i * 2 + 7));
    // A note now and then when it sings out
    const last = (memory[`noteAt${i}`] as number | undefined) ?? -1;
    if (sing > 0.45 && t - last > 0.35) {
      notes.push({ x: r.x + u * r.w + facing * size * 0.7, y: y - size * 0.6, born: t, hue: i ? 38 : 205 });
      memory[`noteAt${i}`] = t;
    }
  });
  while (notes.length && t - notes[0].born > 2) notes.shift();
  g.font = `${Math.round(size * 0.6)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  for (const nt of notes) {
    const age = (t - nt.born) / 2;
    g.fillStyle = `hsla(${nt.hue} 90% 70% / ${1 - age})`;
    g.fillText(age < 0.5 ? '♪' : '♫', nt.x + Math.sin(age * 9) * size * 0.2, nt.y - age * r.h * 0.5);
  }
  g.textAlign = 'start';
  void loud;
}

/** Draw `bands` (0 to 1, lows first) in `skin` into `rect`. */
export function drawSpectrum(g: CanvasRenderingContext2D, skin: SkinId, rect: Rect, bands: ArrayLike<number>, t: number, memory: SkinMemory): void {
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  switch (skin) {
    case 'bars':
      bars(g, rect, bands);
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
