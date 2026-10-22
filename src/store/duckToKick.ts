/**
 * Duck everything to the kick: one click puts a drum-triggered Pump on every part that isn't
 * drums, a voice or a sound effect (the bass, chords, pads and leads), so the whole song breathes
 * with the kick the way dance music does. How deep depends on the style chosen:
 *   - the bass and sub get a "Hole for drums" (a fast dip held while the drum hits, then back) on
 *     the kick AND the snare, so both punch through the low end;
 *   - the chords, pads and leads pump on the kick: 5-7 dB for pumping styles, a little less for
 *     bass music, no more than about 3 dB for future bass and artcore, back within 130-230 ms.
 * Plain data in and out, so Node can test it; the store makes it one undo step.
 */
import { trackRole } from '../audio/mixCheck';
import { depthOfDb, type PumpShape } from '../audio/effects/duckShape';
import { isMixTrack } from './buses';
import { isEffect } from './glueMix';
import { PUMP_RELEASE_MAX, PUMP_RELEASE_MIN, type Clip, type PumpTrigger, type Track } from './timelineTypes';
import type { HitStyleId } from '../audio/hitTargets';

export const DUCK_STYLES = ['pumping', 'bass', 'future'] as const;
export type DuckStyle = (typeof DUCK_STYLES)[number];

/** Each style's ducking: the bass parts' hole (dB, length ms) and the music parts' pump (dB, how long back in beats, kept within 130-230 ms). */
export const DUCK_STYLE_SETTINGS: Record<DuckStyle, { label: string; about: string; bass: { db: number; ms: number }; music: { db: number; beats: number } }> = {
  pumping: { label: 'Pumping (house, darksynth)', about: 'Everything pumps hard with the kick.', bass: { db: -14, ms: 150 }, music: { db: -6, beats: 0.5 } },
  bass: { label: 'Bass music (dubstep, drumstep)', about: 'A deep hole in the bass for every kick and snare; the chords pump a little.', bass: { db: -18, ms: 150 }, music: { db: -5, beats: 0.45 } },
  future: { label: 'Future bass / artcore', about: 'Lush chords that barely dip; the bass makes room for the kick and snare.', bass: { db: -12, ms: 140 }, music: { db: -2, beats: 0.4 } },
};

/** The duck style that suits a "Does it hit?" style. */
export const duckStyleFor = (style: HitStyleId | undefined): DuckStyle => (style === 'futurebass' ? 'future' : style === 'dubstep' || style === 'drumstep' ? 'bass' : style ? 'pumping' : 'bass');

/** The music parts come back within this range (ms). */
const MUSIC_BACK_MS: [number, number] = [130, 230];

/** A release of `beats` at `bpm`, in ms, kept within the Pump's range. */
export const releaseMs = (beats: number, bpm: number): number =>
  Math.round(Math.max(PUMP_RELEASE_MIN, Math.min(PUMP_RELEASE_MAX, (beats * 60000) / Math.max(1, bpm))));

/** Whether the song has a kick to duck to: a drum part. */
export function hasKick(tracks: readonly Track[], clips: readonly Clip[]): boolean {
  return tracks.some((t) => !isMixTrack(t) && !isEffect(t) && trackRole(t, clips) === 'drums');
}

/** The Pump Duck to kick gives a part of `role` in `style` at `bpm`. */
export function duckPump(role: 'bass' | 'music', style: DuckStyle, bpm: number): { on: true; depth: number; release: number; trigger: PumpTrigger; shape?: PumpShape } {
  const set = DUCK_STYLE_SETTINGS[style];
  if (role === 'bass') return { on: true, depth: Math.round(depthOfDb(set.bass.db) * 1000) / 1000, release: set.bass.ms, trigger: 'kickSnare', shape: 'hole' };
  const back = Math.max(MUSIC_BACK_MS[0], Math.min(MUSIC_BACK_MS[1], releaseMs(set.music.beats, bpm)));
  return { on: true, depth: Math.round(depthOfDb(set.music.db) * 1000) / 1000, release: back, trigger: 'kick' };
}

/**
 * The tracks with every bass, chord, pad and lead part ducking to the drums at `bpm` in `style`,
 * and how many changed. With no kick in the song nothing changes.
 */
export function duckToKick(tracks: Track[], clips: readonly Clip[], bpm: number, style: DuckStyle = 'bass'): { tracks: Track[]; changed: number } {
  if (!hasKick(tracks, clips)) return { tracks, changed: 0 };
  let changed = 0;
  const out = tracks.map((t) => {
    if (isMixTrack(t) || isEffect(t)) return t;
    const role = trackRole(t, clips);
    if (role !== 'bass' && role !== 'music') return t;
    const want = duckPump(role, style, bpm);
    const pump: Track['fx']['pump'] = { ...t.fx.pump, ...want };
    delete pump.source;
    if (!want.shape) delete pump.shape;
    delete pump.points;
    const was = t.fx.pump;
    if (was.on && was.depth === pump.depth && was.release === pump.release && was.trigger === pump.trigger && !was.source && (was.shape ?? 'smooth') === (pump.shape ?? 'smooth') && !was.points) return t;
    changed++;
    return { ...t, fx: { ...t.fx, pump } };
  });
  return { tracks: changed ? out : tracks, changed };
}
