/**
 * Bus presets: one-click group-bus setups, the inserts a mix engineer reaches for on each kind of
 * group, made from the effects a bus already has (see buses.ts and TrackFx):
 *   - Drum bus: glue compression and a little saturation, so the kit hits as one.
 *   - 808 / bass bus: the low end in the middle (Mono bass under 120 Hz), saturation for harmonics
 *     small speakers can play, gentle compression to even the notes.
 *   - Vocal bus: a low cut, a little less boxiness and more air (Pro EQ), compression, and a
 *     de-esser (the Multiband compressor squeezing only the "s" range, over 5.5 kHz).
 *   - Music bus: a low cut that leaves the bottom to the bass, a gentle dip in the mud, light glue.
 * Each also says which tracks belong on it, by what they do (trackRole), for grouping them in one go.
 * Pure: no store or audio, so Node tests it.
 */
import { isDropTrack } from './dropMoves';
import { defaultPeqBands, defaultTrackFx, type Track, type TrackFx, type Clip } from './timelineTypes';
import { trackRole, type TrackRole } from '../audio/mixCheck';

export type BusPresetId = 'drums' | 'bass' | 'vocals' | 'music';

export interface BusPreset {
  id: BusPresetId;
  name: string;
  /** One line on what it does, for its button's tooltip. */
  about: string;
  /** The tracks it gathers when grouping. */
  role: TrackRole;
}

export const BUS_PRESETS: readonly BusPreset[] = [
  { id: 'drums', name: 'Drum bus', about: 'Glue compression and a little saturation, so the kit hits as one.', role: 'drums' },
  { id: 'bass', name: '808 / bass bus', about: 'Keeps everything under 120 Hz in the middle, adds harmonics small speakers can play, and evens out the notes.', role: 'bass' },
  { id: 'vocals', name: 'Vocal bus', about: 'A low cut, less boxiness, more air, compression and a de-esser to tame the "s" sounds.', role: 'vocal' },
  { id: 'music', name: 'Music bus', about: 'Leaves the low end to the bass, dips the mud and glues the parts lightly.', role: 'music' },
];

export const busPresetById = (id: BusPresetId): BusPreset => BUS_PRESETS.find((p) => p.id === id)!;

/** A track's inserts with the preset's on top: the inserts it uses are set, everything else is left as it was. */
export function busPresetFx(id: BusPresetId, base: TrackFx = defaultTrackFx()): TrackFx {
  const d = defaultTrackFx();
  const bands = defaultPeqBands();
  switch (id) {
    case 'drums':
      return {
        ...base,
        compressor: { on: true, threshold: -16, ratio: 4, makeup: 2 },
        saturate: { on: true, amount: 0.3, mix: 0.5 },
      };
    case 'bass':
      return {
        ...base,
        monoLow: { on: true, freq: 120 },
        saturate: { on: true, amount: 0.45, mix: 0.35 },
        compressor: { on: true, threshold: -14, ratio: 3, makeup: 1 },
      };
    case 'vocals':
      return {
        ...base,
        peq: {
          on: true,
          bands: [
            { ...bands[0], on: true, freq: 90 },
            { ...bands[1], gain: 0 },
            { ...bands[2], freq: 300, gain: -2, q: 1.2 },
            { ...bands[3], freq: 3000, gain: 0 },
            { ...bands[4], freq: 10000, gain: 2.5 },
            bands[5],
          ],
        },
        compressor: { on: true, threshold: -20, ratio: 3, makeup: 3 },
        // The de-esser: only the top band (over 5.5 kHz) is squeezed, fast, when an "s" pushes it up
        mbc: {
          on: true,
          lowFreq: 200,
          highFreq: 5500,
          attack: 0.002,
          release: 0.08,
          bands: [
            { ...d.mbc.bands[0], bypass: true },
            { ...d.mbc.bands[1], bypass: true },
            { threshold: -32, ratio: 6, gain: 0 },
          ],
        },
      };
    case 'music':
      return {
        ...base,
        peq: {
          on: true,
          bands: [
            { ...bands[0], on: true, freq: 80 },
            { ...bands[1], gain: 0 },
            { ...bands[2], freq: 350, gain: -1.5, q: 1 },
            { ...bands[3], gain: 0 },
            { ...bands[4], freq: 9000, gain: 1 },
            bands[5],
          ],
        },
        compressor: { on: true, threshold: -22, ratio: 2, makeup: 1.5 },
        saturate: { on: true, amount: 0.15, mix: 0.3 },
      };
  }
}

/**
 * The tracks a preset's bus would gather: the instrument tracks (not buses or returns) that do the
 * preset's job and play straight to the master (a track already on a bus stays there).
 */
export function busPresetMembers(id: BusPresetId, tracks: readonly Track[], clips: readonly Clip[], isMix: (t: Track) => boolean): Track[] {
  const role = busPresetById(id).role;
  // (Not the Drop pad: it makes no sound, and on a bus its moves would hang on the bus's mute and solo)
  return tracks.filter((t) => !isMix(t) && !t.output && !isDropTrack(t) && trackRole(t, clips) === role);
}
