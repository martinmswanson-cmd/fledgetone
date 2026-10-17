import { FX_NOTES } from '../audio/instrumentCatalog';
import type { ProjectSnapshot } from './project';
import { everyBar } from './demoSong';
import type { Step } from './demoSong';
import { midiOf, nameOf } from './noteTools';
import { barsToDuration } from './timelineTypes';
import type { PeqBand, Track, TrackFx, TrackSend } from './timelineTypes';
import { defaultSynthPatch, presetPatch, withPatch } from './synthPatch';
import type { SynthPatch } from './synthPatch';
import { clip, D, master, progression, project, snareRoll, track } from './starterKit';

/**
 * More genre starters, for the most-requested styles: artcore boss fights, bass music,
 * internet rap and phonk, bedroom pop and jazz-pop, theatrical pop and two band styles. Melodies
 * are written for these starters (not copied from any song); progressions, tempos and grooves
 * follow each style's conventions.
 *
 * Voiced to sound like modern records rather than old game music (the Genre Starter Manual):
 * recorded instruments and Synth Designer patches instead of toy synths, melodies in the middle
 * octaves, dark chords without a major V or bright major VI / III / VII in the dark styles,
 * accents and ghost notes, HUMAN on played parts, grit on the midrange behind a low cut, a Pro EQ
 * for each role, a shared dark reverb return and a drum bus where the style wants them.
 *
 * Kept gentle on the ears: kicks below full velocity and their tracks at -4 to -2 dB, subs and
 * 808s at -10 to -6 dB with a 25 Hz low cut, no sub drops, soft impacts, no drive above the old
 * 8% on anything that carries a kick, sub or 808, and builds that get quieter before a drop.
 */

/** A length in 16ths as a note duration. */
const dur = (sixteenths: number) => barsToDuration(sixteenths / 16);

const VEL: Record<string, number> = { X: 0.9, x: 0.6, o: 0.45, g: 0.28 };

/**
 * Drum rows written as grids, one character per 16th (X loud, x medium, o soft, g ghost, . rest),
 * any length. Kicks are scaled by `kick` (kept under full velocity).
 */
function beat(rows: Array<[note: string, pattern: string]>, kick = 0.85): Step[] {
  return rows.flatMap(([note, pattern]) =>
    [...pattern.replace(/\s/g, '')].flatMap((c, i): Step[] => (VEL[c] ? [[i, note, VEL[c] * (note === D.kick ? kick : 1)]] : []))
  );
}

/** Every note `semitones` up (down if negative). */
const up = (steps: Step[], semitones: number): Step[] =>
  steps.map(([s, n, v, d]): Step => [s, Array.isArray(n) ? n.map((x) => nameOf(midiOf(x) + semitones)) : nameOf(midiOf(n) + semitones), v, d]);

/** Moved later by `by` 16ths. */
const later = (steps: Step[], by: number): Step[] => steps.map(([s, n, v, d]): Step => [s + by, n, v, d]);

/** A melody: [step, note, length in 16ths], a little louder on the beats. */
const melody = (notes: Array<[number, string, number]>, vel = 0.8): Step[] =>
  notes.map(([s, n, len]): Step => [s, n, s % 4 === 0 ? vel : vel * 0.9, dur(len)]);

/** A played line (Manual 2.4): accents on the downbeats, the beats a touch under, the notes between them lighter. */
const phrase = (notes: Array<[number, string, number]>, accent = 0.85, normal = 0.62): Step[] =>
  notes.map(([s, n, len]): Step => [s, n, s % 16 === 0 ? accent : s % 4 === 0 ? accent * 0.92 : normal, dur(len)]);

/** Each note doubled an octave below (a piano octave lead) or above. */
const octaves = (steps: Step[], dir = -1): Step[] =>
  steps.map(([s, n, v, d]): Step => [s, (Array.isArray(n) ? n : [n]).flatMap((x) => [x, nameOf(midiOf(x) + 12 * dir)]), v, d]);

/** A 32nd-note roll on `note` from step `from` to `to`, getting louder. */
const roll32 = (note: string, from: number, to: number, v0 = 0.35, v1 = 0.85): Step[] => {
  const n = (to - from) * 2;
  return Array.from({ length: n }, (_, i): Step => [from + i / 2, note, v0 + ((v1 - v0) * i) / Math.max(1, n - 1), '32n']);
};

/** One chord per bar, played at `steps` of each bar. */
const stabs = (chords: string[][], steps: number[], len: number, vel = 0.7): Step[] =>
  everyBar(chords.length, (b) => steps.map((s): Step => [s, chords[b], s === steps[0] ? vel : vel * 0.85, dur(len)]));

/** One root per bar, played at `steps` of each bar. */
const pulse = (notes: string[], steps: number[], len: number, vel = 0.8): Step[] =>
  everyBar(notes.length, (b) => steps.map((s): Step => [s, notes[b], s === steps[0] ? vel : vel * 0.85, dur(len)]));

/** Each bar's notes one after another, `every` 16ths apart, each lasting `len`. */
const broken = (bars: string[][], every: number, len: number, vel = 0.65): Step[] =>
  everyBar(bars.length, (b) => bars[b].map((n, i): Step => [i * every, n, i === 0 ? vel + 0.1 : vel, dur(len)]));

/** A riser and noise sweep over `bars`, with a reverse crash into the next downbeat. */
const softBuild = (bars: number): Step[] => [
  [0, FX_NOTES.riser, 0.7, `${bars}:0:0`],
  [0, FX_NOTES.noiseSweep, 0.45, `${bars}:0:0`],
  [(bars - 1) * 16, FX_NOTES.reverseCrash, 0.75, '1n'],
];

/** A soft impact on the drop and a downlifter after it (no sub drop: kind to the ears). */
const softHit: Step[] = [[0, FX_NOTES.impact, 0.45], [16, FX_NOTES.downlifter, 0.45, '1n']];

/** A snare roll with the last beat left silent before the drop. */
const rollWithGap = snareRoll.filter(([s]) => s < 60);

/**
 * A classic jungle break rebuilt from single hits, two bars (Manual 3.18): ghosted snares between the
 * backbeats, hats alternating loud and soft; `fill` ends bar 2 with a 32nd roll.
 */
