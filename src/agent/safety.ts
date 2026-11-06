/**
 * Cautions about a suggestion's levels, so nothing an agent suggests can jump out of the speakers
 * unannounced: a track turned up by more than TRACK_JUMP_DB, by its fader, its EQ, its inserts'
 * gains (compressor makeup, parametric EQ and multiband bands, a cut eased or taken away, an insert
 * that held it down switched off: the Filter by its response, the compressor and the Gate by how
 * far they hold it down, their lanes read along the song), its notes played harder or stacked, a
 * send over full level, or along its whole path (its buses and the master together, a volume lane
 * counted where there is one; a setting a lane plays over isn't counted, nor a fader rise the path
 * takes back); a track unmuted (only a note while a solo or a muted bus
 * still keeps it silent); a drive or saturation pushed hard, a delay fed back until it hardly dies
 * away; automation of any of those drawn high, redrawn higher anywhere along the song, or a lane
 * that held one down taken away (removed or emptied), all compared with what played there before
 * (a lane on an insert that was off, with nothing); a track heard again because a solo was cleared
 * or moved; the master Level, the Loud master's push or the OTT's gains up by more than
 * MASTER_JUMP_DB, the Loud master or the clipper switched on so they add more than MASTER_JUMP_DB
 * (the Loud master's push and sub tilt, the clipper's drive: less is only a note), the OTT
 * switched on so its quietest bars can come up by more than MASTER_JUMP_DB (ottLiftDb at full
 * depth, more the quieter the song is fed into it; a change of its in gain eased by its depth:
 * OTT_IN_EASE, OTT_IN_RISE_EASE; less is only a note), the OTT pushed much harder while on, the
 * Loud master, the OTT or the clipper switched off where it held the song down (a negative push,
 * tilt or gain; the clipper's ceiling), the Loud master's sub tilt or the clipper's ceiling raised
 * (driven harder too: one caution, the larger rise), and small rises on several of the master's
 * plain gains adding up to more than MASTER_JUMP_DB.
 * They are warnings on the suggestion's
 * card (the musician decides), never refusals; values beyond what the song can hold are already
 * brought into range by the ops (see ops.ts). And, as a catch-all for what the rules miss, the
 * words for what the studio's sound check measured (measuredRise, measuredCaution: whereHeard.ts
 * renders and measures), said when no caution was about level (each one marks whether it is:
 * safetyCautions, louderSaid), or when it measured clearly more than they said. Plain logic.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationParam, AutomationPoint, Clip, GlueStyle, PeqBand, Track, TrackFx } from '../store/timelineTypes';
import { durationToBars, normalizeMasterSettings } from '../store/timelineTypes';
import { audibleIds, busChain, isMixTrack, soloLit } from '../store/buses';
import { AUTOMATION, formatHz, LAST_BAR, laneValueAt, laneValueBefore, specOf, VOLUME_FLOOR_DB } from '../audio/automation';
import { logFrequencies, peqDb } from '../audio/peq';
import { positionWords, wordMeter } from './songDiff';
import type { MeterMap } from '../audio/tempoMap';
import { nm, plainNames } from './names';
import { maxOf } from '../support/minMax';
import { LIMITER_CEILING_DBTP } from '../audio/effects/limiter';

/** A track raised by more than this many dB gets a warning. */
export const TRACK_JUMP_DB = 6;
/** A Filter's response above flat by more than this is a resonant peak (less is passband ripple) */
const FILTER_PEAK_DB = 0.5;
/** The master raised by more than this many dB gets a warning. */
export const MASTER_JUMP_DB = 3;
/** A drive (Distortion amount, Saturation) raised by more than this gets a warning. */
export const DRIVE_JUMP = 0.4;
/** A delay fed back this much or more gets a warning: its echoes take a long time to die away. */
export const FEEDBACK_HIGH = 0.8;
/**
 * How much the master OTT can lift a song's quietest bar switched on at full depth with no gain,
 * dB, when the song is fed into it at OTT_LIFT_KNEE_DB or more (ottLiftDb): each band's gain goes
 * with its depth (ott.ts), so at depth 0 it lifts only by its gains. Measured on every starter as
 * it is, hotter, quieter and with one track alone: up to +7.1 LU in a bar (Lo-Fi 7.0 to 7.1,
 * Latin 6.3, Eastern 6.5, Tavern 5.5, Plaza 3.7; +8.6 on the Ambient starter fed 10 dB hotter).
 */
export const OTT_FULL_LIFT_DB = 7.2;
/** The OTT lifts a song fed in quieter than this (its faders' sum, ottLiftDb) by more, dB. */
export const OTT_LIFT_KNEE_DB = 0;
/**
 * How much more the OTT at full depth lifts a quiet bar for each dB the song is fed in under
 * OTT_LIFT_KNEE_DB, dB: its upward compression lifts what sits under its threshold by 0.75 dB a
 * dB, and the quiet bars of a quiet song sit further under it. Measured: the Ambient starter
 * (faders summing to -7 dB) +13.6 LU in a bar, 10 dB quieter (-17) +19.5, the Lo-Fi rain pad alone
 * (-26) +23.1, the Latin starter 12 dB quieter (-7) +9.7; the most of all, a dB a dB.
 */
export const OTT_LIFT_PER_DB = 1;
/** The most the OTT lifts any band at full depth, dB (ott.ts MAX_UP_DB): the lift is never counted for more. */
export const OTT_LIFT_MAX_DB = 24;
/**
 * How much louder a change of the master glue style (from, to) can make the song, dB: the most
 * measured, loudest bar or true peak, on the Lo-Fi starter as it is, a hotter mix of it and one
 * 20 dB quieter, and the Celtic, Eastern and Plaza starters (rounded up to the half dB). Less
 * compression lets the peaks it held down come back (Tight to Off: +3.8 dB true peak on the hot
 * mix); more lifts a quiet song by its makeup gain (Off to Tight: +2.3 LU on the quiet one). A
 * change the other way is never taken as a cut: on another song it can come out louder.
 */
export const GLUE_RISE_DB: Record<GlueStyle, Record<GlueStyle, number>> = {
  off: { off: 0, gentle: 0.5, standard: 1.5, punchy: 1.5, tight: 2.5 },
  gentle: { off: 1, gentle: 0, standard: 1, punchy: 1.5, tight: 2 },
  standard: { off: 2, gentle: 1.5, standard: 0, punchy: 1, tight: 1.5 },
  punchy: { off: 1.5, gentle: 1, standard: 0.5, punchy: 0, tight: 1 },
  tight: { off: 4, gentle: 3.5, standard: 2, punchy: 2.5, tight: 0 },
};
const GLUE_NAMES: Record<GlueStyle, string> = { off: 'Off', gentle: 'Gentle', standard: 'Standard', punchy: 'Punchy', tight: 'Tight' };
/**
 * How much of a cut by the master OTT's in gain its upward compression lifts back at full depth, at
 * the least (it goes with the depth: at depth 0 the in gain is a plain gain). Measured with cuts of
 * 6 and 12 dB at depth 0.5 and 1, on a quiet and a louder mix: 8 to 28% of the cut lifted back at
 * depth 0.5, 25 to 55% at depth 1; on the starters (6 dB at depth 1), 25 to 57%, the most on the
 * quiet Ambient one. The most of those, so a cut is never counted for more than it takes off.
 */
export const OTT_IN_EASE = 0.6;
/**
 * How much of a rise of the master OTT's in gain its compression takes off at full depth, at the
 * most (it goes with the depth: at depth 0 the in gain is a plain gain). Measured, 6 dB up at depth
 * 1 on the starters and their quieter and one-track mixes: 1.3 to 4.1 dB of it came through, 32
 * to 78% taken off. The least of those, so a rise is never counted for less than it adds.
 */
export const OTT_IN_RISE_EASE = 0.3;
/** What a change of the OTT's in gain does to the song at a depth, dB: a rise eased a little by the depth (OTT_IN_RISE_EASE), a cut more (OTT_IN_EASE). */
const ottIn = (change: number, depth: number) => change * (1 - (change < 0 ? OTT_IN_EASE : OTT_IN_RISE_EASE) * Math.max(0, Math.min(1, depth)));

/**
 * One caution, in plain words, and whether it warns about level (it comes out louder): `louder`,
 * the rise it states, dB (0: it gives no number). One that isn't about level (a delay fed back
 * until it hardly dies away) has none.
 */
