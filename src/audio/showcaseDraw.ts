/**
 * The Showcase picture for the MP4 export: the song's notes on a piano roll that scrolls past a
 * red playhead, as on fledgetone.com's home page. A note lights up as the playhead reaches it
 * (with sparkles, rings or just its glow), glows while it's held and dims once it's played.
 *
 * Two layouts. One roll: every track's notes on one piano roll, the drums in a band of their own
 * under the pitched parts, and the tracks playing listed above it; two tracks on the same note at
 * once share its row, one above the other, so doubled parts don't merge into one. A lane per
 * track: each track in a band of its own (its name at its left), fitted to its own range of notes,
 * like the timeline. Auto picks the lanes for a big arrangement. The busier the song, the smaller
 * the glow and the hit effects, so they don't cover the notes.
 *
 * Drawn in design units (1280×720 wide, 720×1280 tall) on a canvas scaled to the video's size.
 * Every frame is drawn from the time alone (no state), so frames can be drawn in any order. The
 * notes come from store/showcase.ts.
 */
import { firstFrom, type ShowcaseData, type ShowcaseNote } from '../store/showcase';

export interface ShowcaseBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShowcaseLayout = 'auto' | 'together' | 'lanes';
export type ShowcaseHits = 'sparkles' | 'rings' | 'glow';

export interface ShowcaseLook {
  layout: ShowcaseLayout;
  hits: ShowcaseHits;
}

export const DEFAULT_SHOWCASE_LOOK: ShowcaseLook = { layout: 'auto', hits: 'sparkles' };

/** How long a hit stays lit, and its sparkles or ring take to fade (seconds) */
const HIT = 0.45;
const SPARK = 0.5;
const RING = 0.65;
/** At most this many hits drawn at once (a big chord on many tracks is still a few sparkles) */
const MAX_HITS = 40;
/** Auto: a lane per track from this many tracks */
const LANES_FROM = 7;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** How lit a note is at `t`: a flash when it starts, a softer glow while it's held, nothing before. */
export function noteGlow(start: number, end: number, t: number): number {
  if (t < start) return 0;
  const flash = Math.max(0, 1 - (t - start) / HIT);
  const held = t < end ? 0.35 : Math.max(0, 0.35 - (t - end) * 2);
  return Math.max(flash, held);
}

/** What the drawing works out once per song: each track's notes and range, and how doubled notes share a row. */
export interface Prep {
  /** Per track: its lowest and highest pitched note, its drum rows, whether it has drum hits */
  tracks: Array<{ low: number; high: number; rows: number[]; drum: boolean }>;
  /** Per note (by index): which part of its row it takes, of how many (one roll) */
  slot: Uint8Array;
  slots: Uint8Array;
}

const preps = new WeakMap<ShowcaseData, Prep>();

export function prepare(data: ShowcaseData): Prep {
  const done = preps.get(data);
  if (done) return done;
  const tracks = data.tracks.map(() => ({ low: Infinity, high: -Infinity, rows: [] as number[], drum: false }));
  const rows = data.tracks.map(() => new Set<number>());
  for (const n of data.notes) {
    const tr = tracks[n.track];
    if (n.drum) {
      tr.drum = true;
      rows[n.track].add(n.midi);
    } else {
      tr.low = Math.min(tr.low, n.midi);
      tr.high = Math.max(tr.high, n.midi);
    }
  }
  tracks.forEach((tr, i) => (tr.rows = [...rows[i]].sort((a, b) => a - b)));
  // Doubled notes: where notes of different tracks sound on the same row at once, each takes a
  // part of the row (the first free one), and every note of the group is drawn that thin.
  const slot = new Uint8Array(data.notes.length);
  const slots = new Uint8Array(data.notes.length).fill(1);
  const byRow = new Map<string, number[]>();
  data.notes.forEach((n, i) => {
    const key = n.drum ? `d${n.midi}` : `p${n.midi}`;
    const list = byRow.get(key);
    if (list) list.push(i);
    else byRow.set(key, [i]);
  });
  for (const list of byRow.values()) {
    let group: number[] = [];
    let groupEnd = -Infinity;
    const close = () => {
      const tracksIn = new Set(group.map((i) => data.notes[i].track));
      if (tracksIn.size > 1) {
        // The same track's notes keep the same part of the row
        const order = [...tracksIn].slice(0, 4);
        for (const i of group) {
          const k = order.indexOf(data.notes[i].track);
          slot[i] = k < 0 ? order.length - 1 : k;
          slots[i] = order.length;
        }
      }
      group = [];
    };
    for (const i of list) {
      const n = data.notes[i];
      if (n.start >= groupEnd - 1e-6) {
        close();
        groupEnd = -Infinity;
      }
      group.push(i);
      groupEnd = Math.max(groupEnd, n.end);
    }
    close();
  }
  const prep = { tracks, slot, slots };
  preps.set(data, prep);
  return prep;
}

