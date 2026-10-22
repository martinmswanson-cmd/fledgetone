/**
 * Duck everything to the kick: one click puts a drum-triggered Pump on every part that isn't
 * drums, a voice or a sound effect (the bass, chords, pads and leads), so the whole song breathes
 * with the kick the way dance music does. How deep depends on the style chosen:
 *   - the bass and sub get a "Hole for drums" (a fast dip held while the drum hits, then back) on
 *     the kick AND the snare, so both punch through the low end;
 *   - the chords, pads and leads pump on the kick: 5-7 dB for pumping styles, a little less for
 *     bass music, no more than about 3 dB for future bass and artcore, back within 130-230 ms.
 * When the drums are dense (a syncopated drop with a kick or snare every 16th or two), full-depth
 * holes would chop the bass ten times a bar: the closer the kicks and snares come, the shallower
 * and shorter the holes and the pump (with hits half a beat apart or closer: about 5 dB, back
 * within 60 % of a 16th, as dense bass music ducks), so the bass stays one sound. With a sub part of its own (a sub-bass,
 * a track named "sub", Fledge Synth's Clean Sub) the sub takes the hole and the bass over it a third
 * as deep: the room the kick needs is in the lows.
 * Plain data in and out, so Node can test it; the store makes it one undo step.
 */
import { trackRole } from '../audio/mixCheck';
import { pumpHitOf } from '../audio/instrumentCatalog';
import { FLEDGE_PRESETS, isFledgeUrl } from '../audio/plugins/fledgeMacros';
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
  bass: { label: 'Bass music (dubstep, drumstep)', about: 'A deep hole in the bass for every kick and snare (shallower when the drums are dense); the chords pump a little.', bass: { db: -18, ms: 150 }, music: { db: -5, beats: 0.45 } },
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

/** Kicks and snares this close (beats, the median gap) or closer get the dense ducking; this far apart or more (four on the floor), the style's own. */
export const DENSE_GAP_BEATS = 0.5;
export const SPARSE_GAP_BEATS = 1;
/** The dense ducking: the bass's hole and the music parts' pump at most this deep (dB). */
export const DENSE_HOLE_DB = -5;
export const DENSE_PUMP_DB = -2.5;
/** A bass part over a sub part of its own gets this share of the hole's depth (dB): the room the kick needs is in the lows. */
export const OVER_SUB = 1 / 3;
/** A dense hole is over within this share of a 16th (and never shorter than MIN_HOLE_MS), so it's back before the next hit. */
const HOLE_SHARE = 0.6;
const MIN_HOLE_MS = 60;

/**
 * The median gap (ms) between the song's kick and snare hits (the ones a drum-triggered Pump
 * hears, on drum parts that aren't muted; hits within about 20 ms count as one), or null with
 * fewer than four.
 */
