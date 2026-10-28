/**
 * Bounce to pad: a stretch of the song (the whole mix, or one track as it sounds in it) rendered
 * into a sound in the library and put on a Drum Rack pad, ready to play like any other hit; and a
 * recording (a vocal take) put on a pad whole, or chopped at its hits onto the pads of a new Drum
 * Rack. Each is one undo step, the new track included. Pocket and the studio both use these; the
 * maths (which pad, the rack, the level) is in bounceToPad.ts.
 */
import { create } from 'zustand';
import { masterFxOf, songGeneration, songTempo, useTimelineStore } from './timelineStore';
import type { DrumRack } from './timelineTypes';
import { tempoAt } from '../audio/tempoMap';
import { audibleTracks, channelsOf, ditherSeedOf, encodeChannels, renderArrangement, SAMPLE_RATES, type RenderOptions, type SampleRate } from '../audio/exportWav';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { liveMix } from '../audio/engine';
import { ENVELOPE_HOP } from '../audio/slicing';
import { soundEnvelope } from '../audio/slicerTools';
import { PLAYBACK_DB } from './freezeActions';
import { chopStarts, chopsToRack } from './sampleFlip';
import { BOUNCE_TRACK_NAME, choosePadTarget, fillPad, padFromClip, padLevel, type PadSound, type PadTarget } from './bounceToPad';

/** A bounce under way: how far along (0 to 1), and what of. Null when none is. */
export const usePadBounce = create<{ fraction: number | null; label: string }>(() => ({ fraction: null, label: '' }));

/** A bounce may be up to this big (16-bit stereo: about 6 minutes at 44.1 kHz). */
const MAX_BOUNCE_BYTES = 64 * 1024 * 1024;

export interface BounceRequest {
  /** The bars to bounce, [from, to) */
  from: number;
  to: number;
  /** Only this track (as it sounds in the mix: its level, pan and sends); absent: the whole mix */
  trackId?: string;
  /** The sound's and pad's name */
  name: string;
  /** The track (and pad) to put it on; absent: the first empty pad, or a new track */
  target?: { trackId?: string | null; pad?: number };
}

/** Where a sound went: the track and pad, and whether the track is new. */
export interface PadPlaced {
  trackId: string;
  pad: number;
  trackName: string;
  newTrack: boolean;
}

/** What to say when a sound landed on a pad (`what`: its name, quoted). */
export const placedMessage = (what: string, p: PadPlaced): string =>
  `${what} is on pad ${p.pad + 1} of ${p.newTrack ? `a new Drum Rack track, ${p.trackName}: play it from its pads` : p.trackName}`;

/**
 * Put `sound` on the pad `target` says (a new Drum Rack track for none), one undo step.
 * `newName`: the new track's name.
 */
function placeOnPad(target: PadTarget, sound: PadSound, newName: string): PadPlaced {
  const s = useTimelineStore.getState();
  if (target.trackId) {
    const track = s.tracks.find((t) => t.id === target.trackId)!;
    s.setTrackRack(track.id, fillPad(track.rack, target.pad, sound), true);
    return { trackId: track.id, pad: target.pad, trackName: track.name, newTrack: false };
  }
  // (addTrack is the undo step; the rack and sends go in with it)
  const id = s.addTrack('drumRack', newName);
  useTimelineStore.getState().setTrackRack(id, fillPad(undefined, 0, sound), false);
  // A bounce already has its reverb and echo in it: the new track sends none
  useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === id ? { ...t, reverbSend: 0, delaySend: 0 } : t)) }));
  return { trackId: id, pad: 0, trackName: useTimelineStore.getState().tracks.find((t) => t.id === id)?.name ?? newName, newTrack: true };
}

/**
 * Render bars [from, to) of the song (or one track of it) and put the sound on a pad. Playback
 * stops first (a render swaps the global audio context while it sets up). The render leaves out
 * the master section and the master volume, which the pad plays through again, and is stored
 * normalised (peak at -0.2 dBFS) with the pad's gain putting its level back. Null when another
 * bounce is under way, or the song changed while it rendered; rejects with a message to show.
 */
