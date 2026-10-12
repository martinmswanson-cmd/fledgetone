import { DRUM_NOTES } from '../audio/scheduler';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import type { ProjectSnapshot } from './project';
import type { AutomationLane, Clip, InstrumentKey, MasterSettings, Track, TrackFx, WobbleRate } from './timelineTypes';
import { DEFAULT_MASTER_FX, defaultMasterSettings, defaultTrackFx, uid } from './timelineTypes';
import { createMarker } from './markers';
import { everyBar, toNotes } from './demoSong';
import type { Step } from './demoSong';

/**
 * The pieces genre starters are built from: tracks with their effects, clips of 16th-note steps,
 * the master settings and the project around them.
 */

export const D = DRUM_NOTES;

export type FxPatch = { [K in keyof TrackFx]?: Partial<TrackFx[K]> };

export function fx(patch: FxPatch = {}): TrackFx {
  const d = defaultTrackFx();
  return {
    distortion: { ...d.distortion, ...patch.distortion },
    compressor: { ...d.compressor, ...patch.compressor },
    chorus: { ...d.chorus, ...patch.chorus },
    filter: { ...d.filter, ...patch.filter },
    pump: { ...d.pump, ...patch.pump },
    lofi: { ...d.lofi, ...patch.lofi },
    gate: { ...d.gate, ...patch.gate },
    human: { ...d.human, ...patch.human },
  };
}

export function track(name: string, key: InstrumentKey, opts: Partial<Omit<Track, 'fx'>> & { fx?: FxPatch; automation?: AutomationLane[] } = {}): Track {
  const { fx: patch, ...rest } = opts;
  return {
    id: uid('track'),
    name,
    color: INSTRUMENTS[key].color,
    instrumentKey: key,
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    reverbSend: 0,
    delaySend: 0,
    ...rest,
    fx: fx(patch),
  };
}

/** A clip of `steps` (whose length is `bars`), repeated `times` from `startBar`. */
export function clip(t: Track, name: string, startBar: number, bars: number, steps: Step[], times = 1, wobble?: WobbleRate): Clip {
  const all = Array.from({ length: times }, (_, i) => steps.map(([s, n, v, d]): Step => [s + i * bars * 16, n, v, d])).flat();
  return { id: uid('clip'), trackId: t.id, name, startBar, lengthBars: bars * times, notes: toNotes(all), isSelected: false, ...(wobble ? { wobble } : {}) };
}

export function master(ott: Partial<MasterSettings['ott']>, width: Partial<MasterSettings['width']>): MasterSettings {
  const d = defaultMasterSettings();
  return { ott: { ...d.ott, ...ott }, width: { ...d.width, ...width } };
}

export function project(name: string, bpm: number, swing: number, loop: [number, number], tracks: Track[], clips: Clip[], sections: Array<[number, string]>, m: MasterSettings): ProjectSnapshot {
  return {
    name,
    bpm,
    swing,
    loopRegion: { inBar: loop[0], outBar: loop[1], enabled: true },
    masterFx: DEFAULT_MASTER_FX,
    master: m,
    tracks,
    clips,
    markers: sections.map(([bar, label]) => createMarker(bar, bpm, label)),
  };
}

/** Hats every 8th, the bar's last one open every other bar. */
export const hats8 = (bars: number, vel = 0.55): Step[] =>
  everyBar(bars, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, b % 2 === 1 && i === 7 ? D.openHat : D.closedHat, i % 2 ? vel * 0.7 : vel]));

/** A snare roll over 4 bars: quarters, 8ths, then 16ths twice, getting louder. */
export const snareRoll: Step[] = [
  ...[0, 4, 8, 12].map((s): Step => [s, D.snare, 0.5]),
  ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [16 + s, D.snare, 0.6]),
  ...Array.from({ length: 32 }, (_, i): Step => [32 + i, D.snare, 0.65 + (0.3 * i) / 31]),
];

/** Chords (or notes) `every` steps apart, each lasting `dur`. */
export const progression = (chords: Array<string | string[]>, every: number, dur: string, vel = 0.7): Step[] => chords.map((c, i): Step => [i * every, c, vel, dur]);
