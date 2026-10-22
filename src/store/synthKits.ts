/**
 * The synthesized kits: fixed Drum Designer designs (drumDesign.ts) that play like the Designed
 * Kit (presets/designedKit.ts), each a whole kit on the usual drum rows (C1 kick, D1 snare, D#1
 * clap, F#1 closed hat, A#1 open hat, F1/B1/D2 toms, G#2 perc, C#2 crash, D#2 ride). They replace
 * the recorded drum-machine and break kits that had no licence: every sound here is made by the
 * app's own synth, so it's free to use. "Edit in Drum Designer" turns a track on one of them into
 * a Designed Kit starting from its sounds. Plain data, no Web Audio, so Node can test it.
 */
import { one, two } from './drumDesign';
import type { DrumDesign } from './drumDesign';

export const SYNTH_KITS = ['technoKit', 'retroDrumMachine', 'rhythmBox', 'breakbeatKit'] as const;
export type SynthKitKey = (typeof SYNTH_KITS)[number];
export const isSynthKit = (key: string): key is SynthKitKey => (SYNTH_KITS as readonly string[]).includes(key);

const toms = (low: number, mid: number, high: number, edit: Parameters<typeof one>[1] = {}): DrumDesign => ({
  tomLow: one('tom', { pitch: low, sweep: 9, decay: 0.45, ...edit }),
  tomMid: one('tom', { pitch: mid, sweep: 8, decay: 0.38, ...edit }),
  tomHigh: one('tom', { pitch: high, sweep: 7, decay: 0.3, ...edit }),
});

