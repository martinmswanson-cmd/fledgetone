/**
 * The producer tag: a short recorded or imported sound (a voice saying the producer's name, say)
 * kept in this browser for every project, placed at the start of a song or every few bars of a
 * beat-store preview, with the beat ducked a little under it. The sound lives in the sound
 * library (IndexedDB) like any other; which sound is the tag is remembered in localStorage. This
 * file has the plain maths: where the tags go, trimming the silence around a recording, and
 * reading the remembered tag back safely. No store or audio here, so Node can unit-test it.
 */

/** The localStorage key holding the remembered tag. */
export const TAG_STORAGE_KEY = 'fledgetone.producerTag';
/** How much the beat dips under the tag, dB: a little, so the tag reads without the beat dropping out. */
export const TAG_DUCK_DB = 6;
/** The longest tag kept, seconds (a tag is a few words). */
export const TAG_MAX_SECONDS = 8;
/** The name of the track tags go on. */
export const TAG_TRACK_NAME = 'Producer tag';

export interface ProducerTag {
  /** The sound's id in the sound library */
  soundId: string;
  name: string;
  seconds: number;
}

/** The remembered tag from what localStorage held, or null if it's missing or damaged. */
export function parseTag(raw: string | null | undefined): ProducerTag | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ProducerTag>;
    if (typeof v.soundId !== 'string' || !v.soundId || typeof v.seconds !== 'number' || !(v.seconds > 0)) return null;
    return { soundId: v.soundId, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : 'Tag', seconds: v.seconds };
  } catch {
    return null;
  }
}

/**
 * Where tags go (1-based bars): at `from` only (every = 0), or every `every` bars from `from` up to
 * the song's end (`end`, exclusive), each one fitting before the end.
 */
export function tagBars(from: number, end: number, every: number, tagLength: number): number[] {
  const start = Math.max(1, Math.round(from));
  if (!(every > 0)) return [start];
  const out: number[] = [];
  for (let b = start; b + Math.min(tagLength, every) <= end + 1e-6; b += every) out.push(b);
  return out.length ? out : [start];
}

/**
 * The part of a recording to keep: from a moment before the first sound over `threshold` (linear)
 * to a moment after the last, at most TAG_MAX_SECONDS. Returns sample indexes [start, end); an
 * empty recording gives [0, 0].
 */
export function trimSilence(channels: readonly Float32Array[], sampleRate: number, threshold = 0.02, pad = 0.03): [number, number] {
  const length = channels[0]?.length ?? 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < length; i++) {
    let loud = false;
    for (const c of channels) if (Math.abs(c[i]) > threshold) loud = true;
    if (loud) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return [0, 0];
  const p = Math.round(pad * sampleRate);
  const start = Math.max(0, first - p);
  const end = Math.min(length, last + 1 + p * 4, start + Math.round(TAG_MAX_SECONDS * sampleRate));
  return [start, end];
}

/** A short fade at both ends of a trimmed recording (in place), so it starts and stops without a click. */
export function fadeEdges(channels: Float32Array[], sampleRate: number, seconds = 0.005): void {
  for (const c of channels) {
    const n = Math.min(Math.floor(c.length / 2), Math.round(seconds * sampleRate));
    for (let i = 0; i < n; i++) {
      const g = i / n;
      c[i] *= g;
      c[c.length - 1 - i] *= g;
    }
  }
}
