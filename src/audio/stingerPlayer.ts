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
  if (hasRecordings(key)) await loadSamplesForNotes(key, notes);
  const inst = player(key);
  await inst.ready;
  const now = liveContext.currentTime;
  const secondsPerBar = 240 / liveTransport.bpm.value;
  for (const n of notes) {
    const at = start + n.startOffset * secondsPerBar;
    if (at >= now) inst.play([n], at);
  }
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