const rollingBreak = (fill = false): Step[] => [
  ...beat([[D.kick, 'X.X.......XX....'], [D.snare, '....X..g.g..X..g'], [D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.8),
  ...later(
    fill
      ? [...beat([[D.kick, 'X.X.......X.....'], [D.snare, '....X..g.g......'], [D.closedHat, 'x.o.x.o.x.o.....']], 0.8), ...roll32(D.snare, 12, 16, 0.35, 0.8)]
      : beat([[D.kick, 'X.X.......X.....'], [D.snare, '....X..g.g....X.'], [D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.8),
    16
  ),
];

/** Notes of a scale run, 32nds, rising in velocity (a harp gliss). */
const gliss = (notes: string[], from: number): Step[] => notes.map((n, i): Step => [from + i / 2, n, 0.4 + (0.4 * i) / notes.length, '8n']);

/** A power chord: root and fifth. */
const power = (r: string): string[] => [r, nameOf(midiOf(r) + 7)];

// ---------- Mix pieces: Pro EQ, HUMAN, patches, returns and buses ----------

const band = (type: PeqBand['type'], freq: number, gain = 0, q = Math.SQRT1_2): PeqBand => ({ on: true, type, freq, gain, q });
const lowCut = (hz: number) => band('lowcut', hz);
const highCut = (hz: number) => band('highcut', hz);
const bell = (hz: number, gain: number, q = 1) => band('bell', hz, gain, q);
const highShelf = (hz: number, gain: number) => band('highshelf', hz, gain, 0.7);
/** A Pro EQ, switched on, with these bands. */
const peq = (...bands: PeqBand[]): TrackFx['peq'] => ({ on: true, bands });

/** The Pro EQ for each role (Manual 2.7). A fresh copy each call. */
const EQ = {
  /** A drum kit: no rumble, less cardboard */
  kit: () => peq(lowCut(30), bell(400, -3)),
  /** A pure sub: the 25 Hz low cut, and a high cut so it stays a sub */
  sub: (top = 150) => peq(lowCut(25), highCut(top)),
  eight: () => peq(lowCut(28)),
  /** An 808 grit copy or a mid bass: the part you hear on a phone, kept out of the sub */
  grit: () => peq(lowCut(150), bell(900, 3), highCut(10000)),
  /** The anti-chiptune EQ: less beep, more body */
  lead: (top = 8000) => peq(lowCut(200), bell(400, 2), bell(3000, -4, 1.5), highCut(top)),
  piano: () => peq(lowCut(80), highShelf(6000, -3)),
  pad: (top = 8000) => peq(lowCut(150), bell(400, -3), highCut(top)),
  guitar: () => peq(lowCut(90), bell(400, -4), bell(3500, -3), highCut(9000)),
  choir: () => peq(lowCut(150), bell(2500, -2)),
  brass: () => peq(lowCut(100), bell(300, 2), highCut(8000)),
  bells: () => peq(lowCut(500), highCut(6000)),
};

/** HUMAN at `amount` (Manual 2.4): timing as given, dynamics a little less, pitch only where asked (never on piano). */
const human = (amount: number, pitch = 0): TrackFx['human'] => ({ on: true, timing: amount, dynamics: amount * 0.6, pitch });

/** Lo-fi's Crush setting for a bit depth (16-bit is clean, 3-bit the most crushed). */
const bits = (n: number) => (16 - n) / 13;

/** Glue for a drum kit or bus (Manual 2.9): -18 dB, 4:1, and no makeup gain, so the kick never comes out louder. */
const glue = (threshold = -18): TrackFx['compressor'] => ({ on: true, threshold, ratio: 4, makeup: 0 });

/** A multiband that tames a growl's fizz (high band -24 dB, 4:1) and evens out its low band (2:1). */
const tameFizz = (): Partial<TrackFx['mbc']> => ({ on: true, bands: [{ threshold: -24, ratio: 2, gain: 0 }, { threshold: -20, ratio: 2.5, gain: 0 }, { threshold: -24, ratio: 4, gain: 0 }] });

/** Synth Designer patches (Manual 2.6), the modern replacements for the toy synths. */
const PATCH = {
  /** A. Detuned saws through a driven low-pass: DnB and darksynth bass, mono with glide */
  nightReese: (): SynthPatch =>
    withPatch(defaultSynthPatch(), {
      osc2: { on: true, wave: 'sawtooth', fine: 10, level: 0.8 },
      sub: 0.3,
      unison: { voices: 3, spread: 20, width: 0.5 },
      filter: { cutoff: 500, resonance: 1, envAmount: 1, keyTrack: 0.5 },
      filterEnv: { attack: 0.001, decay: 0.4, sustain: 0.4, release: 0.2 },
      amp: { attack: 0.005, sustain: 1, release: 0.15 },
      drive: 0.15,
      mono: true,
      glide: 0.06,
      level: 0,
    }),
  /** C. Square and saw, seven voices wide, cut at 3.5 kHz: the hyper trap lead, played F#3 to F#4 */
  wideRageLead: (): SynthPatch =>
    withPatch(defaultSynthPatch(), {
      osc1: { wave: 'square' },
      osc2: { on: true, wave: 'sawtooth', fine: 12, level: 0.8 },
      unison: { voices: 3, spread: 15, width: 0.8 },
      filter: { cutoff: 3500, resonance: 0.8, envAmount: 0, keyTrack: 0.3 },
      amp: { attack: 0.005, decay: 0.3, sustain: 1, release: 0.4 },
      level: 0,
    }),
  /** D. The supersaw with a slower, darker filter: chords for dubstep, hardcore and artcore */
  darkSupersaw: (): SynthPatch =>
    withPatch(presetPatch('Supersaw lead'), {
      osc2: { on: true, wave: 'sawtooth', octave: 0, fine: -12, level: 0.6 },
      unison: { voices: 5, spread: 18, width: 0.8 },
      filter: { cutoff: 2000, envAmount: 1 },
      filterEnv: { attack: 0.15, decay: 1, sustain: 0.5, release: 0.5 },
      amp: { attack: 0.02, sustain: 0.9, release: 0.5 },
      level: 0,
    }),
  /** E. The 808 cowbell: two squares about a tritone apart (+6 st +31 ct) through a band-pass, a short clank */
  phonkCowbell: (): SynthPatch =>
    withPatch(defaultSynthPatch(), {
      osc1: { wave: 'square' },
      osc2: { on: true, wave: 'square', semi: 6, fine: 31, level: 0.8 },
      filter: { type: 'bandpass', cutoff: 2600, resonance: 3, envAmount: 0, keyTrack: 0.5 },
      amp: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.08 },
      drive: 0.12,
      level: 0,
    }),
  /** G. A saw and a triangle an octave up, wide, slow to open: a pad that stays dark */
  darkPad: (): SynthPatch =>
    withPatch(defaultSynthPatch(), {
      osc2: { on: true, wave: 'triangle', octave: 1, fine: 0, level: 0.6 },
      unison: { voices: 3, spread: 18, width: 0.9 },
      filter: { cutoff: 900, envAmount: 0.5 },
      filterEnv: { attack: 1.5, decay: 2, sustain: 0.6, release: 2 },
      amp: { attack: 0.8, decay: 1, sustain: 0.9, release: 2.5 },
      lfo: { target: 'filter', shape: 'sine', sync: 'free', rate: 0.15, depth: 0.2 },
      level: 0,
    }),
  /** H. The bell preset darkened (low-pass 3 kHz, 1 s release): trap and drill bells without the music box */
  darkBell: (): SynthPatch => withPatch(presetPatch('Bell'), { filter: { cutoff: 3000 }, amp: { release: 1 } }),
};

/** The shared "Dark room" (Manual 2.9): one short, dark reverb on a return for leads, pads and strings. */
const darkRoom = (): Track => track('Dark room', 'return', { fx: { reverb: { on: true, decay: 1.6, preDelay: 30, tone: 4000, mix: 1 } } });
/** A send to a return. */
const send = (to: Track, level: number): TrackSend[] => [{ to: to.id, level }];
/**
 * A Drum bus (Manual 2.9) the kit and percussion play into (their `output`): glue compression and
 * a little mud cut. No drive, as the kick goes through it.
 */
const drumBus = (threshold = -18): Track => track('Drum bus', 'bus', { fx: { compressor: glue(threshold), peq: peq(bell(400, -2)) } });

/** The master reverb's lengths (Manual 2.10): Room, Studio, Hall. */
const ROOM = 1;
const STUDIO = 1.8;
const HALL = 3.2;
/** The project with its master reverb set to a space. */
const inSpace = (p: ProjectSnapshot, reverbDecay: number): ProjectSnapshot => ({ ...p, masterFx: { reverbDecay, delayTime: p.masterFx?.delayTime ?? '8n', delayFeedback: p.masterFx?.delayFeedback ?? 0.35 } });
/** OTT that reacts fast, for the bass-music family. */
const FAST = 0.15;

// ---------- Artcore: final boss ----------

function artcore(): ProjectSnapshot {
  const room = darkRoom();
  const kit = drumBus();
  const piano = track('Piano', 'piano', { volume: -2, sends: send(room, 0.3), fx: { peq: peq(lowCut(60), highShelf(7000, -2)), human: human(0.25) } });
  const violin = track('Violin', 'violin', { volume: -7, pan: -0.4, sends: send(room, 0.35), fx: { peq: peq(lowCut(200), bell(3000, -2)), human: human(0.3, 0.2) } });
  const cello = track('Cello', 'cello', { volume: -7, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(50)), human: human(0.2, 0.2) } });
  const contra = track('Contrabass', 'contrabass', { volume: -10, pan: 0.35, reverbSend: 0.2, fx: { peq: peq(lowCut(35)), human: human(0.2, 0.2) } });
  const strings = track('Tremolo strings', 'tremolo', { volume: -16, reverbSend: 0.4, fx: { peq: EQ.pad() } });
  const choir = track('Choir', 'choir', { volume: -12, reverbSend: 0.45, fx: { peq: EQ.choir() } });
  const saw = track('Supersaw', 'synthDesigner', { volume: -8, synth: PATCH.darkSupersaw(), sends: send(room, 0.2), fx: { peq: peq(lowCut(200), highCut(9000)), pump: { on: true, depth: 0.45, release: 160, trigger: 'kick' } } });
  const reese = track('Reese', 'synthDesigner', { volume: -10, synth: PATCH.nightReese(), fx: { peq: peq(lowCut(60), highCut(6000)), distortion: { on: true, amount: 0.25 } } });
  const drums = track('Breaks', 'breakbeatKit', { volume: -3, output: kit.id, reverbSend: 0.08, fx: { peq: EQ.kit() } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id, reverbSend: 0.2 });
  const toll = track('Toll', 'chimes', { volume: -16, reverbSend: 0.4, fx: { peq: EQ.bells() } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });

  // Intro: Dm - Bb - Gm - Asus4, the left hand in whole-note octaves under a slow fragment in the middle of the keyboard
  const introLeft = progression([['D2', 'D3'], ['A#1', 'A#2'], ['G1', 'G2'], ['A1', 'A2']], 16, '1n', 0.55);
  const introRight = phrase(
    [[0, 'A3', 4], [4, 'D4', 4], [8, 'E4', 4], [12, 'F4', 4], [16, 'F4', 6], [22, 'E4', 2], [24, 'D4', 8], [32, 'D4', 4], [36, 'G4', 4], [40, 'F4', 4], [44, 'D4', 4], [48, 'E4', 8], [56, 'D4', 8]],
    0.62,
    0.5
  );
  // Build: Bbmaj7 - Gm9 - Asus4 - A7(b9) broken in 8ths, the b9 (Bb) on top so the dominant threatens instead of cheering
  const buildArp = broken(
    [['A#2', 'F3', 'A3', 'D4', 'F4', 'A4', 'D4', 'A3'], ['G2', 'D3', 'F3', 'A3', 'A#3', 'D4', 'A#3', 'F3'], ['A2', 'E3', 'A3', 'D4', 'E4', 'A4', 'E4', 'D4'], ['A2', 'E3', 'G3', 'C#4', 'G4', 'A#4', 'G4', 'C#4']],
    2,
    3,
    0.55
  );
  const buildCello = progression(['A#2', 'G2', 'A2', 'A2'], 16, '1n', 0.65);
  const buildStrings = progression([['A3', 'D4', 'F4'], ['A3', 'A#3', 'D4'], ['A3', 'D4', 'E4'], ['G3', 'C#4', 'A#4']], 16, '1n', 0.55);

  // Drop: Dm - Bb - Gm - A7(b9). The tune in octaves on the piano (A3 to F5), the violin on its upper line
  const tune = phrase([
    [0, 'D5', 4], [4, 'A4', 2], [6, 'D5', 2], [8, 'F5', 4], [12, 'E5', 2], [14, 'D5', 2],
    [16, 'C5', 6], [22, 'A#4', 2], [24, 'A4', 8],
    [32, 'G4', 4], [36, 'A#4', 4], [40, 'D5', 4], [44, 'C5', 2], [46, 'A#4', 2],
    [48, 'A#4', 4], [52, 'A4', 4], [56, 'G4', 2], [58, 'F4', 2], [60, 'E4', 4],
  ]);
  const roots = [['D2', 'D3'], ['A#1', 'A#2'], ['G1', 'G2'], ['A1', 'A2']];
  const left = everyBar(4, (b): Step[] => [[0, roots[b], 0.7, '4n'], [8, roots[b], 0.58, '4n']]);
  const dropPiano = [...octaves(tune), ...left];
  const sawStabs = stabs([['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['D4', 'G4', 'A#4'], ['C#4', 'G4', 'A#4']], [2, 6, 10, 14], 1, 0.68);
  const bassRoots = ['D2', 'A#1', 'G1', 'A1'];
  const reeseLine = everyBar(4, (b): Step[] => [[0, bassRoots[b], 0.85, '4n'], [6, bassRoots[b], 0.62, '8n'], [10, bassRoots[b], 0.66, '8n'], [12, nameOf(midiOf(bassRoots[b]) + 12), 0.72, '4n']]);
  // The bass line in octaves: cello half notes over the contrabass
  const celloLine = everyBar(4, (b): Step[] => [[0, nameOf(midiOf(bassRoots[b]) + 12), 0.7, '2n'], [8, nameOf(midiOf(bassRoots[b]) + 12), 0.58, '2n']]);
  const contraLine = progression(bassRoots, 16, '1n', 0.7);
  // The choir sings long, low "aah"s on a D pedal, never the tune
  const dropChoir = progression([['D3', 'F3', 'A3'], ['D3', 'F3', 'A#3'], ['D3', 'G3', 'A#3'], ['C#3', 'G3', 'A#3']], 16, '1n', 0.5);
  const dropDrums = [[0, D.crash, 0.55] as Step, ...rollingBreak(), ...later(rollingBreak(true), 32)];
  const taikoHits: Step[] = everyBar(4, (b): Step[] => [[0, b % 2 ? 'A2' : 'D2', 0.8], [10, 'D2', 0.6]]);

  return inSpace(
    project(
      'Final Boss Artcore starter',
      174,
      0,
      [9, 17],
      [piano, violin, cello, contra, strings, choir, saw, reese, drums, taiko, toll, sfx, kit, room],
      [
        clip(piano, 'Intro', 1, 4, [...introLeft, ...introRight]),
        clip(piano, 'Lift', 5, 4, buildArp),
        clip(cello, 'Lift', 5, 4, buildCello),
        clip(strings, 'Lift', 5, 4, buildStrings),
        clip(drums, 'Snare ladder', 5, 4, rollWithGap),
        clip(taiko, 'Build', 5, 4, everyBar(4, (): Step[] => [[0, 'D2', 0.65], [8, 'D2', 0.5]])),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        clip(piano, 'Drop', 9, 4, dropPiano),
        clip(violin, 'Drop', 9, 4, tune),
        clip(saw, 'Stabs', 9, 4, sawStabs),
        clip(reese, 'Reese', 9, 4, reeseLine),
        clip(cello, 'Drop', 9, 4, celloLine),
        clip(contra, 'Drop', 9, 4, contraLine),
        clip(choir, 'Drop', 9, 4, dropChoir),
        clip(drums, 'Breaks', 9, 4, dropDrums),
        clip(taiko, 'Hits', 9, 4, taikoHits),
        clip(toll, 'Toll', 9, 1, [[0, 'D3', 0.5, '1n']]),
        clip(sfx, 'Hit', 9, 2, softHit),
        // The last drop a semitone up (D# minor): darker and more emotional than a whole step
        clip(piano, 'Drop (D# minor)', 13, 4, up(dropPiano, 1)),
        clip(violin, 'Drop (D# minor)', 13, 4, up(tune, 1)),
        clip(saw, 'Stabs', 13, 4, up(sawStabs, 1)),
        clip(reese, 'Reese', 13, 4, up(reeseLine, 1)),
        clip(cello, 'Drop', 13, 4, up(celloLine, 1)),
        clip(contra, 'Drop', 13, 4, up(contraLine, 1)),
        clip(choir, 'Drop', 13, 4, up(dropChoir, 1)),
        clip(strings, 'Drop', 13, 4, up(progression([['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['D4', 'G4', 'A#4'], ['C#4', 'G4', 'A#4']], 16, '1n', 0.5), 1)),
        clip(drums, 'Breaks', 13, 4, dropDrums),
        clip(taiko, 'Hits', 13, 4, taikoHits),
        clip(toll, 'Toll', 13, 1, [[0, 'D#3', 0.5, '1n']]),
      ],
      [[1, 'Intro'], [5, 'Build'], [9, 'Drop'], [13, 'Key change']],
      master({ on: true, depth: 0.2 }, { on: true, amount: 1.2 })
    ),
    HALL
  );
}

// ---------- Melodic hardcore (rhythm-game piano) ----------

function hardcore(): ProjectSnapshot {
  const room = darkRoom();
  const piano = track('Piano', 'piano', { volume: -2, sends: send(room, 0.25), fx: { peq: EQ.piano(), human: human(0.2) } });
  const violin = track('Violin', 'violin', { volume: -8, pan: -0.4, sends: send(room, 0.3), fx: { peq: peq(lowCut(200), bell(3000, -2)), human: human(0.25, 0.2) } });
  const cello = track('Cello', 'cello', { volume: -8, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(50)), human: human(0.25, 0.2) } });
  const saw = track('Supersaw', 'synthDesigner', { volume: -6, synth: PATCH.darkSupersaw(), sends: send(room, 0.2), fx: { peq: peq(lowCut(200), highCut(9000)), pump: { on: true, depth: 0.6, release: 160, trigger: 'kick' } } });
  const brass = track('Brass', 'brassSection', { volume: -12, reverbSend: 0.25, fx: { peq: EQ.brass(), pump: { on: true, depth: 0.3, release: 160, trigger: 'kick' } } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(), pump: { on: true, depth: 0.6, release: 140, trigger: 'kick' } } });
  const drums = track('Drums', 'technoKit', { volume: -4, fx: { peq: EQ.kit(), compressor: glue(), distortion: { on: true, amount: 0.08 } } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });

  // Intro in E minor: Em - Cmaj7 - G/B - D, the tune an octave below where it began (B3 to D5)
  const introLeft = progression([['E2', 'E3'], ['C2', 'C3'], ['B1', 'B2'], ['D2', 'D3']], 16, '1n', 0.55);
  const introTune = up(
    phrase(
      [
        [0, 'B4', 2], [2, 'E5', 2], [4, 'F#5', 2], [6, 'G5', 2], [8, 'F#5', 4], [12, 'E5', 2], [14, 'D5', 2],
        [16, 'E5', 4], [20, 'G5', 2], [22, 'B5', 2], [24, 'A5', 4], [28, 'G5', 2], [30, 'F#5', 2],
        [32, 'D5', 2], [34, 'G5', 2], [36, 'A5', 2], [38, 'B5', 2], [40, 'A5', 4], [44, 'G5', 2], [46, 'A5', 2],
        [48, 'F#5', 6], [54, 'A5', 2], [56, 'D6', 4], [60, 'A5', 4],
      ],
      0.7,
      0.52
    ),
    -12
  );
  // Build: Am7 - Em/G - Cadd9 - Bsus4 in 16th arpeggios; the last bar stutters on Bm7 (no major B: no "hero wins"), then a beat of silence
  const cells = [['A3', 'C4', 'E4', 'G4'], ['G3', 'B3', 'E4', 'G4'], ['C4', 'D4', 'E4', 'G4'], ['B3', 'E4', 'F#4', 'A4']];
  const bm7 = ['B3', 'D4', 'F#4', 'A4'];
  const buildArp = everyBar(4, (b): Step[] =>
    b === 3
      ? [...Array.from({ length: 8 }, (_, i): Step => [i, cells[3][[0, 1, 2, 3, 2, 1, 2, 3][i]], i % 4 === 0 ? 0.8 : 0.55, '16n']), ...Array.from({ length: 8 }, (_, i): Step => [8 + i / 2, bm7, 0.4 + i * 0.05, '32n'])]
      : Array.from({ length: 16 }, (_, i): Step => [i, cells[b][[0, 1, 2, 3, 2, 1, 2, 3][i % 8]], i % 4 === 0 ? 0.8 : 0.55, '16n'])
  );
  const buildLeft = pulse(['A2', 'G2', 'C3', 'B2'], [0, 4, 8], 4, 0.6);
  const buildSub = progression(['A1', 'G1', 'C2', 'B1'], 16, '1n', 0.7);

  // Drop, a bittersweet Royal Road: Cmaj7 - Dsus4 to D - Bm7 - Em9, four-on-the-floor. The piano's 16ths
  // accent the first of each beat
  const arpCells = [['G4', 'B4', 'E5', 'B4'], ['G4', 'A4', 'D5', 'A4'], ['F#4', 'A4', 'D5', 'A4'], ['G4', 'B4', 'E5', 'F#5']];
  const dropRoots = [['C2', 'C3'], ['D2', 'D3'], ['B1', 'B2'], ['E2', 'E3']];
  const dropPiano = everyBar(4, (b): Step[] => [
    ...Array.from({ length: 16 }, (_, i): Step => [i, b === 1 && i >= 8 && i % 4 === 0 ? 'F#4' : arpCells[b][i % 4], i % 4 === 0 ? 0.8 : 0.55, '16n']),
    ...[0, 4, 8, 12].map((s): Step => [s, dropRoots[b], s === 0 ? 0.7 : 0.6, '8n']),
  ]);
  const sawChords: Step[] = [
    [0, ['C3', 'G3', 'B3', 'E4'], 0.7, '1n'],
    [16, ['D3', 'G3', 'A3'], 0.7, '2n'], [24, ['D3', 'F#3', 'A3'], 0.65, '2n'],
    [32, ['B2', 'F#3', 'A3', 'D4'], 0.7, '1n'],
    [48, ['E3', 'D4', 'F#4', 'G4'], 0.7, '1n'],
  ];
  // The violin tune, an octave below where it began: B3 to E5
  const tuneA = up(
    phrase([[0, 'B5', 6], [6, 'C6', 2], [8, 'B5', 4], [12, 'G5', 4], [16, 'A5', 6], [22, 'B5', 2], [24, 'A5', 4], [28, 'F#5', 4], [32, 'F#5', 6], [38, 'G5', 2], [40, 'A5', 4], [44, 'B5', 4], [48, 'G5', 8], [56, 'E5', 4], [60, 'F#5', 4]]),
    -12
  );
  const tuneB = [...tuneA.filter(([s]) => s < 48), ...phrase([[48, 'G4', 4], [52, 'B4', 4], [56, 'E5', 8]])];
  const brassStabs = stabs([['E3', 'G3', 'B3'], ['D3', 'G3', 'A3'], ['D3', 'F#3', 'A3'], ['E3', 'G3', 'B3']], [2, 6, 10, 14], 1, 0.6);
  const subLine = pulse(['C2', 'D2', 'B1', 'E2'], [0, 4, 8, 12], 3, 0.75);
  const fourFloor = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.clap, '....x.......x...'], [D.closedHat, '.g.g.g.g.g.g.g.g'], [D.openHat, '..o...o...o...o.']], 0.8);

  return inSpace(
    project(
      'Melodic Hardcore starter',
      180,
      0,
      [9, 17],
      [piano, violin, cello, saw, brass, sub, drums, sfx, room],
      [
        clip(piano, 'Intro', 1, 4, [...introLeft, ...introTune]),
        clip(cello, 'Roots', 1, 4, progression(['E3', 'C3', 'B2', 'D3'], 16, '1n', 0.55)),
        clip(piano, 'Build', 5, 4, [...buildArp, ...buildLeft]),
        clip(sub, 'Build', 5, 4, buildSub),
        clip(drums, 'Snare ladder', 5, 4, rollWithGap),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        clip(piano, 'Drop', 9, 4, dropPiano, 2),
        clip(violin, 'Tune', 9, 4, tuneA),
        clip(violin, 'Tune', 13, 4, tuneB),
        clip(cello, 'Drop', 9, 4, progression(['C3', 'D3', 'B2', 'E3'], 16, '1n', 0.6), 2),
        clip(saw, 'Chords', 9, 4, sawChords, 2),
        clip(brass, 'Stabs', 9, 4, brassStabs, 2),
        clip(sub, 'Sub', 9, 4, subLine, 2),
        clip(drums, 'Four on the floor', 9, 1, fourFloor, 8),
        clip(sfx, 'Hit', 9, 2, softHit),
      ],
      [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
      master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.25 })
    ),
    STUDIO
  );
}

// ---------- Breakcore / digicore ----------

function breakcore(): ProjectSnapshot {
  const room = darkRoom();
  // The breaks crushed and glued; the Gate stutters them in the last half-bar before the hook comes back
  const breaks = track('Breaks', 'breakbeatKit', {
    volume: -3,
    reverbSend: 0.06,
    fx: { peq: EQ.kit(), compressor: glue(), distortion: { on: true, amount: 0.08 }, lofi: { on: true, crush: bits(10), tone: 9000, wow: 0, mix: 0.3 }, gate: { on: true, rate: '1/32', depth: 0, length: 0.5 } },
    automation: [{ param: 'fx:gate.depth', points: [{ bar: 8, value: 0 }, { bar: 8, value: 0.85 }, { bar: 8.5, value: 0.85 }, { bar: 8.5, value: 0 }] }],
  });
  const kit = track('Hardcore kit', 'technoKit', { volume: -4, fx: { peq: EQ.kit(), compressor: glue() } });
  const keys = track('Keys', 'rhodes', { volume: -11, sends: send(room, 0.3), fx: { lofi: { on: true, crush: 0, tone: 20000, wow: 0.2, mix: 1 }, chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 }, filter: { on: true, cutoff: 5000 }, human: human(0.2) } });
  // The hook on a plain grand piano: breakcore's melodies cut through as they are, no synth stack or drive
  const hook = track('Hook', 'piano', { volume: -6, sends: send(room, 0.25), fx: { peq: peq(lowCut(120)), human: human(0.15) } });
  const atmos = track('Atmos', 'goblins', { volume: -22, reverbSend: 0.5, fx: { peq: EQ.pad(6000) } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(), pump: { on: true, depth: 0.5, release: 150, trigger: 'kick' } } });

  // C#m9 - Amaj7 - F#m9 - G#m7 (a minor v, not a major B), a bar each; the hook an octave down from a
  // happy-hardcore register, E4 to E5
  const tune = up(
    phrase([
      [0, 'G#5', 2], [2, 'C#6', 2], [4, 'B5', 2], [6, 'G#5', 2], [8, 'E5', 2], [10, 'F#5', 2], [12, 'G#5', 4],
      [16, 'A5', 2], [18, 'G#5', 2], [20, 'E5', 2], [22, 'C#5', 2], [24, 'E5', 4], [28, 'F#5', 2], [30, 'G#5', 2],
      [32, 'B5', 4], [36, 'G#5', 2], [38, 'B5', 2], [40, 'E6', 4], [44, 'D#6', 2], [46, 'B5', 2],
      [48, 'D#6', 4], [52, 'C#6', 4], [56, 'B5', 4], [60, 'F#5', 4],
    ]),
    -12
  );
  const chords = [['C#3', 'G#3', 'D#4', 'E4'], ['A2', 'E3', 'G#3', 'C#4'], ['F#2', 'C#3', 'G#3', 'A3'], ['G#2', 'D#3', 'F#3', 'B3']];
  const roots = ['C#2', 'A1', 'F#1', 'G#1'];
  const hardcoreBeat = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.clap, '....x.......x...'], [D.openHat, '..o...o...o...o.']], 0.8);
  // Breakcore: the break, its last bars chopped (bar 3 starts with bar 1's second half, a roll) and a stop-time
  const chopped = [
    ...rollingBreak(),
    ...later(beat([[D.kick, '..XX....X.X.....'], [D.snare, 'X.g.X.gX.X..'], [D.closedHat, 'x.o.x.o.x.o.']], 0.8), 32),
    ...later(roll32(D.snare, 12, 16, 0.3, 0.85), 32),
    ...later(beat([[D.kick, 'X.X.....'], [D.snare, '....X.gX'], [D.closedHat, 'x.o.x.o.']], 0.8), 48),
  ];
  return inSpace(
    project(
      'Breakcore starter',
      172,
      0,
      [9, 17],
      [breaks, kit, keys, hook, atmos, sub, room],
      [
        clip(kit, 'Hardcore', 1, 1, hardcoreBeat, 4),
        clip(hook, 'Hook A', 1, 4, tune),
        clip(sub, 'Sub', 1, 4, progression(roots, 16, '1n', 0.7)),
        clip(atmos, 'Atmos', 1, 4, progression(chords, 16, '1n', 0.45), 4),
        clip(keys, 'Chords', 5, 4, progression(chords, 16, '1n', 0.6)),
        clip(breaks, 'Breakcore A', 5, 4, chopped),
        clip(sub, 'Sub', 5, 4, progression(roots, 16, '2n.', 0.65)),
        clip(breaks, 'Breaks', 9, 4, [...rollingBreak(), ...later(rollingBreak(true), 32)], 2),
        clip(hook, 'Hook B', 9, 4, tune, 2),
        clip(keys, 'Chords', 9, 4, everyBar(4, (b): Step[] => [[0, chords[b], 0.6, '2n.'], [12, chords[b], 0.45, '4n']]), 2),
        clip(sub, 'Sub', 9, 4, progression(roots, 16, '1n', 0.7), 2),
      ],
      [[1, 'Hook'], [5, 'Breakcore'], [9, 'Hook over breaks']],
      master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.2 })
    ),
    STUDIO
  );
}

