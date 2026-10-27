/**
 * Glue: a switch that makes a song's parts sound like one record instead of instruments playing
 * side by side, the way a mix engineer ties a mix together. Switched on, it:
 *   - makes space (makeSpace.ts): each part loses the rumble under it, and parts in the lead's
 *     range give way to it;
 *   - puts the drums on a drum bus and the music parts on a music bus (busPresets.ts), each glued
 *     by gentle compression, the music bus breathing with the kick (unless the parts pump already);
 *   - ducks the bass under the kick and the snare (a hole for the drums);
 *   - sends every part a little more to the shared reverb, so they sit in one room;
 *   - spreads the parts left in the middle a little apart (never the lead, the bass or the drums).
 * Every change is recorded (GlueRecord: the value before and the value glue set), so switching it
 * off puts back what it changed, but only where the value is still what glue set: a pan or an EQ
 * changed by hand since stays. The buses it made go, and their tracks play to where the bus did.
 * It glues in a style (GLUE_BUS_STYLES: clean, bass music, pumping), each bus level-matched so
 * switching glue on is no louder. Group and glue (groupAndGlue) does the bus part on chosen tracks
 * only. Plain data in and out, so Node can test it; the store keeps the record in MasterSettings.glueMix.
 */
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { trackRole } from '../audio/mixCheck';
import { busPresetFx } from './busPresets';
import { isMixTrack } from './buses';
import { makeSpace } from './makeSpace';
import { midiOf } from './noteTools';
import type { Clip, GlueChange, GlueField, GlueRecord, GlueBusStyle, Track } from './timelineTypes';

/**
 * How hard each style glues its buses: the drum bus's and the music bus's compression and
 * saturation, and how much the music bus breathes with the kick. The makeup gain brings each bus
 * back to the level it went in at (measured on rendered loops: switching glue on is never louder,
 * see the tests), so what changes is how the parts sit, not how loud they are.
 */
export const GLUE_BUS_STYLES: Record<GlueBusStyle, { label: string; about: string; drums: Pick<Track['fx'], 'compressor' | 'saturate'>; music: Pick<Track['fx'], 'compressor' | 'saturate'>; pump: number }> = {
  clean: {
    label: 'Clean (future bass, artcore)',
    about: 'Light compression, a touch of warmth, the chords barely breathe with the kick.',
    drums: { compressor: { on: true, threshold: -18, ratio: 3, makeup: 0 }, saturate: { on: true, amount: 0.2, mix: 0.35 } },
    music: { compressor: { on: true, threshold: -24, ratio: 1.5, makeup: 0 }, saturate: { on: true, amount: 0.1, mix: 0.25 } },
    pump: 0.2,
  },
  bass: {
    label: 'Bass music (dubstep, drumstep)',
    about: 'The kit hits as one, the music warmed and held together, breathing a little with the kick.',
    drums: { compressor: { on: true, threshold: -16, ratio: 4, makeup: 0.6 }, saturate: { on: true, amount: 0.3, mix: 0.5 } },
    music: { compressor: { on: true, threshold: -22, ratio: 2, makeup: 0.4 }, saturate: { on: true, amount: 0.15, mix: 0.3 } },
    pump: 0.4,
  },
  pumping: {
    label: 'Pumping (house, darksynth)',
    about: 'Harder bus compression and more saturation, the music pumping with the kick.',
    drums: { compressor: { on: true, threshold: -14, ratio: 4, makeup: 0.9 }, saturate: { on: true, amount: 0.35, mix: 0.5 } },
    music: { compressor: { on: true, threshold: -20, ratio: 2.5, makeup: 0.6 }, saturate: { on: true, amount: 0.25, mix: 0.4 } },
    pump: 0.55,
  },
};
export const GLUE_BUS_STYLE_IDS = Object.keys(GLUE_BUS_STYLES) as GlueBusStyle[];

/** A glue bus's effects: the bus preset's, with the style's compression and saturation. */
export function glueBusFx(kind: 'drums' | 'bass' | 'music', style: GlueBusStyle = 'bass'): Track['fx'] {
  const st = GLUE_BUS_STYLES[style];
  return { ...busPresetFx(kind), ...(kind === 'drums' ? st.drums : st.music) };
}

