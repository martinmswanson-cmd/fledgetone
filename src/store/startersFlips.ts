import type { ProjectSnapshot } from './project';
import { D, master, project, track } from './starterKit';
import { canonLine, scorePart } from './classicsScores';
import { notesBetween, pitchOf } from './scoreNotes';
import type { ScoreNote } from './scoreNotes';
import { KIT } from './startersPlaylist';
import { bass808Preset } from './bass808';
import { presetSound } from './drumDesign';
import type { DesignRow, DrumDesign } from './drumDesign';
import { bassOnKicks, cutGap, kicksOf, stopSpan, switchedNotes } from './beatSwitch';
import { presetPatch } from './synthPatch';
import { nameOf } from './noteTools';
import { barsToDuration, uid } from './timelineTypes';
import type { Clip, ClipGroove, MasterSettings, NoteEvent, PeqBand, Track } from './timelineTypes';
import type { TempoPoint } from '../audio/tempoMap';

/**
 * The Classical Flips: each Classics piece sample-flipped into a hard modern beat, as a producer
 * would: its melody or harmony chopped, re-timed and looped over drums and bass. The Canon over
 * trap drums and a gliding 808, the "Moonlight" triplets as sparse dark drill piano over sliding
 * 808s, the cello Prelude chopped on a swung, dusty boom bap, the Mountain King's theme on a phonk
 * cowbell that speeds up like the original, and Clair de lune's thirds as melodic trap with a slow,
 * heavy switch. Each is a whole song (intro, drops, a beat switch, a stop, an outro) built with the
 * producer tools: the 808 designer and the held basses, the Drum Designer's kit, hat rolls, swing
 * per drum, drop-outs and stops (beatSwitch.ts), sidechain pump and the master clipper.
 */

const { PATCH, bits } = KIT;
const lowCut = (freq: number): PeqBand => ({ on: true, type: 'lowcut', freq, gain: 0, q: Math.SQRT1_2 });
const highCut = (freq: number): PeqBand => ({ on: true, type: 'highcut', freq, gain: 0, q: Math.SQRT1_2 });
const bell = (freq: number, gain: number, q = 1): PeqBand => ({ on: true, type: 'bell', freq, gain, q });
const peq = (...bands: PeqBand[]) => ({ on: true, bands });
const newId = () => uid('note');

/** A note: `at` and `len` in bars from the clip's start. */
const n = (note: string, at: number, len: number, velocity: number): NoteEvent => ({ id: newId(), note, startOffset: Math.round(at * 1e6) / 1e6, duration: barsToDuration(len), velocity: Math.round(Math.min(1, velocity) * 1000) / 1000 });
/** The same notes `times` over, a loop `bars` long. */
const loop = (notes: readonly NoteEvent[], bars: number, times: number): NoteEvent[] => Array.from({ length: times }, (_, i) => notes.map((x) => ({ ...x, id: newId(), startOffset: Math.round((x.startOffset + i * bars) * 1e6) / 1e6 }))).flat();
/** Notes moved `bars` later. */
const later = (notes: readonly NoteEvent[], bars: number): NoteEvent[] => notes.map((x) => ({ ...x, id: newId(), startOffset: x.startOffset + bars }));
/** Notes moved by `semitones`. */
const up = (notes: readonly NoteEvent[], semitones: number): NoteEvent[] => notes.map((x) => ({ ...x, id: newId(), note: nameOf(pitchOf(x.note) + semitones) }));
const VEL: Record<string, number> = { X: 1, x: 0.82, o: 0.62, g: 0.34 };
/**
 * Drum rows as 16th-note patterns (any number of bars): X accent, x hit, o softer, g ghost, `.` rest.
 */
const drums = (rows: Array<[string, string]>, scale = 1): NoteEvent[] =>
  rows.flatMap(([note, pattern]) => [...pattern.replace(/\s/g, '')].flatMap((c, i) => (VEL[c] ? [n(note, i / 16, 1 / 16, VEL[c] * scale * (HATS.has(note) ? 0.8 : 1))] : [])));
/** The hats sit under the kick and snare. */
const HATS = new Set<string>([D.closedHat, D.openHat]);
/** A hat roll from `from` to `to` (bars), a hit every `step` bars, getting louder. */
const roll = (from: number, to: number, step: number, v0 = 0.3, v1 = 0.7, note: string = D.closedHat): NoteEvent[] => {
  const count = Math.round((to - from) / step);
  return Array.from({ length: count }, (_, i) => n(note, from + i * step, step * 0.9, v0 + ((v1 - v0) * i) / Math.max(1, count - 1)));
};
/**
 * A clip of `notes` from `startBar`, `bars` long; `dropOut` bars at its end left silent (a stop:
 * the gap before a drop), as Arrange a beat's drop-out cuts it.
 */
function place(t: Track, name: string, startBar: number, bars: number, notes: readonly NoteEvent[], opts: { dropOut?: number; groove?: ClipGroove } = {}): Clip {
  const kept = notes.filter((x) => x.startOffset < bars - 1e-6);
  const cut = opts.dropOut ? cutGap(kept, ...stopSpan(bars - 1, opts.dropOut * 4)) : kept;
  return { id: uid('clip'), trackId: t.id, name, startBar, lengthBars: bars, notes: cut, isSelected: false, ...(opts.groove ? { groove: opts.groove } : {}) };
}
/** Score notes (quarters) as notes from quarter `from`, every time stretched by `stretch`. */
const fromScore = (notes: readonly ScoreNote[], from: number, stretch: number, velocity: number, shorten = 1): NoteEvent[] =>
  notes.map((s) => n(nameOf(s.pitch), ((s.start - from) * stretch) / 4, (s.dur * stretch * shorten) / 4, velocity));

