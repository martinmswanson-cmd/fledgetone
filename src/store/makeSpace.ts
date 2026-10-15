/**
 * Make space: small EQ moves so the parts of a mix stop covering each other, the way a mix engineer
 * carves room. From the notes each track plays (where they sound: a synth patch playing an octave
 * down counts an octave down) it works out who does what (the bass, the lead melody, the parts
 * supporting them) and then, on each track's parametric EQ:
 *   - every part above the bass loses the rumble under its lowest note (a low cut), so the bass
 *     owns the bottom;
 *   - parts reaching down into the bass's octaves are thinned a little there (a low shelf);
 *   - parts playing in the lead's range give way a little where the lead's presence is (a bell),
 *     so the melody comes through without being turned up.
 * Only the bands it uses change, and only to make room: a band the user has already moved is left
 * alone. Drums, sound effects, audio, buses and returns aren't touched.
 */
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { midiOf } from './noteTools';
import type { Clip, PeqBand, Track } from './timelineTypes';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * How far a Synth Designer track's lowest sound is from its written notes, in semitones: a patch's
 * oscillators can play octaves down, and its sub is an octave under the note, so a part written
 * at C3 can sound at C2. Its low cut has to be under that, or it takes the part's fundamental.
 */
function lowestShift(t: Track): number {
  const p = t.synth;
  if (!p) return 0;
  const shifts = [p.osc1, p.osc2].filter((o) => o.on && o.level > 0).map((o) => o.octave * 12 + o.semi);
  if (p.sub > 0) shifts.push(-12);
  return shifts.length ? Math.min(...shifts) : 0;
}

/** A track's notes are a single line (a melody) when hardly any start together. */
function isLine(notes: Clip['notes']): boolean {
  const starts = new Map<number, number>();
  for (const n of notes) starts.set(n.startOffset, (starts.get(n.startOffset) ?? 0) + 1);
  return [...starts.values()].filter((v) => v > 1).length < notes.length * 0.15;
}

export interface SpaceChange {
  trackId: string;
  what: string;
}

/** The tracks with room made (see above), and what changed on each. */
export function makeSpace(tracks: Track[], clips: Clip[]): { tracks: Track[]; changes: SpaceChange[] } {
  const parts = tracks
    .map((t) => {
      const kind = INSTRUMENTS[t.instrumentKey]?.kind;
      const category = INSTRUMENTS[t.instrumentKey]?.category;
      if (!kind || ['drums', 'fx', 'audio', 'bus', 'return', 'slicer', 'rack'].includes(kind) || category === 'Drums & Percussion' || category === 'Sound Effects') return null;
      const notes = clips.filter((c) => c.trackId === t.id && !c.audio).flatMap((c) => c.notes);
      const shift = lowestShift(t);
      const midis = notes.map((n) => midiOf(n.note) + shift).filter(Number.isFinite);
      if (midis.length < 4) return null;
      return { track: t, notes, midis, low: Math.min(...midis), high: Math.max(...midis), mid: median(midis), line: isLine(notes) };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (parts.length < 2) return { tracks, changes: [] };
  const bass = parts.filter((p) => p.mid < 48);
  const lines = parts.filter((p) => p.line && p.mid >= 55);
  const lead = lines.length ? lines.reduce((a, b) => (b.mid > a.mid ? b : a)) : null;
  const changes: SpaceChange[] = [];
  const out = tracks.map((t) => {
    const p = parts.find((x) => x.track.id === t.id);
    if (!p || bass.includes(p)) return t;
    const bands = t.fx.peq.bands.map((b) => ({ ...b }));
    const what: string[] = [];
    // A band that's where it started (unmoved by the user) can be used
    const fresh = (b: PeqBand | undefined, type: PeqBand['type']) => b && b.type === type && (b.gain === 0 || !b.on);
    // 1. The rumble under its lowest note
    const cut = Math.round(Math.max(40, Math.min(250, hz(p.low) * 0.7)));
    const lowCut = bands[0];
    if (lowCut && lowCut.type === 'lowcut' && (!lowCut.on || lowCut.freq < cut)) {
      bands[0] = { ...lowCut, on: true, freq: cut };
      what.push(`low cut at ${cut} Hz`);
    }
    // 2. Thinner where the bass plays
    if (bass.length && p.low < 55 && fresh(bands[1], 'lowshelf')) {
      bands[1] = { ...bands[1], on: true, freq: 160, gain: -2 };
      what.push('2 dB less below 160 Hz');
    }
    // 3. Out of the lead's way
    if (lead && lead !== p && p.high >= lead.low && p.low <= lead.high && fresh(bands[3], 'bell')) {
      const f = Math.round(Math.max(1000, Math.min(4000, hz(lead.mid) * 4)));
      bands[3] = { ...bands[3], on: true, type: 'bell', freq: f, gain: -2.5, q: 1 };
      what.push(`2.5 dB less at ${f} Hz, where the lead (${lead.track.name}) is`);
    }
    if (!what.length) return t;
    changes.push({ trackId: t.id, what: what.join(', ') });
    return { ...t, fx: { ...t.fx, peq: { on: true, bands } } };
  });
  return { tracks: out, changes };
}