// ---------- RPG battle (leitmotif) ----------

function rpg(): ProjectSnapshot {
  const kit = drumBus();
  // The battle as a modern game score: horn and trumpet in unison, cello and pizzicato ostinatos,
  // contrabass and pick bass, a low guitar, live drums with taiko and timpani (seated as an orchestra)
  const horn = track('French horn', 'frenchHorn', { volume: -4, pan: -0.25, reverbSend: 0.35, fx: { peq: EQ.brass(), human: human(0.35, 0.2) } });
  const tpt = track('Trumpet', 'trumpet', { volume: -9, pan: 0.15, reverbSend: 0.35, fx: { peq: EQ.brass(), human: human(0.35, 0.2) } });
  const cello = track('Cello', 'cello', { volume: -6, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(40)), human: human(0.3, 0.2) } });
  const pizz = track('Pizzicato', 'pizzicato', { volume: -11, pan: -0.35, reverbSend: 0.3, fx: { human: human(0.35) } });
  const contra = track('Contrabass', 'contrabass', { volume: -8, pan: 0.35, reverbSend: 0.2, fx: { human: human(0.3, 0.2) } });
  const bass = track('Pick bass', 'pickBass', { volume: -9, fx: { peq: peq(lowCut(35)), compressor: glue(-20), human: human(0.2) } });
  const gtr = track('Guitar', 'distortionGuitar', { volume: -14, pan: 0.5, fx: { peq: EQ.guitar(), human: human(0.25, 0.1) } });
  const marimba = track('Marimba', 'marimba', { volume: -5, reverbSend: 0.25, fx: { human: human(0.3) } });
  const brass = track('Brass', 'brassSection', { volume: -8, pan: -0.2, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.35) } });
  const trombone = track('Trombone', 'trombone', { volume: -10, pan: 0.3, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.35, 0.2) } });
  const piano = track('Piano', 'piano', { volume: -7, reverbSend: 0.3, fx: { peq: EQ.piano(), human: human(0.3) } });
  const drums = track('Drums', 'acousticKit', { volume: -3, output: kit.id, reverbSend: 0.1, fx: { human: human(0.2) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id, reverbSend: 0.35 });
  const timpani = track('Timpani', 'timpani', { volume: -9, reverbSend: 0.4, fx: { human: human(0.2) } });

  // In town: the motif at half speed, major, on marimba (charming, and the one place it belongs)
  const town = melody([[0, 'D5', 4], [4, 'F#5', 4], [8, 'G5', 2], [10, 'A5', 6], [16, 'G5', 4], [20, 'F#5', 4], [24, 'D5', 4], [28, 'C#5', 4]], 0.7);
  // The battle: Dm - Bb - Gm - A7(b9), the hero's motif reshaped over each chord in the horn's middle octave
  const rhythm = [[0, 2], [2, 2], [4, 1], [5, 3], [8, 2], [10, 2], [12, 2], [14, 2]];
  const cells = [
    ['D4', 'F4', 'G4', 'A4', 'G4', 'F4', 'D4', 'C4'],
    ['D4', 'F4', 'G4', 'A#4', 'A4', 'F4', 'D4', 'F4'],
    ['D4', 'G4', 'A4', 'A#4', 'A4', 'G4', 'D4', 'E4'],
    ['C#4', 'E4', 'G4', 'A#4', 'A4', 'G4', 'E4', 'C#4'],
  ];
  const battle = everyBar(4, (b) => phrase(rhythm.map(([s, len], i): [number, string, number] => [s, cells[b][i], len])));
  const roots = ['D2', 'A#1', 'G1', 'A1'];
  const bassLine = everyBar(4, (b): Step[] => [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, i % 2 ? nameOf(midiOf(roots[b]) + 12) : roots[b], i % 4 === 0 ? 0.85 : 0.62, '8n']));
  const celloRoots = ['D2', 'A#2', 'G2', 'A2'];
  const ostinato = everyBar(4, (b): Step[] => [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, i % 2 ? nameOf(midiOf(celloRoots[b]) + 12) : celloRoots[b], i === 0 ? 0.8 : i % 2 ? 0.55 : 0.65, '8n']));
  const pizzLine = stabs([['F3', 'A3'], ['F3', 'A#3'], ['G3', 'A#3'], ['G3', 'C#4']], [2, 6, 10, 14], 1, 0.6);
  const chugs = stabs([power('D3'), power('A#2'), power('G2'), power('A2')], [0, 4, 8, 12], 2, 0.75);
  const groove = beat([[D.kick, 'X.....X.X.......'], [D.snare, '....X..g....X...'], [D.closedHat, 'x.o.x.o.x.o.x.o.'], [D.openHat, '..............o.']], 0.8);
  const crashes = everyBar(4, (b): Step[] => (b % 2 ? [] : [[0, D.crash, 0.55]]));
  const taikoHits = everyBar(4, (b): Step[] => [[0, b === 3 ? 'A2' : 'D2', 0.75], [10, 'G1', 0.55], [14, 'D2', 0.6]]);
  const timpaniHits = progression(['D2', 'A#2', 'G2', 'A2'], 16, '2n', 0.65);
  return inSpace(
    project(
      'RPG Battle starter',
      140,
      0,
      [5, 17],
      [horn, tpt, cello, pizz, contra, bass, gtr, marimba, brass, trombone, piano, drums, taiko, timpani, kit],
      [
        clip(marimba, 'Town theme', 1, 2, town, 2),
        clip(contra, 'Town bass', 1, 4, progression(['D2', 'G1', 'D2', 'A1'], 16, '2n', 0.6)),
        clip(horn, 'Battle motif', 5, 4, battle, 2),
        clip(tpt, 'Battle motif', 5, 4, battle, 2),
        clip(cello, 'Ostinato', 5, 4, ostinato, 3),
        clip(pizz, 'Offbeats', 5, 4, pizzLine, 3),
        clip(bass, 'Battle bass', 5, 4, bassLine, 3),
        clip(contra, 'Battle bass', 5, 4, progression(roots, 16, '1n', 0.65), 3),
        clip(gtr, 'Power chords', 9, 4, chugs, 2),
        clip(drums, 'Battle', 5, 4, [...everyBar(4, () => groove), ...crashes], 3),
        clip(taiko, 'Battle', 5, 4, taikoHits, 3),
        clip(timpani, 'Downbeats', 5, 4, timpaniHits, 3),
        // Finale: the motif stacked on the brass section and piano, the trombone doubling the bass line
        clip(brass, 'Finale', 13, 4, battle.map(([s, n, v]): Step => [s, n, v, '8n'])),
        clip(trombone, 'Finale', 13, 4, up(bassLine, 12)),
        clip(piano, 'Finale', 13, 4, octaves(battle)),
      ],
      [[1, 'Town'], [5, 'Battle'], [13, 'Finale']],
      master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
    ),
    HALL
  );
}

// ---------- Metal dubstep ----------

