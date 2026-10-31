import { liveMix, initAudio } from './engine';
import { liveContext, liveTransport } from './liveContext';
import { createInstrument, trackInstrumentOptions, type TrackInstrument } from './instruments';
import { createTrackStrip, type TrackStrip } from './effects/trackStrip';
import { scheduledInstrument, trackActivity } from './liveTracks';
import { INSTRUMENTS, type InstrumentKey } from './instrumentCatalog';
import { hasRecordings, loadSamplesForNotes, type RenderRecordings } from './samplers/samplerManager';
import { renderArrangement, encodeWav, type SampleRate } from './exportWav';
import { fitNotesToRange } from '../store/stingers';
import type { Clip, MasterFx, MasterSettings, NoteEvent, Stinger, Track } from '../store/timelineTypes';
import { defaultTrackFx, durationToBars } from '../store/timelineTypes';
import { maxOf, minOf } from '../support/minMax';

/**
 * Stingers out loud: fired over the music in the Game preview, on the next beat or bar the way a
 * game would, and rendered to WAV files for the export.
 */

/**
 * The track a stinger (or a transition's cue) is rendered on for the export (see renderStinger):
 * its strip at 0 dB in the middle, a little of it to the reverb. The previews play through live
 * strips set the same way (see liveStrip), so what's heard is what the kit's file holds.
 */
function stingerTrack(name: string, instrumentKey: InstrumentKey): Track {
  return {
    id: 'stinger',
    name,
    color: '#fff',
    instrumentKey,
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    fx: defaultTrackFx(),
    reverbSend: 0.15,
    delaySend: 0,
  };
}

/**
 * The live strip the previews' instruments of `key` play into, set as the export's (one per kind
 * of sound: a drum kit's is folded to mono as its track's is), made on first use and kept until
 * the page closes.
 */
const strips = new Map<InstrumentKey, TrackStrip>();
function liveStrip(key: InstrumentKey): TrackStrip {
  let strip = strips.get(key);
  if (strip) return strip;
  // (apart from the tracks' solos: a soloed track doesn't silence a stinger, as before)
  strip = createTrackStrip(liveMix.bus, liveMix.busFx, { apartFromSolo: true });
  strip.apply(stingerTrack('stinger', key), { ramp: 0 });
  strips.set(key, strip);
  return strip;
}

/**
 * The instruments stingers, cues and bridges play on, a few per kind of sound (kept until the
 * page closes). Each is lent to one hand-out at a time while that one's notes may still sound, so
 * calling a switch off (which lets go of everything its instrument plays, see handOut) never cuts
 * a sound from an earlier switch still ringing out (an Impact's tail): a later one plays on
 * another of them.
 */
interface Player {
  inst: TrackInstrument;
  /** Audio time until which what it was given may still sound (its notes' ends and a tail) */
  busyUntil: number;
}
const players = new Map<InstrumentKey, Player[]>();
/** How many instruments of one kind at most (past that, the one free soonest is shared) */
const PLAYERS_PER_KIND = 3;
/** Seconds a note is allowed to ring on after its end (its instrument's release, an Impact's tail) */
const RING_ON = 6;

/** An instrument of `key` free from `from` (audio time) on, made if none is. */
function player(key: InstrumentKey, from: number): Player {
  let list = players.get(key);
  if (!list) {
    list = [];
    players.set(key, list);
  }
  let free = list.find((p) => p.busyUntil <= from);
  if (!free && list.length < PLAYERS_PER_KIND) {
    free = { inst: createInstrument(key, liveStrip(key).input, trackInstrumentOptions(stingerTrack('stinger', key))), busyUntil: 0 };
    list.push(free);
  }
  free ??= list.reduce((a, b) => (b.busyUntil < a.busyUntil ? b : a));
  return free;
}

export type StingerTiming = 'bar' | 'beat' | 'now';

/**
 * A note's length at `bpm` from `lateBy` seconds into it, as the live instruments take it: they
 * read a length at the live transport's tempo, which is the song's tempo where it plays now, not
 * the one a stinger or bridge is played at (the export's). Ticks at the live tempo, so its seconds
 * are the export's. Unchanged when the tempos are the same and it isn't late.
 */
function lengthAt(duration: string, bpm: number, lateBy = 0): string {
  const live = liveTransport.bpm.value;
  if (lateBy <= 0 && Math.abs(live - bpm) < 1e-6) return duration;
  const seconds = Math.max(0.01, (durationToBars(duration) * 240) / bpm - lateBy);
  return `${Math.max(1, Math.round((seconds * live * liveTransport.PPQ) / 60))}i`;
}