/** A Designed Kit with these presets on its rows (the Drum Designer's sounds). */
function kit(name: string, rows: Partial<Record<DesignRow, string>>, opts: Parameters<typeof track>[2] = {}): Track {
  const drumDesign: DrumDesign = {};
  for (const [row, id] of Object.entries(rows) as Array<[DesignRow, string]>) {
    const sound = presetSound(id);
    if (sound) drumDesign[row] = sound;
  }
  return track(name, 'designedKit', { drumDesign, ...opts });
}

/** Hats that swing a little while the kick and snare stay on the grid (swing per drum). */
const hatSwing = (swing: number, snareLate = 0): ClipGroove => ({
  swing: 0,
  grid: 16,
  rows: { [D.closedHat]: { swing, offbeat: 0.85 }, [D.openHat]: { swing }, ...(snareLate ? { [D.snare]: { shift: snareLate }, [D.clap]: { shift: snareLate } } : {}) },
});

/** The beat master: punchy glue, OTT and width a touch, and the clipper shaving the drums' peaks. */
const beatMaster = (drive: number, ott = 0.18): MasterSettings => ({
  ...master({ on: true, depth: ott, time: 0.2 }, { on: true, amount: 1.15 }),
  glue: 'punchy',
  clipper: { on: true, drive, softness: 0.35, ceiling: -1 },
});
const STUDIO = { reverbDecay: 1.6, delayTime: '8n.', delayFeedback: 0.3, roomStyle: 'studio' as const };
const tempoMap = (points: ReadonlyArray<readonly [number, number, boolean?]>): TempoPoint[] => points.map(([bar, bpm, ramp]) => ({ id: uid('tempo'), bar, bpm, ramp: !!ramp }));
/** A filter opening over `bars` (a cutoff automation lane from closed to open). */
const opening = (from: number, to: number, start = 0.25): { param: 'filterCutoff'; points: Array<{ bar: number; value: number }> }[] => [{ param: 'filterCutoff', points: [{ bar: from, value: start }, { bar: to, value: 1 }] }];

/**
 * An 808 line from [bar offset, note, length in bars] hits; a hit that runs into the next one
 * glides to it (the 808 designer's slide).
 */
const eight = (hits: Array<[number, string, number]>, velocity = 0.85): NoteEvent[] => hits.map(([at, note, len]) => n(note, at, len, velocity));

// ---------- Canon in D: Trap Flip ----------