export function drumHitGapMs(tracks: readonly Track[], clips: readonly Clip[], bpm: number): number | null {
  const kits = new Map(tracks.filter((t) => !t.isMuted && !isMixTrack(t) && !isEffect(t) && trackRole(t, clips) === 'drums').map((t) => [t.id, t.instrumentKey]));
  const at: number[] = [];
  for (const c of clips) {
    if (!kits.has(c.trackId) || c.audio) continue;
    for (const n of c.notes) if (n.startOffset < c.lengthBars && pumpHitOf(kits.get(c.trackId), n.note)) at.push(c.startBar + n.startOffset);
  }
  at.sort((a, b) => a - b);
  const barMs = (4 * 60000) / Math.max(1, bpm);
  const hits = at.filter((t, i) => i === 0 || (t - at[i - 1]) * barMs > 20);
  if (hits.length < 4) return null;
  const gaps = hits.slice(1).map((t, i) => (t - hits[i]) * barMs).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** A bass part that is the sub: a sub-bass, a track named "sub", or Fledge Synth on its Clean Sub. */
export function isSubPart(t: Pick<Track, 'instrumentKey' | 'name' | 'plugin'>): boolean {
  if (t.instrumentKey === 'subBass' || /\bsub\b/i.test(t.name)) return true;
  const program = (t.plugin?.state as { program?: unknown } | undefined)?.program;
  return !!t.plugin && isFledgeUrl(t.plugin.url) && typeof program === 'number' && FLEDGE_PRESETS[program] === 'Bass/Clean Sub';
}

/** How dense the drums are at `bpm`: 0 with a median gap of SPARSE_GAP_BEATS or more (or unknown), 1 at DENSE_GAP_BEATS or less. */
const density = (gapMs: number | null | undefined, bpm: number): number => {
  if (gapMs == null || !Number.isFinite(gapMs)) return 0;
  const beats = (gapMs * Math.max(1, bpm)) / 60000;
  return Math.max(0, Math.min(1, (SPARSE_GAP_BEATS - beats) / (SPARSE_GAP_BEATS - DENSE_GAP_BEATS)));
};
const depthOf = (db: number) => Math.round(depthOfDb(db) * 1000) / 1000;

/**
 * The Pump Duck to kick gives a part of `role` in `style` at `bpm`. `gapMs`: how close the kicks
 * and snares come (drumHitGapMs; absent: as the style sets it). `overSub`: a bass part playing
 * over a sub part of its own (its hole a third as deep).
 */
export function duckPump(role: 'bass' | 'music', style: DuckStyle, bpm: number, gapMs?: number | null, overSub = false): { on: true; depth: number; release: number; trigger: PumpTrigger; shape?: PumpShape } {
  const set = DUCK_STYLE_SETTINGS[style];
  const f = density(gapMs, bpm);
  const sixteenth = 15000 / Math.max(1, bpm);
  if (role === 'bass') {
    const db = (set.bass.db + f * (Math.max(set.bass.db, DENSE_HOLE_DB) - set.bass.db)) * (overSub ? OVER_SUB : 1);
    const short = Math.max(MIN_HOLE_MS, Math.min(set.bass.ms, HOLE_SHARE * sixteenth));
    return { on: true, depth: depthOf(db), release: Math.max(PUMP_RELEASE_MIN, Math.round(set.bass.ms + f * (short - set.bass.ms))), trigger: 'kickSnare', shape: 'hole' };
  }
  const back = Math.max(MUSIC_BACK_MS[0], Math.min(MUSIC_BACK_MS[1], releaseMs(set.music.beats, bpm)));
  const quick = Math.max(PUMP_RELEASE_MIN, Math.min(back, sixteenth));
  return { on: true, depth: depthOf(set.music.db + f * (Math.max(set.music.db, DENSE_PUMP_DB) - set.music.db)), release: Math.round(back + f * (quick - back)), trigger: 'kick' };
}

/**
 * The tracks with every bass, chord, pad and lead part ducking to the drums at `bpm` in `style`,
 * and how many changed. With no kick in the song nothing changes.
 */
export function duckToKick(tracks: Track[], clips: readonly Clip[], bpm: number, style: DuckStyle = 'bass'): { tracks: Track[]; changed: number } {
  if (!hasKick(tracks, clips)) return { tracks, changed: 0 };
  const gap = drumHitGapMs(tracks, clips, bpm);
  const parts = tracks.filter((t) => !isMixTrack(t) && !isEffect(t));
  // (A sub is a bass part whatever its notes or name say)
  const roleOf = (t: Track) => (isSubPart(t) ? 'bass' : trackRole(t, clips));
  const basses = parts.filter((t) => roleOf(t) === 'bass');
  const hasSub = basses.some(isSubPart) && basses.some((t) => !isSubPart(t));
  let changed = 0;
  const out = tracks.map((t) => {
    if (isMixTrack(t) || isEffect(t)) return t;
    const role = roleOf(t);
    if (role !== 'bass' && role !== 'music') return t;
    const want = duckPump(role, style, bpm, gap, role === 'bass' && hasSub && !isSubPart(t));
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