/** Which layout `look` comes to for this song (Auto: a lane per track for a big arrangement). */
export function showcaseLayoutFor(data: ShowcaseData, layout: ShowcaseLayout): 'together' | 'lanes' {
  if (layout !== 'auto') return layout;
  return data.tracks.length >= LANES_FROM ? 'lanes' : 'together';
}

/** A small four-pointed star */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const k = r * 0.28;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + k, y - k, x + r, y);
  g.quadraticCurveTo(x + k, y + k, x, y + r);
  g.quadraticCurveTo(x - k, y + k, x - r, y);
  g.quadraticCurveTo(x - k, y - k, x, y - r);
  g.fill();
}

/**
 * The track names, as chips that light up while their track plays (one roll). Returns the height
 * used. Smaller chips and a thinner light the more tracks there are.
 */
function drawChips(g: CanvasRenderingContext2D, data: ShowcaseData, box: ShowcaseBox, playing: Float32Array): number {
  const many = data.tracks.length > 6;
  g.font = `600 ${many ? 13 : 15}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.textBaseline = 'middle';
  const h = many ? 24 : 28;
  const gap = many ? 6 : 8;
  let x = box.x;
  let y = box.y;
  for (let i = 0; i < data.tracks.length; i++) {
    const tr = data.tracks[i];
    const w = Math.min(box.w, g.measureText(tr.name).width + (many ? 28 : 34));
    if (x + w > box.x + box.w && x > box.x) {
      x = box.x;
      y += h + gap;
      // (At most three rows: a big song's last tracks aren't listed)
      if (y + h > box.y + 3 * (h + gap)) break;
    }
    const lit = playing[i];
    g.globalAlpha = 0.5 + 0.5 * lit;
    g.fillStyle = 'rgba(26,26,30,0.9)';
    roundRect(g, x, y, w, h, 7);
    g.fill();
    g.strokeStyle = tr.color;
    g.lineWidth = 1 + lit * (many ? 0.5 : 1);
    g.globalAlpha = 0.35 + 0.65 * lit;
    g.stroke();
    if (lit > 0.05) {
      g.shadowColor = tr.color;
      g.shadowBlur = (many ? 6 : 14) * lit;
      g.stroke();
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
    g.fillStyle = tr.color;
    g.beginPath();
    g.arc(x + (many ? 11 : 13), y + h / 2, many ? 3.5 : 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lit > 0.05 ? '#f4f4f5' : '#a1a1aa';
    g.fillText(tr.name, x + (many ? 20 : 24), y + h / 2 + 1, w - (many ? 24 : 30));
    x += w + gap;
  }
  g.textBaseline = 'alphabetic';
  return y + h - box.y;
}

/**
 * Draw the roll at time `t` into `box`. `secondsShown` is how much of the song fits across it; the
 * playhead sits at `headAt` (0..1) of the width, so what's coming is visible ahead of it.
 */
export function drawShowcase(
  g: CanvasRenderingContext2D,
  data: ShowcaseData,
  box: ShowcaseBox,
  t: number,
  opts: { secondsShown: number; headAt: number; look?: ShowcaseLook },
): void {
  const look = opts.look ?? DEFAULT_SHOWCASE_LOOK;
  const prep = prepare(data);
  const lanes = showcaseLayoutFor(data, look.layout) === 'lanes';

  // Which tracks are sounding now (for their names)
  const playing = new Float32Array(data.tracks.length);
  const recent = firstFrom(data.notes, t - 8);
  for (let i = Math.max(0, recent - 400); i < data.notes.length; i++) {
    const n = data.notes[i];
    if (n.start > t) break;
    playing[n.track] = Math.max(playing[n.track], Math.min(1, noteGlow(n.start, n.end, t) / 0.35));
  }
  const chipsH = !lanes && data.tracks.length ? drawChips(g, data, box, playing) + 18 : 0;
  const roll = { x: box.x, y: box.y + chipsH, w: box.w, h: box.h - chipsH };

  // The roll's panel
  g.fillStyle = '#0f0f12';
  roundRect(g, roll.x, roll.y, roll.w, roll.h, 12);
  g.fill();
  g.strokeStyle = '#2a2a30';
  g.lineWidth = 1;
  g.stroke();
  g.save();
  roundRect(g, roll.x, roll.y, roll.w, roll.h, 12);
  g.clip();

  const pps = roll.w / opts.secondsShown;
  const headX = roll.x + roll.w * opts.headAt;
  const xOf = (s: number) => headX + (s - t) * pps;
  const pad = lanes ? 6 : 14;

  // Where a note goes: `yOf` its row's top, `rowH` its row's height
  let yOf: (n: ShowcaseNote) => number;
  let rowH: (n: ShowcaseNote) => number;
  /** How tall a row is, typically: sizes the glow and the hit effects */
  let typicalRow: number;
  if (lanes) {
    const count = data.tracks.length || 1;
    const bandH = (roll.h - 2 * pad) / count;
    // A track's rows spread over its band, the lowest at the bottom. A row is at least 4 high (a
    // wide range in a thin band overlaps a little rather than shrinking to a hairline).
    const spread = (top: number, inner: number, rows: number, index: (m: number) => number) => {
      const row = Math.max(4, Math.min(16, inner * 0.5, (inner / rows) * 1.6));
      const step = rows > 1 ? Math.min(row, (inner - row) / (rows - 1)) : 0;
      const bottom = top + (inner + step * (rows - 1) + row) / 2;
      return { y: (m: number) => bottom - row - index(m) * step, row };
    };
    const fit = data.tracks.map((_, i) => {
      const tr = prep.tracks[i];
      const top = roll.y + pad + i * bandH + 3;
      const inner = bandH - 6;
      if (tr.drum && tr.rows.length) {
        const at = new Map(tr.rows.map((m, k) => [m, k]));
        return spread(top, inner, tr.rows.length, (m) => at.get(m) ?? 0);
      }
      const low = Number.isFinite(tr.low) ? tr.low : 60;
      const high = Number.isFinite(tr.high) ? tr.high : low;
      return spread(top, inner, high - low + 1, (m) => m - low);
    });
    yOf = (n) => fit[n.track].y(n.midi);
    rowH = (n) => fit[n.track].row;
    typicalRow = Math.min(16, bandH * 0.4);

    // The bands: every other one a shade lighter, a line between them, the track's name at the left
    g.font = `600 ${bandH < 30 ? 11 : 13}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.textBaseline = 'middle';
    for (let i = 0; i < count; i++) {
      const y = roll.y + pad + i * bandH;
      if (i % 2) {
        g.fillStyle = 'rgba(255,255,255,0.022)';
        g.fillRect(roll.x, y, roll.w, bandH);
      }
    }
  } else {
    const drums = data.drumRows.length;
    const drumH = drums ? Math.min(roll.h * 0.24, 14 * drums + 10) : 0;
    const pitchTop = roll.y + pad;
    const pitchBottom = roll.y + roll.h - pad - drumH - (drums ? 10 : 0);
    // At least two octaves, so a short melody isn't stretched into huge notes
    const low = Math.min(data.low, Math.round((data.low + data.high) / 2) - 12) - 1;
    const high = Math.max(data.high, low + 25) + 1;
    const lane = (pitchBottom - pitchTop) / (high - low + 1);
    const yOfPitch = (m: number) => pitchBottom - (m - low + 1) * lane;
    const drumLane = drums ? (drumH - 6) / drums : 0;
    const drumTop = roll.y + roll.h - pad - drumH;
    const drumRow = new Map(data.drumRows.map((m, i) => [m, i]));
    yOf = (n) => (n.drum ? drumTop + 3 + (drums - 1 - drumRow.get(n.midi)!) * drumLane : yOfPitch(n.midi));
    rowH = (n) => (n.drum ? drumLane : lane);
    typicalRow = lane;
    for (let m = Math.ceil(low / 12) * 12; m <= high; m += 12) {
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fillRect(roll.x, yOfPitch(m), roll.w, Math.max(1, lane));
    }
    if (drums) {
      g.fillStyle = 'rgba(255,255,255,0.025)';
      g.fillRect(roll.x, drumTop, roll.w, drumH);
    }
  }
  // How big the light is: full on a roomy roll, smaller as the rows get thin
  const scale = Math.max(0.3, Math.min(1, typicalRow / 12));

  // Bar lines
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  for (const b of data.bars) {
    const x = xOf(b);
    if (x < roll.x - 2 || x > roll.x + roll.w + 2) continue;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, roll.y);
    g.lineTo(Math.round(x) + 0.5, roll.y + roll.h);
    g.stroke();
  }

  // The notes on screen (a long note that started before the window still shows)
  const from = firstFrom(data.notes, t - (headX - roll.x) / pps - 30);
  const hits: Array<{ i: number; y: number; h: number; color: string; age: number }> = [];
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i];
    const x = xOf(n.start);
    if (x > roll.x + roll.w) break;
    const x2 = xOf(n.end);
    if (x2 < roll.x) continue;
    const row = rowH(n);
    // A doubled note takes its part of the row
    const part = lanes ? 1 : prep.slots[i];
    const gapY = row >= 4 ? 1 : 0.5;
    const h = Math.max(1.5, row / part - gapY * 2);
    const y = yOf(n) + (lanes ? 0 : (prep.slot[i] * row) / part) + gapY;
    // A small gap after each note, so repeated notes stay apart
    const len = x2 - x;
    const w = Math.max(2, len - Math.min(2, len * 0.25));
    const glow = noteGlow(n.start, n.end, t);
    const past = n.end < t;
    const base = past ? 0.3 : 0.55;
    const r = Math.min(3, h / 2);
    g.globalAlpha = Math.min(1, base * 0.85 + 0.6 * glow);
    g.fillStyle = n.color;
    roundRect(g, x, y, w, h, r);
    g.fill();
    if (h >= 3) {
      g.globalAlpha = Math.min(1, base + 0.5 * glow);
      g.strokeStyle = n.color;
      g.lineWidth = h >= 6 ? 1 : 0.6;
      g.stroke();
    }
    if (glow > 0.05) {
      g.globalAlpha = glow * 0.8;
      g.shadowColor = n.color;
      g.shadowBlur = 22 * glow * scale;
      g.fill();
      g.shadowBlur = 0;
    }
    const age = t - n.start;
    if (age >= 0 && age < Math.max(SPARK, RING) && hits.length < MAX_HITS) hits.push({ i, y, h, color: n.color, age });
  }
  g.globalAlpha = 1;

  // Where the playhead hit a note: sparkles (a small star and a few dots flying off), a ring, or nothing more
  if (look.hits === 'sparkles') {
    const size = 4 + 5 * scale;
    for (const hit of hits) {
      const p = hit.age / SPARK;
      if (p >= 1) continue;
      const cy = hit.y + hit.h / 2;
      // A white star in the note's colour of light
      g.globalAlpha = (1 - p) * 0.95;
      g.shadowColor = hit.color;
      g.shadowBlur = 4 + 6 * scale;
      g.fillStyle = '#ffffff';
      star(g, headX, cy, size * (1 - p * 0.5));
      g.shadowBlur = 0;
      // The dots: the same directions for the same note on every frame
      g.fillStyle = hit.color;
      for (let k = 0; k < 4; k++) {
        const a = ((hit.i * 2.39996 + k * 1.5708 + 0.4) % (Math.PI * 2)) - Math.PI;
        const d = (6 + 16 * scale) * Math.sqrt(p) * (0.7 + (0.3 * ((hit.i + k) % 3)) / 2);
        g.globalAlpha = (1 - p) * 0.9;
        g.beginPath();
        g.arc(headX + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 1 + scale, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (look.hits === 'rings') {
    g.lineWidth = Math.max(1, 2 * scale);
    for (const hit of hits.slice(0, 16)) {
      const p = hit.age / RING;
      if (p >= 1) continue;
      g.globalAlpha = (1 - p) * 0.6;
      g.strokeStyle = hit.color;
      g.beginPath();
      g.arc(headX, hit.y + hit.h / 2, 3 + p * (6 + 28 * scale), 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // A lane per track: the names at the left, over the notes, lighting up while their track plays
  if (lanes) {
    const count = data.tracks.length || 1;
    const bandH = (roll.h - 2 * pad) / count;
    for (let i = 0; i < data.tracks.length; i++) {
      const tr = data.tracks[i];
      const lit = playing[i];
      const cy = roll.y + pad + (i + 0.5) * bandH;
      const w = g.measureText(tr.name).width;
      const fade = g.createLinearGradient(roll.x, 0, roll.x + w + 40, 0);
      fade.addColorStop(0, 'rgba(15,15,18,0.85)');
      fade.addColorStop(0.75, 'rgba(15,15,18,0.6)');
      fade.addColorStop(1, 'rgba(15,15,18,0)');
      g.fillStyle = fade;
      g.fillRect(roll.x, cy - Math.min(10, bandH / 2), w + 40, Math.min(20, bandH));
      g.globalAlpha = 1;
      g.fillStyle = tr.color;
      g.beginPath();
      g.arc(roll.x + 12, cy, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = lit > 0.05 ? '#f4f4f5' : '#8b8b94';
      g.globalAlpha = 0.75 + 0.25 * lit;
      g.fillText(tr.name, roll.x + 20, cy + 1);
      g.globalAlpha = 1;
    }
    g.textBaseline = 'alphabetic';
  }

  // The playhead: a soft light behind it, the line, and its marker at the top
  const light = g.createLinearGradient(headX - 60, 0, headX + 60, 0);
  light.addColorStop(0, 'rgba(239,68,68,0)');
  light.addColorStop(0.5, 'rgba(239,68,68,0.10)');
  light.addColorStop(1, 'rgba(239,68,68,0)');
  g.fillStyle = light;
  g.fillRect(headX - 60, roll.y, 120, roll.h);
  g.fillStyle = '#ef4444';
  g.shadowColor = '#ef4444';
  g.shadowBlur = 14;
  g.fillRect(headX - 1.5, roll.y, 3, roll.h);
  g.shadowBlur = 0;
  g.beginPath();
  g.moveTo(headX - 9, roll.y);
  g.lineTo(headX + 9, roll.y);
  g.lineTo(headX, roll.y + 12);
  g.closePath();
  g.fill();
  g.restore();
}