function canonTrap(): ProjectSnapshot {
  // The Canon's eight chords, two to a bar: D A | Bm F#m | G D | G A
  const voicings = [['A3', 'D4', 'F#4'], ['A3', 'C#4', 'E4'], ['B3', 'D4', 'F#4'], ['A3', 'C#4', 'F#4'], ['B3', 'D4', 'G4'], ['A3', 'D4', 'F#4'], ['B3', 'D4', 'G4'], ['A3', 'C#4', 'E4']];
  const roots = ['D1', 'A1', 'B1', 'F#1', 'G1', 'D1', 'G1', 'A1'];
  const chords = voicings.flatMap((v, i) => v.map((p) => n(p, i / 2, 0.5, 0.62)));
  // The sample: the first violin's sixteenths (Canon bars 11-12) chopped to eighths, one chord per four
  const line = canonLine(0);
  const chop = fromScore(notesBetween(line, 32, 40), 32, 2, 0.72, 0.8).map((x, i) => ({ ...x, velocity: i % 4 === 0 ? 0.82 : 0.66 }));
  // The opening's slow line (Canon bars 3-4) for the switch, a chord each
  const slow = fromScore(notesBetween(line, 0, 8), 0, 2, 0.62);
  const strings = track('Canon strings', 'realStrings', { volume: -10, reverbSend: 0.3, fx: { peq: peq(lowCut(180), highCut(9000)), filter: { on: true, cutoff: 9000 }, pump: { on: true, depth: 0.55, release: 220, trigger: 'kick' } }, automation: opening(1, 9) });
  const violin = track('Violin chop', 'realViolin', { volume: -7, pan: 0.15, reverbSend: 0.22, delaySend: 0.12, fx: { peq: peq(lowCut(250), bell(3000, -2)) } });
  const section = track('Violins', 'realViolins', { volume: -12, pan: -0.25, reverbSend: 0.35, fx: { peq: peq(lowCut(250)) } });
  const bass = track('808', 'bass808', { volume: -1, bass808: bass808Preset('Punchy'), fx: { peq: peq(lowCut(28)) } });
  const riser = track('Riser', 'synthDesigner', { volume: -20, synth: presetPatch('Riser noise'), fx: { peq: peq(lowCut(400)) } });
  const kitT = kit('Drums', { kick: 'hardTrapKick', snare: 'trapSnare', clap: 'crispClap', closedHat: 'trapHat', openHat: 'openHat', crash: 'crash' }, { volume: -10, fx: { peq: peq(lowCut(30), highCut(11000)) } });

  // The beat over four bars: half-time snare and clap on 3, kicks that bounce, 8th hats with 16th
  // and 32nd fills, a triplet roll into the fourth bar
  const beat = [
    ...drums([
      [D.kick, 'X.....x...X..... X......x..x...x. X.....x...X..... X......x..X.x...'],
      [D.snare, '........X....... ........X....... ........X....... ........X.....g.'],
      [D.clap, '........x....... ........x....... ........x....... ........x.......'],
      [D.closedHat, 'x.x.x.x.x.x.xxx. x.x.x.x.x.x.x.x. x.x.x.x.x.x.xxx. x.x.x.x.........'],
      [D.openHat, '..............o. ................ ..............o. ................'],
    ]),
    ...roll(3 + 8 / 16, 3 + 12 / 16, 1 / 32, 0.35, 0.75),
    ...roll(3 + 12 / 16, 4, 1 / 24, 0.4, 0.9),
  ];
  const crash = (at: number) => n(D.crash, at, 1, 0.7);
  // The 808 under the kicks, a glide into the second chord of bars 2 and 4
  const bassLine = eight([
    [0, roots[0], 0.36], [0.375, roots[0], 0.12], [0.5, roots[1], 0.5],
    [1, roots[2], 0.45], [1.4375, roots[3], 0.5],
    [2, roots[4], 0.36], [2.375, roots[4], 0.12], [2.5, roots[5], 0.5],
    [3, roots[6], 0.45], [3.4375, roots[7], 0.55],
  ]);
  // The beat switch: Arrange a beat's half time on the drums (the first half at half speed)
  const halfBeat = switchedNotes('drums', loop(beat, 4, 2), 8, 'half', newId);
  const slowBass = eight(roots.map((r, i): [number, string, number] => [i / 2, r, 0.52]), 0.8);
  const hats = hatSwing(0.12);
  const clips: Clip[] = [
    // Intro (1-8): the strings open up, the chop comes in, a riser and a roll into the drop
    place(strings, 'Chords', 1, 8, loop(chords, 4, 2)),
    place(violin, 'Chop', 5, 4, chop, { dropOut: 0.5 }),
    place(riser, 'Riser', 5, 4, [n('C4', 0, 4, 0.8)]),
    place(kitT, 'Roll in', 8, 1, [...roll(0.5, 1, 1 / 32, 0.3, 0.9)]),
    // Drop (9-24)
    place(kitT, 'Beat', 9, 16, [crash(0), ...loop(beat, 4, 4)], { dropOut: 0.5, groove: hats }),
    place(bass, '808', 9, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(strings, 'Chords', 9, 16, loop(chords, 4, 4)),
    place(violin, 'Chop', 9, 16, loop(chop, 4, 4), { dropOut: 0.5 }),
    // Beat switch (25-32): half time, the 808 holding each chord, the violins on the slow line; a stop at the end
    place(kitT, 'Switch', 25, 8, [crash(0), ...halfBeat], { dropOut: 0.5 }),
    place(bass, '808 held', 25, 8, loop(slowBass, 4, 2), { dropOut: 0.5 }),
    place(section, 'Slow line', 25, 8, loop(slow, 4, 2), { dropOut: 0.5 }),
    place(strings, 'Chords', 25, 8, loop(chords, 4, 2), { dropOut: 0.5 }),
    // Drop 2 (33-48): the beat back, the violins answering the chop, the chop an octave up from 41
    place(kitT, 'Beat', 33, 16, [crash(0), ...loop(beat, 4, 4), crash(8)], { dropOut: 0.5, groove: hats }),
    place(bass, '808', 33, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(strings, 'Chords', 33, 16, loop(chords, 4, 4)),
    place(violin, 'Chop', 33, 8, loop(chop, 4, 2)),
    place(violin, 'Chop up', 41, 8, up(loop(chop, 4, 2), 12), { dropOut: 0.5 }),
    place(section, 'Slow line', 33, 16, loop(slow, 4, 4)),
    // Break (49-52): strings and chop alone, the riser
    place(strings, 'Chords', 49, 4, chords),
    place(violin, 'Chop', 49, 4, chop, { dropOut: 0.5 }),
    place(riser, 'Riser', 49, 4, [n('C4', 0, 4, 0.8)]),
    place(kitT, 'Roll in', 52, 1, [...roll(0, 0.5, 1 / 24, 0.3, 0.9)], { dropOut: 0.5 }),
    // Final drop (53-60), outro (61-64)
    place(kitT, 'Beat', 53, 8, [crash(0), ...loop(beat, 4, 2)], { groove: hats }),
    place(bass, '808', 53, 8, loop(bassLine, 4, 2)),
    place(strings, 'Chords', 53, 12, loop(chords, 4, 3)),
    place(violin, 'Chop up', 53, 8, up(loop(chop, 4, 2), 12)),
    place(section, 'Slow line', 53, 8, loop(slow, 4, 2)),
    place(violin, 'Chop', 61, 4, chop),
    place(kitT, 'Last hit', 61, 1, [n(D.kick, 0, 1 / 8, 1), crash(0)]),
    place(bass, 'Last 808', 61, 2, [n('D1', 0, 2, 0.85)]),
  ];
  const p = project(
    'Canon in D: Trap Flip',
    140,
    0,
    [1, 65],
    [strings, violin, section, bass, riser, kitT],
    clips,
    [[1, 'Intro'], [9, 'Drop'], [25, 'Beat switch'], [33, 'Drop 2'], [49, 'Break'], [53, 'Final drop'], [61, 'Outro']],
    beatMaster(5)
  );
  return { ...p, masterFx: STUDIO };
}

// ---------- Moonlight: Drill Flip ----------

function moonlightDrill(): ProjectSnapshot {
  const triplets = scorePart('moonTriplets');
  const tune = scorePart('moonMelody');
  // Sparse, dark: of each bar's triplets only the first and third beats (Moonlight bars 1-4 and 5-8)
  const sparse = (from: number) => fromScore(triplets.filter((x) => x.start >= from && x.start < from + 16 && [0, 2].includes(Math.floor(x.start - from) % 4)), from, 1, 0.5).map((x, i) => ({ ...x, velocity: i % 3 === 0 ? 0.64 : 0.54 }));
  const introPiano = sparse(0);
  const verse = sparse(16);
  // The tune of bars 5-8 an octave up, the G sharp's dotted call
  const call = fromScore(notesBetween(tune, 16, 32), 16, 1, 0.7).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 12) }));
  const piano = track('Piano', 'realGrandPiano', { volume: 6, reverbSend: 0.35, delaySend: 0.1, fx: { peq: peq(lowCut(140), { on: true, type: 'highshelf', freq: 4000, gain: -4, q: 0.7 }), filter: { on: true, cutoff: 9000 } }, automation: opening(1, 9, 0.3) });
  const strings = track('Strings', 'realStrings', { volume: -14, reverbSend: 0.4, fx: { peq: peq(lowCut(150), highCut(6000)) } });
  const bass = track('808', 'bass808', { volume: 0, bass808: bass808Preset('Drill slide'), fx: { peq: peq(lowCut(28)) } });
  const kitT = kit('Drums', { kick: 'drillKick', snare: 'drillSnare', clap: 'snappyClap', closedHat: 'tightHat', openHat: 'openHat', cowbell: 'sharpRim', crash: 'crash' }, { volume: -6, fx: { peq: peq(lowCut(30), highCut(10000)) } });
  // The harmony under the verse (Moonlight bars 5-8): C#m, G#7/B#, C#m - F#m, E/B - B7
  const pads = [['C#3', 'G#3', 'E4'], ['B#2', 'G#3', 'F#4'], ['C#3', 'G#3', 'E4'], ['B2', 'G#3', 'E4']].flatMap((v, i) => v.map((p) => n(p, i, 1, 0.5)));
  // The drill bounce over two bars: snares on 3 and late in the next bar, triplet hat bursts, a rim
  const tri = 1 / 24;
  const bounce = [
    ...drums([
      [D.kick, 'X..........x.... ..x.......x.....'],
      [D.snare, '........X.....g. ......g.....X...'],
      [D.clap, '........x....... ............x...'],
      [D.closedHat, 'x.x.....x.x.x... x.x.....x.....x.'],
      [D.cowbell, '...x.......x.... ...x............'],
    ]),
    ...[5 / 16, 5 / 16 + tri, 5 / 16 + 2 * tri, 1 + 13 / 16, 1 + 13 / 16 + tri, 1 + 13 / 16 + 2 * tri].map((at, i) => n(D.closedHat, at, tri, 0.42 + (i % 3) * 0.12)),
  ];
  const bounce4 = [...bounce, ...later(bounce, 2).filter((x) => x.startOffset < 3.5), ...roll(3.5, 4, 1 / 24, 0.35, 0.85)];
  // The 808 slides: C#, down to B#, back to C#, down to F#, up through G# to B, gliding where notes touch
  const bassLine = eight([
    [0, 'C#2', 0.72], [0.6875, 'C#2', 0.3125], [1, 'B#1', 0.69], [1.6875, 'C#2', 0.32], [2, 'C#2', 0.5], [2.5, 'F#1', 0.5], [3, 'E1', 0.45], [3.4375, 'B1', 0.56],
  ]);
  const halfBounce = drums([
    [D.kick, 'X............... ........x....... X............... ...........x....'],
    [D.snare, '................ X............... ................ X...........g...'],
    [D.closedHat, 'x.....x.....x... x.....x.....x... x.....x.....x... x.....x...x.x.x.'],
  ]);
  // The switch's 808: long slides down the bass, re-cut to the new pattern's kicks (Arrange a beat's new drum pattern)
  const slides = eight([[0, 'C#2', 1.05], [1, 'B#1', 1.05], [2, 'A1', 1.05], [3, 'G#1', 1]], 0.8);
  const switchBass = bassOnKicks(slides, kicksOf(halfBounce), 4, newId);
  const crash = (at: number) => n(D.crash, at, 1, 0.65);
  const groove = hatSwing(0.08, 0.04);
  const clips: Clip[] = [
    // Intro (1-8): the opening's harmony on the dark piano, strings under it
    place(piano, 'Intro', 1, 8, loop(introPiano, 4, 2), { dropOut: 0.5 }),
    place(strings, 'Pads', 1, 8, loop(pads, 4, 2)),
    place(kitT, 'Roll in', 8, 1, roll(0.5, 1, 1 / 24, 0.3, 0.85)),
    // Drop (9-24)
    place(kitT, 'Bounce', 9, 16, [crash(0), ...loop(bounce4, 4, 4)], { dropOut: 0.5, groove }),
    place(bass, '808', 9, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(piano, 'Verse', 9, 16, loop(verse, 4, 4)),
    place(piano, 'Call', 17, 8, loop(call, 4, 2), { dropOut: 0.5 }),
    // Switch (25-32): half time, long slides down the bass, the call alone over strings
    place(kitT, 'Switch', 25, 8, [crash(0), ...loop(halfBounce, 4, 2)], { dropOut: 0.5 }),
    place(bass, '808 slides', 25, 8, loop(switchBass, 4, 2), { dropOut: 0.5 }),
    place(strings, 'Pads', 25, 8, loop(pads, 4, 2), { dropOut: 0.5 }),
    place(piano, 'Call', 25, 8, loop(call, 4, 2), { dropOut: 0.5 }),
    // Drop 2 (33-48)
    place(kitT, 'Bounce', 33, 16, [crash(0), ...loop(bounce4, 4, 4)], { dropOut: 0.5, groove }),
    place(bass, '808', 33, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(piano, 'Verse', 33, 16, loop(verse, 4, 4)),
    place(piano, 'Call', 41, 8, loop(call, 4, 2), { dropOut: 0.5 }),
    place(strings, 'Pads', 41, 8, loop(pads, 4, 2)),
    // Break (49-52), final drop (53-60), outro (61-64)
    place(piano, 'Break', 49, 4, introPiano, { dropOut: 0.5 }),
    place(strings, 'Pads', 49, 4, pads),
    place(kitT, 'Roll in', 52, 1, roll(0.5, 1, 1 / 32, 0.3, 0.9)),
    place(kitT, 'Bounce', 53, 8, [crash(0), ...loop(bounce4, 4, 2)], { groove }),
    place(bass, '808', 53, 8, loop(bassLine, 4, 2)),
    place(piano, 'Verse', 53, 8, loop(verse, 4, 2)),
    place(piano, 'Call', 53, 8, loop(call, 4, 2)),
    place(piano, 'Outro', 61, 4, introPiano),
    place(strings, 'Pads', 61, 4, pads),
    place(bass, 'Last 808', 61, 2, [n('C#2', 0, 2, 0.8)]),
    place(kitT, 'Last hit', 61, 1, [n(D.kick, 0, 1 / 8, 1), crash(0)]),
  ];
  const p = project('Moonlight: Drill Flip', 142, 0, [1, 65], [piano, strings, bass, kitT], clips, [[1, 'Intro'], [9, 'Drop'], [25, 'Beat switch'], [33, 'Drop 2'], [49, 'Break'], [53, 'Final drop'], [61, 'Outro']], beatMaster(5));
  return { ...p, masterFx: { ...STUDIO, reverbDecay: 2 } };
}

// ---------- Cello Prelude: Boom Bap Flip ----------

function preludeBoomBap(): ProjectSnapshot {
  const cello = scorePart('preludeCello');
  // Chops: the first half of each of the Prelude's first four bars (eight sixteenths each), and
  // two from the long climb over the D (bars 25-26) for the switch
  const slice = (bar: number, half = 0) => notesBetween(cello, (bar - 1) * 4 + half * 2, (bar - 1) * 4 + half * 2 + 2);
  const chopAt = (s: ScoreNote[], at: number, vel = 0.7) => fromScore(s, s[0].start, 1, vel, 0.85).map((x, i) => ({ ...x, startOffset: x.startOffset + at, velocity: i === 0 ? vel + 0.12 : vel }));
  // The four-bar chop: G | C/G | G (Am7) | G, the last slice stuttered
  const chop = [
    ...chopAt(slice(1), 0), ...chopAt(slice(2), 0.5),
    ...chopAt(slice(1), 1), ...chopAt(slice(3), 1.5),
    ...chopAt(slice(1), 2), ...chopAt(slice(2), 2.5),
    ...chopAt(slice(4), 3), ...chopAt(slice(4).slice(0, 2), 3.5), ...chopAt(slice(4).slice(0, 2), 3.625), ...chopAt(slice(4).slice(0, 4), 3.75),
  ];
  const switchChop = [...chopAt(slice(25), 0), ...chopAt(slice(25, 1), 0.5), ...chopAt(slice(26), 1), ...chopAt(slice(26, 1), 1.5)];
  const celloT = track('Cello chops', 'realSoloCello', {
    volume: -6,
    reverbSend: 0.15,
    fx: { lofi: { on: true, crush: bits(12), tone: 6500, wow: 0.25, mix: 0.55 }, filter: { on: true, cutoff: 5000 }, peq: peq(lowCut(90), bell(400, -2)), pump: { on: true, depth: 0.35, release: 200, trigger: 'kick' } },
    automation: opening(1, 5, 0.2),
  });
  const keys = track('Electric piano', 'realElectricPiano', { volume: -13, pan: -0.2, reverbSend: 0.2, fx: { lofi: { on: true, crush: bits(12), tone: 5000, wow: 0.3, mix: 0.4 }, peq: peq(lowCut(150)) } });
  const sub = track('Sub-Bass', 'subBass', { volume: -6, glide: 0.06, fx: { peq: peq(lowCut(28)) } });
  const drumsT = track('Drums', 'studioKit', { volume: 3, fx: { lofi: { on: true, crush: bits(12), tone: 9000, wow: 0, mix: 0.3 }, peq: peq(lowCut(35), bell(350, -3), highCut(8000)), compressor: { on: true, threshold: -16, ratio: 4, makeup: 2 } } });
  // Boom bap over two bars: kick on 1 and the "and" of 2, snare on 2 and 4 laid back, swung hats
  const boomBap = drums([
    [D.kick, 'X.........x..... X.x.......x..x..'],
    [D.snare, '....X.......X... ....X.......X..g'],
    [D.closedHat, 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.xo'],
    [D.openHat, '................ ..............o.'],
  ]);
  // The switch: the boom bap at half speed (Arrange a beat's half time)
  const halfTime = switchedNotes('drums', loop(boomBap, 2, 4), 8, 'half', newId);
  const swing = { swing: 0, grid: 16 as const, rows: { [D.closedHat]: { swing: 0.32, offbeat: 0.8 }, [D.openHat]: { swing: 0.32 }, [D.snare]: { shift: 0.08 } } };
  const roots = eight([[0, 'G1', 0.5], [0.5, 'C2', 0.5], [1, 'G1', 0.5], [1.5, 'A1', 0.5], [2, 'G1', 0.5], [2.5, 'C2', 0.5], [3, 'G1', 0.375], [3.375, 'D2', 0.625]], 0.8);
  const switchRoots = eight([[0, 'D2', 1], [1, 'D2', 0.75], [1.75, 'C2', 0.25]], 0.8);
  // Lazy ninth chords on the second beat, under the chop (Gmaj9, Cmaj7, Am9, D9)
  const ep = [['B2', 'F#3', 'A3', 'D4'], ['E3', 'G3', 'B3', 'D4'], ['G3', 'C4', 'E4', 'B4'], ['C3', 'F#3', 'A3', 'E4']].flatMap((v, i) => v.map((p) => n(p, i + 0.25, 0.6, 0.45)));
  const clips: Clip[] = [
    // Intro (1-4): the chop alone, the filter opening
    place(celloT, 'Chop', 1, 4, chop, { dropOut: 0.25 }),
    // Beat (5-20)
    place(drumsT, 'Boom bap', 5, 16, loop(boomBap, 2, 8), { dropOut: 0.5, groove: swing }),
    place(sub, 'Bass', 5, 16, loop(roots, 4, 4), { dropOut: 0.5 }),
    place(celloT, 'Chop', 5, 16, loop(chop, 4, 4)),
    // Switch (21-28): the long climb's chop, half-time drums, the bass on D
    place(celloT, 'Switch chop', 21, 8, loop(switchChop, 2, 4), { dropOut: 0.5 }),
    place(drumsT, 'Half time', 21, 8, halfTime, { dropOut: 0.5, groove: swing }),
    place(sub, 'Bass', 21, 8, loop(switchRoots, 2, 4), { dropOut: 0.5 }),
    // Beat 2 (29-40), with the electric piano
    place(drumsT, 'Boom bap', 29, 12, loop(boomBap, 2, 6), { groove: swing }),
    place(sub, 'Bass', 29, 12, loop(roots, 4, 3)),
    place(celloT, 'Chop', 29, 12, loop(chop, 4, 3)),
    place(keys, 'Chords', 29, 12, loop(ep, 4, 3)),
    // Outro (41-44): chop and keys, the last chord
    place(celloT, 'Chop', 41, 4, chop),
    place(keys, 'Chords', 41, 4, ep),
    place(drumsT, 'Last hit', 41, 1, [n(D.kick, 0, 1 / 8, 0.9)]),
  ];
  const p = project('Cello Prelude: Boom Bap Flip', 88, 0, [1, 45], [celloT, keys, sub, drumsT], clips, [[1, 'Intro'], [5, 'Beat'], [21, 'Beat switch'], [29, 'Beat 2'], [41, 'Outro']], beatMaster(4, 0.12));
  return { ...p, masterFx: { ...STUDIO, reverbDecay: 1.3 } };
}

// ---------- Mountain King: Phonk Flip ----------

function kingPhonk(): ProjectSnapshot {
  const right = scorePart('kingRight');
  const left = scorePart('kingLeft');
  // The theme (Grieg's bars 2-9, and its answer, bars 10-17), three octaves up on the cowbell
  const theme = fromScore(notesBetween(right, 4, 36), 4, 1, 0.95, 0.6).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 36) }));
  const answer = fromScore(notesBetween(right, 36, 68), 36, 1, 0.95, 0.6).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 24) }));
  // The bass line (the left hand's B and F sharp) an octave up, on the 808
  const lows = fromScore(notesBetween(left, 4, 36), 4, 1, 0.85, 1).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 12), duration: barsToDuration(1 / 8) }));
  const cowbell = track('Cowbell', 'synthDesigner', {
    volume: 6,
    synth: PATCH.phonkCowbell(),
    reverbSend: 0.12,
    fx: { peq: peq(lowCut(300), highCut(8000)), lofi: { on: true, crush: bits(10), tone: 8000, wow: 0, mix: 0.4 }, distortion: { on: true, amount: 0.22 }, pump: { on: true, depth: 0.4, release: 170, trigger: 'kick' } },
  });
  const pad = track('Pad', 'synthDesigner', { volume: -13, synth: PATCH.darkPad(), reverbSend: 0.3, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.5, release: 220, trigger: 'kick' } }, automation: opening(1, 9, 0.2) });
  const bass = track('808', 'bass808', { volume: -1, bass808: bass808Preset('Phonk dark (room for cowbell)'), fx: { peq: peq(lowCut(28)) } });
  const reese = track('Reese', 'reeseBass', { volume: -6, glide: 0.08, fx: { peq: peq(lowCut(120), highCut(5000)), distortion: { on: true, amount: 0.15 }, pump: { on: true, depth: 0.5, release: 180, trigger: 'kick' } } });
  const kitT = kit('Drums', { kick: 'distortedBoomKick', snare: 'fatSnare', clap: 'clapSnare', closedHat: 'trapHat', openHat: 'openHat', cowbell: 'cowbell', crash: 'crash' }, { volume: -11, fx: { peq: peq(lowCut(30), highCut(11000)), lofi: { on: true, crush: bits(12), tone: 10000, wow: 0, mix: 0.25 } } });
  // Drift phonk: a kick on every beat, the clap on 2 and 4, busy hats, open hats off the beat
  const drift = drums([
    [D.kick, 'X...X...X...X... X...X...X...X.x.'],
    [D.clap, '....X.......X... ....X.......X...'],
    [D.closedHat, 'x.xx.xxx.xx.xx.x x.xx.xxx.xx.xx.x'],
    [D.openHat, '..o...o...o...o. ..o...o...o.....'],
  ]);
  const drift8 = [...loop(drift, 2, 3), ...later(drift, 6).filter((x) => x.startOffset < 7.5), ...roll(7.5, 8, 1 / 32, 0.35, 0.9)];
  // The switch at half speed (Arrange a beat's half time), a snare on its 3s
  const halfDrift = [...switchedNotes('drums', loop(drift, 2, 4), 8, 'half', newId), ...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => n(D.snare, b + 0.5, 1 / 8, 0.85))];
  const padChords = [['B2', 'D3', 'F#3'], ['B2', 'D3', 'F#3'], ['A#2', 'C#3', 'F#3'], ['B2', 'D3', 'F#3']].flatMap((v, i) => v.map((p) => n(p, i * 2, 2, 0.5)));
  const reeseLine = eight([[0, 'B1', 2], [2, 'G1', 2], [4, 'F#1', 2], [6, 'B1', 2]], 0.8);
  const crash = (at: number) => n(D.crash, at, 1, 0.65);
  const clips: Clip[] = [
    // Intro (1-8): the theme on the cowbell over the dark pad, filter opening, roll in
    place(cowbell, 'Theme', 1, 8, theme, { dropOut: 0.5 }),
    place(pad, 'Pad', 1, 8, padChords),
    place(kitT, 'Roll in', 8, 1, roll(0.5, 1, 1 / 32, 0.3, 0.9)),
    // Drop (9-24)
    place(kitT, 'Drift', 9, 16, [crash(0), ...loop(drift8, 8, 2)], { dropOut: 0.5 }),
    place(bass, '808', 9, 16, loop(lows, 8, 2), { dropOut: 0.5 }),
    place(cowbell, 'Theme', 9, 16, loop(theme, 8, 2)),
    // Switch (25-32): the answer, half time, the Reese rolling under it
    place(cowbell, 'Answer', 25, 8, answer, { dropOut: 0.5 }),
    place(kitT, 'Half time', 25, 8, [crash(0), ...halfDrift], { dropOut: 0.5 }),
    place(reese, 'Reese', 25, 8, reeseLine, { dropOut: 0.5 }),
    place(pad, 'Pad', 25, 8, padChords, { dropOut: 0.5 }),
    // Drop 2 (33-48): faster, the theme an octave up then back, the Reese doubling the 808
    place(kitT, 'Drift', 33, 16, [crash(0), ...loop(drift8, 8, 2)], { dropOut: 0.5 }),
    place(bass, '808', 33, 16, loop(lows, 8, 2), { dropOut: 0.5 }),
    place(cowbell, 'Theme', 33, 16, [...up(theme, 12), ...later(theme, 8)]),
    place(reese, 'Reese', 33, 16, loop(reeseLine, 8, 2), { dropOut: 0.5 }),
    // Break (49-52): the cowbell alone; then the fastest drop (53-60) and the last stabs (61-64)
    place(cowbell, 'Break', 49, 4, theme, { dropOut: 0.5 }),
    place(kitT, 'Roll in', 52, 1, roll(0, 1, 1 / 32, 0.3, 0.95)),
    place(kitT, 'Drift', 53, 8, [crash(0), ...drift8]),
    place(bass, '808', 53, 8, lows),
    place(cowbell, 'Theme', 53, 8, up(theme, 12)),
    place(reese, 'Reese', 53, 8, reeseLine),
    place(pad, 'Pad', 53, 8, padChords),
    place(kitT, 'Stabs', 61, 4, [crash(0), n(D.kick, 0, 1 / 8, 1), n(D.clap, 0, 1 / 8, 0.9), n(D.kick, 1, 1 / 8, 1), n(D.clap, 1, 1 / 8, 0.9), n(D.kick, 1.25, 1 / 8, 1), crash(1.25)]),
    place(bass, 'Stabs', 61, 4, [n('B1', 0, 0.2, 0.9), n('B1', 1, 0.2, 0.9), n('B1', 1.25, 1.5, 0.9)]),
    place(cowbell, 'Stabs', 61, 4, [n('B5', 0, 0.1, 0.9), n('F#5', 1, 0.1, 0.9), n('B5', 1.25, 0.25, 0.95)]),
  ];
  const p = project('Mountain King: Phonk Flip', 130, 0, [1, 65], [cowbell, pad, bass, reese, kitT], clips, [[1, 'Intro'], [9, 'Drop'], [25, 'Beat switch'], [33, 'Drop 2, faster'], [49, 'Break'], [53, 'Fastest'], [61, 'Stabs']], beatMaster(5.5));
  // Like the original, it speeds up: 130 to 138 over the second drop, 146 for the last
  return { ...p, masterFx: STUDIO, tempoPoints: tempoMap([[33, 130], [48.9, 138, true], [53, 146]]) };
}

