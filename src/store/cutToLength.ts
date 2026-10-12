import type { Clip, Marker } from './timelineTypes';

/**
 * Cut to length: make a 15, 30 or 60-second version of a song (an ad, a trailer, a social clip) by
 * dropping or repeating whole sections, the way an editor cuts music to picture. Sections are the
 * stretches between markers (or 8-bar phrases in a song without any). The cut always ends with the
 * song's own ending, keeps the sections in order, and prefers the busiest and most important parts
 * (a drop or a chorus over an intro). The tempo can then be nudged a little so it lasts exactly
 * the length asked. This file plans the cut; the store rebuilds the clips. No audio or store here,
 * so Node can unit-test it.
 */

export interface Section {
  name: string;
  /** Bars, 1-based, end exclusive */
  from: number;
  to: number;
  /** How much it should be kept: busier and named like a main part scores higher */
  weight: number;
}

const EPS = 1e-6;
/** How far the tempo may be nudged to make the length exact (8%). */
export const MAX_TEMPO_NUDGE = 0.08;
const MAIN = /drop|chorus|hook|main|theme|combat|boss|climax|peak|verse/i;
const LIGHT = /intro|break|bridge|interlude|silence|build/i;

/** The end of the music: the last clip's end, rounded up to a whole bar. */
export function songEnd(clips: readonly Clip[]): number {
  const end = clips.reduce((e, c) => Math.max(e, c.startBar + c.lengthBars), 1);
  return Math.ceil(end - EPS);
}

/** The song's sections, from its bar markers (hit points locked to time don't count). */
export function songSections(clips: readonly Clip[], markers: readonly Marker[]): Section[] {
  const end = songEnd(clips);
  if (end <= 1) return [];
  const cuts = markers
    .filter((m) => m.anchor === 'bar' && m.bar > 1 + EPS && m.bar < end - EPS)
    .map((m) => ({ bar: Math.round(m.bar), name: m.name }))
    .filter((c, i, all) => c.bar > 1 && c.bar < end && all.findIndex((o) => o.bar === c.bar) === i)
    .sort((a, b) => a.bar - b.bar);
  const atStart = markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - 1) < EPS);
  let bounds: Array<{ bar: number; name: string }>;
  if (cuts.length) bounds = [{ bar: 1, name: atStart?.name ?? 'Start' }, ...cuts];
  else {
    const phrase = end - 1 >= 16 ? 8 : 4;
    bounds = [];
    for (let b = 1; b < end; b += phrase) bounds.push({ bar: b, name: `Bars ${b}-${Math.min(end, b + phrase) - 1}` });
  }
  const sections = bounds.map((b, i) => ({ name: b.name, from: b.bar, to: bounds[i + 1]?.bar ?? end }));
  // Busier sections matter more: notes (and audio) per bar, scaled to the busiest
  const busy = sections.map((s) => {
    let n = 0;
    for (const c of clips) {
      const a = Math.max(s.from, c.startBar);
      const b = Math.min(s.to, c.startBar + c.lengthBars);
      if (b <= a + EPS) continue;
      if (c.audio) n += 4 * (b - a);
      for (const note of c.notes) {
        const at = c.startBar + note.startOffset;
        if (at >= s.from - EPS && at < s.to - EPS && note.startOffset < c.lengthBars - EPS) n += 1;
      }
    }
    return n / (s.to - s.from);
  });
  const top = Math.max(1e-9, ...busy);
  return sections.map((s, i) => ({
    ...s,
    weight: busy[i] / top + (MAIN.test(s.name) ? 0.6 : 0) - (LIGHT.test(s.name) ? 0.3 : 0),
  }));
}

export interface CutPlan {
  /** Section indexes in the order they play (a repeat appears twice) */
  order: number[];
  bars: number;
}

const barsOf = (sections: readonly Section[], order: readonly number[]) => order.reduce((n, i) => n + sections[i].to - sections[i].from, 0);

/**
 * Pick sections so the cut lasts about `targetBars`. Close enough that a tempo nudge of up to
 * MAX_TEMPO_NUDGE fixes it is as good as exact; among those, the most important music wins,
 * then the fewest jumps. Longer than the song, the most important middle section repeats.
 */
export function planCut(sections: readonly Section[], targetBars: number): CutPlan | null {
  const n = sections.length;
  if (!n || !(targetBars > 0)) return null;
  const last = n - 1;
  const total = barsOf(sections, sections.map((_, i) => i));
  const miss = (bars: number) => {
    const err = Math.abs(bars - targetBars) / targetBars;
    return err <= MAX_TEMPO_NUDGE ? 0 : err;
  };

  if (targetBars > total * (1 + MAX_TEMPO_NUDGE)) {
    // Longer: repeat the best section that isn't the ending (or the opening, when there's a choice)
    const middle = sections.map((s, i) => ({ s, i })).filter(({ i }) => i !== last && (i !== 0 || n <= 2));
    const pool = middle.length ? middle : [{ s: sections[0], i: 0 }];
    const best = pool.reduce((a, b) => (b.s.weight > a.s.weight ? b : a)).i;
    const order = sections.map((_, i) => i);
    let bars = total;
    const len = sections[best].to - sections[best].from;
    while (bars + len / 2 < targetBars && bars + len <= 400) {
      order.splice(order.indexOf(best) + 1, 0, best);
      bars += len;
    }
    return { order, bars };
  }

  // Shorter (or about the same): which of the sections before the ending to keep
  const before = last;
  let best: { order: number[]; bars: number; key: [number, number, number] } | null = null;
  const consider = (order: number[]) => {
    const bars = barsOf(sections, order);
    const weight = order.reduce((w, i) => w + sections[i].weight, 0);
    let jumps = 0;
    for (let k = 1; k < order.length; k++) if (order[k] !== order[k - 1] + 1) jumps++;
    const key: [number, number, number] = [miss(bars), -weight, jumps];
    const better = !best || key[0] < best.key[0] - 1e-9 || (Math.abs(key[0] - best.key[0]) < 1e-9 && (key[1] < best.key[1] - 1e-9 || (Math.abs(key[1] - best.key[1]) < 1e-9 && key[2] < best.key[2])));
    if (better) best = { order, bars, key };
  };
  if (before <= 16) {
    for (let mask = 0; mask < 1 << before; mask++) {
      const order: number[] = [];
      for (let i = 0; i < before; i++) if (mask & (1 << i)) order.push(i);
      order.push(last);
      consider(order);
    }
  } else {
    // Many sections: drop the least important ones one at a time while that gets closer
    let order = sections.map((_, i) => i);
    consider(order);
    while (order.length > 1 && barsOf(sections, order) > targetBars) {
      const candidates = order.filter((i) => i !== last);
      const drop = candidates.reduce((a, b) => (sections[b].weight < sections[a].weight ? b : a));
      order = order.filter((i) => i !== drop);
      consider(order);
    }
  }
  const picked = best as { order: number[]; bars: number } | null;
  return picked ? { order: picked.order, bars: picked.bars } : null;
}

/** The tempo that makes `bars` last `seconds`, if it's within the nudge allowed of `bpm`. */
export function exactTempo(bars: number, seconds: number, bpm: number): number | null {
  const exact = Math.round(((bars * 240) / seconds) * 100) / 100;
  return Math.abs(exact - bpm) / bpm <= MAX_TEMPO_NUDGE + 1e-9 && exact >= 40 && exact <= 240 ? exact : null;
}