export interface Caution {
  text: string;
  louder?: number;
}
/** A caution about level, stating a rise of `db` (0: no number). */
const lv = (text: string, db = 0): Caution => ({ text, louder: db });
/** A caution that isn't about level. */
const nl = (text: string): Caution => ({ text });

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${Math.round(v * 100)}%`;
type Fx = Record<string, { on?: boolean } & Record<string, unknown>>;
const fxOf = (t: Track | undefined): Fx => (t?.fx ?? {}) as unknown as Fx;
/** An insert's number while it's on (0 when off or absent). */
const onValue = (t: Track | undefined, insert: string, field: string): number => {
  const f = fxOf(t)[insert];
  return f?.on && typeof f[field] === 'number' ? (f[field] as number) : 0;
};
/** The parametric EQ is compared at these frequencies (and at its bands' own), where a song's level lives. */
const PEQ_FREQS = logFrequencies(96, 40, 16000);
/** A cut this deep is as good as silence there: deeper counts as this. */
const PEQ_FLOOR_DB = -60;
/** What an insert's band list holds while the insert is on (nothing while it's off or absent). */
const onBands = <B>(t: Track | undefined, insert: 'peq' | 'mbc'): B[] => {
  const f = fxOf(t)[insert] as { on?: boolean; bands?: B[] } | undefined;
  return f?.on && Array.isArray(f.bands) ? f.bands : [];
};
/**
 * How much more the parametric EQ lets through from `was` to `t`, at the frequency where that is
 * most, and what it does there afterwards (above 0: it boosts there). An EQ that's off passes all
 * at 0 dB.
 */
function peqRise(was: Track | undefined, t: Track): { rise: number; hz: number; after: number } {
  const then = onBands<PeqBand>(was, 'peq');
  const now = onBands<PeqBand>(t, 'peq');
  const at = (bands: PeqBand[], hz: number) => (bands.length ? Math.max(PEQ_FLOOR_DB, peqDb(bands, hz)) : 0);
  const freqs = [...PEQ_FREQS, ...[...then, ...now].map((b) => b.freq).filter((hz) => hz >= 40 && hz <= 16000)];
  let best = { rise: 0, hz: 1000, after: 0 };
  for (const hz of freqs) {
    const after = at(now, hz);
    const rise = after - at(then, hz);
    if (rise > best.rise) best = { rise, hz, after };
  }
  return best;
}
/** How much more the multiband compressor's makeup lifts one of its bands (each band against itself; a band off, bypassed or absent, or the insert off, at 0 dB). */
function mbcRise(was: Track | undefined, t: Track): number {
  const gains = (x: Track | undefined) => onBands<{ on?: boolean; gain?: number; bypass?: boolean }>(x, 'mbc').map((b) => (b.on === false || b.bypass ? 0 : (b.gain ?? 0)));
  const then = gains(was);
  const now = gains(t);
  let rise = 0;
  for (let i = 0; i < Math.max(then.length, now.length); i++) rise = Math.max(rise, (now[i] ?? 0) - (then[i] ?? 0));
  return rise;
}
/** The insert was on and is off now. */
const switchedOff = (was: Track | undefined, t: Track, insert: string) => !!fxOf(was)[insert]?.on && !fxOf(t)[insert]?.on;

/** The settings whose automation can make a track much louder or harsher, with how much is too much. */
type LaneLimit = { kind: 'db' | 'drive' | 'feedback' | 'send'; label: string };
const LANE_LIMITS: Partial<Record<string, LaneLimit>> = {
  volume: { kind: 'db', label: 'volume' },
  eqLow: { kind: 'db', label: 'EQ low' },
  eqMid: { kind: 'db', label: 'EQ mid' },
  eqHigh: { kind: 'db', label: 'EQ high' },
  'fx:compressor.makeup': { kind: 'db', label: 'compressor makeup' },
  'fx:distortion.amount': { kind: 'drive', label: 'distortion drive' },
  'fx:echo.feedback': { kind: 'feedback', label: 'delay feedback' },
  reverbSend: { kind: 'send', label: 'reverb send' },
  delaySend: { kind: 'send', label: 'delay send' },
};
/** The lane rule's limit for a lane (a send to a return, by its return's name), if it has one. (The Filter's, the compressor's threshold and ratio, and the Gate's lanes are read with their inserts: insertCautions.) */
function laneLimit(param: string, tracks: readonly Track[]): LaneLimit | undefined {
  if (param.startsWith('send:')) {
    const to = tracks.find((x) => x.id === param.slice(5));
    return { kind: 'send', label: `send to ${to ? nm(to.name) : 'a return'}` };
  }
  return LANE_LIMITS[param];
}

/** A send this many times louder (dB, from at least SEND_FLOOR) and over full level gets a warning: its reverb or delay comes out louder than the track itself. */
const SEND_FLOOR = 0.1;
/** Whether a send going from `then` to `now` (0 to 1 is full level; the reverb send goes up to 3) is a jump worth a warning. */
export const sendJumps = (then: number, now: number): boolean => now > 1 + 1e-9 && 20 * Math.log10(now / Math.max(SEND_FLOOR, then)) > TRACK_JUMP_DB + 1e-9;

/** Each stretch between two points is also read this many times along it, for where a curve bends. */
const STEPS_BETWEEN = 4;

/** One side of a lane's change: its points (null: no lane, so the setting rests at `rest`), in the setting's own units through `real`. */
interface LaneSide {
  points: readonly AutomationPoint[] | null;
  rest: number;
}

/**
 * The setting along the timeline before and after, in its own units, read where either lane has a
 * point, at the ends and along each stretch between (with the app's own lane reading and its
 * curves): at a point, as the lane arrives and as it leaves (an instant jump is both), in time order.
 */
/** The bars a setting is read at: where any of the lanes has a point, at the ends, and along each stretch between, in order. */
function sampleBars(lanes: ReadonlyArray<readonly AutomationPoint[] | null | undefined>): number[] {
  const marks = [1, LAST_BAR, ...lanes.flatMap((l) => (l ?? []).map((p) => p.bar))].filter((b) => b >= 1 && b <= LAST_BAR).sort((x, y) => x - y);
  const bars: number[] = [];
  for (const m of marks) {
    const prev = bars.at(-1);
    if (prev !== undefined && m - prev < 1e-9) continue;
    if (prev !== undefined) for (let k = 1; k < STEPS_BETWEEN; k++) bars.push(prev + ((m - prev) * k) / STEPS_BETWEEN);
    bars.push(m);
  }
  return bars;
}

function alongTimeline(then: LaneSide, now: LaneSide, real: (n: number) => number): Array<{ bar: number; then: number; now: number }> {
  const bars = sampleBars([then.points, now.points]);
  const read = (side: LaneSide, bar: number, arriving: boolean) => {
    if (!side.points?.length) return side.rest;
    return real((arriving ? laneValueBefore(side.points, bar) : laneValueAt(side.points, bar)) ?? 0);
  };
  const out: Array<{ bar: number; then: number; now: number }> = [];
  for (const bar of bars) for (const arriving of [true, false]) out.push({ bar, then: read(then, bar, arriving), now: read(now, bar, arriving) });
  return out;
}

/**
 * Cautions for the lanes of LANE_LIMITS on one track (a bus or a return too), going from `was` to
 * `t`: the setting compared before and after along the whole timeline, a lane on one side only
 * against the setting it replaces. A lane added, redrawn, removed or emptied all go through this one
 * rule; a lane on an insert that's off plays neither the lane nor its setting, and says nothing.
 */
function laneCautions(was: Track | undefined, t: Track, tracks: readonly Track[], meter: MeterMap | null, warned?: Set<string>): Caution[] {
  const out: Caution[] = [];
  const n = `${nm(t.name)}`;
  const lanes = (x: Track | undefined) => (x?.automation ?? []).filter((l) => laneLimit(l.param, tracks) && l.points.length);
  const params = [...new Set([...lanes(was), ...lanes(t)].map((l) => l.param))];
  for (const param of params) {
    const limit = laneLimit(param, tracks);
    if (!limit) continue;
    const oldLane = lanes(was).find((l) => l.param === param);
    const lane = lanes(t).find((l) => l.param === param);
    if (oldLane && lane && JSON.stringify(oldLane) === JSON.stringify(lane)) continue;
    const spec = specOf(param as AutomationParam, t, tracks);
    if (spec.insert && !fxOf(t)[spec.insert]?.on) continue;
    // Before: the old lane, else the setting as it was (a new track: as it starts); nothing at all
    // from an insert that was off
    const oldOn = !spec.insert || !!(was && fxOf(was)[spec.insert]?.on);
    // (a volume at or under the fader's floor is silence: a lane at its very bottom is -Infinity dB)
    const real = (v: number) => (limit.kind === 'db' ? Math.max(VOLUME_FLOOR_DB, v) : v);
    const then: LaneSide = oldOn ? { points: oldLane?.points ?? null, rest: real(spec.trackValue(was ?? t)) } : { points: null, rest: 0 };
    const now: LaneSide = { points: lane?.points ?? null, rest: real(spec.trackValue(t)) };
    const along = alongTimeline(then, now, (v) => real(spec.toReal(v)));
    const over = (s: { then: number; now: number }) =>
      limit.kind === 'db'
        ? s.now - s.then > TRACK_JUMP_DB + 1e-9
        : limit.kind === 'drive'
          ? s.now - s.then > DRIVE_JUMP + 1e-9
          : limit.kind === 'send'
            ? sendJumps(s.then, s.now)
            : s.now >= FEEDBACK_HIGH - 1e-9 && s.now > s.then + 1e-9;
    const first = along.find(over);
    if (!first) continue;
    warned?.add(param);
    const rise = maxOf(along.map((s) => s.now - s.then));
    // (the most it rises, for a drive's words: from what to what)
    const most = along.reduce((m, s) => (s.now - s.then > m.now - m.then ? s : m), first);
    const top = maxOf(along.filter(over).map((s) => s.now));
    const from = positionWords(first.bar, meter);
    const what = `the ${limit.label} automation on ${n}`;
    if (!lane) {
      // Taken away (removed, or left with no points): it rests at its setting
      if (limit.kind === 'db') out.push(lv(`This takes away ${what}: it held it down, and it comes up by as much as ${r1(rise)} dB. Turn your speakers down before you listen.`, rise));
      if (limit.kind === 'drive') out.push(lv(`This takes away ${what}: it held it down, and it is driven at ${pct(now.rest)} all along.`));
      if (limit.kind === 'feedback') out.push(nl(`This takes away ${what}: it feeds back at ${pct(now.rest)} all along.`));
      if (limit.kind === 'send') out.push(lv(`This takes away ${what}: it sends at ${pct(now.rest)} all along, and what it sends to comes out much louder. Turn your speakers down before you listen.`));
    } else if (!oldLane) {
      // Drawn where there was none: measured from the setting it replaces
      if (limit.kind === 'db') out.push(lv(`On ${n}, the ${limit.label} automation goes up to ${r1(rise)} dB over what it was.`, rise));
      if (limit.kind === 'drive') out.push(lv(`On ${n}, the ${limit.label} automation pushes it to ${pct(top)}.`));
      if (limit.kind === 'feedback') out.push(nl(`On ${n}, the ${limit.label} automation feeds it back at up to ${pct(top)}.`));
      if (limit.kind === 'send') out.push(lv(`On ${n}, the ${limit.label} automation sends at up to ${pct(top)}.`));
    } else {
      // Redrawn: louder somewhere along the song than it was there
      if (limit.kind === 'db') out.push(lv(`This redraws ${what}: it comes up by as much as ${r1(rise)} dB from ${from}. Turn your speakers down before you listen.`, rise));
      if (limit.kind === 'drive') out.push(lv(`This redraws ${what}: it is driven much harder from ${from} (as much as ${pct(most.then)} to ${pct(most.now)} drive): it gets louder and harsher.`));
      if (limit.kind === 'feedback') out.push(nl(`This redraws ${what}: it feeds back at up to ${pct(top)} from ${from}: its echoes build up and take a long time to die away.`));
      if (limit.kind === 'send') out.push(lv(`This redraws ${what}: it sends at up to ${pct(top)} from ${from}, and what it sends to comes out much louder. Turn your speakers down before you listen.`));
    }
  }
  return out;
}

/**
 * A track's or bus's level, dB: where it has a volume lane, the lane plays and not the fader, so
 * the lane's highest point (how loud it gets); else its fader.
 */
function levelOf(t: Track): number {
  const lane = t.automation?.find((l) => l.param === 'volume' && l.points.length);
  if (!lane) return t.volume;
  return Math.max(VOLUME_FLOOR_DB, AUTOMATION.volume.toReal(maxOf(lane.points.map((p) => p.value))));
}

/** A track's level along its whole way out: its own and its buses' (levelOf: a volume lane where there is one; the master is added by the caller). */
function pathDb(t: Track, tracks: readonly Track[]): number {
  return levelOf(t) + busChain(t, tracks).reduce((sum, b) => sum + levelOf(b), 0);
}

/**
 * How much the master OTT at full depth can lift the song's quietest bar, dB, from how loud the
 * song is fed into it, read without a listen: the sum (in power) of the levels along the way out
 * of the tracks heard that have clips (pathDb; a song with none as one fed in at nothing).
 * OTT_FULL_LIFT_DB fed in at OTT_LIFT_KNEE_DB or more, OTT_LIFT_PER_DB more for each dB under it,
 * at most OTT_LIFT_MAX_DB. Its depth scales it (measured: in step with the depth, 0.25 to 1).
 */
export function ottLiftDb(song: ProjectSnapshot): number {
  const heard = audibleIds(song.tracks);
  const playing = new Set(song.clips.map((c) => c.trackId));
  const power = song.tracks.filter((t) => !isMixTrack(t) && heard.has(t.id) && playing.has(t.id)).reduce((sum, t) => sum + 10 ** (pathDb(t, song.tracks) / 10), 0);
  const fed = power > 0 ? 10 * Math.log10(power) : -Infinity;
  return Math.min(OTT_LIFT_MAX_DB, OTT_FULL_LIFT_DB + OTT_LIFT_PER_DB * Math.max(0, OTT_LIFT_KNEE_DB - fed));
}

/** The lanes that drive each setting of the inserts that can hold a track down (the Filter, the compressor, the Gate). */
const INSERT_LANES = {
  filter: { cutoff: 'filterCutoff', resonance: 'filterResonance' },
  compressor: { threshold: 'fx:compressor.threshold', ratio: 'fx:compressor.ratio', makeup: 'fx:compressor.makeup' },
  gate: { depth: 'fx:gate.depth', length: 'fx:gate.length' },
} as const satisfies Partial<Record<keyof TrackFx, Record<string, AutomationParam>>>;
type HoldInsert = keyof typeof INSERT_LANES;
/** An insert's settings at one moment (null: it's off, or not there, so it passes everything as it is). */
type Settings = Record<string, number | string> | null;

/**
 * One of those inserts along the timeline before and after: its settings read where any of its
 * lanes (on either side) has a point, at the ends and along each stretch between, each setting
 * from its lane where it has one with points (the lane plays, not the setting), as the app reads
 * them, arriving at a point and leaving it. `lanes`: whether any lane drives it, on either side.
 */
function insertAlong(was: Track | undefined, t: Track, insert: HoldInsert, tracks: readonly Track[]): { lanes: boolean; along: Array<{ bar: number; then: Settings; now: Settings }> } {
  const fields = Object.entries(INSERT_LANES[insert]) as Array<[string, AutomationParam]>;
  const lanesOf = (x: Track | undefined) => fields.map(([field, param]) => ({ field, param, points: x?.automation?.find((l) => l.param === param && l.points.length)?.points ?? null }));
  const [thenLanes, nowLanes] = [lanesOf(was), lanesOf(t)];
  const read = (x: Track | undefined, lanes: ReturnType<typeof lanesOf>, bar: number, arriving: boolean): Settings => {
    const f = fxOf(x)[insert];
    if (!x || !f?.on) return null;
    const out: Record<string, number | string> = { ...(f as Record<string, number | string>) };
    for (const l of lanes) {
      if (!l.points) continue;
      const v = arriving ? laneValueBefore(l.points, bar) : laneValueAt(l.points, bar);
      if (v !== null) out[l.field] = specOf(l.param, x, tracks).toReal(v);
    }
    return out;
  };
  const bars = sampleBars([...thenLanes, ...nowLanes].map((l) => l.points));
  const along: Array<{ bar: number; then: Settings; now: Settings }> = [];
  for (const bar of bars) for (const arriving of [true, false]) along.push({ bar, then: read(was, thenLanes, bar, arriving), now: read(t, nowLanes, bar, arriving) });
  return { lanes: [...thenLanes, ...nowLanes].some((l) => l.points), along };
}

/** The Filter's first stage at 24 dB per octave: a 4th-order Butterworth pair's first Q (lightFx.ts createLightFilter). */
const BUTTERWORTH_Q1 = 1 / (2 * Math.cos(Math.PI / 8));
/**
 * The Filter's low-pass or high-pass as parametric EQ bands, as it plays (lightFx.ts
 * createLightFilter): a low-pass as a high cut, a high-pass as a low cut; at 24 dB per octave two
 * stages, the first a Butterworth one and the second carrying the resonance. (A band-pass is no
 * cut and no boost: bandpassDb.)
 */
function filterBands(f: Settings): PeqBand[] {
  if (!f || (f.type !== 'lowpass' && f.type !== 'highpass')) return [];
  const cutoff = Number(f.cutoff);
  const q = Number(f.resonance);
  const qs = Number(f.slope) === 24 ? [BUTTERWORTH_Q1, q / BUTTERWORTH_Q1] : [q];
  return qs.map((stageQ) => ({ on: true, type: f.type === 'lowpass' ? 'highcut' : 'lowcut', freq: cutoff, gain: 0, q: stageQ }));
}
/** The sample rate the Filter's response is worked out at (as the parametric EQ's, peq.ts). */
const FILTER_RATE = 48000;
/**
 * The Filter's band-pass at `hz`, dB, as it plays (lightFx.ts createLightFilter): Web Audio's
 * band-pass biquad, 0 dB at its centre and less on either side (about 1/sqrt(1 + Q^2 (f/f0 -
 * f0/f)^2) a stage), never a boost however high the resonance (its Q); at 24 dB per octave two
 * such stages, both at the resonance.
 */
function bandpassDb(f: Settings, hz: number): number {
  if (!f) return 0;
  const f0 = Math.min(Number(f.cutoff), FILTER_RATE / 2 - 1);
  const q = Math.max(1e-4, Number(f.resonance));
  const w0 = (2 * Math.PI * f0) / FILTER_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const [b0, b2, a0, a1, a2] = [alpha, -alpha, 1 + alpha, -2 * Math.cos(w0), 1 - alpha];
  const w = (2 * Math.PI * Math.min(hz, FILTER_RATE / 2)) / FILTER_RATE;
  const num = [b0 + b2 * Math.cos(2 * w), -b2 * Math.sin(2 * w)];
  const den = [a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), -(a1 * Math.sin(w) + a2 * Math.sin(2 * w))];
  const stage = Math.min(0, 10 * Math.log10(Math.max(1e-30, (num[0] ** 2 + num[1] ** 2) / Math.max(1e-30, den[0] ** 2 + den[1] ** 2))));
  return Number(f.slope) === 24 ? 2 * stage : stage;
}
/** The Filter's response at `hz`, dB (0 while it's off or absent; a cut this deep as PEQ_FLOOR_DB). */
function filterDb(f: Settings, hz: number): number {
  if (!f) return 0;
  if (f.type === 'bandpass') return Math.max(PEQ_FLOOR_DB, bandpassDb(f, hz));
  const bands = filterBands(f);
  return bands.length ? Math.max(PEQ_FLOOR_DB, peqDb(bands, hz)) : 0;
}
/** The level a compressor's held-down track is estimated at, dBFS: what it takes off is worked out for a track this loud. */
const NOMINAL_LEVEL_DB = -12;
/** How far an insert holds a track down at one moment, dB (more: quieter; below 0: it lifts it). The Filter's is per frequency: filterRise. */
function holdDb(insert: 'compressor' | 'gate', f: Settings): number {
  if (!f) return 0;
  if (insert === 'compressor') return Math.max(0, NOMINAL_LEVEL_DB - Number(f.threshold)) * (1 - 1 / Math.max(1, Number(f.ratio))) - Number(f.makeup);
  // The Gate: open for `length` of each step, `depth` of the way shut for the rest (in power, over a step)
  const depth = Math.min(1, Math.max(0, Number(f.depth)));
  const length = Math.min(1, Math.max(0, Number(f.length)));
  return -10 * Math.log10(Math.max(1e-6, length + (1 - length) * (1 - depth) ** 2));
}

/**
 * Cautions for the Filter, the compressor and the Gate on one track, going from `was` to `t`:
 * how far each holds it down, compared before and after along the whole timeline (their lanes
 * read where they have points), and a warning where it holds it down by more than TRACK_JUMP_DB
 * less: switched off, opened up, eased, or a lane of it redrawn. The Filter by its response, as
 * the parametric EQ (at the frequency where it lets the most more through); the compressor at a
 * nominal level (a guess: how far it really holds the track down depends on how loud the track
 * is, so it says no number), less its makeup (said on its own when that's what went up:
 * `makeupSaid`); the Gate by how much of each step it lets through.
 */
function insertCautions(was: Track | undefined, t: Track, tracks: readonly Track[], meter: MeterMap | null, makeupSaid: boolean): Caution[] {
  const out: Caution[] = [];
  const n = `${nm(t.name)}`;
  const lanesJson = (x: Track | undefined, insert: HoldInsert) => JSON.stringify(Object.values(INSERT_LANES[insert]).map((param) => x?.automation?.find((l) => l.param === param && l.points.length) ?? null));
  for (const insert of Object.keys(INSERT_LANES) as HoldInsert[]) {
    // (nothing of it changed: nothing to say)
    if (was && JSON.stringify(fxOf(was)[insert] ?? null) === JSON.stringify(fxOf(t)[insert] ?? null) && lanesJson(was, insert) === lanesJson(t, insert)) continue;
    if (!was || (!fxOf(was)[insert]?.on && !fxOf(t)[insert]?.on)) continue;
    if (insert === 'compressor' && makeupSaid) continue;
    const { lanes, along } = insertAlong(was, t, insert, tracks);
    const off = switchedOff(was, t, insert);
    const from = (bar: number) => (lanes ? ` from ${positionWords(bar, meter)}` : '');
    if (insert === 'filter') {
      // The response, at the frequencies where a song's level lives and at the cutoffs themselves
      const at = filterDb;
      let best = { rise: 0, hz: 1000, after: 0, bar: 1 };
      // (Its own resonant peak, wherever that is: a pass-through's ripple far from the cutoff is no peak)
      let peak = { db: 0, hz: 1000 };
      for (const s of along) {
        const cutoffs = [s.then, s.now].flatMap((f) => (f ? [Number(f.cutoff)] : [])).filter((hz) => hz >= 40 && hz <= 16000);
        for (const hz of [...PEQ_FREQS, ...cutoffs]) {
          const after = at(s.now, hz);
          const rise = after - at(s.then, hz);
          if (rise > best.rise + 1e-9) best = { rise, hz, after, bar: s.bar };
          if (after > peak.db + 1e-9) peak = { db: after, hz };
        }
      }
      if (best.rise <= TRACK_JUMP_DB + 1e-9) continue;
      const first = along.find((s) => [...PEQ_FREQS].some((hz) => at(s.now, hz) - at(s.then, hz) > TRACK_JUMP_DB + 1e-9))?.bar ?? best.bar;
      if (off) out.push(lv(`This switches off the Filter on ${n}: it held it down, and around ${formatHz(best.hz)} it comes up by ${r1(best.rise)} dB. Turn your speakers down before you listen.`, best.rise));
      else if (peak.db > FILTER_PEAK_DB && Math.abs(Math.log2(peak.hz / best.hz)) < 1 / 3) out.push(lv(`On ${n}, the Filter peaks${from(first)}: around ${formatHz(best.hz)} it comes up by ${r1(best.rise)} dB. Turn your speakers down before you listen.`, best.rise));
      else if (peak.db > FILTER_PEAK_DB) out.push(lv(`On ${n}, the Filter lets much more through${from(first)}: around ${formatHz(best.hz)} it comes up by ${r1(best.rise)} dB, and it peaks around ${formatHz(peak.hz)}, ${r1(peak.db)} dB above the rest. Turn your speakers down before you listen.`, best.rise));
      else out.push(lv(`On ${n}, the Filter lets much more through${from(first)}: around ${formatHz(best.hz)} it comes up by ${r1(best.rise)} dB. Turn your speakers down before you listen.`, best.rise));
      continue;
    }
    const rises = along.map((s) => ({ bar: s.bar, rise: holdDb(insert, s.then) - holdDb(insert, s.now) }));
    const first = rises.find((s) => s.rise > TRACK_JUMP_DB + 1e-9);
    if (!first) continue;
    const most = maxOf(rises.map((s) => s.rise));
    if (insert === 'compressor') {
      if (off) out.push(lv(`This switches off the compressor on ${n}: it held it down, and it comes up much louder. Turn your speakers down before you listen.`));
      else out.push(lv(`On ${n}, the compressor holds it down much less${from(first.bar)}: it comes up much louder. Turn your speakers down before you listen.`));
    } else if (off) out.push(lv(`This switches off the Gate on ${n}: it held it down, and it comes up by about ${r1(most)} dB. Turn your speakers down before you listen.`, most));
    else out.push(lv(`On ${n}, the Gate chops it much less${from(first.bar)}: it comes up by about ${r1(most)} dB. Turn your speakers down before you listen.`, most));
  }
  return out;
}

/** The bars (index 0 is bar 1) up to LAST_BAR. */
const BAR_COUNT = Math.ceil(LAST_BAR);
/**
 * How hard a track's notes play in each bar (index 0 is bar 1): at its fullest moment there, the
 * sum of the squares of the velocities of the notes sounding at once (a note's level goes with its
 * velocity; notes played together add up in power). 0: no note there.
 */
function noteLoad(trackId: string, clips: readonly Clip[]): Float64Array {
  const events: Array<[at: number, change: number]> = [];
  for (const c of clips) {
    if (c.trackId !== trackId || c.audio) continue;
    const end = c.startBar + c.lengthBars;
    for (const note of c.notes) {
      // (a note before the clip's start or past its end is hidden, and none rings past the clip)
      if (note.startOffset < 0 || note.startOffset >= c.lengthBars) continue;
      const start = c.startBar + note.startOffset;
      const stop = Math.min(end, start + durationToBars(note.duration));
      const v = Math.max(0, note.velocity);
      if (stop > start && v > 0) events.push([start, v * v], [stop, -v * v]);
    }
  }
  // (a note that ends where another starts isn't sounding with it)
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const load = new Float64Array(BAR_COUNT);
  let sum = 0;
  for (let i = 0; i < events.length; i++) {
    sum += events[i][1];
    const next = events[i + 1]?.[0];
    if (next === undefined || next - events[i][0] < 1e-9 || sum < 1e-9) continue;
    for (let bar = Math.max(1, Math.floor(events[i][0])); bar < next && bar <= BAR_COUNT; bar++) load[bar - 1] = Math.max(load[bar - 1], sum);
  }
  return load;
}

/**
 * A warning for a track whose notes play much harder (velocities raised, the same notes stacked,
 * copies of a clip piled on one bar): bar by bar, its notes' load (noteLoad) after against before
 * there, or against its fullest bar before where that's more (so a part written into bars it was
 * quiet or silent in, no harder than it plays elsewhere, isn't a jump), in dB. A track that had
 * no notes says nothing (it plays a new part).
 */
function notesCaution(was: Track, t: Track, before: readonly Clip[], after: readonly Clip[], meter: MeterMap | null): Caution | null {
  const then = noteLoad(was.id, before);
  const fullest = maxOf([...then]);
  if (!(fullest > 0)) return null;
  const now = noteLoad(t.id, after);
  let first = -1;
  let most = 0;
  for (let i = 0; i < now.length; i++) {
    if (!(now[i] > 0)) continue;
    const rise = 10 * Math.log10(now[i] / Math.max(then[i], fullest));
    if (rise > most) most = rise;
    if (first < 0 && rise > TRACK_JUMP_DB + 1e-9) first = i;
  }
  if (first < 0) return null;
  return lv(`On ${nm(t.name)}, the notes play much harder (louder notes, or more of them at once) from ${positionWords(first + 1, meter)}: it comes up by about ${r1(most)} dB. Turn your speakers down before you listen.`, most);
}

/** Up to three words joined with commas and "and", the rest counted ("A, B, C and 2 more"). */
function listOf(words: string[]): string {
  const shown = words.slice(0, 3);
  if (words.length > 3) return `${shown.join(', ')} and ${words.length - 3} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
}

