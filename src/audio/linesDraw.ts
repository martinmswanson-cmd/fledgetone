/**
 * The Lines picture for the MP4 export: every instrument draws a glowing line that scrolls right
 * to left past "now", rising and falling with the notes it plays, its colour the pitch, a dot at
 * its head. A short rest runs on flat; a longer one ends the line (a dim dot stays behind at its
 * end), and when the instrument comes back a new line rises from under the picture to its first note.
 * A stutter (the same note struck fast, again and again) draws as a row of teeth on the line.
 *
 * The instruments playing at a moment share the picture's height between them, the lowest part at
 * the bottom: each has a band of its own that its line moves in (a little into its neighbours'),
 * and the bands make room as an instrument comes in and close up when one leaves. So parts in the
 * same register, even on the same notes, stay lines you can tell apart; the colour still tells the
 * real pitch.
 *
 * Each of these can be left out (LinesLook, and the section name): a map of the song's sections
 * filling as it plays, the section's name, the chord sounding and the next one, a row of drum hits
 * with a flash on each kick, a ring where each note starts, and a faint line ahead of each dot
 * showing where it goes next. What's left out gives its room to the lines.
 *
 * Drawn in design units on a canvas scaled to the video's size. Every frame is drawn from the time
 * alone (no state), so frames can be drawn in any order. The lines come from store/lines.ts, the
 * chords from store/linesChords.ts; nothing here reads the app's state.
 */
import { ease, isSounding, LINE_ENTRY, rollKick, runPitch, type LineRun, type LinesData } from '../store/lines';
import type { ChordSpan } from '../store/linesChords';
import type { ShowcaseBox } from './showcaseDraw';

export interface LinesLook {
  /** The song's sections as a strip that fills as it plays */
  map: boolean;
  /** The chord sounding, and the next */
  chord: boolean;
  /** The drum row, and the flash on each kick */
  drums: boolean;
  /** A ring where each note starts */
  rings: boolean;
  /** A faint line ahead of each dot: where it goes next */
  ahead: boolean;
}

export const DEFAULT_LINES_LOOK: LinesLook = { map: true, chord: true, drums: true, rings: true, ahead: true };

export interface LinesDrawOptions {
  /** How many seconds of the song the picture is wide, and where "now" is across it (0 to 1) */
  secondsShown: number;
  headAt: number;
  look: LinesLook;
  /** Draw the name of the section the song is in */
  section: boolean;
  /** The sections (from the markers), sorted, in seconds from the start of the video */
  sections: ReadonlyArray<{ at: number; name: string }>;
  chords: readonly ChordSpan[];
  /** The video's length (seconds) */
  duration: number;
}

/** Samples of the bands a second, and of a line (fine enough for a stutter's teeth) */
const RATE = 30;
const LINE_RATE = 96;
const COARSE_RATE = 40;
/** How far a stutter's strike kicks its line up */
const TOOTH = 24;
/** A ring's life, and a hit's flash (seconds) */
const RING = 0.7;
const FLASH = 0.6;
/** How long a band takes to close up once its line has ended (seconds) */
const LEAVE = 1.5;
/** How far a line swings from its band's middle, as a share of the band; a band is never taller than this share of the picture */
const SWING = 0.55;
const TALLEST = 1 / 3;
/** An instrument's range counts as at least this many semitones each way (a part on two notes doesn't swing the whole band) */
const LEAST_RANGE = 4;
/** Names are drawn beside the dots up to this many lines at once */
const MAX_NAMES = 10;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const TAU = Math.PI * 2;

/** How much room a track's band takes at `t`: growing as a line of its rises, 1 while it runs, closing up after it ends */
function roomAt(runs: readonly LineRun[], t: number): number {
  let room = 0;
  for (const r of runs) {
    if (r.start - LINE_ENTRY > t) break;
    if (t > r.end + LEAVE) continue;
    room = Math.max(room, t < r.start ? ease(1 - (r.start - t) / LINE_ENTRY) : t <= r.end ? 1 : 1 - ease((t - r.end) / LEAVE));
  }
  return room;
}