/** Seconds of a note at `bpm` (for how long its instrument may sound) */
const secondsOf = (n: Pick<NoteEvent, 'duration'>, bpm: number) => (durationToBars(n.duration) * 240) / bpm;

/** Notes handed out by handOut: called off with `cancel` (see there). */
export interface HandedNotes {
  /** Call off the notes not handed out yet, and let go of the ones that were (see handOut). */
  cancel: () => void;
  /** Resolves once every note is handed out (or called off). */
  done: Promise<void>;
}

/** How far ahead of its start a note goes to the instrument (in seconds). */
const HAND_OUT_AHEAD = 0.2;
/**
 * How late a note may still be handed out (seconds after its time; the page's timer came late):
 * at once, cut short by as much, so it ends where it should. Later than that it is left out.
 */
const lateAllowance = () => Math.max(0.1, liveContext.lookAhead);

/**
 * Play notes from `start` (audio time), their offsets in bars at `bpm` (the tempo the export
 * renders them at, whatever the song's tempo where it plays now), each note going to the
 * instrument only a moment before it starts, so a switch called off before then (Stop, Pause,
 * another press) never plays it. If some were handed out already, its instrument lets go (its
 * releaseAll): the ones not started never start, and what it has sounding (a riser leading in)
 * fades with its own release; the instrument is this hand-out's own while it may sound (see
 * player), so nothing else is cut. Once its first note has started, every other note is handed
 * out at once: a stinger or bridge that has started is never called off, and plays out whatever
 * the page does meanwhile (a stall). A note whose time has gone by a little (a late timer) is
 * played at once, part-way: from then to its end; later than lateAllowance it is left out.
 * With `trackId`, the notes play on that track's own live instrument and strip (a written bridge,
 * as the export renders it on the song's tracks), not on one of the pool's.
 */
export function handOut(key: InstrumentKey, notes: readonly NoteEvent[], start: number, bpm: number, late: 'drop' | 'wait' = 'drop', trackId?: string): HandedNotes {
  let cancelled = false;
  let timer = 0;
  let own: Player | null = null;
  let handed = false;
  /** The pool's instrument lent to it, and until when it was free before (given back if nothing went out) */
  let lent: { p: Player; before: number } | null = null;
  let finish = () => {};
  let fail: (e: unknown) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    if (own && handed) own.inst.releaseAll();
    // Nothing handed out: the instrument is free again as it was (unless another took it meanwhile)
    if (lent && !handed && lent.p.busyUntil === lentUntil) lent.p.busyUntil = lent.before;
    finish();
  };
  const secondsPerBar = 240 / bpm;
  const firstOffset = notes.length ? minOf(notes.map((n) => n.startOffset)) : 0;
  const lastEnd = notes.length ? maxOf(notes.map((n) => n.startOffset * secondsPerBar + secondsOf(n, bpm))) : 0;
  /** The busy-until it set on the pool's instrument last (see cancel) */
  let lentUntil = -1;
  void (async () => {
    let p: Player;
    try {
      if (hasRecordings(key)) await loadSamplesForNotes(key, notes);
      if (cancelled) return;
      if (trackId !== undefined) {
        // On the track's own instrument and strip (a written bridge, while the song is paused)
        const inst = scheduledInstrument(trackId);
        if (!inst) return finish();
        trackActivity(trackId, start, lastEnd);
        p = { inst, busyUntil: 0 };
      } else {
        p = player(key, liveContext.currentTime);
        // (lent from now: a switch handed out meanwhile takes another)
        lent = { p, before: p.busyUntil };
        p.busyUntil = lentUntil = Math.max(p.busyUntil, start + lastEnd + RING_ON + 1);
      }
      await p.inst.ready;
      if (cancelled) return;
      own = p;
    } catch (e) {
      fail(e);
      return;
    }
    // ('wait': ready too late for `start`, it all comes a moment later rather than without its first notes)
    const from = late === 'wait' ? Math.max(start, liveContext.currentTime + 0.05 - firstOffset * secondsPerBar) : start;
    if (lent) p.busyUntil = lentUntil = Math.max(p.busyUntil, from + lastEnd + RING_ON);
    const byStart = new Map<number, NoteEvent[]>();
    for (const n of notes) {
      const at = from + n.startOffset * secondsPerBar;
      const group = byStart.get(at);
      if (group) group.push(n);
      else byStart.set(at, [n]);
    }
    const groups = [...byStart].sort((a, b) => a[0] - b[0]);
    const firstAt = groups.length ? groups[0][0] : Infinity;
    let i = 0;
    const pump = () => {
      if (cancelled) return;
      const now = liveContext.currentTime;
      // (started: the rest all at once, see above)
      const started = handed && now >= firstAt;
      for (; i < groups.length && (started || groups[i][0] <= now + HAND_OUT_AHEAD); i++) {
        const [at, group] = groups[i];
        const lateBy = now - at;
        if (lateBy > 0 && lateBy > lateAllowance()) continue;
        const playing = group.map((n) => ({ ...n, duration: lengthAt(n.duration, bpm, Math.max(0, lateBy)) }));
        p.inst.play(playing, Math.max(at, now));
        handed = true;
      }
      if (i >= groups.length) return finish();
      // (next: the next note's hand-out, or its first note's start, after which the rest go at once)
      const next = handed && now < firstAt ? Math.min(firstAt, groups[i][0] - HAND_OUT_AHEAD) : groups[i][0] - HAND_OUT_AHEAD;
      timer = window.setTimeout(pump, Math.max(5, (next - now) * 1000));
    };
    pump();
  })();
  return { cancel, done };
}

