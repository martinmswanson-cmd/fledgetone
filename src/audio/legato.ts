/**
 * Legato on the monophonic instruments: when a note joins the one before it (glides to it, or
 * carries on without a new attack when it's the same pitch, a tie), and the order a legato plugin
 * must hear the notes in. Pure logic, no Web Audio, so Node's tests cover it.
 */

/**
 * Seconds a note must overlap the previous one to join it. Notes drawn end to end stay separate
 * notes, each with its own attack, as in other studios: a bassline of repeated 8ths keeps its
 * rhythm. To glide or tie, a note overlaps the next (the piano roll's Legato tool writes them so).
 * The margin keeps notes that only touch apart once their bar positions become seconds.
 */
export const LEGATO_JOIN = 0.001;

/** Whether a note starting at `start` joins the note sounding until `end`: it starts more than LEGATO_JOIN before that note ends. */
export function joinsNote(start: number, end: number): boolean {
  return start < end - LEGATO_JOIN;
}

/** A timed plugin event, as the built-in plugin host queues them (WAM events). */
export interface TimedEvent {
  type: string;
  time: number;
  data?: { bytes?: number[] } | unknown;
}

/**
 * Put `ev` into `events`, which are in time order, keeping that order. Notes that only touch (a
 * note-off and a note-on less than a microsecond apart, as a note's end and the next one's start
 * come out once bar positions become seconds) stay apart: the note-off first, whichever way the
 * rounding fell, so a mono synth ends the note and strikes the next instead of joining them by
 * chance. With `join` above 0, a
 * note-on goes ahead of note-offs up to `join` seconds before it, and a note-off after note-ons
 * up to `join` seconds after it: a note drawn to start where the last one ends then starts while
 * that one is still held, so a synth in Legato mode joins them (glides, or ties the same pitch)
 * instead of ending the note and striking a new one.
 *
 * Sent to the plugins' AudioWorklet as source text (see processor.ts), so it reads nothing from
 * outside itself.
 */
export function insertTimedEvent(events: TimedEvent[], ev: TimedEvent, join: number): void {
  const kind = (e: TimedEvent) => {
    const b = e.type === 'wam-midi' ? (e.data as { bytes?: number[] } | undefined)?.bytes : undefined;
    if (!b) return 0;
    const status = b[0] & 0xf0;
    if (status === 0x90 && b[2] > 0) return 1;
    if (status === 0x80 || status === 0x90) return -1;
    return 0;
  };
  let i = events.length;
  while (i > 0 && events[i - 1].time > ev.time) i--;
  const k = kind(ev);
  if (join > 0) {
    if (k === 1) while (i > 0 && kind(events[i - 1]) === -1 && events[i - 1].time >= ev.time - join) i--;
    else if (k === -1) while (i < events.length && kind(events[i]) === 1 && events[i].time <= ev.time + join) i++;
  } else {
    // (A microsecond: far under a sample, and far under any note's length)
    if (k === 1) while (i < events.length && kind(events[i]) === -1 && events[i].time <= ev.time + 1e-6) i++;
    else if (k === -1) while (i > 0 && kind(events[i - 1]) === 1 && events[i - 1].time >= ev.time - 1e-6) i--;
  }
  events.splice(i, 0, ev);
}

/**
 * Whether `ev` is a pitch bend for `time` or after (dropped at a jump or Stop: see
 * TrackInstrument.bend). Sent to the plugins' AudioWorklet as source text, like insertTimedEvent.
 */
export function isBendAfter(ev: TimedEvent, time: number): boolean {
  const b = ev.type === 'wam-midi' ? (ev.data as { bytes?: number[] } | undefined)?.bytes : undefined;
  return !!b && (b[0] & 0xf0) === 0xe0 && ev.time >= time;
}

/**
 * How a one-note instrument took the note it began last to its pitch (see TrackInstrument.slide),
 * so a layer under it (the Sub enhancer) slides as it does: from the pitch it was at, or from
 * `from` (Hz: the last note's), over `seconds`, along an exponential ramp that gets there then
 * ('ramp': Web Audio's exponentialRampToValueAtTime, Tone's portamento) or an approach with a time
 * constant of slideConstant(seconds) ('target': setTargetAtTime). null where it began on it.
 */
export interface NoteSlide {
  seconds: number;
  curve: 'ramp' | 'target';
  from?: number;
}

/** The time constant a 'target' slide of `seconds` approaches its pitch with. */
export function slideConstant(seconds: number): number {
  return Math.max(0.003, seconds) / 3;
}

/** The pitch (Hz) a slide from `f0` to `f1` begun at `t0` (none: a jump there) is at by `at`. */
export function slidePitchAt(f0: number, f1: number, t0: number, slide: NoteSlide | null, at: number): number {
  if (at < t0) return f0;
  if (!slide) return f1;
  if (slide.curve === 'target') return f1 + (f0 - f1) * Math.exp(-(at - t0) / slideConstant(slide.seconds));
  if (slide.seconds <= 0 || at >= t0 + slide.seconds) return f1;
  return f0 * (f1 / f0) ** ((at - t0) / slide.seconds);
}

