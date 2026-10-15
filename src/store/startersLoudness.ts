/**
 * How loud each starter song plays: a loudness target for each group of starters, and the
 * measured trim (in dB) that brings each starter to its group's target, so switching from one
 * starter to another doesn't jump in level. createStarter applies the trim (trimMix) as the last
 * step, after the recorded swaps, the swells and the glue.
 *
 * The trim turns the whole mix up or down without touching the balance inside it. Where the
 * master's OTT is on, it's the OTT's Out gain: a plain gain after the master compressor, before
 * the limiter. Elsewhere it's the faders of everything that plays into the master (see trimMix),
 * which the master compressor then hears. Either way the limiter hears it too, which is why the
 * trims are measured rather than worked out.
 *
 * Measuring: scripts/audio-check/starters-loudness.cjs renders every starter in full through the
 * app's own export path with the limiter passed through, runs the limiter's kernel over that, and
 * reads the integrated loudness (ITU-R BS.1770), the true peak and how much the limiter took off.
 * Run it after changing a starter's mix and copy its numbers here: the trim it suggests and, once
 * re-measured with that trim, the loudness. scripts/startersLoudness.test.mjs checks the table
 * covers every starter and lands within 1.5 LU of the targets.
 */
import type { ProjectSnapshot } from './project';
import type { Track } from './timelineTypes';

/**
 * Integrated loudness targets (LUFS) by starter group. Most music sits at -14, the level the
 * streaming services play at. Band and rhythm-game music a dB louder: their mixes are dense and
 * get there with little limiting. Orchestral, game, cartoon and chill music a dB under, to keep
 * their dynamics. The electronic, bass and hip-hop starters stay at -14 although the genres are
 * often mastered louder: their drums peak well over the rest, so louder would mean more than
 * about 4 dB of limiting. Nothing aims above -11 (MAX_STARTER_LOUDNESS): the master limiter holds
 * the peaks at -1 dBTP, and louder than that squashes the drums.
 */
export const GROUP_LOUDNESS: Readonly<Record<string, number>> = {
  'Bass Music': -14,
  Electronic: -14,
  'Artcore & Rhythm Games': -13,
  Band: -13,
  'Hip-Hop & Phonk': -14,
  'Pop & Jazz': -14,
  'Chill & World': -15,
  'Orchestral & Choir': -15,
  'Game Worlds': -15,
  'Game Moments': -15,
  'Anime & Cartoon': -15,
};

/** The gentle pieces (ambient, a title screen and its menu, a save room, a calm piano world) sit lower, at this. */
export const GENTLE_LOUDNESS = -19;

/** The starters meant to be gentle, whatever their group. */
export const GENTLE_STARTERS: ReadonlySet<string> = new Set(['ambient', 'title', 'saveRoom', 'quietWorld']);

/** The highest loudness any starter may aim for (LUFS). */
export const MAX_STARTER_LOUDNESS = -11;

/** A starter's loudness target (LUFS), from its id and group. */
export function starterLoudness(id: string, group: string): number {
  return GENTLE_STARTERS.has(id) ? GENTLE_LOUDNESS : (GROUP_LOUDNESS[group] ?? -14);
}

/**
 * Each starter's trim (dB) and the integrated loudness it measured with that trim (LUFS), as
 * described above. The comment on each line is how loud it measured before this table (and before
 * the mix fixes that came with it: the double bass, and the drums in Trap, UK Drill, Drift Phonk,
 * Dubstep and Riddim).
 */
