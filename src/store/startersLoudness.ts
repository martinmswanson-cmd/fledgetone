/**
 * How loud each starter song plays: a loudness target for each group of starters, and the
 * measured trim (in dB) that brings each starter to its group's target, so switching from one
 * starter to another doesn't jump in level. createStarter applies the trim (trimMix) as the last
 * step, after the recorded swaps, the swells and the glue.
 *
 * The trim turns the whole mix up or down without touching the balance inside it: it's the
 * master's Level (see trimMix), a plain gain after the master compressor and the OTT, so it shows
 * in the Master panel and the faders and the OTT keep the starter's own settings. The limiter
 * after it hears it, which is why the trims are measured rather than worked out.
 *
 * Measuring: scripts/audio-check/starters-loudness.cjs renders every starter in full through the
 * app's own export path with the limiter passed through, runs the limiter's kernel over that, and
 * reads the integrated loudness (ITU-R BS.1770), the true peak and how much the limiter took off.
 * Run it after changing a starter's mix and copy its numbers here: the trim it suggests and, once
 * re-measured with that trim, the loudness. scripts/startersLoudness.test.mjs checks the table
 * covers every starter and lands within 1.5 LU of the targets.
 */
import type { ProjectSnapshot } from './project';
import { defaultMasterSettings, LEVEL_MAX, LEVEL_MIN } from './timelineTypes';

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
  // The classical pieces keep their wide dynamics
  Classics: -16,
};

/** The gentle pieces (ambient, a title screen and its menu, a save room, a calm piano world) sit lower, at this. */
export const GENTLE_LOUDNESS = -19;

/** The starters meant to be gentle, whatever their group. */
export const GENTLE_STARTERS: ReadonlySet<string> = new Set(['ambient', 'title', 'saveRoom', 'quietWorld', 'moonlight', 'clairDeLune']);


/** The highest loudness any starter may aim for (LUFS). */
export const MAX_STARTER_LOUDNESS = -11;

/** A starter's loudness target (LUFS), from its id and group. */
export function starterLoudness(id: string, group: string): number {
  return GENTLE_STARTERS.has(id) ? GENTLE_LOUDNESS : (GROUP_LOUDNESS[group] ?? -14);
}

/**
 * Each starter's trim (dB) and the integrated loudness it measured with that trim (LUFS), as
 * described above, all within 1 LU of the target. The comment on each line is how loud it measured
 * before the trims moved to the master Level (the faders or the OTT's Out gain carried them then)
 * and the held electric piano parts to the recording, with the same engine (the re-converted
 * recordings, the limiter run after the render).
 */
