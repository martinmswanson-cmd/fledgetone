/**
 * Duck everything to the kick: one click puts a kick-triggered Pump on every part that isn't
 * drums, a voice or a sound effect (the bass, chords, pads and leads), so the whole song breathes
 * with the kick the way dance music does. The bass ducks deepest and comes back quickest, out of
 * the kick's way; the other parts dip less and swell back over about half a beat, which is the
 * pumping you hear. Plain data in and out, so Node can test it; the store makes it one undo step.
 */
import { trackRole } from '../audio/mixCheck';
import { isMixTrack } from './buses';
import { isEffect } from './glueMix';
import { PUMP_RELEASE_MAX, PUMP_RELEASE_MIN, type Clip, type Track } from './timelineTypes';

/** How far each kind of part ducks (0 to 1). */
export const DUCK_DEPTH = { bass: 0.8, music: 0.6 } as const;
/** How long each takes to come back, in beats: the bass before the next offbeat, the rest by it. */
export const DUCK_RELEASE_BEATS = { bass: 0.3, music: 0.5 } as const;

/** A release of `beats` at `bpm`, in ms, kept within the Pump's range. */
export const releaseMs = (beats: number, bpm: number): number =>
  Math.round(Math.max(PUMP_RELEASE_MIN, Math.min(PUMP_RELEASE_MAX, (beats * 60000) / Math.max(1, bpm))));

/** Whether the song has a kick to duck to: a drum part. */
export function hasKick(tracks: readonly Track[], clips: readonly Clip[]): boolean {
  return tracks.some((t) => !isMixTrack(t) && !isEffect(t) && trackRole(t, clips) === 'drums');
}

/**
 * The tracks with every bass, chord, pad and lead part pumping to the kick at `bpm`, and how many
 * changed. With no kick in the song nothing changes.
 */
export function duckToKick(tracks: Track[], clips: readonly Clip[], bpm: number): { tracks: Track[]; changed: number } {
  if (!hasKick(tracks, clips)) return { tracks, changed: 0 };
  let changed = 0;
  const out = tracks.map((t) => {
    if (isMixTrack(t) || isEffect(t)) return t;
    const role = trackRole(t, clips);
    if (role !== 'bass' && role !== 'music') return t;
    const pump = { ...t.fx.pump, on: true, depth: DUCK_DEPTH[role], release: releaseMs(DUCK_RELEASE_BEATS[role], bpm), trigger: 'kick' as const };
    delete pump.source;
    const was = t.fx.pump;
    if (was.on && was.depth === pump.depth && was.release === pump.release && was.trigger === 'kick' && !was.source) return t;
    changed++;
    return { ...t, fx: { ...t.fx, pump } };
  });
  return { tracks: changed ? out : tracks, changed };
}
