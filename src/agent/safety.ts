/**
 * Cautions about a suggestion's levels, so nothing an agent suggests can jump out of the speakers
 * unannounced: a track turned up by more than TRACK_JUMP_DB, by its fader, its EQ, its inserts'
 * gains (compressor makeup, parametric EQ and multiband bands, a cut eased or taken away, an insert
 * that held it down switched off), or along its whole path (its buses and the master together, a
 * volume lane counted where there is one); a track unmuted (only a note while a solo or a muted bus
 * still keeps it silent); a drive or saturation pushed hard, a delay fed back until it hardly dies
 * away; automation of any of those drawn high, redrawn higher anywhere along the song, or a lane
 * that held one down taken away (removed or emptied), all compared with what played there before
 * (a lane on an insert that was off, with nothing); a track heard again because a solo was cleared
 * or moved; the master Level, the Loud master's push or the OTT's gains up by more than
 * MASTER_JUMP_DB, the Loud master or the clipper switched on. They are warnings on the suggestion's
 * card (the musician decides), never refusals; values beyond what the song can hold are already
 * brought into range by the ops (see ops.ts). Plain logic.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationParam, AutomationPoint, PeqBand, Track } from '../store/timelineTypes';
import { normalizeMasterSettings } from '../store/timelineTypes';
import { audibleIds, busChain, isMixTrack, soloLit } from '../store/buses';
import { AUTOMATION, formatHz, LAST_BAR, laneValueAt, laneValueBefore, specOf, VOLUME_FLOOR_DB } from '../audio/automation';
import { logFrequencies, peqDb } from '../audio/peq';
import { positionWords, wordMeter } from './songDiff';
import type { MeterMap } from '../audio/tempoMap';
import { nm, plainNames } from './names';
import { maxOf } from '../support/minMax';

/** A track raised by more than this many dB gets a warning. */
export const TRACK_JUMP_DB = 6;
/** The master raised by more than this many dB gets a warning. */
export const MASTER_JUMP_DB = 3;
/** A drive (Distortion amount, Saturation) raised by more than this gets a warning. */
export const DRIVE_JUMP = 0.4;
/** A delay fed back this much or more gets a warning: its echoes take a long time to die away. */
export const FEEDBACK_HIGH = 0.8;

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
const LANE_LIMITS: Partial<Record<string, { kind: 'db' | 'drive' | 'feedback'; label: string }>> = {
  volume: { kind: 'db', label: 'volume' },
  eqLow: { kind: 'db', label: 'EQ low' },
  eqMid: { kind: 'db', label: 'EQ mid' },
  eqHigh: { kind: 'db', label: 'EQ high' },
  'fx:compressor.makeup': { kind: 'db', label: 'compressor makeup' },
  'fx:distortion.amount': { kind: 'drive', label: 'distortion drive' },
  'fx:echo.feedback': { kind: 'feedback', label: 'delay feedback' },
};

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
function alongTimeline(then: LaneSide, now: LaneSide, real: (n: number) => number): Array<{ bar: number; then: number; now: number }> {
  const marks = [1, LAST_BAR, ...(then.points ?? []).map((p) => p.bar), ...(now.points ?? []).map((p) => p.bar)].filter((b) => b >= 1 && b <= LAST_BAR).sort((x, y) => x - y);
  const bars: number[] = [];
  for (const m of marks) {
    const prev = bars.at(-1);
    if (prev !== undefined && m - prev < 1e-9) continue;
    if (prev !== undefined) for (let k = 1; k < STEPS_BETWEEN; k++) bars.push(prev + ((m - prev) * k) / STEPS_BETWEEN);
    bars.push(m);
  }
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
function laneCautions(was: Track | undefined, t: Track, tracks: readonly Track[], meter: MeterMap | null): string[] {
  const out: string[] = [];
  const n = `${nm(t.name)}`;
  const lanes = (x: Track | undefined) => (x?.automation ?? []).filter((l) => LANE_LIMITS[l.param] && l.points.length);
  const params = [...new Set([...lanes(was), ...lanes(t)].map((l) => l.param))];
  for (const param of params) {
    const limit = LANE_LIMITS[param];
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
      limit.kind === 'db' ? s.now - s.then > TRACK_JUMP_DB + 1e-9 : limit.kind === 'drive' ? s.now - s.then > DRIVE_JUMP + 1e-9 : s.now >= FEEDBACK_HIGH - 1e-9 && s.now > s.then + 1e-9;
    const first = along.find(over);
    if (!first) continue;
    const rise = maxOf(along.map((s) => s.now - s.then));
    // (the most it rises, for a drive's words: from what to what)
    const most = along.reduce((m, s) => (s.now - s.then > m.now - m.then ? s : m), first);
    const top = maxOf(along.filter(over).map((s) => s.now));
    const from = positionWords(first.bar, meter);
    const what = `the ${limit.label} automation on ${n}`;
    if (!lane) {
      // Taken away (removed, or left with no points): it rests at its setting
      if (limit.kind === 'db') out.push(`This takes away ${what}: it held it down, and it comes up by as much as ${r1(rise)} dB. Turn your speakers down before you listen.`);
      if (limit.kind === 'drive') out.push(`This takes away ${what}: it held it down, and it is driven at ${pct(now.rest)} all along.`);
      if (limit.kind === 'feedback') out.push(`This takes away ${what}: it feeds back at ${pct(now.rest)} all along.`);
    } else if (!oldLane) {
      // Drawn where there was none: measured from the setting it replaces
      if (limit.kind === 'db') out.push(`On ${n}, the ${limit.label} automation goes up to ${r1(rise)} dB over what it was.`);
      if (limit.kind === 'drive') out.push(`On ${n}, the ${limit.label} automation pushes it to ${pct(top)}.`);
      if (limit.kind === 'feedback') out.push(`On ${n}, the ${limit.label} automation feeds it back at up to ${pct(top)}.`);
    } else {
      // Redrawn: louder somewhere along the song than it was there
      if (limit.kind === 'db') out.push(`This redraws ${what}: it comes up by as much as ${r1(rise)} dB from ${from}. Turn your speakers down before you listen.`);
      if (limit.kind === 'drive') out.push(`This redraws ${what}: it is driven much harder from ${from} (as much as ${pct(most.then)} to ${pct(most.now)} drive): it gets louder and harsher.`);
      if (limit.kind === 'feedback') out.push(`This redraws ${what}: it feeds back at up to ${pct(top)} from ${from}: its echoes build up and take a long time to die away.`);
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
  const out: string[] = [];
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

  for (const t of after.tracks) {
    const was = old.get(t.id);
    const n = `${nm(t.name)}`;
    // A new track starts at 0 dB, so one set louder is measured from there
    const from = was ? was.volume : 0;
    const ownJump = t.volume - from;
    if (ownJump > TRACK_JUMP_DB + 1e-9) out.push(`${n} goes up by ${r1(ownJump)} dB. Turn your speakers down before you listen.`);
    if (was?.isMuted && !t.isMuted && !heardAfter.has(t.id)) {
      // (still not heard: a solo elsewhere, or a muted bus it plays into, keeps it silent)
      const lit = soloLit(after.tracks);
      notes?.push(`This unmutes ${n}, but it stays silent: ${lit && !lit.has(t.id) ? 'other tracks are soloed' : 'a bus it plays into is muted'}.`);
    } else if (was?.isMuted && !t.isMuted) {
      const others = audible.filter((x) => x.id !== t.id).map((x) => pathDb(x, after.tracks));
      const quiet = others.length > 0 && pathDb(t, after.tracks) <= maxOf(others) - QUIET_UNDER_MIX_DB;
      if (quiet) notes?.push(`This unmutes ${n}, quietly under the rest of the mix (at ${r1(levelOf(t))} dB).`);
      else out.push(`This unmutes ${n} (at ${r1(levelOf(t))} dB): it will be heard again.`);
    }
    // Along the whole path: its buses and the master together (what it adds on its own is said above)
    if (!isMixTrack(t) && !t.isMuted) {
      const now = pathDb(t, after.tracks) + b.level;
      const then = (was ? pathDb(was, before.tracks) : 0) + a.level;
      // (not when it's all its own fader's or volume lane's, or all the master's: those are said on their own)
      const ownLevel = levelOf(t) - (was ? levelOf(was) : 0);
      if (now - then > TRACK_JUMP_DB + 1e-9 && ownJump <= TRACK_JUMP_DB + 1e-9 && ownLevel <= TRACK_JUMP_DB + 1e-9 && now - then - (b.level - a.level) > 1e-9) louder.push([t.name, now - then]);
    }
    // The EQ and the inserts' gains
    for (const band of ['low', 'mid', 'high'] as const) {
      const lift = t.eq[band] - (was?.eq[band] ?? 0);
      if (lift > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the EQ ${band} goes up by ${r1(lift)} dB.`);
    }
    const makeup = onValue(t, 'compressor', 'makeup') - onValue(was, 'compressor', 'makeup');
    if (makeup > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the compressor makes up ${r1(makeup)} dB more.`);
    const peq = peqRise(was, t);
    if (peq.rise > TRACK_JUMP_DB + 1e-9) {
      if (switchedOff(was, t, 'peq')) out.push(`This switches off the parametric EQ on ${n}: it held it down, and around ${formatHz(peq.hz)} it comes up by ${r1(peq.rise)} dB. Turn your speakers down before you listen.`);
      else if (peq.after > 1e-6) out.push(`On ${n}, the parametric EQ lifts a band by ${r1(peq.rise)} dB more.`);
      else out.push(`On ${n}, the parametric EQ cuts less: around ${formatHz(peq.hz)} it comes up by ${r1(peq.rise)} dB. Turn your speakers down before you listen.`);
    }
    const mbc = mbcRise(was, t);
    if (mbc > TRACK_JUMP_DB + 1e-9) {
      if (switchedOff(was, t, 'mbc')) out.push(`This switches off the multiband compressor on ${n}: its bands held it down, and it comes up by as much as ${r1(mbc)} dB. Turn your speakers down before you listen.`);
      else out.push(`On ${n}, the multiband compressor lifts a band by ${r1(mbc)} dB more.`);
    }
    // Drives and feedback
    for (const [insert, field, label] of [['distortion', 'amount', 'Distortion'], ['saturate', 'amount', 'Saturation']] as const) {
      const now = onValue(t, insert, field);
      const then = onValue(was, insert, field);
      if (now - then <= DRIVE_JUMP + 1e-9) continue;
      if (then === 0) out.push(`This turns on ${label} on ${n} at ${pct(now)} drive: it gets louder and harsher.`);
      else out.push(`On ${n}, ${label} is driven much harder (${pct(then)} to ${pct(now)} drive): it gets louder and harsher.`);
    }
    const feedback = onValue(t, 'echo', 'feedback');
    if (feedback >= FEEDBACK_HIGH - 1e-9 && feedback > onValue(was, 'echo', 'feedback') + 1e-9) out.push(`On ${n}, the Delay feeds back at ${pct(feedback)}: its echoes build up and take a long time to die away.`);
    // Automation drawn high, redrawn higher, or taken away from where it held the setting down
    out.push(...laneCautions(was, t, after.tracks, wordMeter(before)));
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
    else out.push(...lines);
  }

  if (louder.length) {
    const who = listOf(louder.map(([name]) => nm(name)));
    out.push(`${who} come${louder.length === 1 ? 's' : ''} out up to ${r1(maxOf(louder.map(([, d]) => d)))} dB louder through the buses and the master together. Turn your speakers down before you listen.`);
  }
  if (b.level - a.level > MASTER_JUMP_DB + 1e-9) out.push(`The master Level goes up by ${r1(b.level - a.level)} dB. Turn your speakers down before you listen.`);
  const push = (m: typeof a) => (m.loud?.on ? m.loud.push : 0);
  if (b.loud?.on && !a.loud?.on) out.push('This switches on the Loud master: the whole song gets louder.');
  else if (push(b) - push(a) > MASTER_JUMP_DB + 1e-9) out.push(`The Loud master pushes ${r1(push(b) - push(a))} dB harder.`);
  const ott = (m: typeof a) => (m.ott.on ? m.ott.outGain + Math.max(0, m.ott.inGain) : 0);
  if (ott(b) - ott(a) > MASTER_JUMP_DB + 1e-9) out.push(`The master OTT's gain goes up by ${r1(ott(b) - ott(a))} dB.`);
  if (b.clipper?.on && !a.clipper?.on) out.push('This switches on the master clipper.');
  else if (b.clipper?.on && a.clipper?.on && b.clipper.drive - a.clipper.drive > MASTER_JUMP_DB + 1e-9) out.push(`The master clipper is driven ${r1(b.clipper.drive - a.clipper.drive)} dB harder.`);
  return out;
}