/** An unmuted track this far under the loudest other track is only mentioned, not warned about. */
export const QUIET_UNDER_MIX_DB = 12;

/**
 * The warnings for going from `before` to `after` (an empty list: nothing to say). Things worth
 * knowing but no cause for care (a quiet track unmuted) go in `notes`, when it's given.
 */
export function checkSafety(before: ProjectSnapshot, after: ProjectSnapshot, notes?: string[]): string[] {
  const own: string[] = [];
  const out = checkSafetyMarked(before, after, own).map(plainNames);
  notes?.push(...own.map(plainNames));
  return out;
}

/** checkSafety with each name in the words marked (names.ts), for a card to show them apart. */
export function checkSafetyMarked(before: ProjectSnapshot, after: ProjectSnapshot, notes?: string[]): string[] {
  return safetyCautions(before, after, notes).map((c) => c.text);
}

/**
 * The largest rise the cautions about level state, dB (one that gives no number counts as
 * TRACK_JUMP_DB, the line it crossed), or null when none of them is about level: a sound check
 * that finds the song much louder says so too when nothing was said about level, or when it
 * measured clearly more than this (measuredCaution).
 */
export function louderSaid(cautions: readonly Caution[]): number | null {
  const said = cautions.filter((c) => c.louder !== undefined).map((c) => c.louder!);
  return said.length ? maxOf(TRACK_JUMP_DB, said) : null;
}

