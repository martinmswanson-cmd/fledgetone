/**
 * What part an instrument usually plays in a song, from its instrument alone (a new track has no
 * notes yet): the drums, the bass, a pad or chords, a lead, or something else. A new track starts
 * with the sends its kind of part is usually mixed with, and the piano rolls start a new note at
 * the length its kind is usually drawn with. Plain data, so Node can test it.
 */
import { INSTRUMENTS, type InstrumentDef } from '../audio/instrumentCatalog';
import type { InstrumentKey, Track } from './timelineTypes';

export type PartKind = 'drums' | 'bass' | 'pad' | 'lead' | 'fx' | 'other';

/** The synths and recordings that play pads and chords, past the Pads & Atmospheres group. */
const PADS: ReadonlySet<string> = new Set(['supersaw', 'wavetable', 'synthStrings', 'synthStrings2']);
/** The leads (and the pluck, which plays hooks and arpeggios like one). */
const LEADS: ReadonlySet<string> = new Set(['lead', 'pluck', 'squareLead', 'sawLead', 'calliope', 'chiffLead', 'charang', 'voiceLead', 'fifthsLead']);

export function partKind(key: InstrumentKey): PartKind {
  const info: InstrumentDef | undefined = INSTRUMENTS[key];
  if (!info) return 'other';
  if (info.kind === 'drums' || info.kind === 'rack' || info.category === 'Drums & Percussion') return 'drums';
  if (info.kind === 'fx' || info.kind === 'drop' || info.category === 'Sound Effects') return 'fx';
  if (info.category === 'Bass') return 'bass';
  if (LEADS.has(key)) return 'lead';
  if (PADS.has(key) || info.category === 'Pads & Atmospheres') return 'pad';
  return 'other';
}

/** A new track's reverb send by kind: pads and leads sit in the room, the drums and bass start dry. */
export const START_REVERB: Record<PartKind, number> = { drums: 0, bass: 0, pad: 0.22, lead: 0.18, fx: 0.1, other: 0.1 };

/** A new lead's echo: a dotted eighth, low in the mix, so its phrases ring on between notes. */
export const LEAD_ECHO = { time: '1/8d', feedback: 0.3, mix: 0.15 } as const;

/** The sends and effects a new track of `key` starts with, over its defaults. */
export function startSends(key: InstrumentKey, fx: Track['fx']): { reverbSend: number; fx: Track['fx'] } {
  const kind = partKind(key);
  return {
    reverbSend: START_REVERB[kind],
    fx: kind === 'lead' ? { ...fx, echo: { ...fx.echo, on: true, ...LEAD_ECHO } } : fx,
  };
}
