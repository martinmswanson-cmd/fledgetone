/**
 * Glue: a switch that makes a song's parts sound like one record instead of instruments playing
 * side by side, the way a mix engineer ties a mix together. Switched on, it:
 *   - makes space (makeSpace.ts): each part loses the rumble under it, and parts in the lead's
 *     range give way to it;
 *   - puts the drums on a drum bus and the music parts on a music bus (busPresets.ts), each glued
 *     by gentle compression, the music bus breathing with the kick;
 *   - ducks the bass under the kick;
 *   - sends every part a little more to the shared reverb, so they sit in one room;
 *   - spreads the parts left in the middle a little apart (never the lead, the bass or the drums).
 * Every change is recorded (GlueRecord: the value before and the value glue set), so switching it
 * off puts back what it changed, but only where the value is still what glue set: a pan or an EQ
 * changed by hand since stays. The buses it made go, and their tracks play to where the bus did.
 * Plain data in and out, so Node can test it; the store keeps the record in MasterSettings.glueMix.
 */
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { trackRole } from '../audio/mixCheck';
import { busPresetFx } from './busPresets';
import { isMixTrack } from './buses';
import { makeSpace } from './makeSpace';
import { midiOf } from './noteTools';
import type { Clip, GlueChange, GlueField, GlueRecord, Track } from './timelineTypes';

/** The shared reverb each kind of part gets at least (its send is only ever raised). */
const ROOM = { drums: 0.1, bass: 0.04, vocal: 0.15, music: 0.2 } as const;
/** Where the parts left in the middle go, in turn: a little either side, then a little further. */
const SPREAD = [-0.25, 0.25, -0.15, 0.15, -0.35, 0.35, -0.1, 0.1];