export const STARTER_LEVELS: Readonly<Record<string, { trim: number; lufs: number }>> = {
  overworld: { trim: 0, lufs: -15 }, // -14.9
  dungeon: { trim: 3, lufs: -15.1 }, // -14.6
  village: { trim: 6.5, lufs: -14.9 }, // -15.2
  spacestation: { trim: 4, lufs: -14.8 }, // -14.8
  racing: { trim: 3.5, lufs: -14.8 }, // -15.1
  platformer: { trim: 4.5, lufs: -14.8 }, // -15
  boss: { trim: -0.5, lufs: -15.1 }, // -15.3
  stealth: { trim: 4.5, lufs: -15 }, // -14.9
  title: { trim: 4, lufs: -19.1 }, // -20.1
  puzzle: { trim: 4, lufs: -14.7 }, // -14.4
  shop: { trim: 4.5, lufs: -15 }, // -15.2
  openField: { trim: 2.5, lufs: -14.9 }, // -15.8
  cosmicWaltz: { trim: 0, lufs: -14.8 }, // -14.8
  bigBandCity: { trim: 4.5, lufs: -15 }, // -14.7
  quietWorld: { trim: 3, lufs: -19 }, // -19.1
  wildField: { trim: 5.5, lufs: -15.1 }, // -15.9
  underwaterWaltz: { trim: 4.5, lufs: -14.9 }, // -14.4
  desertBazaar: { trim: 6, lufs: -15.4 }, // -16.1
  fogTown: { trim: 6, lufs: -14.7 }, // -15.8
  countdownTown: { trim: -2, lufs: -15.1 }, // -14.1
  saveRoom: { trim: 4, lufs: -19.2 }, // -19
  cathedralBoss: { trim: 2, lufs: -15.2 }, // -16.1
  arenaMetal: { trim: 5.5, lufs: -14.6 }, // -15.4
  starlitCity: { trim: 6, lufs: -14.7 }, // -16
  farewellPiano: { trim: 3.5, lufs: -15 }, // -16.4
  sunsetDrive: { trim: 3.5, lufs: -15 }, // -15.1
  midnightCaper: { trim: 0.5, lufs: -15 }, // -14.6
  velvetInfiltration: { trim: -2, lufs: -15.1 }, // -14.6
  wanderersRoad: { trim: 3.5, lufs: -15.1 }, // -14.5
  meadowWaltz: { trim: -4, lufs: -14.7 }, // -14.3
  championShowdown: { trim: 1.5, lufs: -15.1 }, // -15.3
  ruinRequiem: { trim: 4, lufs: -14.9 }, // -15.9
  cathedral: { trim: 3.9, lufs: -15 },
  afterHours: { trim: 8.1, lufs: -14.1 },
  plaza: { trim: 6, lufs: -15 },
  mbiraMorning: { trim: 8, lufs: -15.1 },
  neonRitual: { trim: 6, lufs: -15.3 }, // -15.3
  dubstep: { trim: 10.5, lufs: -14.2 }, // -14.2
  house: { trim: 2.5, lufs: -13.8 }, // -13.8
  trance: { trim: 4, lufs: -14.2 }, // -14.2
  dnb: { trim: 3.5, lufs: -14 }, // -14
  synthwave: { trim: 2.5, lufs: -14.1 }, // -14.1
  chiptune: { trim: 1, lufs: -14 }, // -13.7
  classical: { trim: 0.5, lufs: -15.1 }, // -16.1
  angelic: { trim: -2, lufs: -15 }, // -14.4
  cinematic: { trim: 3.5, lufs: -14.6 }, // -15.5
  epic: { trim: -2, lufs: -15.2 }, // -15.5
  horror: { trim: 0, lufs: -14.7 }, // -16.2
  rock: { trim: -2, lufs: -12.9 }, // -12.8
  metal: { trim: -2, lufs: -13.2 }, // -12.8
  pop: { trim: 2.5, lufs: -13.1 }, // -13.4
  funk: { trim: 0.5, lufs: -13.2 }, // -13.4
  jazz: { trim: -0.5, lufs: -12.8 }, // -12.3
  hiphop: { trim: 3.5, lufs: -12.8 }, // -13.1
  trap: { trim: 12, lufs: -13.8 }, // -14.1
  lofi: { trim: 5, lufs: -14.7 }, // -14.7
  ambient: { trim: 10.5, lufs: -18.6 }, // -18.6
  celtic: { trim: -1.5, lufs: -14.8 }, // -14.6
  tavern: { trim: 4, lufs: -14.9 }, // -14.9
  latin: { trim: -3, lufs: -14.9 }, // -14.2
  eastern: { trim: 4, lufs: -15.2 }, // -14.8
  artcore: { trim: 2, lufs: -13.2 }, // -12.8
  hardcore: { trim: 2, lufs: -13.2 }, // -13
  breakcore: { trim: 3.5, lufs: -13.2 }, // -13
  rpg: { trim: -1, lufs: -14.9 }, // -14.4
  metaldub: { trim: -0.5, lufs: -13.8 }, // -14.3
  melodicdub: { trim: 2.5, lufs: -13.7 }, // -13.9
  riddim: { trim: 12, lufs: -13.9 }, // -15
  futurebass: { trim: 2.5, lufs: -14.2 }, // -14.2
  phonk: { trim: 11.5, lufs: -14 }, // -14
  drill: { trim: 12, lufs: -14.1 }, // -14.4
  rage: { trim: 1.5, lufs: -14.2 }, // -14.2
  neosoul: { trim: 3.5, lufs: -13.9 }, // -14.1
  bedroom: { trim: 2.5, lufs: -13.9 }, // -14.5
  bossa: { trim: 5, lufs: -13.9 }, // -14.1
  citypop: { trim: 1, lufs: -14.1 }, // -14.3
  theatrical: { trim: 0.5, lufs: -13.7 }, // -13.7
  raprock: { trim: -0.5, lufs: -13.1 }, // -13.2
  mathrock: { trim: 1, lufs: -13 }, // -13.6
  // The Classics, measured with these trims (no older level to compare: new with the trims)
  canon: { trim: 5.3, lufs: -16 },
  moonlight: { trim: 5.5, lufs: -19 },
  prelude: { trim: 5.7, lufs: -16.1 },
  mountainKing: { trim: -3.6, lufs: -15.9 },
  clairDeLune: { trim: 3.6, lufs: -19.1 },
};

/** A starter's trim (dB); 0 for one not measured yet. */
export const starterTrimDb = (id: string): number => STARTER_LEVELS[id]?.trim ?? 0;

/**
 * Turn the whole mix of `p` up or down by `db`, keeping its balance: the master Level moves (a
 * plain gain after the master compressor, the OTT and the width, just before the limiter). The
 * faders and the OTT's Out gain stay where the starter's mix has them.
 */
export function trimMix(p: ProjectSnapshot, db: number): ProjectSnapshot {
  if (!db) return p;
  const master = p.master ?? defaultMasterSettings();
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, master.level + db));
  return { ...p, master: { ...master, level } };
}