function metalDubstep(): ProjectSnapshot {
  const room = darkRoom();
  const kit = drumBus(-16);
  // Guitars double-tracked: panned apart, different HUMAN, the right one a hair late
  const gtrL = track('Guitar L', 'distortionGuitar', { volume: -7, pan: -0.6, fx: { peq: EQ.guitar(), compressor: glue(-20), human: human(0.2, 0.1) } });
  const gtrR = track('Guitar R', 'distortionGuitar', { volume: -8, pan: 0.6, fx: { peq: EQ.guitar(), compressor: glue(-20), human: human(0.3, 0.15) } });
  const lead = track('Lead', 'charang', { volume: -8, sends: send(room, 0.2), fx: { peq: peq(lowCut(200), highCut(8000)) } });
  // The growls driven hard behind a low cut, so the sub underneath stays clean
  const growl = track('Growl', 'growlBass', { volume: -6, fx: { peq: peq(lowCut(120)), distortion: { on: true, amount: 0.1 }, mbc: tameFizz() } });
  const wobble = track('Wobble', 'wobbleBass', { volume: -10, fx: { peq: peq(lowCut(120)), distortion: { on: true, amount: 0.1 } } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(110), pump: { on: true, depth: 0.4, release: 200, trigger: 'kick' } } });
  const drums = track('Drums', 'acousticKit', { volume: -3, output: kit.id, reverbSend: 0.1, fx: { peq: EQ.kit() } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id, reverbSend: 0.15 });
  const trombone = track('Trombone', 'trombone', { volume: -12, pan: 0.3, sends: send(room, 0.3), fx: { peq: peq(lowCut(60), highCut(8000)), human: human(0.3) } });
  const tuba = track('Tuba', 'tuba', { volume: -12, pan: 0.3, sends: send(room, 0.25), fx: { peq: peq(lowCut(40), highCut(8000)), human: human(0.3) } });
  const choir = track('Choir', 'choir', { volume: -14, reverbSend: 0.4, fx: { peq: peq(lowCut(150)) } });
  const sfx = track('FX', 'fx', { volume: -16 });

  // E Phrygian power chords, root and fifth: F is the flat second, Bb the tritone. One bar of 16th
  // chugs, accented where the chord moves
  const riffRoots = ['E2', 'E2', 'E2', 'F2', 'E2', 'E2', 'G2', 'E2', 'E2', 'E2', 'A#2', 'A2', 'G2', 'F2', 'E2', 'E2'];
  const riffVel = 'XxxXxxXxXxXxXxXx';
  const riff = riffRoots.map((r, i): Step => [i, power(r), VEL[riffVel[i]], '16n']);
  // Four bars: three of the riff, then half of it and the tritone falling to A
  const lift = [...riff, ...later(riff, 16), ...later(riff, 32), ...later(riff.filter(([s]) => s < 8), 48), [56, power('A#2'), 0.9, '4n'] as Step, [60, power('A2'), 0.85, '4n'] as Step];
  const verse = beat([[D.kick, 'X.X...X.X.X...X.'], [D.snare, '....X..g....X...'], [D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.8);
  // The drop in half time: guitar and growl chug exactly on the kicks, an F stab on step 11
  const kicks = [0, 3, 6, 12, 14];
  const half = beat([[D.kick, 'X..X..X.....X.X.'], [D.snare, '........X.......'], [D.ride, 'o...o...o...o...']], 0.8);
  const chugs = (low: string, f: string, vel: number): Step[] => everyBar(1, (): Step[] => [...kicks.map((s, i): Step => [s, low, i === 0 ? vel : vel * 0.85, '16n']), [10, f, vel, '16n']]);
  const pcChugs = (vel: number): Step[] => everyBar(1, (): Step[] => [...kicks.map((s, i): Step => [s, power('E2'), i === 0 ? vel : vel * 0.85, '16n']), [10, power('F2'), vel, '16n']]);
  // Low brass and choir, whole notes: E5 - F5 - E5 - Bb5 (no heroic major chords)
  const lowBrass = progression(['B2', 'C3', 'B2', 'F3'], 16, '1n', 0.6);
  const tubaLine = progression(['E2', 'F2', 'E2', 'A#2'], 16, '1n', 0.6);
  const choirLine = progression([['E3', 'B3'], ['F3', 'C4'], ['E3', 'B3'], ['A#2', 'F3']], 16, '1n', 0.5);
  return inSpace(
    project(
      'Metal Dubstep starter',
      150,
      0,
      [9, 17],
      [gtrL, gtrR, lead, growl, wobble, sub, drums, taiko, trombone, tuba, choir, sfx, kit, room],
      [
        clip(gtrL, 'Riff', 1, 4, lift, 2),
        clip(gtrR, 'Riff', 1, 4, later(lift, 0.06), 2),
        clip(drums, 'Verse', 5, 1, verse, 3),
        clip(drums, 'Build', 8, 1, beat([[D.snare, 'xxxxXXXX']], 0.8)),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        clip(drums, 'Half time', 9, 1, [[0, D.crash, 0.6] as Step, ...half], 8),
        clip(taiko, 'Taiko', 9, 1, [[0, 'E2', 0.75], [6, 'E2', 0.6], [12, 'B2', 0.65]], 8),
        clip(gtrL, 'Chugs', 9, 1, pcChugs(0.85), 8),
        clip(gtrR, 'Chugs', 9, 1, later(pcChugs(0.8), 0.06), 8),
        clip(growl, 'Chugs', 9, 1, chugs('E1', 'F1', 0.85), 4, '1/16'),
        clip(growl, 'Chugs', 13, 1, chugs('E1', 'F1', 0.85), 4, '1/8T'),
        clip(wobble, 'Wobble', 9, 2, [[0, 'E1', 0.4, '1m'], [16, 'E1', 0.4, '2n'], [24, 'G1', 0.4, '2n']], 4, '1/8'),
        clip(sub, 'Sub', 9, 1, [[0, 'E1', 0.75, '1m']], 8),
        clip(trombone, 'Power chords', 9, 4, lowBrass, 2),
        clip(tuba, 'Power chords', 9, 4, tubaLine, 2),
        clip(choir, 'Choir', 9, 4, choirLine, 2),
        clip(lead, 'Line', 13, 4, phrase([[0, 'B3', 8], [8, 'C4', 4], [12, 'B3', 4], [16, 'G3', 8], [24, 'A3', 8], [32, 'B3', 8], [40, 'D4', 4], [44, 'C4', 4], [48, 'B3', 16]], 0.8, 0.65)),
        clip(sfx, 'Hit', 9, 2, softHit),
      ],
      [[1, 'Riff'], [5, 'Build'], [9, 'Drop']],
      master({ on: true, depth: 0.25, time: FAST }, { on: true, amount: 1.3 })
    ),
    ROOM
  );
}

// ---------- Melodic dubstep (with a violin lead) ----------

function melodicDubstep(): ProjectSnapshot {
  const room = darkRoom();
  const kit = drumBus();
  const piano = track('Piano', 'piano', { volume: -4, sends: send(room, 0.25), fx: { peq: EQ.piano(), human: human(0.35) } });
  const strings = track('Strings', 'slowStrings', { volume: -12, sends: send(room, 0.35), fx: { peq: peq(lowCut(150), highCut(8000)), human: human(0.3, 0.2) } });
  const saw = track('Chords', 'synthDesigner', { volume: -6, synth: PATCH.darkSupersaw(), sends: send(room, 0.2), fx: { peq: peq(lowCut(200), highCut(9000)), chorus: { on: true, mix: 0.25 }, pump: { on: true, depth: 0.7, release: 220, trigger: 'kick' } } });
  // The hook on two tracks, the same notes: a violin (vibrato and bow) over a voice
  const violin = track('Violin', 'violin', { volume: -6, pan: -0.1, sends: send(room, 0.3), fx: { peq: peq(lowCut(200), bell(3000, -3), highCut(8000)), human: human(0.25, 0.2) } });
  const voice = track('Voice lead', 'voiceLead', { volume: -10, pan: 0.1, sends: send(room, 0.3), fx: { peq: peq(lowCut(200), bell(3000, -3), highCut(8000)) } });
  const choir = track('Choir', 'choirPad', { volume: -16, reverbSend: 0.4, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.4, release: 260, trigger: 'kick' } } });
  const wobble = track('Wobble', 'wobbleBass', { volume: -8, fx: { peq: peq(lowCut(120)), distortion: { on: true, amount: 0.1 } } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(150), pump: { on: true, depth: 0.5, release: 200, trigger: 'kick' } } });
  const drums = track('Drums', 'breakbeatKit', { volume: -4, output: kit.id, reverbSend: 0.1, fx: { peq: peq(lowCut(30), bell(400, -3)) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id, reverbSend: 0.2 });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });

  // Dm(add9) - Bbmaj7 - Gm9 - Asus4 to Am: bittersweet, and the phrase ends on a minor v, not a major V
  const dm9 = ['D3', 'A3', 'E4', 'F4'];
  const bbmaj7 = ['A#2', 'F3', 'A3', 'D4'];
  const gm9 = ['G2', 'F3', 'A3', 'A#3'];
  const asus4 = ['A2', 'E3', 'D4'];
  const am = ['A2', 'E3', 'C4'];
  const harmony = (vel: number): Step[] => [[0, dm9, vel, '1n'], [16, bbmaj7, vel, '1n'], [32, gm9, vel, '1n'], [48, asus4, vel, '2n'], [56, am, vel * 0.9, '2n']];
  const rootNotes = ['D2', 'A#1', 'G1', 'A1'];
  const introPiano = [...harmony(0.55), ...progression(rootNotes, 16, '1n', 0.5)];
  const buildPiano = broken([['D3', 'A3', 'D4', 'E4', 'F4', 'E4', 'D4', 'A3'], ['A#2', 'F3', 'A3', 'D4', 'F4', 'D4', 'A3', 'F3'], ['G2', 'F3', 'A3', 'A#3', 'D4', 'A#3', 'A3', 'F3'], ['A2', 'E3', 'A3', 'D4', 'E4', 'C4', 'A3', 'E3']], 2, 2, 0.5);
  // Off-beat chord stabs, the last bar's turning from Asus4 to Am halfway
  const sawStabs = everyBar(4, (b): Step[] => [2, 6, 10, 14].map((s): Step => [s, b === 3 ? (s < 8 ? asus4 : am) : [dm9, bbmaj7, gm9][b], s === 2 ? 0.7 : 0.6, dur(1)]));
  // The hook, E4 to C5: it sings, rather than beeping an octave up
  const hook = phrase([
    [0, 'A4', 4], [4, 'F4', 2], [6, 'G4', 2], [8, 'A4', 6], [14, 'C5', 2],
    [16, 'A#4', 8], [24, 'A4', 4], [28, 'G4', 4],
    [32, 'F4', 4], [36, 'E4', 2], [38, 'F4', 2], [40, 'G4', 4], [44, 'A4', 4],
    [48, 'E4', 12],
  ]);
  // The wobble pulses on D, short and gappy; the sub holds the chord roots
  const wobbleBar: Step[] = [[0, 'D1', 0.85, dur(3)], [6, 'D1', 0.72, dur(2)], [10, 'D1', 0.78, dur(2)], [14, 'D1', 0.72, dur(2)]];
  const half = [
    ...beat([[D.kick, 'X.........X.....'], [D.snare, '........X.......'], [D.clap, '........x.......'], [D.openHat, '..............o.']], 0.8),
    ...[0, 2, 4, 6, 8, 10, 12].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.5 : 0.3]),
  ];
  return inSpace(
    project(
      'Melodic Dubstep starter',
      150,
      0,
      [9, 17],
      [piano, strings, saw, violin, voice, choir, wobble, sub, drums, taiko, sfx, kit, room],
      [
        clip(piano, 'Intro', 1, 4, introPiano),
        clip(strings, 'Strings', 1, 4, harmony(0.5), 2),
        clip(piano, 'Build', 5, 4, buildPiano),
        clip(drums, 'Snare roll', 5, 4, rollWithGap),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        clip(saw, 'Stabs', 9, 4, sawStabs, 2),
        clip(violin, 'Hook', 9, 4, hook, 2),
        clip(voice, 'Hook', 9, 4, hook, 2),
        clip(strings, 'Strings', 9, 4, harmony(0.45), 2),
        clip(choir, 'Choir', 9, 4, harmony(0.45), 2),
        clip(wobble, 'Wobble', 9, 1, wobbleBar, 4, '1/8'),
        clip(wobble, 'Wobble', 13, 1, wobbleBar, 4, '1/16T'),
        clip(sub, 'Sub', 9, 4, progression(['D1', 'A#1', 'G1', 'A1'], 16, '1n', 0.7), 2),
        clip(drums, 'Half time', 9, 1, half, 8),
        clip(taiko, 'Taiko', 9, 1, [[0, 'D2', 0.75], [10, 'A2', 0.62]], 8),
        clip(sfx, 'Hit', 9, 2, softHit),
      ],
      [[1, 'Intro'], [5, 'Build'], [9, 'Drop'], [13, 'Drop 2']],
      master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.3 })
    ),
    HALL
  );
}

// ---------- Riddim ----------

