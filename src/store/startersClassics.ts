import type { ProjectSnapshot } from './project';
import { master, project, track } from './starterKit';
import { canonLine, scorePart } from './classicsScores';
import { bassChanges, curveAt, notesBetween, pedalPoints, pitchOf, shiftNotes } from './scoreNotes';
import type { ScoreNote } from './scoreNotes';
import { nameOf } from './noteTools';
import { barsToDuration, uid } from './timelineTypes';
import type { Clip, ExprPoint, NoteEvent, PeqBand, Track } from './timelineTypes';
import type { TempoPoint } from '../audio/tempoMap';
import { swellLane } from './swell';

/**
 * The Classics starters: five public-domain pieces, complete, on the app's best instruments, each
 * shaped as a player would: Pachelbel's Canon in D for solo strings and sections over the ground
 * bass, the first movement of Beethoven's "Moonlight" sonata and Debussy's Clair de lune on the
 * concert grand with the sustain pedal, Bach's first cello suite's Prelude on the solo cello, and
 * Grieg's In the Hall of the Mountain King for orchestra, gathering speed to the end. Their notes
 * are in classicsScores.ts (where each comes from); here they're arranged: which instrument plays
 * what, the dynamics (velocity for the piano, the mod wheel's dynamics for the strings), the tempo
 * map's rubato, the pedal, and legato (with its slides) for the bowed lines.
 */

const lowCut = (freq: number): PeqBand => ({ on: true, type: 'lowcut', freq, gain: 0, q: Math.SQRT1_2 });
const highShelf = (freq: number, gain: number): PeqBand => ({ on: true, type: 'highshelf', freq, gain, q: 0.7 });
const peq = (...bands: PeqBand[]) => ({ on: true, bands });
/** A light touch of timing and dynamics (Human), never pitch. */
const human = (amount: number) => ({ on: true, timing: amount, dynamics: amount, pitch: 0 });

/** Score notes (quarter notes from the piece's start) as a clip's notes, `from` being the clip's start. */
function events(notes: readonly ScoreNote[], from: number, velocity: (n: ScoreNote) => number): NoteEvent[] {
  return notes.map((n) => ({
    id: uid('note'),
    note: nameOf(n.pitch),
    startOffset: Math.round(((n.start - from) / 4) * 1e6) / 1e6,
    duration: barsToDuration(n.dur / 4),
    velocity: Math.round(Math.max(0.05, Math.min(1, velocity(n))) * 1000) / 1000,
  }));
}

/** A clip from bar `startBar`, `bars` long, of score notes (quarters from the piece's start, bar 1 at 0). */
function scoreClip(t: Track, name: string, startBar: number, bars: number, notes: readonly ScoreNote[], velocity: (n: ScoreNote) => number, expression?: Clip['expression']): Clip {
  const from = (startBar - 1) * 4;
  return { id: uid('clip'), trackId: t.id, name, startBar, lengthBars: bars, notes: events(notes, from, velocity), isSelected: false, ...(expression ? { expression } : {}) };
}

/** A lane drawn from a curve over quarter notes, sampled every `step` quarters, as a clip from quarter `from` sees it. */
function lane(curve: ReadonlyArray<readonly [number, number]>, from: number, to: number, step = 1): ExprPoint[] {
  const out: ExprPoint[] = [];
  for (let q = from; q <= to + 1e-9; q += step) out.push({ at: Math.round(((q - from) / 4) * 1e4) / 1e4, value: Math.round(Math.max(0, Math.min(1, curveAt(curve, q))) * 1000) / 1000 });
  // Points on a straight line between their neighbours say nothing: keep the corners
  return out.filter((p, i) => i === 0 || i === out.length - 1 || Math.abs(p.value - (out[i - 1].value + out[i + 1].value) / 2) > 0.002);
}

/** The sustain pedal lane (0 or 1 points) for pedal changes at `changes`, as a clip from quarter `from` sees it. */
const pedalLane = (changes: readonly number[], from: number, end: number): ExprPoint[] =>
  pedalPoints(changes, end).map(([q, v]) => ({ at: Math.round(((q - from) / 4) * 1e5) / 1e5, value: v }));