/** Each kit's sounds, by row. */
export const SYNTH_KIT_DESIGNS: Record<SynthKitKey, DrumDesign> = {
  // Hard electronic: a driven layered kick with a short rumble, a bright noisy snare, a dry clap, tight hats
  technoKit: {
    kick: one('layerKick', { pitch: 50, startPitch: 160, sweepTime: 0.05, decay: 0.12, body: 0.9, shape: 0.1, click: 0.6, color: 2500, noiseDecay: 0.006, sub: 0.7, tail: 0.2, drive: 0.45, tone: 3000 }),
    snare: one('snare', { pitch: 190, sweep: 5, body: 0.5, decay: 0.08, noise: 1, color: 6000, noiseDecay: 0.2, click: 0.6, drive: 0.1 }),
    clap: one('clap', { bursts: 4, spread: 8, color: 1300, noiseDecay: 0.25, click: 0.5, drive: 0.2 }),
    closedHat: one('hat', { pitch: 400, color: 10000, decay: 0.04, noise: 0.5, click: 0.4 }),
    openHat: one('hat', { pitch: 400, color: 9500, decay: 0.3, noise: 0.5, click: 0.3 }),
    ...toms(80, 115, 160, { sweep: 10, decay: 0.35 }),
    cowbell: one('rim', { pitch: 1800, decay: 0.03, click: 0.8, noise: 0.3 }),
    crash: one('hat', { pitch: 320, color: 7500, decay: 1.8, noise: 0.75, click: 0.3 }),
    ride: two(['hat', { pitch: 470, color: 8500, decay: 1.2, noise: 0.3, click: 0.1 }], ['bell', { pitch: 1250, decay: 0.4, color: 3800, click: 0.1, level: -10 }]),
  },
  // An 80s-style machine: a round tuned kick, a snare with some room, a wide clap, noisy hats, deep toms
  retroDrumMachine: {
    kick: one('layerKick', { pitch: 56, startPitch: 125, sweepTime: 0.035, decay: 0.12, body: 1, shape: 0, click: 0.35, color: 1800, noiseDecay: 0.008, sub: 0.5, tail: 0.13, drive: 0.1, tone: 2500 }),
    snare: one('layerSnare', { pitch: 180, sweep: 4, body: 0.7, decay: 0.09, click: 0.3, noise: 0.85, color: 4200, tone: 8500, noiseDecay: 0.14, room: 0.35, tail: 0.3, drive: 0.35 }, 1.5),
    clap: one('clap', { bursts: 3, spread: 11, color: 1100, noiseDecay: 0.2, click: 0.3, drive: 0.3 }),
    closedHat: one('hat', { pitch: 300, color: 8000, decay: 0.05, noise: 0.7, click: 0.2 }),
    openHat: one('hat', { pitch: 300, color: 8000, decay: 0.35, noise: 0.7, click: 0.2 }),
    ...toms(95, 130, 175, { sweep: 4, decay: 0.4, noise: 0.15 }),
    cowbell: one('bell', { pitch: 560, decay: 0.25, color: 1700, click: 0.2 }),
    crash: one('hat', { pitch: 300, color: 7000, decay: 2.2, noise: 0.8, click: 0.2 }),
    ride: two(['hat', { pitch: 460, color: 8000, decay: 1.3, noise: 0.35, click: 0.1 }], ['bell', { pitch: 1150, decay: 0.45, color: 3500, click: 0.1, level: -9 }]),
  },
  // A vintage rhythm box: a soft sine thump, a thin snappy snare, ticking metal hats, bongo-like toms
  rhythmBox: {
    kick: one('kick', { pitch: 62, sweep: 8, sweepTime: 0.012, decay: 0.22, click: 0.1, drive: 0 }),
    snare: one('snare', { pitch: 260, sweep: 2, body: 0.8, decay: 0.09, noise: 0.55, color: 5000, noiseDecay: 0.12, click: 0.15, drive: 0.35 }),
    clap: one('clap', { bursts: 2, spread: 6, color: 1800, noiseDecay: 0.12, click: 0.3, drive: 0.3 }),
    closedHat: one('hat', { pitch: 520, color: 9000, decay: 0.03, noise: 0.15, click: 0.1 }),
    openHat: one('hat', { pitch: 520, color: 9000, decay: 0.2, noise: 0.15, click: 0.1 }),
    ...toms(150, 220, 300, { sweep: 2, decay: 0.18, click: 0.4, noise: 0 }),
    cowbell: one('bell', { pitch: 800, decay: 0.12, color: 2400, click: 0.3 }),
    crash: one('hat', { pitch: 450, color: 8000, decay: 1.2, noise: 0.5, click: 0.2 }),
    ride: one('hat', { pitch: 520, color: 9000, decay: 0.6, noise: 0.2, click: 0.1 }),
  },
  // Break-style hits, crunchy: a dirty kick, a cracking snare with a little room, gritty hats
  breakbeatKit: {
    kick: one('kick', { pitch: 60, sweep: 24, sweepTime: 0.025, decay: 0.25, click: 0.6, noise: 0.3, color: 1500, noiseDecay: 0.04, drive: 0.55 }),
    snare: one('layerSnare', { pitch: 200, sweep: 5, body: 0.7, decay: 0.07, click: 0.7, noise: 0.9, color: 4200, tone: 8000, noiseDecay: 0.14, room: 0.35, tail: 0.3, drive: 0.5 }, 1.5),
    clap: one('clap', { bursts: 3, spread: 9, color: 1500, noiseDecay: 0.18, click: 0.4, drive: 0.3 }),
    closedHat: one('hat', { pitch: 340, color: 7000, decay: 0.06, noise: 0.6, click: 0.3, drive: 0.3 }),
    openHat: one('hat', { pitch: 340, color: 7000, decay: 0.4, noise: 0.6, click: 0.2, drive: 0.3 }),
    ...toms(90, 125, 170, { decay: 0.4, noise: 0.25, drive: 0.3 }),
    cowbell: one('rim', { pitch: 1300, decay: 0.04, click: 0.6, noise: 0.2 }),
    crash: one('hat', { pitch: 300, color: 6500, decay: 2, noise: 0.8, click: 0.3, drive: 0.2 }),
    ride: two(['hat', { pitch: 450, color: 7500, decay: 1.2, noise: 0.4, click: 0.1, drive: 0.2 }], ['bell', { pitch: 1100, decay: 0.4, color: 3200, click: 0.1, level: -10 }]),
  },
};

/** A copy of `key`'s sounds, to start a Designed Kit from. */
export const synthKitDesign = (key: SynthKitKey): DrumDesign => structuredClone(SYNTH_KIT_DESIGNS[key]);