function riddim(): ProjectSnapshot {
  const kit = drumBus();
  const organ = track('Organ drone', 'pipeOrgan', { volume: -18, reverbSend: 0.4, fx: { peq: peq(lowCut(200), highCut(5000)) } });
  // Growl and wobble (gritty already) with a touch of drive behind a low cut; the growl's drive creeps up through the drop.
  // They lead, 3 dB up on the drums (and the sub 1.5): with the snare softer (see below), there's room
  const growl = track('Growl', 'growlBass', {
    volume: -2,
    fx: { peq: peq(lowCut(120), bell(1000, 3)), distortion: { on: true, amount: 0.1 }, mbc: tameFizz() },
    automation: [{ param: 'fx:distortion.amount', points: [{ bar: 9, value: 0.1 }, { bar: 17, value: 0.2 }] }],
  });
  const wobble = track('Wobble', 'wobbleBass', { volume: -5, fx: { peq: peq(lowCut(120)), distortion: { on: true, amount: 0.1 } } });
  const reese = track('Reese', 'reeseBass', { volume: -11, fx: { peq: peq(lowCut(120)), distortion: { on: true, amount: 0.1 } } });
  const sub = track('Sub', 'subBass', { volume: -8.5, fx: { peq: EQ.sub(120), pump: { on: true, depth: 0.5, release: 200, trigger: 'kick' } } });
  // (4 dB under where they were: their peaks stood 9 dB over the growl and wobble, the lead here)
  const drums = track('Drums', 'technoKit', { volume: -8, output: kit.id, fx: { peq: peq(lowCut(30), bell(350, -3)), distortion: { on: true, amount: 0.08 } } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id });
  const sfx = track('FX', 'fx', { volume: -16 });

  // The call: triplets on G, G, Ab, then G, G, G up an octave, short with gaps
  const t = 4 / 3;
  const call: Step[] = [[0, 'G1', 0.85, '16n'], [t, 'G1', 0.7, '16n'], [2 * t, 'G#1', 0.8, '16n'], [8, 'G1', 0.85, '16n'], [8 + t, 'G1', 0.7, '16n'], [8 + 2 * t, 'G2', 0.8, '16n']];
  // The answer: a held G, an Ab, back to G
  const answer: Step[] = [[0, 'G1', 0.85, '4n'], [8 + 2 * t, 'G#1', 0.75, '16n'], [12, 'G1', 0.8, '8n']];
  // The snare plays softer than the rest of the kit (0.8 of its velocity in the drop, 0.7 in the
  // build's roll): it stood over everything else at the limiter (with the clap on the same step, and
  // the roll's crescendo), so reaching -14 LUFS took 6 dB of limiting (held for 1% of the song).
  // Now it takes under 3, with the growls up
  const softSnare = (steps: Step[], by: number) => steps.map(([s, n, v, d]): Step => [s, n, n === D.snare ? v * by : v, d]);
  const drop = softSnare(beat([[D.kick, 'X...........g...'], [D.snare, '........X.......'], [D.clap, '........x.......'], [D.closedHat, '..x...x...x...x.']], 0.8), 0.8);
  return inSpace(
    project(
      'Riddim starter',
      140,
      0,
      [9, 17],
      [organ, growl, wobble, reese, sub, drums, taiko, sfx, kit],
      [
        clip(organ, 'Drone', 1, 4, [[0, ['G2', 'D3'], 0.6, '3m'], [48, ['G#2', 'D3'], 0.6, '1m']]),
        clip(taiko, 'Toll', 1, 2, [[0, 'G2', 0.6]], 2),
        clip(sub, 'Pulse', 5, 4, pulse(['G1', 'G1', 'G1', 'G1'], [0, 4, 8, 12], 2, 0.6)),
        clip(growl, 'Tease', 7, 1, call, 1, '1/8T'),
        clip(drums, 'Snare roll', 5, 4, softSnare(rollWithGap, 0.7)),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        // Call and response, the wobble rate changing every two bars; the gaps are the style
        clip(growl, 'Call', 9, 1, call, 1, '1/8T'),
        clip(wobble, 'Answer', 10, 1, answer, 1, '1/16'),
        clip(growl, 'Call', 11, 1, call, 1, '1/16'),
        clip(wobble, 'Answer', 12, 1, answer, 1, '1/16T'),
        clip(growl, 'Call', 13, 1, call, 1, '1/16T'),
        clip(wobble, 'Answer', 14, 1, answer, 1, '1/8'),
        clip(growl, 'Call', 15, 1, call, 1, '1/8T'),
        clip(reese, 'Answer', 16, 1, answer),
        clip(sub, 'Pulse', 9, 1, pulse(['G1'], [0, 4, 8, 12], 2, 0.7), 8),
        clip(drums, 'Drop', 9, 1, drop, 8),
        clip(taiko, 'Toll', 9, 2, [[0, 'G2', 0.7]], 4),
        clip(sfx, 'Hit', 9, 2, softHit),
      ],
      [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
      master({ on: true, depth: 0.35, time: FAST }, { on: true, amount: 1.2 })
    ),
    STUDIO
  );
}

// ---------- Kawaii future bass ----------

function futureBass(): ProjectSnapshot {
  // Meant to be bright and cute: modern and sparkly rather than 8-bit
  const saw = track('Chords', 'supersaw', { volume: 0, reverbSend: 0.25, fx: { peq: peq(lowCut(150), highCut(11000)), chorus: { on: true, mix: 0.3 }, pump: { on: true, depth: 0.8, release: 220, trigger: 'kick' } } });
  const pad = track('Pad', 'polysynthPad', { volume: -14, reverbSend: 0.4, fx: { peq: EQ.pad(), pump: { on: true, depth: 0.6, release: 300, trigger: 'kick' } } });
  const pluck = track('Pluck', 'pluck', { volume: -12, delaySend: 0.2, reverbSend: 0.2, fx: { peq: peq(lowCut(200), highCut(5000)) } });
  const celesta = track('Celesta', 'celesta', { volume: -16, reverbSend: 0.45, pan: 0.3, fx: { peq: EQ.bells() } });
  const marimba = track('Marimba', 'marimba', { volume: -12, reverbSend: 0.2, pan: -0.15, fx: { human: human(0.15) } });
  const lead = track('Vocal lead', 'voiceLead', { volume: -6, delaySend: 0.15, reverbSend: 0.2, fx: { peq: peq(lowCut(200), bell(3000, -2, 1.5), highCut(11000)) } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(180), pump: { on: true, depth: 0.7, release: 220, trigger: 'kick' } } });
  const drums = track('Drums', 'technoKit', { volume: -4, fx: { peq: EQ.kit(), compressor: glue() } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });

  // Gmaj9 - A6add9 - F#m7 - Bm9 in D
  const chords = [['G3', 'B3', 'D4', 'F#4', 'A4'], ['A3', 'C#4', 'E4', 'F#4', 'B4'], ['F#3', 'A3', 'C#4', 'E4'], ['B3', 'D4', 'F#4', 'A4', 'C#5']];
  // Chopped to the drums, two bars a chord; each chord blooms up from a grace chord a step below
  const chops = everyBar(8, (b): Step[] => {
    const c = chords[Math.floor(b / 2)];
    const hits = [0, 3, 6, 8, 10, 11, 13, 14].map((s, i): Step => [s === 0 && b % 2 === 0 ? 0.5 : s, c, i === 0 ? 0.85 : i % 2 ? 0.6 : 0.7, i % 3 === 2 ? '8n' : '16n']);
    return b % 2 === 0 ? [[0, up([[0, c, 0.5]], -2)[0][1], 0.5, '32n'], ...hits] : hits;
  });
  // The topline sung an octave lower than a chip lead would play it (E4 to F#5); marimba in unison under it
  const topline = up(
    phrase(
      [
        [0, 'F#5', 2], [3, 'A5', 2], [6, 'D6', 2], [8, 'C#6', 2], [10, 'A5', 2], [12, 'F#5', 2], [14, 'A5', 2], [16, 'B5', 4], [22, 'A5', 2], [24, 'F#5', 4], [28, 'E5', 4],
        [32, 'E5', 2], [35, 'A5', 2], [38, 'C#6', 2], [40, 'B5', 2], [42, 'A5', 2], [44, 'F#5', 2], [46, 'A5', 2], [48, 'B5', 4], [54, 'C#6', 2], [56, 'E6', 4], [60, 'C#6', 4],
        [64, 'C#6', 2], [67, 'A5', 2], [70, 'F#5', 2], [72, 'E5', 2], [74, 'F#5', 2], [76, 'A5', 2], [78, 'C#6', 2], [80, 'B5', 6], [86, 'A5', 2], [88, 'F#5', 8],
        [96, 'D6', 2], [99, 'C#6', 2], [102, 'A5', 2], [104, 'F#5', 2], [106, 'A5', 2], [108, 'B5', 2], [110, 'C#6', 2], [112, 'D6', 8], [120, 'E6', 4], [124, 'F#6', 4],
      ],
      0.82,
      0.62
    ),
    -12
  );
  // One celesta note at the top of each bar instead of a bell doubling every note
  const sparkle = (tops: string[]): Step[] => everyBar(tops.length, (b): Step[] => [[0, tops[b], 0.35, '2n']]);
  const half = (b: number): Step[] => [
    ...beat([[D.kick, 'X.....X...X.....'], [D.snare, '........X.......'], [D.clap, '........x.......'], [D.closedHat, b % 2 ? 'xoxoxoxoxoxo....' : 'xoxoxoxoxoxoxoxo']], 0.8),
    ...(b % 2 ? roll32(D.closedHat, 12, 16, 0.3, 0.65) : []),
  ];
  // The intro arp broken up: a rest at the end of each half-bar, softer between the beats
  const introArp = everyBar(4, (b) =>
    Array.from({ length: 16 }, (_, i): Step => [i, chords[b][i % chords[b].length].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.6 : i % 2 ? 0.38 : 0.48, '16n']).filter(([s]) => s % 8 !== 7)
  );
  return inSpace(
    project(
      'Kawaii Future Bass starter',
      150,
      0,
      [9, 17],
      [saw, pad, pluck, celesta, marimba, lead, sub, drums, sfx],
      [
        clip(pad, 'Pad', 1, 4, progression(chords, 16, '1n', 0.5), 2),
        clip(pluck, 'Arp', 1, 4, introArp, 2),
        clip(celesta, 'Sparkle', 1, 4, sparkle(['A5', 'B5', 'E5', 'C#6'])),
        clip(saw, 'Held', 5, 4, progression(chords, 16, '1n', 0.55)),
        clip(drums, 'Snare roll', 5, 4, rollWithGap),
        clip(sfx, 'Build-up', 5, 4, softBuild(4)),
        clip(saw, 'Chops', 9, 8, chops),
        clip(lead, 'Topline', 9, 8, topline),
        clip(marimba, 'Melody', 9, 8, topline.map(([s, n, v, d]): Step => [s, n, v * 0.85, d])),
        clip(celesta, 'Sparkle', 9, 8, sparkle(['F#5', 'B5', 'E5', 'E5', 'C#6', 'B5', 'D6', 'D6'])),
        clip(sub, 'Sub', 9, 8, progression(['G1', 'A1', 'F#1', 'B1'], 32, '2m', 0.7)),
        clip(drums, 'Half time', 9, 2, [...half(0), ...later(half(1), 16)], 4),
        clip(sfx, 'Hit', 9, 2, softHit),
      ],
      [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
      master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.3 })
    ),
    STUDIO
  );
}

// ---------- Drift phonk ----------

function phonk(): ProjectSnapshot {
  // The real phonk cowbell (two squares through a band-pass), crushed and driven
  const cowbell = track('Cowbell lead', 'synthDesigner', {
    volume: -6,
    synth: PATCH.phonkCowbell(),
    reverbSend: 0.1,
    fx: { peq: peq(lowCut(300), highCut(8000)), lofi: { on: true, crush: bits(10), tone: 8000, wow: 0, mix: 0.4 }, distortion: { on: true, amount: 0.25 }, pump: { on: true, depth: 0.45, release: 180, trigger: 'kick' } },
  });
  // (4 dB under where they were: they stood 8 dB over the cowbell and the 808)
  const drums = track('Drums', 'drumMachine', { volume: -8, fx: { peq: peq(lowCut(30), highCut(12000)), lofi: { on: true, crush: bits(12), tone: 9000, wow: 0, mix: 0.3 }, compressor: glue() } });
  const bass = track('808', 'bass808', { volume: -8, fx: { peq: EQ.eight() } });
  const dirt = track('808 grit', 'growlBass', { volume: -16, fx: { peq: peq(lowCut(150), bell(1000, 3)), distortion: { on: true, amount: 0.1 }, pump: { on: true, depth: 0.5, release: 180, trigger: 'kick' } } });
  const pad = track('Pad', 'synthDesigner', { volume: -18, synth: PATCH.darkPad(), reverbSend: 0.3, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.5, release: 220, trigger: 'kick' } } });

  // D Phrygian (D Eb F G A Bb C): the bell riff, two bars, every note doubled by the kit's cowbell for the clank
  const riff: Step[] = [
    [0, 'D5', 0.85, '16n'], [3, 'D5', 0.62, '16n'], [6, 'D#5', 0.78, '16n'], [8, 'D5', 0.8, '16n'], [10, 'C5', 0.62, '16n'], [11, 'D5', 0.66, '16n'], [14, 'A4', 0.62, '16n'], [15, 'A#4', 0.7, '16n'],
    [16, 'D5', 0.85, '16n'], [19, 'D5', 0.62, '16n'], [22, 'D#5', 0.78, '16n'], [24, 'F5', 0.8, '16n'], [26, 'D#5', 0.62, '16n'], [27, 'D5', 0.66, '16n'], [28, 'C5', 0.72, '16n'], [30, 'A#4', 0.66, '16n'],
  ];
  const cowbells = riff.map(([s]): Step => [s, D.cowbell, 0.35]);
  const house = (b: number): Step[] => [
    ...beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X..g....X..g'], [D.clap, '....x.......x...'], [D.closedHat, 'x.xx.xxx.xx.xx.x'], [D.openHat, '..o...o...o...o.']], 0.8),
    ...(b === 3 ? roll32(D.closedHat, 12, 16, 0.3, 0.75) : []),
  ];
  const drive = everyBar(4, house);
  // The 808 on every kick; at the end of bar 2 a C runs into the next D, so it slides up
  const eight: Step[] = [[0, 'D2', 0.8, '8n'], [4, 'D2', 0.72, '8n'], [8, 'D2', 0.78, '8n'], [12, 'D2', 0.72, '8n'], [16, 'D2', 0.8, '8n'], [20, 'D2', 0.72, '8n'], [24, 'D2', 0.78, '8n'], [28, 'C2', 0.78, '4n']];
  return inSpace(
    project(
      'Drift Phonk starter',
      130,
      0.04,
      [5, 17],
      [cowbell, drums, bass, dirt, pad],
      [
        clip(cowbell, 'Riff', 1, 2, riff, 2),
        clip(drums, 'Hats', 3, 2, beat([[D.closedHat, 'x.xx.xxx.xx.xx.xx.xx.xxx.xx.xx.x']])),
        clip(cowbell, 'Riff', 5, 2, riff, 4),
        clip(drums, 'Drive', 5, 4, [...drive, ...cowbells, ...later(cowbells, 32)], 2),
        clip(bass, '808', 5, 2, eight, 6),
        clip(dirt, 'Grit', 5, 2, up(eight, 12), 6, '1/16'),
        // The switch: the riff a fourth up over a dark pad, Dm to the Phrygian Eb
        clip(cowbell, 'Switch', 13, 2, up(riff, 5), 2),
        clip(drums, 'Clank', 13, 2, cowbells, 2),
        clip(pad, 'Pad', 13, 2, progression([['D3', 'F3', 'A3'], ['D#3', 'G3', 'A#3']], 16, '1n', 0.5), 2),
      ],
      [[1, 'Intro'], [5, 'Drop'], [13, 'Switch']],
      master({ on: true, depth: 0.2 }, { on: true, amount: 1.1 })
    ),
    ROOM
  );
}

// ---------- UK drill ----------

function drill(): ProjectSnapshot {
  const room = darkRoom();
  // The motif on a dark grand, a quiet dark bell under it; strings and choir brought up out of the fog
  const piano = track('Piano', 'piano', { volume: -8, sends: send(room, 0.35), delaySend: 0.1, fx: { peq: peq(lowCut(150), highShelf(5000, -3)), human: human(0.15) } });
  const bellLayer = track('Dark bell', 'synthDesigner', { volume: -18, synth: PATCH.darkBell(), sends: send(room, 0.4), fx: { peq: EQ.bells() } });
  const strings = track('Strings', 'slowStrings', { volume: -12, sends: send(room, 0.35), fx: { peq: peq(lowCut(150), highCut(7000)) } });
  const tremolo = track('Tremolo', 'tremolo', { volume: -20, sends: send(room, 0.35), fx: { peq: peq(lowCut(150), highCut(7000)) } });
  const choir = track('Choir', 'choirPad', { volume: -20, reverbSend: 0.4, fx: { peq: peq(lowCut(200)) } });
  const bass = track('808', 'bass808', { volume: -8, fx: { peq: EQ.eight() } });
  // (6 dB under where they were: they stood 11 dB over the piano and the 808)
  const drums = track('Drums', 'drumMachine', { volume: -10, fx: { peq: peq(lowCut(30)), compressor: glue() } });

  // A four-bar motif in G harmonic minor with a gap in every bar; the last bar turns on the eerie F#
  const motif = phrase(
    [[0, 'G4', 2], [3, 'A#4', 2], [6, 'D5', 2], [10, 'D#5', 2], [13, 'D5', 2], [16, 'G4', 2], [19, 'A#4', 2], [22, 'D5', 4], [32, 'G4', 2], [35, 'A#4', 2], [38, 'D5', 2], [42, 'D#5', 2], [45, 'D5', 2], [48, 'G4', 2], [51, 'A#4', 2], [54, 'F#4', 4]],
    0.8,
    0.6
  );
  // Gm(add9) - Ebmaj7 - Cm9 - D7(b9): the b9 (Eb) under the F# keeps the dominant eerie, not bright
  const chords = [['G2', 'D3', 'A3', 'A#3'], ['D#3', 'A#3', 'D4', 'G4'], ['C3', 'A#3', 'D4', 'D#4'], ['D3', 'C4', 'D#4', 'F#4']];
  // The drill bounce over two bars: snare on 3, then late, on 4, with a clap; triplet hat bursts (hats left unhumanized)
  const tri = 2 / 3;
  const bounce: Step[] = [
    ...[0, 11, 18, 26].map((s): Step => [s, D.kick, s === 0 ? 0.8 : 0.72]),
    [8, D.snare, 0.9], [14, D.snare, 0.28], [22, D.snare, 0.28], [28, D.snare, 0.9],
    [8, D.clap, 0.6], [28, D.clap, 0.6],
    ...[0, 2, 8, 10, 12, 16, 18, 20, 24, 30].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.6 : 0.45]),
    ...[5, 5 + tri, 5 + 2 * tri, 26, 26 + tri, 26 + 2 * tri].map((s, i): Step => [s, D.closedHat, 0.38 + (i % 3) * 0.08]),
  ];
  // The 808 slides G - Bb - Eb - F# and back to G over two bars: each note runs into the next, so it glides
  const eight: Step[] = [[0, 'G1', 0.8, dur(11.5)], [11, 'A#1', 0.72, dur(7.5)], [18, 'D#1', 0.78, dur(8.5)], [26, 'F#1', 0.72, dur(6.5)]];
  return inSpace(
    project(
      'UK Drill starter',
      142,
      0,
      [5, 17],
      [piano, bellLayer, strings, tremolo, choir, bass, drums, room],
      [
        clip(piano, 'Motif', 1, 4, motif, 4),
        clip(bellLayer, 'Motif', 5, 4, motif.map(([s, n, v, d]): Step => [s, n, v * 0.8, d]), 3),
        clip(strings, 'Chords', 1, 4, progression(chords, 16, '1n', 0.55), 4),
        clip(tremolo, 'Chords', 5, 4, progression(chords.map((c) => c.slice(2)), 16, '1n', 0.45), 3),
        clip(choir, 'Choir', 1, 4, progression(chords.map((c) => c.slice(1)), 16, '1n', 0.45), 4),
        clip(drums, 'Bounce', 5, 2, bounce, 6),
        clip(bass, '808', 5, 2, eight, 6),
      ],
      [[1, 'Intro'], [5, 'Verse']],
      master({ on: true, depth: 0.15 }, { on: true, amount: 1.15 })
    ),
    ROOM
  );
}