/** A note held from `start` until `end` (Infinity: not let go yet) at `freq` (see lowestHeld). */
export interface HeldSpan {
  start: number;
  end: number;
  freq: number;
}

/**
 * Seconds apart two times of lowestHeld may be and still be one moment: a note's end and the next
 * one's start, worked out from bar positions in floating point, can miss each other by a hair
 * (1e-16 s). A microsecond is far under a sample and far under any note.
 */
export const SAME_MOMENT = 1e-6;

/**
 * Which of `spans` is the lowest sounding, through time: the stretches [from, to) each is (by its
 * index), in time order, for a layer that follows one note of a chord (the Sub enhancer under an
 * instrument that plays many notes at once). Two at the same pitch: the one begun last (played
 * again, it's the new note the instrument strikes), then the one given first. Times less than
 * SAME_MOMENT apart are taken as one (the latest of them), so notes that only touch touch.
 */
export function lowestHeld(spans: readonly HeldSpan[]): Array<{ index: number; from: number; to: number }> {
  const all = [...new Set(spans.flatMap((s) => (s.end > s.start ? [s.start, s.end] : [])))].filter(Number.isFinite).sort((a, b) => a - b);
  // (Each time as the moment it's part of: a run of times each within SAME_MOMENT of the one before, as the last of them)
  const moment = new Map<number, number>();
  const times: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (i + 1 < all.length && all[i + 1] - all[i] < SAME_MOMENT) continue;
    let k = i;
    while (k > 0 && all[k] - all[k - 1] < SAME_MOMENT) moment.set(all[--k], all[i]);
    times.push(all[i]);
  }
  const at = (t: number) => moment.get(t) ?? t;
  const out: Array<{ index: number; from: number; to: number }> = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    let index = -1;
    spans.forEach((s, k) => {
      if (at(s.start) <= t && t < at(s.end) && (index < 0 || s.freq < spans[index].freq || (s.freq === spans[index].freq && s.start > spans[index].start))) index = k;
    });
    const to = i + 1 < times.length ? times[i + 1] : Infinity;
    if (index < 0) continue;
    const last = out[out.length - 1];
    if (last && last.index === index && last.to === t) last.to = to;
    else out.push({ index, from: t, to });
  }
  // (The last stretch runs to its note's end: Infinity until it's let go)
  const last = out[out.length - 1];
  if (last) last.to = Math.min(last.to, at(spans[last.index].end));
  return out;
}

/**
 * lowestHeld's stretches, each marked `touches` when it starts where the one before it ends (the
 * lowest note passing straight to another), and `goesOn` when it also is at the same pitch (a note
 * struck again over one held, or the held one given back to when that ends): a layer that follows
 * the lowest note keeps its tone going there rather than starting a new one, which would come in
 * at another phase and cancel or add to the last as they cross.
 */
export function lowestRuns(spans: readonly HeldSpan[]): Array<{ index: number; from: number; to: number; touches: boolean; goesOn: boolean }> {
  const out = lowestHeld(spans);
  return out.map((o, i) => {
    const last = out[i - 1];
    // (Within SAME_MOMENT, as lowestHeld takes times)
    const touches = !!last && Math.abs(o.from - last.to) < SAME_MOMENT;
    return { ...o, touches, goesOn: touches && spans[last.index].freq === spans[o.index].freq };
  });
}

/**
 * How a layer under a chord's lowest note (the Sub enhancer) is shaped anew where it goes straight
 * on under the next note, begun at `noteStart`, from `at` (see subLayer's takeOver). Struck there
 * (`at` within `attack` of its start): up to its level with an attack's time constant. Given back
 * to partway (`back`: the note before has ended): there as that note's end would fall, over
 * `release` (40 dB in that time, settled by 1.5 times it), rising or falling, for a fall as quick
 * as an attack would click. `level` (a share of the note's peak) is where a `decay` (seconds to
 * fall 60 dB, 0: none) has taken that note's own by `settled`, when the decay goes on from;
 * `ends` the earliest the layer may stop (it has died away: Infinity without a decay).
 */
export function takeOverShape(
  noteStart: number,
  at: number,
  decay: number,
  attack: number,
  release: number
): { back: boolean; constant: number; settled: number; level: number; ends: number } {
  const back = at > noteStart + attack;
  const settled = at + (back ? release * 1.5 : attack);
  const level = decay > 0 ? Math.exp((-Math.max(0, (back ? settled : at) - noteStart) * Math.log(1000)) / decay) : 1;
  return {
    back,
    constant: back ? release / Math.log(100) : attack / 3,
    settled,
    level,
    ends: decay > 0 ? Math.max(settled, noteStart + attack + decay * 1.05) : Infinity,
  };
}