/** checkSafetyMarked's cautions with what each says about level (Caution). */
export function safetyCautions(before: ProjectSnapshot, after: ProjectSnapshot, notes?: string[]): Caution[] {
  const out: Caution[] = [];
  // The loudest audible track's level along its way out, to tell a quiet track from a loud one
  const audible = after.tracks.filter((t) => !isMixTrack(t) && !t.isMuted);
  const old = new Map(before.tracks.map((t) => [t.id, t]));
  const a = normalizeMasterSettings(before.master);
  const b = normalizeMasterSettings(after.master);
  /** Tracks louder along their whole path, and by how much */
  const louder: Array<[string, number]> = [];
  // Who is heard, by the app's own rule (a solo, a muted bus)
  const heardBefore = audibleIds(before.tracks);
  const heardAfter = audibleIds(after.tracks);

  // The clips as they were and are, and the tracks whose notes changed (an op leaves an untouched clip the very same object)
  const clipsBefore = new Set(before.clips);
  const clipsAfter = new Set(after.clips);
  const notesMoved = new Set([...after.clips.filter((c) => !clipsBefore.has(c)), ...before.clips.filter((c) => !clipsAfter.has(c))].map((c) => c.trackId));

  for (const t of after.tracks) {
    const was = old.get(t.id);
    const n = `${nm(t.name)}`;
    /** It has a lane with points for `param`: the lane plays, not the setting (trackStrip.ts), so the setting's own jump isn't heard. */
    const laneOwns = (param: AutomationParam) => !!t.automation?.some((l) => l.param === param && l.points.length);
    // The whole way out, its buses and the master together (levelOf: a volume lane where there is one)
    const pathNow = pathDb(t, after.tracks) + b.level;
    const pathThen = (was ? pathDb(was, before.tracks) : 0) + a.level;
    // A new track starts at 0 dB, so one set louder is measured from there; the fader's jump is
    // said only where it's heard: not under a volume lane, nor taken back by its buses or the master
    const from = was ? was.volume : 0;
    const ownJump = laneOwns('volume') ? 0 : t.volume - from;
    if (ownJump > TRACK_JUMP_DB + 1e-9 && pathNow - pathThen > TRACK_JUMP_DB + 1e-9) out.push(lv(`${n} goes up by ${r1(ownJump)} dB. Turn your speakers down before you listen.`, ownJump));
    if (was?.isMuted && !t.isMuted && !heardAfter.has(t.id)) {
      // (still not heard: a solo elsewhere, or a muted bus it plays into, keeps it silent)
      const lit = soloLit(after.tracks);
      notes?.push(`This unmutes ${n}, but it stays silent: ${lit && !lit.has(t.id) ? 'other tracks are soloed' : 'a bus it plays into is muted'}.`);
    } else if (was?.isMuted && !t.isMuted) {
      const others = audible.filter((x) => x.id !== t.id).map((x) => pathDb(x, after.tracks));
      const quiet = others.length > 0 && pathDb(t, after.tracks) <= maxOf(others) - QUIET_UNDER_MIX_DB;
      if (quiet) notes?.push(`This unmutes ${n}, quietly under the rest of the mix (at ${r1(levelOf(t))} dB).`);
      else out.push(lv(`This unmutes ${n} (at ${r1(levelOf(t))} dB): it will be heard again.`));
    }
    // Along the whole path: its buses and the master together (what it adds on its own is said above)
    if (!isMixTrack(t) && !t.isMuted) {
      // (not when it's all its own fader's or volume lane's, or all the master's: those are said on their own)
      const ownLevel = levelOf(t) - (was ? levelOf(was) : 0);
      if (pathNow - pathThen > TRACK_JUMP_DB + 1e-9 && ownJump <= TRACK_JUMP_DB + 1e-9 && ownLevel <= TRACK_JUMP_DB + 1e-9 && pathNow - pathThen - (b.level - a.level) > 1e-9) louder.push([t.name, pathNow - pathThen]);
    }
    // The EQ and the inserts' gains (not a setting a lane plays over: the lane rule below compares that)
    for (const band of ['low', 'mid', 'high'] as const) {
      const lift = t.eq[band] - (was?.eq[band] ?? 0);
      const param = `eq${band.charAt(0).toUpperCase()}${band.slice(1)}` as AutomationParam;
      if (lift > TRACK_JUMP_DB + 1e-9 && !laneOwns(param)) out.push(lv(`On ${n}, the EQ ${band} goes up by ${r1(lift)} dB.`, lift));
    }
    const makeup = onValue(t, 'compressor', 'makeup') - onValue(was, 'compressor', 'makeup');
    const makeupJumps = makeup > TRACK_JUMP_DB + 1e-9 && !laneOwns('fx:compressor.makeup');
    if (makeupJumps) out.push(lv(`On ${n}, the compressor makes up ${r1(makeup)} dB more.`, makeup));
    const peq = peqRise(was, t);
    if (peq.rise > TRACK_JUMP_DB + 1e-9) {
      if (switchedOff(was, t, 'peq')) out.push(lv(`This switches off the parametric EQ on ${n}: it held it down, and around ${formatHz(peq.hz)} it comes up by ${r1(peq.rise)} dB. Turn your speakers down before you listen.`, peq.rise));
      else if (peq.after > 1e-6) out.push(lv(`On ${n}, the parametric EQ lifts a band by ${r1(peq.rise)} dB more.`, peq.rise));
      else out.push(lv(`On ${n}, the parametric EQ cuts less: around ${formatHz(peq.hz)} it comes up by ${r1(peq.rise)} dB. Turn your speakers down before you listen.`, peq.rise));
    }
    const mbc = mbcRise(was, t);
    if (mbc > TRACK_JUMP_DB + 1e-9) {
      if (switchedOff(was, t, 'mbc')) out.push(lv(`This switches off the multiband compressor on ${n}: its bands held it down, and it comes up by as much as ${r1(mbc)} dB. Turn your speakers down before you listen.`, mbc));
      else out.push(lv(`On ${n}, the multiband compressor lifts a band by ${r1(mbc)} dB more.`, mbc));
    }
    // Drives and feedback
    for (const [insert, field, label] of [['distortion', 'amount', 'Distortion'], ['saturate', 'amount', 'Saturation']] as const) {
      const now = onValue(t, insert, field);
      const then = onValue(was, insert, field);
      if (now - then <= DRIVE_JUMP + 1e-9) continue;
      if (then === 0) out.push(lv(`This turns on ${label} on ${n} at ${pct(now)} drive: it gets louder and harsher.`));
      else out.push(lv(`On ${n}, ${label} is driven much harder (${pct(then)} to ${pct(now)} drive): it gets louder and harsher.`));
    }
    const feedback = onValue(t, 'echo', 'feedback');
    if (feedback >= FEEDBACK_HIGH - 1e-9 && feedback > onValue(was, 'echo', 'feedback') + 1e-9) out.push(nl(`On ${n}, the Delay feeds back at ${pct(feedback)}: its echoes build up and take a long time to die away.`));
    // The sends: the reverb's up to 300%
    if (!isMixTrack(t)) {
      if (!laneOwns('reverbSend') && sendJumps(was?.reverbSend ?? 0, t.reverbSend)) out.push(lv(`On ${n}, the reverb send goes up to ${pct(t.reverbSend)}: the reverb comes out much louder. Turn your speakers down before you listen.`));
      if (!laneOwns('delaySend') && sendJumps(was?.delaySend ?? 0, t.delaySend)) out.push(lv(`On ${n}, the delay send goes up to ${pct(t.delaySend)}: the delay comes out much louder. Turn your speakers down before you listen.`));
    }
    for (const send of t.sends ?? []) {
      const to = after.tracks.find((x) => x.id === send.to);
      if (!laneOwns(`send:${send.to}`) && sendJumps(was?.sends?.find((x) => x.to === send.to)?.level ?? 0, send.level)) out.push(lv(`On ${n}, the send to ${to ? nm(to.name) : 'a return'} goes up to ${pct(send.level)}: it comes out much louder. Turn your speakers down before you listen.`));
    }
    // Automation drawn high, redrawn higher, or taken away from where it held the setting down
    const meter = wordMeter(before);
    const lanesSaid = new Set<string>();
    out.push(...laneCautions(was, t, after.tracks, meter, lanesSaid));
    // A Filter, compressor or Gate that held it down switched off or eased (their lanes too)
    out.push(...insertCautions(was, t, after.tracks, meter, makeupJumps || lanesSaid.has('fx:compressor.makeup')));
    // Its notes played much harder (only where they changed, and it's heard)
    if (was && notesMoved.has(t.id) && heardAfter.has(t.id)) {
      const line = notesCaution(was, t, before.clips, after.clips, meter);
      if (line) out.push(line);
    }
  }

  // Tracks heard again (by the app's own rule, audibleIds): a solo cleared or moved, or a track led out of a muted bus
  const unmuted = new Set(after.tracks.filter((t) => old.get(t.id)?.isMuted && !t.isMuted).map((t) => t.id));
  const back = after.tracks.filter((t) => {
    if (isMixTrack(t) || !old.has(t.id) || !heardAfter.has(t.id) || heardBefore.has(t.id)) return false;
    // (its own unmuting, or its bus's, is said above)
    return !unmuted.has(t.id) && !busChain(t, after.tracks).some((x) => unmuted.has(x.id));
  });
  if (back.length) {
    const stillHeard = after.tracks.filter((t) => !isMixTrack(t) && heardAfter.has(t.id) && !back.includes(t)).map((t) => pathDb(t, after.tracks));
    const quiet = stillHeard.length > 0 && maxOf(back.map((t) => pathDb(t, after.tracks))) <= maxOf(stillHeard) - QUIET_UNDER_MIX_DB;
    const unsoloed = before.tracks.filter((w) => w.isSoloed && !after.tracks.find((t) => t.id === w.id)?.isSoloed);
    const lines: string[] = [];
    if (unsoloed.length) {
      const who = listOf(unsoloed.map((t) => nm(t.name)));
      if (!soloLit(after.tracks)) lines.push(`This un-solos ${who}: every other track is heard again.`);
      else lines.push(`This un-solos ${who}: ${listOf(back.map((t) => `${nm(t.name)} (at ${r1(levelOf(t))} dB)`))} ${back.length === 1 ? 'is' : 'are'} heard again.`);
    } else {
      for (const t of back.slice(0, 3)) lines.push(t.isSoloed && !old.get(t.id)?.isSoloed ? `This solos ${nm(t.name)} (at ${r1(levelOf(t))} dB): it will be heard.` : `${nm(t.name)} will be heard again (at ${r1(levelOf(t))} dB).`);
      if (back.length > 3) lines.push(`${back.length - 3} more tracks will be heard again.`);
    }
    if (quiet) notes?.push(...lines.map((l) => `${l.replace(/\.$/, '')}, quietly under the rest of the mix.`));
    else out.push(...lines.map((l) => lv(l)));
  }

  if (louder.length) {
    const who = listOf(louder.map(([name]) => nm(name)));
    out.push(lv(`${who} come${louder.length === 1 ? 's' : ''} out up to ${r1(maxOf(louder.map(([, d]) => d)))} dB louder through the buses and the master together. Turn your speakers down before you listen.`, maxOf(louder.map(([, d]) => d))));
  }
  // (the master's own cautions start here: the sum of its plain gains is weighed against them below)
  const masterFrom = out.length;
  // (a plain gain's own caution, said here with its own rise alone: weighed against the others at the end)
  const plainSaid: { at: number; rise: number; clause: string }[] = [];
  // (a control switched on, with its drive, push or lift, is one too: what it adds is counted below)
  const plainLv = (clause: string, rise: number, tail = '.') => {
    plainSaid.push({ at: out.length, rise, clause });
    out.push(lv(`${clause}${tail}`, rise));
  };
  const turnDown = ' Turn your speakers down before you listen.';
  if (b.level - a.level > MASTER_JUMP_DB + 1e-9) plainLv(`The master Level goes up by ${r1(b.level - a.level)} dB`, b.level - a.level, `.${turnDown}`);
  // The Loud master: its push (a plain gain on the whole song) and its sub tilt (a low shelf, the
  // lows only), both before its clipper and the limiter; switched off, they're 0 (loudMaster.ts)
  const push = (m: typeof a) => (m.loud?.on ? m.loud.push : 0);
  const tilt = (m: typeof a) => (m.loud?.on ? m.loud.subTilt : 0);
  const pushUp = push(b) - push(a);
  const tiltUp = Math.max(0, tilt(b) - tilt(a));
  // (the most any part of the song rises: all of it by the push, the lows by the tilt as well)
  const loudUp = pushUp + tiltUp;
  const loudLouder = `the song comes out ${tiltUp > 1e-9 ? 'up to ' : ''}${r1(loudUp)} dB louder.${turnDown}`;
  if (b.loud?.on && !a.loud?.on) {
    if (!(loudUp > MASTER_JUMP_DB + 1e-9)) notes?.push(loudUp > 0.05 ? `This switches on the Loud master: it plays up to ${r1(loudUp)} dB louder.` : 'This switches on the Loud master: it plays no louder.');
    else if (!(tiltUp > 1e-9)) plainLv(`This switches on the Loud master, pushed ${r1(pushUp)} dB`, loudUp, `: ${loudLouder}`);
    else if (!(pushUp > 1e-9)) plainLv(`This switches on the Loud master with its sub tilt up ${r1(tiltUp)} dB`, loudUp, `: the lows come out up to ${r1(loudUp)} dB louder.${turnDown}`);
    else plainLv(`This switches on the Loud master, pushed ${r1(pushUp)} dB with its sub tilt up ${r1(tiltUp)} dB`, loudUp, `: ${loudLouder}`);
  } else if (a.loud?.on && !b.loud?.on) {
    // (switched off, a push or tilt that turned the song down is taken away)
    if (loudUp > MASTER_JUMP_DB + 1e-9) out.push(lv(`Switching off the Loud master takes away its ${r1(loudUp)} dB cut: ${loudLouder}`, loudUp));
  } else if (loudUp > MASTER_JUMP_DB + 1e-9) {
    if (!(tiltUp > 1e-9)) plainLv(`The Loud master pushes ${r1(pushUp)} dB harder`, pushUp);
    else if (!(pushUp > 1e-9)) out.push(lv(`The Loud master's sub tilt goes up by ${r1(tiltUp)} dB: the lows come out up to ${r1(loudUp)} dB louder. Turn your speakers down before you listen.`, loudUp));
    else out.push(lv(`The Loud master pushes ${r1(pushUp)} dB harder and its sub tilt goes up by ${r1(tiltUp)} dB: ${loudLouder}`, loudUp));
  }
  // The OTT: its out gain is a plain gain; its in gain too at depth 0, but at depth its upward
  // compression lifts back part of a cut (ottIn); and switched on it lifts the quiet parts of the
  // whole song by its depth (ottLiftDb at full depth, more the quieter the song is fed into it; at
  // depth 0 it leaves the bands alone, ott.ts)
  const gainIn = (m: typeof a) => (m.ott.on ? m.ott.inGain : 0);
  const gainOut = (m: typeof a) => (m.ott.on ? m.ott.outGain : 0);
  const ottFull = ottLiftDb(after);
  // (switched on: by how much it can lift the song's quietest bar, its gains and its depth together)
  const lift = b.ott.outGain + ottIn(b.ott.inGain, b.ott.depth) + ottFull * b.ott.depth;
  // Its gains' rise (switched off: 0): the out gain's, and the in gain's (a cut eased or taken away
  // counts in full: at depth 0 it's a plain gain, switched off at -12 in, +12 LU measured)
  const ottUp = gainOut(b) - gainOut(a) + ottIn(gainIn(b) - gainIn(a), Math.max(a.ott.on ? a.ott.depth : 0, b.ott.on ? b.ott.depth : 0));
  // (pushed harder while on: what its quiet parts come up by; only while it was on, a depth stored
  // while it was off isn't what played)
  const deeper = a.ott.on && b.ott.on ? Math.max(0, ottFull * (b.ott.depth - a.ott.depth)) : 0;
  const ottAt = `This switches on the master OTT${b.ott.depth > 1e-9 ? ` at ${pct(b.ott.depth)} depth` : ''}`;
  if (b.ott.on && !a.ott.on) {
    if (lift > MASTER_JUMP_DB + 1e-9) plainLv(ottAt, lift, b.ott.depth > 1e-9 ? `: its quiet parts come up by as much as ${r1(lift)} dB.${turnDown}` : `: the song comes out up to ${r1(lift)} dB louder.${turnDown}`);
    // (any depth lifts the quiet parts: at least a note)
    else if (b.ott.depth > 1e-9) notes?.push(lift > 0.05 ? `${ottAt}: its quiet parts come up by as much as ${r1(lift)} dB.` : `${ottAt}: it brings the quiet parts up, and its gains keep the song no louder.`);
  } else if (deeper > MASTER_JUMP_DB + 1e-9) plainLv(`The master OTT is pushed much harder (${pct(a.ott.depth)} to ${pct(b.ott.depth)} depth)`, deeper, `: its quiet parts come up by as much as ${r1(deeper)} dB.${turnDown}`);
  if (a.ott.on && !b.ott.on && ottUp > MASTER_JUMP_DB + 1e-9) out.push(lv(`Switching off the master OTT takes away its ${r1(ottUp)} dB cut: the song comes out ${a.ott.depth > 1e-9 ? 'up to ' : ''}${r1(ottUp)} dB louder. Turn your speakers down before you listen.`, ottUp));
  else if (a.ott.on && b.ott.on && ottUp > MASTER_JUMP_DB + 1e-9) plainLv(`The master OTT's gain goes up by ${r1(ottUp)} dB`, ottUp);
  // The clipper: its drive is a plain gain into it, its ceiling holds the peaks down (the limiter
  // after it holds them under LIMITER_CEILING_DBTP whatever it does)
  const ceilingOf = (m: typeof a) => Math.min(m.clipper?.ceiling ?? 0, LIMITER_CEILING_DBTP);
  const driveOf = (m: typeof a) => (m.clipper?.on ? m.clipper.drive : 0);
  if (b.clipper?.on && !a.clipper?.on) {
    const drive = b.clipper.drive;
    if (drive > MASTER_JUMP_DB + 1e-9) plainLv(`This switches on the master clipper at ${r1(drive)} dB of drive`, drive, `: the song comes out up to ${r1(drive)} dB louder.${turnDown}`);
    else notes?.push(drive > 0.05 ? `This switches on the master clipper at ${r1(drive)} dB of drive: it plays up to ${r1(drive)} dB louder.` : 'This switches on the master clipper with no drive: it plays no louder, only its peaks over the ceiling are shaved.');
  } else if (a.clipper?.on && !b.clipper?.on) {
    // (the peaks it held down come back, as far as the limiter lets them)
    const up = LIMITER_CEILING_DBTP - ceilingOf(a);
    if (up > MASTER_JUMP_DB + 1e-9) out.push(lv(`Switching off the master clipper takes away its ceiling at ${r1(a.clipper.ceiling)} dB: the peaks it held down come up by as much as ${r1(up)} dB. Turn your speakers down before you listen.`, up));
  } else if (b.clipper?.on && a.clipper?.on) {
    // A peak comes out at the least of the ceiling, the limiter's and what the drive gives it, so it
    // rises by at most the drive's rise or the ceiling's, whichever is more (drive +5, ceiling -12 to
    // 0: true peak +10.9 dB, +5.7 LU measured)
    const driveUp = b.clipper.drive - a.clipper.drive;
    const up = ceilingOf(b) - ceilingOf(a);
    const most = Math.max(driveUp, up);
    const raised = `its ceiling goes up from ${r1(a.clipper.ceiling)} to ${r1(b.clipper.ceiling)} dB`;
    if (!(most > MASTER_JUMP_DB + 1e-9)) {
      // (nothing over the master's line)
    } else if (driveUp > 0.05 && up > 0.05) out.push(lv(`The master clipper is driven ${r1(driveUp)} dB harder and ${raised}: the song comes out up to ${r1(most)} dB louder. Turn your speakers down before you listen.`, most));
    else if (driveUp > MASTER_JUMP_DB + 1e-9) plainLv(`The master clipper is driven ${r1(driveUp)} dB harder`, driveUp);
    else out.push(lv(`The master clipper's ceiling goes up from ${r1(a.clipper.ceiling)} to ${r1(b.clipper.ceiling)} dB: the peaks it held down come up by as much as ${r1(up)} dB. Turn your speakers down before you listen.`, up));
  }
  // The glue style changed: what it can add, measured (GLUE_RISE_DB), a rise only
  const glueUp = a.glue === b.glue ? 0 : (GLUE_RISE_DB[a.glue]?.[b.glue] ?? GLUE_RISE_DB.tight.off);
  if (glueUp > MASTER_JUMP_DB + 1e-9) plainLv(`The master glue goes from ${GLUE_NAMES[a.glue] ?? a.glue} to ${GLUE_NAMES[b.glue] ?? b.glue}`, glueUp, `: the peaks it held down come up by as much as ${r1(glueUp)} dB.${turnDown}`);
  // Small rises on several of the master's plain gains add up: the Level, the Loud master's push, the
  // clipper's drive and the OTT's gains (with its lift, switched on) together, with what a change of
  // the glue style can add (Level, push and drive up 3 each: +9 LU measured; Tight to Off with the
  // Level and the push up 2.5 each: +8.5 dB true peak, said as 9), said when no caution above
  // already says as much. A cut counts only on a control that stays on (one switched off takes its
  // clipper or compression away with it), the OTT's depth eased lowers only its quiet parts, so it
  // takes nothing off, and a glue change never counts as a cut
  const ottAll = b.ott.on && !a.ott.on ? lift : a.ott.on && b.ott.on ? ottUp + deeper : Math.max(0, ottUp);
  const pushAll = a.loud?.on && b.loud?.on ? pushUp : Math.max(0, pushUp);
  const driveAll = a.clipper?.on && b.clipper?.on ? driveOf(b) - driveOf(a) : Math.max(0, driveOf(b) - driveOf(a));
  const gains = [b.level - a.level, pushAll, driveAll, ottAll, glueUp];
  const together = gains.reduce((sum, g) => sum + g, 0);
  // A plain gain's rise turned back down by another's cut (Level +4 with the OTT's out gain or the
  // push -4: measured 0 LU, 0 dB peak) is said with what they come to together, the most any part of
  // the song rises (the lows by the sub tilt as well): at most MASTER_JUMP_DB, only a note
  const most = together + tiltUp;
  const eased = plainSaid.filter((p) => p.rise > most + 0.05);
  if (eased.length) {
    const clauses = eased.map((p, i) => (i ? p.clause.replace(/^(The|This) /, (w) => w.toLowerCase()) : p.clause));
    const what = clauses.length > 1 ? `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}` : clauses[0];
    const it = eased.length > 1 ? 'them' : 'it';
    for (const p of [...eased].reverse()) out.splice(p.at, 1);
    if (!(most > MASTER_JUMP_DB + 1e-9)) notes?.push(r1(most) > 0 ? `${what}, but other master changes in this suggestion turn most of ${it} back down: together they make the song up to ${r1(most)} dB louder.` : `${what}, but other master changes in this suggestion turn ${it} back down.`);
    else out.splice(eased[0].at, 0, lv(`${what}, but other master changes in this suggestion turn part of ${it} back down: together they make the song up to ${r1(most)} dB louder. Turn your speakers down before you listen.`, most));
  }
  const saidHere = maxOf(0, out.slice(masterFrom).map((c) => c.louder ?? 0));
  // (of two or more of them, the sub tilt's rise counted with them: one alone is said by its own
  // caution. Level and the sub tilt up 2.9 each: +3.6 LU, +4.4 dB peak measured, said as 5.8)
  const lows = tiltUp > 0.05 ? ' (the lows most)' : '';
  if ([...gains, tiltUp].filter((g) => g > 0.05).length > 1 && most > MASTER_JUMP_DB + 1e-9 && r1(most) > r1(saidHere)) out.push(lv(`Together these master changes make the song up to ${r1(most)} dB louder${lows}. Turn your speakers down before you listen.`, most));
  return out;
}