// ---------- Hyper Trap ----------

function rage(): ProjectSnapshot {
  const room = darkRoom();
  // A blown-out, wide lead (driven, crushed, chorused) with a dirtier saw double under it; no bells
  const saw = track('Hyper lead', 'synthDesigner', {
    volume: -4,
    synth: PATCH.wideRageLead(),
    sends: send(room, 0.45),
    fx: { peq: peq(lowCut(200), highCut(9000)), distortion: { on: true, amount: 0.12 }, chorus: { on: true, mix: 0.25 } },
  });
  const dbl = track('Lead double', 'sawLead', { volume: -14, reverbSend: 0.3, fx: { peq: peq(lowCut(200), highCut(5000)), distortion: { on: true, amount: 0.2 } } });
  const pad = track('Pad', 'wavetable', { volume: -15, reverbSend: 0.5, fx: { filter: { on: true, cutoff: 1000 }, peq: EQ.pad(), pump: { on: true, depth: 0.3, release: 260, trigger: 'kick' } } });
  const bass = track('808', 'bass808', { volume: -8, fx: { peq: EQ.eight() } });
  const grit = track('808 grit', 'reeseBass', { volume: -18, fx: { peq: peq(lowCut(150)), distortion: { on: true, amount: 0.12 } } });
  const drums = track('Drums', 'drumMachine', { volume: -5, fx: { peq: peq(highCut(12000)) } });

  // F# Phrygian (G natural is the dark half step): the hook in short stabs, F#3 to C#4
  const hook = phrase(
    [
      [0, 'F#3', 2], [3, 'F#3', 1], [4, 'A3', 2], [6, 'G3', 2], [8, 'F#3', 4], [12, 'C#3', 4],
      [16, 'F#3', 2], [19, 'F#3', 1], [20, 'A3', 2], [22, 'B3', 2], [24, 'C#4', 2], [26, 'B3', 2], [28, 'A3', 2], [30, 'G3', 2],
    ],
    0.88,
    0.66
  );
  const groove = (b: number): Step[] => [
    ...beat([[D.kick, b === 3 ? 'X...............' : 'X......X..X.....'], [D.snare, b === 3 ? '................' : '........X.......'], [D.closedHat, b === 3 ? '' : 'x...x...x...x...']], 0.8),
    ...(b === 1 ? [12, 12 + 2 / 3, 12 + 4 / 3].map((s, i): Step => [s, D.closedHat, 0.35 + i * 0.15]) : []),
    ...(b === 3 ? [[8, D.snare, 0.85] as Step, ...roll32(D.closedHat, 8, 16, 0.3, 0.75)] : []),
  ];
  // F#1 in one bar, D1 (the flat sixth) in the next; every fourth bar leaves its last two beats to the lead
  const eight = everyBar(4, (b): Step[] => {
    const r = b % 2 ? 'D1' : 'F#1';
    return [[0, r, 0.82, '4n'] as Step, [7, r, 0.72, '8n'] as Step, ...(b === 3 ? [] : [[10, r, 0.72, '8n'] as Step])];
  });
  // F#m to a D with no third (D A E): the bVI stays dark
  const padChords = progression([['F#3', 'A3', 'C#4'], ['D3', 'A3', 'E4']], 16, '1n', 0.5);
  return inSpace(
    project(
      'Hyper Trap starter',
      160,
      0,
      [5, 17],
      [saw, dbl, pad, bass, grit, drums, room],
      [
        clip(saw, 'Hook', 1, 2, hook, 8),
        clip(pad, 'Pad', 1, 2, padChords, 8),
        clip(drums, 'Beat', 5, 4, everyBar(4, groove), 3),
        clip(bass, '808', 5, 4, eight, 3),
        clip(grit, 'Grit', 5, 4, up(eight, 12).map(([s, n, , d]): Step => [s, n, 0.35, d]), 3),
        clip(dbl, 'Hook double', 13, 2, hook, 2),
      ],
      [[1, 'Intro'], [5, 'Verse'], [13, 'Hook']],
      master({ on: true, depth: 0.2 }, { on: true, amount: 1.25 })
    ),
    STUDIO
  );
}

// ---------- Neo-soul (chord-first hip-hop) ----------

function neoSoul(): ProjectSnapshot {
  const rhodes = track('E. Piano', 'rhodes', {
    volume: -12,
    reverbSend: 0.25,
    fx: { chorus: { on: true, rate: 0.8, mix: 0.3, depth: 0.4 }, filter: { on: true, cutoff: 6000 }, human: human(0.4) },
    automation: [{ param: 'filterCutoff', points: [{ bar: 1, value: 0.35 }, { bar: 5, value: 0.9 }, { bar: 17, value: 0.9 }] }],
  });
  const piano = track('Piano', 'piano', { volume: -8, reverbSend: 0.25, fx: { human: human(0.4) } });
  const sax = track('Tenor sax', 'tenorSax', { volume: -3, reverbSend: 0.25, delaySend: 0.12, fx: { human: human(0.35, 0.2) } });
  const flute = track('Flute', 'flute', { volume: -4, reverbSend: 0.3, fx: { human: human(0.35, 0.2) } });
  const bass = track('Bass', 'fretlessBass', { volume: -3, fx: { peq: peq(lowCut(35)), human: human(0.4) } });
  const eight = track('808', 'bass808', { volume: -10, fx: { peq: EQ.eight() } });
  const cello = track('Cello', 'cello', { volume: -7, reverbSend: 0.3, fx: { human: human(0.35, 0.2) } });
  // Drums that drag: lots of timing HUMAN on top of the late snares
  const drums = track('Drums', 'breakbeatKit', { volume: -3, fx: { human: { on: true, timing: 0.7, dynamics: 0.25, pitch: 0 } } });

  // Bbmaj7 - Am7 - Gm9 - Am7; the pre-hook swaps the Am7s for A7#9
  const hook = [['A3', 'D4', 'F4', 'C5'], ['G3', 'C4', 'E4', 'G4'], ['F3', 'A#3', 'D4', 'A4'], ['G3', 'C4', 'E4', 'G4']];
  const pre = [hook[0], ['G3', 'C#4', 'C5'], hook[2], ['G3', 'C#4', 'C5']];
  const roots = ['A#1', 'A1', 'G1', 'A1'];
  const comp = (chords: string[][]) => everyBar(4, (b): Step[] => [[0, chords[b], 0.7, '2n.'], [12, chords[b], 0.48, '8n'], [14, chords[b], 0.55, '8n']]);
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.85, '4n.'], [6, roots[b], 0.58, '8n'], [10, nameOf(midiOf(roots[b]) + 7), 0.65, '8n'], [14, nameOf(midiOf(roots[b]) + 12), 0.58, '8n']]);
  const tune = phrase([[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'C5', 6], [14, 'A4', 2], [16, 'C5', 4], [20, 'E5', 4], [24, 'G5', 6], [30, 'E5', 2], [32, 'F5', 4], [36, 'D5', 2], [38, 'A#4', 2], [40, 'A4', 4], [44, 'G4', 4], [48, 'A4', 8], [56, 'C5', 4], [60, 'E5', 4]], 0.72, 0.55);
  // Drums that drag: the snare a little late (12 ms at 80 BPM), ghost notes, a hat run every 4th bar
  const late = 0.064;
  const drag = everyBar(4, (b): Step[] => [
    ...beat([[D.kick, 'X......X..X.....'], [D.snare, '..g...g...g...g.'], [D.closedHat, b === 3 ? 'x.o.x.o.x.o.x.xo' : 'x.o.x.o.x.o.x.o.']], 0.75),
    [4 + late, D.snare, 0.8], [12 + late, D.snare, 0.85],
  ]);
  return inSpace(
    project(
      'Neo-Soul starter',
      80,
      0.18,
      [5, 17],
      [rhodes, piano, sax, flute, bass, eight, cello, drums],
      [
        clip(rhodes, 'Intro', 1, 4, comp(hook)),
        clip(rhodes, 'Hook', 5, 4, comp(hook)),
        clip(rhodes, 'Pre-hook', 9, 4, comp(pre)),
        // The tenor sax an octave down, in its warm middle; the piano doubles it an octave above
        clip(sax, 'Melody', 5, 4, up(tune, -12)),
        clip(piano, 'Doubles', 9, 4, tune.map(([s, n, v, d]): Step => [s, n, v * 0.85, d])),
        clip(flute, 'Counterline', 9, 4, phrase([[8, 'D5', 4], [12, 'C5', 4], [24, 'A#4', 4], [28, 'A4', 4], [40, 'F5', 4], [44, 'E5', 4], [56, 'C#5', 8]], 0.6, 0.5)),
        clip(bass, 'Bass', 5, 4, bassLine, 2),
        clip(eight, '808', 5, 4, roots.map((r, b): Step => [b * 16, r, 0.7, '4n']), 2),
        clip(drums, 'Drag', 5, 4, drag, 2),
        // The switch: up a minor third (Db), drumless at first, then the drums come back
        clip(rhodes, 'Switch', 13, 4, up(comp(hook), 3)),
        clip(cello, 'Switch', 13, 4, up(progression(['A#2', 'A2', 'G2', 'A2'], 16, '1n', 0.6), 3)),
        clip(bass, 'Bass', 15, 2, up(bassLine.filter(([s]) => s < 32), 3)),
        clip(drums, 'Back in', 15, 2, drag.filter(([s]) => s < 32)),
      ],
      [[1, 'Intro'], [5, 'Hook'], [9, 'Pre-hook'], [13, 'Switch']],
      master({ on: false }, { on: true, amount: 1.1 })
    ),
    ROOM
  );
}

// ---------- Bedroom pop ----------

function bedroomPop(): ProjectSnapshot {
  const gtr = track('Guitar', 'cleanGuitar', { volume: -2, pan: -0.2, reverbSend: 0.2, fx: { chorus: { on: true, rate: 0.8, depth: 0.6, mix: 0.4 }, filter: { on: true, cutoff: 4500, slope: 12 }, human: human(0.3, 0.1) } });
  const rhodes = track('E. Piano', 'rhodes', { volume: -10.5, pan: 0.2, fx: { filter: { on: true, cutoff: 3000 }, human: human(0.35) } });
  const bass = track('Bass', 'fingerBass', { volume: -7, fx: { compressor: { on: true, threshold: -20, ratio: 4 }, human: human(0.35) } });
  const sax = track('Sax', 'saxophone', { volume: -3, reverbSend: 0.3, delaySend: 0.2, fx: { filter: { on: true, cutoff: 3500 }, human: human(0.3, 0.2) } });
  const pad = track('Pad', 'wavetable', { volume: -16, reverbSend: 0.4, fx: { filter: { on: true, cutoff: 1500 } } });
  // A real break, dusted with Lo-fi and played loosely
  const drums = track('Drums', 'breakbeatKit', { volume: -3, fx: { filter: { on: true, cutoff: 7000 }, lofi: { on: true, crush: bits(12), tone: 9000, wow: 0, mix: 0.3 }, human: human(0.5) } });

  // Cmaj7 - Bm7 - Em9 - Am7 / B7b9 in E minor (a minor v where pop would have a major V)
  const verse = [['C3', 'G3', 'B3', 'E4'], ['B2', 'F#3', 'A3', 'D4'], ['E3', 'G3', 'D4', 'F#4'], ['A2', 'E3', 'G3', 'C4']];
  const b7 = ['B2', 'D#3', 'A3', 'C4'];
  // The guitar strums low to high, a few ms apart
  const strum = (chord: string[], step: number, vel: number, len: string): Step[] => chord.map((n, i): Step => [step + i * 0.08, n, vel, len]);
  const comp = everyBar(4, (b): Step[] =>
    [0, 3, 6, 10, 13].flatMap((s, i) => strum(b === 3 && s >= 8 ? b7 : verse[b], s, i === 0 ? 0.7 : 0.55, i === 0 ? '8n.' : '8n'))
  );
  const roots = ['C2', 'B1', 'E2', 'A1'];
  const bassLine = everyBar(4, (b): Step[] => {
    const r = b === 3 ? ['A1', 'A1', 'A2', 'B1', 'B1', 'B2'] : [roots[b], roots[b], nameOf(midiOf(roots[b]) + 12), roots[b], nameOf(midiOf(roots[b]) + 7), roots[b]];
    return [0, 3, 6, 8, 11, 14].map((s, i): Step => [s, r[i], i === 0 ? 0.85 : i % 2 ? 0.58 : 0.66, '8n']);
  });
  const lazy = beat([[D.kick, 'X..o......x.....'], [D.closedHat, 'xoxoxoxoxoxoxoxo'], [D.openHat, '..............o.'], [D.snare, '......g........g']], 0.8);
  const snares: Step[] = [[4.15, D.snare, 0.75], [12.09, D.snare, 0.72]];
  // The sax sits a touch behind the beat
  const sing = later(phrase([[2, 'E4', 4], [6, 'G4', 2], [8, 'B4', 6], [14, 'A4', 2], [18, 'F#4', 4], [22, 'A4', 2], [24, 'D5', 4], [28, 'B4', 4], [34, 'G4', 4], [38, 'F#4', 2], [40, 'E4', 6], [46, 'D4', 2], [48, 'E4', 4], [52, 'C5', 4], [56, 'B4', 8]], 0.72, 0.58), 0.1);
  // Chorus: I - vi - ii - III in G (the III pointing at the relative minor)
  const chorus = [['G3', 'B3', 'D4', 'F#4'], ['E3', 'G3', 'B3', 'D4', 'F#4'], ['A3', 'C4', 'E4', 'G4', 'B4'], ['B3', 'D#4', 'G4', 'A4']];
  return inSpace(
    project(
      'Bedroom Pop starter',
      90,
      0.12,
      [5, 17],
      [gtr, rhodes, bass, sax, pad, drums],
      [
        clip(gtr, 'Verse', 1, 4, comp, 3),
        clip(drums, 'Lazy', 5, 1, [...lazy, ...snares], 8),
        clip(bass, 'Bass', 5, 4, bassLine, 2),
        clip(rhodes, 'Doubles', 5, 4, progression(verse, 16, '1n', 0.45), 2),
        clip(sax, 'Melody', 5, 4, sing, 2),
        clip(gtr, 'Chorus', 13, 4, everyBar(4, (b) => [0, 3, 6, 10, 13].flatMap((s, i) => strum(chorus[b].slice(0, 4), s, i === 0 ? 0.7 : 0.55, '8n')))),
        clip(pad, 'Chorus pad', 13, 4, progression(chorus, 16, '1n', 0.5)),
        clip(rhodes, 'Chorus', 13, 4, progression(chorus, 16, '1n', 0.5)),
        clip(bass, 'Chorus', 13, 4, pulse(['G1', 'E2', 'A1', 'B1'], [0, 6, 10], 3, 0.8)),
      ],
      [[1, 'Intro'], [5, 'Verse'], [13, 'Chorus']],
      master({ on: false }, { on: true, amount: 1.1 })
    ),
    ROOM
  );
}