// ---------- Clair de lune: Melodic Trap Flip ----------

function clairTrap(): ProjectSnapshot {
  const upper = scorePart('clairUpper');
  // The opening's falling thirds (Debussy's first four measures of 9/8) squeezed into four bars of 4/4
  const thirds = fromScore(notesBetween(upper, 0, 18), 0, 8 / 9, 0.68);
  // Db major: Dbmaj7, Bbm9, Gbmaj7, Absus - Ab
  const chordsV = [['C#3', 'G#3', 'C4', 'F4'], ['A#2', 'G#3', 'C#4', 'C4'], ['F#2', 'C#3', 'F3', 'A#3'], ['G#2', 'C#3', 'D#3', 'G#3']];
  const roots = ['C#1', 'A#1', 'F#1', 'G#1'];
  // A rippling triplet arpeggio under it, as in the "un poco mosso"
  const arps = chordsV.flatMap((v, b) => [0, 1, 2, 3, 2, 1].flatMap((k, i) => [n(nameOf(pitchOf(v[k]) + 12), b + i / 6, 1 / 6, i === 0 ? 0.42 : 0.34)]));
  const pads = chordsV.flatMap((v, i) => v.map((p) => n(p, i, 1, 0.5)));
  const piano = track('Piano', 'realGrandPiano', { volume: 6, reverbSend: 0.4, delaySend: 0.14, fx: { peq: peq(lowCut(150)), filter: { on: true, cutoff: 10000 } }, automation: opening(1, 9, 0.3) });
  const arpT = track('Arpeggio', 'realGrandPiano', { volume: 2, pan: 0.2, reverbSend: 0.4, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.4, release: 220, trigger: 'kick' } } });
  const pad = track('Glass pad', 'synthDesigner', { volume: -12, synth: presetPatch('Glass pad'), reverbSend: 0.4, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.5, release: 260, trigger: 'kick' } } });
  const bass = track('808', 'bass808', { volume: -1, bass808: bass808Preset('Clean deep'), fx: { peq: peq(lowCut(28)) } });
  const reese = track('Reese', 'reeseBass', { volume: -5, glide: 0.1, fx: { peq: peq(lowCut(100), highCut(4000)), distortion: { on: true, amount: 0.1 } } });
  const kitT = kit('Drums', { kick: 'clickySubKick', snare: 'trapSnare', clap: 'wideClap', closedHat: 'trapHat', openHat: 'longOpenHat', crash: 'crash' }, { volume: -7, fx: { peq: peq(lowCut(30), highCut(11000)) } });
  // Melodic trap: snare and clap on 3, rolling hats with triplet and 32nd rolls
  const beat = [
    ...drums([
      [D.kick, 'X.......x....... X.....x...x..... X.......x....... X.....x....x.x..'],
      [D.snare, '........X....... ........X....... ........X....... ........X.......'],
      [D.clap, '........x....... ........x....... ........x....... ........x.......'],
      [D.closedHat, 'x.x.x.x.x.x.x.x. x.x.x.x.x...x.x. x.x.x.x.x.x.x.x. x.x.x.x.........'],
      [D.openHat, '..............o. ................ ..............o. ................'],
    ]),
    ...roll(1 + 10 / 16, 1 + 12 / 16, 1 / 24, 0.35, 0.7),
    ...roll(3 + 8 / 16, 4, 1 / 32, 0.3, 0.9),
  ];
  // The slow, heavy switch: half time (a kick and a snare a bar), the Reese and the 808 held long
  const heavy = drums([
    [D.kick, 'X............... X.........x.....'],
    [D.snare, '................ ................'],
    [D.clap, '................ ................'],
    [D.closedHat, 'x.....x.....x... x.....x.....x.x.'],
  ]).concat([n(D.snare, 1, 1 / 4, 1), n(D.clap, 1, 1 / 4, 0.8)]);
  const bassLine = eight([[0, roots[0], 0.62], [0.6875, roots[0], 0.3], [1, roots[1], 0.62], [1.6875, roots[1], 0.31], [2, roots[2], 0.62], [2.75, roots[2], 0.25], [3, roots[3], 0.5], [3.5, 'C#2', 0.5]]);
  const held = eight(roots.map((r, i): [number, string, number] => [i, r, 1.02]), 0.8);
  const crash = (at: number) => n(D.crash, at, 1, 0.6);
  const groove = hatSwing(0.1);
  const clips: Clip[] = [
    // Intro (1-8): the thirds on the piano over the pad, the arpeggio from 5
    place(piano, 'Thirds', 1, 8, loop(thirds, 4, 2), { dropOut: 0.5 }),
    place(pad, 'Pad', 1, 8, loop(pads, 4, 2)),
    place(arpT, 'Arpeggio', 5, 4, arps),
    place(kitT, 'Roll in', 8, 1, roll(0.5, 1, 1 / 24, 0.3, 0.85)),
    // Drop (9-24)
    place(kitT, 'Beat', 9, 16, [crash(0), ...loop(beat, 4, 4)], { dropOut: 0.5, groove }),
    place(bass, '808', 9, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(piano, 'Thirds', 9, 16, loop(thirds, 4, 4)),
    place(arpT, 'Arpeggio', 9, 16, loop(arps, 4, 4)),
    place(pad, 'Pad', 9, 16, loop(pads, 4, 4)),
    // The slow, heavy switch (25-32)
    place(kitT, 'Heavy', 25, 8, [crash(0), ...loop(heavy, 2, 4)], { dropOut: 0.5 }),
    place(bass, '808 held', 25, 8, loop(held, 4, 2), { dropOut: 0.5 }),
    place(reese, 'Reese', 25, 8, loop(held, 4, 2).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 12) })), { dropOut: 0.5 }),
    place(piano, 'Thirds', 25, 8, loop(thirds, 4, 2), { dropOut: 0.5 }),
    place(pad, 'Pad', 25, 8, loop(pads, 4, 2), { dropOut: 0.5 }),
    // Drop 2 (33-48): the thirds an octave up over the arpeggio
    place(kitT, 'Beat', 33, 16, [crash(0), ...loop(beat, 4, 4)], { dropOut: 0.5, groove }),
    place(bass, '808', 33, 16, loop(bassLine, 4, 4), { dropOut: 0.5 }),
    place(piano, 'Thirds', 33, 8, loop(thirds, 4, 2)),
    place(piano, 'Thirds up', 41, 8, up(loop(thirds, 4, 2), 12), { dropOut: 0.5 }),
    place(arpT, 'Arpeggio', 33, 16, loop(arps, 4, 4)),
    place(pad, 'Pad', 33, 16, loop(pads, 4, 4)),
    // Break (49-52), final drop (53-60), outro (61-64)
    place(piano, 'Thirds', 49, 4, thirds, { dropOut: 0.5 }),
    place(pad, 'Pad', 49, 4, pads),
    place(kitT, 'Roll in', 52, 1, roll(0, 1, 1 / 32, 0.25, 0.9)),
    place(kitT, 'Beat', 53, 8, [crash(0), ...loop(beat, 4, 2)], { groove }),
    place(bass, '808', 53, 8, loop(bassLine, 4, 2)),
    place(reese, 'Reese', 53, 8, loop(held, 4, 2).map((x) => ({ ...x, note: nameOf(pitchOf(x.note) + 12), velocity: 0.6 }))),
    place(piano, 'Thirds up', 53, 8, up(loop(thirds, 4, 2), 12)),
    place(arpT, 'Arpeggio', 53, 12, loop(arps, 4, 3)),
    place(pad, 'Pad', 53, 12, loop(pads, 4, 3)),
    place(piano, 'Thirds', 61, 4, thirds),
    place(bass, 'Last 808', 61, 2, [n('C#1', 0, 2, 0.8)]),
  ];
  const p = project('Clair de lune: Melodic Trap Flip', 140, 0, [1, 65], [piano, arpT, pad, bass, reese, kitT], clips, [[1, 'Intro'], [9, 'Drop'], [25, 'Slow, heavy switch'], [33, 'Drop 2'], [49, 'Break'], [53, 'Final drop'], [61, 'Outro']], beatMaster(4.5));
  return { ...p, masterFx: { ...STUDIO, reverbDecay: 2.2 } };
}

export const FLIP_BUILDERS = { canonTrap, moonlightDrill, preludeBoomBap, kingPhonk, clairTrap };