/** A curve given by bar numbers (bar 1 at quarter 0), as [quarter, value] points. */
const byBar = (points: ReadonlyArray<readonly [number, number]>, beats = 4): Array<[number, number]> => points.map(([b, v]) => [(b - 1) * beats, v]);

/** Tempo points from [bar, bpm, glide] (bar 1 is the song's start). */
const tempoMap = (points: ReadonlyArray<readonly [number, number, boolean?]>): TempoPoint[] => points.map(([bar, bpm, ramp]) => ({ id: uid('tempo'), bar, bpm, ramp: !!ramp }));

/**
 * A bowed line played legato: a note of at least `shortest` quarters that runs straight into the
 * next (a step or leap of up to an octave, a different pitch) lasts `overlap` quarters longer, so
 * the string changes note without a new bow and slides into it (the recorded strings' portamento).
 */
function legato(notes: readonly ScoreNote[], overlap: number, shortest = 0.5): ScoreNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  return sorted.map((n, i) => {
    const next = sorted[i + 1];
    if (!next || n.dur < shortest - 1e-9) return n;
    const touching = Math.abs(n.start + n.dur - next.start) < 1e-6;
    return touching && next.pitch !== n.pitch && Math.abs(next.pitch - n.pitch) <= 12 ? { ...n, dur: n.dur + overlap } : n;
  });
}

/** A gentle hall for the acoustic pieces; the concert grand a touch less bright up top. */
const HALL = { reverbDecay: 2.6, delayTime: '8n', delayFeedback: 0.3 };
const glueGentle = () => ({ ...master({ on: false }, { on: true, amount: 1.05 }), glue: 'gentle' as const });

// ---------- Pachelbel: Canon in D ----------

/**
 * Canon in D: the three violins' strict canon, two bars apart, over the eight-note ground. The
 * first violin is the solo Violin, the second a second solo Violin, the third the solo Viola; the
 * ground on the solo Cello with the Contrabass an octave below. From the sixteenths on, the Cellos
 * section joins the ground, and in the singing variations at the end the Violins and Violas
 * sections double the first and third voices. One dynamics curve for the whole ensemble, as an
 * ensemble plays: quiet at the start, growing with each variation, light for the plucked-sounding
 * eighths, broad at the end, with a slowing in the last two bars.
 */
