/**
 * Scores as plain data, for the Classics starters: notes in quarter notes (a pitch, where it
 * starts and how long it lasts), packed into short strings so a whole piece fits in a source file,
 * a small text notation for lines written by hand, and the pianist's and string player's helpers
 * the arrangements use: where the sustain pedal changes, a dynamics curve read at any moment, and
 * the notes between two points. Pure, so Node tests it (scripts/scoreNotes.test.mjs).
 *
 * The packed form: one token per chord (notes that start and end together), separated by spaces,
 * each `start.length.pitches[.velocity]` in base 36: the start counted from the previous token's,
 * both in 48ths of a quarter note (so triplets and 64ths land exactly), the MIDI pitches joined by
 * `_`, and a velocity (0 to 35) only where it changes.
 */

/** A note of a score: a MIDI pitch, its start and length in quarter notes, and its velocity (0 to 1) when the score has one. */
export interface ScoreNote {
  pitch: number;
  start: number;
  dur: number;
  vel?: number;
}

/** The packed form's time unit: 48 to a quarter note. */
export const SCORE_TICKS = 48;
const VEL_STEPS = 35;

/** The notes of a packed score (see the file's header). */
export function unpackScore(packed: string): ScoreNote[] {
  const out: ScoreNote[] = [];
  let at = 0;
  let vel: number | undefined;
  for (const token of packed.split(' ')) {
    if (!token) continue;
    const [dt, dur, pitches, v] = token.split('.');
    at += parseInt(dt, 36);
    if (v !== undefined) vel = parseInt(v, 36) / VEL_STEPS;
    for (const p of pitches.split('_')) out.push({ pitch: parseInt(p, 36), start: at / SCORE_TICKS, dur: parseInt(dur, 36) / SCORE_TICKS, ...(vel !== undefined ? { vel } : {}) });
  }
  return out;
}

