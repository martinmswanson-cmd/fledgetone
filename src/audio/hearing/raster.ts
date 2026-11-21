/**
 * A small in-memory picture for the hearing report's spectrograms and charts: an RGB grid with
 * rectangles, lines, 5x7 pixel text and colour ramps. Every drawing call is safe to aim anywhere
 * (outside the picture, with fractions, with odd sizes): it never throws and never writes outside
 * the data. Pure code, no DOM; png.ts turns a Raster into a PNG file.
 */
import { GLYPHS } from './font5x7';

export type Rgb = readonly [number, number, number];
/** RGB, 3 bytes a pixel, rows top to bottom. */
export interface Raster { width: number; height: number; data: Uint8Array }

/** A picture of the given whole size (at least 1 by 1) filled with one colour. */
export function raster(width: number, height: number, fill: Rgb): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`a picture needs a whole width and height of at least 1, got ${width} by ${height}`);
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; }
  return { width, height, data };
}

/** Paint one pixel (whole coordinates). Outside the picture: nothing. */
export function setPixel(r: Raster, x: number, y: number, c: Rgb): void {
  if (!(x >= 0 && y >= 0 && x < r.width && y < r.height)) return;
  const i = (Math.floor(y) * r.width + Math.floor(x)) * 3;
  r.data[i] = c[0]; r.data[i + 1] = c[1]; r.data[i + 2] = c[2];
}

/** The colour of one pixel; black outside the picture. */
export function pixel(r: Raster, x: number, y: number): Rgb {
  if (!(x >= 0 && y >= 0 && x < r.width && y < r.height)) return [0, 0, 0];
  const i = (Math.floor(y) * r.width + Math.floor(x)) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
}

/** Fill a rectangle; coordinates round to whole pixels, the part outside the picture is dropped, a size of nothing or less draws nothing. */
export function fillRect(r: Raster, x: number, y: number, w: number, h: number, c: Rgb): void {
  if (![x, y, w, h].every(Number.isFinite)) return;
  const x0 = Math.max(0, Math.round(x)); const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(r.width, Math.round(x) + Math.round(w)); const y1 = Math.min(r.height, Math.round(y) + Math.round(h));
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) setPixel(r, i, j, c);
}

/** Cut the segment to the picture (Liang-Barsky); null when none of it is inside. */
function clipLine(r: Raster, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  const dx = x1 - x0; const dy = y1 - y0; let t0 = 0; let t1 = 1;
  const edges: [number, number][] = [[-dx, x0], [dx, r.width - 1 - x0], [-dy, y0], [dy, r.height - 1 - y0]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/** A one-pixel line between two points (rounded to whole pixels), the part outside the picture dropped. */
export function line(r: Raster, x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= r.width - 1 && y <= r.height - 1;
  let seg: [number, number, number, number] | null = [x0, y0, x1, y1];
  if (!(inside(Math.round(x0), Math.round(y0)) && inside(Math.round(x1), Math.round(y1)))) seg = clipLine(r, x0, y0, x1, y1);
  if (!seg) return;
  let [a, b, e, f] = seg.map(Math.round);
  const dx = Math.abs(e - a); const dy = -Math.abs(f - b); const sx = a < e ? 1 : -1; const sy = b < f ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(r, a, b, c);
    if (a === e && b === f) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; a += sx; }
    if (e2 <= dx) { err += dx; b += sy; }
  }
}

/** The width in pixels of a string: 6 a character (5 wide and 1 of space), times the scale. */
export function textWidth(s: string, scale = 1): number {
  return 6 * Math.max(1, Math.round(scale) || 1) * s.length;
}

/** Draw a string with its top left at x, y; a character not in the font is drawn as `?`. Returns the width drawn. */
export function text(r: Raster, s: string, x: number, y: number, c: Rgb, scale = 1): number {
  const k = Math.max(1, Math.round(scale) || 1);
  const width = textWidth(s, k);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return width;
  const ox = Math.round(x); const oy = Math.round(y);
  let pen = ox;
  for (const ch of s) {
    // the width counts code units (a character outside the basic range is two), so step on by the same count
    const rows = GLYPHS[ch] ?? GLYPHS['?'];
    if (pen < r.width && pen + 5 * k > 0) {
      for (let row = 0; row < 7; row++) for (let bit = 0; bit < 5; bit++) if ((rows[row] >> (4 - bit)) & 1) fillRect(r, pen + bit * k, oy + row * k, k, k, c);
    }
    pen += 6 * k * ch.length;
  }
  return width;
}

/** A colour along a list of stops, t clamped to 0..1 (NaN gives the first stop), straight lines between stops, whole channels. */
export function ramp(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 0) return [0, 0, 0];
  if (!(t > 0)) return [...stops[0]] as unknown as Rgb;
  if (t >= 1 || stops.length === 1) return [...stops[stops.length - 1]] as unknown as Rgb;
  const pos = t * (stops.length - 1); const i = Math.floor(pos); const f = pos - i;
  const a = stops[i]; const b = stops[i + 1];
  const ch = (k: number) => Math.max(0, Math.min(255, Math.round(a[k] + (b[k] - a[k]) * f)));
  return [ch(0), ch(1), ch(2)];
}

/** Quiet to loud: near-black, deep blue, purple, red, orange, pale yellow; each step lighter than the one before. */
export const HEAT: readonly Rgb[] = [[0, 0, 4], [20, 20, 120], [120, 28, 130], [220, 50, 40], [250, 140, 20], [255, 250, 190]];
/** Less to more: blue, near-black in the middle, red; both ends about as light as each other. */
export const DIVERGING: readonly Rgb[] = [[40, 115, 235], [8, 8, 12], [235, 65, 45]];
/** Light text on a dark ground. */
export const INK: Rgb = [220, 225, 232];
export const PAPER: Rgb = [14, 16, 22];
export const GRID: Rgb = [62, 68, 80];