function canon(): ProjectSnapshot {
  const BPM = 58;
  const line = canonLine(8);
  const END = 56 * 4; // the voices stop where the first violin ends; then the last chord
  // The light eighths with rests (bars 23 to 26) played short, off the string
  const shaped = line.map((n) => (n.start >= 22 * 4 && n.start < 26 * 4 && n.dur === 0.5 ? { ...n, dur: 0.3 } : n));
  const sung = legato(shaped, (0.07 * BPM) / 60);
  const voices = [sung, shiftNotes(sung, 8), shiftNotes(sung, 16)].map((v) => v.filter((n) => n.start < END - 1e-9).map((n) => (n.start + n.dur > END ? { ...n, dur: END - n.start } : n)));
  const finalChord = (pitch: string): ScoreNote => ({ pitch: pitchOf(pitch), start: END, dur: 6 });
  const groundPitches = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'].map(pitchOf);
  const ground: ScoreNote[] = [...Array(END)].map((_, q) => ({ pitch: groundPitches[q % 8], start: q, dur: 0.92 }));
  ground.push({ pitch: pitchOf('D3'), start: END, dur: 6 });

  // The ensemble's dynamics by bar (the mod wheel's 0 to 1: about 0.45 piano, 0.65 mezzo-forte, 0.85 forte)
  const dyn = byBar([
    [1, 0.42], [3, 0.45], [7, 0.5], [11, 0.58], [15, 0.64], [19, 0.7], [22.9, 0.74], [23, 0.5], [26.9, 0.52], [27, 0.6],
    [31, 0.66], [34.9, 0.76], [35, 0.72], [38.9, 0.74], [39, 0.55], [42.9, 0.58], [43, 0.64], [47, 0.7], [51, 0.8], [55, 0.86], [57, 0.8], [58.5, 0.7],
  ]);
  // Each two-bar phrase leans to its middle and eases off, a little
  const breath = (q: number) => 0.04 * Math.sin(Math.PI * ((q % 8) / 8));
  const curve: Array<[number, number]> = [];
  for (let q = 0; q <= 58 * 4; q += 1) curve.push([q, curveAt(dyn, q) + breath(q)]);
  const dynamics = (from: number, to: number) => ({ mod: lane(curve, from, to) });

  const strings = { fx: { human: human(0.12) } };
  const v1 = track('Violin I', 'realViolin', { volume: -9, pan: -0.45, reverbSend: 0.32, distance: 0.15, ...strings });
  const v2 = track('Violin II', 'realViolin', { volume: -10, pan: 0.4, reverbSend: 0.32, distance: 0.2, ...strings });
  const v3 = track('Violin III (viola)', 'realViola', { volume: -2, pan: -0.15, reverbSend: 0.32, distance: 0.25, ...strings });
  const cello = track('Cello (ground)', 'realSoloCello', { volume: -8, pan: 0.15, reverbSend: 0.28, distance: 0.25, ...strings });
  const bass = track('Contrabass', 'realContrabass', { volume: -19, pan: 0.25, reverbSend: 0.25, distance: 0.35, fx: { peq: peq(lowCut(30)), human: human(0.1) } });
  const violins = track('Violins section', 'realViolins', { volume: -15, pan: -0.5, reverbSend: 0.38, distance: 0.45 });
  const violas = track('Violas section', 'realViolas', { volume: -14, pan: 0.3, reverbSend: 0.38, distance: 0.45 });
  const cellos = track('Cellos section', 'realCello', { volume: -16, pan: 0.2, reverbSend: 0.35, distance: 0.45 });

  const vel = () => 0.65;
  const total = 58;
  // The sections' doublings swell with each phrase (the Swell tool's shape) inside the ensemble's dynamics
  const sectionClip = (t: Track, name: string, startBar: number, notes: ScoreNote[]): Clip => {
    const c = scoreClip(t, name, startBar, total - startBar + 1, notes, vel);
    const from = (startBar - 1) * 4;
    const mod = swellLane(undefined, c.notes, 'swell', 0.6).map((pt) => ({ at: pt.at, value: Math.round(pt.value * curveAt(curve, from + pt.at * 4) * 1000) / 1000 }));
    return { ...c, expression: { mod } };
  };
  const whole = (t: Track, name: string, notes: ScoreNote[]) => scoreClip(t, name, 1, total, notes, vel, dynamics(0, total * 4));
  const clips: Clip[] = [
    whole(v1, 'Violin I', [...voices[0], finalChord('A4')]),
    whole(v2, 'Violin II', [...voices[1], finalChord('F#5')]),
    whole(v3, 'Violin III', [...voices[2], finalChord('D5')]),
    whole(cello, 'Ground', ground),
    whole(bass, 'Ground', shiftNotes(ground, 0, -12)),
    // The Cellos section under the ground from the sixteenths on; the upper sections in the last variations
    scoreClip(cellos, 'Ground', 11, total - 10, notesBetween(ground, 40, total * 4), vel, dynamics(40, total * 4)),
    sectionClip(violins, 'Doubling Violin I', 41, [...notesBetween(voices[0], 160, END), finalChord('A4')]),
    sectionClip(violas, 'Doubling Violin III', 45, [...notesBetween(voices[2], 176, END), finalChord('D5')]),
  ];
  const p = project(
    'Canon in D (Pachelbel)',
    BPM,
    0,
    [1, total + 1],
    [v1, v2, v3, cello, bass, violins, violas, cellos],
    clips,
    [[1, 'Ground bass'], [3, 'Violin I'], [11, 'Sixteenths'], [19, 'Thirty-seconds'], [23, 'Light eighths'], [31, 'Repeated notes'], [39, 'Singing'], [53, 'Last variation']],
    glueGentle()
  );
  // A breath at the end of the slow opening, then steady; the last two bars broaden
  return { ...p, masterFx: HALL, tempoPoints: tempoMap([[10.75, 56, true], [11, 58], [55, 58], [57, 48, true], [58.5, 40, true]]) };
}

// ---------- Beethoven: "Moonlight" sonata, first movement ----------

/**
 * The "Moonlight" first movement, complete, on the concert grand: the triplets kept soft and even
 * under a singing melody, the bass octaves between, pedalled as Beethoven asks (senza sordini: the
 * dampers raised), changed with each new bass note and each new harmony so it never blurs. Its
 * dynamics follow the score's hairpins (it never rises above piano), and the tempo breathes: a
 * little forward through the arpeggios over the dominant, back for the return, slowing at the end.
 */