/**
 * `stinger` on `at` (audio time) at `bpm` (the song's own tempo, as the export renders it), for a
 * switch that may still be called off before it starts (see handOut); once it has started it
 * plays out. Late (its instrument still loading), it all starts a moment later, as fireStinger does.
 */
export function stingerAt(stinger: Stinger, at: number, bpm: number): HandedNotes {
  return handOut(stinger.instrumentKey, fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range), at, bpm, 'wait');
}

/** The audio time of the next bar or beat line while the song plays (or `null` when stopped). */
export function nextLineTime(unit: 'bar' | 'beat'): number | null {
  if (liveTransport.state !== 'started') return null;
  return liveTransport.nextSubdivision(unit === 'bar' ? '1m' : '4n');
}

/**
 * Play `stinger` over whatever is playing at `bpm` (the song's own tempo, as the export renders
 * it): on the next bar or beat while the song plays, or at once. Resolves with the audio time it
 * starts at.
 */
export async function fireStinger(stinger: Stinger, timing: StingerTiming, bpm: number, atTime?: number): Promise<number> {
  await initAudio();
  const notes = fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range);
  if (hasRecordings(stinger.instrumentKey)) await loadSamplesForNotes(stinger.instrumentKey, notes);
  const p = player(stinger.instrumentKey, liveContext.currentTime);
  // (lent while it gets ready: a switch handed out meanwhile takes another)
  const before = p.busyUntil;
  p.busyUntil = Math.max(before, liveContext.currentTime + 30);
  await p.inst.ready;
  const now = liveContext.currentTime + 0.05;
  const playing = liveTransport.state === 'started';
  // (`atTime`: a context time worked out by the caller, e.g. a transition's line)
  const start = atTime !== undefined ? Math.max(now, atTime) : playing && timing !== 'now' ? Math.max(now, liveTransport.nextSubdivision(timing === 'bar' ? '1m' : '4n')) : now;
  const secondsPerBar = 240 / bpm;
  const byStart = new Map<number, typeof notes>();
  for (const n of notes) {
    const group = byStart.get(n.startOffset);
    if (group) group.push(n);
    else byStart.set(n.startOffset, [n]);
  }
  for (const [at, group] of byStart)
    p.inst.play(
      group.map((n) => ({ ...n, duration: lengthAt(n.duration, bpm) })),
      start + at * secondsPerBar
    );
  p.busyUntil = Math.max(before, start + (notes.length ? maxOf(notes.map((n) => n.startOffset * secondsPerBar + secondsOf(n, bpm))) : 0) + RING_ON);
  return start;
}

interface RenderContext {
  bpm: number;
  masterFx: MasterFx;
  master: MasterSettings;
}

/** A stinger rendered on its own through the song's master section, ringing out, as a WAV. */
export async function renderStinger(stinger: Stinger, song: RenderContext, sampleRate: SampleRate = 44100, recordings: RenderRecordings = 'file'): Promise<Blob> {
  if (hasRecordings(stinger.instrumentKey)) await loadSamplesForNotes(stinger.instrumentKey, fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range));
  const track = stingerTrack(stinger.name, stinger.instrumentKey);
  const clip: Clip = {
    id: 'stinger-clip',
    trackId: track.id,
    name: stinger.name,
    startBar: 1,
    lengthBars: stinger.lengthBars,
    isSelected: false,
    notes: fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range),
  };
  const audio = await renderArrangement({
    tracks: [track],
    clips: [clip],
    bpm: song.bpm,
    swing: 0,
    masterFx: song.masterFx,
    master: song.master,
    startBar: 1,
    endBar: 1 + stinger.lengthBars,
    ending: 'ringOut',
    sampleRate,
    recordings,
  });
  return encodeWav(audio, 16, []);
}
