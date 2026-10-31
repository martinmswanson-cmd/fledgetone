import { liveMix, initAudio } from './engine';
import { liveContext, liveTransport } from './liveContext';
import { createInstrument, type TrackInstrument } from './instruments';
import { INSTRUMENTS, type InstrumentKey } from './instrumentCatalog';
import { hasRecordings, loadSamplesForNotes, type RenderRecordings } from './samplers/samplerManager';
import { renderArrangement, encodeWav, type SampleRate } from './exportWav';
import { fitNotesToRange } from '../store/stingers';
import type { Clip, MasterFx, MasterSettings, NoteEvent, Stinger, Track } from '../store/timelineTypes';
import { defaultTrackFx } from '../store/timelineTypes';

/**
 * Stingers out loud: fired over the music in the Game preview, on the next beat or bar the way a
 * game would, and rendered to WAV files for the export.
 */

/** One instrument per kind of sound, shared by every stinger that uses it (kept until the page closes). */
const players = new Map<InstrumentKey, TrackInstrument>();

function player(key: InstrumentKey): TrackInstrument {
  let inst = players.get(key);
  if (!inst) {
    inst = createInstrument(key, liveMix.auditionInput);
    players.set(key, inst);
  }
  return inst;
}

export type StingerTiming = 'bar' | 'beat' | 'now';

/**
 * Play notes on a shared instrument from `start` (audio time), their offsets in bars; notes that
 * would start in the past are left out. For the Game preview's transitions.
 */
export async function playNotesAt(key: InstrumentKey, notes: readonly NoteEvent[], start: number): Promise<void> {
  await handOut(key, notes, start).done;
}

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
 * Play notes on a shared instrument from `start` (audio time), their offsets in bars, the way
 * playNotesAt does, but each note goes to the instrument only a moment before it starts, so a
 * switch called off before then (Stop, Pause, another press) never plays it. If some were handed
 * out already, the instrument lets go (its releaseAll): the ones not started never start, and
 * what it has sounding (a riser leading in) fades with its own release. A switch is called off
 * only before its line, so a stinger or bridge that has started is never called off: it plays out.
 */
export function handOut(key: InstrumentKey, notes: readonly NoteEvent[], start: number, late: 'drop' | 'wait' = 'drop'): HandedNotes {
  let cancelled = false;
  let timer = 0;
  let inst: TrackInstrument | null = null;
  let handed = false;
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
    if (inst && handed) inst.releaseAll();
    finish();
  };
  void (async () => {
    try {
      if (hasRecordings(key)) await loadSamplesForNotes(key, notes);
      const p = player(key);
      await p.ready;
      if (cancelled) return;
      inst = p;
    } catch (e) {
      fail(e);
      return;
    }
    // ('wait': ready too late for `start`, it all comes a moment later rather than without its first notes)
    const from = late === 'wait' ? Math.max(start, liveContext.currentTime + 0.05) : start;
    const secondsPerBar = 240 / liveTransport.bpm.value;
    const byStart = new Map<number, NoteEvent[]>();
    for (const n of notes) {
      const at = from + n.startOffset * secondsPerBar;
      byStart.set(at, [...(byStart.get(at) ?? []), n]);
    }
    const groups = [...byStart].sort((a, b) => a[0] - b[0]);
    let i = 0;
    const pump = () => {
      if (cancelled || !inst) return;
      const now = liveContext.currentTime;
      for (; i < groups.length && groups[i][0] <= now + HAND_OUT_AHEAD; i++) {
        const [at, group] = groups[i];
        if (at < now) continue;
        inst.play(group, at);
        handed = true;
      }
      if (i < groups.length) timer = window.setTimeout(pump, Math.max(5, (groups[i][0] - HAND_OUT_AHEAD - now) * 1000));
      else finish();
    };
    pump();
  })();
  return { cancel, done };
}

/**
 * `stinger` on `at` (audio time), for a switch that may still be called off before it starts
 * (see handOut); once it has started it plays out. Late (its instrument still loading), it all
 * starts a moment later, as fireStinger does.
 */
export function stingerAt(stinger: Stinger, at: number): HandedNotes {
  return handOut(stinger.instrumentKey, fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range), at, 'wait');
}

/** The audio time of the next bar or beat line while the song plays (or `null` when stopped). */
export function nextLineTime(unit: 'bar' | 'beat'): number | null {
  if (liveTransport.state !== 'started') return null;
  return liveTransport.nextSubdivision(unit === 'bar' ? '1m' : '4n');
}

/**
 * Play `stinger` over whatever is playing: on the next bar or beat while the song plays, or at
 * once. Resolves with the audio time it starts at.
 */
export async function fireStinger(stinger: Stinger, timing: StingerTiming, atTime?: number): Promise<number> {
  await initAudio();
  if (hasRecordings(stinger.instrumentKey)) await loadSamplesForNotes(stinger.instrumentKey, fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range));
  const inst = player(stinger.instrumentKey);
  await inst.ready;
  const now = liveContext.currentTime + 0.05;
  const playing = liveTransport.state === 'started';
  // (`atTime`: a context time worked out by the caller, e.g. a transition's line)
  const start = atTime !== undefined ? Math.max(now, atTime) : playing && timing !== 'now' ? Math.max(now, liveTransport.nextSubdivision(timing === 'bar' ? '1m' : '4n')) : now;
  const secondsPerBar = 240 / liveTransport.bpm.value;
  const notes = fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range);
  const byStart = new Map<number, typeof notes>();
  for (const n of notes) byStart.set(n.startOffset, [...(byStart.get(n.startOffset) ?? []), n]);
  for (const [at, group] of byStart) inst.play(group, start + at * secondsPerBar);
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
  const track: Track = {
    id: 'stinger',
    name: stinger.name,
    color: '#fff',
    instrumentKey: stinger.instrumentKey,
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