function moonlight(): ProjectSnapshot {
  const tune = scorePart('moonMelody');
  const triplets = scorePart('moonTriplets');
  const bass = scorePart('moonBass');
  const END = 69 * 4;
  // How loud, by bar (1 the loudest the piece gets: piano, with its swells)
  const dyn = byBar([
    [1, 0.55], [5, 0.58], [15, 0.6], [23, 0.62], [25, 0.72], [26.5, 0.75], [27, 0.66], [28, 0.6], [31.9, 0.62], [32, 0.65], [35.5, 0.82],
    [36, 0.8], [40, 0.62], [41.9, 0.55], [42, 0.55], [47, 0.6], [48, 0.7], [49, 0.62], [51, 0.62], [53, 0.72], [55, 0.62], [57, 0.62],
    [58, 0.72], [59, 0.6], [60, 0.5], [62, 0.6], [63, 0.66], [64, 0.58], [65, 0.64], [66, 0.55], [68, 0.42], [69, 0.4],
  ]);
  const at = (n: ScoreNote) => curveAt(dyn, n.start);
  // The triplets' first note of each group a shade fuller, so the pulse is felt, not heard
  const tripletVel = (n: ScoreNote) => at(n) * (Math.abs(n.start * 3 - Math.round(n.start * 3)) < 1e-6 && Math.abs(n.start - Math.round(n.start)) < 1e-6 ? 0.56 : 0.5);
  // Pedal: with every new bass note and every beat whose triplet harmony changes
  const beatSets = new Map<number, string>();
  for (const n of triplets) {
    const b = Math.floor(n.start + 1e-6);
    beatSets.set(b, [...new Set([...(beatSets.get(b)?.split(',') ?? []).filter(Boolean), String(n.pitch % 12)])].sort().join(','));
  }
  const changes = new Set<number>(bass.map((n) => n.start));
  let last = '';
  for (let b = 0; b < END; b++) {
    const set = beatSets.get(b);
    if (set && set !== last) changes.add(b);
    if (set) last = set;
  }
  const piano = track('Piano', 'realGrandPiano', { volume: 6, reverbSend: 0.3, fx: { peq: peq(lowCut(30), highShelf(7000, -2)), human: human(0.15) } });
  const notes = [...triplets.map((n) => ({ n, v: tripletVel(n) })), ...tune.map((n) => ({ n, v: at(n) * 0.8 })), ...bass.map((n) => ({ n, v: at(n) * 0.66 }))];
  const velocity = new Map(notes.map(({ n, v }) => [n, v]));
  const all = notes.map(({ n }) => n);
  const p = project(
    'Moonlight Sonata, 1st mvt (Beethoven)',
    54,
    0,
    [1, 70],
    [piano],
    [scoreClip(piano, 'Adagio sostenuto', 1, 69, all, (n) => velocity.get(n) ?? 0.5, { sustain: pedalLane([...changes].sort((a, b) => a - b), 0, END) })],
    [[1, 'Introduction'], [5, 'Theme'], [23, 'The theme in F sharp minor'], [28, 'Over the dominant'], [42, 'Return'], [60, 'Coda']],
    glueGentle()
  );
  return {
    ...p,
    masterFx: HALL,
    tempoPoints: tempoMap([
      [4.75, 52, true], [5, 54], [22.75, 52, true], [23, 54], [28, 54], [35.5, 58, true], [37, 56, true], [41.75, 50, true], [42, 54],
      [59.75, 51, true], [60, 54], [66, 52, true], [68, 46, true], [69.5, 40, true],
    ]),
  };
}

// ---------- Bach: Cello Suite No. 1, Prelude ----------

/**
 * The Prelude of Bach's first cello suite, complete, on the solo Cello: each bar's broken chord
 * sounding out over its open-string bass, the dynamics (the mod wheel) rising into the held D of
 * bar 22 and again through the long climb over the D pedal to the end, the tempo pressing on and
 * holding back as a cellist plays it, with the fermatas held, and the last chord broken from the
 * low G.
 */