// ---------- Bossa jazz-pop ----------

function bossa(): ProjectSnapshot {
  // Played, not sequenced: HUMAN on every part, a real kit at brush-soft velocities
  const gtr = track('Nylon guitar', 'nylonGuitar', { volume: -2, eq: { low: 0, mid: 0, high: -5 }, fx: { filter: { on: true, cutoff: 3000, slope: 12 }, human: human(0.35, 0.1) } });
  const piano = track('Piano', 'piano', { volume: -3, pan: 0.25, reverbSend: 0.25, fx: { human: human(0.35) } });
  const bass = track('Upright', 'uprightBass', { volume: -8, fx: { filter: { on: true, cutoff: 700 }, human: human(0.35) } });
  const drums = track('Brushes', 'acousticKit', { volume: -4, fx: { filter: { on: true, cutoff: 3000 }, human: human(0.35) } });
  const flute = track('Flute', 'flute', { volume: -5, reverbSend: 0.25, fx: { human: human(0.35, 0.2) } });
  const strings = track('Strings', 'strings', {
    volume: -14,
    reverbSend: 0.4,
    fx: { human: human(0.35, 0.2) },
    // A swell on every chord of the chorus
    automation: [{ param: 'volume', points: Array.from({ length: 4 }, (_, i) => [{ bar: 13 + i, value: 0.56 }, { bar: 13.5 + i, value: 0.625 }, { bar: 13.95 + i, value: 0.575 }]).flat() }],
  });

  // Db major: Ebm9 - Ab13 - Dbmaj7 - D dim7 (a passing chord back up to ii)
  const verse = [['F#3', 'A#3', 'C#4', 'F4'], ['F#3', 'A#3', 'C4', 'F4'], ['C#3', 'F3', 'G#3', 'C4'], ['F3', 'G#3', 'B3', 'D4']];
  const roots = ['D#2', 'G#1', 'C#2', 'D2'];
  // The bossa comping rhythm over two bars, anticipating the next chord every other cycle
  const comp = (chords: string[][]) => everyBar(4, (b): Step[] => (b % 2 === 0 ? [0, 6, 12] : [4, 10]).map((s, i): Step => [s, chords[b], i === 0 ? 0.58 : 0.5, '8n']));
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.8, '4n.'], [6, nameOf(midiOf(roots[b]) + 7), 0.58, '8n'], [8, nameOf(midiOf(roots[b]) + 7), 0.65, '4n.'], [14, roots[b], 0.58, '8n']]);
  const brushes = everyBar(2, (b): Step[] => [
    ...beat([[D.kick, 'o......oo......o'], [D.closedHat, 'gggggggggggggggg']], 0.5),
    ...(b === 0 ? [0, 6, 12] : [4, 10]).map((s): Step => [s, D.snare, 0.2]),
  ]);
  const tune = phrase([[0, 'F5', 6], [6, 'C#5', 2], [8, 'A#4', 8], [16, 'C5', 4], [20, 'F5', 4], [24, 'D#5', 8], [32, 'C5', 6], [38, 'G#4', 2], [40, 'F4', 8], [48, 'G#4', 4], [52, 'B4', 4], [56, 'D5', 8]], 0.66, 0.55);
  // Chorus: Ebm11 - Ab13 - Dbmaj9 - Gbmaj7
  const chorus = [['C#4', 'F#4', 'G#4', 'A#4'], ['F#3', 'A#3', 'C4', 'F4'], ['C4', 'D#4', 'F4', 'G#4'], ['F3', 'A#3', 'C#4']];
  const counter = everyBar(4, (b) => verse[b].map((n, i): Step => [8 + i * 2, nameOf(midiOf(n) + 12), i === 0 ? 0.5 : 0.42, '8n']));
  return inSpace(
    project(
      'Bossa Jazz-Pop starter',
      82,
      0,
      [5, 17],
      [gtr, piano, bass, drums, flute, strings],
      [
        clip(gtr, 'Verse', 1, 4, comp(verse), 3),
        clip(bass, 'Bass', 5, 4, bassLine, 2),
        clip(drums, 'Brushes', 5, 2, brushes, 6),
        clip(flute, 'Melody', 5, 4, tune, 2),
        clip(piano, 'Counter', 9, 4, counter),
        clip(gtr, 'Chorus', 13, 4, comp(chorus)),
        clip(strings, 'Chorus', 13, 4, progression(chorus, 16, '1n', 0.5)),
        clip(bass, 'Chorus', 13, 4, pulse(['D#2', 'G#1', 'C#2', 'F#1'], [0, 8], 6, 0.75)),
        clip(flute, 'Chorus', 13, 4, phrase([[0, 'A#5', 8], [8, 'G#5', 8], [16, 'F#5', 8], [24, 'F5', 8], [32, 'F5', 6], [38, 'D#5', 2], [40, 'C5', 8], [48, 'C#5', 16]], 0.66, 0.55)),
      ],
      [[1, 'Intro'], [5, 'Verse'], [13, 'Chorus']],
      master({ on: false }, { on: true, amount: 1.05 })
    ),
    ROOM
  );
}

// ---------- City pop / fusion ----------

function cityPop(): ProjectSnapshot {
  // Glossy 80s pop played by a band: a real kit, an electric grand instead of FM keys, a clean cutting guitar
  const drums = track('Drums', 'acousticKit', { volume: -6, fx: { compressor: glue(-20), human: human(0.25) } });
  const slap = track('Slap bass', 'slappedBass', { volume: -2, fx: { human: human(0.2) } });
  const ep = track('Electric grand', 'electricGrand', { volume: -4, reverbSend: 0.2, fx: { human: human(0.25) } });
  const rhodes = track('E. Piano', 'rhodes', { volume: -12, reverbSend: 0.25, fx: { human: human(0.3) } });
  const cut = track('Cutting guitar', 'cleanGuitar', { volume: -10, pan: 0.3, fx: { chorus: { on: true, rate: 0.8, depth: 0.4, mix: 0.25 }, human: human(0.2, 0.1) } });
  const brass = track('Horns', 'brassSection', { volume: -7, reverbSend: 0.2, fx: { peq: peq(lowCut(100), highCut(10000)), human: human(0.25) } });
  const sax = track('Sax', 'saxophone', { volume: -3, reverbSend: 0.25, delaySend: 0.1, fx: { human: human(0.3, 0.2) } });

  // A theme: Amaj9 - B13 - G#m7(11) - C#m9 in E
  const a = [['G#3', 'B3', 'C#4', 'E4'], ['A3', 'D#4', 'G#4'], ['F#3', 'B3', 'C#4', 'D#4'], ['E3', 'G#3', 'B3', 'D#4']];
  const aRoots = ['A2', 'B2', 'G#2', 'C#2'];
  // B theme: Amaj7 - G#7b13 - C#m9 - Bm9 to E9
  const b = [['G#3', 'C#4', 'E4'], ['F#3', 'C4', 'E4'], ['E3', 'G#3', 'B3', 'D#4'], ['D3', 'F#3', 'A3', 'C#4']];
  const bRoots = ['A2', 'G#2', 'C#2', 'B2'];
  // Slap: thumb on the root, pops an octave up, ghosted dead notes in between
  const slapLine = (roots: string[]) =>
    everyBar(4, (bar): Step[] => [
      ...[0, 3, 6, 8, 11, 12, 15].map((s): Step => [s, roots[bar], s === 0 ? 0.85 : s % 4 === 0 ? 0.72 : 0.6, '16n']),
      ...[2, 5, 7, 10, 13, 14].map((s): Step => [s, nameOf(midiOf(roots[bar]) + 12), s % 2 ? 0.5 : 0.62, '16n']),
    ]);
  const chops = (chords: string[][]) => everyBar(4, (bar): Step[] => [2, 6, 10, 14].flatMap((s): Step[] => [[s, chords[bar].slice(-2), 0.55, '32n'], [s + 0.5, chords[bar].slice(-2), 0.4, '32n']]));
  const tight = beat([[D.kick, 'X.....X...X....X'], [D.snare, '..g.X..g.g..X.g.'], [D.closedHat, 'xoxoxoxoxoxoxoxo'], [D.openHat, '..............o.']], 0.8);
  const themeA = phrase([[0, 'C#5', 2], [2, 'E5', 2], [4, 'G#5', 6], [10, 'F#5', 2], [12, 'E5', 4], [16, 'D#5', 2], [18, 'F#5', 2], [20, 'G#5', 6], [26, 'F#5', 2], [28, 'D#5', 4], [32, 'B4', 2], [34, 'D#5', 2], [36, 'F#5', 6], [42, 'E5', 2], [44, 'D#5', 4], [48, 'E5', 8], [56, 'G#4', 4], [60, 'B4', 4]], 0.82, 0.64);
  const themeB = phrase([[0, 'C#5', 4], [4, 'E5', 4], [8, 'G#5', 8], [16, 'G#5', 4], [20, 'E5', 2], [22, 'C5', 2], [24, 'C5', 8], [32, 'B4', 4], [36, 'D#5', 4], [40, 'E5', 8], [48, 'F#5', 4], [52, 'E5', 4], [56, 'D5', 4], [60, 'G#4', 4]], 0.82, 0.64);
  return inSpace(
    project(
      'City Pop starter',
      113,
      0.04,
      [1, 17],
      [drums, slap, ep, rhodes, cut, brass, sax],
      [
        clip(drums, 'Groove', 1, 1, tight, 16),
        clip(slap, 'A', 1, 4, slapLine(aRoots), 2),
        clip(ep, 'A', 1, 4, stabs(a, [0, 7, 10], 3, 0.65), 2),
        clip(rhodes, 'A', 1, 4, progression(a, 16, '1n', 0.45), 2),
        clip(cut, 'Cutting', 1, 4, chops(a), 2),
        clip(sax, 'Theme A', 1, 4, themeA, 2),
        clip(slap, 'B', 9, 4, slapLine(bRoots)),
        clip(ep, 'B', 9, 4, stabs(b, [0, 7, 10], 3, 0.65)),
        clip(cut, 'Cutting', 9, 4, chops(b)),
        clip(sax, 'Theme B', 9, 4, themeB),
        clip(brass, 'Hits', 9, 4, stabs(b.map((c) => c.map((n) => nameOf(midiOf(n) + 12))), [14], 1, 0.7)),
        clip(slap, 'A', 13, 4, slapLine(aRoots)),
        clip(ep, 'A', 13, 4, stabs(a, [0, 7, 10], 3, 0.65)),
        clip(cut, 'Cutting', 13, 4, chops(a)),
        clip(sax, 'Theme A', 13, 4, themeA),
        clip(brass, 'Hits', 13, 4, stabs(a.map((c) => c.map((n) => nameOf(midiOf(n) + 12))), [7, 14], 1, 0.7)),
      ],
      [[1, 'Theme A'], [9, 'Theme B'], [13, 'Theme A']],
      master({ on: false }, { on: true, amount: 1.1 })
    ),
    STUDIO
  );
}

// ---------- Theatrical pop ----------