export const STARTER_LEVELS: Readonly<Record<string, { trim: number; lufs: number }>> = {
  overworld: { trim: 0, lufs: -15.2 }, // -15.2
  dungeon: { trim: 3.5, lufs: -15.1 }, // -15.8
  village: { trim: 6.5, lufs: -15.3 }, // -21.5
  spacestation: { trim: 4, lufs: -14.8 }, // -18.8
  racing: { trim: 3.5, lufs: -14.9 }, // -18.3
  platformer: { trim: 4.5, lufs: -15 }, // -19.3
  boss: { trim: -0.5, lufs: -14.9 }, // -12.9
  stealth: { trim: 4.5, lufs: -14.9 }, // -19.4
  title: { trim: 3, lufs: -18.9 }, // -21.9
  puzzle: { trim: 4.5, lufs: -14.9 }, // -19
  shop: { trim: 5, lufs: -15.3 }, // -19.8
  openField: { trim: 1.5, lufs: -14.8 }, // -16.3
  cosmicWaltz: { trim: 0, lufs: -14.8 }, // -14.9
  bigBandCity: { trim: 5, lufs: -15.2 }, // -19.9
  quietWorld: { trim: 4, lufs: -18.7 }, // -22.7
  wildField: { trim: 5, lufs: -14.6 }, // -19.3
  underwaterWaltz: { trim: 5.5, lufs: -14.9 }, // -19.9
  desertBazaar: { trim: 5, lufs: -16 }, // -20.2
  fogTown: { trim: 6.5, lufs: -15.3 }, // -21.7
  countdownTown: { trim: -1, lufs: -14.8 }, // -13.9
  saveRoom: { trim: 5.5, lufs: -18.8 }, // -24.3
  cathedralBoss: { trim: 1, lufs: -15.2 }, // -16.2
  arenaMetal: { trim: 6, lufs: -15.4 }, // -21.2
  starlitCity: { trim: 5, lufs: -15.1 }, // -19.8
  farewellPiano: { trim: 2, lufs: -15.1 }, // -17.2
  sunsetDrive: { trim: 3.5, lufs: -15 }, // -18.4
  midnightCaper: { trim: 1, lufs: -15.2 }, // -16.1
  velvetInfiltration: { trim: -1.5, lufs: -14.9 }, // -13.6
  wanderersRoad: { trim: 4.5, lufs: -15 }, // -19.1
  meadowWaltz: { trim: -4, lufs: -15.2 }, // -11.9
  championShowdown: { trim: 1.5, lufs: -15.1 }, // -16.6
  ruinRequiem: { trim: 3, lufs: -14.9 }, // -17.7
  neonRitual: { trim: 6, lufs: -15.2 }, // -21.1
  dubstep: { trim: 10.5, lufs: -14.2 }, // -21.7
  house: { trim: 2.5, lufs: -13.7 }, // -16.3
  formulaRush: { trim: 3.5, lufs: -13.9 }, // -16.8
  trance: { trim: 4, lufs: -14.2 }, // -18.2
  dnb: { trim: 3.5, lufs: -14 }, // -17.5
  synthwave: { trim: 2.5, lufs: -14.1 }, // -16.5
  chiptune: { trim: 1.5, lufs: -13.7 }, // -15
  classical: { trim: -0.5, lufs: -15.2 }, // -14.8
  angelic: { trim: -1.5, lufs: -14.8 }, // -13.2
  cinematic: { trim: 3, lufs: -15.1 }, // -18.2
  epic: { trim: -2.5, lufs: -14.8 }, // -10.7
  horror: { trim: -1.5, lufs: -15.4 }, // -13.8
  rock: { trim: -1, lufs: -12.7 }, // -11.9
  metal: { trim: -1, lufs: -12.9 }, // -12
  pop: { trim: 1, lufs: -13.3 }, // -14.2
  funk: { trim: 0.5, lufs: -13.3 }, // -13.8
  jazz: { trim: 0, lufs: -13 }, // -13.1
  hiphop: { trim: 3.5, lufs: -13.2 }, // -16.2
  trap: { trim: 11.5, lufs: -14 }, // -19.1
  lofi: { trim: 5, lufs: -14.8 }, // -19.3
  ambient: { trim: 10.5, lufs: -18.9 }, // -29.3
  celtic: { trim: -1, lufs: -14.7 }, // -13.8
  tavern: { trim: 4, lufs: -14.9 }, // -18.3
  latin: { trim: -2, lufs: -14.8 }, // -13.1
  eastern: { trim: 4.5, lufs: -14.8 }, // -18.9
  artcore: { trim: 2, lufs: -12.7 }, // -13.7
  hardcore: { trim: 2, lufs: -13 }, // -15.1
  breakcore: { trim: 3.5, lufs: -13 }, // -16.5
  rpg: { trim: -0.5, lufs: -15.2 }, // -13.2
  metaldub: { trim: 0, lufs: -14 }, // -14
  melodicdub: { trim: 2.5, lufs: -13.8 }, // -16.3
  riddim: { trim: 11.5, lufs: -15 }, // -23.9
  futurebass: { trim: 2.5, lufs: -14.1 }, // -16.7
  phonk: { trim: 11.5, lufs: -13.9 }, // -22.7
  drill: { trim: 11.5, lufs: -14.3 }, // -22.2
  rage: { trim: 1.5, lufs: -14.2 }, // -15.7
  neosoul: { trim: 3.5, lufs: -14.1 }, // -17.4
  bedroom: { trim: 3, lufs: -14.2 }, // -17
  bossa: { trim: 5, lufs: -14.1 }, // -18.7
  citypop: { trim: 1, lufs: -14.3 }, // -15.1
  theatrical: { trim: 0.5, lufs: -13.8 }, // -14.3
  raprock: { trim: 0.5, lufs: -13.2 }, // -13.7
  mathrock: { trim: 1.5, lufs: -13.3 }, // -14.6
};