/** The shared reverb each kind of part gets at least (its send is only ever raised). */
const ROOM = { drums: 0.1, bass: 0.04, vocal: 0.15, music: 0.2 } as const;
/** Where the parts left in the middle go, in turn: a little either side, then a little further. */
const SPREAD = [-0.25, 0.25, -0.15, 0.15, -0.35, 0.35, -0.1, 0.1];
/** The bass's duck under the drums: a 12 dB hole on each kick and snare. */
export const GLUE_BASS_DUCK = { on: true, depth: 0.75, release: 140, trigger: 'kickSnare', shape: 'hole' } as const;

/**
 * A new bus put in the track list after its members: in their folder if they share one, else
 * after the last member's folder (not inside it, which would split the folder in two).
 */
function placeBus(tracks: Track[], bus: Track, members: readonly Track[]): Track[] {
  const lastIndex = Math.max(...members.map((t) => tracks.findIndex((x) => x.id === t.id)));
  const last = tracks[lastIndex];
  const sameFolder = last.folder && members.every((t) => t.folder?.id === last.folder!.id) ? last.folder : undefined;
  const placed = sameFolder ? { ...bus, folder: sameFolder } : bus;
  let at = lastIndex + 1;
  if (last.folder && !sameFolder) while (at < tracks.length && tracks[at].folder?.id === last.folder.id) at++;
  return [...tracks.slice(0, at), placed, ...tracks.slice(at)];
}

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
export function applyGlue(tracks: Track[], clips: readonly Clip[], newBus: (name: string, members: Track[]) => Track, style: GlueBusStyle = 'bass'): { tracks: Track[]; record: GlueRecord } {
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
  // (One drum track gets its bus; the music parts need two to be worth one)
  const group = (members: Track[], name: string, fx: Track['fx'], least = 1) => {
    const free = members.filter((t) => !t.output);
    if (free.length < least) return;
    const bus = { ...newBus(name, free), fx };
    out = placeBus(out, bus, free);
    buses.push(bus.id);
    for (const t of free) set(t.id, 'output', bus.id);
  };
  group(drums, 'Drum bus', glueBusFx('drums', style));
  const musicFx = glueBusFx('music', style);
  // (The bus breathes with the kick unless its parts pump already: Duck to kick set them for the style)
  const pumping = music.some((t) => t.fx.pump.on);
  group(music, 'Music bus', hasKick && !pumping ? { ...musicFx, pump: { on: true, depth: GLUE_BUS_STYLES[style].pump, release: 220, trigger: 'kick' } } : musicFx, 2);

  // The bass makes a hole for the kick and the snare (about 12 dB, held while the drum hits)
  if (hasKick) for (const t of parts) if (role.get(t.id) === 'bass' && !t.fx.pump.on) set(t.id, 'pump', { ...t.fx.pump, ...GLUE_BASS_DUCK });

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

  return { tracks: out, record: { buses, changes, ...(style !== 'bass' ? { style } : {}) } };
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

/**
 * Group and glue: the chosen tracks onto glue buses in one go, the drums onto a drum bus, the
 * bass onto a bass bus (its low end kept) and the rest (chords, leads, vocals) onto a music bus
 * (which leaves the low end to the bass), each with the style's compression and
 * saturation (level-matched, as Glue's). A group of one track still gets its bus. Tracks already
 * on a bus, buses and effects stay as they are. Returns the tracks and the buses made.
 */
export function groupAndGlue(tracks: Track[], clips: readonly Clip[], ids: readonly string[], newBus: (name: string, members: Track[]) => Track, style: GlueBusStyle = 'bass'): { tracks: Track[]; buses: string[] } {
  const chosen = tracks.filter((t) => ids.includes(t.id) && !isMixTrack(t) && !isEffect(t) && !t.output);
  const role = new Map(chosen.map((t) => [t.id, trackRole(t, clips)]));
  const drums = chosen.filter((t) => role.get(t.id) === 'drums');
  const bass = chosen.filter((t) => role.get(t.id) === 'bass');
  const music = chosen.filter((t) => !drums.includes(t) && !bass.includes(t));
  let out = tracks;
  const buses: string[] = [];
  for (const [members, kind, name] of [[drums, 'drums', 'Drum bus'], [bass, 'bass', 'Bass bus'], [music, 'music', 'Music bus']] as const) {
    if (!members.length) continue;
    const bus = { ...newBus(name, members), fx: glueBusFx(kind, style) };
    out = placeBus(out, bus, members).map((t) => (members.some((m) => m.id === t.id) ? { ...t, output: bus.id } : t));
    buses.push(bus.id);
  }
  return { tracks: out, buses };
}