/** Suggested measured louder than the song, by the studio's own sound check, by more than this (LU, in any bar) gets a warning when the rules said nothing about level. */
export const MEASURED_JUMP_LU = TRACK_JUMP_DB;
/** ...or its true peak higher by more than this, dB. */
export const MEASURED_PEAK_DB = TRACK_JUMP_DB;
/** A song silent all through is taken to be this loud (LUFS) for comparing with: as loud as a quiet mix. */
export const SILENT_SONG_LUFS = -23;
/** For the number a caution gives, a bar of Now quieter than this many LU under the song (silent too) counts as this far under it. */
export const MEASURED_FLOOR_LU = 20;

/** One bar of a render, measured: its loudness (LUFS) and its true peak (dBTP), -Infinity where it's silent. */
export interface BarLevel {
  lufs: number;
  peak: number;
}

/**
 * How much louder Suggested is measured: `db`, at its most against the line a bar is tested
 * against (see measuredRise), for turning it down; `own`, the most a bar over the line rose
 * against Now's same bar, for the words; `bar`, the first bar (1 on) over the line. Null: nowhere.
 */
export interface MeasuredRise {
  db: number;
  bar: number;
  own: number;
}

/**
 * Where the song with a suggestion (`after`, bar 1 first) comes out much louder than the song as
 * it is (`before`, the same bars), by the studio's sound check (both rendered whole: whereHeard.ts)
 * or a before-and-after's own renders (auditionPlayer.ts): a bar's loudness more than
 * MEASURED_JUMP_LU over what it was there, or over the whole song's loudness (`song.lufs`,
 * integrated) where that's more (a quiet bar brought up only to the song's own level is no jump);
 * or its true peak more than MEASURED_PEAK_DB over its peak there, or over the song's highest
 * (`song.peak`) where that's more. A song silent all through is compared with SILENT_SONG_LUFS
 * (and its peaks aren't). What a bar over the line rose by against Now's same bar (`own`) is what
 * a caution says: a bar of Now under the song by more than MEASURED_FLOOR_LU (or silent) counts as
 * that far under it. Null: nowhere.
 */
