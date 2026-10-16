import type { InstrumentKey } from './timelineTypes';
import { INSTRUMENT_KEYS, isInstrumentKey } from '../audio/instrumentCatalog';

/**
 * Drag-and-drop payloads from the sound deck onto the timeline. The deck (the bottom panel's old
 * Instruments tab) is retired, so nothing sets them any more; the lanes still read them.
 * The instrument is encoded in the MIME type because dragover handlers can only see
 * dataTransfer.types, not the data, and lanes need to know whether to accept the drop.
 */
export type DragPayload =
  | { kind: 'sound'; instrument: InstrumentKey; label: string; notes: string[]; duration: string; velocity: number }
  | { kind: 'pattern'; instrument: InstrumentKey; patternId: string; label: string };

const MIME_PREFIX = 'application/x-bos-beat-box-';

export function setDragPayload(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(MIME_PREFIX + payload.instrument.toLowerCase(), JSON.stringify(payload));
  e.dataTransfer.setData('text/plain', payload.label);
  e.dataTransfer.effectAllowed = 'copy';
}

/**
 * Instrument of the item being dragged, if it's one of ours (readable during dragover).
 * Browsers lowercase data types, so "drumMachine" comes back as "drummachine": match it
 * against the catalog's keys case-insensitively.
 */
export function dragInstrument(e: React.DragEvent): InstrumentKey | null {
  const type = Array.from(e.dataTransfer.types).find((t) => t.startsWith(MIME_PREFIX));
  if (!type) return null;
  const lower = type.slice(MIME_PREFIX.length);
  return INSTRUMENT_KEYS.find((k) => k.toLowerCase() === lower) ?? null;
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  const instrument = dragInstrument(e);
  if (!instrument) return null;
  try {
    const payload = JSON.parse(e.dataTransfer.getData(MIME_PREFIX + instrument.toLowerCase())) as DragPayload;
    return isInstrumentKey(payload.instrument) ? payload : null;
  } catch {
    return null;
  }
}
