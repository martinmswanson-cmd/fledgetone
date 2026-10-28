/**
 * The sample-flipping actions: chop a sample onto a Drum Rack's pads (with a starting pattern),
 * a new idea for that pattern, matching the song to a sample or a sample to the song (its tempo
 * and key), and the bass cut. Each is one undo step. The maths is in sampleFlip.ts,
 * sampleAnalysis.ts and pitchShift.ts.
 */
import { songTempo, useTimelineStore } from './timelineStore';
import type { Clip, NoteEvent, SoundMeta } from './timelineTypes';
import { barsToDuration, uid } from './timelineTypes';
import { chopEnd, chopsToRack, flipPattern, flipSeed, bassCutFilter } from './sampleFlip';
import { padNote } from './sampleKits';
import { detectKey, type SongKey } from './songKey';
import { tempoAt, secondsToBar, barToSeconds } from '../audio/tempoMap';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/wavFile';
import { runDsp } from '../audio/dspRun';
import { SHIFT_VERSION } from './shiftVersion';
import { keyShift } from '../audio/sampleAnalysis';

/** The rate re-pitched copies are made at. */
const SHIFT_RATE = 44100;
/** How long the "Chop and play" pattern is, bars. */
export const FLIP_BARS = 2;

export interface ChopRequest {
  soundId: string;
  /** The track's and pads' name */
  name: string;
  /** Where the chops start in the sound, seconds, ascending (see sampleFlip.ts) */
  cuts: number[];
  /** The end of the chopped part */
  end: number;
  fade: number;
  choke: boolean;
  /** Write a pattern that plays the chops in a new order (else they play in order, as the sample did) */
  flip: boolean;
  /** Turn the bass cut on for the new track */
  bassCut: boolean;
  /** The audio clip it came from: the new track goes under its track, the clip where it is */
  clipId?: string;
}

/** Which "New idea" each flip clip is on, so the next one is new (in this session; any idea can come back by Undo). */
const ideas = new Map<string, number>();

/** Notes playing the chops in order, at their own times in the sound, at `bpm`. */
function inOrder(cuts: readonly number[], end: number, bpm: number): Array<Omit<NoteEvent, 'id'>> {
  const barsPerSecond = bpm / 240;
  return cuts.map((at, i) => ({ note: padNote(i), startOffset: (at - cuts[0]) * barsPerSecond, duration: barsToDuration((chopEnd(cuts, i, end) - at) * barsPerSecond), velocity: 0.9 }));
}

/**
 * "Chop sample": a new Drum Rack track with the chops on its pads (pad 1 the first chop), and a
 * clip that plays them, in a new order ("Chop and play") or as they were. Returns the new track's id.
 */
export function chopToRack(req: ChopRequest): string | null {
  const s = useTimelineStore.getState();
  const source = req.clipId ? s.clips.find((c) => c.id === req.clipId) : undefined;
  const sourceTrack = source ? s.tracks.find((t) => t.id === source.trackId) : undefined;
  if (!req.cuts.length) return null;
  const rack = chopsToRack({ id: req.soundId, name: req.name }, req.cuts, req.end, { fade: req.fade, choke: req.choke });
  // One undo step: adding the track is it, the rest goes in with it
  const trackId = s.addTrack('drumRack', `${req.name} chops`.slice(0, 40));
  const after = useTimelineStore.getState();
  after.setTrackRack(trackId, rack, false);
  if (req.bassCut) after.setTrackFx(trackId, 'filter', bassCutFilter(true), false);
  const startBar = source?.startBar ?? Math.max(1, Math.floor(after.playheadPosition));
  const bpm = tempoAt(startBar, songTempo(after));
  const notes = req.flip ? flipPattern(req.cuts.length, flipSeed(req.soundId, 0)) : inOrder(req.cuts, req.end, bpm);
  const tempo = songTempo(after);
  const lengthBars = req.flip
    ? FLIP_BARS
    : Math.max(1 / 16, Math.ceil((secondsToBar(barToSeconds(startBar, tempo) + (req.end - req.cuts[0]), tempo) - startBar) * 16) / 16);
  const clip: Clip = {
    id: uid('clip'),
    trackId,
    name: req.flip ? `${req.name} flip` : `${req.name} chops`,
    startBar,
    lengthBars,
    notes: notes.map((n) => ({ ...n, id: uid('note') })),
    isSelected: true,
  };
  if (req.flip) ideas.set(clip.id, 0);
  useTimelineStore.setState((st) => {
    const track = st.tracks.find((t) => t.id === trackId)!;
    const rest = st.tracks.filter((t) => t.id !== trackId);
    const at = sourceTrack ? rest.findIndex((t) => t.id === sourceTrack.id) + 1 : rest.length;
    const placed = sourceTrack?.folder ? { ...track, folder: sourceTrack.folder } : track;
    return {
      tracks: [...rest.slice(0, at), placed, ...rest.slice(at)],
      clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip],
    };
  });
  return trackId;
}