function prelude(): ProjectSnapshot {
  const notes = scorePart('preludeCello');
  const END = 42 * 4;
  // The last chord (G2 B3 G4, a whole note): the low G first, then the double stop held
  const last = notes.filter((n) => n.start >= END - 4 - 1e-6);
  const body = notes.filter((n) => n.start < END - 4 - 1e-6);
  const g2 = last.find((n) => n.pitch === pitchOf('G2'));
  const finalChord: ScoreNote[] = [
    ...(g2 ? [{ ...g2, dur: 0.5 }] : []),
    ...last.filter((n) => n !== g2).map((n) => ({ ...n, start: n.start + 0.25, dur: 3.75 })),
  ];
  const dyn = byBar([
    [1, 0.6], [4, 0.66], [5, 0.62], [8, 0.68], [11, 0.66], [14, 0.62], [15, 0.6], [18, 0.66], [19, 0.68], [21, 0.78], [22.5, 0.82],
    [22.75, 0.66], [23, 0.58], [25, 0.62], [28, 0.66], [29, 0.6], [31, 0.62], [33, 0.7], [35, 0.76], [37, 0.82], [39, 0.86], [41, 0.9], [42, 0.85], [43, 0.75],
  ]);
  // Each beat's first note leans a little (the bow's weight), within the bar's dynamics
  const vel = (n: ScoreNote) => 0.62 + (Math.abs(n.start - Math.round(n.start)) < 1e-6 ? 0.1 : 0);
  const cello = track('Cello', 'realSoloCello', { volume: 1, reverbSend: 0.34, fx: { human: human(0.1) } });
  const p = project(
    'Cello Suite No. 1: Prelude (Bach)',
    66,
    0,
    [1, 43],
    [cello],
    [scoreClip(cello, 'Prelude', 1, 42, [...body, ...finalChord], vel, { mod: lane(dyn, 0, END, 0.5) })],
    [[1, 'G major'], [11, 'Toward D'], [22, 'The held D'], [23, 'Down to the low D'], [31, 'Bariolage'], [39, 'The last climb']],
    glueGentle()
  );
  return {
    ...p,
    masterFx: { ...HALL, reverbDecay: 2.2 },
    tempoPoints: tempoMap([
      // the held D of bar 22 (its fermata, beat two and a half) and the pick-up after it
      [4.9, 63, true], [5, 66], [18, 66], [21, 70, true], [22.3, 58, true], [22.375, 26], [22.5625, 60], [26, 66, true], [30, 64, true],
      [31, 66], [37, 70, true], [39, 66, true], [41.5, 58, true], [42, 40, true],
    ]),
  };
}

// ---------- Grieg: In the Hall of the Mountain King ----------

/** Which part of Grieg's piano writing an orchestral part plays, over which bars, and how. */
interface Orch {
  t: Track;
  name: string;
  hand: 'right' | 'left';
  from: number;
  to: number;
  shift?: number;
  /** Keep only the top (or bottom) note of each chord */
  pick?: 'top' | 'bottom';
  vel?: number;
}

/**
 * In the Hall of the Mountain King, complete, orchestrated from Grieg's own piano version: the
 * horns' held F sharp, the theme stalking in the bassoon and plucked cellos over plucked basses,
 * climbing through the violas and violins, woodwinds and short strings, until the brass, tuba,
 * timpani and bass drum take it at full force, faster and faster (the tempo map's accelerando,
 * from a walk to a sprint), to the hushed chords and the timpani roll before the last crash.
 */