/** A score packed (the inverse of unpackScore, to the nearest 48th of a quarter and 35th of velocity). */
export function packScore(notes: readonly ScoreNote[], withVelocity = false): string {
  const ns = notes
    .map((n) => ({ s: Math.round(n.start * SCORE_TICKS), d: Math.max(1, Math.round(n.dur * SCORE_TICKS)), p: n.pitch, v: withVelocity ? Math.round((n.vel ?? 0) * VEL_STEPS) : undefined }))
    .sort((a, b) => a.s - b.s || a.d - b.d || a.p - b.p);
  const groups: Array<{ s: number; d: number; v?: number; p: number[] }> = [];
  for (const n of ns) {
    const g = groups[groups.length - 1];
    if (g && g.s === n.s && g.d === n.d && g.v === n.v) g.p.push(n.p);
    else groups.push({ s: n.s, d: n.d, v: n.v, p: [n.p] });
  }
  let last = 0;
  let lastV: number | undefined;
  return groups
    .map((g) => {
      const t = [(g.s - last).toString(36), g.d.toString(36), g.p.map((p) => p.toString(36)).join('_')];
      if (g.v !== undefined && g.v !== lastV) t.push(g.v.toString(36));
      last = g.s;
      lastV = g.v;
      return t.join('.');
    })
    .join(' ');
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A note name's MIDI pitch: C4 is 60; sharps (#, ##) and flats (b) as written ('B#3' is 60). */
export function pitchOf(name: string): number {
  const m = /^([A-G])(##|#|bb|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Not a note: ${name}`);
  const acc = { '##': 2, '#': 1, bb: -2, b: -1 }[m[2] ?? ''] ?? 0;
  return 12 * (Number(m[3]) + 1) + STEPS[m[1]] + acc;
}

/**
 * A line written by hand: tokens `pitch:length` (length in quarter notes, a number or a fraction:
 * `F#5:1`, `D5:1/2`, `A4:3/4`), chords joined with `+` (`D4+F#4:2`), `r:length` a rest, a `~` after a token ties
 * it to the same pitch next (`A4:1/2~ | A4:1/2`), and `|`
 * between bars, where the bar's length is checked (`barQuarters`), so a slip shows at once.
 */
export function parseLine(text: string, barQuarters = 4, from = 0): ScoreNote[] {
  const out: ScoreNote[] = [];
  let at = from;
  let barStart = from;
  let bar = 1;
  const tied = new Map<number, ScoreNote>();
  const quarters = (s: string) => {
    const [a, b] = s.split('/');
    const v = b === undefined ? Number(a) : Number(a) / Number(b);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Bad length "${s}" in bar ${bar}`);
    return v;
  };
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|') {
      if (Math.abs(at - barStart - barQuarters) > 1e-6) throw new Error(`Bar ${bar} lasts ${at - barStart} quarters, not ${barQuarters}`);
      barStart = at;
      bar++;
      continue;
    }
    const tie = token.endsWith('~');
    const [notes, len] = (tie ? token.slice(0, -1) : token).split(':');
    if (len === undefined) throw new Error(`No length on "${token}" in bar ${bar}`);
    const d = quarters(len);
    if (notes !== 'r')
      for (const n of notes.split('+')) {
        const pitch = pitchOf(n);
        // A note tied from the one before it (across a bar line) lengthens that one
        const held = tied.get(pitch);
        if (held && Math.abs(held.start + held.dur - at) < 1e-9) held.dur += d;
        else out.push({ pitch, start: at, dur: d });
      }
    tied.clear();
    if (tie) for (const n of out) if (Math.abs(n.start + n.dur - at - d) < 1e-9) tied.set(n.pitch, n);
    at += d;
  }
  return out;
}

/** The notes moved `quarters` later and `semitones` up. */
export const shiftNotes = (notes: readonly ScoreNote[], quarters: number, semitones = 0): ScoreNote[] => notes.map((n) => ({ ...n, start: n.start + quarters, pitch: n.pitch + semitones }));

/** The notes starting in [from, to), cut to end by `to`. */
export function notesBetween(notes: readonly ScoreNote[], from: number, to: number): ScoreNote[] {
  return notes.filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9).map((n) => (n.start + n.dur > to ? { ...n, dur: to - n.start } : n));
}

/** A curve through [time, value] points, read at `t` (straight lines between them, flat past the ends). */
export function curveAt(points: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (!points.length) return 0;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Where a pianist changes the pedal for clean harmony: where a new bass note sounds. A note of
 * `bass` (the left hand) counts when it's the lowest note starting within `window` quarters
 * either side of it, and either lower than every note since the last change or at least `hold`
 * quarters after it, so a rolling arpeggio holds one pedal from its bass note through its top.
 */
export function bassChanges(bass: readonly ScoreNote[], window = 1, hold = 4): number[] {
  const sorted = [...bass].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: number[] = [];
  let lastPitch = -1;
  for (const n of sorted) {
    if (out.length && n.start - out[out.length - 1] < 1e-6) continue;
    const near = sorted.filter((m) => Math.abs(m.start - n.start) <= window + 1e-9);
    if (near.some((m) => m.pitch < n.pitch)) continue;
    const since = out.length ? n.start - out[out.length - 1] : Infinity;
    // Under everything since the last change (a new, lower bass), or a held-long-enough new pitch
    const lowest = sorted.filter((m) => m.start >= (out[out.length - 1] ?? -Infinity) - 1e-9 && m.start < n.start - 1e-9).reduce((a, m) => Math.min(a, m.pitch), Infinity);
    if (since < hold - 1e-6 && (n.pitch === lastPitch || n.pitch >= lowest)) continue;
    out.push(n.start);
    lastPitch = n.pitch;
  }
  return out;
}

/**
 * The sustain pedal for changes at `changes` (quarter notes): up at each change and down again a
 * moment later (`catchAfter`), after the new notes have sounded, so the old harmony stops and the
 * new one is caught (a legato pedal), as points [time in quarters, 0 or 1]. Up at `end`.
 */
export function pedalPoints(changes: readonly number[], end: number, catchAfter = 1 / 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of [...changes].sort((a, b) => a - b)) {
    if (c >= end) break;
    if (out.length && c - out[out.length - 1][0] < catchAfter * 2) continue;
    out.push([c, 0], [Math.min(end, c + catchAfter), 1]);
  }
  out.push([end, 0]);
  return out;
}