function theatrical(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: -3, reverbSend: 0.15, fx: { human: human(0.25) } });
  const bass = track('Bass', 'slappedBass', { volume: -3, fx: { human: human(0.25) } });
  const piano = track('Piano', 'piano', { volume: -2, reverbSend: 0.25, fx: { human: human(0.3) } });
  const pizz = track('Pizzicato', 'pizzicato', { volume: -13, reverbSend: 0.3, fx: { human: human(0.35) } });
  const harp = track('Harp', 'harp', { volume: -7, reverbSend: 0.4 });
  // The music box warped a little by tape wow, for one phrase only
  const box = track('Music box', 'musicBox', { volume: -10, reverbSend: 0.5, fx: { lofi: { on: true, crush: 0, tone: 20000, wow: 0.2, mix: 1 } } });
  const lead = track('Voice', 'voiceLead', { volume: -4, reverbSend: 0.3, delaySend: 0.1, fx: { peq: EQ.lead(9000) } });
  const horns = track('Horns', 'brassSection', { volume: -8, reverbSend: 0.25, fx: { peq: EQ.brass(), human: human(0.3) } });
  const french = track('French horn', 'frenchHorn', { volume: -9, reverbSend: 0.3, fx: { human: human(0.3, 0.2) } });
  const pad = track('Pad', 'supersaw', { volume: -14, reverbSend: 0.3, fx: { peq: peq(lowCut(150), highCut(10000)), pump: { on: true, depth: 0.4, release: 220, trigger: 'kick' } } });

  // Verse: the line cliche Dm - Dm(maj7) - Dm7 - Dm6, then Bbmaj7 - Gm7 - Eb/G (Neapolitan) - C7, the
  // new key's dominant, into the chorus in F
  const verse = [['F3', 'A3', 'D4'], ['F3', 'A3', 'C#4'], ['F3', 'A3', 'C4'], ['F3', 'A3', 'B3'], ['D3', 'F3', 'A3'], ['F3', 'A#3', 'D4'], ['D#3', 'G3', 'A#3'], ['E3', 'A#3', 'C4']];
  const vRoots = ['D2', 'D2', 'D2', 'D2', 'A#1', 'G1', 'G1', 'C2'];
  const verseTune = phrase(
    [[0, 'A4', 4], [4, 'D5', 4], [8, 'F5', 6], [14, 'E5', 2], [16, 'E5', 8], [24, 'D5', 4], [28, 'C#5', 4], [32, 'C5', 4], [36, 'D5', 4], [40, 'F5', 6], [46, 'E5', 2], [48, 'D5', 8], [56, 'B4', 8],
      [64, 'A#4', 4], [68, 'D5', 4], [72, 'F5', 6], [78, 'A5', 2], [80, 'G5', 8], [88, 'F5', 4], [92, 'D5', 4], [96, 'D#5', 8], [104, 'D5', 4], [108, 'A#4', 4], [112, 'A#4', 8], [120, 'C5', 8]],
    0.78,
    0.62
  );
  // Chorus in F: F - C - Dm - Bb, ending on a glam turn Db - Eb back to F
  const chorus = [['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['A3', 'D4', 'F4'], ['A#3', 'D4', 'F4']];
  const cRoots = ['F2', 'C2', 'D2', 'A#1'];
  const chorusTune = phrase([[0, 'C5', 4], [4, 'F5', 4], [8, 'A5', 6], [14, 'G5', 2], [16, 'G5', 8], [24, 'E5', 4], [28, 'C5', 4], [32, 'D5', 4], [36, 'F5', 4], [40, 'A5', 4], [44, 'D6', 4], [48, 'C6', 8], [56, 'A#5', 4], [60, 'A5', 4]], 0.86, 0.68);
  const bounce = (roots: string[]) => everyBar(roots.length, (b): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? nameOf(midiOf(roots[b]) + 12) : roots[b], i % 4 === 0 ? 0.8 : 0.58, '8n']));
  const verseBeat = beat([[D.kick, 'X.......X.X.....'], [D.snare, '....X..g....X...'], [D.cowbell, '...o.......o....']], 0.8);
  const disco = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X..g....X...'], [D.openHat, '..x...x...x...x.'], [D.closedHat, 'x...x...x...x...']], 0.8);
  const turn: Step[] = [[0, ['C#3', 'C#4', 'F4', 'G#4'], 0.75, '2n'], [8, ['D#3', 'D#4', 'G4', 'A#4'], 0.8, '2n']];
  return inSpace(
    project(
      'Theatrical Pop starter',
      132,
      0,
      [1, 17],
      [drums, bass, piano, pizz, harp, box, lead, horns, french, pad],
      [
        clip(drums, 'Verse', 1, 1, verseBeat, 8),
        clip(bass, 'Verse', 1, 8, bounce(vRoots)),
        clip(piano, 'Verse', 1, 8, stabs(verse, [0, 4, 8, 12], 3, 0.6)),
        clip(pizz, 'Verse', 1, 8, everyBar(8, (b) => verse[b].map((n, i): Step => [2 + i * 4, n, i === 0 ? 0.6 : 0.5, '8n']))),
        clip(box, 'Leitmotif', 1, 1, melody([[0, 'D6', 4], [4, 'A5', 4], [8, 'F5', 4], [12, 'E5', 4]], 0.5)),
        clip(lead, 'Verse', 1, 8, verseTune),
        clip(harp, 'Gliss', 8, 1, gliss(['A3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'A#4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'C6', 'F6'], 8)),
        clip(drums, 'Disco', 9, 1, [[0, D.crash, 0.6] as Step, ...disco], 8),
        clip(bass, 'Chorus', 9, 4, bounce(cRoots), 2),
        clip(piano, 'Chorus', 9, 4, stabs(chorus, [0, 4, 8, 12], 3, 0.65)),
        clip(piano, 'Chorus', 13, 3, stabs(chorus.slice(0, 3), [0, 4, 8, 12], 3, 0.65)),
        clip(piano, 'Turn', 16, 1, turn),
        clip(pad, 'Chorus', 9, 4, progression(chorus, 16, '1n', 0.5), 2),
        clip(lead, 'Chorus', 9, 4, chorusTune),
        clip(lead, 'Chorus', 13, 3, chorusTune.filter(([s]) => s < 48)),
        clip(lead, 'Turn', 16, 1, phrase([[0, 'G#5', 8], [8, 'A#5', 8]], 0.86)),
        // Fanfares in the middle octaves, horns and French horn together
        clip(horns, 'Fanfare', 9, 4, stabs(chorus, [0, 6, 12], 2, 0.62), 2),
        clip(french, 'Fanfare', 9, 4, stabs(chorus, [0, 6, 12], 2, 0.6), 2),
      ],
      [[1, 'Verse'], [9, 'Chorus']],
      master({ on: true, depth: 0.15 }, { on: true, amount: 1.15 })
    ),
    STUDIO
  );
}

// ---------- Rap-rock ----------

function rapRock(): ProjectSnapshot {
  const kit = drumBus(-16);
  const gtrL = track('Guitar L', 'distortionGuitar', { volume: -7, pan: -0.65, fx: { peq: EQ.guitar(), compressor: glue(-20), human: human(0.25, 0.1) } });
  const gtrR = track('Guitar R', 'distortionGuitar', { volume: -7, pan: 0.65, fx: { peq: EQ.guitar(), compressor: glue(-20), human: human(0.35, 0.15) } });
  const bass = track('Bass', 'pickBass', { volume: -5, fx: { peq: peq(lowCut(40)), distortion: { on: true, amount: 0.2 }, human: human(0.25) } });
  const eight = track('808', 'bass808', { volume: -10, fx: { peq: EQ.eight() } });
  const organ = track('Organ', 'rockOrgan', { volume: -16, fx: { peq: peq(lowCut(150)), distortion: { on: true, amount: 0.2 } } });
  // The chant low and punchy: a voice doubled by the brass section in octave 3, a trombone under them
  const chant = track('Chant', 'voiceLead', { volume: -10, reverbSend: 0.2, fx: { peq: peq(lowCut(150), highCut(8000)) } });
  const brass = track('Brass', 'brassSection', { volume: -10, reverbSend: 0.2, fx: { peq: EQ.brass(), human: human(0.25) } });
  const bone = track('Trombone', 'trombone', { volume: -12, reverbSend: 0.2, fx: { peq: EQ.brass(), human: human(0.25) } });
  const drums = track('Drums', 'acousticKit', { volume: -3, output: kit.id, fx: { human: human(0.2) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, output: kit.id });

  // The verse riff, G Phrygian power chords in 8th chugs: G - Ab (the flat second) - F - D
  const riff = everyBar(1, (): Step[] => ['G2', 'G2', 'G#2', 'G2', 'F2', 'F2', 'D3', 'D3'].map((r, i): Step => [i * 2, power(r), i % 4 === 0 ? 0.88 : i % 2 ? 0.6 : 0.72, '8n']));
  // Bar 8 stops dead for its last beat: a beat of silence before the chorus
  const riffStop = riff.filter(([s]) => s < 12);
  const bassRiff = (steps: Step[]) => steps.map(([s, n, v, d]): Step => [s, nameOf(midiOf((n as string[])[0]) - 12), v, d]);
  const halfTime = beat([[D.kick, 'X.........X.....'], [D.snare, '........X....g..'], [D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.8);
  const stop = beat([[D.kick, 'X.........X.....'], [D.snare, '........X.XX....'], [D.closedHat, 'x.o.x.o.x.o.....']], 0.8);
  // Chorus: Gm - Eb - Bb - F as power chords (no bright thirds), double time, the chant in unison
  const chords = ['G2', 'D#3', 'A#2', 'F2'];
  const chorusGtr = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, power(chords[b]), i % 4 === 0 ? 0.88 : i % 2 ? 0.62 : 0.72, '8n']));
  const chantLine = everyBar(4, (b): Step[] => (b === 3 ? [[0, 'D4', 0.88, '8n'], [2, 'C4', 0.72, '8n'], [4, 'A#3', 0.8, '8n'], [6, 'G3', 0.88, '4n']] : [[0, 'G3', 0.88, '8n'], [2, 'A#3', 0.68, '16n'], [3, 'C4', 0.72, '8n'], [6, 'D4', 0.85, '4n']]));
  // Double time: snare on 2 and 4, the ride on every beat, a crash at the top of the phrase
  const double = everyBar(4, (b): Step[] => [
    ...beat([[D.kick, 'X.X....XX.X.....'], [D.snare, '....X..g....X...'], [D.ride, 'x...x...x...x...']], 0.8),
    ...(b === 0 ? [[0, D.crash, 0.6] as Step] : []),
  ]);
  return inSpace(
    project(
      'Rap-Rock starter',
      154,
      0,
      [9, 17],
      [gtrL, gtrR, bass, eight, organ, chant, brass, bone, drums, taiko, kit],
      [
        clip(gtrL, 'Riff', 1, 1, riff, 7),
        clip(gtrR, 'Riff', 1, 1, later(riff, 0.064), 7),
        clip(gtrL, 'Stop', 8, 1, riffStop),
        clip(gtrR, 'Stop', 8, 1, later(riffStop, 0.064)),
        clip(drums, 'Verse', 1, 1, halfTime, 7),
        clip(drums, 'Stop', 8, 1, stop),
        clip(bass, 'Riff', 1, 1, bassRiff(riff), 7),
        clip(bass, 'Stop', 8, 1, bassRiff(riffStop)),
        clip(eight, '808', 1, 1, [[0, 'G1', 0.78, '4n'], [10, 'G1', 0.66, '8n']], 8),
        clip(organ, 'Drone', 5, 4, [[0, ['G3', 'D4'], 0.55, '1m'], [16, ['G#3', 'D#4'], 0.5, '1m'], [32, ['G3', 'D4'], 0.55, '1m'], [48, ['G3', 'D4'], 0.55, '2n.']]),
        clip(gtrL, 'Chorus', 9, 4, chorusGtr, 2),
        clip(gtrR, 'Chorus', 9, 4, later(chorusGtr, 0.064), 2),
        clip(bass, 'Chorus', 9, 4, everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, ['G1', 'D#2', 'A#1', 'F1'][b], i % 4 === 0 ? 0.82 : 0.66, '8n'])), 2),
        clip(drums, 'Chorus', 9, 4, double, 2),
        clip(chant, 'Chant', 9, 4, chantLine, 2),
        clip(brass, 'Chant', 9, 4, chantLine, 2),
        clip(bone, 'Chant', 9, 4, up(chantLine, -12), 2),
        clip(taiko, 'Hits', 9, 4, [[0, 'G2', 0.75], [16, 'G2', 0.62], [32, 'G2', 0.75], [48, 'G2', 0.62], [62, 'D2', 0.66], [63, 'A2', 0.72]], 2),
      ],
      [[1, 'Verse'], [9, 'Chorus']],
      master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
    ),
    ROOM
  );
}

// ---------- Math rock ----------

function mathRock(): ProjectSnapshot {
  // Twinkly clean guitars with chorus and a dotted-8th echo, played loosely; a real kit with ghost notes
  const echo = { on: true, time: '1/8d', feedback: 0.3, tone: 5000, pingPong: true, mix: 0.2 } as const;
  const twinkle = track('Twinkle guitar', 'cleanGuitar', { volume: -2, pan: -0.3, reverbSend: 0.2, fx: { chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 }, echo, human: human(0.2, 0.1) } });
  const tap = track('Tapping guitar', 'cleanGuitar', { volume: -2, pan: 0.4, reverbSend: 0.2, fx: { chorus: { on: true, rate: 0.9, depth: 0.5, mix: 0.3 }, echo, human: human(0.25, 0.1) } });
  const marimba = track('Marimba', 'marimba', { volume: -14, reverbSend: 0.2, fx: { human: human(0.15) } });
  const bass = track('Bass', 'fingerBass', { volume: -3, fx: { compressor: glue(-20), human: human(0.3) } });
  const tpt = track('Trumpet', 'trumpet', { volume: -6, reverbSend: 0.3, fx: { peq: peq(lowCut(100), highCut(9000)), human: human(0.3, 0.2) } });
  const drums = track('Drums', 'acousticKit', { volume: -3, fx: { compressor: glue(), human: human(0.3) } });

  // Amaj9 - E/G# - F#m11 - Cmaj7#11 (a borrowed bVI), B and E ringing on top
  const twinkles = broken(
    [['A2', 'E3', 'G#3', 'B3', 'E4', 'B4', 'E5', 'B4'], ['G#2', 'E3', 'B3', 'E4', 'G#4', 'B4', 'E5', 'B4'], ['F#2', 'E3', 'A3', 'B3', 'E4', 'B4', 'E5', 'B4'], ['C3', 'E3', 'G3', 'B3', 'F#4', 'B4', 'E5', 'B4']],
    2,
    6,
    0.58
  );
  // Tapping: six notes a beat (16th-note triplets) for two beats a bar; the marimba doubles it quietly in unison
  const cell = ['E4', 'A4', 'B4', 'E5', 'B4', 'A4'];
  const tapping = everyBar(4, (): Step[] => Array.from({ length: 12 }, (_, i): Step => [(i * 2) / 3, cell[i % 6], i % 6 === 0 ? 0.72 : i % 2 ? 0.48 : 0.56, '16n']));
  const roots = ['A1', 'G#1', 'F#1', 'C2'];
  const verseBeat = beat([[D.kick, 'X.......X.......'], [D.snare, '....X..g....X.g.'], [D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.8);
  // Chorus: accents grouped 3+3+3+3+2+2 across the bar, guitar and bass stabbing with them
  const accents = [0, 3, 6, 9, 12, 14];
  const chorusBeat = beat([[D.kick, 'X.....X.....X...'], [D.snare, '...X.....X....X.'], [D.ride, 'x.o.x.o.x.o.x.o.']], 0.8);
  const chorusChords = [['A2', 'E3', 'G#3', 'B3'], ['G#2', 'E3', 'B3'], ['F#2', 'E3', 'A3', 'B3'], ['C3', 'E3', 'G3', 'B3']];
  // Breakdown: E chugs with the kick on every one
  const chugSteps = [0, 1, 2, 4, 5, 6, 8, 9, 12];
  const tune = phrase([[0, 'G#4', 4], [4, 'B4', 4], [8, 'E5', 6], [14, 'D#5', 2], [16, 'E5', 4], [20, 'B4', 4], [24, 'G#4', 8], [32, 'A4', 4], [36, 'C#5', 4], [40, 'E5', 4], [44, 'F#5', 4], [48, 'G5', 8], [56, 'F#5', 8]], 0.74, 0.6);
  return inSpace(
    project(
      'Math Rock starter',
      150,
      0,
      [5, 17],
      [twinkle, tap, marimba, bass, tpt, drums],
      [
        clip(twinkle, 'Twinkle', 1, 4, twinkles, 2),
        clip(tap, 'Tapping', 5, 4, tapping),
        clip(marimba, 'Tapping', 5, 4, tapping.map(([s, n, v, d]): Step => [s, n, v * 0.8, d])),
        clip(bass, 'Verse', 5, 4, pulse(roots, [0, 6, 10], 4, 0.8)),
        clip(drums, 'Verse', 5, 1, verseBeat, 4),
        clip(tpt, 'Melody', 5, 4, tune),
        clip(twinkle, 'Chorus', 9, 4, everyBar(4, (b) => accents.map((s, i): Step => [s, chorusChords[b], i === 0 ? 0.8 : i % 2 ? 0.62 : 0.7, dur(2)]))),
        clip(bass, 'Chorus', 9, 4, pulse(roots, accents, 2, 0.8)),
        clip(drums, 'Chorus', 9, 1, chorusBeat, 4),
        clip(tpt, 'Chorus', 9, 4, up(tune, 12).map(([s, n, v, d]): Step => [s, midiOf(n as string) > 84 ? nameOf(midiOf(n as string) - 12) : n, v, d])),
        clip(tap, 'Chugs', 13, 1, chugSteps.map((s, i): Step => [s, 'E2', i % 3 === 0 ? 0.82 : 0.66, '16n']), 4),
        clip(bass, 'Chugs', 13, 1, chugSteps.map((s, i): Step => [s, 'E1', i % 3 === 0 ? 0.82 : 0.66, '16n']), 4),
        clip(drums, 'Breakdown', 13, 1, [...chugSteps.map((s): Step => [s, D.kick, 0.72]), [4, D.snare, 0.9], [12, D.snare, 0.9], [0, D.crash, 0.5]], 4),
      ],
      [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus'], [13, 'Breakdown']],
      master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
    ),
    ROOM
  );
}

export const PLAYLIST_BUILDERS = {
  artcore,
  hardcore,
  breakcore,
  rpg,
  metaldub: metalDubstep,
  melodicdub: melodicDubstep,
  riddim,
  futurebass: futureBass,
  phonk,
  drill,
  rage,
  neosoul: neoSoul,
  bedroom: bedroomPop,
  bossa,
  citypop: cityPop,
  theatrical,
  raprock: rapRock,
  mathrock: mathRock,
};

/** The pieces above, for the game starters (startersGame.ts). */
export const KIT = { dur, VEL, beat, up, later, melody, phrase, octaves, roll32, stabs, pulse, broken, softBuild, softHit, gliss, power, lowCut, highCut, bell, peq, EQ, human, bits, glue, PATCH, darkRoom, send, drumBus, inSpace, ROOM, STUDIO, HALL };