function mountainKing(): ProjectSnapshot {
  const right = scorePart('kingRight');
  const left = scorePart('kingLeft');
  const q = (bar: number) => (bar - 1) * 4;
  // Dynamics by bar, 0 to 1 (as velocity): p, pp for the theme, growing to fortissimo at bar 50
  const dyn = byBar([[1, 0.5], [2, 0.36], [17.9, 0.38], [18, 0.4], [25.9, 0.46], [26, 0.48], [34, 0.56], [41.9, 0.72], [42, 0.7], [49.9, 0.88], [50, 0.97], [83.9, 1], [84, 0.42], [85, 0.62], [86, 0.66], [87.9, 1], [88, 1]]);
  const short = { fx: { human: human(0.08) } };
  const parts = {
    horns: track('Horns', 'realHorn', { volume: -5, pan: -0.25, reverbSend: 0.35, distance: 0.5 }),
    hornsShort: track('Horns (short)', 'realHornShort', { volume: -11, pan: -0.25, reverbSend: 0.3, distance: 0.5 }),
    bassoon: track('Bassoon', 'realBassoon', { volume: 4, pan: 0.15, reverbSend: 0.3, distance: 0.45, ...short }),
    clarinet: track('Clarinet', 'realClarinet', { volume: -2, pan: -0.1, reverbSend: 0.3, distance: 0.45, ...short }),
    oboe: track('Oboe', 'realOboe', { volume: -6, pan: 0.1, reverbSend: 0.3, distance: 0.45, ...short }),
    flute: track('Flute', 'realFluteShort', { volume: -11, pan: -0.05, reverbSend: 0.3, distance: 0.45, ...short }),
    pizz: track('Pizzicato (cellos)', 'realPizzicato', { volume: -19, pan: 0.3, reverbSend: 0.3, distance: 0.3, ...short }),
    pizzBass: track('Pizzicato (basses)', 'realPizzicato', { volume: -22, pan: 0.4, reverbSend: 0.25, distance: 0.35, ...short }),
    violins: track('Violins (short)', 'realViolinsShort', { volume: -3, pan: -0.45, reverbSend: 0.3, distance: 0.3, ...short }),
    violas: track('Violas (short)', 'realViolasShort', { volume: -7, pan: 0.15, reverbSend: 0.3, distance: 0.3, ...short }),
    cellos: track('Cellos (short)', 'realCelloShort', { volume: -12, pan: 0.3, reverbSend: 0.3, distance: 0.3, ...short }),
    basses: track('Contrabass', 'realContrabass', { volume: -20, pan: 0.4, reverbSend: 0.25, distance: 0.4, fx: { peq: peq(lowCut(30)) } }),
    trumpet: track('Trumpets', 'realTrumpetShort', { volume: -7, pan: 0.2, reverbSend: 0.32, distance: 0.6 }),
    trombone: track('Trombones', 'realTromboneShort', { volume: -9, pan: 0.3, reverbSend: 0.32, distance: 0.6 }),
    tuba: track('Tuba', 'realTuba', { volume: -6, pan: 0.35, reverbSend: 0.3, distance: 0.6 }),
    tremolo: track('Tremolo strings', 'realTremolo', { volume: -10, reverbSend: 0.35, distance: 0.35 }),
    timpani: track('Timpani', 'realTimpani', { volume: -6, reverbSend: 0.35, distance: 0.6 }),
    drum: track('Bass drum', 'realBassDrum', { volume: -6, reverbSend: 0.4, distance: 0.65 }),
  };
  const P = parts;
  const plan: Orch[] = [
    // The theme in the depths: bassoon and plucked cellos, plucked basses on B and F sharp
    { t: P.bassoon, name: 'Theme', hand: 'right', from: 2, to: 26 },
    { t: P.pizz, name: 'Theme', hand: 'right', from: 2, to: 26 },
    { t: P.pizzBass, name: 'Basses', hand: 'left', from: 2, to: 50, shift: 12 },
    // It climbs: clarinet and violas, then violins and oboe, the cellos taking the bass's chords
    { t: P.clarinet, name: 'Theme', hand: 'right', from: 18, to: 34 },
    { t: P.violas, name: 'Theme', hand: 'right', from: 26, to: 42, pick: 'bottom' },
    { t: P.violins, name: 'Theme', hand: 'right', from: 26, to: 84 },
    { t: P.oboe, name: 'Theme', hand: 'right', from: 30, to: 50, pick: 'top' },
    { t: P.cellos, name: 'Chords', hand: 'left', from: 26, to: 84 },
    { t: P.flute, name: 'Theme', hand: 'right', from: 34, to: 86, pick: 'top' },
    // Louder: the horns' stabs and the trombones on the left hand, the tuba and basses below
    { t: P.hornsShort, name: 'Chords', hand: 'left', from: 34, to: 88 },
    { t: P.trombone, name: 'Chords', hand: 'left', from: 42, to: 88 },
    { t: P.violas, name: 'Chords', hand: 'left', from: 42, to: 84, pick: 'top' },
    { t: P.clarinet, name: 'Theme', hand: 'right', from: 42, to: 84, shift: -12, pick: 'bottom' },
    { t: P.tuba, name: 'Bass', hand: 'left', from: 50, to: 89, pick: 'bottom' },
    { t: P.basses, name: 'Bass', hand: 'left', from: 50, to: 89, pick: 'bottom' },
    { t: P.trumpet, name: 'Theme', hand: 'right', from: 50, to: 84, shift: -12, pick: 'top' },
    // The hush and the last chords: woodwinds and violins, then everyone
    { t: P.oboe, name: 'Last chords', hand: 'right', from: 84, to: 89 },
    { t: P.clarinet, name: 'Last chords', hand: 'right', from: 84, to: 89, shift: -12 },
    { t: P.tremolo, name: 'Roll', hand: 'left', from: 86, to: 88 },
    { t: P.trumpet, name: 'Last chords', hand: 'right', from: 88, to: 89, shift: -12 },
  ];
  const pick = (notes: ScoreNote[], how?: 'top' | 'bottom') => {
    if (!how) return notes;
    const byStart = new Map<number, ScoreNote[]>();
    for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n]);
    return [...byStart.values()].map((g) => g.reduce((a, b) => ((how === 'top' ? b.pitch > a.pitch : b.pitch < a.pitch) ? b : a)));
  };
  const clips: Clip[] = plan.map((o) => {
    const src = o.hand === 'right' ? right : left;
    const notes = shiftNotes(pick(notesBetween(src, q(o.from), q(o.to)), o.pick), 0, o.shift ?? 0);
    // Velocity rises faster than the curve, so pianissimo is really quiet and fortissimo hits
    return scoreClip(o.t, o.name, o.from, o.to - o.from, notes, (n) => curveAt(dyn, n.start) ** 1.4 * (o.vel ?? 1));
  });
  // The horns' opening F sharp, held under the fermata
  clips.push(scoreClip(P.horns, 'Opening', 1, 1, [{ pitch: pitchOf('F#3'), start: 0, dur: 3.8 }, { pitch: pitchOf('F#2'), start: 0, dur: 3.8 }], () => 0.5));
  // Timpani: B and F sharp on the strong beats once it's loud, the roll at the end, the last hits
  const timp: ScoreNote[] = [];
  for (let bar = 42; bar < 84; bar++) {
    const fsharp = bar % 4 === 1;
    timp.push({ pitch: pitchOf(fsharp ? 'F#2' : 'B2'), start: q(bar), dur: 0.5 });
    if (bar >= 50) timp.push({ pitch: pitchOf('F#2'), start: q(bar) + 2, dur: 0.5 });
  }
  for (let s = q(86); s < q(88); s += 0.125) timp.push({ pitch: pitchOf('B2'), start: s, dur: 0.125 });
  timp.push({ pitch: pitchOf('B2'), start: q(88), dur: 1 }, { pitch: pitchOf('B2'), start: q(88) + 1, dur: 1 });
  clips.push(scoreClip(P.timpani, 'Timpani', 42, 47, timp, (n) => curveAt(dyn, n.start) * (n.dur < 0.2 ? 0.75 : 1)));
  const drum: ScoreNote[] = [];
  for (let bar = 50; bar < 84; bar++) drum.push({ pitch: 36, start: q(bar), dur: 1 });
  drum.push({ pitch: 36, start: q(88) + 1, dur: 2 });
  clips.push(scoreClip(P.drum, 'Bass drum', 50, 39, drum, (n) => curveAt(dyn, n.start) * 0.9));
  const p = project(
    'Hall of the Mountain King (Grieg)',
    60,
    0,
    [1, 89],
    Object.values(parts),
    clips,
    [[1, 'Horns'], [2, 'The theme, pianissimo'], [18, 'Again, climbing'], [34, 'Crescendo'], [42, 'Brass'], [50, 'Faster, fortissimo'], [58, 'Faster still'], [84, 'Hush'], [86, 'Roll'], [88, 'The end']],
    glueGentle()
  );
  return {
    ...p,
    masterFx: { ...HALL, reverbDecay: 2.3 },
    // The fermata, then the march; an accelerando from a walk to a sprint, a jump at "Più vivo"
    tempoPoints: tempoMap([[2, 116], [18, 130, true], [34, 144, true], [42, 156, true], [49.9, 176, true], [50, 196], [58, 220, true], [84, 240, true]]),
  };
}