/** A starter's trim (dB); 0 for one not measured yet. */
export const starterTrimDb = (id: string): number => STARTER_LEVELS[id]?.trim ?? 0;

/** The faders' range (as parseProject keeps it). */
const VOLUME_MIN = -60;
const VOLUME_MAX = 6;
/** The OTT's Out gain range (dB; OTT_GAIN_MIN / MAX in timelineTypes.ts). */
const OTT_GAIN = 12;
/** The track compressor's makeup range (dB). */
const MAKEUP_MAX = 18;

/**
 * Turn the whole mix of `p` up or down by `db`, keeping its balance.
 *
 * With the master's OTT on, its Out gain moves: one gain after the master compressor.
 *
 * Otherwise the faders of what reaches the master move: tracks that play into the master bus
 * (their sends after the fader move with them, and those into a return track that also moves are
 * taken back, so the return isn't moved twice); tracks that play into a bus keep their faders (the
 * bus moves) but their shared reverb and delay sends, which skip the bus, move. Volume lanes move
 * with their fader (a lane stands in for it). A fader can't go past +6 dB, so what a track can't take there goes on its
 * compressor's makeup gain (switched on as a plain gain, ratio 1, where it was off).
 */
export function trimMix(p: ProjectSnapshot, db: number): ProjectSnapshot {
  if (!db) return p;
  const ott = p.master?.ott;
  if (p.master && ott?.on) {
    const outGain = Math.max(-OTT_GAIN, Math.min(OTT_GAIN, ott.outGain + db));
    return trimFaders({ ...p, master: { ...p.master, ott: { ...ott, outGain } } }, db - (outGain - ott.outGain));
  }
  return trimFaders(p, db);
}

/** The faders' part of trimMix. */
function trimFaders(p: ProjectSnapshot, db: number): ProjectSnapshot {
  if (!db) return p;
  const ids = new Set(p.tracks.map((t) => t.id));
  const intoBus = (t: Track) => !!t.output && ids.has(t.output) && t.output !== t.id;
  const moved = new Set(p.tracks.filter((t) => !intoBus(t)).map((t) => t.id));
  const gain = 10 ** (db / 20);
  const send = (v: number, by: number) => Math.min(1, Math.max(0, v * by));
  const tracks = p.tracks.map((t): Track => {
    if (!moved.has(t.id)) {
      return { ...t, reverbSend: send(t.reverbSend, gain), delaySend: send(t.delaySend, gain) };
    }
    const volume = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, t.volume + db));
    const over = t.volume + db - volume;
    const comp = t.fx.compressor;
    const fx =
      over > 0 && comp
        ? { ...t.fx, compressor: comp.on ? { ...comp, makeup: Math.min(MAKEUP_MAX, comp.makeup + over) } : { on: true, threshold: 0, ratio: 1, makeup: Math.min(MAKEUP_MAX, over) } }
        : t.fx;
    const automation = t.automation?.map((lane) =>
      lane.param === 'volume' ? { ...lane, points: lane.points.map((pt) => ({ ...pt, value: laneShift(pt.value, volume - t.volume) })) } : lane
    );
    const sends = t.sends?.map((s) => (s.pre || !moved.has(s.to) ? s : { ...s, level: send(s.level, 1 / gain) }));
    return { ...t, volume, fx, ...(automation ? { automation } : {}), ...(sends ? { sends } : {}) };
  });
  return { ...p, tracks };
}

/**
 * A volume lane's value moved by `db`: the lane's fader law puts gain at the 4th power of the value
 * (see automation.ts: dB = 6 + 80 log10(value)), so a dB step is a constant ratio of the value.
 */
function laneShift(value: number, db: number): number {
  if (value <= 0) return value;
  return Math.max(0, Math.min(1, value * 10 ** (db / 80)));
}
