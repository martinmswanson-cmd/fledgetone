import { liveTransport } from './liveContext';
import { getLiveInstrument } from './liveTracks';
import { safely } from './instruments';
import { recordMidi } from './recorder';
import { firstRepeatAfter, gridTicks, repeatSeconds, repeatTicks, repeatVelocity } from '../store/noteRepeat';
import type { NoteRepeatRate } from '../store/noteRepeat';

/**
 * Note repeat, live: the pads held down with it on, each played again at the rate while it's held.
 * A timer looks a little ahead and schedules each repeat on the audio clock: while the song plays,
 * on the Transport's grid (the ticks a note drawn at that rate would have), so a repeat lands with
 * the clips' notes and is recorded on its grid line; while it's stopped, every so many seconds at
 * the song's tempo from the strike. Each repeat is recorded as a hit of its own (recorder.ts), its
 * velocity the pad's pressure when the pad sends aftertouch (see repeatVelocity).
 *
 * Times here are the graph's (what the clock renders), as clip notes are scheduled; a repeat is
 * recorded at the same time, which the take turns into the Transport position there, so it lands on
 * exactly the tick it played on. (A repeat whose grid line the listener heard before the timer got
 * to it plays at once, a moment late, and is still recorded on its line.)
 */

/** How far ahead repeats are scheduled, seconds, and how often the timer looks */
const LOOKAHEAD = 0.12;
const PERIOD_MS = 25;

interface Held {
  midi: number;
  name: string;
  trackId: string;
  rate: NoteRepeatRate;
  struck: number;
  /** The pad's latest pressure (0 to 1), once it has sent any */
  pressure?: number;
  /** While playing: the last tick scheduled (repeats come after it) */
  lastTick: number;
  /** While stopped: the audio time of the last hit */
  lastTime: number;
  /** Whether it was scheduled against the running Transport (a start or stop restarts the count) */
  playing: boolean;
}

const held = new Map<number, Held>();
let timer = 0;
let clock: () => number = () => 0;

const running = () => liveTransport.state === 'started';

/** Play and record one repeat of `h` at audio time `at`. */
function hit(h: Held, at: number, seconds: number): void {
  const now = clock();
  const time = Math.max(at, now);
  const velocity = repeatVelocity(h.struck, h.pressure);
  const instrument = getLiveInstrument(h.trackId);
  if (instrument) safely(() => instrument.play([{ note: h.name, duration: '32n', velocity }], time));
  // Recorded where it was meant to land, as a short hit
  recordMidi({ kind: 'noteOn', note: h.midi, velocity, name: h.name }, at);
  recordMidi({ kind: 'noteOff', note: h.midi }, at + seconds / 2);
}

function pump(): void {
  const now = clock();
  const bpm = liveTransport.bpm.value;
  for (const h of held.values()) {
    const seconds = repeatSeconds(h.rate, bpm);
    if (running()) {
      const step = repeatTicks(h.rate, liveTransport.PPQ);
      const ticksNow = liveTransport.getTicksAtTime(now);
      const tickSeconds = 60 / (bpm * liveTransport.PPQ);
      // Started since the pad went down, or the loop came round: count from here
      if (!h.playing || h.lastTick > ticksNow + LOOKAHEAD / tickSeconds + step) {
        h.lastTick = h.playing ? ticksNow - 1 : firstRepeatAfter(ticksNow, step);
        h.playing = true;
      }
      for (const tick of gridTicks(h.lastTick, ticksNow + LOOKAHEAD / tickSeconds, step)) {
        hit(h, now + (tick - ticksNow) * tickSeconds, seconds);
        h.lastTick = tick;
      }
    } else {
      // Stopped since the last look: count from now
      if (h.playing) h.lastTime = now;
      h.playing = false;
      while (h.lastTime + seconds <= now + LOOKAHEAD) {
        h.lastTime += seconds;
        hit(h, h.lastTime, seconds);
      }
    }
  }
}

/**
 * A pad went down with note repeat on: repeat `name` (MIDI note `midi`) on `trackId` at `rate`
 * until noteRepeatOff. `struckAt` is when its first hit played (audio time), `struckTick` the
 * Transport tick the player heard it on, while the song plays.
 */
export function noteRepeatOn(o: { midi: number; name: string; trackId: string; rate: NoteRepeatRate; velocity: number; struckAt: number; struckTick: number | null; now: () => number }): void {
  clock = o.now;
  const step = repeatTicks(o.rate, liveTransport.PPQ);
  held.set(o.midi, {
    midi: o.midi,
    name: o.name,
    trackId: o.trackId,
    rate: o.rate,
    struck: o.velocity,
    lastTick: o.struckTick !== null ? firstRepeatAfter(o.struckTick, step) : 0,
    lastTime: o.struckAt,
    playing: o.struckTick !== null,
  });
  if (!timer) timer = window.setInterval(pump, PERIOD_MS);
  pump();
}

/** The pad let go: no more repeats of it. */
export function noteRepeatOff(midi: number): void {
  held.delete(midi);
  if (!held.size && timer) {
    clearInterval(timer);
    timer = 0;
  }
}

/** Stop every repeat (Stop, the window losing focus, a panic). */
export function stopNoteRepeats(): void {
  for (const midi of [...held.keys()]) noteRepeatOff(midi);
}

/** Pressure (aftertouch) of one pad (`midi`), or of all of them (channel pressure: undefined). */
export function noteRepeatPressure(midi: number | undefined, value: number): void {
  for (const h of held.values()) if (midi === undefined || h.midi === midi) h.pressure = Math.max(0, Math.min(1, value));
}

/** Whether any pad is repeating (for tests and the activity light). */
export const repeatingPads = (): number => held.size;