const read = (t: Track, field: GlueField): unknown => (field === 'peq' ? t.fx.peq : field === 'pump' ? t.fx.pump : t[field]);
/** A field set (or, for undefined, taken away: a track with no output plays to the master). */
const write = (t: Track, field: GlueField, v: unknown): Track => {
  const put = <O extends object>(o: O): O => {
    const next = { ...o } as Record<string, unknown>;
    if (v === undefined) delete next[field];
    else next[field] = v;
    return next as O;
  };
  return field === 'peq' || field === 'pump' ? { ...t, fx: put(t.fx) } : put(t);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sound effects, risers and the like take no part (they're not part of the band). */
export function isEffect(t: Track): boolean {
  const info = INSTRUMENTS[t.instrumentKey];
  return !info || info.kind === 'fx' || info.kind === 'audio' || info.category === 'Sound Effects' || info.category === 'FX';
}

/** The lead: the parts named so (a lead and its layers), else of those playing one line at a time, the highest. */
function leadsOf(parts: Track[], clips: readonly Clip[]): Set<string> {
  const named = parts.filter((t) => /\blead\b/i.test(t.name));
  if (named.length) return new Set(named.map((t) => t.id));
  const id = highestLine(parts, clips);
  return new Set(id ? [id] : []);
}

function highestLine(parts: Track[], clips: readonly Clip[]): string | undefined {
  let best: { id: string; mid: number } | undefined;
  for (const t of parts) {
    const notes = clips.filter((c) => c.trackId === t.id && !c.audio).flatMap((c) => c.notes);
    if (notes.length < 8) continue;
    const starts = new Map<number, number>();
    for (const n of notes) starts.set(n.startOffset, (starts.get(n.startOffset) ?? 0) + 1);
    if ([...starts.values()].filter((v) => v > 1).length >= notes.length * 0.15) continue;
    const midis = notes.map((n) => midiOf(n.note)).filter(Number.isFinite).sort((a, b) => a - b);
    const mid = midis[Math.floor(midis.length / 2)];
    if (!best || mid > best.mid) best = { id: t.id, mid };
  }
  return best?.id;
}

/**
 * Glue switched on: the tracks with it applied, and the record of what changed. `newBus` makes a
 * bus track (named, coloured like its first member), as the store does for Group into bus.
 */
export function applyGlue(tracks: Track[], clips: readonly Clip[], newBus: (name: string, members: Track[]) => Track): { tracks: Track[]; record: GlueRecord } {
  const changes: GlueChange[] = [];
  const buses: string[] = [];
  let out = tracks;
  const set = (id: string, field: GlueField, v: unknown) => {
    out = out.map((t) => {
      if (t.id !== id) return t;
      const from = read(t, field);
      if (same(from, v)) return t;
      // (A field changed twice keeps its first "before")
      const prior = changes.find((c) => c.trackId === id && c.field === field);
      if (prior) prior.to = v;
      else changes.push({ trackId: id, field, from, to: v });
      return write(t, field, v);
    });
  };

  // Room for each part (its Pro EQ)
  const spaced = makeSpace(out, [...clips]).tracks;
  for (const t of spaced) {
    const was = out.find((x) => x.id === t.id);
    if (was && !same(was.fx.peq, t.fx.peq)) set(t.id, 'peq', t.fx.peq);
  }

  const parts = out.filter((t) => !isMixTrack(t) && !isEffect(t));
  const role = new Map(parts.map((t) => [t.id, trackRole(t, clips)]));
  const drums = parts.filter((t) => role.get(t.id) === 'drums');
  const music = parts.filter((t) => role.get(t.id) === 'music');
  const hasKick = drums.length > 0;
  const leads = leadsOf(music, clips);

  // Buses: the drums together, the music parts together (only tracks still playing to the master)
  const group = (members: Track[], name: string, fx: Track['fx']) => {
    const free = members.filter((t) => !t.output);
    if (free.length < 2) return;
    const bus = { ...newBus(name, free), fx };
    const at = Math.max(...free.map((t) => out.findIndex((x) => x.id === t.id))) + 1;
    out = [...out.slice(0, at), bus, ...out.slice(at)];
    buses.push(bus.id);
    for (const t of free) set(t.id, 'output', bus.id);
  };
  group(drums, 'Drum bus', busPresetFx('drums'));
  const musicFx = busPresetFx('music');
  group(music, 'Music bus', hasKick ? { ...musicFx, pump: { on: true, depth: 0.4, release: 220, trigger: 'kick' } } : musicFx);

  // The bass ducks under the kick
  if (hasKick) for (const t of parts) if (role.get(t.id) === 'bass' && !t.fx.pump.on) set(t.id, 'pump', { on: true, depth: 0.65, release: 150, trigger: 'kick' });

  // One shared room: every part a little in it (never less than it had)
  for (const t of parts) {
    const r = role.get(t.id)!;
    const now = out.find((x) => x.id === t.id)!;
    if ((now.reverbSend ?? 0) < ROOM[r]) set(t.id, 'reverbSend', ROOM[r]);
  }

  // The music parts left in the middle spread a little apart; the lead stays in front
  let i = 0;
  for (const t of music) {
    if (leads.has(t.id) || (t.pan ?? 0) !== 0) continue;
    set(t.id, 'pan', SPREAD[i++ % SPREAD.length]);
  }

  return { tracks: out, record: { buses, changes } };
}

/** Glue switched off: what it changed put back (where it's still as glue left it), its buses gone. */
export function removeGlue(tracks: Track[], record: GlueRecord): Track[] {
  let out = tracks;
  for (const c of [...record.changes].reverse()) {
    out = out.map((t) => (t.id === c.trackId && same(read(t, c.field), c.to) ? write(t, c.field, c.from) : t));
  }
  // A track put on a glue bus by hand since plays to where the bus did
  const gone = new Map(out.filter((t) => record.buses.includes(t.id)).map((t) => [t.id, t.output]));
  return out.filter((t) => !gone.has(t.id)).map((t) => (t.output && gone.has(t.output) ? { ...t, output: gone.get(t.output) } : t));
}
