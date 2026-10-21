/**
 * Legato on the monophonic instruments: when a note joins the one before it (glides to it, or
 * carries on without a new attack when it's the same pitch, a tie), and the order a legato plugin
 * must hear the notes in. Pure logic, no Web Audio, so Node's tests cover it.
 */

/**
 * Seconds a note may start after the previous note's end and still join it. Notes drawn end to
 * end (the piano roll's Legato tool writes them so) land within a hair of each other once their
 * bar positions become seconds, either side of the exact end.
 */
export const LEGATO_JOIN = 0.001;

/** Whether a note starting at `start` joins the note sounding until `end`: it starts before that note ends, or within LEGATO_JOIN of it. */
export function joinsNote(start: number, end: number): boolean {
  return start < end + LEGATO_JOIN;
}

/** A timed plugin event, as the built-in plugin host queues them (WAM events). */
export interface TimedEvent {
  type: string;
  time: number;
  data?: { bytes?: number[] } | unknown;
}

/**
 * Put `ev` into `events`, which are in time order, keeping that order. With `join` above 0, a
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
  if (join > 0) {
    const k = kind(ev);
    if (k === 1) while (i > 0 && kind(events[i - 1]) === -1 && events[i - 1].time >= ev.time - join) i--;
    else if (k === -1) while (i < events.length && kind(events[i]) === 1 && events[i].time <= ev.time + join) i++;
  }
  events.splice(i, 0, ev);
}