/** The chops a Drum Rack track's clip plays: how many pads in a row from pad 1 hold a chop, and their sound. */
export function rackChops(trackId: string): { count: number; soundId: string } | null {
  const track = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  const pads = track?.rack?.pads ?? [];
  let count = 0;
  while (count < pads.length && pads[count].soundId && pads[count].start !== undefined) count++;
  return count ? { count, soundId: pads[0].soundId! } : null;
}

/** "New idea": the flip clip's notes become the next pattern for its chops. One undo step per click. */
export function newFlipIdea(clipId: string): boolean {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  const chops = clip ? rackChops(clip.trackId) : null;
  if (!clip || !chops) return false;
  const idea = (ideas.get(clipId) ?? 0) + 1;
  ideas.set(clipId, idea);
  const bars = Math.max(1, Math.round(clip.lengthBars));
  s.checkpoint();
  s.setClipNotes(clipId, flipPattern(chops.count, flipSeed(chops.soundId, idea), bars).map((n) => ({ ...n, id: uid('note') })));
  return true;
}

/** Turn a track's bass cut on or off (its Filter insert as a steep high-pass). */
export function setBassCut(trackId: string, on: boolean): void {
  useTimelineStore.getState().setTrackFx(trackId, 'filter', bassCutFilter(on), true);
}

/** The song's tempo set to a sample's. */
export function matchSongTempo(bpm: number): void {
  const s = useTimelineStore.getState();
  s.checkpoint();
  s.setBpm(bpm);
}

/** The audio clip follows the song's tempo from the tempo its sample was found at (time-stretched, same pitch). */
export function stretchClipToSong(clipId: string, sampleBpm: number): void {
  useTimelineStore.getState().setClipStretch(clipId, sampleBpm);
}

/** The key the song's notes are in, or null with no pitched notes. */
export function songKeyNow(): SongKey | null {
  const s = useTimelineStore.getState();
  return detectKey(s.clips, s.tracks);
}

/**
 * A copy of sound `original` moved `shift` semitones, kept in the sound library (named after it, or
 * `fallbackName`): same length, same timing, new key.
 */
export async function shiftedSound(original: string, shift: number, fallbackName: string): Promise<SoundMeta> {
  const source = await decodeSound(original, SHIFT_RATE);
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
  // (The phase vocoder for anything tonal, in a Worker: see pitchShift.ts)
  const moved = await runDsp({ kind: 'pitch', semitones: shift }, channels, SHIFT_RATE);
  const base = (useSoundLibrary.getState().metas[original]?.name ?? fallbackName).replace(/\.[a-z0-9]+$/i, '');
  const name = `${base} (${shift > 0 ? '+' : ''}${shift} st).wav`;
  return importSoundFile(new Blob([encodeChannels(moved, SHIFT_RATE, 24)], { type: 'audio/wav' }), name);
}

/**
 * Move an audio clip's sample by `semitones` (from the sound it had before any move), as a
 * re-pitched copy kept in the sound library: same length, same timing, new key. 0 goes back to the
 * original. One undo step.
 */
export async function shiftClip(clipId: string, semitones: number): Promise<void> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  const audio = clip?.audio;
  if (!clip || !audio) throw new Error('That clip has no audio');
  const original = audio.shiftedFrom ?? audio.soundId;
  const shift = Math.round(semitones * 100) / 100;
  if (Math.abs(shift) < 0.01) {
    if (audio.shiftedFrom) s.setClipAudio(clipId, { soundId: original, shiftedFrom: undefined, shift: undefined, shiftVersion: undefined }, true);
    return;
  }
  const sound = await shiftedSound(original, shift, clip.name);
  useTimelineStore.getState().setClipAudio(clipId, { soundId: sound.id, shiftedFrom: original, shift, shiftVersion: SHIFT_VERSION }, true);
}

/** The semitones that move a sample in `sampleKey` (sitting `cents` off A440) into the song's key, or null with no song key. */
export function shiftToSong(sampleKey: SongKey, cents: number): { semitones: number; key: SongKey } | null {
  const key = songKeyNow();
  return key ? { semitones: keyShift(sampleKey, key, cents), key } : null;
}