// ---------- Debussy: Clair de lune ----------

/**
 * Clair de lune, complete, on the concert grand in 9/8: the opening's quiet thirds with the soft
 * pedal's hush (very soft velocities, the recording's darker soft layers), the tempo rubato
 * section warming and pressing on, the rippling arpeggios of the "un poco mosso" swelling to the one
 * forte, then calm, and the return dying away (morendo) to the end. The pedal is changed with
 * each new bass note, the arpeggios held through on one pedal.
 */
function clairDeLune(): ProjectSnapshot {
  const upper = scorePart('clairUpper');
  const lower = scorePart('clairLower');
  const M = 4.5; // quarters in a 9/8 measure
  const mq = (m: number) => (m - 1) * M;
  const END = 72 * M;
  // Dynamics by measure (as velocity before the voice's balance)
  const dyn: Array<[number, number]> = [
    [1, 0.3], [9, 0.32], [10, 0.4], [11, 0.32], [15, 0.3], [19, 0.34], [23, 0.55], [24.5, 0.6], [25, 0.48], [27, 0.3], [29, 0.4], [31, 0.36],
    [33, 0.42], [35, 0.5], [37, 0.58], [41, 0.75], [42, 0.6], [42.9, 0.4], [43, 0.32], [51, 0.32], [59, 0.34], [65, 0.3], [66, 0.24], [72, 0.18], [73, 0.16],
  ].map(([m, v]) => [mq(m), v]);
  const at = (n: ScoreNote) => curveAt(dyn, n.start);
  // The melody (the right hand's top) sings over the rest; the arpeggios of 27 to 42 sit under it
  const topStarts = new Set<ScoreNote>();
  const byStart = new Map<number, ScoreNote[]>();
  for (const n of upper) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n]);
  for (const g of byStart.values()) topStarts.add(g.reduce((a, b) => (b.pitch > a.pitch ? b : a)));
  const vel = (n: ScoreNote, hand: 'upper' | 'lower') => {
    const base = at(n);
    if (hand === 'lower') return base * (n.start >= mq(27) && n.start < mq(43) ? 0.72 : 0.85);
    return base * (topStarts.has(n) ? 1.1 : 0.9);
  };
  const piano = track('Piano', 'realGrandPiano', { volume: 6, reverbSend: 0.36, fx: { peq: peq(lowCut(30), highShelf(7000, -2.5)), human: human(0.12) } });
  const velocity = new Map<ScoreNote, number>([...upper.map((n): [ScoreNote, number] => [n, vel(n, 'upper')]), ...lower.map((n): [ScoreNote, number] => [n, vel(n, 'lower')])]);
  const changes = bassChanges(lower, 1, 3);
  const bars = Math.ceil(END / 4) + 1;
  const p = project(
    'Clair de lune (Debussy)',
    58,
    0,
    [1, bars + 1],
    [piano],
    [scoreClip(piano, 'Clair de lune', 1, bars, [...upper, ...lower], (n) => velocity.get(n) ?? 0.3, { sustain: pedalLane(changes, 0, END + 2) })],
    [[1, 'Andante très expressif'], [1 + mq(15) / 4, 'Tempo rubato'], [1 + mq(27) / 4, 'Un poco mosso'], [1 + mq(37) / 4, 'En animant'], [1 + mq(43) / 4, 'Calmato'], [1 + mq(51) / 4, 'A tempo'], [1 + mq(66) / 4, 'Morendo']],
    glueGentle()
  );
  const bar = (m: number) => 1 + mq(m) / 4;
  return {
    ...p,
    meter: { num: 9, den: 8 },
    masterFx: { ...HALL, reverbDecay: 3 },
    tempoPoints: tempoMap([
      [bar(9), 60, true], [bar(13), 60], [bar(14.8), 52, true], [bar(15), 60], [bar(19), 60], [bar(24), 72, true], [bar(26.8), 60, true],
      [bar(27), 76], [bar(35), 80, true], [bar(41), 92, true], [bar(42.8), 68, true], [bar(43), 60], [bar(50), 60], [bar(50.9), 52, true],
      [bar(51), 58], [bar(66), 56, true], [bar(72.5), 44, true],
    ]),
  };
}

export const CLASSICS_BUILDERS = { canon, moonlight, prelude, mountainKing, clairDeLune };
