/**
 * Cautions about a suggestion's levels, so nothing an agent suggests can jump out of the speakers:
 * a track turned up by more than TRACK_JUMP_DB, the master Level, the Loud master's push or the
 * OTT's output by more than MASTER_JUMP_DB, the Loud master or the clipper switched on. They are
 * warnings on the suggestion's card (the musician decides), never refusals; values beyond what the
 * song can hold are already brought into range by the ops (see ops.ts). Plain logic.
 */
import type { ProjectSnapshot } from '../store/project';
import type { Track } from '../store/timelineTypes';
import { normalizeMasterSettings } from '../store/timelineTypes';
import { AUTOMATION } from '../audio/automation';

/** A track raised by more than this many dB gets a warning. */
export const TRACK_JUMP_DB = 6;
/** The master raised by more than this many dB gets a warning. */
export const MASTER_JUMP_DB = 3;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The warnings for going from `before` to `after` (an empty list: nothing to say). */
export function checkSafety(before: ProjectSnapshot, after: ProjectSnapshot): string[] {
  const out: string[] = [];
  const old = new Map(before.tracks.map((t) => [t.id, t]));
  for (const t of after.tracks) {
    const was = old.get(t.id);
    // A new track starts at 0 dB, so one set louder is measured from there
    const from = was ? was.volume : 0;
    if (t.volume - from > TRACK_JUMP_DB + 1e-9) out.push(`"${t.name}" goes up by ${r1(t.volume - from)} dB. Turn your speakers down before you listen.`);
    const lift = volumeLaneLift(was, t);
    if (lift > TRACK_JUMP_DB + 1e-9) out.push(`"${t.name}"'s volume automation goes up to ${r1(lift)} dB over the track's level.`);
  }
  const a = normalizeMasterSettings(before.master);
  const b = normalizeMasterSettings(after.master);
  if (b.level - a.level > MASTER_JUMP_DB + 1e-9) out.push(`The master Level goes up by ${r1(b.level - a.level)} dB. Turn your speakers down before you listen.`);
  const push = (m: typeof a) => (m.loud?.on ? m.loud.push : 0);
  if (b.loud?.on && !a.loud?.on) out.push('This switches on the Loud master: the whole song gets louder.');
  else if (push(b) - push(a) > MASTER_JUMP_DB + 1e-9) out.push(`The Loud master pushes ${r1(push(b) - push(a))} dB harder.`);
  const ottOut = (m: typeof a) => (m.ott.on ? m.ott.outGain : 0);
  if (ottOut(b) - ottOut(a) > MASTER_JUMP_DB + 1e-9) out.push(`The master OTT's output goes up by ${r1(ottOut(b) - ottOut(a))} dB.`);
  if (b.clipper?.on && !a.clipper?.on) out.push('This switches on the master clipper.');
  else if (b.clipper?.on && a.clipper?.on && b.clipper.drive - a.clipper.drive > MASTER_JUMP_DB + 1e-9) out.push(`The master clipper is driven ${r1(b.clipper.drive - a.clipper.drive)} dB harder.`);
  return out;
}

/**
 * How far a new or redrawn volume lane reaches over the level the track had, in dB (0 when it
 * doesn't, or wasn't changed). While a lane has points it sets the track's volume.
 */
function volumeLaneLift(was: Track | undefined, t: Track): number {
  const lane = t.automation?.find((l) => l.param === 'volume');
  const oldLane = was?.automation?.find((l) => l.param === 'volume');
  if (!lane?.points.length || JSON.stringify(lane) === JSON.stringify(oldLane)) return 0;
  const top = AUTOMATION.volume.toReal(Math.max(...lane.points.map((p) => p.value)));
  const lift = top - (was?.volume ?? 0);
  return lift > 0 ? lift : 0;
}
