/**
 * Cautions about a suggestion's levels, so nothing an agent suggests can jump out of the speakers
 * unannounced: a track turned up by more than TRACK_JUMP_DB, by its fader, its EQ, its inserts'
 * gains (compressor makeup, parametric EQ and multiband bands), or along its whole path (its
 * buses and the master together); a track unmuted; a drive or saturation pushed hard, a delay fed
 * back until it hardly dies away; automation of any of those drawn high; the master Level, the
 * Loud master's push or the OTT's gains up by more than MASTER_JUMP_DB, the Loud master or the
 * clipper switched on. They are warnings on the suggestion's card (the musician decides), never
 * refusals; values beyond what the song can hold are already brought into range by the ops (see
 * ops.ts). Plain logic.
 */
import type { ProjectSnapshot } from '../store/project';
import type { AutomationParam, Track } from '../store/timelineTypes';
import { normalizeMasterSettings } from '../store/timelineTypes';
import { busChain, isMixTrack } from '../store/buses';
import { specOf } from '../audio/automation';
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
/** The most an on insert's bands lift (parametric EQ, multiband), dB. */
const bandLift = (t: Track | undefined, insert: 'peq' | 'mbc'): number => {
  const f = fxOf(t)[insert] as { on?: boolean; bands?: Array<{ on?: boolean; gain?: number; bypass?: boolean }> } | undefined;
  if (!f?.on || !Array.isArray(f.bands)) return 0;
  return maxOf(0, f.bands.filter((b) => b.on !== false && !b.bypass).map((b) => b.gain ?? 0));
};

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

/** A track's level along its whole way out: its fader and its buses' faders (the master is added by the caller). */
function pathDb(t: Track, tracks: readonly Track[]): number {
  return t.volume + busChain(t, tracks).reduce((sum, b) => sum + b.volume, 0);
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

  for (const t of after.tracks) {
    const was = old.get(t.id);
    const n = `${nm(t.name)}`;
    // A new track starts at 0 dB, so one set louder is measured from there
    const from = was ? was.volume : 0;
    const ownJump = t.volume - from;
    if (ownJump > TRACK_JUMP_DB + 1e-9) out.push(`${n} goes up by ${r1(ownJump)} dB. Turn your speakers down before you listen.`);
    if (was?.isMuted && !t.isMuted) {
      const others = audible.filter((x) => x.id !== t.id).map((x) => pathDb(x, after.tracks));
      const quiet = others.length > 0 && pathDb(t, after.tracks) <= maxOf(others) - QUIET_UNDER_MIX_DB;
      if (quiet) notes?.push(`This unmutes ${n}, quietly under the rest of the mix (at ${r1(t.volume)} dB).`);
      else out.push(`This unmutes ${n} (at ${r1(t.volume)} dB): it will be heard again.`);
    }
    // Along the whole path: its buses and the master together (what it adds on its own is said above)
    if (!isMixTrack(t) && !t.isMuted) {
      const now = pathDb(t, after.tracks) + b.level;
      const then = (was ? pathDb(was, before.tracks) : 0) + a.level;
      // (not when it's all its own fader's, or all the master's: those are said on their own)
      if (now - then > TRACK_JUMP_DB + 1e-9 && ownJump <= TRACK_JUMP_DB + 1e-9 && now - then - (b.level - a.level) > 1e-9) louder.push([t.name, now - then]);
    }
    // The EQ and the inserts' gains
    for (const band of ['low', 'mid', 'high'] as const) {
      const lift = t.eq[band] - (was?.eq[band] ?? 0);
      if (lift > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the EQ ${band} goes up by ${r1(lift)} dB.`);
    }
    const makeup = onValue(t, 'compressor', 'makeup') - onValue(was, 'compressor', 'makeup');
    if (makeup > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the compressor makes up ${r1(makeup)} dB more.`);
    for (const [insert, label] of [['peq', 'parametric EQ'], ['mbc', 'multiband compressor']] as const) {
      const lift = bandLift(t, insert) - bandLift(was, insert);
      if (lift > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the ${label} lifts a band by ${r1(lift)} dB more.`);
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
    // Automation drawn high
    for (const lane of t.automation ?? []) {
      const limit = LANE_LIMITS[lane.param];
      if (!limit || !lane.points.length) continue;
      const oldLane = was?.automation?.find((l) => l.param === lane.param);
      if (oldLane && JSON.stringify(oldLane) === JSON.stringify(lane)) continue;
      const spec = specOf(lane.param as AutomationParam, t, after.tracks);
      const top = spec.toReal(maxOf(lane.points.map((p) => p.value)));
      // Measured from the lane's own highest point when it had one (it was what played), else from
      // the setting as it was before the suggestion (a new track: as it starts)
      const base = oldLane?.points.length ? spec.toReal(maxOf(oldLane.points.map((p) => p.value))) : spec.trackValue(was ?? t);
      if (limit.kind === 'db' && top - base > TRACK_JUMP_DB + 1e-9) out.push(`On ${n}, the ${limit.label} automation goes up to ${r1(top - base)} dB over what it was.`);
      if (limit.kind === 'drive' && top - base > DRIVE_JUMP + 1e-9) out.push(`On ${n}, the ${limit.label} automation pushes it to ${pct(top)}.`);
      if (limit.kind === 'feedback' && top >= FEEDBACK_HIGH - 1e-9) out.push(`On ${n}, the ${limit.label} automation feeds it back at up to ${pct(top)}.`);
    }
  }

  if (louder.length) {
    const names = louder.slice(0, 3).map(([name]) => nm(name));
    const who = louder.length > 3 ? `${names.join(', ')} and ${louder.length - 3} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
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
