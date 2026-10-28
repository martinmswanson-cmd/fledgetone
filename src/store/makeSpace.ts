/**
 * Make space: small EQ moves so the parts of a mix stop covering each other, the way a mix engineer
 * carves room. From the notes each track plays (where they sound: a synth patch playing an octave
 * down counts an octave down) it works out who does what (the bass, the lead melody, the parts
 * supporting them) and then, on each track's parametric EQ:
 *   - every part above the bass loses the rumble under its lowest note (a low cut), so the bass
 *     owns the bottom;
 *   - parts reaching down into the bass's octaves are thinned a little there (a low shelf);
 *   - parts playing in the lead's range give way a little where the lead's presence is (a bell),
 *     so the melody comes through without being turned up;
 *   - the parts above the bass that sound in the low mids (chords, pads, stabs under middle D)
 *     give a little there (a bell at LOW_MID_HZ), where their lower harmonics pile up on the
 *     bass's and the kick's into a boomy, boxy build-up;
 *   - a bass playing over a sub (a lower bass part holding the fundamental) gives a little where
 *     its harmonics thicken the low mids (a bell at about two and a half times its middle note),
 *     since the sub carries its weight;
 *   - the lead gets a little presence (a high shelf at PRESENCE_HZ).
 * These amounts came from comparing the demo songs with professional mixes: ours stood 3-9 dB
 * over theirs around 200 Hz and a few dB under from 4 to 8 kHz.
 * Only the bands it uses change: a band the user has already moved is left alone. Drums, sound
 * effects, audio, buses and returns aren't touched, nor a bass playing alone.
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

/** Where the parts above the bass give a little in the low mids (Hz), and how much (dB). */
export const LOW_MID_HZ = 280;
export const LOW_MID_DB = -2;
/** A bass over a sub: how much it gives at about 2.5 times its middle note (dB). */
export const BASS_MUD_DB = -3;
/** The lead's presence: a high shelf from here (Hz), this much (dB). */
export const PRESENCE_HZ = 5000;
export const PRESENCE_DB = 1.5;

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
      // (At their place in the song, so notes of different clips at the same offset aren't taken for a chord)
      const notes = clips.filter((c) => c.trackId === t.id && !c.audio).flatMap((c) => c.notes.map((n) => ({ ...n, startOffset: c.startBar + n.startOffset })));
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
  // The sub: the lowest bass part. The basses at least a fifth over it play on top of it
  const sub = bass.length > 1 ? bass.reduce((a, b) => (b.mid < a.mid ? b : a)) : null;
  const out = tracks.map((t) => {
    const p = parts.find((x) => x.track.id === t.id);
    if (!p) return t;
    const bands = t.fx.peq.bands.map((b) => ({ ...b }));
    const what: string[] = [];
    // A band that's where it started (unmoved by the user) can be used
    const fresh = (b: PeqBand | undefined, type: PeqBand['type']) => b && b.type === type && (b.gain === 0 || !b.on);
    if (bass.includes(p)) {
      // A bass over the sub: less where its harmonics thicken the low mids
      if (sub && p !== sub && p.mid >= sub.mid + 7 && fresh(bands[2], 'bell')) {
        const f = Math.round(Math.max(160, Math.min(320, hz(p.mid) * 2.5)));
        bands[2] = { ...bands[2], on: true, freq: f, gain: BASS_MUD_DB, q: 1.1 };
        what.push(`${-BASS_MUD_DB} dB less at ${f} Hz, over the sub (${sub.track.name})`);
      }
    } else {
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
      // 3. Less in the low mids, for a part under middle D other than the lead
      if (p !== lead && p.low < 62 && fresh(bands[2], 'bell')) {
        bands[2] = { ...bands[2], on: true, freq: LOW_MID_HZ, gain: LOW_MID_DB, q: 1 };
        what.push(`${-LOW_MID_DB} dB less at ${LOW_MID_HZ} Hz`);
      }
      // 4. Out of the lead's way
      if (lead && lead !== p && p.high >= lead.low && p.low <= lead.high && fresh(bands[3], 'bell')) {
        const f = Math.round(Math.max(1000, Math.min(4000, hz(lead.mid) * 4)));
        bands[3] = { ...bands[3], on: true, type: 'bell', freq: f, gain: -2.5, q: 1 };
        what.push(`2.5 dB less at ${f} Hz, where the lead (${lead.track.name}) is`);
      }
      // 5. The lead a little more present
      if (p === lead && fresh(bands[4], 'highshelf')) {
        bands[4] = { ...bands[4], on: true, freq: PRESENCE_HZ, gain: PRESENCE_DB };
        what.push(`${PRESENCE_DB} dB more from ${PRESENCE_HZ / 1000} kHz`);
      }
    }
    if (!what.length) return t;
    changes.push({ trackId: t.id, what: what.join(', ') });
    return { ...t, fx: { ...t.fx, peq: { on: true, bands } } };
  });
  return { tracks: out, changes };
}
