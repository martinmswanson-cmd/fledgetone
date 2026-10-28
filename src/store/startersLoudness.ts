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
 * streaming services play at; the chill and world starters a dB under, to keep their dynamics.
 * Nothing aims above -11 (MAX_STARTER_LOUDNESS): the master limiter holds the peaks at -1 dBTP,
 * and louder than that squashes the drums.
 */
export const GROUP_LOUDNESS: Readonly<Record<string, number>> = {
  'Chill & World': -15,
};

/** The gentle pieces (ambient and the like) sit lower, at this. */
export const GENTLE_LOUDNESS = -19;

/** The starters meant to be gentle, whatever their group. */
export const GENTLE_STARTERS: ReadonlySet<string> = new Set(['ambient']);

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
  lofi: { trim: 3.5, lufs: -14.7 }, // -14.7
  ambient: { trim: 10.5, lufs: -19 }, // -18.6
  celtic: { trim: -1.5, lufs: -14.9 }, // -14.6
  tavern: { trim: 4, lufs: -15.3 }, // -14.9
  latin: { trim: -3, lufs: -15.1 }, // -14.2
  plaza: { trim: 6.5, lufs: -15 },
  mbiraMorning: { trim: 8.5, lufs: -15.3 },
  eastern: { trim: 4, lufs: -15.2 }, // -14.8
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