export async function bounceRangeToPad(req: BounceRequest): Promise<PadPlaced | null> {
  if (usePadBounce.getState().fraction !== null) return null;
  const s = useTimelineStore.getState();
  const from = Math.max(1, req.from);
  const to = req.to;
  if (!(to > from)) throw new Error('there is nothing between those bars');
  const only = req.trackId ? s.tracks.find((t) => t.id === req.trackId) : undefined;
  if (req.trackId && !only) throw new Error('that track is gone');
  // One track: it alone sounds (through the buses it plays into), as it is in the mix
  const tracks = only ? s.tracks.map((t) => ({ ...t, isSoloed: t.id === only.id, isMuted: t.id === only.id ? false : t.isMuted })) : s.tracks;
  const audible = new Set(audibleTracks(tracks).map((t) => t.id));
  if (!s.clips.some((c) => audible.has(c.trackId) && c.startBar < to && c.startBar + c.lengthBars > from)) {
    throw new Error(only ? `${only.name} plays nothing there` : 'nothing plays there');
  }
  const song = songGeneration();
  s.pause();
  usePadBounce.setState({ fraction: 0, label: req.name });
  try {
    const rate = liveMix.bus.context.sampleRate;
    const sampleRate: SampleRate = (SAMPLE_RATES as readonly number[]).includes(rate) ? (rate as SampleRate) : 48000;
    const opts: RenderOptions = {
      // (it plays in the song: the recordings as live playback has them, as a freeze does)
      recordings: 'playback',
      tracks,
      clips: s.clips,
      bpm: s.bpm,
      tempoPoints: s.tempoPoints,
      swing: s.swing,
      startBar: from,
      endBar: to,
      masterFx: masterFxOf(s),
      // Exactly the bars, so the pad loops in time with them
      ending: 'exact',
      sampleRate,
      bypassMaster: true,
      intensity: { value: s.intensity, curves: s.intensityCurves },
      // No ceiling: the level is set below, and the pad's gain puts it back
      peakCeilingDbtp: 60,
    };
    const audio = await renderArrangement(opts, (f) => usePadBounce.setState({ fraction: Math.min(0.99, f) }));
    const channels = channelsOf(audio);
    let peak = 0;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const level = padLevel(peak, PLAYBACK_DB);
    if (!level) throw new Error('it is silent there');
    const stored = channels.map((ch) => {
      const out = ch.slice();
      for (let i = 0; i < out.length; i++) out[i] *= level.scale;
      return out;
    });
    const meta = await importSoundFile(encodeChannels(stored, sampleRate, 16, [], undefined, ditherSeedOf(req.name)), `${req.name}.wav`, MAX_BOUNCE_BYTES);
    if (songGeneration() !== song) return null; // another song opened while it rendered
    const target = choosePadTarget(useTimelineStore.getState().tracks, req.target);
    return placeOnPad(target, { soundId: meta.id, name: req.name, gainDb: level.gainDb }, BOUNCE_TRACK_NAME);
  } finally {
    usePadBounce.setState({ fraction: null, label: '' });
  }
}

/** The sound an audio clip plays, as a pad (its stretch of the sound, its gain), or null. */
function clipPad(clipId: string): PadSound | null {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) return null;
  const seconds = useSoundLibrary.getState().metas[clip.audio.soundId]?.seconds;
  if (!seconds) return null;
  return padFromClip(clip, seconds, tempoAt(clip.startBar, songTempo(s)));
}

/**
 * Put a recording (an audio clip, such as a vocal take) on a pad: the stretch of its sound the
 * clip plays, at its clip gain. One undo step. `newName`: a new Drum Rack track's name, when one is
 * needed. Null when the clip has no sound (or it isn't loaded).
 */
export function clipToPad(clipId: string, target?: { trackId?: string | null; pad?: number }, newName = BOUNCE_TRACK_NAME): PadPlaced | null {
  const sound = clipPad(clipId);
  if (!sound) return null;
  return placeOnPad(choosePadTarget(useTimelineStore.getState().tracks, target), sound, newName);
}

/**
 * Chop a recording at its hits (up to `count`) onto the pads of a new Drum Rack track, chop 1 on
 * pad 1, one cutting off another; no clip is written (play them from the pads). One undo step.
 * Returns the new track's id and how many chops, or null when the clip has no sound.
 */
export async function chopClipToPads(clipId: string, count = 8): Promise<{ trackId: string; chops: number } | null> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  const part = clipPad(clipId);
  if (!clip?.audio || !part) return null;
  await decodeSound(part.soundId, liveMix.bus.context.sampleRate);
  const env = soundEnvelope(part.soundId);
  if (!env) return null;
  const seconds = useSoundLibrary.getState().metas[part.soundId]?.seconds ?? 0;
  const start = part.start ?? 0;
  const end = part.end ?? seconds;
  const cuts = chopStarts(env, ENVELOPE_HOP, start, end, 'transients', count, 0.5);
  if (!cuts.length) return null;
  const rack: DrumRack = chopsToRack({ id: part.soundId, name: clip.name }, cuts, end);
  // The take's clip gain on every chop
  const pads = rack.pads.map((p) => (p.soundId ? { ...p, gain: Math.round(part.gainDb * 100) / 100 } : p));
  const st = useTimelineStore.getState();
  const id = st.addTrack('drumRack', `${clip.name} chops`.slice(0, 40));
  useTimelineStore.getState().setTrackRack(id, { pads }, false);
  return { trackId: id, chops: cuts.length };
}