/** The first index of a time-sorted list at or after `t` */
function firstAt<T>(list: readonly T[], t: number, timeOf: (x: T) => number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeOf(list[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function drawLines(g: CanvasRenderingContext2D, data: LinesData, box: ShowcaseBox, t: number, opts: LinesDrawOptions): void {
  const { look } = opts;
  const pps = box.w / opts.secondsShown;
  const headX = box.x + box.w * opts.headAt;
  const xOf = (time: number) => headX + (time - t) * pps;
  const tLeft = t - (headX - box.x) / pps;
  const tRight = t + (box.x + box.w - headX) / pps;
  const drumRow = look.drums && data.hits.length > 0;
  const headRow = look.chord || opts.section;
  // (the chord and the section's name lie over the top of the lines: the lines keep the room)
  const top = box.y + (look.map ? 26 : 0) + 22;
  const bottom = box.y + box.h - (drumRow ? 74 : 22);
  const floor = box.y + box.h - 30;
  // The pitched range, for the colours
  const lowP = data.low - 1;
  const highP = Math.max(data.high + 1, lowP + 2);
  const frac = (p: number) => Math.min(1, Math.max(0, (p - lowP) / (highP - lowP)));
  // Low notes amber, high notes violet
  const colour = (p: number, a: number, light = 64) => `hsl(${(22 + frac(p) * 268).toFixed(1)} 92% ${light}% / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  // Lines fade into the picture's left edge
  const edge = (x: number) => Math.min(1, Math.max(0, (x - box.x) / 150));

  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.textBaseline = 'middle';
  g.textAlign = 'left';

  // The drums: how lately a kick and another hit fell
  let kickFlash = 0;
  let hitFlash = 0;
  if (drumRow) {
    for (let i = firstAt(data.hits, t - FLASH, (h) => h.t); i < data.hits.length && data.hits[i].t <= t; i++) {
      const f = Math.exp(-(t - data.hits[i].t) * 9);
      if (data.hits[i].kick) kickFlash = Math.max(kickFlash, f);
      else hitFlash = Math.max(hitFlash, f);
    }
    if (kickFlash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      const bloom = g.createRadialGradient(headX, box.y + box.h + 40, 0, headX, box.y + box.h + 40, box.h * 0.95);
      bloom.addColorStop(0, `rgba(150,175,255,${(0.17 * kickFlash).toFixed(3)})`);
      bloom.addColorStop(1, 'rgba(150,175,255,0)');
      g.fillStyle = bloom;
      g.fillRect(box.x, box.y, box.w, box.h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // Bar lines
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = firstAt(data.bars, tLeft, (b) => b); i < data.bars.length && data.bars[i] <= tRight; i++) g.fillRect(Math.round(xOf(data.bars[i])), top - 14, 1, bottom - top + 28);

  // Each track's band on a grid of times: the tracks playing share the height, the highest part on top
  const dt = 1 / RATE;
  const back = Math.ceil((t - tLeft) / dt) + 1;
  const fore = look.ahead ? Math.ceil((tRight - t) / dt) + 1 : 0;
  const cells = back + fore + 1;
  const count = data.tracks.length;
  const order = data.tracks.map((_, i) => i).sort((a, b) => data.tracks[b].low + data.tracks[b].high - (data.tracks[a].low + data.tracks[a].high) || a - b);
  const rooms = data.tracks.map((tr) => {
    const row = new Float32Array(cells);
    for (let m = 0; m < cells; m++) row[m] = roomAt(tr.runs, t + (m - back) * dt);
    return row;
  });
  const middle = data.tracks.map(() => new Float32Array(cells));
  const swing = new Float32Array(cells);
  for (let m = 0; m < cells; m++) {
    let all = 0;
    for (let i = 0; i < count; i++) all += rooms[i][m];
    const band = (bottom - top) / Math.max(1, all);
    // (less than one band's worth playing: it sits mid-picture)
    let y = top + (bottom - top - all * band) / 2;
    for (const i of order) {
      middle[i][m] = y + (rooms[i][m] * band) / 2;
      y += rooms[i][m] * band;
    }
    swing[m] = Math.min(band, (bottom - top) * TALLEST) * SWING;
  }
  /** Where track `i`'s line is, playing pitch `p`, at `time`: in its band, by where `p` is in its range */
  const yOf = (i: number, p: number, time: number): number => {
    const m = Math.min(cells - 1, Math.max(0, Math.round((time - t) / dt) + back));
    const tr = data.tracks[i];
    const half = Math.max(LEAST_RANGE, (tr.high - tr.low) / 2);
    return middle[i][m] - Math.max(-1, Math.min(1, (p - (tr.low + tr.high) / 2) / half)) * swing[m];
  };
  /** Where track `i`'s line is at `time` on `run`: rising from under the picture before its first note */
  const pointAt = (i: number, run: LineRun, time: number): { y: number; p: number; shown: number } => {
    if (time < run.start) {
      const u = ease(1 - (run.start - time) / LINE_ENTRY);
      const p = run.path[0].pitch;
      const y1 = yOf(i, p, run.start);
      return { y: box.y + box.h + 24 + (y1 - (box.y + box.h + 24)) * u, p, shown: u };
    }
    const p = runPitch(run, time);
    return { y: yOf(i, p, time) - TOOTH * rollKick(run, time), p, shown: 1 };
  };
  /** A path along `run` from `a` to `b`, with what `each` wants at every sample */
  const trace = (i: number, run: LineRun, a: number, b: number, each?: (u: number, x: number, pt: { y: number; p: number; shown: number }, time: number) => void, begin = true) => {
    // (finely only where a stutter's teeth need it: a long path of many points is slow to stroke)
    const fine = run.rolls.some((r) => r.strikes[0] < b && r.end > a);
    const rate = fine ? LINE_RATE : COARSE_RATE;
    const every = Math.round(rate / 8);
    const count = Math.max(1, Math.ceil((b - a) * rate));
    if (begin) g.beginPath();
    for (let k = 0; k <= count; k++) {
      const time = a + ((b - a) * k) / count;
      const pt = pointAt(i, run, time);
      const x = xOf(time);
      if (k === 0) g.moveTo(x, pt.y);
      else g.lineTo(x, pt.y);
      if (each && (k % every === 0 || k === count)) each(k / count, x, pt, time);
    }
  };

  const heads: Array<{ x: number; y: number; p: number; live: boolean; note: boolean; name: string; since: number; gone: number }> = [];
  const rings: Array<{ x: number; y: number; p: number; u: number }> = [];
  // Where each goes next: every track's line ahead, as one path stroked once
  if (look.ahead) {
    g.beginPath();
    data.tracks.forEach((tr, i) => {
      for (const run of tr.runs) {
        if (run.start - LINE_ENTRY > tRight) break;
        const a = Math.max(run.start - LINE_ENTRY, t);
        const b = Math.min(run.end, tRight);
        if (b > a) trace(i, run, a, b, undefined, false);
      }
    });
    const fade = g.createLinearGradient(headX, 0, box.x + box.w, 0);
    fade.addColorStop(0, 'rgba(200,210,235,0.26)');
    fade.addColorStop(1, 'rgba(200,210,235,0.05)');
    g.strokeStyle = fade;
    g.lineWidth = 1.5;
    g.stroke();
  }
  data.tracks.forEach((tr, i) => {
    for (const run of tr.runs) {
      if (run.start - LINE_ENTRY > tRight) break;
      if (run.end < tLeft) continue;
      const a = Math.max(run.start - LINE_ENTRY, tLeft);
      const b = Math.min(run.end, t);
      if (b <= a) continue;
      if (look.rings) {
        for (let k = firstAt(run.starts, t - RING, (s) => s); k < run.starts.length && run.starts[k] <= t; k++) {
          const pt = pointAt(i, run, run.starts[k]);
          rings.push({ x: xOf(run.starts[k]), y: pt.y, p: pt.p, u: (t - run.starts[k]) / RING });
        }
      }
      const xa = xOf(a);
      const xb = Math.max(xOf(b), xa + 0.01);
      const body = g.createLinearGradient(xa, 0, xb, 0);
      const glow = g.createLinearGradient(xa, 0, xb, 0);
      trace(i, run, a, b, (u, x, pt, time) => {
        // Older line is dimmer
        const age = Math.min(1, (t - time) / (opts.secondsShown * 0.8));
        const k = pt.shown * edge(x);
        body.addColorStop(u, colour(pt.p, (0.95 - 0.5 * age) * k));
        glow.addColorStop(u, colour(pt.p, (0.22 - 0.14 * age) * k));
      });
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = glow;
      g.lineWidth = 16;
      g.stroke();
      g.lineWidth = 8;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = body;
      g.lineWidth = 3;
      g.stroke();

      const live = t <= run.end;
      const at = live ? t : run.end;
      if (at < tLeft) continue;
      const pt = pointAt(i, run, at);
      const note = live && isSounding(run, t);
      let since = 99;
      if (note) {
        const k = firstAt(run.starts, t + 1e-9, (s) => s) - 1;
        if (k >= 0) since = t - run.starts[k];
      }
      heads.push({ x: xOf(at), y: pt.y, p: pt.p, live, note, name: tr.name, since, gone: t - run.end });
    }
  });

  // A ring where each note began
  g.globalCompositeOperation = 'lighter';
  for (const r of rings) {
    const left = 1 - r.u;
    g.strokeStyle = colour(r.p, 0.7 * left * left * edge(r.x));
    g.lineWidth = 2.5 * left + 0.5;
    g.beginPath();
    g.arc(r.x, r.y, 9 + 38 * ease(r.u), 0, TAU);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';

  // The drum row: a fat tick for a kick, a thin tall one for any other hit
  if (drumRow) {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(box.x, floor, headX - box.x, 1);
    for (let i = firstAt(data.hits, tLeft, (h) => h.t); i < data.hits.length && data.hits[i].t <= t; i++) {
      const h = data.hits[i];
      const x = xOf(h.t);
      const a = Math.max(0.16, 0.85 - ((t - h.t) / opts.secondsShown) * 1.2) * edge(x);
      g.fillStyle = `rgba(225,232,255,${a.toFixed(3)})`;
      if (h.kick) g.fillRect(x - 3, floor - 9, 6, 18);
      else g.fillRect(x - 1, floor - 17, 2, 34);
    }
    const f = Math.max(kickFlash, hitFlash * 0.7);
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(headX, floor, 0, headX, floor, 70);
    halo.addColorStop(0, `rgba(200,215,255,${(0.6 * f).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(200,215,255,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(headX, floor, 70, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    const w = 6 + 9 * kickFlash;
    g.fillStyle = `rgba(235,240,255,${(0.45 + 0.55 * f).toFixed(3)})`;
    g.fillRect(headX - w / 2, floor - 9 - 14 * hitFlash, w, 18 + 28 * hitFlash);
  }

  // The dots, and each line's name beside its dot
  const live = heads.filter((h) => h.live).sort((a, b) => a.y - b.y);
  const named = live.length <= MAX_NAMES;
  let lastLabel = -Infinity;
  for (const h of heads) {
    if (h.live) continue;
    // Left behind where the line ended
    g.fillStyle = colour(h.p, Math.max(0.25, 0.8 - h.gone * 0.12) * edge(h.x), 60);
    g.beginPath();
    g.arc(h.x, h.y, 5, 0, TAU);
    g.fill();
  }
  g.font = `500 15px ${FONT}`;
  for (const h of live) {
    // A kick outward as each note starts
    const r = (h.note ? 7 : 5) + 7 * Math.exp(-h.since * 7);
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 4.5);
    halo.addColorStop(0, colour(h.p, h.note ? 0.55 : 0.25));
    halo.addColorStop(1, colour(h.p, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(h.x, h.y, r * 4.5, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = colour(h.p, 1, h.note ? 88 : 72);
    g.beginPath();
    g.arc(h.x, h.y, r, 0, TAU);
    g.fill();
    if (named && h.name) {
      const y = Math.max(h.y, lastLabel + 18);
      lastLabel = y;
      g.fillStyle = h.note ? 'rgba(233,236,243,0.92)' : 'rgba(233,236,243,0.5)';
      g.fillText(h.name, h.x + 20, y, box.x + box.w - h.x - 24);
    }
  }
  if (drumRow) {
    g.fillStyle = 'rgba(233,236,243,0.6)';
    g.fillText('Drums', headX + 20, floor);
  }

  // The song's sections as a strip, filling as the song plays
  g.textBaseline = 'alphabetic';
  if (look.map && opts.duration > 0) {
    const cuts = [0, ...opts.sections.map((s) => s.at).filter((at) => at > 1e-6 && at < opts.duration - 1e-6), opts.duration];
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      const x0 = box.x + (box.w * cuts[i]) / opts.duration;
      const x1 = box.x + (box.w * cuts[i + 1]) / opts.duration - (i + 2 < cuts.length ? 4 : 0);
      const done = Math.min(1, Math.max(0, (t - cuts[i]) / (cuts[i + 1] - cuts[i])));
      g.fillStyle = done > 0 && done < 1 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
      g.fillRect(x0, box.y + 4, x1 - x0, 5);
      g.fillStyle = done < 1 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.34)';
      g.fillRect(x0, box.y + 4, (x1 - x0) * done, 5);
    }
  }

  // The chord sounding and the next one; the section's name
  if (headRow) {
    const base = box.y + (look.map ? 26 : 0) + 58;
    let right = box.x + box.w;
    if (opts.section) {
      let name = '';
      for (const s of opts.sections) {
        if (s.at > t + 1e-6) break;
        name = s.name;
      }
      if (name) {
        g.font = `600 20px ${FONT}`;
        g.fillStyle = '#f59e0b';
        const text = name.toUpperCase();
        const w = Math.min(g.measureText(text).width, box.w * (look.chord ? 0.45 : 1));
        if (look.chord) {
          g.fillText(text, box.x + box.w - w, base, w);
          right = box.x + box.w - w - 24;
        } else g.fillText(text, box.x, base, w);
      }
    }
    if (look.chord) {
      const k = firstAt(opts.chords, t + 1e-6, (c) => c.at) - 1;
      const now = k >= 0 && opts.chords[k].end > t ? opts.chords[k] : null;
      if (now) {
        const pop = Math.exp(-(t - now.at) * 4);
        g.font = `600 ${(56 + 7 * pop).toFixed(1)}px ${FONT}`;
        g.fillStyle = `rgba(255,255,255,${(0.84 + 0.16 * pop).toFixed(3)})`;
        g.fillText(now.name, box.x, base, right - box.x);
        const wide = g.measureText(now.name).width;
        let next: ChordSpan | undefined;
        for (let n = k + 1; n < opts.chords.length && !next; n++) if (opts.chords[n].name !== now.name) next = opts.chords[n];
        if (next && box.x + wide + 22 < right - 60) {
          g.font = `500 22px ${FONT}`;
          g.fillStyle = 'rgba(233,236,243,0.4)';
          g.fillText(`then ${next.name}`, box.x + wide + 22, base, right - box.x - wide - 22);
        }
      }
    }
  }
  g.restore();
}