export function measuredRise(before: readonly BarLevel[], after: readonly BarLevel[], song: BarLevel): MeasuredRise | null {
  const songLufs = Number.isFinite(song.lufs) ? song.lufs : SILENT_SONG_LUFS;
  const songPeak = Number.isFinite(song.peak) ? song.peak : -Infinity;
  let bar = 0;
  let most = -Infinity;
  let own = -Infinity;
  after.forEach((b, i) => {
    const a = before[i] ?? { lufs: -Infinity, peak: -Infinity };
    const lu = Number.isFinite(b.lufs) ? b.lufs - Math.max(a.lufs, songLufs) : -Infinity;
    const pk = Number.isFinite(b.peak) && Number.isFinite(songPeak) ? b.peak - Math.max(a.peak, songPeak) : -Infinity;
    most = Math.max(most, lu, pk);
    const luOver = lu > MEASURED_JUMP_LU + 1e-9;
    const pkOver = pk > MEASURED_PEAK_DB + 1e-9;
    if (!luOver && !pkOver) return;
    if (!bar) bar = i + 1;
    // (against Now's same bar, with a floor under the song for a bar that was silent or nearly)
    if (luOver) own = Math.max(own, b.lufs - Math.max(a.lufs, songLufs - MEASURED_FLOOR_LU));
    if (pkOver) own = Math.max(own, b.peak - Math.max(a.peak, songPeak - MEASURED_FLOOR_LU));
  });
  return bar ? { db: most, bar, own } : null;
}

/**
 * The warning for what a sound check measured (measuredRise), in plain words: "Suggested comes
 * out up to 9 dB louder (from bar 5). Turn your speakers down before you listen." `said`: the
 * largest rise the rules' cautions about level stated (louderSaid), or null when none was about
 * level. When they said it, the warning comes only if it measured clearly more (over `said` by
 * more than MEASURED_JUMP_LU), and says so. `earlier`: it was measured before the musician's last
 * edit, which changed what the suggestion touches ("Before your last edit, Suggested came out...").
 */
export function measuredCaution(rise: MeasuredRise | null, said: number | null, meter: MeterMap | null = null, earlier = false): string | null {
  if (!rise) return null;
  const db = Math.round(rise.own);
  if (said !== null && !(db > said + MEASURED_JUMP_LU + 1e-9)) return null;
  const where = `up to ${db} dB louder (from ${positionWords(Math.floor(rise.bar), meter)})${said !== null ? ', more than the cautions above say' : ''}`;
  return `${earlier ? `Before your last edit, Suggested came out ${where}` : `Suggested comes out ${where}`}. Turn your speakers down before you listen.`;
}
