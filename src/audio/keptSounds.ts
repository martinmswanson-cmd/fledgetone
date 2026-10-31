/**
 * Sounds this browser keeps for itself, outside any project: the reference track, the producer
 * tag. Each has a named slot holding a sound library id (the sound itself is in the library, in
 * IndexedDB). They're never saved in a project or exported; freeing unused sounds leaves them be.
 */

const KEY = 'fledgetone.keptSounds';

/** The slots: what each kept sound is for. */
export type KeptSlot = 'reference' | 'producerTag';

function readAll(): Partial<Record<KeptSlot, { id: string; name: string }>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Partial<Record<KeptSlot, { id: string; name: string }>> = {};
    for (const [slot, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as { id?: unknown; name?: unknown };
      if ((slot === 'reference' || slot === 'producerTag') && typeof e?.id === 'string' && typeof e.name === 'string') out[slot] = { id: e.id, name: e.name };
    }
    return out;
  } catch {
    return {};
  }
}

/** The sound kept in `slot` (its id and name), if any. */
export function keptSound(slot: KeptSlot): { id: string; name: string } | null {
  return readAll()[slot] ?? null;
}

/** Keep a sound in `slot`, or empty it (null). */
export function keepSound(slot: KeptSlot, sound: { id: string; name: string } | null): void {
  const all = readAll();
  if (sound) all[slot] = sound;
  else delete all[slot];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage blocked (private mode): it's kept for this visit only
  }
}

/** Every kept sound's id, for freeing unused sounds to leave alone. */
export function keptSoundIds(): string[] {
  return Object.values(readAll()).map((e) => e!.id);
}
